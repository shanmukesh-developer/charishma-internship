// Customer side of PG complaints (/api/pg-tenant/*, protect = ZCS customer accounts). Only a tenant may
// complain about a PG: a Confirmed booking there. The owner sees the first name + text and replies in the
// ZCS PG Partner app; the student gets a push + in-app notification. (Customer app screens: follow-up.)
const { getModel } = require('../index');
const { fail, Op, isUuid, ownerText, hit } = require('../services/util');
const { COMPLAINT_CATEGORIES } = require('../models');
const S = require('../services/serialize');
const notify = require('../services/notify');
const pgContent = require('../../../utils/pgContent');

const CATEGORY_LABEL = {
  room: 'Room', bathroom: 'Bathroom', food: 'Food / mess', water: 'Water', electricity: 'Electricity', wifi: 'Wi-Fi',
  cleaning: 'Cleaning', safety: 'Safety', staff: 'Staff', other: 'Other',
};

// POST /api/pg-tenant/complaints { hostelId, category, text }
const createComplaint = async (req, res) => {
  const body = req.body || {};
  const hostelId = String(body.hostelId || '');
  if (!isUuid(hostelId)) throw fail(404, 'NOT_FOUND', 'PG not found.');
  const PGBooking = require('../../../models/PGBooking').getPGBookingModel();
  const booking = await PGBooking.findOne({ where: { userId: req.user.id, hostelId, status: 'Confirmed' }, order: [['checkInDate', 'DESC']] });
  if (!booking) throw fail(403, 'NOT_A_TENANT', 'Complaints are for students staying at this PG (an accepted booking).');
  hit('complaint', req.user.id);
  const category = String(body.category || 'other').toLowerCase();
  if (!COMPLAINT_CATEGORIES.includes(category)) throw fail(400, 'INVALID_INPUT', 'Choose what the complaint is about.', { field: 'category' });
  const text = ownerText(body.text, 1000, 'Complaint', 'text', { multiline: true, min: 10 });
  const { getUserModel } = require('../../../models/User');
  const user = await getUserModel().findByPk(req.user.id, { attributes: ['id', 'name'] });
  const c = await getModel('PgComplaint').create({
    hostelId, userId: req.user.id, bookingId: booking.id, firstName: pgContent.firstNameOf(user && user.name), category, text, status: 'OPEN',
  });
  await notify.toListingOwners(hostelId, 'New complaint', `${c.firstName}: ${CATEGORY_LABEL[category]}. ${text.slice(0, 100)}`, { type: 'PG_OWNER_COMPLAINT', complaintId: String(c.id), hostelId });
  notify.admin('pg_complaint', 'created', c.id);
  res.status(201).json({ complaint: S.complaintForTenant(c), message: 'Complaint sent to the PG. You will be notified when they reply.' });
};

// GET /api/pg-tenant/complaints  (mine, newest first)
const myComplaints = async (req, res) => {
  const rows = await getModel('PgComplaint').findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 50 });
  const PGHostel = require('../../../models/PGHostel').getPGHostelModel();
  const ids = [...new Set(rows.map((r) => String(r.hostelId)))];
  const hostels = ids.length ? await PGHostel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'] }) : [];
  const h = new Map(hostels.map((x) => [String(x.id), x]));
  res.json({ complaints: rows.map((c) => S.complaintForTenant(c, h.get(String(c.hostelId)))), categories: COMPLAINT_CATEGORIES.map((k) => ({ key: k, label: CATEGORY_LABEL[k] })) });
};

module.exports = { createComplaint, myComplaints, CATEGORY_LABEL };
