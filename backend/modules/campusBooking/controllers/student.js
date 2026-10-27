// Student routes (/api/campus-booking/*): browse bookable stalls, book for pickup, send payment proof,
// track, cancel before the stall accepts. A student only ever sees their own bookings.
const { Op } = require('sequelize');
const { CATEGORIES, OPEN_STATUSES, COMMISSION_PCT, LIMITS } = require('../enums');
const { fail, hit, isUuid } = require('../services/util');
const stalls = require('../services/stalls');
const B = require('../services/bookings');
const S = require('../services/serialize');
const notify = require('../services/notify');

const storeBriefs = async (ids) => {
  const { getRestaurantModel } = require('../../../models/Restaurant');
  const list = [...new Set(ids.map(String))];
  if (!list.length) return new Map();
  const { dataUrlSafeColumns } = require('../../../utils/imageStore');
  const rows = await getRestaurantModel().findAll({ where: { id: { [Op.in]: list } }, attributes: ['id', 'name', 'location', ...dataUrlSafeColumns('Restaurant', ['imageUrl'])] });
  return new Map(rows.map((r) => [String(r.id), r.get({ plain: true })]));
};

const sendOne = async (req, res, row, status = 200) => {
  const stores = await storeBriefs([row.restaurantId]);
  const out = S.forStudent(row, stores.get(String(row.restaurantId)));
  await S.signProofs(req, out);
  return res.status(status).json({ booking: out });
};

const ownBooking = async (req) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const row = await B.Booking().findOne({ where: { id, userId: req.user.id } });
  if (!row) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  return row;
};

// GET /api/campus-booking/home -> { categories, stalls, active, commissionPct }
const home = async (req, res) => {
  const [list, active] = await Promise.all([
    stalls.listStalls({ campus: req.query.campus }),
    B.Booking().findAll({ where: { userId: req.user.id, status: { [Op.in]: OPEN_STATUSES } }, order: [['createdAt', 'DESC']], limit: 5 }),
  ]);
  const stores = await storeBriefs(active.map((b) => b.restaurantId));
  res.set('Cache-Control', 'private, no-store');
  res.json({
    categories: CATEGORIES,
    stalls: list,
    active: active.map((b) => S.forStudent(b, stores.get(String(b.restaurantId)))).map((b) => ({ ...b, proof: { ...b.proof, imageUrl: null } })),
    limits: { maxQtyPerLine: LIMITS.maxQtyPerLine, maxLines: LIMITS.maxLines, proofMaxBytes: 5 * 1024 * 1024 },
    commissionPct: COMMISSION_PCT,
  });
};

// GET /api/campus-booking/stalls?q=&category=
const listStalls = async (req, res) => {
  const list = await stalls.listStalls({ q: req.query.q, category: req.query.category, campus: req.query.campus });
  res.json({ stalls: list, categories: CATEGORIES });
};

// GET /api/campus-booking/stalls/:id -> { stall, menu }
const stallDetail = async (req, res) => {
  const { stall, menu } = await stalls.getStallWithMenu(req.params.id);
  res.json({ stall, menu });
};

// POST /api/campus-booking/bookings { stallId, items: [{ menuItemId, quantity }], note? }  (Idempotency-Key header)
const create = async (req, res) => {
  const key = String(req.get('Idempotency-Key') || (req.body && req.body.idempotencyKey) || '').slice(0, 120) || null;
  // A retry of a booking already made returns it without counting against the limit.
  const prior = key ? await B.Booking().findOne({ where: { userId: req.user.id, idempotencyKey: key } }) : null;
  if (prior) return sendOne(req, res, prior, 200);
  hit('book', req.user.id);
  const body = req.body || {};
  const { booking, created } = await B.createBooking({ userId: req.user.id, stallId: body.stallId, items: body.items, note: body.note, idempotencyKey: key });
  if (created) notify.bookingChanged(booking, { action: 'created', push: false });
  return sendOne(req, res, booking, created ? 201 : 200);
};

// GET /api/campus-booking/bookings?scope=active|all&before=<iso>
const listMine = async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.scope === 'active') where.status = { [Op.in]: OPEN_STATUSES };
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && !Number.isNaN(before.getTime())) where.createdAt = { [Op.lt]: before };
  const rows = await B.Booking().findAll({ where, order: [['createdAt', 'DESC']], limit: 30 });
  const stores = await storeBriefs(rows.map((b) => b.restaurantId));
  res.set('Cache-Control', 'private, no-store');
  // Lists never carry proof links (the detail screen signs its own).
  res.json({ bookings: rows.map((b) => S.forStudent(b, stores.get(String(b.restaurantId)))).map((b) => ({ ...b, proof: { ...b.proof, imageUrl: null } })), hasMore: rows.length === 30 });
};

// GET /api/campus-booking/bookings/:id
const getMine = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return sendOne(req, res, await ownBooking(req));
};

// POST /api/campus-booking/bookings/:id/proof { imageUrl?, upiRef? }
const submitProof = async (req, res) => {
  hit('proof', req.user.id);
  const row = await ownBooking(req);
  const body = req.body || {};
  const fresh = await B.submitProof(row, { userId: req.user.id, imageUrl: body.imageUrl, upiRef: body.upiRef });
  const stores = await storeBriefs([fresh.restaurantId]);
  notify.bookingChanged(fresh, { stallName: (stores.get(String(fresh.restaurantId)) || {}).name });
  return sendOne(req, res, fresh);
};

// POST /api/campus-booking/bookings/:id/cancel
const cancel = async (req, res) => {
  hit('cancel', req.user.id);
  const row = await ownBooking(req);
  const fresh = await B.cancel(row, 'student');
  notify.bookingChanged(fresh);
  return sendOne(req, res, fresh);
};

module.exports = { home, listStalls, stallDetail, create, listMine, getMine, submitProof, cancel, storeBriefs };
