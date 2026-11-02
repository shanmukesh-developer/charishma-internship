// C6 test harness (rider COD cash ledger, earnings, commission snapshot, payouts): temp-file SQLite (WAL +
// busy_timeout, so parallel transactions really run on separate connections), the real order / rider /
// admin / restaurant routers on an ephemeral port, stubbed Firebase / server module / pushes. Never
// touches a real database or the network.
if (Number(process.env.UV_THREADPOOL_SIZE || 4) < 32) console.warn('[c6 tests] run through `npm run test:c6` (UV_THREADPOOL_SIZE=64) or the parallel races will crawl.');
process.env.NODE_ENV = 'test';
// Delivery slots (utils/deliverySlots) gate riders and the store-accept clock by the time of day: these suites
// test the pre-slot flows, so slots are off unless a run asks for them (tests/slots turns them on itself).
if (process.env.DELIVERY_SLOTS === undefined) process.env.DELIVERY_SLOTS = 'off';
process.env.JWT_SECRET = 'c6-finance-test-secret-not-for-prod';
process.env.OTP_SECRET = 'c6-finance-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const r = (rel) => require(path.join(B, rel));

const stub = (rel, exports) => {
  const p = require.resolve(path.join(B, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('config/firebase.js', { apps: [], getApps: () => [] });
stub('server.js', { isSurgeActive: () => false });
const pushes = [];
stub('utils/push.js', {
  sendPushToTokens: async (tokens, title, body, data) => { pushes.push({ tokens, title, body, data }); return { successCount: 0, failureCount: 0, staleTokens: [] }; },
  sendPushToTopic: async () => {},
});

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

let ctx = null;
stub('config/db.js', { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {}, ensurePgOpenBookingIndex: async () => ({}), getPgOpenIndexState: () => ({}) });

const emitted = [];
const fakeIo = {
  to: (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }) }),
  emit: (ev, p) => emitted.push({ room: '*', ev, p }),
  in: () => ({ socketsJoin() {}, socketsLeave() {}, fetchSockets: async () => [] }),
  fetchSockets: async () => [],
  of: () => ({ fetchSockets: async () => [], in: () => ({ fetchSockets: async () => [] }) }),
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `c6-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  const cm = sequelize.connectionManager;
  const origGet = cm.getConnection.bind(cm);
  const seen = new WeakSet();
  cm.getConnection = async (opts) => {
    const conn = await origGet(opts);
    if (!seen.has(conn)) { seen.add(conn); conn.configure('busyTimeout', 20000); conn.run('PRAGMA synchronous=NORMAL;'); }
    return conn;
  };
  await sequelize.query('PRAGMA journal_mode=WAL;');
  ctx = { sequelize, file, emitted, pushes };
  r('models/User').initUserModel(sequelize);
  r('models/DeliveryPartner').initDeliveryPartnerModel(sequelize);
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/Order').initOrderModel(sequelize);
  r('models/Coupon').initCouponModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('models/ProductReview').initProductReviewModel(sequelize);
  r('models/IdempotencyKey').initIdempotencyKeyModel(sequelize);
  r('models/WalletTransaction').initWalletTransactionModel(sequelize);
  r('models/RiderCashEntry').initRiderCashEntryModel(sequelize);
  r('models/Payout').initPayoutModel(sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Order.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  await sequelize.sync();
  await r('utils/walletLedger').ensureWalletLedgerIndexes(sequelize);
  const mig = await r('utils/financeMigrations').runFinanceMigrations(sequelize);
  if (mig.error || (mig.indexes && mig.indexes.errors.length)) throw new Error(`finance migrations: ${mig.error || mig.indexes.errors.join('; ')}`);
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/orders', r('routes/orderRoutes'));
  app.use('/api/delivery', r('routes/deliveryPartnerRoutes'));
  app.use('/api/restaurants', r('routes/restaurantRoutes'));
  app.use('/api/admin', r('routes/adminRoutes'));
  const server = await require('../listenFree').listenFree(app);
  ctx.server = server;
  ctx.base = `http://127.0.0.1:${server.address().port}`;
  ctx.M = (n) => sequelize.models[n];
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  if (ctx.server) await new Promise((res) => ctx.server.close(() => res()));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`, `${ctx.file}-wal`, `${ctx.file}-shm`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
};

const api = async (method, url, token, body, headers = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(ctx.base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

let seq = 0;
const phone = () => `8${String(300000000 + (++seq) * 17 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ wallet = 0, role = 'student', ...extra } = {}) => {
  const u = await ctx.M('User').create({ name: `C6 ${role} ${seq}`, phone: phone(), role, isActive: true, password: `x-test-only-${seq}-pw`, walletBalance: wallet, hostelBlock: null, ...extra });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const mkRider = async ({ wallet = 0 } = {}) => {
  const d = await ctx.M('DeliveryPartner').create({ name: `C6 Rider ${++seq}`, phone: phone(), password: `x-test-only-${seq}-pw`, isApproved: true, isOnline: true, walletBalance: wallet });
  d.token = jwt.sign({ id: d.id, role: 'rider', tv: 0 }, process.env.JWT_SECRET);
  return d;
};
const mkStore = async ({ price = 100, riderBuys = false, rate = 10, type = 'percentage', vendorType = 'RESTAURANT' } = {}) => {
  const hours = { start: '00:00', end: '00:00' };
  const st = await ctx.M('Restaurant').create({
    name: `C6 Kitchen ${++seq}`, location: 'SRM AP Food Court', ...(riderBuys ? {} : { password: 'storepass1' }), operatingHours: hours,
    isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064, commissionRate: rate, commissionType: type, vendorType,
  });
  const item = await ctx.M('MenuItem').create({ restaurantId: st.id, name: `C6 Dish ${seq}`, price, isAvailable: true });
  st.token = jwt.sign({ id: st.id, role: 'restaurant', tv: 0 }, process.env.JWT_SECRET);
  return { store: st, item };
};
const orderBody = (itemId, paymentMethod, extra = {}) => ({ items: [{ menuItemId: itemId, quantity: 1 }], paymentMethod, deliveryAddress: 'Block A, Room 101, SRM AP', campus: 'srmap', ...extra });

/** Customer places an order through the real API. */
const placeOrder = async ({ item, user, method = 'COD' }) => {
  const res = await api('POST', '/api/orders', user.token, orderBody(item.id, method));
  if (res.status !== 201) throw new Error(`order failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
/** Kitchen marks it ready (as the partner app would), the rider claims it through the real claim route. */
const readyAndClaim = async (orderId, rider) => {
  await ctx.M('Order').update({ status: 'ReadyForPickup', acceptedAt: new Date(), readyAt: new Date() }, { where: { id: orderId, status: { [require(path.join(B, 'node_modules/sequelize')).Op.in]: ['Pending', 'Accepted'] } } });
  return api('PUT', `/api/delivery/accept/${orderId}`, rider.token);
};
/** Claim -> picked up through the real rider routes. Returns the order PIN. */
const toPickedUp = async (orderId, rider) => {
  const c = await readyAndClaim(orderId, rider);
  if (c.status !== 200) throw new Error(`claim failed ${c.status} ${JSON.stringify(c.body)}`);
  const p = await api('PUT', `/api/delivery/status/${orderId}`, rider.token, { status: 'PickedUp' });
  if (p.status !== 200) throw new Error(`pickup failed ${p.status} ${JSON.stringify(p.body)}`);
  return (await ctx.M('Order').findByPk(orderId, { attributes: ['deliveryPin'] })).deliveryPin;
};
const deliver = (orderId, rider, pin) => api('PUT', `/api/delivery/status/${orderId}`, rider.token, { status: 'Delivered', pin });
/** Full flow: order -> claimed -> picked up -> delivered. Returns { order, res }. */
const fullDelivery = async ({ item, user, rider, method = 'COD' }) => {
  const order = await placeOrder({ item, user, method });
  const pin = await toPickedUp(order.id, rider);
  const res = await deliver(order.id, rider, pin);
  return { order, res };
};

const cashRows = (riderId) => ctx.M('RiderCashEntry').findAll({ where: { riderId: String(riderId) }, order: [['createdAt', 'ASC'], ['id', 'ASC']], raw: true });
const cashHeld = async (riderId) => Number((await ctx.M('DeliveryPartner').findByPk(riderId, { attributes: ['cashHeldPaise'], raw: true })).cashHeldPaise) || 0;
const cashSum = async (riderId) => Number(await ctx.M('RiderCashEntry').sum('amountPaise', { where: { riderId: String(riderId) } })) || 0;
const toPaise = (x) => r('utils/riderEarnings').toPaise(x);

module.exports = {
  setup, teardown, api, mkUser, mkRider, mkStore, orderBody, placeOrder, readyAndClaim, toPickedUp, deliver, fullDelivery,
  cashRows, cashHeld, cashSum, toPaise, r, B, get ctx() { return ctx; },
};
