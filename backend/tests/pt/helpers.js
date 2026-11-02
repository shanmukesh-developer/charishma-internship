// Partner test logins harness: temp-file SQLite with every model the seed writes, the REAL partner auth routers
// (/api/delivery, /api/restaurants, /api/auto-ride/driver, /api/pg-owner) on an ephemeral port, stubbed Firebase /
// pushes / mail / WhatsApp and server module. Never touches a real database or the network.
process.env.NODE_ENV = 'test';
if (process.env.DELIVERY_SLOTS === undefined) process.env.DELIVERY_SLOTS = 'off';
process.env.JWT_SECRET = 'pt-partner-logins-test-secret-not-for-prod';
process.env.OTP_SECRET = 'pt-partner-logins-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.APP_CHECK_MODE;
delete process.env.DISABLE_PARTNER_TEST_ACCOUNTS;

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
stub('utils/push.js', { sendPushToTokens: async () => ({ successCount: 0, failureCount: 0, staleTokens: [] }), sendPushToTopic: async () => {} });
stub('utils/mailer.js', { sendMail: async () => ({ ok: true }), sendVerificationCode: async () => ({ ok: true }), isMailerConfigured: () => false, parseSender: () => ({}) });
stub('utils/whatsappUtil.js', { sendWhatsAppMessage: async () => ({ success: false }), formatOrderMessage: () => '' });

let ctx = null;
stub('config/db.js', { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {}, ensurePgOpenBookingIndex: async () => ({}), getPgOpenIndexState: () => ({}) });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const bcrypt = require(path.join(B, 'node_modules/bcryptjs'));

const fakeIo = {
  to: () => ({ emit() {}, socketsLeave() {}, socketsJoin() {} }),
  in: () => ({ emit() {}, socketsLeave() {}, socketsJoin() {}, fetchSockets: async () => [] }),
  emit() {},
  of: () => ({ to: () => ({ emit() {} }), in: () => ({ fetchSockets: async () => [] }), fetchSockets: async () => [] }),
  fetchSockets: async () => [],
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

const silent = async (fn) => {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `pt-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  ctx = { sequelize, file };
  for (const [m, fn] of [
    ['models/User', 'initUserModel'], ['models/GlobalConfig', 'initGlobalConfigModel'], ['models/VerificationLog', 'initVerificationLogModel'],
    ['models/Notification', 'initNotificationModel'], ['models/OtpCode', 'initOtpCodeModel'], ['models/IdempotencyKey', 'initIdempotencyKeyModel'],
    ['models/WalletTransaction', 'initWalletTransactionModel'],
    ['models/Restaurant', 'initRestaurantModel'], ['models/MenuItem', 'initMenuItemModel'], ['models/DeliveryPartner', 'initDeliveryPartnerModel'],
    ['models/Order', 'initOrderModel'],
    ['models/PGHostel', 'initPGHostelModel'], ['models/PGRoom', 'initPGRoomModel'], ['models/PGBooking', 'initPGBookingModel'],
    ['models/PGReview', 'initPGReviewModel'], ['models/PgPromotion', 'initPgPromotionModel'],
  ]) r(m)[fn](sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  r('modules/autoRide').initAutoRideModels(sequelize);
  r('modules/pgOwner').initPgOwnerModels(sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Order.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  M.Restaurant.hasMany(M.MenuItem, { foreignKey: 'restaurantId', as: 'menuItems' });
  M.MenuItem.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.PGHostel.belongsTo(M.User, { foreignKey: 'ownerId', as: 'owner' });
  M.PGHostel.hasMany(M.PGRoom, { foreignKey: 'hostelId', as: 'rooms' });
  M.PGRoom.belongsTo(M.PGHostel, { foreignKey: 'hostelId', as: 'hostel' });
  await sequelize.sync();
  const mig = await silent(() => r('modules/autoRide/migrations').runAutoRideMigrations(sequelize));
  if (mig && mig.warn) throw new Error('auto-ride migrations failed');
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.set('io', fakeIo);
  app.use('/api/delivery', r('routes/deliveryPartnerRoutes'));
  app.use('/api/restaurants', r('routes/restaurantRoutes'));
  const auto = r('modules/autoRide/routes');
  app.use('/api/auto-ride/driver', auto.driverRouter);
  app.use('/api/auto-ride', auto.router);
  const pgo = r('modules/pgOwner/routes');
  app.use('/api/pg-owner', pgo.ownerRouter);
  const server = await require('../listenFree').listenFree(app);
  Object.assign(ctx, { server, base: `http://127.0.0.1:${server.address().port}`, M });
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await new Promise((res) => setTimeout(res, 50));
  await new Promise((res) => ctx.server.close(() => res()));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`, `${ctx.file}-wal`, `${ctx.file}-shm`, ...tempDataFiles]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  tempDataFiles.length = 0;
  ctx = null;
};

const api = async (method, url, token, body) => {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(ctx.base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

const tempDataFiles = [];
const ACCOUNT_KEYS = ['rider', 'restaurant', 'vendorStall', 'campusStall', 'autoDriver', 'pgOwner'];

/**
 * A copy of the committed data file with fresh test-only passwords (the real ones are never in the repo),
 * written to a temp file. Returns { dataPath, passwords, data }.
 */
const testDataFile = () => {
  const real = JSON.parse(fs.readFileSync(r('scripts/partner_test_accounts_seed').DATA_PATH, 'utf8'));
  const data = JSON.parse(JSON.stringify(real));
  const passwords = {};
  for (const k of ACCOUNT_KEYS) {
    passwords[k] = `Pt${crypto.randomBytes(6).toString('hex')}9x`;
    data[k].passwordHash = bcrypt.hashSync(passwords[k], 4);
  }
  const dataPath = path.join(os.tmpdir(), `pt-data-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(dataPath, JSON.stringify(data));
  tempDataFiles.push(dataPath);
  return { dataPath, passwords, data };
};

/** Logs each account in through its app's real auth route; returns { key: { status, body } }. */
const loginAll = async (data, passwords) => ({
  rider: await api('POST', '/api/delivery/login', null, { phone: data.rider.phone, password: passwords.rider }),
  // Restaurant app sends { id, password, app: 'restaurant' } (the server reads a phone-like id as the phone).
  restaurant: await api('POST', '/api/restaurants/login', null, { id: data.restaurant.phone, password: passwords.restaurant, app: 'restaurant' }),
  // Vendor app and Campus Stall app send { phone, password, app: 'vendor' }.
  vendorStall: await api('POST', '/api/restaurants/login', null, { phone: data.vendorStall.phone, password: passwords.vendorStall, app: 'vendor' }),
  campusStall: await api('POST', '/api/restaurants/login', null, { phone: data.campusStall.phone, password: passwords.campusStall, app: 'vendor' }),
  autoDriver: await api('POST', '/api/auto-ride/driver/auth/login', null, { phone: data.autoDriver.phone, password: passwords.autoDriver }),
  pgOwner: await api('POST', '/api/pg-owner/auth/login', null, { phone: data.pgOwner.phone, password: passwords.pgOwner }),
});

const mkAdmin = async () => ctx.M.User.create({
  name: 'PT Admin', phone: '9000000001', role: 'admin', isActive: true, password: 'x-test-only-pt-admin-pw', friendCode: `ZNV-PT${process.pid % 10000}`,
});

module.exports = { setup, teardown, api, silent, testDataFile, loginAll, mkAdmin, ACCOUNT_KEYS, r, B, get ctx() { return ctx; } };
