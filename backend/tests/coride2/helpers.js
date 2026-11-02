// Co-Ride 2 test harness: temp-file SQLite (WAL + busy_timeout), the real user / bike-pool / ride-template
// routers on an ephemeral port, stubbed Firebase and a recording push stub (every push lands in `pushes`).
// Never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'coride2-test-secret-not-for-prod';
process.env.OTP_SECRET = 'coride2-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.APP_CHECK_MODE;

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

const pushes = [];
stub('config/firebase.js', { apps: [], getApps: () => [] });
stub('utils/push.js', {
  sendPushToTokens: async (tokens, title, body, data = {}, opts = {}) => {
    pushes.push({ tokens, title, body, data, recipients: (opts && opts.recipients) || [] });
    return { successCount: 0, failureCount: 0, staleTokens: [] };
  },
  sendPushToTopic: async () => {},
});
const serverPath = require.resolve(path.join(B, 'server.js'));
require.cache[serverPath] = { id: serverPath, filename: serverPath, loaded: true, exports: { isSurgeActive: () => false } };

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

let ctx = null;
const dbPath = require.resolve(path.join(B, 'config/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {}, ensurePgOpenBookingIndex: async () => ({}), getPgOpenIndexState: () => ({}) } };

const fakeIo = {
  to: () => ({ emit() {}, socketsLeave() {}, socketsJoin() {} }),
  in: () => ({ emit() {}, socketsLeave() {}, socketsJoin() {}, fetchSockets: async () => [] }),
  emit() {},
  of: () => ({ to: () => ({ emit() {} }), in: () => ({ fetchSockets: async () => [] }), fetchSockets: async () => [] }),
  fetchSockets: async () => [],
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `coride2-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  const cm = sequelize.connectionManager;
  const origGet = cm.getConnection.bind(cm);
  const seen = new WeakSet();
  cm.getConnection = async (opts) => {
    const conn = await origGet(opts);
    if (!seen.has(conn)) { seen.add(conn); conn.configure('busyTimeout', 20000); }
    return conn;
  };
  await sequelize.query('PRAGMA journal_mode=WAL;');
  ctx = { sequelize, file, pushes };
  r('models/User').initUserModel(sequelize);
  r('models/BikePool').initBikePoolModel(sequelize);
  r('models/PoolRequest').initPoolRequestModel(sequelize);
  r('models/RideTemplate').initRideTemplateModel(sequelize);
  r('models/RideTemplateRun').initRideTemplateRunModel(sequelize);
  r('models/Ticket').initTicketModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  const M = sequelize.models;
  M.BikePool.belongsTo(M.User, { foreignKey: 'creatorId', as: 'creator' });
  M.BikePool.belongsTo(M.User, { foreignKey: 'coRiderId', as: 'coRider' });
  M.PoolRequest.belongsTo(M.BikePool, { foreignKey: 'poolId', as: 'pool' });
  M.BikePool.hasMany(M.PoolRequest, { foreignKey: 'poolId', as: 'requests' });
  M.PoolRequest.belongsTo(M.User, { foreignKey: 'passengerId', as: 'passenger' });
  M.Ticket.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  await sequelize.sync();
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json());
  app.set('io', fakeIo);
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/bikepool/templates', r('routes/rideTemplateRoutes'));
  app.use('/api/bikepool', r('routes/bikePoolRoutes'));
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

let seq = 0;
const phone = () => `8${String(300000000 + (++seq) * 17 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ role = 'student', gender = 'Prefer not to say', ...extra } = {}) => {
  const u = await ctx.M('User').create({ name: `Rider ${role} ${seq}`, phone: phone(), role, isActive: true, gender, password: `x-test-only-${seq}-pw`, fcmTokens: [`tok-${seq}-${'x'.repeat(30)}`], ...extra });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};

/** A ride straight in the database (bypasses the "departure ahead" rule for history fixtures). */
const mkRide = async (creatorId, extra = {}) => ctx.M('BikePool').create({
  creatorId, creatorRole: 'rider', origin: 'SRM AP Main Gate', destination: 'Vijayawada', departureTime: new Date(Date.now() + 3 * 3600 * 1000),
  vehicleType: 'Car', availableSeats: 3, status: 'Available', ...extra,
});

const templateBody = (extra = {}) => ({ origin: 'SRM AP Main Gate', destination: 'Benz Circle', days: [1, 3, 5], time: '17:30', vehicleType: 'car', seats: 3, estimatedFuelCost: 120, ...extra });

const tick = (ms = 50) => new Promise((res) => setTimeout(res, ms));

module.exports = { setup, teardown, api, mkUser, mkRide, templateBody, tick, r, B, pushes, get ctx() { return ctx; } };
