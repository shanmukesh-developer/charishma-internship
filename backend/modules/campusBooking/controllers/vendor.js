// Stall routes (/api/campus-booking/vendor/*) for the ZCS Vendor app. The signed-in stall (role 'restaurant',
// req.user.id = its Restaurant id) only ever reads and changes its OWN bookings. Payment proof screenshots
// come as short-lived signed links; the pickup code is never sent here (the stall types what the student shows).
const { Op } = require('sequelize');
const { LOCAL_VENDOR_TYPES } = require('../../../utils/vendorTypes');
const { PAID_STATUSES, COMMISSION_PCT, LIMITS, REJECT_REASONS, CANCEL_REASONS } = require('../enums');
const { fail, hit, isUuid, rupees, normalizeUpiId, cleanText } = require('../services/util');
const stalls = require('../services/stalls');
const B = require('../services/bookings');
const S = require('../services/serialize');
const notify = require('../services/notify');
const realtime = require('../../../utils/realtime');

const IST_MS = 5.5 * 3600 * 1000;
/** Start of today (IST) as a Date. */
const istDayStart = (now = new Date()) => {
  const ist = new Date(now.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS);
};

const storeOnly = (req, res, next) => {
  if (String((req.user && req.user.role) || '').toLowerCase() !== 'restaurant') {
    return res.status(403).json({ code: 'STALLS_ONLY', message: "Sign in with your stall's account: the stall's phone number and its password from ZCS." });
  }
  return next();
};

const users = async (ids) => {
  const { getUserModel } = require('../../../models/User');
  const list = [...new Set(ids.map(String))];
  if (!list.length) return new Map();
  const rows = await getUserModel().findAll({ where: { id: { [Op.in]: list } }, attributes: ['id', 'name'], raw: true });
  return new Map(rows.map((u) => [String(u.id), u]));
};

const out = async (req, rows, { sign = true } = {}) => {
  const list = Array.isArray(rows) ? rows : [rows];
  const byUser = await users(list.map((b) => b.userId));
  const mapped = list.map((b) => S.forVendor(b, byUser.get(String(b.userId))));
  if (sign) await S.signProofs(req, mapped);
  else mapped.forEach((b) => { b.proof.imageUrl = null; });
  return Array.isArray(rows) ? mapped : mapped[0];
};

const ownBooking = async (req) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const row = await B.Booking().findOne({ where: { id, restaurantId: req.user.id } });
  if (!row) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  return row;
};

const loadStore = async (id) => {
  const { getRestaurantModel } = require('../../../models/Restaurant');
  return getRestaurantModel().findByPk(id, { attributes: stalls.STORE_ATTRS });
};

const settingsOf = (store) => ({
  enabled: store.campusBookingEnabled === true,
  upiId: store.campusUpiId || null,
  upiName: store.campusUpiName || null,
  qrUrl: store.campusUpiQrUrl || null,
  prepMinutes: store.campusPrepMinutes == null ? null : Number(store.campusPrepMinutes),
  effectivePrepMinutes: stalls.prepMinutesOf(store),
  defaultPrepMinutes: LIMITS.defaultPrepMin,
  isLocalVendor: LOCAL_VENDOR_TYPES.includes(String(store.vendorType || '').toUpperCase()),
  takingBookings: stalls.takesBookings(store),
  commissionPct: COMMISSION_PCT,
  rejectReasons: Object.entries(REJECT_REASONS).map(([code, label]) => ({ code, label })),
  cancelReasons: Object.entries(CANCEL_REASONS).filter(([code]) => code !== 'NOT_COLLECTED').map(([code, label]) => ({ code, label })),
});

// GET /vendor/summary -> today's numbers (real bookings only) + settings
const summary = async (req, res) => {
  const store = await loadStore(req.user.id);
  if (!store) throw fail(404, 'NOT_FOUND', 'Stall not found.');
  const since = istDayStart();
  const Booking = B.Booking();
  const [todayRows, paid, review, inProgress] = await Promise.all([
    Booking.findAll({ where: { restaurantId: store.id, createdAt: { [Op.gte]: since } }, attributes: ['status'], raw: true }),
    // Money by the day the stall confirmed the payment, the same rule as GET /vendor/earnings?range=today (a
    // booking placed at 11:58 PM and confirmed after midnight used to be in today's earnings but not here).
    Booking.findAll({ where: { restaurantId: store.id, status: { [Op.in]: PAID_STATUSES }, paymentVerifiedAt: { [Op.gte]: since } }, attributes: ['status', 'amountPaise', 'commissionPaise'], raw: true }),
    Booking.count({ where: { restaurantId: store.id, status: 'PAYMENT_REVIEW' } }),
    Booking.count({ where: { restaurantId: store.id, status: { [Op.in]: ['ACCEPTED', 'PREPARING', 'READY'] } } }),
  ]);
  res.set('Cache-Control', 'private, no-store');
  res.json({
    today: {
      orders: todayRows.filter((b) => b.status !== 'CANCELLED').length,
      paidOrders: paid.length,
      earnings: rupees(paid.reduce((s, b) => s + (Number(b.amountPaise) || 0), 0)),
      commission: rupees(paid.reduce((s, b) => s + (Number(b.commissionPaise) || 0), 0)),
    },
    pendingReview: review,
    inProgress,
    settings: settingsOf(store),
  });
};

const TABS = {
  pending: ['PAYMENT_REVIEW', 'PAYMENT_PENDING', 'REJECTED'],
  accepted: ['ACCEPTED', 'PREPARING', 'READY'],
  history: ['COLLECTED', 'CANCELLED'],
};

// GET /vendor/bookings?tab=pending|accepted|history&before=<iso>
const list = async (req, res) => {
  const tab = TABS[req.query.tab] ? req.query.tab : 'pending';
  const where = { restaurantId: req.user.id, status: { [Op.in]: TABS[tab] } };
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (tab === 'history' && before && !Number.isNaN(before.getTime())) where.updatedAt = { [Op.lt]: before };
  const limit = tab === 'history' ? 40 : 100;
  const rows = await B.Booking().findAll({ where, order: tab === 'history' ? [['updatedAt', 'DESC']] : [['createdAt', 'ASC']], limit });
  // Payments to review first, then the ones waiting on the student.
  if (tab === 'pending') rows.sort((a, b) => (Number(b.status === 'PAYMENT_REVIEW') - Number(a.status === 'PAYMENT_REVIEW')) || (new Date(a.createdAt) - new Date(b.createdAt)));
  const counts = {};
  for (const [k, sts] of Object.entries(TABS)) {
    if (k === 'history') continue;
    counts[k] = await B.Booking().count({ where: { restaurantId: req.user.id, status: { [Op.in]: sts } } });
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ tab, bookings: await out(req, rows, { sign: false }), counts, hasMore: tab === 'history' && rows.length === limit });
};

// GET /vendor/bookings/:id (proof screenshot signed)
const getOne = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ booking: await out(req, await ownBooking(req)) });
};

const act = (fn) => async (req, res) => {
  hit('vendor_action', req.user.id);
  const row = await ownBooking(req);
  const fresh = await fn(row, req.body || {});
  const store = await loadStore(req.user.id);
  notify.bookingChanged(fresh, { stallName: store ? store.name : null });
  res.json({ booking: await out(req, fresh) });
};

const confirmPayment = act((b) => B.vendorConfirm(b));
const rejectPayment = act((b, body) => B.vendorReject(b, { code: body.code, note: body.note }));
const markPreparing = act((b) => B.vendorPreparing(b));
const markReady = act((b) => B.vendorReady(b));
const cancel = act((b, body) => {
  if (!body.code && !body.note) throw fail(400, 'REASON_REQUIRED', 'Pick a reason so the student knows why.');
  return B.cancel(b, 'vendor', { code: body.code, note: body.note });
});
// POST /vendor/bookings/:id/collect { code }
const collect = async (req, res) => {
  hit('pickup_code', req.user.id);
  return act((b, body) => B.vendorCollect(b, { code: body.code }))(req, res);
};

// GET /vendor/earnings?range=today|7d|30d|all
const RANGES = { today: null, '7d': 7, '30d': 30, all: 0 };
const earnings = async (req, res) => {
  const range = Object.prototype.hasOwnProperty.call(RANGES, req.query.range) ? req.query.range : 'today';
  const where = { restaurantId: req.user.id, status: { [Op.in]: PAID_STATUSES } };
  if (range === 'today') where.paymentVerifiedAt = { [Op.gte]: istDayStart() };
  else if (RANGES[range]) where.paymentVerifiedAt = { [Op.gte]: new Date(istDayStart().getTime() - (RANGES[range] - 1) * 86400000) };
  const Booking = B.Booking();
  const rows = await Booking.findAll({ where, attributes: ['amountPaise', 'commissionPaise', 'vendorNetPaise', 'status'], raw: true });
  const sum = (k) => rows.reduce((s, b) => s + (Number(b[k]) || 0), 0);
  const recent = await Booking.findAll({ where, order: [['paymentVerifiedAt', 'DESC']], limit: 30 });
  res.set('Cache-Control', 'private, no-store');
  res.json({
    range,
    total: rupees(sum('amountPaise')),
    orders: rows.length,
    collected: rows.filter((b) => b.status === 'COLLECTED').length,
    commission: rupees(sum('commissionPaise')),
    net: rupees(sum('vendorNetPaise')),
    commissionPct: COMMISSION_PCT,
    recent: await out(req, recent, { sign: false }),
  });
};

// GET /vendor/settings
const getSettings = async (req, res) => {
  const store = await loadStore(req.user.id);
  if (!store) throw fail(404, 'NOT_FOUND', 'Stall not found.');
  res.set('Cache-Control', 'private, no-store');
  res.json({ settings: settingsOf(store) });
};

/** Shared by the vendor and admin writes: validated column changes from { upiId, upiName, qrUrl, prepMinutes }. */
const settingsPatch = async (req, body, ownerId) => {
  const patch = {};
  if (body.upiId !== undefined) {
    if (body.upiId === null || String(body.upiId).trim() === '') patch.campusUpiId = null;
    else {
      const v = normalizeUpiId(body.upiId);
      if (!v) throw fail(400, 'INVALID_UPI', 'Enter the UPI ID like stallname@okaxis.', { field: 'upiId' });
      patch.campusUpiId = v;
    }
  }
  if (body.upiName !== undefined) patch.campusUpiName = cleanText(body.upiName, 120) || null;
  if (body.prepMinutes !== undefined) {
    if (body.prepMinutes === null || body.prepMinutes === '') patch.campusPrepMinutes = null;
    else {
      const n = Number(body.prepMinutes);
      if (!Number.isInteger(n) || n < LIMITS.minPrepMin || n > LIMITS.maxPrepMin) throw fail(400, 'INVALID_PREP', `Prep time must be ${LIMITS.minPrepMin} to ${LIMITS.maxPrepMin} minutes.`, { field: 'prepMinutes' });
      patch.campusPrepMinutes = n;
    }
  }
  if (body.qrUrl !== undefined) {
    const { storeImageRef } = require('../../../utils/imageStore');
    const r = await storeImageRef(body.qrUrl, { req, ownerId, purpose: 'store', allowExternal: false });
    if (!r.ok) throw fail(r.status || 400, r.code || 'BAD_IMAGE', r.message, { field: 'qrUrl' });
    patch.campusUpiQrUrl = r.value;
  }
  return patch;
};

// PUT /vendor/settings { upiId?, upiName?, qrUrl?, prepMinutes? }   (the on / off switch is admin only)
const updateSettings = async (req, res) => {
  hit('vendor_settings', req.user.id);
  const store = await loadStore(req.user.id);
  if (!store) throw fail(404, 'NOT_FOUND', 'Stall not found.');
  const patch = await settingsPatch(req, req.body || {}, store.id);
  if (store.campusBookingEnabled === true && Object.prototype.hasOwnProperty.call(patch, 'campusUpiId') && !patch.campusUpiId) {
    throw fail(400, 'UPI_REQUIRED', 'In-Campus Booking is on for your stall, so it needs a UPI ID. Ask ZCS to switch it off first.', { field: 'upiId' });
  }
  if (Object.keys(patch).length) {
    await store.update(patch, { hooks: false });
    realtime.publish('store', 'updated', store.id, { scope: 'campus_booking' });
    realtime.notifyAdmin('store', 'updated', store.id);
  }
  res.json({ settings: settingsOf(await loadStore(store.id)) });
};

module.exports = {
  storeOnly, summary, list, getOne, confirmPayment, rejectPayment, markPreparing, markReady, cancel, collect, earnings,
  getSettings, updateSettings, settingsPatch, settingsOf, istDayStart, TABS,
};
