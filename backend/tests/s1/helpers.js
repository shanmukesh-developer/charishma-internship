// S1 test harness: temp-file SQLite (WAL + busy_timeout), the real user / admin / rider / store / services
// routers behind the real App Check middleware on an ephemeral port, stubbed Firebase / pushes / mail.
// Never touches a real database or the network.
process.env.NODE_ENV = 'test';
// Delivery slots (utils/deliverySlots) gate riders and the store-accept clock by the time of day: these suites
// test the pre-slot flows, so slots are off unless a run asks for them (tests/slots turns them on itself).
if (process.env.DELIVERY_SLOTS === undefined) process.env.DELIVERY_SLOTS = 'off';
process.env.JWT_SECRET = 's1-security-test-secret-not-for-prod';
process.env.OTP_SECRET = 's1-security-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.APP_CHECK_MODE;
delete process.env.APP_CHECK_ENFORCE_GROUPS;
delete process.env.ADMIN_2FA_REQUIRED;
delete process.env.TOTP_ENC_KEY;
delete process.env.TOTP_ENC_KEY_OLD;

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
stub('utils/push.js', { sendPushToTokens: async () => ({ successCount: 0, failureCount: 0, staleTokens: [] }), sendPushToTopic: async () => {} });
stub('utils/mailer.js', { sendMail: async () => ({ ok: true }), sendVerificationCode: async () => ({ ok: true }), isMailerConfigured: () => false, parseSender: () => ({}) });
stub('utils/whatsappUtil.js', { sendWhatsAppMessage: async () => ({ success: true }), formatOrderMessage: () => '' });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

const fakeIo = {
  to: () => ({ emit() {}, socketsLeave() {}, socketsJoin() {} }),
  in: () => ({ emit() {}, socketsLeave() {}, socketsJoin() {}, fetchSockets: async () => [] }),
  emit() {},
  of: () => ({ to: () => ({ emit() {} }), in: () => ({ fetchSockets: async () => [] }), fetchSockets: async () => [] }),
  fetchSockets: async () => [],
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

let ctx = null;
const silent = async (fn) => {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `s1-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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
  for (const [m, fn] of [
    ['models/User', 'initUserModel'], ['models/GlobalConfig', 'initGlobalConfigModel'], ['models/VerificationLog', 'initVerificationLogModel'],
    ['models/Notification', 'initNotificationModel'], ['models/OtpCode', 'initOtpCodeModel'], ['models/SmsDailyCount', 'initSmsDailyCountModel'],
    ['models/Restaurant', 'initRestaurantModel'], ['models/MenuItem', 'initMenuItemModel'], ['models/DeliveryPartner', 'initDeliveryPartnerModel'],
    ['models/Order', 'initOrderModel'], ['models/MegaBasket', 'initMegaBasketModel'], ['models/MegaBasketItem', 'initMegaBasketItemModel'],
    ['models/ServiceBooking', 'initServiceBookingModel'],
  ]) r(m)[fn](sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Restaurant.hasMany(M.MenuItem, { foreignKey: 'restaurantId', as: 'menuItems' });
  M.MegaBasket.hasMany(M.MegaBasketItem, { foreignKey: 'basketId', as: 'items' });
  await sequelize.sync();
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.set('io', fakeIo);
  app.use(r('utils/appCheck').middleware());
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/delivery', r('routes/deliveryPartnerRoutes'));
  app.use('/api/restaurants', r('routes/restaurantRoutes'));
  app.use('/api/services', r('routes/serviceRoutes'));
  app.use('/api/admin', r('routes/adminRoutes'));
  app.use('/api/campus', r('modules/campus/campusRoutes'));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  ctx = { sequelize, server, base: `http://127.0.0.1:${server.address().port}`, file, M };
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
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
  const res = await fetch(ctx.base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body: json, headers: res.headers };
};

let seq = 0;
const phone = () => `7${String(200000000 + (++seq) * 13 + (process.pid % 1000) * 1000).slice(-9)}`;
const tokenFor = (id, role, extra = {}) => jwt.sign({ id, role, tv: 0, ...extra }, process.env.JWT_SECRET);

const mkUser = async ({ role = 'student', password = 'Passw0rd-s1' } = {}) => {
  const n = ++seq;
  const u = await ctx.M.User.create({ name: `S1 ${role} ${n}`, phone: phone(), role, isActive: true, isVerified: true, password, friendCode: `ZNV-S1${String(n).padStart(4, '0')}${process.pid % 100}` });
  u.plainPassword = password;
  u.token = tokenFor(u.id, role);
  return u;
};
const mkRider = async () => {
  const n = ++seq;
  const d = await ctx.M.DeliveryPartner.create({ name: `S1 Rider ${n}`, phone: phone(), password: `x-test-only-${n}`, isApproved: true, vehicleType: 'Bike', vehicleNumber: `AP39S1${String(n).padStart(4, '0')}` });
  d.token = tokenFor(d.id, 'rider');
  return d;
};
const mkStore = async () => {
  const n = ++seq;
  const s = await ctx.M.Restaurant.create({ name: `S1 Store ${n}`, location: 'S1 block', phone: phone(), password: `x-test-only-${n}`, isActive: true });
  s.token = tokenFor(s.id, 'restaurant');
  return s;
};

const clearAuthCache = (id) => r('middleware/authMiddleware').clearCachedUser(id);

module.exports = { setup, teardown, api, mkUser, mkRider, mkStore, tokenFor, silent, clearAuthCache, r, B, get ctx() { return ctx; } };
