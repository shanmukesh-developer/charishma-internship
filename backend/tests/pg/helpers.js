// PG test harness: temp-file SQLite, the real PG router (/api/pg) on an ephemeral port, stubbed Firebase /
// server module / pushes / WhatsApp. Never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'pg-content-test-secret-not-for-prod';
process.env.OTP_SECRET = 'pg-content-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.PUBLIC_API_URL;
delete process.env.MEDIA_STORAGE;

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
stub('utils/whatsappUtil.js', { sendWhatsAppMessage: async () => ({ success: false }) });

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
  const file = path.join(os.tmpdir(), `pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  ctx = { sequelize, file };
  r('models/User').initUserModel(sequelize);
  r('models/PGHostel').initPGHostelModel(sequelize);
  r('models/PGRoom').initPGRoomModel(sequelize);
  r('models/PGBooking').initPGBookingModel(sequelize);
  r('models/PGReview').initPGReviewModel(sequelize);
  r('models/PgPromotion').initPgPromotionModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('modules/campus/models/CampusMedia').initCampusMediaModel(sequelize);
  const M = sequelize.models;
  M.PGHostel.hasMany(M.PGRoom, { foreignKey: 'hostelId', as: 'rooms' });
  M.PGRoom.belongsTo(M.PGHostel, { foreignKey: 'hostelId', as: 'hostel' });
  await sequelize.sync();
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.set('io', fakeIo);
  app.use('/api/pg', r('routes/pgRoutes'));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  ctx.server = server;
  ctx.base = `http://127.0.0.1:${server.address().port}`;
  ctx.M = (n) => sequelize.models[n];
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await new Promise((res) => setTimeout(res, 50));
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
const phone = () => `9${String(500000000 + (++seq) * 23 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ role = 'student' } = {}) => {
  const u = await ctx.M('User').create({ name: `PG ${role} ${seq}`, phone: phone(), role, isActive: true, password: `x-test-only-${seq}-pw`, hostelBlock: null });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
/** A listing created through the real admin route; `ownerId` can then be pointed at another account. */
const mkPg = async (admin, extra = {}) => {
  const res = await api('POST', '/api/pg', admin.token, {
    name: `Test Residency ${++seq}`, address: 'Neerukonda, Amaravati', distanceFromCollege: 1.2, genderType: 'Boys', baseRent: 7500, securityDeposit: 10000,
    contactInfo: { ownerName: 'Owner', phone: '9000000001', lat: 16.4632, lng: 80.5064, internalNote: 'never public' },
    ...extra,
  });
  if (res.status !== 201) throw new Error(`pg create ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const mkRoom = async (admin, pgId, extra = {}) => {
  const res = await api('POST', `/api/pg/${pgId}/rooms`, admin.token, { roomNumber: `${++seq}`, sharingType: 2, pricePerBed: 8500, totalBeds: 2, availableBeds: 2, hasAC: true, ...extra });
  if (res.status !== 201) throw new Error(`room create ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
// Smallest valid PNG (1x1), as a data URL; `salt` changes the bytes so each one is a distinct upload.
const png = (salt = 0) => {
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  return `data:image/png;base64,${Buffer.concat([base, Buffer.from(`salt${salt}`)]).toString('base64')}`;
};
const auditRows = (action, targetId) => ctx.M('VerificationLog').findAll({ where: { action, ...(targetId ? { targetId: String(targetId) } : {}) }, raw: true });

module.exports = { setup, teardown, api, mkUser, mkPg, mkRoom, png, auditRows, r, get ctx() { return ctx; } };
