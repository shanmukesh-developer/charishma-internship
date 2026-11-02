// C4 legal test harness: temp-file SQLite, the real /legal pages, admin legal-settings endpoints, the
// public /api/config/legal, customer register / Google-free flows, legal accept, rider + auto-driver
// sign-up, on an ephemeral port. Never touches a real database or the network (Firebase stubbed).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'c4-legal-test-secret-not-for-prod';
process.env.OTP_SECRET = 'c4-legal-test-otp-secret';
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

const fbPath = require.resolve(path.join(B, 'config/firebase.js'));
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { apps: [], getApps: () => [] } };

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

let ctx = null;

// controllers/userController registerUser uses config/db getSequelize(): point it at the test DB.
const dbPath = require.resolve(path.join(B, 'config/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {} } };

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `c4-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  ctx = { sequelize, file };
  r('models/User').initUserModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/OtpCode').initOtpCodeModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('models/DeliveryPartner').initDeliveryPartnerModel(sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  r('modules/autoRide').initAutoRideModels(sequelize);
  await sequelize.sync();
  const fakeIo = { to: () => ({ emit() {} }), emit() {}, in: () => ({ socketsJoin() {}, socketsLeave() {} }), fetchSockets: async () => [], of: () => ({ fetchSockets: async () => [] }) };
  r('utils/realtime').init(fakeIo);

  const { protect, admin } = r('middleware/authMiddleware');
  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  app.use('/legal', r('routes/legalRoutes'));
  app.use('/api/config', r('routes/appConfigRoutes'));
  const L = r('controllers/legalController');
  app.get('/api/admin/legal-settings', protect, admin, L.getAdminLegalSettings);
  app.put('/api/admin/legal-settings', protect, admin, L.updateAdminLegalSettings);
  app.post('/api/admin/config', protect, admin, r('controllers/adminController').updateGlobalConfig);
  const U = r('controllers/userController');
  app.post('/api/users/register', U.registerUser);
  app.post('/api/users/verify-otp', U.verifyOtp);
  app.get('/api/users/profile', protect, U.getUserProfile);
  app.get('/api/users/legal/status', protect, L.getMyLegalStatus);
  app.post('/api/users/legal/accept', protect, L.acceptTerms);
  app.post('/api/delivery/register', r('controllers/deliveryPartnerController').registerPartner);
  const DA = r('modules/autoRide/controllers/driverAuth');
  app.post('/api/auto-ride/driver/auth/register', async (req, res) => {
    try { await DA.register(req, res); } catch (e) { res.status(e.status || 500).json({ code: e.code, message: e.message }); }
  });

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
  for (const f of [ctx.file, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
};

const api = async (method, url, { token, body, headers = {} } = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(ctx.base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text, headers: res.headers };
};

let seq = 0;
const newPhone = () => `9${String(100000000 + (++seq) * 7 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async (role = 'student', extra = {}) => {
  const p = newPhone();
  const u = await ctx.M('User').create({ name: `C4 ${role}`, phone: p, role, isActive: true, password: `x-test-only-${p}`, ...extra });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const registrationToken = (phone) => jwt.sign({ purpose: 'register', phone }, `${process.env.JWT_SECRET}:phone-verified`, { expiresIn: '15m' });
/** Seeds a live SMS code (as POST /send-otp would) so OTP-only sign-ups can be tested without SMS. */
const seedOtp = async (phone, code = '123456', purpose = 'auth') => {
  const codeHash = crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${phone}:${purpose}:${code}`).digest('hex');
  await ctx.M('OtpCode').create({ phone, purpose, codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000), attempts: 0 });
  return code;
};

/** Writes LEGAL_SETTINGS straight to the DB (bypassing the admin API) and clears the caches. */
const setLegal = async (value) => {
  const legal = r('utils/legalSettings');
  if (value === null) await ctx.M('GlobalConfig').destroy({ where: { key: legal.KEY } });
  else await ctx.M('GlobalConfig').upsert({ key: legal.KEY, value });
  legal.clearCache();
  r('utils/responseCache').invalidate('config');
};
const setConfigRow = async (key, value) => {
  await ctx.M('GlobalConfig').upsert({ key, value });
  try { r('modules/autoRide/services/flag').clearCache(); } catch { /* optional */ }
  try { r('modules/campusEvents/services/flag').clearCache(); } catch { /* optional */ }
  try { await r('cron/retentionCron').getRetentionPolicy({ fresh: true }); } catch { /* optional */ }
};

const text = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').replace(/ ([:.,;])/g, '$1');

module.exports = { setup, teardown, api, mkUser, newPhone, registrationToken, seedOtp, setLegal, setConfigRow, text, r, B };
