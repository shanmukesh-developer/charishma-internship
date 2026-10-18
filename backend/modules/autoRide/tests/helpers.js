// Shared harness for the Auto-Ride node:test suites. Each test file runs in its own process
// (node --test), gets its own temp-file SQLite database (WAL + busy_timeout, so transactions really
// run on separate connections), the real routers on an ephemeral port, a test JWT secret, a stubbed
// Firebase (no network, pushes are only recorded as in-app Notification rows) and an injectable clock.
// Never touches a real database.
// node-sqlite3 runs every statement (and its busy-wait) on the libuv thread pool: with the default 4
// threads, 5+ transactions waiting for the write lock starve the one holding it. The pool size is
// read once at process start, so tests/run.js (npm run test:autoride) starts node with 64.
if (Number(process.env.UV_THREADPOOL_SIZE || 4) < 32) console.warn('[autoride tests] run through `npm run test:autoride` (UV_THREADPOOL_SIZE=64) or the parallel races will crawl.');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'autoride-test-secret-not-for-prod';
process.env.OTP_SECRET = 'autoride-test-otp-secret';
delete process.env.DATABASE_URL;
delete process.env.AUTO_RIDE_DEV_ENABLE;

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..', '..');
const r = (rel) => require(path.join(B, rel));

// Firebase stub: utils/push sees "not initialised" and only records in-app notifications.
const fbPath = require.resolve(path.join(B, 'config/firebase.js'));
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { apps: [], getApps: () => [] } };

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(B, 'node_modules/bcryptjs'));

const clock = r('modules/autoRide/services/clock');
const BASE_TIME = Date.parse('2026-10-20T03:30:00.000Z'); // 09:00 IST
let nowMs = BASE_TIME;
clock.set(() => nowMs);
const advance = (ms) => { nowMs += ms; return new Date(nowMs); };
const setNow = (ms) => { nowMs = ms; };
const MIN = 60 * 1000;

const emitted = [];
const fakeIo = {
  to: (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }) }),
  emit: (ev, p) => emitted.push({ room: '*', ev, p }),
  in: () => ({ socketsJoin() {}, socketsLeave() {} }),
  fetchSockets: async () => [],
  of: () => ({ fetchSockets: async () => [] }),
};

let ctx = null;

const setup = async ({ label = 'autoride' } = {}) => {
  if (ctx) return ctx;
  const file = path.join(os.tmpdir(), `${label}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false, retry: { max: 10 } });
  // Sequelize's sqlite dialect opens one connection per transaction and never runs 'afterConnect'
  // hooks, so the pragmas are applied here on every new connection (busy_timeout is per connection).
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
  r('models/OtpCode').initOtpCodeModel(sequelize);
  r('models/IdempotencyKey').initIdempotencyKeyModel(sequelize);
  r('modules/campus/models').initCampusModels(sequelize);
  r('modules/autoRide').initAutoRideModels(sequelize);
  await sequelize.sync();
  const mig = await silent(() => r('modules/autoRide/migrations').runAutoRideMigrations(sequelize));
  if (mig.warn) throw new Error('auto-ride migrations failed');
  r('utils/realtime').init(fakeIo);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.set('io', fakeIo);
  const routes = r('modules/autoRide/routes');
  app.use('/api/auto-ride/driver', routes.driverRouter);
  app.use('/api/auto-ride', routes.router);
  app.use('/api/admin/auto-ride', routes.adminRouter);
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const M = (n) => sequelize.models[n];
  ctx = { sequelize, server, base, file, M };
  return ctx;
};

const teardown = async () => {
  if (!ctx) return;
  await r('modules/autoRide/services/notify').idle();
  await new Promise((res) => ctx.server.close(res));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-wal`, `${ctx.file}-shm`, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
};

async function silent(fn) {
  const o = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

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
const nextPhone = () => `9${String(100000000 + (++seq) + (process.pid % 1000) * 1000).slice(-9)}`;

const userToken = (u) => jwt.sign({ id: u.id, role: u.role || 'student', tv: Number(u.tokenVersion) || 0 }, process.env.JWT_SECRET);
const driverToken = (d) => jwt.sign({ id: d.id, role: 'auto_driver', tv: Number(d.tokenVersion) || 0 }, process.env.JWT_SECRET);

const mkUser = async ({ name = 'Test Student', role = 'student', wallet = 0, phone } = {}) => {
  const User = ctx.M('User');
  const p = phone || nextPhone();
  const u = await User.create({ name, phone: p, role, isActive: true, password: `x-test-only-${p}`, email: `${p}@test.local`, walletBalance: wallet });
  u.token = userToken(u);
  return u;
};
const mkAdmin = () => mkUser({ name: 'Test Admin', role: 'admin' });

const setFlag = async (on) => {
  await r('modules/autoRide/services/flag').writeFlag(!!on);
};
const setWallet = async (on) => r('modules/autoRide/services/flag').writeWalletFlag(!!on);

/** Route + pickup point straight in the DB (admin API is covered by its own tests). */
const mkRoute = async ({ name = 'Campus to Mangalagiri', destinationLabel = 'Mangalagiri', seatFareMin = 10, seatFareMax = 200, fullFareMin = 50, fullFareMax = 2000, operatingPeriods = [], minSeatsToDepartDefault = null } = {}) => {
  const route = await ctx.M('AutoRoute').create({ name, originLabel: 'SRM University-AP', destinationLabel, seatFareMin, seatFareMax, fullFareMin, fullFareMax, operatingPeriods, minSeatsToDepartDefault, isActive: true });
  const pickup = await ctx.M('AutoPickupPoint').create({ routeId: route.id, name: 'Main Gate Stand', landmark: 'Opposite the main gate', lat: 16.4625, lon: 80.5065, sequence: 1, isActive: true });
  return { route, pickup };
};

/** Verified, online driver with an approved auto of `capacity` seats (DB fixtures; never in production). */
const mkDriver = async ({ capacity = 8, rc, name = 'Ravi Kumar', online = true, status = 'VERIFIED', vehicleStatus = 'APPROVED' } = {}) => {
  const phone = nextPhone();
  const d = await ctx.M('AutoDriver').create({
    name, phone, password: await bcrypt.hash('Passw0rd!', 4), status, isOnline: online, tokenVersion: 0,
    licenceNumber: 'AP0120250001234', licenceExpiresOn: '2030-01-01', emergencyContactPhone: '9876500000',
    documents: {}, reviewedAt: status === 'VERIFIED' ? new Date() : null,
  });
  const reg = `AP07TA${String(++seq).padStart(4, '0')}`;
  const v = await ctx.M('AutoVehicle').create({
    driverId: d.id, registrationNumber: reg, make: 'Bajaj', model: 'RE Compact', fuel: 'CNG',
    rcSeatingCapacity: rc || capacity, requestedCapacity: capacity, approvedCapacity: vehicleStatus === 'APPROVED' ? capacity : null,
    seatLayout: vehicleStatus === 'APPROVED' ? r('modules/autoRide/services/layout').defaultLayout(capacity) : null,
    permitExpiresOn: '2030-01-01', insuranceExpiresOn: '2030-01-01', status: vehicleStatus, documents: {},
  });
  d.token = driverToken(d);
  return { driver: d, vehicle: v, token: d.token };
};

/** Publishes an open trip through the driver API. */
const mkTrip = async ({ capacity = 8, seatFare = 40, fullAutoFare = null, privateBookingEnabled = false, minSeatsToDepart, departInMin = 60, route, pickup, driver, seatSelectionEnabled = true, bookingOpensAt } = {}) => {
  const rp = route ? { route, pickup } : await mkRoute();
  const dv = driver || await mkDriver({ capacity });
  const body = {
    vehicleId: dv.vehicle.id, routeId: rp.route.id, pickupPointId: rp.pickup.id,
    departureAt: new Date(nowMs + departInMin * MIN).toISOString(), capacity, seatFare, fullAutoFare, privateBookingEnabled,
    seatSelectionEnabled, ...(minSeatsToDepart ? { minSeatsToDepart } : {}), ...(bookingOpensAt ? { bookingOpensAt } : {}),
  };
  const c = await api('POST', '/api/auto-ride/driver/trips', dv.token, body);
  if (c.status !== 201) throw new Error(`draft failed ${c.status} ${JSON.stringify(c.body)}`);
  const p = await api('POST', `/api/auto-ride/driver/trips/${c.body.trip.id}/publish`, dv.token);
  if (p.status !== 200) throw new Error(`publish failed ${p.status} ${JSON.stringify(p.body)}`);
  return { trip: p.body.trip, ...dv, ...rp };
};

/** Hold + confirm `seatCount` seats for a fresh user. */
const book = async (tripId, { seatCount = 1, seatNumbers, user, paymentMethod = 'CASH' } = {}) => {
  const u = user || await mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${tripId}/holds`, u.token, { seatCount, ...(seatNumbers ? { seatNumbers } : {}) });
  if (h.status !== 201 && h.status !== 200) return { user: u, hold: h };
  const c = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod });
  return { user: u, hold: h, confirm: c, booking: c.body && c.body.booking };
};

const notificationsFor = async (id) => {
  await r('modules/autoRide/services/notify').idle();
  return ctx.M('Notification').findAll({ where: { userId: String(id) }, order: [['createdAt', 'ASC']] });
};

/** Invariants that must hold for any trip at any time. */
const checkInvariants = async (tripId) => {
  const { Op } = require(path.join(B, 'node_modules/sequelize'));
  const trip = await ctx.M('AutoTrip').findByPk(tripId);
  const seats = await ctx.M('AutoSeat').findAll({ where: { tripId, status: { [Op.in]: ['HELD', 'CONFIRMED', 'BOARDED'] } } });
  const nums = seats.map((s) => s.seatNo);
  const problems = [];
  if (new Set(nums).size !== nums.length) problems.push('duplicate live seat');
  if (nums.some((n) => n < 1 || n > trip.capacity)) problems.push('seat outside capacity');
  if (seats.length > trip.capacity) problems.push('over capacity');
  const held = seats.filter((s) => s.status === 'HELD').length;
  const conf = seats.filter((s) => s.status !== 'HELD').length;
  if (held !== trip.seatsHeld || conf !== trip.seatsConfirmed) problems.push(`counter mismatch held ${held}/${trip.seatsHeld} conf ${conf}/${trip.seatsConfirmed}`);
  const bookings = await ctx.M('AutoBooking').findAll({ where: { tripId, status: { [Op.in]: ['HELD', 'CONFIRMED', 'BOARDED'] } } });
  const bySeatSum = bookings.reduce((a, b) => a + b.seatCount, 0);
  if (bySeatSum !== seats.length) problems.push(`booking seats ${bySeatSum} != live seat rows ${seats.length}`);
  const users = bookings.map((b) => b.userId);
  if (new Set(users).size !== users.length) problems.push('two live bookings for one user');
  if (trip.status === 'FULL' && conf !== trip.capacity) problems.push('FULL but not all confirmed');
  if (conf === trip.capacity && ['OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED'].includes(trip.status)) problems.push('all confirmed but not FULL');
  return { trip, problems };
};

module.exports = {
  setup, teardown, api, mkUser, mkAdmin, mkDriver, mkRoute, mkTrip, book, setFlag, setWallet, advance, setNow, BASE_TIME, MIN,
  emitted, notificationsFor, checkInvariants, userToken, driverToken, silent, r, nextPhone, get ctx() { return ctx; }, now: () => nowMs,
};
