// In-Campus Booking tests: the c5 harness (temp SQLite file, stubbed Firebase, real routes on an ephemeral
// port) plus the CampusBookings + CampusMedia models, the campus-booking routers and the campus media upload.
// Never touches a real database or the network.
const path = require('path');
const H = require('../c5/helpers');

const express = require(path.join(H.B, 'node_modules/express'));
const jwt = require(path.join(H.B, 'node_modules/jsonwebtoken'));

let server = null;
let base = null;

const setup = async () => {
  const ctx = await H.setup();
  if (!ctx.sequelize.models.CampusBooking) {
    H.r('modules/campus/models/CampusMedia').initCampusMediaModel(ctx.sequelize);
    H.r('modules/campusBooking').initCampusBookingModels(ctx.sequelize);
    await ctx.sequelize.sync();
    await H.r('modules/campusBooking/migrations').runCampusBookingMigrations(ctx.sequelize);
  }
  if (!server) {
    const routes = H.r('modules/campusBooking/routes');
    const { protect } = H.r('middleware/authMiddleware');
    const media = H.r('modules/campus/controllers/mediaController');
    const app = express();
    app.use(express.json({ limit: '8mb' }));
    app.post('/api/campus/media', protect, media.parseUpload, media.uploadMedia);
    app.get('/api/campus/media/:id', media.serveMedia);
    app.use('/api/campus-booking/documents', routes.docRouter);
    app.use('/api/campus-booking/vendor', routes.vendorRouter);
    app.use('/api/campus-booking', routes.router);
    app.use('/api/admin/campus-booking', routes.adminRouter);
    server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  H.r('modules/campusBooking/services/util').resetLimits();
  return ctx;
};

const teardown = async () => {
  await H.r('modules/campusBooking/services/notify').idle();
  if (server) await new Promise((res) => server.close(() => res()));
  server = null;
  await H.teardown();
};

const cb = async (method, url, token, body, headers = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

let n = 0;
/**
 * A campus stall (LOCAL_VENDOR) with In-Campus Booking on, a UPI ID and two items; token = its ZCS Vendor token.
 * hours default to open all day.
 */
const mkStall = async ({ enabled = true, upi = 'chaiadda@okaxis', prices = [20, 40], hours = { start: '00:00', end: '00:00' }, store = {} } = {}) => {
  n++;
  const st = await H.ctx.M('Restaurant').create({
    name: `CB Stall ${n}`, location: 'SRM AP Food Court', password: 'stallpass1', vendorType: 'LOCAL_VENDOR', campus: 'SRM',
    operatingHours: hours, isActive: true, isOpenNow: true, tags: ['bakery', 'snacks'],
    campusBookingEnabled: enabled, campusUpiId: upi, campusUpiName: `CB Stall ${n} Owner`, ...store,
  });
  const items = [];
  for (const [i, price] of prices.entries()) {
    items.push(await H.ctx.M('MenuItem').create({ restaurantId: st.id, name: `CB Item ${n}.${i + 1}`, price, isAvailable: true }));
  }
  st.token = jwt.sign({ id: st.id, role: 'restaurant', tv: 0 }, process.env.JWT_SECRET);
  return { store: st, items };
};

// 1x1 PNG (a real image: the media endpoint sniffs the bytes).
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/** Uploads a payment screenshot for `user` (purpose campus_payment) and returns its short path. */
const uploadProof = async (user, { purpose = 'campus_payment', variant = 0 } = {}) => {
  // Different bytes per call (the media table dedupes identical uploads per owner + purpose).
  const buf = Buffer.from(PNG_1PX.split(',')[1], 'base64');
  const padded = Buffer.concat([buf, Buffer.from(`zcs-test-${variant}-${Date.now()}-${Math.random()}`)]);
  const r = await cb('POST', '/api/campus/media', user.token, { image: `data:image/png;base64,${padded.toString('base64')}`, purpose });
  if (r.status !== 201 && r.status !== 200) throw new Error(`upload failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.url;
};

const book = (user, stall, lines, headers) => cb('POST', '/api/campus-booking/bookings', user.token, {
  stallId: stall.store.id,
  items: lines || [{ menuItemId: stall.items[0].id, quantity: 2 }],
}, headers);

module.exports = { ...H, H, setup, teardown, cb, mkStall, uploadProof, book, PNG_1PX, get ctx() { return H.ctx; } };
