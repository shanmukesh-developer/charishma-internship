// C8 test harness (store compliance + order receipts): temp-file SQLite (WAL + busy_timeout, so parallel
// transactions really run on separate connections), the real order / restaurant / admin / catalogue routers
// and the /receipts/:token page on an ephemeral port, stubbed Firebase / server module / pushes. Never
// touches a real database or the network.
if (Number(process.env.UV_THREADPOOL_SIZE || 4) < 32) console.warn('[c8 tests] run through `npm run test:c8` (UV_THREADPOOL_SIZE=64) or the parallel races will crawl.');
process.env.NODE_ENV = 'test';
// Delivery slots (utils/deliverySlots) gate riders and the store-accept clock by the time of day: these suites
// test the pre-slot flows, so slots are off unless a run asks for them (tests/slots turns them on itself).
if (process.env.DELIVERY_SLOTS === undefined) process.env.DELIVERY_SLOTS = 'off';
process.env.JWT_SECRET = 'c8-receipts-test-secret-not-for-prod';
process.env.OTP_SECRET = 'c8-receipts-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.PUBLIC_API_URL;

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
stub('utils/push.js', {
  sendPushToTokens: async () => ({ successCount: 0, failureCount: 0, staleTokens: [] }),
  sendPushToTopic: async () => {},
});

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

let ctx = null;
stub('config/db.js', { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {}, ensurePgOpenBookingIndex: async () => ({}), getPgOpenIndexState: () => ({}) });

const fakeIo = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
  in: () => ({ socketsJoin() {}, socketsLeave() {}, fetchSockets: async () => [] }),
  fetchSockets: async () => [],
  of: () => ({ fetchSockets: async () => [], in: () => ({ fetchSockets: async () => [] }) }),
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `c8-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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
  ctx = { sequelize, file };
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
  r('models/ReceiptCounter').initReceiptCounterModel(sequelize);
  const M = sequelize.models;
  M.Restaurant.hasMany(M.MenuItem, { foreignKey: 'restaurantId', as: 'menuItems' });
  M.MenuItem.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Order.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  await sequelize.sync();
  await r('utils/walletLedger').ensureWalletLedgerIndexes(sequelize);
  const mig = await r('utils/financeMigrations').runFinanceMigrations(sequelize);
  if (mig.error) throw new Error(`finance migrations: ${mig.error}`);
  const rm = await r('utils/receipts').runReceiptMigrations(sequelize);
  if (!rm.ok) throw new Error(`receipt migrations: ${rm.error}`);
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/orders', r('routes/orderRoutes'));
  app.use('/api/restaurants', r('routes/restaurantRoutes'));
  app.use('/api/catalogue', r('routes/catalogueRoutes'));
  app.use('/api/admin', r('routes/adminRoutes'));
  app.get('/receipts/:token', r('controllers/receiptController').renderReceiptPage);
  const server = await require('../listenFree').listenFree(app);
  ctx.server = server;
  ctx.base = `http://127.0.0.1:${server.address().port}`;
  ctx.M = (n) => sequelize.models[n];
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await new Promise((res) => setTimeout(res, 100)); // fire-and-forget receipt assignment settles
  if (ctx.server) await new Promise((res) => ctx.server.close(() => res()));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`, `${ctx.file}-wal`, `${ctx.file}-shm`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
};

const raw = async (method, url, { token, body, headers = {} } = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  return fetch(url.startsWith('http') ? url : ctx.base + url, { method, headers: h, body: payload, redirect: 'manual' });
};
const api = async (method, url, token, body) => {
  const res = await raw(method, url, { token, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
};

let seq = 0;
const phone = () => `9${String(400000000 + (++seq) * 19 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ wallet = 0, role = 'student', name } = {}) => {
  const u = await ctx.M('User').create({ name: name || `C8 ${role} ${seq}`, phone: phone(), role, isActive: true, password: `x-test-only-${seq}-pw`, walletBalance: wallet, hostelBlock: null });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const mkRider = async () => {
  const d = await ctx.M('DeliveryPartner').create({ name: `C8 Rider ${++seq}`, phone: phone(), password: `x-test-only-${seq}-pw`, isApproved: true, isOnline: true });
  d.token = jwt.sign({ id: d.id, role: 'rider', tv: 0 }, process.env.JWT_SECRET);
  return d;
};
// Test-only FSSAI numbers (14 digits, obviously synthetic): 1000000000xxxx.
let fssaiSeq = 0;
const fakeFssai = () => `100000000${String(++fssaiSeq + (process.pid % 1000) * 10).padStart(5, '0')}`;
const mkStore = async ({ price = 100, packagingFee = 0, vendorType = 'RESTAURANT', extra = {} } = {}) => {
  const hours = { start: '00:00', end: '00:00' };
  const st = await ctx.M('Restaurant').create({
    name: `C8 Kitchen ${++seq}`, location: 'SRM AP Food Court', password: 'storepass1', operatingHours: hours,
    isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064, commissionRate: 10, commissionType: 'percentage', vendorType, packagingFee, ...extra,
  });
  const item = await ctx.M('MenuItem').create({ restaurantId: st.id, name: `C8 Dish ${seq}`, price, isAvailable: true });
  st.token = jwt.sign({ id: st.id, role: 'restaurant', tv: 0 }, process.env.JWT_SECRET);
  return { store: st, item };
};
const orderBody = (itemId, paymentMethod, qty = 1) => ({ items: [{ menuItemId: itemId, quantity: qty }], paymentMethod, deliveryAddress: 'Block A, Room 101, SRM AP', campus: 'srmap' });
const placeOrder = async ({ item, user, method = 'COD', qty = 1 }) => {
  const res = await api('POST', '/api/orders', user.token, orderBody(item.id, method, qty));
  if (res.status !== 201) throw new Error(`order failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
/** Admin marks the order Delivered through the real admin status route. */
const adminDeliver = (orderId, admin) => api('PUT', `/api/orders/${orderId}/status`, admin.token, { status: 'Delivered' });
/** Waits until the order has a receipt number (assigned right after the Delivered flip). */
const waitReceipt = async (orderId, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const o = await ctx.M('Order').findByPk(orderId, { attributes: ['receiptNumber'] });
    if (o && o.receiptNumber) return o.receiptNumber;
    await new Promise((res) => setTimeout(res, 25));
  }
  return null;
};
const auditRows = (action, targetId) => ctx.M('VerificationLog').findAll({ where: { action, ...(targetId ? { targetId: String(targetId) } : {}) }, order: [['timestamp', 'ASC']], raw: true });
const resetSettings = async () => {
  await ctx.M('GlobalConfig').destroy({ where: { key: 'RECEIPT_SETTINGS' } });
  r('utils/receiptSettings').clearCache();
  try { r('controllers/adminController').clearRestaurantsCache(); } catch { /* none */ }
};

module.exports = {
  setup, teardown, api, raw, mkUser, mkRider, mkStore, fakeFssai, placeOrder, adminDeliver, waitReceipt, auditRows, resetSettings,
  r, B, jwt, get ctx() { return ctx; },
};
