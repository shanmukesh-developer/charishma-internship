// C7 test harness (rentals safety + Rent / Borrow wording): temp-file SQLite (WAL + busy_timeout), the
// real /api/rentals and /api/admin/rentals routers on an ephemeral port, stubbed Firebase / pushes (every
// push is recorded in `pushes`). Media rows are created straight in CampusMedia (the upload route has its
// own tests). Never touches a real database or the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'c7-rentals-test-secret-not-for-prod';
process.env.OTP_SECRET = 'c7-rentals-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;

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

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

const emitted = [];
const fakeIo = {
  to: (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }) }),
  emit: (ev, p) => emitted.push({ room: '*', ev, p }),
  in: () => ({ socketsJoin() {}, socketsLeave() {}, fetchSockets: async () => [] }),
  fetchSockets: async () => [],
  of: () => ({ fetchSockets: async () => [], in: () => ({ fetchSockets: async () => [] }) }),
  sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
};

let ctx = null;

async function silent(fn) {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

const setup = async () => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `c7-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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
  r('models/User').initUserModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  r('modules/rentals').initRentalsModels(sequelize);
  await sequelize.sync();
  const mig = await silent(() => r('modules/rentals/migrations').runRentalsMigrations(sequelize));
  if (mig.warn) throw new Error(`rentals migrations: ${mig.warn} warnings`);
  r('utils/realtime').init(fakeIo);
  r('modules/rentals/services/safety').resetCache();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.set('io', fakeIo);
  const routes = r('modules/rentals/routes');
  app.use('/api/rentals', routes.router);
  app.use('/api/admin/rentals', routes.adminRouter);
  const server = await require('../listenFree').listenFree(app);
  const M = (n) => sequelize.models[n];
  const campus = await M('Campus').create({ name: 'C7 Test Campus', code: `C7${process.pid % 10000}`, isActive: true });
  const campus2 = await M('Campus').create({ name: 'C7 Other Campus', code: `C7O${process.pid % 10000}`, isActive: true });
  ctx = { sequelize, server, base: `http://127.0.0.1:${server.address().port}`, file, M, campus, campus2, pushes, emitted };
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await new Promise((res) => setTimeout(res, 50)); // fire-and-forget pushes settle
  await new Promise((res) => ctx.server.close(() => res()));
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
const phone = () => `7${String(200000000 + (++seq) * 13 + (process.pid % 1000) * 1000).slice(-9)}`;

/** Verified student of `campus` (default: the test campus). role 'admin' -> admin without a campus. */
const mkUser = async ({ name, role = 'student', campus, verified = true } = {}) => {
  const n = ++seq;
  const u = await ctx.M('User').create({ name: name || `C7 ${role} ${n}`, phone: phone(), role, isActive: true, isVerified: true, password: `x-test-only-${n}-pw`, fcmTokens: [`tok-c7-${n}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`] });
  if (role !== 'admin') {
    await ctx.M('CampusProfile').create({ userId: u.id, campusId: (campus || ctx.campus).id, verificationStatus: verified ? 'verified' : 'pending', verifiedAt: new Date() });
  }
  u.token = jwt.sign({ id: u.id, role, tv: 0 }, process.env.JWT_SECRET);
  return u;
};

/** A media row owned by `user` (what POST /api/campus/media would create). Returns its short path. */
const media = async (user, purpose) => {
  const PRIVATE = ['rental_doc', 'rental_licence', 'rental_report', 'rental_condition'];
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(24)]);
  const row = await ctx.M('CampusMedia').create({ ownerId: user.id, purpose, mime: 'image/png', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), isPrivate: PRIVATE.includes(purpose), bytes });
  return `/api/campus/media/${row.id}`;
};
const photos = async (user, n, purpose = 'rental_condition') => Promise.all(Array.from({ length: n }, () => media(user, purpose)));

let plateSeq = 1000;
/** Approved listing (DB fixture) of `owner`. plateType PRIVATE (Borrow) or COMMERCIAL_RENTAL (Rent). */
const mkListing = async (owner, { plateType = 'PRIVATE', deposit = 1000, perHour = 50, perDay = 400, extraPerKm = 5, kmLimitPerDay = 100, campus, vehicleType = 'BIKE' } = {}) => {
  const docs = { rc: await media(owner, 'rental_doc'), insurance: await media(owner, 'rental_doc'), licence: await media(owner, 'rental_doc') };
  return ctx.M('RentalListing').create({
    ownerId: owner.id, campusId: (campus || ctx.campus).id, vehicleType, make: 'Honda', model: `Shine ${++plateSeq}`, year: 2022, fuel: 'PETROL',
    transmission: vehicleType === 'CAR' ? 'MANUAL' : null, seats: vehicleType === 'CAR' ? 5 : null,
    registrationNumber: `AP07AB${plateSeq}`, plateType, photos: [await media(owner, 'rental_photo')], documents: docs,
    pricePerHour: perHour, pricePerDay: perDay, securityDeposit: deposit, minHours: 1, kmLimitPerDay, extraPerKm,
    pickupLocation: 'Main gate', status: 'APPROVED', approvedAt: new Date(), weeklyHours: {}, blockedDates: [],
  });
};

let licSeq = 0;
/** Verified licence for `user` (MCWG + LMV, valid till 2035). */
const mkLicence = async (user, { expiresOn = '2035-12-31', status = 'VERIFIED', number } = {}) => ctx.M('RentalLicence').create({
  userId: user.id, licenceNumber: number || `TS09${String(process.pid).slice(-4)}${String(++licSeq).padStart(7, '0')}`,
  classes: ['MCWG', 'LMV'], verifiedClasses: status === 'VERIFIED' ? ['MCWG', 'LMV'] : null, frontImage: await media(user, 'rental_licence'),
  expiresOn, status, submittedAt: new Date(), reviewedAt: status === 'VERIFIED' ? new Date() : null,
});

// IST helpers for future booking windows.
const IST = 330 * 60 * 1000;
const istAt = (daysAhead, hh, mm = 0) => {
  const d = new Date(Date.now() + IST + daysAhead * 86400000).toISOString().slice(0, 10);
  return new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`).toISOString();
};
let dayCursor = 2;
/** A fresh 4-hour window on its own day (so tests never clash with each other). */
const nextWindow = () => { const d = dayCursor++; return { startAt: istAt(d, 10), endAt: istAt(d, 14) }; };

const resetLimits = () => r('modules/rentals/services/util').resetLimits();

/** Request (with terms) -> accept. Returns the booking row id + renter / owner views. */
const requestBooking = async (renter, listing, extra = {}) => {
  resetLimits();
  const w = nextWindow();
  return api('POST', '/api/rentals/bookings', renter.token, { listingId: listing.id, ...w, acceptTerms: true, ...extra });
};
const confirmed = async (owner, renter, listing, extra = {}) => {
  const c = await requestBooking(renter, listing, extra);
  if (c.status !== 201) throw new Error(`request failed ${c.status} ${JSON.stringify(c.body)}`);
  const a = await api('POST', `/api/rentals/bookings/${c.body.booking.id}/accept`, owner.token);
  if (a.status !== 200) throw new Error(`accept failed ${a.status} ${JSON.stringify(a.body)}`);
  return c.body.booking.id;
};
/** Moves a confirmed booking's window to "now" so the pickup step is allowed. */
const makeDue = (id) => ctx.M('RentalBooking').update({ startAt: new Date(Date.now() + 10 * 60000), endAt: new Date(Date.now() + 5 * 3600000) }, { where: { id } });
const pinsOf = async (id) => ctx.M('RentalBooking').findByPk(id, { attributes: ['pickupPin', 'returnPin'], raw: true });
const condition = async (user, id, stage, { n = 2, odometer = 1000, note } = {}) => api('POST', `/api/rentals/bookings/${id}/condition`, user.token, { stage, photos: await photos(user, n), ...(odometer === null ? {} : { odometer }), ...(note ? { note } : {}) });

/** Confirmed -> handover (with pickup photos) -> return (with return photos) -> RETURNED. */
const toReturned = async (owner, renter, listing, { pickupOdo = 1000, returnOdo = 1150 } = {}) => {
  const id = await confirmed(owner, renter, listing);
  await makeDue(id);
  const c1 = await condition(owner, id, 'PICKUP', { odometer: pickupOdo });
  if (c1.status !== 200) throw new Error(`pickup condition ${c1.status} ${JSON.stringify(c1.body)}`);
  let pins = await pinsOf(id);
  const h = await api('POST', `/api/rentals/bookings/${id}/handover`, owner.token, { pin: pins.pickupPin });
  if (h.status !== 200) throw new Error(`handover ${h.status} ${JSON.stringify(h.body)}`);
  const c2 = await condition(owner, id, 'RETURN', { odometer: returnOdo });
  if (c2.status !== 200) throw new Error(`return condition ${c2.status} ${JSON.stringify(c2.body)}`);
  pins = await pinsOf(id);
  const rt = await api('POST', `/api/rentals/bookings/${id}/return`, owner.token, { pin: pins.returnPin });
  if (rt.status !== 200) throw new Error(`return ${rt.status} ${JSON.stringify(rt.body)}`);
  return id;
};

const setSafety = (patch) => r('modules/rentals/services/safety').writeSettings(patch);
const settle = () => new Promise((res) => setTimeout(res, 30));

module.exports = {
  setup, teardown, api, mkUser, media, photos, mkListing, mkLicence, istAt, nextWindow, resetLimits, requestBooking, confirmed, makeDue,
  pinsOf, condition, toReturned, setSafety, settle, r, B, get ctx() { return ctx; },
};
