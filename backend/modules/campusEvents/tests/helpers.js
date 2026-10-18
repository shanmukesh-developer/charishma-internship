// Shared harness for the Campus Events node:test suites (same pattern as modules/autoRide/tests/helpers.js).
// Each test file runs in its own process (node --test), gets its own temp-file SQLite database (WAL +
// busy_timeout, so transactions really run on separate connections), the real routers on an ephemeral
// port, a test JWT secret, a stubbed Firebase (pushes only recorded as in-app Notification rows), a stubbed
// Razorpay HTTP client and an injectable clock. Never touches a real database or the network.
if (Number(process.env.UV_THREADPOOL_SIZE || 4) < 32) console.warn('[campus events tests] run through `npm run test:events` (UV_THREADPOOL_SIZE=64) or the parallel races will crawl.');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'campus-events-test-secret-not-for-prod';
process.env.OTP_SECRET = 'campus-events-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.CAMPUS_EVENTS_DEV_ENABLE;
delete process.env.CAMPUS_EVENTS_TICKET_SECRET;
delete process.env.CAMPUS_EVENTS_ONLINE_PAY_ENABLED;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..', '..');
const r = (rel) => require(path.join(B, rel));

const fbPath = require.resolve(path.join(B, 'config/firebase.js'));
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { apps: [], getApps: () => [] } };

const { Sequelize, Op } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

const clock = r('modules/campusEvents/services/clock');
const BASE_TIME = Date.parse('2026-10-20T03:30:00.000Z'); // 09:00 IST
let nowMs = BASE_TIME;
clock.set(() => nowMs);
const advance = (ms) => { nowMs += ms; return new Date(nowMs); };
const setNow = (ms) => { nowMs = ms; };
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const emitted = [];
const fakeIo = {
  to: (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }) }),
  emit: (ev, p) => emitted.push({ room: '*', ev, p }),
  in: () => ({ socketsJoin() {}, socketsLeave() {} }),
  fetchSockets: async () => [],
  of: () => ({ fetchSockets: async () => [] }),
};

// Razorpay HTTP stub: records calls, answers like the real API.
const razorpayCalls = [];
let razorpayFail = false;
const razorpayHttp = {
  post: async (url, body) => {
    razorpayCalls.push({ url, body });
    if (razorpayFail) throw new Error('razorpay down (stub)');
    if (/\/orders$/.test(url)) return { data: { id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: body.amount, currency: 'INR' } };
    if (/\/refund$/.test(url)) return { data: { id: `rfnd_${crypto.randomBytes(6).toString('hex')}`, amount: body.amount } };
    throw new Error(`unexpected razorpay call ${url}`);
  },
};
const setRazorpayFail = (v) => { razorpayFail = !!v; };

let ctx = null;

async function silent(fn) {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

const setup = async ({ label = 'campusevents' } = {}) => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `${label}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  const cm = sequelize.connectionManager;
  const origGet = cm.getConnection.bind(cm);
  const seen = new WeakSet();
  cm.getConnection = async (opts) => {
    const conn = await origGet(opts);
    if (!seen.has(conn)) {
      seen.add(conn);
      conn.configure('busyTimeout', 20000);
      conn.run('PRAGMA synchronous=NORMAL;');
    }
    return conn;
  };
  await sequelize.query('PRAGMA journal_mode=WAL;');
  r('models/User').initUserModel(sequelize);
  r('models/WalletTransaction').initWalletTransactionModel(sequelize); // C5: wallet debits / refunds write ledger rows
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VerificationLog').initVerificationLogModel(sequelize);
  r('models/Notification').initNotificationModel(sequelize);
  r('models/IdempotencyKey').initIdempotencyKeyModel(sequelize);
  r('models/Friendship').initFriendshipModel(sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  // FriendsEntity (verified clubs) without loading the whole Friends module.
  r('modules/friends/models/foundation/social.js').init(sequelize);
  r('modules/campusEvents').initCampusEventsModels(sequelize);
  await sequelize.sync();
  const mig = await silent(() => r('modules/campusEvents/migrations').runCampusEventsMigrations(sequelize));
  if (mig.warn) throw new Error('campus events migrations failed');
  r('utils/realtime').init(fakeIo);
  r('modules/campusEvents/services/payments/razorpay').setHttp(razorpayHttp);

  const app = express();
  app.set('trust proxy', 1);
  const routes = r('modules/campusEvents/routes');
  // Same order as server.js: raw-body webhook before express.json.
  app.post(routes.WEBHOOK_PATH, express.raw({ type: '*/*', limit: '256kb' }), (req, res) => { req.rawBody = Buffer.isBuffer(req.body) ? req.body : null; return routes.razorpayWebhook(req, res); });
  app.use(express.json({ limit: '10mb' }));
  app.set('io', fakeIo);
  app.use('/api/campus-events/organizer', routes.organizerRouter);
  app.use('/api/campus-events/check-in', routes.checkInRouter);
  app.use('/api/campus-events', routes.router);
  app.use('/api/admin/campus-events', routes.adminRouter);
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const M = (n) => sequelize.models[n];
  ctx = { sequelize, server, base, file, M };
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await r('modules/campusEvents/services/notify').idle();
  await new Promise((res) => ctx.server.close(res));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-wal`, `${ctx.file}-shm`, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
};

const api = async (method, url, token, body, headers = {}) => {
  const h = { ...headers };
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
const nextPhone = () => `8${String(100000000 + (++seq) + (process.pid % 1000) * 1000).slice(-9)}`;
const userToken = (u) => jwt.sign({ id: u.id, role: u.role || 'student', tv: Number(u.tokenVersion) || 0 }, process.env.JWT_SECRET);

let campusDefault = null;
const mkCampus = async (name = 'SRM University-AP') => ctx.M('Campus').create({ name, code: `C${crypto.randomBytes(3).toString('hex')}`.toUpperCase(), isActive: true });
const campus = async () => { if (!campusDefault) campusDefault = await mkCampus(); return campusDefault; };

/** Student with a campus profile (verified by default). */
const mkStudent = async ({ name = 'Test Student', verified = true, year = 2, branch = 'CSE', isAdult = true, wallet = 0, campusRow, role = 'student', noProfile = false } = {}) => {
  const p = nextPhone();
  const u = await ctx.M('User').create({ name, phone: p, role, isActive: true, password: `x-test-only-${p}`, email: `${p}@test.local`, walletBalance: wallet });
  if (!noProfile) {
    const c = campusRow || await campus();
    await ctx.M('CampusProfile').create({ userId: u.id, campusId: c.id, verificationStatus: verified ? 'verified' : 'unverified', year, branch, isAdult });
  }
  u.token = userToken(u);
  return u;
};
const mkAdmin = () => mkStudent({ name: 'Test Admin', role: 'admin' });

const setFlag = (on) => r('modules/campusEvents/services/flag').writeFlag(!!on);
const setWallet = (on) => r('modules/campusEvents/services/flag').writeWalletFlag(!!on);

/** ACTIVE organizer (DB grant; the admin grant API has its own tests). */
const mkOrganizer = async (opts = {}) => {
  const u = await mkStudent({ name: 'Club Organizer', ...opts });
  const prof = await ctx.M('CampusProfile').findOne({ where: { userId: u.id } });
  await ctx.M('CeOrganizer').create({ userId: u.id, campusId: prof ? prof.campusId : null, displayName: 'Robotics Club', status: 'ACTIVE', grantedAt: new Date() });
  return u;
};

let adminUser = null;
const admin = async () => { if (!adminUser) adminUser = await mkAdmin(); return adminUser; };

/**
 * Creates + submits + approves an event through the real APIs. Returns { event, organizer, slots }.
 * Times are relative to the injected clock: starts in startInH hours, registration open now.
 */
const mkEvent = async ({ organizer, format = 'INDIVIDUAL', capacity = 10, startInH = 72, durationH = 3, priceType = 'FREE', price = 0, paymentModes, slots = [], approve = true, ...extra } = {}) => {
  const org = organizer || await mkOrganizer();
  const startAt = new Date(nowMs + startInH * HOUR);
  const body = {
    title: extra.title || `Test ${format} event ${++seq}`, category: extra.category || (format === 'TEAM' ? 'TOURNAMENT' : 'WORKSHOP'),
    description: 'A real-looking test description.', venue: extra.venue || 'Main Auditorium', startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + durationH * HOUR).toISOString(), format, priceType, price,
    ...(format === 'INDIVIDUAL' ? { capacity } : {}),
    ...(paymentModes ? { paymentModes } : {}),
    ...extra,
  };
  delete body.title_; // noop
  const c = await api('POST', '/api/campus-events/organizer/events', org.token, body);
  if (c.status !== 201) throw new Error(`create failed ${c.status} ${JSON.stringify(c.body)}`);
  const id = c.body.event.id;
  let slotRows = [];
  if (format === 'SLOT') {
    const list = slots.length ? slots : [{ startOffsetH: 0, durationH: 1, capacity }];
    const s = await api('POST', `/api/campus-events/organizer/events/${id}/slots`, org.token, {
      slots: list.map((x, i) => ({ label: x.label || `Slot ${i + 1}`, startAt: new Date(startAt.getTime() + (x.startOffsetH || 0) * HOUR).toISOString(), endAt: new Date(startAt.getTime() + ((x.startOffsetH || 0) + (x.durationH || 1)) * HOUR).toISOString(), capacity: x.capacity || capacity, ...(x.price !== undefined ? { price: x.price } : {}) })),
    });
    if (s.status !== 201) throw new Error(`slots failed ${s.status} ${JSON.stringify(s.body)}`);
    slotRows = s.body.slots;
  }
  if (!approve) return { event: c.body.event, organizer: org, slots: slotRows };
  const sub = await api('POST', `/api/campus-events/organizer/events/${id}/submit`, org.token);
  if (sub.status !== 200) throw new Error(`submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
  const a = await api('POST', `/api/admin/campus-events/events/${id}/approve`, (await admin()).token, {});
  if (a.status !== 200) throw new Error(`approve failed ${a.status} ${JSON.stringify(a.body)}`);
  return { event: a.body.event, organizer: org, slots: slotRows };
};

const register = (eventId, user, body = {}) => api('POST', `/api/campus-events/${eventId}/register`, user.token, { acceptRules: true, rulesVersion: 1, ...body });

const notificationsFor = async (id) => {
  await r('modules/campusEvents/services/notify').idle();
  return ctx.M('Notification').findAll({ where: { userId: String(id) }, order: [['createdAt', 'ASC']] });
};
const idle = () => r('modules/campusEvents/services/notify').idle();

/** Capacity invariants for an event at any moment. */
const checkInvariants = async (eventId) => {
  const ev = await ctx.M('CeEvent').findByPk(eventId);
  const live = ['HELD', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'OFFERED'];
  const regs = await ctx.M('CeRegistration').findAll({ where: { eventId, status: { [Op.in]: live } } });
  const problems = [];
  const pools = new Map();
  for (const g of regs) {
    const k = String(g.capacityKey);
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k).push(g);
  }
  const slots = await ctx.M('CeSlot').findAll({ where: { eventId } });
  const capOf = (k) => {
    const s = slots.find((x) => String(x.id) === k);
    if (s) return s.capacity;
    return ev.format === 'TEAM' ? ev.maxTeams : ev.capacity;
  };
  for (const [k, list] of pools) {
    const units = list.map((g) => g.unitNo);
    if (units.some((u) => u === null || u < 1 || u > capOf(k))) problems.push(`unit outside capacity in ${k}`);
    if (new Set(units).size !== units.length) problems.push(`duplicate unit in ${k}`);
    if (list.length > capOf(k)) problems.push(`over capacity in ${k}`);
    const users = list.filter((g) => !g.teamId).map((g) => g.userId);
    if (new Set(users).size !== users.length) problems.push(`two live registrations for one student in ${k}`);
  }
  if (ev.format !== 'SLOT' && Number(ev.unitsLive) !== regs.length) problems.push(`counter unitsLive ${ev.unitsLive} != ${regs.length}`);
  for (const s of slots) {
    const n = (pools.get(String(s.id)) || []).length;
    if (Number(s.unitsLive) !== n) problems.push(`slot counter ${s.unitsLive} != ${n}`);
  }
  const confirmed = regs.filter((g) => g.status === 'CONFIRMED');
  const tickets = await ctx.M('CeTicket').findAll({ where: { eventId, status: { [Op.in]: ['ACTIVE', 'USED'] } } });
  for (const g of confirmed) if (!tickets.some((tk) => String(tk.registrationId) === String(g.id))) problems.push(`confirmed ${g.code} without ticket`);
  for (const tk of tickets) {
    const g = await ctx.M('CeRegistration').findByPk(tk.registrationId);
    if (!g || g.status !== 'CONFIRMED') problems.push(`live ticket on ${g ? g.status : 'missing'} registration`);
  }
  return { event: ev, problems };
};

/** Razorpay webhook call with a real signature over the raw body. */
const webhook = async (payload, { secret = process.env.RAZORPAY_WEBHOOK_SECRET, eventId = `evt_${crypto.randomBytes(6).toString('hex')}`, badSig = false } = {}) => {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = badSig ? 'deadbeef'.repeat(8) : crypto.createHmac('sha256', String(secret || 'x')).update(raw).digest('hex');
  const res = await fetch(`${ctx.base}/api/campus-events/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': eventId }, body: raw });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, eventId };
};
const configureRazorpay = async (on = true) => {
  if (on) {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
    process.env.RAZORPAY_KEY_SECRET = 'test-secret-dummy';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec-test-dummy';
    process.env.CAMPUS_EVENTS_ONLINE_PAY_ENABLED = '1';
  } else {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET; delete process.env.RAZORPAY_WEBHOOK_SECRET; delete process.env.CAMPUS_EVENTS_ONLINE_PAY_ENABLED;
  }
};

const runJobs = () => r('modules/campusEvents/jobs').runCampusEventJobs(clock.now());

module.exports = {
  setup, teardown, api, mkStudent, mkAdmin, admin, mkOrganizer, mkEvent, mkCampus, campus, register, setFlag, setWallet, advance, setNow,
  BASE_TIME, MIN, HOUR, DAY, emitted, notificationsFor, idle, checkInvariants, userToken, silent, r, webhook, configureRazorpay,
  razorpayCalls, setRazorpayFail, runJobs, Op, get ctx() { return ctx; }, now: () => nowMs,
};
