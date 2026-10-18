// C3 force-update test harness: temp-file SQLite, the real gate (utils/appVersionPolicy.gate) in front of
// the real config / admin routers on an ephemeral port, a real socket.io server with the real socketGate.
// Never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'c3-force-update-test-secret-not-for-prod';
delete process.env.DATABASE_URL;
delete process.env.RENDER;

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
const { Server } = require(path.join(B, 'node_modules/socket.io'));

let ctx = null;

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `c3-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/User').initUserModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/AppConfig').initAppConfigModel(sequelize);
  await sequelize.sync();
  const fakeIo = { to: () => ({ emit() {} }), emit() {}, in: () => ({ socketsJoin() {}, socketsLeave() {} }), fetchSockets: async () => [] };
  r('utils/realtime').init(fakeIo);

  const avp = r('utils/appVersionPolicy');
  const { protect, admin } = r('middleware/authMiddleware');
  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  app.get('/api/health', (req, res) => res.json({ status: 'online' }));
  // Same position as server.js: after body parsing, before every router.
  app.use('/api', avp.gate);
  app.use('/api/config', r('routes/appConfigRoutes'));
  const c = r('controllers/appVersionController');
  app.get('/api/admin/app-versions', protect, admin, c.getAdminAppVersions);
  app.put('/api/admin/app-versions', protect, admin, c.updateAdminAppVersions);
  app.post('/api/admin/config', protect, admin, r('controllers/adminController').updateGlobalConfig);
  // Stand-ins for ordinary / allow-listed app routes (the gate is what is under test).
  const ok = (req, res) => res.json({ ok: true, path: req.originalUrl });
  app.get('/api/orders/mine', ok);
  app.post('/api/orders', ok);
  app.get('/api/restaurants', ok);
  app.post('/api/users/logout', ok);
  app.post('/api/users/send-otp', ok);
  app.post('/api/users/fcm-token/remove', ok);
  app.get('/api/users/account/deletion-check', ok);
  app.post('/api/users/account/delete', ok);
  app.get('/api/auto-ride/driver/me', ok);

  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const io = new Server(server, { transports: ['websocket'] });
  io.use(avp.socketGate);
  const base = `http://127.0.0.1:${server.address().port}`;
  ctx = { sequelize, server, io, base, file, M: (n) => sequelize.models[n], avp };
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await new Promise((res) => ctx.io.close(() => res()));
  await new Promise((res) => ctx.server.close(() => res()));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
};

const api = async (method, url, { token, body, headers = {} } = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(ctx.base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
};

let seq = 0;
const mkUser = async (role = 'student') => {
  const p = `9${String(100000000 + (++seq) + (process.pid % 1000) * 1000).slice(-9)}`;
  const u = await ctx.M('User').create({ name: `C3 ${role}`, phone: p, role, isActive: true, password: `x-test-only-${p}`, email: `${p}@test.local` });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};

const app = (name, version, build) => {
  const h = { 'X-App-Name': name };
  if (version !== undefined) h['X-App-Version'] = version;
  if (build !== undefined) h['X-App-Build'] = String(build);
  return h;
};

/** Writes the policy straight to the DB (bypassing the admin API) and clears the cache. */
const setPolicy = async (value) => {
  if (value === null) await ctx.M('GlobalConfig').destroy({ where: { key: ctx.avp.POLICY_KEY } });
  else await ctx.M('GlobalConfig').upsert({ key: ctx.avp.POLICY_KEY, value });
  ctx.avp.clearCache();
  r('utils/responseCache').invalidate('config');
};

module.exports = { setup, teardown, api, mkUser, app, setPolicy, r, B };
