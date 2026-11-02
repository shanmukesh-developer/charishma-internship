// Rider-jobs dispatch tests (utils/riderJobs): the delivery-slot harness (c5: real order / rider / admin routes on
// a temp SQLite file, stubbed Firebase, Mega Basket routes) plus the services router, a recording FCM client
// (every multicast: tokens, data, Android channel) and helpers to read the socket emits. Never touches a real
// database or the network.
const path = require('path');
const T = require('../slots/helpers');

const { H } = T;
const express = require(path.join(H.B, 'node_modules/express'));
const jwt = require(path.join(H.B, 'node_modules/jsonwebtoken'));

const fcm = [];
let svcServer = null;
let svcBase = null;

const setup = async () => {
  const ctx = await T.setup();
  if (!ctx.sequelize.models.ServiceBooking) {
    H.r('models/ServiceBooking').initServiceBookingModel(ctx.sequelize);
    await ctx.sequelize.sync();
  }
  if (!svcServer) {
    const io = {
      to: (room) => ({ emit: (ev, p) => ctx.emitted.push({ room, ev, p }) }),
      emit: (ev, p) => ctx.emitted.push({ room: '*', ev, p }),
      in: () => ({ socketsJoin() {}, socketsLeave() {} }),
    };
    const app = express();
    app.use(express.json());
    app.set('io', io);
    app.use('/api/services', H.r('routes/serviceRoutes'));
    app.use('/api/mega-basket', H.r('routes/megaBasketRoutes'));
    svcServer = await require('../listenFree').listenFree(app);
    svcBase = `http://127.0.0.1:${svcServer.address().port}`;
  }
  H.r('utils/push')._setMessaging(() => ({
    sendEachForMulticast: async (m) => {
      fcm.push({ tokens: m.tokens, title: m.notification.title, body: m.notification.body, data: m.data, channel: m.android && m.android.notification && m.android.notification.channelId });
      return { successCount: m.tokens.length, failureCount: 0, responses: m.tokens.map(() => ({})) };
    },
    send: async () => 'ok',
  }));
  return ctx;
};

const teardown = async () => {
  H.r('utils/push')._setMessaging(null);
  if (svcServer) await new Promise((res) => svcServer.close(() => res()));
  svcServer = null;
  await T.teardown();
};

// Same shape as H.api, against the services + mega-basket server (it has a socket stand-in).
const api = async (method, url, token, body) => {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(svcBase + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

let n = 0;
const tok = (who) => `tok_${who}_${++n}_${'x'.repeat(40)}`;
/** Approved rider, on duty (fresh GPS fix) unless online:false, with one device token. */
const mkRider = async ({ online = true, approved = true } = {}) => {
  const r = await H.mkRider();
  r.pushToken = tok('rider');
  await r.update({ isOnline: online, isApproved: approved, fcmTokens: [{ token: r.pushToken }], liveLocation: { lat: 16.46, lng: 80.5, ts: new Date().toISOString() } });
  // An approval change bumps tokenVersion (sessions revoked): sign a token for the row as it is now.
  await r.reload();
  r.token = jwt.sign({ id: r.id, role: 'rider', tv: Number(r.tokenVersion) || 0 }, process.env.JWT_SECRET);
  return r;
};
const mkCustomer = async () => {
  const u = await H.mkUser();
  u.pushToken = tok('cust');
  await u.update({ fcmTokens: [{ token: u.pushToken }], hostelBlock: 'Ganga', roomNumber: '412' });
  return u;
};
const mkServiceItem = async (vendorType = 'LAUNDRY', { name = 'Wash & Fold (per kg)', price = 60 } = {}) => {
  const store = await H.ctx.M('Restaurant').create({ name: `${vendorType} Store ${++n}`, location: 'SRM AP Gate 2', operatingHours: { start: '00:00', end: '00:00' }, isActive: true, isOpenNow: true, vendorType, phone: '9000000001' });
  const item = await H.ctx.M('MenuItem').create({ restaurantId: store.id, name, price, isAvailable: true, specs: { bookingOnly: true } });
  return { store, item };
};
const bookLaundry = async (user, item, extra = {}) => api('POST', '/api/services/book', user.token, {
  serviceType: 'LAUNDRY', title: 'Wash & Fold', pickupSlot: 'Today, 5 PM', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210',
  specifications: { catalogueItemId: item.id, category: 'laundry', quantity: 3 }, ...extra,
});

const pushesTo = (token) => fcm.filter((c) => c.tokens.includes(token));
const jobEvents = (pred = () => true) => H.ctx.emitted.filter((e) => e.ev === 'rider_job' && pred(e));
const reset = () => { fcm.length = 0; H.ctx.emitted.length = 0; };
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
// Notices go out after the HTTP answer (fire-and-forget): wait until `fn()` is truthy (or give up after `ms`),
// then a little longer so a notice that must NOT come has had its chance too.
const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await settle(200);
};
// Wait for the fire-and-forget work of the request before (announce pushes etc.), then clear the recorders.
const quiet = async () => { await settle(900); reset(); };

module.exports = { ...T, setup, teardown, api, mkRider, mkCustomer, mkServiceItem, bookLaundry, pushesTo, jobEvents, reset, settle, waitFor, quiet, fcm };
