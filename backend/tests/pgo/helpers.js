// ZCS PG Partner test harness: temp-file SQLite, the real PG router (/api/pg) and the real PG owner routers
// (/api/pg-owner, /api/pg-tenant, /api/admin/pg-owners) on an ephemeral port. Firebase, the server module and
// WhatsApp are stubbed; pushes are RECORDED (push.calls) and still write the in-app Notification rows through
// the real utils/notificationStore (the customer notification path). Never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'pgo-test-secret-not-for-prod';
process.env.OTP_SECRET = 'pgo-test-otp-secret';
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

const push = { calls: [] };
stub('config/firebase.js', { apps: [], getApps: () => [] });
stub('server.js', { isSurgeActive: () => false });
stub('utils/push.js', {
  sendPushToTokens: async (tokens, title, body, data = {}, opts = {}) => {
    push.calls.push({ tokens, title, body, data, recipients: (opts && opts.recipients) || null });
    if (!opts || opts.persist !== false) {
      await require(path.join(B, 'utils/notificationStore')).recordNotifications({ userIds: opts && opts.recipients, tokens: [], title, body, data });
    }
    return { successCount: 0, failureCount: 0, staleTokens: [] };
  },
  sendPushToTopic: async () => {},
});
stub('utils/whatsappUtil.js', { sendWhatsAppMessage: async () => ({ success: false }) });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(B, 'node_modules/bcryptjs'));

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
  const file = path.join(os.tmpdir(), `pgo-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  ctx = { sequelize, file };
  r('models/User').initUserModel(sequelize);
  r('models/PGHostel').initPGHostelModel(sequelize);
  r('models/PGRoom').initPGRoomModel(sequelize);
  r('models/PGBooking').initPGBookingModel(sequelize);
  r('models/PGReview').initPGReviewModel(sequelize);
  r('models/PgPromotion').initPgPromotionModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('modules/campus/models/CampusMedia').initCampusMediaModel(sequelize);
  r('modules/pgOwner').initPgOwnerModels(sequelize);
  const M = sequelize.models;
  M.PGHostel.hasMany(M.PGRoom, { foreignKey: 'hostelId', as: 'rooms' });
  M.PGRoom.belongsTo(M.PGHostel, { foreignKey: 'hostelId', as: 'hostel' });
  await sequelize.sync();
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.set('io', fakeIo);
  app.use('/api/pg', r('routes/pgRoutes'));
  const pgo = r('modules/pgOwner/routes');
  app.use('/api/pg-owner', pgo.ownerRouter);
  app.use('/api/pg-tenant', pgo.tenantRouter);
  app.use('/api/admin/pg-owners', pgo.adminRouter);
  const server = await require('../listenFree').listenFree(app);
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
const phone = () => `9${String(400000000 + (++seq) * 37 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ role = 'student', name } = {}) => {
  const n = ++seq;
  const u = await ctx.M('User').create({ name: name || `Student${n} Tester`, phone: phone(), role, isActive: true, password: `x-test-only-${n}-pw`, hostelBlock: null, fcmTokens: [`fcm-token-for-user-${n}-${'x'.repeat(30)}`] });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const mkPg = async (admin, extra = {}) => {
  const res = await api('POST', '/api/pg', admin.token, {
    name: `Owner Test Residency ${++seq}`, address: 'Neerukonda, Amaravati', distanceFromCollege: 1.2, genderType: 'Boys', baseRent: 7500, securityDeposit: 10000,
    ...extra,
  });
  if (res.status !== 201) throw new Error(`pg create ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const mkRoom = async (admin, pgId, extra = {}) => {
  const res = await api('POST', `/api/pg/${pgId}/rooms`, admin.token, { roomNumber: `${100 + (++seq)}`, sharingType: 2, pricePerBed: 8500, totalBeds: 2, availableBeds: 2, hasAC: true, ...extra });
  if (res.status !== 201) throw new Error(`room create ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

const TEMP_PASSWORD = 'Temp1234pass';
const OWN_PASSWORD = 'MyOwnPass99';
/** Admin creates the owner (Plan B) and links listings; returns { owner, phone }. */
const adminCreateOwner = async (admin, hostelIds = [], extra = {}) => {
  const p = phone();
  const res = await api('POST', '/api/admin/pg-owners', admin.token, { name: `Owner ${seq} Reddy`, phone: p, password: TEMP_PASSWORD, hostelIds, ...extra });
  if (res.status !== 201) throw new Error(`owner create ${res.status} ${JSON.stringify(res.body)}`);
  return { owner: res.body.owner, phone: p };
};
/** Created + signed in + own password set: an owner ready to use the app. Returns { id, phone, token }. */
const readyOwner = async (admin, hostelIds = []) => {
  const { owner, phone: p } = await adminCreateOwner(admin, hostelIds);
  const login = await api('POST', '/api/pg-owner/auth/login', null, { phone: p, password: TEMP_PASSWORD });
  if (login.status !== 200) throw new Error(`owner login ${login.status} ${JSON.stringify(login.body)}`);
  const changed = await api('POST', '/api/pg-owner/auth/password', login.body.token, { currentPassword: TEMP_PASSWORD, newPassword: OWN_PASSWORD });
  if (changed.status !== 200) throw new Error(`owner password ${changed.status} ${JSON.stringify(changed.body)}`);
  return { id: owner.id, phone: p, token: changed.body.token };
};

/** A student's booking request through the real customer route. */
const book = async (student, roomId, body = {}) => {
  const ymd = new Date(Date.now() + 330 * 60 * 1000 + 3 * 86400000).toISOString().slice(0, 10);
  return api('POST', `/api/pg/${roomId}/book`, student.token, { checkInDate: ymd, ...body });
};

const notificationsFor = (userId) => ctx.M('Notification').findAll({ where: { userId: String(userId) }, order: [['createdAt', 'ASC']], raw: true });
const auditRows = (action) => ctx.M('VerificationLog').findAll({ where: { action }, raw: true });
const hash = (pw) => bcrypt.hashSync(pw, 4);

module.exports = {
  setup, teardown, api, mkUser, mkPg, mkRoom, adminCreateOwner, readyOwner, book, notificationsFor, auditRows, hash, push, r,
  TEMP_PASSWORD, OWN_PASSWORD, phone, get ctx() { return ctx; },
};
