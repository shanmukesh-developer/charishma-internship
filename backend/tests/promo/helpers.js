// Promoter attribution test harness: temp-file SQLite, the real customer register / verify-otp / login
// controllers, the promo public + admin routers and the /p/<CODE> short link on an ephemeral port. Firebase is
// stubbed; never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'promo-test-secret-not-for-prod';
process.env.OTP_SECRET = 'promo-test-otp-secret';
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
const dbPath = require.resolve(path.join(B, 'config/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {} } };

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `promo-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  ctx = { sequelize, file };
  r('models/User').initUserModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/OtpCode').initOtpCodeModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('models/Promoter').initPromoterModels(sequelize);
  await sequelize.sync();
  const fakeIo = { to: () => ({ emit() {} }), emit() {}, in: () => ({ socketsJoin() {}, socketsLeave() {} }), fetchSockets: async () => [], of: () => ({ fetchSockets: async () => [] }) };
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  const U = r('controllers/userController');
  app.post('/api/users/register', U.registerUser);
  app.post('/api/users/verify-otp', U.verifyOtp);
  app.post('/api/users/login', U.authUser);
  const P = r('routes/promoRoutes');
  app.get('/p/:code', ...P.shortLink);
  app.use('/api/promo', P.publicRouter);
  app.use('/api/admin/promoters', P.adminRouter);

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
const newPhone = () => `9${String(300000000 + (++seq) * 7 + (process.pid % 1000) * 1000).slice(-9)}`;
const newDevice = () => `test-android-id-${crypto.randomBytes(6).toString('hex')}`;
const mkUser = async (role = 'student', extra = {}) => {
  const p = newPhone();
  const u = await ctx.M('User').create({ name: `Promo ${role}`, phone: p, role, isActive: true, password: `x-test-only-${p}`, ...extra });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const registrationToken = (phone) => jwt.sign({ purpose: 'register', phone }, `${process.env.JWT_SECRET}:phone-verified`, { expiresIn: '15m' });
const register = (phone, extra = {}) => api('POST', '/api/users/register', { body: { name: 'Promo Test', phone, registrationToken: registrationToken(phone), acceptTerms: true, ...extra } });
const referrerFor = (code) => `utm_source=promo&utm_campaign=${code}`;
const attribute = (deviceId, referrer) => api('POST', '/api/promo/attribute', { body: { deviceId, referrer } });

let admin = null;
const adminToken = async () => { if (!admin) admin = await mkUser('admin'); return admin.token; };
let codeSeq = 0;
const mkPromoter = async (extra = {}) => {
  const res = await api('POST', '/api/admin/promoters', { token: await adminToken(), body: { name: 'Ravi Kumar', code: `PRM${process.pid % 1000}X${++codeSeq}`, ...extra } });
  if (res.status !== 201) throw new Error(`mkPromoter ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const stats = async (id) => {
  const res = await api('GET', '/api/admin/promoters', { token: await adminToken() });
  return res.body.promoters.find((p) => p.id === id);
};

module.exports = { setup, teardown, api, mkUser, newPhone, newDevice, register, registrationToken, referrerFor, attribute, adminToken, mkPromoter, stats, r, B, get ctx() { return ctx; } };
