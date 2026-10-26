// C9 test harness (partner account deletion, order chat persistence, order issue tickets): temp-file SQLite
// (WAL + busy_timeout), the real users / orders / delivery / auto-ride / legal routers on an ephemeral port,
// stubbed Firebase / pushes / mail / server module, a fake socket.io that records emits. Never touches a
// real database or the network (FAST2SMS_API_KEY is unset, so no SMS can go out).
process.env.NODE_ENV = 'test';
// Delivery slots (utils/deliverySlots) gate riders and the store-accept clock by the time of day: these suites
// test the pre-slot flows, so slots are off unless a run asks for them (tests/slots turns them on itself).
if (process.env.DELIVERY_SLOTS === undefined) process.env.DELIVERY_SLOTS = 'off';
process.env.JWT_SECRET = 'c9-partner-test-secret-not-for-prod';
process.env.OTP_SECRET = 'c9-partner-test-otp-secret';
process.env.ACCOUNT_DELETE_SKIP_FIREBASE = '1';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.FAST2SMS_API_KEY;
delete process.env.ORDER_CHAT_RETENTION_DAYS;

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
stub('utils/mailer.js', { sendMail: async () => ({ ok: true }), sendVerificationCode: async () => ({ ok: true }), isMailerConfigured: () => false, parseSender: () => ({}) });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(B, 'node_modules/bcryptjs'));

let ctx = null;
stub('config/db.js', { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {}, ensurePgOpenBookingIndex: async () => ({}), getPgOpenIndexState: () => ({}) });

const emitted = [];
const target = (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }), socketsJoin() {}, socketsLeave() {}, fetchSockets: async () => [] });
const fakeIo = {
  to: target,
  in: target,
  emit: (ev, p) => emitted.push({ room: '*', ev, p }),
  fetchSockets: async () => [],
  of: () => ({ fetchSockets: async () => [], in: () => ({ fetchSockets: async () => [] }), to: target }),
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

async function silent(fn) {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `c9-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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
  for (const [m, fn] of [
    ['models/User', 'initUserModel'], ['models/GlobalConfig', 'initGlobalConfigModel'], ['models/VerificationLog', 'initVerificationLogModel'],
    ['models/Notification', 'initNotificationModel'], ['models/OtpCode', 'initOtpCodeModel'], ['models/IdempotencyKey', 'initIdempotencyKeyModel'],
    ['models/Restaurant', 'initRestaurantModel'], ['models/MenuItem', 'initMenuItemModel'], ['models/Order', 'initOrderModel'],
    ['models/DeliveryPartner', 'initDeliveryPartnerModel'], ['models/MegaBasket', 'initMegaBasketModel'], ['models/MegaBasketItem', 'initMegaBasketItemModel'],
    ['models/Ticket', 'initTicketModel'], ['models/OrderMessage', 'initOrderMessageModel'], ['models/Coupon', 'initCouponModel'],
    ['models/WalletTransaction', 'initWalletTransactionModel'], ['models/RiderCashEntry', 'initRiderCashEntryModel'], ['models/Payout', 'initPayoutModel'],
    ['models/ProductReview', 'initProductReviewModel'],
  ]) r(m)[fn](sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  r('modules/autoRide').initAutoRideModels(sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Order.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  M.MegaBasket.hasMany(M.MegaBasketItem, { foreignKey: 'basketId', as: 'items' });
  M.MegaBasketItem.belongsTo(M.MegaBasket, { foreignKey: 'basketId', as: 'basket' });
  await sequelize.sync();
  await silent(() => r('modules/autoRide/migrations').runAutoRideMigrations(sequelize));
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.set('io', fakeIo);
  app.use('/legal', r('routes/legalRoutes'));
  app.use('/api/users/account', r('routes/accountRoutes'));
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/orders', r('routes/orderRoutes'));
  app.use('/api/delivery', r('routes/deliveryPartnerRoutes'));
  const ar = r('modules/autoRide/routes');
  app.use('/api/auto-ride/driver', ar.driverRouter);
  app.use('/api/auto-ride', ar.router);
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  ctx.server = server;
  ctx.base = `http://127.0.0.1:${server.address().port}`;
  ctx.M = (n) => sequelize.models[n];
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  try { await r('modules/autoRide/services/notify').idle(); } catch { /* optional */ }
  await new Promise((res) => setTimeout(res, 50));
  await new Promise((res) => ctx.server.close(() => res()));
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
  return { status: res.status, body: json, text };
};

let seq = 0;
const phone = () => `7${String(300000000 + (++seq) * 13 + (process.pid % 1000) * 1000).slice(-9)}`;
const tokenFor = (id, role, tv = 0) => jwt.sign({ id, role, tv }, process.env.JWT_SECRET);

const USER_PW = 'user-pass-123';
const mkUser = async ({ role = 'student' } = {}) => {
  const n = ++seq;
  const u = await ctx.M('User').create({ name: `C9 ${role} ${n}`, phone: phone(), role, isActive: true, password: USER_PW });
  u.token = tokenFor(u.id, role);
  return u;
};
const RIDER_PW = 'rider-pass-123';
const mkRider = async (extra = {}) => {
  const d = await ctx.M('DeliveryPartner').create({ name: `C9 Rider ${++seq}`, phone: phone(), password: RIDER_PW, isApproved: true, vehicleNumber: 'AP39AB1234', emergencyContact: '9876543210', photoUrl: 'https://example.test/me.jpg', bio: 'hello', ...extra });
  d.token = tokenFor(d.id, 'rider', Number(d.tokenVersion) || 0);
  return d;
};
const mkStore = async () => {
  const s = await ctx.M('Restaurant').create({ name: `C9 Store ${++seq}`, location: 'C9 block', isActive: true, password: 'storepass1' });
  s.token = tokenFor(s.id, 'restaurant');
  return s;
};
const mkOrder = async ({ user, store, rider = null, status = 'PickedUp' }) => ctx.M('Order').create({
  userId: user.id, restaurantId: store.id, deliveryPartnerId: rider ? rider.id : null, items: [], totalPrice: 100, deliveryFee: 10, finalPrice: 110,
  paymentMethod: 'COD', status,
});

const DRIVER_PW = 'driverpass123';
const mkDriver = async (extra = {}) => {
  const d = await ctx.M('AutoDriver').create({
    name: `C9 Driver ${++seq}`, phone: phone(), password: await bcrypt.hash(DRIVER_PW, 4), status: 'VERIFIED', tokenVersion: 0,
    emergencyContactName: 'Mom', emergencyContactPhone: '9876500000', licenceNumber: 'AP0120260001234', badgeNumber: 'B-77', ...extra,
  });
  d.token = tokenFor(d.id, 'auto_driver', 0);
  return d;
};

/** Stores a live SMS code exactly as POST /send-otp would (HMAC of phone:purpose:code). */
const seedOtp = async (phoneNo, purpose, code = '123456') => {
  const codeHash = crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${phoneNo}:${purpose}:${code}`).digest('hex');
  await ctx.M('OtpCode').create({ phone: phoneNo, purpose, codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return code;
};

module.exports = {
  setup, teardown, api, mkUser, mkRider, mkStore, mkOrder, mkDriver, seedOtp, tokenFor, silent, r, B,
  RIDER_PW, DRIVER_PW, USER_PW, get ctx() { return ctx; },
};
