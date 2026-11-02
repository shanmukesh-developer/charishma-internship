// Splash ads test harness: temp-file SQLite, the real ad routers (/api/ads, /api/admin/splash-ads) on an
// ephemeral port, stubbed Firebase / server module / pushes / WhatsApp / mail. Never touches a real database
// or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'splash-ads-test-secret-not-for-prod';
process.env.OTP_SECRET = 'splash-ads-test-otp-secret';
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
stub('utils/mailer.js', { sendMail: async () => ({ ok: true }), sendVerificationCode: async () => ({ ok: true }), isMailerConfigured: () => false, parseSender: () => ({}) });

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
  const file = path.join(os.tmpdir(), `ads-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  ctx = { sequelize, file };
  r('models/User').initUserModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/SplashAd').initSplashAdModel(sequelize);
  r('modules/campus/models/CampusMedia').initCampusMediaModel(sequelize);
  await sequelize.sync();
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.set('io', fakeIo);
  const ads = r('routes/adRoutes');
  app.use('/api/ads', ads.router);
  app.use('/api/admin/splash-ads', ads.adminRouter);
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
  return { status: res.status, body: json, headers: res.headers };
};

let seq = 0;
const phone = () => `9${String(600000000 + (++seq) * 29 + (process.pid % 1000) * 1000).slice(-9)}`;
const mkUser = async ({ role = 'student' } = {}) => {
  const u = await ctx.M('User').create({ name: `Ads ${role} ${seq}`, phone: phone(), role, isActive: true, password: `x-test-only-${seq}-pw`, hostelBlock: null });
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};
const mkStore = async (extra = {}) => {
  const n = ++seq;
  return ctx.M('Restaurant').create({
    name: `Ads Kitchen ${n}`, location: 'Block A', phone: phone(), password: `x-test-only-${n}`, isActive: true,
    imageUrl: `https://images.unsplash.com/photo-store-${n}?w=800`, tags: ['Biryani', 'North Indian', 'Desserts'], rating: 4.4,
    campusUpiId: 'secret@upi', pan: 'ABCDE1234F', payoutUpiId: 'payout@upi', commissionRate: 12,
    ...extra,
  });
};
const mkItem = (storeId, extra = {}) => ctx.M('MenuItem').create({ restaurantId: storeId, name: `Dish ${++seq}`, price: 150, isAvailable: true, ownerPhone: '9000000000', ...extra });

/** A valid admin create body for `store`. */
const adBody = (store, extra = {}) => ({
  restaurantId: store.id, style: 'tear', offerText: '20% OFF', headline: 'Biryani that\nbreaks the rules', subline: 'Only today, on every order', bannerText: 'Sponsored by the kitchen',
  imageUrl: 'https://images.unsplash.com/photo-ad-1?w=1200', colorA: '#7D2C12', colorB: '#120805', priority: 0, isActive: true,
  ...extra,
});
const dropAds = async () => {
  await ctx.M('SplashAd').destroy({ where: {} });
  r('utils/responseCache').invalidate('ads');
};

module.exports = { setup, teardown, api, mkUser, mkStore, mkItem, adBody, dropAds, r, get ctx() { return ctx; } };
