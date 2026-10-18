// S0 test harness (privacy + abuse P1s): temp-file SQLite (WAL + busy_timeout), the real routers mounted on an
// ephemeral port, stubbed Firebase / pushes / mail, a fake socket.io that records emits / socketsLeave.
// Never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 's0-security-test-secret-not-for-prod';
process.env.OTP_SECRET = 's0-security-test-otp-secret';
process.env.AFTER_DARK_ALWAYS_OPEN = 'true';
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
const pushes = [];
stub('utils/push.js', {
  sendPushToTokens: async (tokens, title, body, data, opts = {}) => { pushes.push({ title, body, data, recipients: (opts.recipients || []).map(String) }); return { successCount: 0, failureCount: 0, staleTokens: [] }; },
  sendPushToTopic: async () => {},
});
stub('utils/mailer.js', { sendMail: async () => ({ ok: true }), sendVerificationCode: async () => ({ ok: true }), isMailerConfigured: () => false, parseSender: () => ({}) });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

const emitted = [];
const left = [];
const mkTarget = (ns, room) => ({
  emit: (ev, p) => emitted.push({ ns, room, ev, p }),
  socketsLeave: (rooms) => left.push({ ns, room, rooms: [].concat(rooms) }),
  socketsJoin() {},
  fetchSockets: async () => [],
});
const nsp = (ns) => ({
  to: (room) => mkTarget(ns, room),
  in: (room) => mkTarget(ns, room),
  emit: (ev, p) => emitted.push({ ns, room: '*', ev, p }),
  fetchSockets: async () => [],
  adapter: { rooms: new Map() },
});
const fakeIo = { ...nsp('/'), of: (n) => nsp(n), sockets: { adapter: { rooms: new Map() }, sockets: new Map() } };

let ctx = null;
async function silent(fn) {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `s0-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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
    ['models/Notification', 'initNotificationModel'], ['models/Conversation', 'initConversationModel'], ['models/Message', 'initMessageModel'],
    ['models/Friendship', 'initFriendshipModel'], ['models/Room', 'initRoomModel'], ['models/RoomParticipant', 'initRoomParticipantModel'],
    ['models/Restaurant', 'initRestaurantModel'], ['models/MenuItem', 'initMenuItemModel'], ['models/DeliveryPartner', 'initDeliveryPartnerModel'],
    ['models/Order', 'initOrderModel'], ['models/CommunityPost', 'initCommunityPostModel'], ['models/CommunityPostLike', 'initCommunityPostLikeModel'],
    ['models/MegaBasket', 'initMegaBasketModel'], ['models/MegaBasketItem', 'initMegaBasketItemModel'],
  ]) r(m)[fn](sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  r('modules/friends').initFriendsModels(sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Order.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  M.Restaurant.hasMany(M.MenuItem, { foreignKey: 'restaurantId', as: 'menuItems' });
  M.Room.hasMany(M.RoomParticipant, { foreignKey: 'roomId', as: 'participants' });
  M.RoomParticipant.belongsTo(M.Room, { foreignKey: 'roomId', as: 'room' });
  M.MegaBasket.hasMany(M.MegaBasketItem, { foreignKey: 'basketId', as: 'items' });
  M.MegaBasketItem.belongsTo(M.MegaBasket, { foreignKey: 'basketId', as: 'basket' });
  M.MegaBasket.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  M.MegaBasket.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
  await sequelize.sync();
  await silent(() => r('modules/friends/migrations/friendsMigrations').runFriendsMigrations(sequelize));
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.set('io', fakeIo);
  app.use('/api/users', r('routes/userRoutes'));
  app.use('/api/orders', r('routes/orderRoutes'));
  app.use('/api/mega-basket', r('routes/megaBasketRoutes'));
  app.use('/api/community', r('routes/communityRoutes'));
  app.use('/api/chat', r('routes/chatRoutes'));
  app.use('/api/friends', r('routes/friendRoutes'));
  app.use('/api/rooms', r('routes/roomRoutes'));
  app.use('/api/campus', r('modules/campus/campusRoutes'));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const campus = await M.Campus.create({ name: 'S0 Campus', code: `S0${process.pid % 10000}`, isActive: true });
  const campus2 = await M.Campus.create({ name: 'S0 Other Campus', code: `S0O${process.pid % 10000}`, isActive: true });
  ctx = { sequelize, server, base: `http://127.0.0.1:${server.address().port}`, file, M, campus, campus2, emitted, left, pushes, io: fakeIo };
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
  let json = null;
  if (ct.includes('json')) json = await res.json(); else json = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: json, headers: res.headers };
};

let seq = 0;
const phone = () => `8${String(300000000 + (++seq) * 17 + (process.pid % 1000) * 1000).slice(-9)}`;
const tokenFor = (id, role) => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET);

/** Student (verified member of `campus` unless campus === null). role 'admin' -> admin. */
const mkUser = async ({ name, role = 'student', campus, verified = true, profileImage = null } = {}) => {
  const n = ++seq;
  const u = await ctx.M.User.create({ name: name || `S0 ${role} ${n}`, phone: phone(), role, isActive: true, isVerified: true, password: `x-test-only-${n}-pw`, profileImage, friendCode: `ZNV-S0${String(n).padStart(4, '0')}${process.pid % 100}` });
  if (role !== 'admin' && campus !== null) {
    await ctx.M.CampusProfile.create({ userId: u.id, campusId: (campus || ctx.campus).id, verificationStatus: verified ? 'verified' : 'pending', verifiedAt: verified ? new Date() : null });
  }
  u.token = tokenFor(u.id, role);
  return u;
};
const mkRider = async () => {
  const n = ++seq;
  const d = await ctx.M.DeliveryPartner.create({ name: `S0 Rider ${n}`, phone: phone(), password: `x-test-only-${n}`, isApproved: true });
  d.token = tokenFor(d.id, 'rider');
  return d;
};
const mkStore = async (extra = {}) => {
  const n = ++seq;
  const s = await ctx.M.Restaurant.create({ name: `S0 Store ${n}`, location: 'S0 block', phone: phone(), password: `x-test-only-${n}`, isActive: true, ...extra });
  s.token = tokenFor(s.id, 'restaurant');
  return s;
};

const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(24)]);
/** A media row owned by `ownerId` (as POST /api/campus/media would create it). Returns its short path. */
const media = async (ownerId, purpose, isPrivate) => {
  const bytes = PNG();
  const priv = isPrivate === undefined ? r('utils/mediaAccess').PRIVATE_PURPOSES.has(purpose) : isPrivate;
  const row = await ctx.M.CampusMedia.create({ ownerId, purpose, mime: 'image/png', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), isPrivate: priv, bytes });
  return { id: row.id, path: `/api/campus/media/${row.id}` };
};
const pngDataUrl = () => `data:image/png;base64,${PNG().toString('base64')}`;

/** Fetches an absolute / relative media URL against the harness (follows nothing). */
const fetchMedia = async (url, token) => {
  const u = new URL(url, ctx.base);
  const res = await fetch(`${ctx.base}${u.pathname}${u.search}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'manual' });
  await res.arrayBuffer();
  return res.status;
};

const resetLimits = () => {
  r('modules/friends/services/limiter').reset();
};

module.exports = { setup, teardown, api, mkUser, mkRider, mkStore, media, pngDataUrl, fetchMedia, tokenFor, resetLimits, silent, r, B, get ctx() { return ctx; } };
