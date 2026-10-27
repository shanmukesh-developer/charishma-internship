// Admin routes (/api/admin/campus-booking/*): every booking (read only) and the per-stall switch, UPI ID, QR
// and prep time. Changes are audited (VerificationLog) and pushed live to the apps (ids only).
const { Op } = require('sequelize');
const { STATUS, STATUS_LABEL, OPEN_STATUSES, PAID_STATUSES, COMMISSION_PCT } = require('../enums');
const { fail, isUuid, rupees, cleanText } = require('../services/util');
const stalls = require('../services/stalls');
const B = require('../services/bookings');
const S = require('../services/serialize');
const V = require('./vendor');
const realtime = require('../../../utils/realtime');
const { LOCAL_VENDOR_TYPES } = require('../../../utils/vendorTypes');

const audit = async (req, targetId, action, details) => {
  try {
    const { getVerificationLogModel } = require('../../../models/VerificationLog');
    const Log = getVerificationLogModel();
    if (!Log) return;
    await Log.create({ adminId: String(req.user.id), targetId: String(targetId), action, details: JSON.stringify(details || {}).slice(0, 8000) });
  } catch (err) {
    console.warn('[CAMPUS_BOOKING_AUDIT_WARN]', err.message);
  }
};

const models = () => ({
  Restaurant: require('../../../models/Restaurant').getRestaurantModel(),
  User: require('../../../models/User').getUserModel(),
});

const adminStall = (store) => {
  const p = store.get({ plain: true });
  const open = stalls.openStateOf(p);
  return {
    id: String(p.id),
    name: p.name,
    location: p.location || null,
    campus: p.campus || null,
    isActive: p.isActive !== false,
    isOpen: open.isOpen,
    category: stalls.categoryLabel(stalls.categoryOf(p)),
    enabled: p.campusBookingEnabled === true,
    upiId: p.campusUpiId || null,
    upiName: p.campusUpiName || null,
    qrUrl: p.campusUpiQrUrl || null,
    prepMinutes: p.campusPrepMinutes == null ? null : Number(p.campusPrepMinutes),
    effectivePrepMinutes: stalls.prepMinutesOf(p),
    takingBookings: stalls.takesBookings(p),
  };
};

// GET /stores -> every stall (local vendor) with its In-Campus Booking settings
const listStores = async (req, res) => {
  const { Restaurant } = models();
  const rows = await Restaurant.findAll({ where: { vendorType: { [Op.in]: LOCAL_VENDOR_TYPES } }, attributes: stalls.STORE_ATTRS, order: [['name', 'ASC']] });
  res.json({ stores: rows.map(adminStall), commissionPct: COMMISSION_PCT });
};

// GET /stores/:id
const getStore = async (req, res) => {
  const { Restaurant } = models();
  if (!isUuid(String(req.params.id || ''))) throw fail(404, 'NOT_FOUND', 'Store not found.');
  const store = await Restaurant.findByPk(req.params.id, { attributes: stalls.STORE_ATTRS });
  if (!store) throw fail(404, 'NOT_FOUND', 'Store not found.');
  res.json({ store: adminStall(store), isLocalVendor: LOCAL_VENDOR_TYPES.includes(String(store.vendorType || '').toUpperCase()) });
};

// PUT /stores/:id { enabled?, upiId?, upiName?, qrUrl?, prepMinutes? }
const updateStore = async (req, res) => {
  const { Restaurant } = models();
  if (!isUuid(String(req.params.id || ''))) throw fail(404, 'NOT_FOUND', 'Store not found.');
  const store = await Restaurant.findByPk(req.params.id, { attributes: stalls.STORE_ATTRS });
  if (!store) throw fail(404, 'NOT_FOUND', 'Store not found.');
  const body = req.body || {};
  const patch = await V.settingsPatch(req, body, store.id);
  if (body.enabled !== undefined) {
    const on = body.enabled === true || body.enabled === 'true';
    if (on && !LOCAL_VENDOR_TYPES.includes(String(store.vendorType || '').toUpperCase())) {
      throw fail(400, 'NOT_A_STALL', 'In-Campus Booking is for campus stalls (local vendors) only.');
    }
    const upi = Object.prototype.hasOwnProperty.call(patch, 'campusUpiId') ? patch.campusUpiId : store.campusUpiId;
    if (on && !upi) throw fail(400, 'UPI_REQUIRED', "Add the stall's UPI ID first. Students pay the stall on it.", { field: 'upiId' });
    patch.campusBookingEnabled = on;
  } else if (store.campusBookingEnabled === true && Object.prototype.hasOwnProperty.call(patch, 'campusUpiId') && !patch.campusUpiId) {
    throw fail(400, 'UPI_REQUIRED', 'Switch In-Campus Booking off before removing the UPI ID.', { field: 'upiId' });
  }
  if (Object.keys(patch).length) {
    const before = adminStall(store);
    await store.update(patch, { hooks: false });
    await audit(req, store.id, 'CAMPUS_BOOKING_STORE_UPDATE', { before: { enabled: before.enabled, upiId: before.upiId, prepMinutes: before.prepMinutes, qr: !!before.qrUrl }, patch: { ...patch, campusUpiQrUrl: patch.campusUpiQrUrl ? 'set' : patch.campusUpiQrUrl } });
    realtime.publish('store', 'updated', store.id, { scope: 'campus_booking' });
    realtime.notifyAdmin('store', 'updated', store.id);
  }
  res.json({ store: adminStall(await Restaurant.findByPk(store.id, { attributes: stalls.STORE_ATTRS })) });
};

// GET /bookings?status=&storeId=&q=&page=&limit=
const listBookings = async (req, res) => {
  const { Restaurant, User } = models();
  const page = Math.max(1, Math.min(500, parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 30));
  const where = {};
  const st = String(req.query.status || '').toUpperCase();
  if (st === 'OPEN') where.status = { [Op.in]: OPEN_STATUSES };
  else if (STATUS[st]) where.status = st;
  if (req.query.storeId && isUuid(String(req.query.storeId))) where.restaurantId = String(req.query.storeId);
  const q = cleanText(req.query.q, 40).toUpperCase();
  if (q) where.ref = { [Op.like]: `%${q.replace(/[%_]/g, '')}%` };
  const Booking = B.Booking();
  const { rows, count } = await Booking.findAndCountAll({ where, order: [['createdAt', 'DESC']], limit, offset: (page - 1) * limit });
  const [stores, people] = await Promise.all([
    Restaurant.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((b) => String(b.restaurantId)))] } }, attributes: ['id', 'name', 'location'], raw: true }),
    User.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((b) => String(b.userId)))] } }, attributes: ['id', 'name', 'phone'], raw: true }),
  ]);
  const sMap = new Map(stores.map((s) => [String(s.id), s]));
  const uMap = new Map(people.map((u) => [String(u.id), u]));
  const list = rows.map((b) => S.forAdmin(b, { user: uMap.get(String(b.userId)), store: sMap.get(String(b.restaurantId)) }));
  list.forEach((b) => { b.proof.imageUrl = null; });
  // Totals across every booking (not just this page): status counts, paid amount and recorded commission.
  const all = await Booking.findAll({ attributes: ['status', 'amountPaise', 'commissionPaise'], raw: true });
  const byStatus = {};
  for (const b of all) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
  const paid = all.filter((b) => PAID_STATUSES.includes(b.status));
  res.set('Cache-Control', 'private, no-store');
  res.json({
    bookings: list,
    total: count,
    page,
    pages: Math.max(1, Math.ceil(count / limit)),
    stats: {
      byStatus,
      open: all.filter((b) => OPEN_STATUSES.includes(b.status)).length,
      paidAmount: rupees(paid.reduce((s, b) => s + (Number(b.amountPaise) || 0), 0)),
      commission: rupees(paid.reduce((s, b) => s + (Number(b.commissionPaise) || 0), 0)),
    },
    statusLabels: STATUS_LABEL,
    commissionPct: COMMISSION_PCT,
  });
};

// GET /bookings/:id (proof screenshot signed for the admin)
const getBooking = async (req, res) => {
  const { Restaurant, User } = models();
  if (!isUuid(String(req.params.id || ''))) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const row = await B.Booking().findByPk(req.params.id);
  if (!row) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const [store, user] = await Promise.all([
    Restaurant.findByPk(row.restaurantId, { attributes: ['id', 'name', 'location'], raw: true }),
    User.findByPk(row.userId, { attributes: ['id', 'name', 'phone'], raw: true }),
  ]);
  const out = S.forAdmin(row, { user, store });
  await S.signProofs(req, out);
  res.set('Cache-Control', 'private, no-store');
  res.json({ booking: out });
};

module.exports = { listStores, getStore, updateStore, listBookings, getBooking, adminStall };
