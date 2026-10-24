// ZCS PG Partner owner endpoints (/api/pg-owner/*, protectOwner + requirePasswordChanged). Every read and
// write is limited to the listings linked to this owner (services/util.js ownListing / scopedHostelIds):
// another owner's PG, booking, rent row or complaint answers 404. Writes are audited (VerificationLog,
// adminId 'pg_owner:<id>') and drop the cached PG list (customer app refetches).
const { getModel } = require('../index');
const pgContent = require('../../../utils/pgContent');
const { changeBookingStatus, notifyStudentOfStatus } = require('../../../utils/pgBookings');
const {
  fail, Op, isUuid, isUniqueError, MONTH_RE, istMonth, ymdOf, addMonths, ownerText, hit,
  ownListing, scopedHostelIds, auditOwner, publishPg,
} = require('../services/util');
const S = require('../services/serialize');
const notify = require('../services/notify');
const { listingBriefs } = require('./auth');
const { COMPLAINT_STATUS, RENT_METHODS, RENT_STATUS } = require('../models');

const M = () => ({
  PGHostel: require('../../../models/PGHostel').getPGHostelModel(),
  PGRoom: require('../../../models/PGRoom').getPGRoomModel(),
  PGBooking: require('../../../models/PGBooking').getPGBookingModel(),
  User: require('../../../models/User').getUserModel(),
  Rent: getModel('PgRentRecord'),
  Complaint: getModel('PgComplaint'),
});

const OPEN_COMPLAINTS = [COMPLAINT_STATUS.OPEN, COMPLAINT_STATUS.IN_PROGRESS];
const CLOSED_BOOKINGS = ['Cancelled', 'Rejected', 'MovedOut'];
const byIdMap = (rows) => new Map(rows.map((r) => [String(r.id), r]));
const groupBy = (rows, key) => {
  const out = new Map();
  for (const r of rows) {
    const k = String(r[key]);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
};

/** pgContent validation errors -> the module's JSON error shape (with the field path). */
const content = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof pgContent.PgInputError) throw fail(err.status || 400, err.code || 'INVALID_INPUT', err.message, err.field ? { field: err.field } : undefined);
    throw err;
  }
};

/** Users, rooms and listings behind a list of bookings, for bookingForOwner. */
const bookingContext = async (bookings) => {
  const { PGHostel, PGRoom, User } = M();
  const userIds = [...new Set(bookings.map((b) => String(b.userId)))];
  const roomIds = [...new Set(bookings.map((b) => String(b.roomId)))];
  const hostelIds = [...new Set(bookings.map((b) => String(b.hostelId)))];
  const [users, rooms, hostels] = await Promise.all([
    userIds.length ? User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name'] }) : [],
    roomIds.length ? PGRoom.findAll({ where: { id: { [Op.in]: roomIds } } }) : [],
    hostelIds.length ? PGHostel.findAll({ where: { id: { [Op.in]: hostelIds } }, attributes: ['id', 'name'] }) : [],
  ]);
  const u = byIdMap(users);
  const r = byIdMap(rooms);
  const h = byIdMap(hostels);
  return (b) => S.bookingForOwner(b, { user: u.get(String(b.userId)), room: r.get(String(b.roomId)), hostel: h.get(String(b.hostelId)) });
};

// ── Home ─────────────────────────────────────────────────────────────────────────────────────────
// GET /api/pg-owner/home -> { owner, listings: [{ ..., beds: { rooms, total, occupied, vacant } }], totals, counts, month }
const home = async (req, res) => {
  const { PGHostel, PGRoom, PGBooking, Rent, Complaint } = M();
  const ids = await scopedHostelIds(req);
  const month = istMonth();
  const [pgs, rooms, pending, tenants, openComplaints, received] = ids.length ? await Promise.all([
    PGHostel.findAll({ where: { id: { [Op.in]: ids } } }),
    PGRoom.findAll({ where: { hostelId: { [Op.in]: ids } } }),
    PGBooking.count({ where: { hostelId: { [Op.in]: ids }, status: 'Pending' } }),
    PGBooking.findAll({ where: { hostelId: { [Op.in]: ids }, status: 'Confirmed' }, attributes: ['id', 'checkInDate'] }),
    Complaint.count({ where: { hostelId: { [Op.in]: ids }, status: { [Op.in]: OPEN_COMPLAINTS } } }),
    Rent.count({ where: { hostelId: { [Op.in]: ids }, month, status: RENT_STATUS.RECEIVED } }),
  ]) : [[], [], 0, [], 0, 0];
  const roomsBy = groupBy(rooms, 'hostelId');
  const pgBy = byIdMap(pgs);
  const listings = ids.map((id) => pgBy.get(id)).filter(Boolean).map((pg) => S.listingSummary(pg, roomsBy.get(String(pg.id)) || []));
  const totals = S.bedCounts(rooms);
  const rentDueTenants = tenants.filter((b) => (ymdOf(b.checkInDate) || '').slice(0, 7) <= month).length;
  res.json({
    owner: S.ownerSelf(req.owner, await listingBriefs(req.owner.id)),
    listings,
    totals,
    counts: { pendingRequests: pending, tenants: tenants.length, openComplaints, rentReceived: received, rentDue: Math.max(0, rentDueTenants - received) },
    month,
  });
};

// ── Listing detail (owner view) ──────────────────────────────────────────────────────────────────
const listingDetail = async (pg) => {
  const { PGRoom } = M();
  const rooms = await PGRoom.findAll({ where: { hostelId: pg.id }, order: [['roomNumber', 'ASC']] });
  const plain = pg.get({ plain: true });
  const active = rooms.filter((r) => r.isActive !== false).map((r) => r.get({ plain: true }));
  const stored = plain.messTimetable;
  const read = pgContent.messForRead(plain);
  const mess = stored && Array.isArray(stored.meals) && stored.meals.length
    ? { meals: stored.meals, days: stored.days || {}, notes: stored.notes || '', holidays: Array.isArray(stored.holidays) ? stored.holidays : [] }
    : read ? { meals: read.meals, days: read.days, notes: read.notes || '', holidays: [] } : null;
  return {
    ...S.listingSummary(pg, rooms),
    description: plain.description || '',
    amenities: Array.isArray(plain.amenities) ? plain.amenities.filter((a) => typeof a === 'string' && a.trim()) : [],
    // Structured groups; an older flat rules list shows as one "Other" group (saved back as groups).
    houseRules: pgContent.houseRulesForRead(plain).map((g) => ({ category: g.category, rules: g.rules })),
    photos: pgContent.photosOf(plain),
    messTimetable: mess,
    roomTypes: pgContent.buildRoomTypes(active, plain.securityDeposit).map((t) => ({
      key: t.key, label: t.label, sharingType: t.sharingType, hasAC: t.hasAC, hasAttachedBathroom: t.hasAttachedBathroom,
      rentFrom: t.rentFrom, rentTo: t.rentTo, availableBeds: t.availableBeds, totalBeds: t.totalBeds, roomCount: t.roomCount,
    })),
    rooms: rooms.map(S.roomForOwner),
    ruleCategories: pgContent.RULE_CATEGORIES.map((c) => ({ key: c, label: pgContent.RULE_CATEGORY_LABEL[c] })),
    photoCategories: pgContent.PHOTO_CATEGORIES,
  };
};

// GET /api/pg-owner/listings/:id
const getListing = async (req, res) => {
  const pg = await ownListing(req, req.params.id);
  res.json({ listing: await listingDetail(pg) });
};

// PUT /api/pg-owner/listings/:id/availability { rooms: [{ id, availableBeds }] }
// Free beds per room (0..totalBeds). These are the numbers behind the customer app's "Available N / Full"
// pills and the building's total / occupied / vacant.
const putAvailability = async (req, res) => {
  hit('owner_write', req.owner.id);
  const pg = await ownListing(req, req.params.id);
  const list = (req.body || {}).rooms;
  if (!Array.isArray(list) || !list.length || list.length > 200) throw fail(400, 'INVALID_INPUT', 'Send the rooms to update.', { field: 'rooms' });
  const { PGRoom } = M();
  const rooms = byIdMap(await PGRoom.findAll({ where: { hostelId: pg.id } }));
  const changes = [];
  const seen = new Set();
  list.forEach((item, i) => {
    const id = String((item && item.id) || '');
    const room = rooms.get(id);
    if (!room) throw fail(404, 'ROOM_NOT_FOUND', 'Room not found. Refresh and try again.', { field: `rooms[${i}].id` });
    if (seen.has(id)) throw fail(400, 'INVALID_INPUT', `Room ${room.roomNumber} is listed twice.`, { field: `rooms[${i}].id` });
    seen.add(id);
    const n = Number(item.availableBeds);
    const total = Number(room.totalBeds) || 0;
    if (!Number.isInteger(n) || n < 0 || n > total) {
      throw fail(400, 'INVALID_INPUT', `Room ${room.roomNumber}: free beds must be a whole number from 0 to ${total}.`, { field: `rooms[${i}].availableBeds` });
    }
    if (n !== Number(room.availableBeds)) changes.push({ room, from: Number(room.availableBeds), to: n });
  });
  if (changes.length) {
    const sequelize = require('../../../config/db').getSequelize();
    await sequelize.transaction(async (t) => {
      for (const c of changes) await c.room.update({ availableBeds: c.to }, { transaction: t });
    });
    await auditOwner(req, pg.id, 'PG_OWNER_AVAILABILITY_UPDATED', { changes: changes.map((c) => ({ roomId: c.room.id, roomNumber: c.room.roomNumber, from: c.from, to: c.to })) });
    publishPg(pg.id, 'availability');
    notify.admin('pg', 'updated', pg.id);
  }
  res.json({ listing: await listingDetail(pg), changed: changes.length, message: changes.length ? 'Availability saved.' : 'Nothing changed.' });
};

// PUT /api/pg-owner/listings/:id/mess { messTimetable: { meals, days, notes, holidays } | null }
const putMess = async (req, res) => {
  hit('owner_write', req.owner.id);
  const pg = await ownListing(req, req.params.id);
  const mess = await content(() => pgContent.validateMessTimetable((req.body || {}).messTimetable));
  await pg.update({ messTimetable: mess });
  await auditOwner(req, pg.id, 'PG_OWNER_MESS_UPDATED', { meals: mess ? mess.meals.map((m) => m.key) : [], days: mess ? Object.keys(mess.days) : [], holidays: mess && mess.holidays ? mess.holidays.length : 0 });
  publishPg(pg.id, 'content');
  res.json({ listing: await listingDetail(pg), message: mess ? 'Mess timetable saved.' : 'Mess timetable cleared.' });
};

// PUT /api/pg-owner/listings/:id/info { description?, amenities? }   (name, address, verification: ZCS team)
const MAX_AMENITIES = 30;
const putInfo = async (req, res) => {
  hit('owner_write', req.owner.id);
  const pg = await ownListing(req, req.params.id);
  const body = req.body || {};
  const patch = {};
  if (body.description !== undefined) patch.description = ownerText(body.description, 2000, 'Description', 'description', { multiline: true }) || null;
  if (body.amenities !== undefined) {
    if (!Array.isArray(body.amenities) || body.amenities.length > MAX_AMENITIES) throw fail(400, 'INVALID_INPUT', `List up to ${MAX_AMENITIES} amenities.`, { field: 'amenities' });
    const out = [];
    const seen = new Set();
    body.amenities.forEach((a, i) => {
      const s = ownerText(a, 40, 'Amenity', `amenities[${i}]`);
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    });
    patch.amenities = out;
  }
  if (!Object.keys(patch).length) throw fail(400, 'INVALID_INPUT', 'Nothing to save.');
  await pg.update(patch);
  await auditOwner(req, pg.id, 'PG_OWNER_INFO_UPDATED', { fields: Object.keys(patch) });
  publishPg(pg.id, 'content');
  res.json({ listing: await listingDetail(pg), message: 'Building info saved.' });
};

// PUT /api/pg-owner/listings/:id/house-rules { houseRules: [{ category, rules: [...] }] }
const putHouseRules = async (req, res) => {
  hit('owner_write', req.owner.id);
  const pg = await ownListing(req, req.params.id);
  const groups = await content(() => pgContent.validateHouseRules((req.body || {}).houseRules));
  // The flat `rules` list (older app builds) follows the groups, so both always say the same.
  await pg.update({ houseRules: groups.length ? groups : null, rules: groups.flatMap((g) => g.rules) });
  await auditOwner(req, pg.id, 'PG_OWNER_RULES_UPDATED', { groups: groups.map((g) => g.category) });
  publishPg(pg.id, 'content');
  res.json({ listing: await listingDetail(pg), message: 'House rules saved.' });
};

// PUT /api/pg-owner/listings/:id/photos { photos: [{ url, category, caption?, isCover? }] }  (max 20)
const putPhotos = async (req, res) => {
  hit('owner_write', req.owner.id);
  const pg = await ownListing(req, req.params.id);
  const imageStore = require('../../../utils/imageStore');
  const { loadMediaMeta } = require('../../../utils/mediaAccess');
  const photos = await content(() => pgContent.validatePhotos((req.body || {}).photos, {
    storeUrl: (url) => imageStore.storeImageRef(url, { req, ownerId: req.owner.id, purpose: 'pg', maxBytes: 5 * 1024 * 1024 }),
    isPrivateMedia: async (url) => {
      const id = imageStore.mediaIdOf(String(url).split('?')[0]);
      if (!id) return false;
      const m = (await loadMediaMeta([id])).get(id);
      return !!(m && m.isPrivate);
    },
  }));
  const before = (Array.isArray(pg.photos) ? pg.photos : []).length;
  await pg.update({ photos: photos.length ? photos : null, images: pgContent.imagesFromPhotos(photos) });
  await auditOwner(req, pg.id, 'PG_OWNER_PHOTOS_UPDATED', { before, after: photos.length });
  publishPg(pg.id, 'content');
  res.json({ listing: await listingDetail(pg), message: 'Photos saved.' });
};

// POST /api/pg-owner/media  (multipart field 'image', or JSON { image: base64 }) -> 201 { id, url }
// PUBLIC 'pg' media (listing photos are public); 5 MB max.
const uploadMedia = async (req, res) => {
  hit('owner_upload', req.owner.id);
  const store = require('../../../utils/imageStore');
  let buf = req.file && req.file.buffer ? req.file.buffer : null;
  if (!buf && req.body && typeof req.body.image === 'string') buf = store.decodeBase64Image(req.body.image, 5 * 1024 * 1024);
  if (buf === 'too_large') throw fail(413, 'FILE_TOO_LARGE', 'That photo is larger than 5 MB. Please pick a smaller one.');
  if (!buf || !buf.length) throw fail(400, 'NO_IMAGE', 'No photo received.');
  let saved;
  try {
    saved = await store.saveImageBytes(buf, { ownerId: req.owner.id, purpose: 'pg', isPrivate: false });
  } catch (err) {
    throw fail(err.status || 400, err.code || 'UPLOAD_FAILED', err.message);
  }
  res.status(201).json({ id: saved.id, url: `/api/campus/media/${saved.id}`, mime: saved.mime, size: saved.size });
};

// ── Booking requests ─────────────────────────────────────────────────────────────────────────────
// GET /api/pg-owner/bookings?status=Pending|Confirmed|closed|all&hostelId=
const listBookings = async (req, res) => {
  const { PGBooking } = M();
  const ids = await scopedHostelIds(req, req.query.hostelId);
  const status = String(req.query.status || 'Pending');
  const where = { hostelId: { [Op.in]: ids } };
  if (status === 'Pending' || status === 'Confirmed') where.status = status;
  else if (status === 'closed') where.status = { [Op.in]: CLOSED_BOOKINGS };
  else if (status !== 'all') throw fail(400, 'INVALID_INPUT', 'Unknown status filter.', { field: 'status' });
  const [rows, pending, confirmed] = ids.length ? await Promise.all([
    PGBooking.findAll({ where, order: [['createdAt', status === 'Pending' ? 'ASC' : 'DESC']], limit: 200 }),
    PGBooking.count({ where: { hostelId: { [Op.in]: ids }, status: 'Pending' } }),
    PGBooking.count({ where: { hostelId: { [Op.in]: ids }, status: 'Confirmed' } }),
  ]) : [[], 0, 0];
  const shape = await bookingContext(rows);
  res.json({ bookings: rows.map(shape), counts: { pending, confirmed } });
};

/** After a status change: student push + in-app notification, admin live sync, customer availability. */
const afterDecision = async (req, booking, action, extra = {}) => {
  const shape = await bookingContext([booking]);
  const view = shape(booking);
  await notifyStudentOfStatus(booking, { pgName: view.hostel.name, roomNumber: view.room ? view.room.roomNumber : null, reason: booking.decisionReason || null });
  notify.admin('pg_booking', 'updated', booking.id);
  publishPg(booking.hostelId, 'availability');
  await auditOwner(req, booking.hostelId, action, { bookingId: booking.id, roomId: booking.roomId, ...extra });
  return view;
};
const decisionBy = (req) => `pg_owner:${req.owner.id}`;
const throwIfError = (r) => { if (r && r.error) throw fail(r.status || 400, r.code || 'BOOKING_ERROR', r.error); return r; };

// POST /api/pg-owner/bookings/:id/accept { roomId? }   (roomId: accept into another room of the same PG)
const acceptBooking = async (req, res) => {
  hit('owner_write', req.owner.id);
  const ids = await scopedHostelIds(req);
  const roomId = (req.body || {}).roomId ? String(req.body.roomId) : undefined;
  if (roomId && !isUuid(roomId)) throw fail(404, 'ROOM_NOT_FOUND', 'Room not found.');
  const r = throwIfError(await changeBookingStatus(req.params.id, 'Confirmed', (b) => ids.includes(String(b.hostelId)), {
    from: ['Pending'], roomId, extra: { decidedAt: new Date(), decidedBy: decisionBy(req), decisionReason: null },
  }));
  if (!r.changed) return res.json({ booking: (await bookingContext([r.booking]))(r.booking), message: 'Already accepted.' });
  const view = await afterDecision(req, r.booking, 'PG_OWNER_BOOKING_ACCEPTED');
  res.json({ booking: view, message: `Accepted. ${view.student.firstName} has been told the bed is reserved.` });
};

// POST /api/pg-owner/bookings/:id/reject { reason }
const rejectBooking = async (req, res) => {
  hit('owner_write', req.owner.id);
  const ids = await scopedHostelIds(req);
  const reason = ownerText((req.body || {}).reason, 300, 'Reason', 'reason', { min: 3 });
  const r = throwIfError(await changeBookingStatus(req.params.id, 'Rejected', (b) => ids.includes(String(b.hostelId)), {
    from: ['Pending'], extra: { decidedAt: new Date(), decidedBy: decisionBy(req), decisionReason: reason },
  }));
  if (!r.changed) return res.json({ booking: (await bookingContext([r.booking]))(r.booking), message: 'Already declined.' });
  const view = await afterDecision(req, r.booking, 'PG_OWNER_BOOKING_REJECTED', { reason });
  res.json({ booking: view, message: `Declined. ${view.student.firstName} has been told why.` });
};

// POST /api/pg-owner/bookings/:id/move-out   (tenant left: the bed is free again)
const moveOut = async (req, res) => {
  hit('owner_write', req.owner.id);
  const ids = await scopedHostelIds(req);
  const r = throwIfError(await changeBookingStatus(req.params.id, 'MovedOut', (b) => ids.includes(String(b.hostelId)), {
    from: ['Confirmed'], extra: { movedOutAt: new Date(), decidedBy: decisionBy(req) },
  }));
  if (!r.changed) return res.json({ booking: (await bookingContext([r.booking]))(r.booking), message: 'Already moved out.' });
  const view = await afterDecision(req, r.booking, 'PG_OWNER_TENANT_MOVED_OUT');
  res.json({ booking: view, message: 'Marked as moved out. The bed is free again.' });
};

// GET /api/pg-owner/tenants?hostelId=  -> { tenants (Confirmed), past (moved out, last 180 days) }
const tenants = async (req, res) => {
  const { PGBooking, Rent } = M();
  const ids = await scopedHostelIds(req, req.query.hostelId);
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const [current, past] = ids.length ? await Promise.all([
    PGBooking.findAll({ where: { hostelId: { [Op.in]: ids }, status: 'Confirmed' }, order: [['checkInDate', 'ASC']], limit: 500 }),
    PGBooking.findAll({ where: { hostelId: { [Op.in]: ids }, status: 'MovedOut', movedOutAt: { [Op.gte]: since } }, order: [['movedOutAt', 'DESC']], limit: 100 }),
  ]) : [[], []];
  const month = istMonth();
  const paid = current.length ? await Rent.findAll({ where: { bookingId: { [Op.in]: current.map((b) => b.id) }, month, status: RENT_STATUS.RECEIVED }, attributes: ['bookingId'] }) : [];
  const paidSet = new Set(paid.map((p) => String(p.bookingId)));
  const shape = await bookingContext([...current, ...past]);
  res.json({
    month,
    tenants: current.map((b) => ({ ...shape(b), rentThisMonth: paidSet.has(String(b.id)) ? 'received' : (ymdOf(b.checkInDate) || '').slice(0, 7) <= month ? 'due' : 'not_started' })),
    past: past.map(shape),
  });
};

// ── Rent ledger (a record only: rent is paid at the PG; ZCS moves no money) ──────────────────────
const monthOf = (v, field = 'month') => {
  const m = String(v || '').trim();
  if (!MONTH_RE.test(m)) throw fail(400, 'INVALID_INPUT', 'Pick a month (YYYY-MM).', { field });
  return m;
};
/** Does this tenant owe rent for `month`? (moved in by then, not moved out before it) */
const appliesTo = (b, month) => {
  const inMonth = (ymdOf(b.checkInDate) || '9999-99').slice(0, 7);
  if (inMonth > month) return false;
  if (b.status === 'MovedOut') return (ymdOf(b.movedOutAt) || '0000-00').slice(0, 7) >= month;
  return b.status === 'Confirmed';
};

// GET /api/pg-owner/rent?month=YYYY-MM&hostelId=  -> { month, rows: [{ booking, expected, record }], summary, ledger }
const rent = async (req, res) => {
  const { PGBooking, PGRoom, Rent } = M();
  const month = req.query.month ? monthOf(req.query.month) : istMonth();
  const ids = await scopedHostelIds(req, req.query.hostelId);
  const bookings = ids.length ? await PGBooking.findAll({ where: { hostelId: { [Op.in]: ids }, status: { [Op.in]: ['Confirmed', 'MovedOut'] } }, order: [['checkInDate', 'ASC']], limit: 1000 }) : [];
  const due = bookings.filter((b) => appliesTo(b, month));
  const [records, ledger, rooms] = await Promise.all([
    due.length ? Rent.findAll({ where: { bookingId: { [Op.in]: due.map((b) => b.id) }, month } }) : [],
    ids.length ? Rent.findAll({ where: { hostelId: { [Op.in]: ids } }, order: [['updatedAt', 'DESC']], limit: 50 }) : [],
    due.length ? PGRoom.findAll({ where: { id: { [Op.in]: [...new Set(due.map((b) => String(b.roomId)))] } }, attributes: ['id', 'pricePerBed'] }) : [],
  ]);
  const recBy = new Map(records.map((r) => [String(r.bookingId), r]));
  const roomBy = byIdMap(rooms);
  const shape = await bookingContext(bookings);
  const bookingBy = byIdMap(bookings);
  const rows = due.map((b) => {
    const rec = recBy.get(String(b.id));
    return { booking: shape(b), expected: Number((roomBy.get(String(b.roomId)) || {}).pricePerBed) || 0, record: rec ? S.rentRecord(rec) : null };
  });
  const received = rows.filter((r) => r.record && r.record.status === RENT_STATUS.RECEIVED);
  res.json({
    month,
    rows,
    summary: {
      tenants: rows.length,
      received: received.length,
      due: rows.length - received.length,
      amountReceived: received.reduce((a, r) => a + (r.record.amount || 0), 0),
      amountExpected: rows.reduce((a, r) => a + r.expected, 0),
    },
    ledger: ledger.map((l) => {
      const b = bookingBy.get(String(l.bookingId));
      const v = b ? shape(b) : null;
      return { ...S.rentRecord(l), tenant: v ? { firstName: v.student.firstName, code: v.code, roomNumber: (v.room || {}).roomNumber || null } : null };
    }),
  });
};

// POST /api/pg-owner/rent { bookingId, month, amount?, method?, note? }  -> 201 { record }
const recordRent = async (req, res) => {
  hit('owner_write', req.owner.id);
  const { PGBooking, PGRoom, Rent } = M();
  const body = req.body || {};
  const ids = await scopedHostelIds(req);
  const bookingId = String(body.bookingId || '');
  const b = isUuid(bookingId) ? await PGBooking.findByPk(bookingId) : null;
  if (!b || !ids.includes(String(b.hostelId))) throw fail(404, 'NOT_FOUND', 'Tenant not found.');
  if (!['Confirmed', 'MovedOut'].includes(b.status)) throw fail(409, 'NOT_A_TENANT', 'Rent can only be recorded for accepted tenants.');
  const month = monthOf(body.month);
  if (month > addMonths(istMonth(), 1)) throw fail(400, 'INVALID_INPUT', 'Rent can be recorded up to next month.', { field: 'month' });
  if (!appliesTo(b, month)) throw fail(400, 'INVALID_INPUT', 'This tenant did not stay in that month.', { field: 'month' });
  let amount;
  if (body.amount === undefined || body.amount === null || body.amount === '') {
    const room = await PGRoom.findByPk(b.roomId, { attributes: ['pricePerBed'] });
    amount = Number(room && room.pricePerBed) || 0;
  } else {
    amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 500000) throw fail(400, 'INVALID_INPUT', 'Amount must be between ₹0 and ₹500000.', { field: 'amount' });
    amount = Math.round(amount);
  }
  const method = body.method === undefined || body.method === null || body.method === '' ? 'cash' : String(body.method).toLowerCase();
  if (!RENT_METHODS.includes(method)) throw fail(400, 'INVALID_INPUT', 'How was it paid? Cash, UPI, bank or other.', { field: 'method' });
  const note = ownerText(body.note, 200, 'Note', 'note') || null;
  const values = { amount, method, note, status: RENT_STATUS.RECEIVED, receivedAt: new Date(), voidedAt: null, voidReason: null, ownerId: req.owner.id };
  let rec = await Rent.findOne({ where: { bookingId: b.id, month } });
  if (rec && rec.status === RENT_STATUS.RECEIVED) throw fail(409, 'ALREADY_RECORDED', 'Rent for this month is already marked as received.');
  try {
    if (rec) await rec.update(values);
    else rec = await Rent.create({ hostelId: b.hostelId, bookingId: b.id, userId: b.userId, month, ...values });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'ALREADY_RECORDED', 'Rent for this month is already marked as received.');
    throw err;
  }
  await auditOwner(req, b.hostelId, 'PG_OWNER_RENT_RECORDED', { bookingId: b.id, month, amount, method });
  res.status(201).json({ record: S.rentRecord(rec), message: `Rent for ${month} marked as received.` });
};

// POST /api/pg-owner/rent/:id/void { reason? }   (undo a mistaken entry; the row is kept as VOIDED)
const voidRent = async (req, res) => {
  hit('owner_write', req.owner.id);
  const { Rent } = M();
  const ids = await scopedHostelIds(req);
  const rec = isUuid(String(req.params.id || '')) ? await Rent.findByPk(req.params.id) : null;
  if (!rec || !ids.includes(String(rec.hostelId))) throw fail(404, 'NOT_FOUND', 'Rent entry not found.');
  if (rec.status === RENT_STATUS.VOIDED) return res.json({ record: S.rentRecord(rec), message: 'Already undone.' });
  const reason = ownerText((req.body || {}).reason, 200, 'Reason', 'reason') || null;
  await rec.update({ status: RENT_STATUS.VOIDED, voidedAt: new Date(), voidReason: reason });
  await auditOwner(req, rec.hostelId, 'PG_OWNER_RENT_VOIDED', { recordId: rec.id, bookingId: rec.bookingId, month: rec.month, reason });
  res.json({ record: S.rentRecord(rec), message: 'Entry undone.' });
};

// ── Complaints ───────────────────────────────────────────────────────────────────────────────────
// GET /api/pg-owner/complaints?status=open|resolved|all&hostelId=
const listComplaints = async (req, res) => {
  const { Complaint, PGHostel } = M();
  const ids = await scopedHostelIds(req, req.query.hostelId);
  const filter = String(req.query.status || 'open');
  const where = { hostelId: { [Op.in]: ids } };
  if (filter === 'open') where.status = { [Op.in]: OPEN_COMPLAINTS };
  else if (filter === 'resolved') where.status = COMPLAINT_STATUS.RESOLVED;
  else if (filter !== 'all') throw fail(400, 'INVALID_INPUT', 'Unknown status filter.', { field: 'status' });
  const [rows, open] = ids.length ? await Promise.all([
    Complaint.findAll({ where, order: [['createdAt', 'DESC']], limit: 200 }),
    Complaint.count({ where: { hostelId: { [Op.in]: ids }, status: { [Op.in]: OPEN_COMPLAINTS } } }),
  ]) : [[], 0];
  const hostels = byIdMap(rows.length ? await PGHostel.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((r) => String(r.hostelId)))] } }, attributes: ['id', 'name'] }) : []);
  res.json({ complaints: rows.map((c) => S.complaintForOwner(c, hostels.get(String(c.hostelId)))), counts: { open } });
};

// POST /api/pg-owner/complaints/:id/reply { reply, status: IN_PROGRESS | RESOLVED }
const replyComplaint = async (req, res) => {
  hit('owner_write', req.owner.id);
  const { Complaint, PGHostel } = M();
  const ids = await scopedHostelIds(req);
  const c = isUuid(String(req.params.id || '')) ? await Complaint.findByPk(req.params.id) : null;
  if (!c || !ids.includes(String(c.hostelId))) throw fail(404, 'NOT_FOUND', 'Complaint not found.');
  const body = req.body || {};
  const status = body.status === undefined || body.status === null || body.status === '' ? COMPLAINT_STATUS.IN_PROGRESS : String(body.status).toUpperCase();
  if (![COMPLAINT_STATUS.IN_PROGRESS, COMPLAINT_STATUS.RESOLVED].includes(status)) throw fail(400, 'INVALID_INPUT', 'Status must be in progress or resolved.', { field: 'status' });
  const reply = ownerText(body.reply, 1000, 'Reply', 'reply', { multiline: true, min: 2 });
  await c.update({ ownerReply: reply, repliedAt: new Date(), status, resolvedAt: status === COMPLAINT_STATUS.RESOLVED ? new Date() : null });
  const hostel = await PGHostel.findByPk(c.hostelId, { attributes: ['id', 'name'] });
  await notify.toStudent(c.userId, status === COMPLAINT_STATUS.RESOLVED ? 'Your PG complaint is resolved' : 'Reply to your PG complaint',
    `${(hostel && hostel.name) || 'Your PG'}: ${reply.slice(0, 140)}`, { type: 'PG_COMPLAINT_REPLY', complaintId: String(c.id), hostelId: String(c.hostelId), status });
  notify.admin('pg_complaint', 'updated', c.id);
  await auditOwner(req, c.hostelId, 'PG_OWNER_COMPLAINT_REPLIED', { complaintId: c.id, status });
  res.json({ complaint: S.complaintForOwner(c, hostel), message: status === COMPLAINT_STATUS.RESOLVED ? 'Marked as resolved.' : 'Reply sent.' });
};

module.exports = {
  home, getListing, putAvailability, putMess, putInfo, putHouseRules, putPhotos, uploadMedia,
  listBookings, acceptBooking, rejectBooking, moveOut, tenants, rent, recordRent, voidRent, listComplaints, replyComplaint,
  listingDetail,
};
