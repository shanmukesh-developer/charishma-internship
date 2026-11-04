// Admin side of ZCS PG Partner (/api/admin/pg-owners, protect + admin): create PG owner accounts with a
// temporary password ("Plan B", no SMS needed), link them to PG listings, reset the password, suspend /
// reactivate. Every write is audited in VerificationLog (like Auto-Ride and Rentals).
const bcrypt = require('bcryptjs');
const { getModel } = require('../index');
const { fail, Op, cleanText, isUuid, isUniqueError, audit, MOBILE_RE } = require('../services/util');
const { checkPassword } = require('./auth');
const { OWNER_STATUS, COMPLAINT_STATUS } = require('../models');
const S = require('../services/serialize');
const notify = require('../services/notify');
const { normalizePhone } = require('../../../utils/phoneUtils');

const M = () => ({
  Owner: getModel('PgOwner'),
  Link: getModel('PgOwnerListing'),
  Complaint: getModel('PgComplaint'),
  PGHostel: require('../../../models/PGHostel').getPGHostelModel(),
  PGBooking: require('../../../models/PGBooking').getPGBookingModel(),
});
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,120}\.[a-z]{2,24}$/i;

const ownerById = async (id) => {
  const { Owner } = M();
  if (!isUuid(String(id || ''))) throw fail(404, 'NOT_FOUND', 'PG owner not found.');
  const o = await Owner.findByPk(id);
  if (!o) throw fail(404, 'NOT_FOUND', 'PG owner not found.');
  return o;
};

/** ownerId -> [{ id, name, area, isActive }] */
const listingsByOwner = async (ownerIds) => {
  const { Link, PGHostel } = M();
  const out = new Map(ownerIds.map((id) => [String(id), []]));
  if (!ownerIds.length) return out;
  const links = await Link.findAll({ where: { ownerId: { [Op.in]: ownerIds.map(String) } }, order: [['createdAt', 'ASC']] });
  const hostels = links.length ? await PGHostel.findAll({ where: { id: { [Op.in]: links.map((l) => String(l.hostelId)) } }, attributes: ['id', 'name', 'area', 'isActive'] }) : [];
  const h = new Map(hostels.map((x) => [String(x.id), x]));
  for (const l of links) {
    const pg = h.get(String(l.hostelId));
    if (pg) out.get(String(l.ownerId)).push({ id: pg.id, name: pg.name, area: pg.area || null, isActive: pg.isActive !== false });
  }
  return out;
};

/** Validates hostel ids: real listings, not linked to ANOTHER owner. Returns the clean list. */
const checkHostels = async (raw, ownerId = null) => {
  const { Link, PGHostel } = M();
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50) throw fail(400, 'INVALID_INPUT', 'Choose up to 50 PG listings.', { field: 'hostelIds' });
  const ids = [...new Set(raw.map(String))];
  if (ids.some((id) => !isUuid(id))) throw fail(400, 'INVALID_INPUT', 'Unknown PG listing.', { field: 'hostelIds' });
  if (!ids.length) return [];
  const found = await PGHostel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'] });
  if (found.length !== ids.length) throw fail(404, 'NOT_FOUND', 'One of those PG listings no longer exists. Refresh and try again.', { field: 'hostelIds' });
  const taken = await Link.findAll({ where: { hostelId: { [Op.in]: ids } } });
  const other = taken.filter((l) => !ownerId || String(l.ownerId) !== String(ownerId));
  if (other.length) {
    const names = other.map((l) => (found.find((f) => String(f.id) === String(l.hostelId)) || {}).name).filter(Boolean);
    throw fail(409, 'LISTING_TAKEN', `${names.join(', ') || 'That PG'} is already linked to another owner account. Unlink it there first.`, { field: 'hostelIds' });
  }
  return ids.filter((id) => !taken.some((l) => String(l.hostelId) === id));
};
const addLinks = async (ownerId, hostelIds, req) => {
  const { Link } = M();
  for (const hostelId of hostelIds) {
    try {
      await Link.create({ ownerId, hostelId, linkedBy: String((req.user && req.user.id) || 'admin') });
    } catch (err) {
      if (isUniqueError(err)) throw fail(409, 'LISTING_TAKEN', 'That PG was just linked to another owner account. Refresh and try again.', { field: 'hostelIds' });
      throw err;
    }
  }
};

// GET /api/admin/pg-owners?q=&status=ACTIVE|SUSPENDED|DELETION
const list = async (req, res) => {
  const { Owner } = M();
  const where = {};
  const status = String(req.query.status || '').toUpperCase();
  if (status === 'ACTIVE' || status === 'SUSPENDED') where.status = status;
  if (status === 'DELETION') where.deletionRequestedAt = { [Op.ne]: null };
  const q = cleanText(req.query.q, 40).replace(/[%_\\]/g, '');
  if (q) where[Op.or] = [{ phone: { [Op.like]: `%${q}%` } }, { name: { [Op.like]: `%${q}%` } }];
  const owners = await Owner.findAll({ where, order: [['createdAt', 'DESC']], limit: 500 });
  const listings = await listingsByOwner(owners.map((o) => o.id));
  res.json({ owners: owners.map((o) => S.ownerAdmin(o, listings.get(String(o.id)) || [])) });
};

// GET /api/admin/pg-owners/links -> { links: [{ hostelId, ownerId, ownerName }] } (the listing picker greys linked PGs)
const links = async (req, res) => {
  const { Link, Owner } = M();
  const rows = await Link.findAll({ limit: 5000 });
  const owners = rows.length ? await Owner.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((r) => String(r.ownerId)))] } }, attributes: ['id', 'name'] }) : [];
  const o = new Map(owners.map((x) => [String(x.id), x.name]));
  res.json({ links: rows.map((r) => ({ hostelId: r.hostelId, ownerId: r.ownerId, ownerName: o.get(String(r.ownerId)) || null })) });
};

// GET /api/admin/pg-owners/:id
const detail = async (req, res) => {
  const o = await ownerById(req.params.id);
  const { PGBooking, Complaint } = M();
  const ls = (await listingsByOwner([o.id])).get(String(o.id)) || [];
  const ids = ls.map((l) => l.id);
  const [pending, tenants, openComplaints] = ids.length ? await Promise.all([
    PGBooking.count({ where: { hostelId: { [Op.in]: ids }, status: 'Pending' } }),
    PGBooking.count({ where: { hostelId: { [Op.in]: ids }, status: 'Confirmed' } }),
    Complaint.count({ where: { hostelId: { [Op.in]: ids }, status: { [Op.in]: [COMPLAINT_STATUS.OPEN, COMPLAINT_STATUS.IN_PROGRESS] } } }),
  ]) : [0, 0, 0];
  res.json({ owner: S.ownerAdmin(o, ls, { fullPhone: true }), counts: { pendingRequests: pending, tenants, openComplaints } });
};

// POST /api/admin/pg-owners { name, phone, password, email?, hostelIds?: [] }
const create = async (req, res) => {
  const { Owner } = M();
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  if (!MOBILE_RE.test(phone)) throw fail(400, 'INVALID_PHONE', 'Enter a valid 10-digit mobile number.', { field: 'phone' });
  const name = cleanText(body.name, 80);
  if (name.length < 2) throw fail(400, 'INVALID_INPUT', "Enter the owner's full name.", { field: 'name' });
  const email = cleanText(body.email, 120);
  if (email && !EMAIL_RE.test(email)) throw fail(400, 'INVALID_INPUT', 'Enter a valid email address, or leave it empty.', { field: 'email' });
  const password = checkPassword(body.password);
  if (await Owner.findOne({ where: { phone }, attributes: ['id'] })) throw fail(409, 'PHONE_TAKEN', 'A PG owner account already uses this number.', { field: 'phone' });
  const hostelIds = await checkHostels(body.hostelIds);
  let o;
  try {
    o = await Owner.create({
      name, phone, email: email || null, password: await bcrypt.hash(password, 10), status: OWNER_STATUS.ACTIVE,
      mustChangePassword: true, tokenVersion: 0, fcmTokens: [], createdBy: String((req.user && req.user.id) || 'admin'),
    });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'PHONE_TAKEN', 'A PG owner account already uses this number.', { field: 'phone' });
    throw err;
  }
  await addLinks(o.id, hostelIds, req);
  await audit(req, o.id, 'PG_OWNER_CREATED', { phoneLast4: phone.slice(-4), hostelIds });
  notify.admin('pg_owner', 'created', o.id);
  const ls = (await listingsByOwner([o.id])).get(String(o.id)) || [];
  res.status(201).json({
    owner: S.ownerAdmin(o, ls, { fullPhone: true }),
    message: `Account created. ${name} can sign in to ZenWe PG Partner with ${phone} and the temporary password, and must set an own password first.`,
  });
};

// PATCH /api/admin/pg-owners/:id { name?, email? }
const update = async (req, res) => {
  const o = await ownerById(req.params.id);
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_INPUT', "Enter the owner's full name.", { field: 'name' });
    patch.name = name;
  }
  if (body.email !== undefined) {
    const email = cleanText(body.email, 120);
    if (email && !EMAIL_RE.test(email)) throw fail(400, 'INVALID_INPUT', 'Enter a valid email address, or leave it empty.', { field: 'email' });
    patch.email = email || null;
  }
  if (!Object.keys(patch).length) throw fail(400, 'INVALID_INPUT', 'Nothing to save.');
  await o.update(patch);
  await audit(req, o.id, 'PG_OWNER_UPDATED', { fields: Object.keys(patch) });
  notify.admin('pg_owner', 'updated', o.id);
  const ls = (await listingsByOwner([o.id])).get(String(o.id)) || [];
  res.json({ owner: S.ownerAdmin(o, ls, { fullPhone: true }) });
};

// POST /api/admin/pg-owners/:id/listings { hostelIds: [...] }   (adds links)
const linkListings = async (req, res) => {
  const o = await ownerById(req.params.id);
  const hostelIds = await checkHostels((req.body || {}).hostelIds, o.id);
  if (!hostelIds.length && !(Array.isArray((req.body || {}).hostelIds) && req.body.hostelIds.length)) throw fail(400, 'INVALID_INPUT', 'Choose at least one PG listing.', { field: 'hostelIds' });
  await addLinks(o.id, hostelIds, req);
  if (hostelIds.length) await audit(req, o.id, 'PG_OWNER_LISTINGS_LINKED', { hostelIds });
  notify.admin('pg_owner', 'updated', o.id);
  const ls = (await listingsByOwner([o.id])).get(String(o.id)) || [];
  res.json({ owner: S.ownerAdmin(o, ls, { fullPhone: true }), linked: hostelIds.length });
};

// DELETE /api/admin/pg-owners/:id/listings/:hostelId
const unlinkListing = async (req, res) => {
  const o = await ownerById(req.params.id);
  const { Link } = M();
  const hostelId = String(req.params.hostelId || '');
  if (!isUuid(hostelId)) throw fail(404, 'NOT_FOUND', 'Link not found.');
  const n = await Link.destroy({ where: { ownerId: o.id, hostelId } });
  if (!n) throw fail(404, 'NOT_FOUND', 'That PG is not linked to this owner.');
  await audit(req, o.id, 'PG_OWNER_LISTING_UNLINKED', { hostelId });
  notify.admin('pg_owner', 'updated', o.id);
  const ls = (await listingsByOwner([o.id])).get(String(o.id)) || [];
  res.json({ owner: S.ownerAdmin(o, ls, { fullPhone: true }) });
};

// POST /api/admin/pg-owners/:id/reset-password { password }   (new temporary password; signs every phone out)
const resetPassword = async (req, res) => {
  const o = await ownerById(req.params.id);
  const password = checkPassword((req.body || {}).password);
  await o.update({ password: await bcrypt.hash(password, 10), mustChangePassword: true, tokenVersion: (Number(o.tokenVersion) || 0) + 1 });
  await audit(req, o.id, 'PG_OWNER_PASSWORD_RESET', { phoneLast4: String(o.phone).slice(-4) });
  notify.admin('pg_owner', 'updated', o.id);
  res.json({ owner: S.ownerAdmin(o, [], { fullPhone: true }), message: `Temporary password set. ${o.name} is signed out everywhere and must choose a new password at the next sign-in.` });
};

// POST /api/admin/pg-owners/:id/suspend { reason }  /  POST /:id/unsuspend
const suspend = async (req, res) => {
  const o = await ownerById(req.params.id);
  const reason = cleanText((req.body || {}).reason, 300);
  if (reason.length < 5) throw fail(400, 'REASON_REQUIRED', 'Give a reason the owner will see (at least 5 characters).', { field: 'reason' });
  await o.update({ status: OWNER_STATUS.SUSPENDED, suspendedReason: reason, tokenVersion: (Number(o.tokenVersion) || 0) + 1 });
  await audit(req, o.id, 'PG_OWNER_SUSPENDED', { reason });
  notify.admin('pg_owner', 'updated', o.id);
  res.json({ owner: S.ownerAdmin(o, [], { fullPhone: true }), message: `${o.name} is suspended and signed out.` });
};
const unsuspend = async (req, res) => {
  const o = await ownerById(req.params.id);
  if (o.status !== OWNER_STATUS.SUSPENDED) throw fail(409, 'NOT_SUSPENDED', 'This account is not suspended.');
  await o.update({ status: OWNER_STATUS.ACTIVE, suspendedReason: null });
  await audit(req, o.id, 'PG_OWNER_REACTIVATED', {});
  notify.admin('pg_owner', 'updated', o.id);
  res.json({ owner: S.ownerAdmin(o, [], { fullPhone: true }), message: `${o.name} can sign in again.` });
};

module.exports = { list, links, detail, create, update, linkListings, unlinkListing, resetPassword, suspend, unsuspend };
