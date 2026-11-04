// Admin side of Rentals: listing review queue, licence verification, bookings, reports, on/off switch.
// Every route is protect + admin (routes/adminRoutes.js); every decision is audited (VerificationLog).
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUuid, audit, num, money } = require('../services/util');
const safety = require('../services/safety');
const S = require('../services/serialize');
const notify = require('../services/notify');
const { readFlag, writeFlag } = require('../services/eligibility');

const M = () => ({
  Listing: getModel('RentalListing'),
  Booking: getModel('RentalBooking'),
  Licence: getModel('RentalLicence'),
  Report: getModel('RentalReport'),
  User: getModel('User'),
});
const ADMIN_USER_ATTRS = ['id', 'name', 'phone', 'email', 'isActive', 'profileImage'];

const usersById = async (ids) => {
  const { User } = M();
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const rows = await User.findAll({ where: { id: { [Op.in]: list } }, attributes: ADMIN_USER_ATTRS });
  return new Map(rows.map((u) => [String(u.id), u]));
};
const byId = async (Model, id, label) => {
  if (!isUuid(String(id || ''))) throw fail(404, 'NOT_FOUND', `${label} not found.`);
  const row = await Model.findByPk(id);
  if (!row) throw fail(404, 'NOT_FOUND', `${label} not found.`);
  return row;
};
const reasonOf = (body, min = 5) => {
  const reason = cleanText(body && body.reason, 500);
  if (reason.length < min) throw fail(400, 'REASON_REQUIRED', `Give a reason the student will see (at least ${min} characters).`, { field: 'reason' });
  return reason;
};

// GET /api/admin/rentals/summary
const summary = async (req, res) => {
  const { Listing, Licence, Report, Booking } = M();
  const [pendingListings, liveListings, pendingLicences, openReports, openBookings, enabled, openDisputes] = await Promise.all([
    Listing.count({ where: { status: E.LISTING_STATUS.PENDING_REVIEW } }),
    Listing.count({ where: { status: E.LISTING_STATUS.APPROVED } }),
    Licence.count({ where: { status: E.LICENCE_STATUS.PENDING } }),
    Report.count({ where: { status: { [Op.in]: ['OPEN', 'REVIEWING'] } } }),
    Booking.count({ where: { status: { [Op.in]: E.OPEN_STATUSES } } }),
    readFlag({ fresh: true }),
    Booking.count({ where: { chargesStatus: E.CHARGES_STATUS.DISPUTED } }),
  ]);
  res.json({ pendingListings, liveListings, pendingLicences, openReports, openBookings, enabled, openDisputes });
};

// GET /api/admin/rentals/listings?status=PENDING_REVIEW|APPROVED|...|ALL&q=
const listings = async (req, res) => {
  const { Listing } = M();
  const status = String(req.query.status || E.LISTING_STATUS.PENDING_REVIEW).toUpperCase();
  const where = {};
  if (status !== 'ALL') {
    if (!Object.values(E.LISTING_STATUS).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  const q = cleanText(req.query.q, 40).toUpperCase().replace(/\s+/g, '');
  if (q) where.registrationNumber = { [Op.like]: `%${q.replace(/[%_\\]/g, '')}%` };
  const rows = await Listing.findAll({ where, order: [[status === E.LISTING_STATUS.PENDING_REVIEW ? 'submittedAt' : 'updatedAt', status === E.LISTING_STATUS.PENDING_REVIEW ? 'ASC' : 'DESC']], limit: 200 });
  const owners = await usersById(rows.map((r) => r.ownerId));
  res.json({ listings: rows.map((r) => S.listingAdmin(req, r, { owner: owners.get(String(r.ownerId)) })) });
};

// GET /api/admin/rentals/listings/:id
const listingDetail = async (req, res) => {
  const { Listing, Booking } = M();
  const row = await byId(Listing, req.params.id, 'Listing');
  const owners = await usersById([row.ownerId]);
  const recent = await Booking.findAll({ where: { listingId: row.id }, order: [['createdAt', 'DESC']], limit: 20 });
  res.json({
    listing: S.listingAdmin(req, row, { owner: owners.get(String(row.ownerId)) }),
    bookings: recent.map((b) => S.bookingAdmin(req, b, { listing: row })),
  });
};

/** Declines every still-pending request on a listing that just went offline. */
const declinePending = async (listing, reason) => {
  const { Booking } = M();
  const pending = await Booking.findAll({ where: { listingId: listing.id, status: E.BOOKING_STATUS.REQUESTED } });
  for (const b of pending) {
    const [n] = await Booking.update(
      { status: E.BOOKING_STATUS.DECLINED, declinedAt: new Date(), declineReason: reason },
      { where: { id: b.id, status: E.BOOKING_STATUS.REQUESTED } },
    );
    if (n) {
      b.status = E.BOOKING_STATUS.DECLINED;
      notify.booking(b, { to: 'renter', title: `${E.wordsFor(b.rentalMode).Request} declined`, body: `${b.vehicleTitle || 'The vehicle'} is not available any more.`, type: 'RENTAL_DECLINED' });
    }
  }
};

// POST /api/admin/rentals/listings/:id/approve
const approve = async (req, res) => {
  const { Listing } = M();
  const row = await byId(Listing, req.params.id, 'Listing');
  if (row.status !== E.LISTING_STATUS.PENDING_REVIEW) throw fail(409, 'INVALID_STATE', `This listing is ${row.status.toLowerCase().replace('_', ' ')}, not waiting for review.`);
  const missing = require('./listings').missingFor(row.get({ plain: true }));
  if (missing.length) throw fail(409, 'INCOMPLETE', `The listing is missing: ${missing.join(', ')}.`, { missing });
  const [n] = await Listing.update(
    { status: E.LISTING_STATUS.APPROVED, approvedAt: row.approvedAt || new Date(), reviewedAt: new Date(), reviewedBy: req.user.id, rejectionReason: null },
    { where: { id: row.id, status: E.LISTING_STATUS.PENDING_REVIEW } },
  );
  if (!n) throw fail(409, 'INVALID_STATE', 'Someone else already reviewed this listing.');
  await row.reload();
  await audit(req, row.id, 'RENTAL_LISTING_APPROVED', { ownerId: row.ownerId, title: S.titleOf(row), registration: row.registrationNumber });
  notify.push(row.ownerId, 'Your vehicle is live 🎉', `${S.titleOf(row)} is approved. Students can now request it.`, { type: 'RENTAL_LISTING_APPROVED', listingId: row.id, screen: 'rental_listing' });
  notify.nudge(row.ownerId, 'listing', row.id, row.status);
  notify.listingChanged(row.id);
  notify.admin('rental_listing', 'updated', row.id);
  const owners = await usersById([row.ownerId]);
  res.json({ listing: S.listingAdmin(req, row, { owner: owners.get(String(row.ownerId)) }) });
};

// POST /api/admin/rentals/listings/:id/reject { reason }  (also takes a live / paused listing down)
const reject = async (req, res) => {
  const { Listing } = M();
  const reason = reasonOf(req.body);
  const row = await byId(Listing, req.params.id, 'Listing');
  const allowed = [E.LISTING_STATUS.PENDING_REVIEW, E.LISTING_STATUS.APPROVED, E.LISTING_STATUS.PAUSED];
  if (!allowed.includes(row.status)) throw fail(409, 'INVALID_STATE', `This listing is ${row.status.toLowerCase()}.`);
  const wasVisible = row.status === E.LISTING_STATUS.APPROVED;
  const [n] = await Listing.update(
    { status: E.LISTING_STATUS.REJECTED, rejectionReason: reason, reviewedAt: new Date(), reviewedBy: req.user.id },
    { where: { id: row.id, status: row.status } },
  );
  if (!n) throw fail(409, 'INVALID_STATE', 'This listing changed meanwhile. Refresh and try again.');
  await row.reload();
  await declinePending(row, 'This vehicle is not available any more.');
  await audit(req, row.id, wasVisible ? 'RENTAL_LISTING_TAKEN_DOWN' : 'RENTAL_LISTING_REJECTED', { ownerId: row.ownerId, reason });
  notify.push(row.ownerId, 'Vehicle listing needs changes', `${S.titleOf(row)}: ${reason}`, { type: 'RENTAL_LISTING_REJECTED', listingId: row.id, screen: 'rental_listing' });
  notify.nudge(row.ownerId, 'listing', row.id, row.status);
  if (wasVisible) notify.listingChanged(row.id);
  notify.admin('rental_listing', 'updated', row.id);
  const owners = await usersById([row.ownerId]);
  res.json({ listing: S.listingAdmin(req, row, { owner: owners.get(String(row.ownerId)) }) });
};

// GET /api/admin/rentals/licences?status=PENDING|VERIFIED|REJECTED|ALL
const licences = async (req, res) => {
  const { Licence } = M();
  const status = String(req.query.status || E.LICENCE_STATUS.PENDING).toUpperCase();
  const where = status === 'ALL' ? {} : { status };
  if (status !== 'ALL' && !Object.values(E.LICENCE_STATUS).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
  const rows = await Licence.findAll({ where, order: [['submittedAt', status === E.LICENCE_STATUS.PENDING ? 'ASC' : 'DESC']], limit: 200 });
  const users = await usersById(rows.map((r) => r.userId));
  res.json({ licences: rows.map((r) => S.licenceAdmin(req, r, users.get(String(r.userId)))) });
};

// POST /api/admin/rentals/licences/:id/verify { classes?: [] }  (classes = what the card really shows)
const verifyLicence = async (req, res) => {
  const { Licence } = M();
  const row = await byId(Licence, req.params.id, 'Licence');
  if (row.status === E.LICENCE_STATUS.VERIFIED) throw fail(409, 'INVALID_STATE', 'This licence is already verified.');
  let classes = Array.isArray(row.classes) ? row.classes : [];
  if (req.body && req.body.classes !== undefined) {
    const c = Array.isArray(req.body.classes) ? [...new Set(req.body.classes.map((x) => String(x).toUpperCase().trim()))] : [];
    if (!c.length || c.some((x) => !E.LICENCE_CLASSES.includes(x))) throw fail(400, 'INVALID_INPUT', `Classes must be from: ${E.LICENCE_CLASSES.join(', ')}.`, { field: 'classes' });
    classes = c;
  }
  await row.update({ status: E.LICENCE_STATUS.VERIFIED, verifiedClasses: classes, reviewedAt: new Date(), reviewedBy: req.user.id, rejectionReason: null });
  await audit(req, row.id, 'RENTAL_LICENCE_VERIFIED', { userId: row.userId, classes });
  notify.push(row.userId, 'Driving licence verified ✅', `You can now rent: ${classes.join(', ')}.`, { type: 'RENTAL_LICENCE_VERIFIED', screen: 'rental_licence' });
  notify.nudge(row.userId, 'licence', row.id, row.status);
  notify.admin('rental_licence', 'updated', row.id);
  const users = await usersById([row.userId]);
  res.json({ licence: S.licenceAdmin(req, row, users.get(String(row.userId))) });
};

// POST /api/admin/rentals/licences/:id/reject { reason }
const rejectLicence = async (req, res) => {
  const { Licence } = M();
  const reason = reasonOf(req.body);
  const row = await byId(Licence, req.params.id, 'Licence');
  await row.update({ status: E.LICENCE_STATUS.REJECTED, rejectionReason: reason, reviewedAt: new Date(), reviewedBy: req.user.id });
  await audit(req, row.id, 'RENTAL_LICENCE_REJECTED', { userId: row.userId, reason });
  notify.push(row.userId, 'Driving licence not accepted', reason, { type: 'RENTAL_LICENCE_REJECTED', screen: 'rental_licence' });
  notify.nudge(row.userId, 'licence', row.id, row.status);
  notify.admin('rental_licence', 'updated', row.id);
  const users = await usersById([row.userId]);
  res.json({ licence: S.licenceAdmin(req, row, users.get(String(row.userId))) });
};

// GET /api/admin/rentals/bookings?status=&from=&to=&listingId=
const bookings = async (req, res) => {
  const { Booking, Listing } = M();
  const where = {};
  const status = String(req.query.status || '').toUpperCase();
  if (status === 'OPEN') where.status = { [Op.in]: E.OPEN_STATUSES };
  else if (status) {
    if (!Object.values(E.BOOKING_STATUS).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  if (req.query.listingId && isUuid(String(req.query.listingId))) where.listingId = String(req.query.listingId);
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from && !Number.isNaN(from.getTime())) where.endAt = { [Op.gte]: from };
  if (to && !Number.isNaN(to.getTime())) where.startAt = { [Op.lte]: to };
  const rows = await Booking.findAll({ where, order: [['createdAt', 'DESC']], limit: 300 });
  const users = await usersById(rows.flatMap((r) => [r.ownerId, r.renterId]));
  const lIds = [...new Set(rows.map((r) => r.listingId))];
  const ls = lIds.length ? await Listing.findAll({ where: { id: { [Op.in]: lIds } } }) : [];
  const lById = new Map(ls.map((l) => [String(l.id), l]));
  res.json({
    bookings: rows.map((r) => S.bookingAdmin(req, r, { owner: users.get(String(r.ownerId)), renter: users.get(String(r.renterId)), listing: lById.get(String(r.listingId)) })),
  });
};

// GET /api/admin/rentals/reports?status=OPEN|REVIEWING|RESOLVED|DISMISSED|ALL
const reports = async (req, res) => {
  const { Report, Booking } = M();
  const status = String(req.query.status || 'OPEN').toUpperCase();
  const where = {};
  if (status === 'ACTIVE') where.status = { [Op.in]: ['OPEN', 'REVIEWING'] };
  else if (status !== 'ALL') {
    if (!E.REPORT_STATUS.includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  const rows = await Report.findAll({ where, order: [['createdAt', 'DESC']], limit: 200 });
  const users = await usersById(rows.flatMap((r) => [r.reporterId, r.againstUserId]));
  const bIds = [...new Set(rows.map((r) => r.bookingId))];
  const bs = bIds.length ? await Booking.findAll({ where: { id: { [Op.in]: bIds } } }) : [];
  const bById = new Map(bs.map((b) => [String(b.id), b]));
  res.json({
    reports: rows.map((r) => S.reportAdmin(req, r, {
      reporter: users.get(String(r.reporterId)), against: users.get(String(r.againstUserId)), booking: bById.get(String(r.bookingId)),
    })),
  });
};

// POST /api/admin/rentals/reports/:id/status { status, note? }
const updateReport = async (req, res) => {
  const { Report } = M();
  const row = await byId(Report, req.params.id, 'Report');
  const status = String((req.body && req.body.status) || '').toUpperCase();
  if (!E.REPORT_STATUS.includes(status)) throw fail(400, 'INVALID_INPUT', `Status must be one of: ${E.REPORT_STATUS.join(', ')}.`, { field: 'status' });
  const note = cleanText(req.body && req.body.note, 1000) || row.adminNote || null;
  const closed = ['RESOLVED', 'DISMISSED'].includes(status);
  await row.update({ status, adminNote: note, ...(closed ? { resolvedBy: req.user.id, resolvedAt: new Date() } : { resolvedBy: null, resolvedAt: null }) });
  await audit(req, row.id, 'RENTAL_REPORT_STATUS', { status, bookingId: row.bookingId });
  if (closed) {
    notify.push(row.reporterId, 'Your rental report was reviewed', note ? `ZenWe team: ${note}` : 'The ZenWe team has reviewed your report.', { type: 'RENTAL_REPORT_UPDATE', bookingId: row.bookingId, screen: 'rental_booking' });
  }
  notify.admin('rental_report', 'updated', row.id);
  res.json({ report: S.reportAdmin(req, row, {}) });
};

// GET /api/admin/rentals/disputes?status=OPEN|RESOLVED|ALL  (C7: extra charges the renter / borrower disputed)
const RESOLVED_CHARGES = [E.CHARGES_STATUS.UPHELD, E.CHARGES_STATUS.REDUCED, E.CHARGES_STATUS.VOIDED];
const disputes = async (req, res) => {
  const { Booking, Listing } = M();
  const status = String(req.query.status || 'OPEN').toUpperCase();
  let where;
  if (status === 'OPEN') where = { chargesStatus: E.CHARGES_STATUS.DISPUTED };
  else if (status === 'RESOLVED') where = { chargesStatus: { [Op.in]: RESOLVED_CHARGES } };
  else if (status === 'ALL') where = { chargesStatus: { [Op.in]: [E.CHARGES_STATUS.DISPUTED, ...RESOLVED_CHARGES] } };
  else throw fail(400, 'INVALID_INPUT', 'Status must be OPEN, RESOLVED or ALL.');
  const rows = await Booking.findAll({ where, order: [[status === 'OPEN' ? 'chargesRespondedAt' : 'updatedAt', status === 'OPEN' ? 'ASC' : 'DESC']], limit: 200 });
  const users = await usersById(rows.flatMap((r) => [r.ownerId, r.renterId]));
  const lIds = [...new Set(rows.map((r) => r.listingId))];
  const ls = lIds.length ? await Listing.findAll({ where: { id: { [Op.in]: lIds } } }) : [];
  const lById = new Map(ls.map((l) => [String(l.id), l]));
  res.json({
    disputes: rows.map((r) => S.bookingAdmin(req, r, { owner: users.get(String(r.ownerId)), renter: users.get(String(r.renterId)), listing: lById.get(String(r.listingId)) })),
  });
};

// POST /api/admin/rentals/disputes/:id/resolve { outcome: UPHOLD | REDUCE | VOID, amount? (REDUCE), reason }
const resolveDispute = async (req, res) => {
  const { Booking } = M();
  const reason = reasonOf(req.body);
  const outcome = String((req.body && req.body.outcome) || '').toUpperCase();
  const STATUS = { UPHOLD: E.CHARGES_STATUS.UPHELD, REDUCE: E.CHARGES_STATUS.REDUCED, VOID: E.CHARGES_STATUS.VOIDED };
  if (!STATUS[outcome]) throw fail(400, 'INVALID_INPUT', 'Outcome must be UPHOLD, REDUCE or VOID.', { field: 'outcome' });
  const row = await byId(Booking, req.params.id, 'Booking');
  if (row.chargesStatus !== E.CHARGES_STATUS.DISPUTED) throw fail(409, 'INVALID_STATE', 'This booking has no open dispute.');
  const claimed = Number(row.chargesClaimed) || 0;
  let amount = outcome === 'UPHOLD' ? claimed : 0;
  if (outcome === 'REDUCE') {
    amount = num(req.body && req.body.amount, { min: 0, max: claimed, field: 'amount', label: 'Reduced amount' });
    if (amount === null || amount >= claimed) throw fail(400, 'INVALID_INPUT', `Enter the reduced amount (less than the ₹${claimed} claimed).`, { field: 'amount' });
  }
  const now = new Date();
  const [n] = await Booking.update({
    chargesStatus: STATUS[outcome],
    extraCharges: money(amount),
    finalAmount: money((Number(row.rentAmount) || 0) + amount),
    chargesResolution: { outcome, amount: money(amount), claimed, reason, by: String(req.user.id), at: now.toISOString() },
    chargesResolvedAt: now,
  }, { where: { id: row.id, chargesStatus: E.CHARGES_STATUS.DISPUTED } });
  if (!n) throw fail(409, 'INVALID_STATE', 'Someone else already resolved this dispute.');
  await row.reload();
  await audit(req, row.id, 'RENTAL_CHARGES_DISPUTE_RESOLVED', { outcome, claimed, amount: money(amount), reason, ownerId: row.ownerId, renterId: row.renterId });
  const words = E.wordsFor(row.rentalMode);
  const what = outcome === 'UPHOLD' ? `upheld the charges: ₹${claimed} stands` : outcome === 'VOID' ? 'cancelled the charges: nothing extra is due' : `reduced the charges to ₹${money(amount)}`;
  notify.booking(row, { to: 'both', title: 'Extra charges dispute resolved', body: `${row.vehicleTitle}: the ZenWe team ${what}. Reason: ${reason}`, type: 'RENTAL_CHARGES' });
  notify.admin('rental_dispute', 'updated', row.id);
  const users = await usersById([row.ownerId, row.renterId]);
  res.json({
    booking: S.bookingAdmin(req, row, { owner: users.get(String(row.ownerId)), renter: users.get(String(row.renterId)) }),
    message: `Resolved. Both the ${words.giver} and the ${words.taker} were notified.`,
  });
};

// GET/PUT /api/admin/rentals/settings { enabled?, safety?: { conditionPhotosRequired, otherChargesCap, chargesResponseHours, disclaimer } }
const getSettings = async (req, res) => {
  const [enabled, s, biz] = await Promise.all([readFlag({ fresh: true }), safety.readSettings({ fresh: true }), safety.businessName()]);
  res.json({ enabled, safety: s, defaultDisclaimer: safety.defaultDisclaimer(biz) });
};
const putSettings = async (req, res) => {
  const body = req.body || {};
  const v = body.enabled;
  const hasSafety = body.safety !== undefined;
  if (v === undefined && !hasSafety) throw fail(400, 'INVALID_INPUT', 'enabled must be true or false.', { field: 'enabled' });
  if (v !== undefined && typeof v !== 'boolean') throw fail(400, 'INVALID_INPUT', 'enabled must be true or false.', { field: 'enabled' });
  if (hasSafety && (!body.safety || typeof body.safety !== 'object' || Array.isArray(body.safety))) throw fail(400, 'INVALID_INPUT', 'safety must be an object.', { field: 'safety' });
  let s = null;
  if (hasSafety) {
    const before = await safety.readSettings({ fresh: true });
    s = await safety.writeSettings(body.safety);
    await audit(req, safety.KEY, 'RENTALS_SAFETY_SETTINGS_UPDATED', { before, after: s });
  }
  let enabled;
  if (v !== undefined) {
    enabled = await writeFlag(v);
    await audit(req, 'VEHICLE_RENTALS_ENABLED', 'RENTALS_FEATURE_TOGGLED', { enabled });
    notify.listingChanged(null);
  } else {
    enabled = await readFlag({ fresh: true });
  }
  res.json({ enabled, safety: s || (await safety.readSettings()) });
};

module.exports = {
  summary, listings, listingDetail, approve, reject, licences, verifyLicence, rejectLicence,
  bookings, reports, updateReport, getSettings, putSettings, disputes, resolveDispute,
};
