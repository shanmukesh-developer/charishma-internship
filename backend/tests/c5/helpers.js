// C5 wallet ledger test harness: temp-file SQLite (WAL + busy_timeout, so parallel transactions really
// run on separate connections), the real order / feature / admin / user / rider routers on an ephemeral
// port, stubbed Firebase and server module. Never touches a real database or the network.
if (Number(process.env.UV_THREADPOOL_SIZE || 4) < 32) console.warn('[c5 tests] run through `npm run test:c5` (UV_THREADPOOL_SIZE=64) or the parallel races will crawl.');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'c5-wallet-test-secret-not-for-prod';
process.env.OTP_SECRET = 'c5-wallet-test-otp-secret';
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

const fbPath = require.resolve(path.join(B, 'config/firebase.js'));
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { apps: [], getApps: () => [] } };
// createOrder asks server.js for surge state; never boot the real server here.
const serverPath = require.resolve(path.join(B, 'server.js'));
require.cache[serverPath] = { id: serverPath, filename: serverPath, loaded: true, exports: { isSurgeActive: () => false } };

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

let ctx = null;
const dbPath = require.resolve(path.join(B, 'config/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {}, ensurePgOpenBookingIndex: async () => ({}), getPgOpenIndexState: () => ({}) } };

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
  const file = path.join(os.tmpdir(), `c5-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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
  ctx = { sequelize, file, emitted };
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
  r('models/RiderCashEntry').initRiderCashEntryModel(sequelize); // C6 (settle-rider records a Payout)
  r('models/Payout').initPayoutModel(sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Order.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  await sequelize.sync();
  await r('utils/walletLedger').ensureWalletLedgerIndexes(sequelize);
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/orders', r('routes/orderRoutes'));
  app.use('/api/delivery', r('routes/deliveryPartnerRoutes'));
  app.use('/api/features', r('routes/featureRoutes'));
  app.use('/api/admin', r('routes/adminRoutes'));
  app.use('/api/rewards', r('routes/rewardRoutes'));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
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
const phone = () => `9${String(200000000 + (++seq) * 13 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ wallet = 0, role = 'student', ...extra } = {}) => {
  const u = await ctx.M('User').create({ name: `C5 ${role} ${seq}`, phone: phone(), role, isActive: true, password: `x-test-only-${seq}-pw`, walletBalance: wallet, ...extra });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const mkRider = async ({ wallet = 0 } = {}) => {
  const d = await ctx.M('DeliveryPartner').create({ name: `C5 Rider ${++seq}`, phone: phone(), password: `x-test-only-${seq}-pw`, isApproved: true, isOnline: true, walletBalance: wallet });
  d.token = jwt.sign({ id: d.id, role: 'rider', tv: 0 }, process.env.JWT_SECRET);
  return d;
};
const mkStore = async ({ price = 100, riderBuys = false } = {}) => {
  const hours = { start: '00:00', end: '00:00' };
  const st = await ctx.M('Restaurant').create({ name: `C5 Kitchen ${++seq}`, location: 'SRM AP Food Court', ...(riderBuys ? {} : { password: 'storepass1' }), operatingHours: hours, isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064 });
  const item = await ctx.M('MenuItem').create({ restaurantId: st.id, name: `C5 Dish ${seq}`, price, isAvailable: true });
  return { store: st, item };
};
const orderBody = (itemId, paymentMethod, extra = {}) => ({ items: [{ menuItemId: itemId, quantity: 1 }], paymentMethod, deliveryAddress: 'Block A, Room 101, SRM AP', campus: 'srmap', ...extra });

/** Ledger rows of one owner, oldest first: [type, amountPaise, balanceAfterPaise, refType, refId]. */
const ledger = async (ownerType, ownerId) => (await ctx.M('WalletTransaction').findAll({ where: { ownerType, ownerId: String(ownerId) }, order: [['createdAt', 'ASC'], ['id', 'ASC']] }));
const ledgerShape = async (ownerType, ownerId) => (await ledger(ownerType, ownerId)).map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.refType, x.refId]);
const balancePaise = async (ownerType, ownerId) => {
  const row = await ctx.M(ownerType === 'user' ? 'User' : 'DeliveryPartner').findByPk(ownerId, { attributes: ['walletBalance'] });
  return r('utils/walletLedger').toPaise(row.walletBalance);
};
const ledgerSum = async (ownerType, ownerId) => Number(await ctx.M('WalletTransaction').sum('amountPaise', { where: { ownerType, ownerId: String(ownerId) } })) || 0;

module.exports = { setup, teardown, api, mkUser, mkRider, mkStore, orderBody, ledger, ledgerShape, balancePaise, ledgerSum, r, B, get ctx() { return ctx; } };
