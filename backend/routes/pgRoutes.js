const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getPGHostelModel } = require('../models/PGHostel');
const { getPGRoomModel } = require('../models/PGRoom');
const { getPGBookingModel } = require('../models/PGBooking');
const { getUserModel } = require('../models/User');
const { Op } = require('sequelize');

const pgContent = require('../utils/pgContent');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Zenvy housing desk WhatsApp number (students can message it from the app). Override on Render.
const PG_DESK_WHATSAPP = (process.env.PG_DESK_WHATSAPP || '9391955674').replace(/\D/g, '').slice(-10);
const pgBookingInFlight = new Set();
const ACTIVE_BOOKING = ['Pending', 'Confirmed'];

// Optional auth for public PG endpoints (admins may view inactive listings).
// DB-verified (a demoted admin's token keeps no admin view).
const viewerIsAdmin = (req) => require('../middleware/authMiddleware').isLiveAdminRequest(req);

// Push + live alert to admins about a booking (real channels; WhatsApp only if a provider is set up).
const realtime = require('../utils/realtime');
const { sendServerError } = require('../utils/httpErrors');
const notifyAdminsOfBooking = async (req, text, data) => {
  try {
    const io = req.app.get('io');
    if (io) io.to('admin-room').emit('admin_pg_booking', data);
    realtime.notifyAdmin('pg_booking', 'created', data.id);
    const admins = await getUserModel().findAll({ where: { role: 'admin', isActive: true }, attributes: ['id', 'fcmTokens'] });
    const tokens = admins.flatMap((a) => (Array.isArray(a.fcmTokens) ? a.fcmTokens : []));
    if (admins.length) {
      const { sendPushToTokens } = require('../utils/push');
      await sendPushToTokens(tokens, '🏢 New PG booking request', text, { type: 'PG_BOOKING', bookingId: String(data.id) }, { recipients: admins.map((a) => a.id) });
    }
  } catch (e) {
    console.warn('[PG_ADMIN_NOTIFY_WARN]', e.message);
  }
};

// GET all PGs (Student Search)
router.get('/', async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pgs = await PGHostel.findAll({
      where: { isActive: true },
      order: [['distanceFromCollege', 'ASC']]
    });
    // Active rooms of these PGs in one query (rent-from, free beds, room types on the cards).
    const ids = pgs.map((p) => p.id);
    const rooms = ids.length ? await getPGRoomModel().findAll({ where: { hostelId: { [Op.in]: ids }, isActive: true } }) : [];
    const byPg = new Map();
    for (const r of rooms) {
      if (!byPg.has(r.hostelId)) byPg.set(r.hostelId, []);
      byPg.get(r.hostelId).push(r);
    }
    res.json(pgs.map((p) => pgContent.publicPgListItem(p, byPg.get(p.id) || [])));
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// GET PG details & rooms (public shape: utils/pgContent.publicPg; no owner account id)
router.get('/:id', async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const PGRoom = getPGRoomModel();
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'PG not found.' });
    const pg = await PGHostel.findByPk(req.params.id, {
      include: [{ model: PGRoom, as: 'rooms', where: { isActive: true }, required: false }]
    });
    if (!pg || (pg.isActive === false && !(await viewerIsAdmin(req)))) return res.status(404).json({ message: 'PG not found.' });
    res.json(pgContent.publicPg(pg, pg.rooms || []));
  } catch (err) {
    console.error('[PG_DETAIL_ERROR]', err);
    res.status(500).json({ message: 'Could not load this residence right now.' });
  }
});

const { sendWhatsAppMessage } = require('../utils/whatsappUtil');

// POST Book a room
router.post('/:roomId/book', protect, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const PGBooking = getPGBookingModel();
    const PGHostel = getPGHostelModel();
    const User = getUserModel();
    if (!UUID_RE.test(String(req.params.roomId))) return res.status(404).json({ message: 'Room not found.' });
    const room = await PGRoom.findByPk(req.params.roomId);

    // Check-in: YYYY-MM-DD, today (IST) up to 90 days ahead. Missing = today.
    const BAD_DATE = { code: 'INVALID_CHECKIN_DATE', message: 'Pick a check-in date from today onwards.' };
    const istToday = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
    let checkInYmd = istToday;
    if (req.body.checkInDate !== undefined && req.body.checkInDate !== null && req.body.checkInDate !== '') {
      const raw = String(req.body.checkInDate).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      if (!m) return res.status(400).json(BAD_DATE);
      const probe = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (probe.toISOString().slice(0, 10) !== raw) return res.status(400).json(BAD_DATE); // e.g. 2026-02-31
      const daysAhead = Math.round((probe.getTime() - Date.parse(`${istToday}T00:00:00Z`)) / 86400000);
      if (daysAhead < 0) return res.status(400).json(BAD_DATE);
      if (daysAhead > 90) return res.status(400).json({ code: 'INVALID_CHECKIN_DATE', message: 'Check-in can be booked up to 90 days ahead.' });
      checkInYmd = raw;
    }
    const checkInDate = new Date(`${checkInYmd}T00:00:00Z`);

    if (!room || !room.isActive) return res.status(404).json({ message: 'Room not found.' });
    if (room.availableBeds <= 0) return res.status(400).json({ message: 'No beds available.' });

    const pgHostel = await PGHostel.findByPk(room.hostelId);
    if (!pgHostel || pgHostel.isActive === false) return res.status(404).json({ message: 'This residence is not taking bookings right now.' });
    const user = await User.findByPk(req.user.id);

    // One open request per student per residence.
    const openBooking = await PGBooking.findOne({
      where: { userId: req.user.id, hostelId: room.hostelId, status: { [Op.in]: ACTIVE_BOOKING } }
    });
    if (openBooking) {
      return res.status(409).json({
        code: 'BOOKING_EXISTS',
        message: `You already have a ${openBooking.status.toLowerCase()} booking request here. We'll update you soon.`,
        booking: openBooking
      });
    }

    // In-process guard + partial unique index (config/db.js) so a double tap cannot create two
    // Pending requests (two admin pushes, two WhatsApp messages).
    const pgKey = `${req.user.id}:${room.hostelId}`;
    if (pgBookingInFlight.has(pgKey)) {
      return res.status(409).json({ code: 'BOOKING_EXISTS', message: 'Your booking request is already being sent.' });
    }
    pgBookingInFlight.add(pgKey);
    let booking;
    try {
      booking = await PGBooking.create({
        userId: req.user.id,
        hostelId: room.hostelId,
        roomId: room.id,
        checkInDate,
        status: 'Pending'
      });
    } catch (createErr) {
      if (createErr && createErr.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ code: 'BOOKING_EXISTS', message: "You already have a booking request here. We'll update you soon." });
      }
      throw createErr;
    } finally {
      pgBookingInFlight.delete(pgKey);
    }

    const userName = user?.name || req.user.name || 'Zenvy Student';
    const userPhone = user?.phone || user?.mobile || req.user.phone || 'Not Provided';
    const userEmail = user?.email || req.user.email || 'Not Provided';
    const userHostel = user?.hostelBlock ? `${user.hostelBlock}, Room ${user.roomNumber || user.roomNo || ''}` : user?.address || 'SRM Campus';
    const pgName = pgHostel?.name || 'Verified Campus PG';
    const sharingType = room.sharingType ? `${room.sharingType} Sharing` : 'Standard';
    const rentAmount = room.pricePerBed || pgHostel?.baseRent || 0;
    const checkIn = checkInDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

    const whatsappMessage = `🏢 *NEW PG BOOKING REQUEST!* 🚀\n\n` +
      `👤 *Student Profile:*\n` +
      `• Name: *${userName}*\n` +
      `• Phone: *${userPhone}*\n` +
      `• Email: ${userEmail}\n` +
      `• Current Residence: ${userHostel}\n\n` +
      `🏠 *PG & Room Details:*\n` +
      `• PG Property: *${pgName}*\n` +
      `• Address: ${pgHostel?.address || 'Near SRM AP'}\n` +
      `• Room No: *Room ${room.roomNumber}* (${sharingType})\n` +
      `• Rent per Bed: *₹${rentAmount}/mo*\n` +
      `• Scheduled Check-In: *${checkIn}*\n` +
      `• Booking ID: #${(booking.id || '').substring(0, 8).toUpperCase()}\n\n` +
      `⚡ _Sent automatically via Zenvy Super Ecosystem._`;

    // Real notifications: admin push + live dashboard alert. WhatsApp only when a provider is configured.
    await notifyAdminsOfBooking(req, `${userName} requested ${sharingType} room ${room.roomNumber} at ${pgName}.`, {
      id: booking.id, hostelId: room.hostelId, roomId: room.id, userName, pgName, checkInDate: booking.checkInDate
    });
    let whatsappSent = false;
    try {
      const wa = await sendWhatsAppMessage(PG_DESK_WHATSAPP, whatsappMessage, 'PG_BOOKING');
      whatsappSent = !!wa?.success;
    } catch (waErr) {
      console.error('[PG_WHATSAPP_ERROR]', waErr.message);
    }

    // Lets the student message the housing desk themselves from WhatsApp.
    const whatsappUrl = `https://wa.me/91${PG_DESK_WHATSAPP}?text=${encodeURIComponent(whatsappMessage)}`;

    res.status(201).json({
      message: 'Booking request received. The Zenvy housing team will confirm it with you.',
      booking,
      whatsappSent,
      whatsappUrl,
      whatsappMessage
    });
  } catch (err) {
    console.error('[PG_BOOK_ERROR]', err);
    res.status(500).json({ message: 'Could not send your booking request right now.' });
  }
});

// GET my PG booking requests (newest first)
router.get('/bookings/mine', protect, async (req, res) => {
  try {
    const bookings = await getPGBookingModel().findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 50 });
    const hostelIds = [...new Set(bookings.map((b) => b.hostelId))];
    const roomIds = [...new Set(bookings.map((b) => b.roomId))];
    const [hostels, rooms] = await Promise.all([
      hostelIds.length ? getPGHostelModel().findAll({ where: { id: hostelIds }, attributes: ['id', 'name', 'address', 'images'] }) : [],
      roomIds.length ? getPGRoomModel().findAll({ where: { id: roomIds }, attributes: ['id', 'roomNumber', 'sharingType', 'pricePerBed'] }) : [],
    ]);
    const h = Object.fromEntries(hostels.map((x) => [x.id, x]));
    const r = Object.fromEntries(rooms.map((x) => [x.id, x]));
    res.json(bookings.map((b) => ({ ...b.toJSON(), hostel: h[b.hostelId] || null, room: r[b.roomId] || null })));
  } catch (err) {
    console.error('[PG_MY_BOOKINGS_ERROR]', err);
    res.status(500).json({ message: 'Could not load your bookings.' });
  }
});

// PUT cancel my booking request
router.put('/bookings/:bookingId/cancel', protect, async (req, res) => {
  try {
    const result = await changeBookingStatus(req.params.bookingId, 'Cancelled', (b) => b.userId === req.user.id);
    if (result.error) return res.status(result.status).json({ message: result.error });
    realtime.notifyAdmin('pg_booking', 'updated', result.booking.id);
    realtime.publish('pg', 'updated', result.booking.hostelId, { scope: 'availability' });
    res.json({ message: 'Booking request cancelled.', booking: result.booking });
  } catch (err) {
    console.error('[PG_CANCEL_ERROR]', err);
    res.status(500).json({ message: 'Could not cancel right now.' });
  }
});

// GET all booking requests (Admin)
router.get('/admin/bookings', protect, admin, async (req, res) => {
  try {
    const where = req.query.status ? { status: String(req.query.status) } : {};
    const bookings = await getPGBookingModel().findAll({ where, order: [['createdAt', 'DESC']], limit: 200 });
    const userIds = [...new Set(bookings.map((b) => b.userId))];
    const hostelIds = [...new Set(bookings.map((b) => b.hostelId))];
    const roomIds = [...new Set(bookings.map((b) => b.roomId))];
    const [users, hostels, rooms] = await Promise.all([
      userIds.length ? getUserModel().findAll({ where: { id: userIds }, attributes: ['id', 'name', 'phone', 'email'] }) : [],
      hostelIds.length ? getPGHostelModel().findAll({ where: { id: hostelIds }, attributes: ['id', 'name'] }) : [],
      roomIds.length ? getPGRoomModel().findAll({ where: { id: roomIds }, attributes: ['id', 'roomNumber', 'sharingType', 'availableBeds'] }) : [],
    ]);
    const u = Object.fromEntries(users.map((x) => [x.id, x]));
    const h = Object.fromEntries(hostels.map((x) => [x.id, x]));
    const r = Object.fromEntries(rooms.map((x) => [x.id, x]));
    res.json(bookings.map((b) => ({ ...b.toJSON(), user: u[b.userId] || null, hostel: h[b.hostelId] || null, room: r[b.roomId] || null })));
  } catch (err) {
    console.error('[PG_ADMIN_BOOKINGS_ERROR]', err);
    res.status(500).json({ message: 'Could not load bookings.' });
  }
});

// Duplicate open requests (same student + same PG, Pending / Confirmed more than once). They block the
// one-open-booking index; the list lets admins see them, resolve keeps one per pair and cancels the rest.
const loadOpenDuplicateGroups = async () => {
  const PGBooking = getPGBookingModel();
  const open = await PGBooking.findAll({ where: { status: { [Op.in]: ACTIVE_BOOKING } }, order: [['createdAt', 'ASC']], limit: 5000 });
  const byPair = new Map();
  open.forEach((b) => {
    const key = `${b.userId}:${b.hostelId}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(b);
  });
  return [...byPair.values()].filter((list) => list.length > 1);
};
// Kept: the confirmed one (a reserved bed), else the newest request. The rest are cancelled.
const pickKeeper = (list) => list.find((b) => b.status === 'Confirmed') || list[list.length - 1];

router.get('/admin/bookings/duplicates', protect, admin, async (req, res) => {
  try {
    const groups = await loadOpenDuplicateGroups();
    const userIds = [...new Set(groups.map((g) => g[0].userId))];
    const hostelIds = [...new Set(groups.map((g) => g[0].hostelId))];
    const [users, hostels] = await Promise.all([
      userIds.length ? getUserModel().findAll({ where: { id: userIds }, attributes: ['id', 'name', 'phone'] }) : [],
      hostelIds.length ? getPGHostelModel().findAll({ where: { id: hostelIds }, attributes: ['id', 'name'] }) : [],
    ]);
    const u = Object.fromEntries(users.map((x) => [x.id, x]));
    const h = Object.fromEntries(hostels.map((x) => [x.id, x]));
    const { getPgOpenIndexState } = require('../config/db');
    res.json({
      index: getPgOpenIndexState(),
      groups: groups.map((list) => {
        const keep = pickKeeper(list);
        return {
          userId: list[0].userId,
          hostelId: list[0].hostelId,
          user: u[list[0].userId] || null,
          hostel: h[list[0].hostelId] || null,
          keepId: keep.id,
          bookings: list.map((b) => ({ id: b.id, status: b.status, roomId: b.roomId, checkInDate: b.checkInDate, createdAt: b.createdAt })),
        };
      }),
    });
  } catch (err) {
    sendServerError(res, err, '[PG_DUPLICATES_ERROR]');
  }
});

router.post('/admin/bookings/duplicates/resolve', protect, admin, async (req, res) => {
  try {
    const groups = await loadOpenDuplicateGroups();
    let cancelled = 0;
    const failed = [];
    for (const list of groups) {
      const keep = pickKeeper(list);
      for (const b of list) {
        if (b.id === keep.id) continue;
        const result = await changeBookingStatus(b.id, 'Cancelled', () => true);
        if (result.error) failed.push({ id: b.id, error: result.error });
        else {
          cancelled++;
          realtime.notifyAdmin('pg_booking', 'updated', b.id);
        }
      }
      realtime.publish('pg', 'updated', keep.hostelId, { scope: 'availability' });
    }
    const { ensurePgOpenBookingIndex } = require('../config/db');
    const index = await ensurePgOpenBookingIndex();
    console.log(`[PG_BOOKINGS_DUPLICATES] admin ${req.user.id} resolved ${groups.length} pair(s): ${cancelled} duplicate(s) cancelled; index ${index.built ? 'built' : 'still missing'}.`);
    res.json({
      message: groups.length
        ? `${cancelled} duplicate request${cancelled === 1 ? '' : 's'} cancelled (one kept per student and PG).${index.built ? ' The duplicate guard is active again.' : ''}`
        : 'No duplicate open requests.',
      cancelled,
      pairs: groups.length,
      failed,
      index,
    });
  } catch (err) {
    sendServerError(res, err, '[PG_DUPLICATES_RESOLVE_ERROR]');
  }
});

// PUT confirm / cancel a booking request (Admin). Confirming takes a bed; cancelling a confirmed one gives it back.
router.put('/admin/bookings/:bookingId/status', protect, admin, async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!['Confirmed', 'Cancelled'].includes(status)) return res.status(400).json({ message: "status must be 'Confirmed' or 'Cancelled'" });
    const result = await changeBookingStatus(req.params.bookingId, status, () => true);
    if (result.error) return res.status(result.status).json({ message: result.error });
    realtime.notifyAdmin('pg_booking', 'updated', result.booking.id);
    realtime.publish('pg', 'updated', result.booking.hostelId, { scope: 'availability' });
    try {
      const student = await getUserModel().findByPk(result.booking.userId, { attributes: ['id', 'fcmTokens'] });
      if (student) {
        const { sendPushToTokens } = require('../utils/push');
        await sendPushToTokens(student.fcmTokens,
          status === 'Confirmed' ? '🏠 PG booking confirmed!' : 'PG booking update',
          status === 'Confirmed' ? 'Your bed is reserved. See you at check-in!' : 'Your PG booking request was cancelled.',
          { type: 'PG_BOOKING_STATUS', bookingId: String(result.booking.id), status },
          { recipients: [student.id] });
      }
    } catch (e) { console.warn('[PG_STATUS_PUSH_WARN]', e.message); }
    res.json({ message: `Booking ${status.toLowerCase()}.`, booking: result.booking });
  } catch (err) {
    console.error('[PG_STATUS_ERROR]', err);
    res.status(500).json({ message: 'Could not update the booking.' });
  }
});

// Moves a booking to Confirmed / Cancelled inside a transaction, keeping availableBeds in sync.
async function changeBookingStatus(bookingId, nextStatus, mayChange) {
  if (!UUID_RE.test(String(bookingId))) return { status: 404, error: 'Booking not found.' };
  const { getSequelize } = require('../config/db');
  return getSequelize().transaction(async (t) => {
    const PGBooking = getPGBookingModel();
    const PGRoom = getPGRoomModel();
    const booking = await PGBooking.findByPk(bookingId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!booking || !mayChange(booking)) return { status: 404, error: 'Booking not found.' };
    if (booking.status === nextStatus) return { booking };
    if (booking.status === 'Cancelled') return { status: 400, error: 'This booking was already cancelled.' };
    const room = await PGRoom.findByPk(booking.roomId, { transaction: t, lock: t.LOCK.UPDATE });
    if (nextStatus === 'Confirmed') {
      // Older duplicate rows (see /admin/bookings/duplicates): never reserve two beds for one student at one PG.
      const other = await PGBooking.findOne({
        where: { userId: booking.userId, hostelId: booking.hostelId, status: 'Confirmed', id: { [Op.ne]: booking.id } },
        transaction: t,
      });
      if (other) return { status: 409, error: 'This student already has a confirmed booking at this PG. Cancel this duplicate request instead.' };
      if (!room || room.availableBeds <= 0) return { status: 400, error: 'No beds left in this room.' };
      room.availableBeds -= 1;
      await room.save({ transaction: t });
    } else if (booking.status === 'Confirmed' && room) {
      room.availableBeds = Math.min(room.totalBeds || room.availableBeds + 1, room.availableBeds + 1);
      await room.save({ transaction: t });
    }
    booking.status = nextStatus;
    await booking.save({ transaction: t });
    return { booking };
  });
}

// Listing photos: media URLs / hosted https kept, inline base64 moved to the media table (max 12).
// B27: numbers on PG listings / rooms are validated (a negative rent, 0 beds or more free beds than
// beds used to be stored as sent). Returns an error message or null; `partial` = update (only the
// fields present are checked).
const badNumber = (v, { min = 0, max = 1000000, int = false } = {}) => {
  if (v === undefined || v === null || v === '') return false;
  const n = Number(v);
  return !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n));
};
const pgNumbersError = (b) => {
  if (badNumber(b.baseRent, { max: 500000 })) return 'Rent must be between ₹0 and ₹500000.';
  if (badNumber(b.securityDeposit, { max: 500000 })) return 'Deposit must be between ₹0 and ₹500000.';
  if (badNumber(b.distanceFromCollege, { max: 100 })) return 'Distance must be between 0 and 100 km.';
  return null;
};
const roomError = (b, current = null) => {
  if (badNumber(b.pricePerBed, { max: 500000 })) return 'Price per bed must be between ₹0 and ₹500000.';
  if (badNumber(b.totalBeds, { min: 1, max: 20, int: true })) return 'Total beds must be a whole number from 1 to 20.';
  if (badNumber(b.availableBeds, { min: 0, max: 20, int: true })) return 'Available beds must be a whole number from 0 to 20.';
  if (badNumber(b.floorNumber, { min: -2, max: 100, int: true })) return 'Floor must be a whole number.';
  if (badNumber(b.securityDeposit, { max: 500000 })) return 'Deposit must be between ₹0 and ₹500000.';
  if (b.roomType !== undefined && b.roomType !== null && (typeof b.roomType !== 'string' || b.roomType.trim().length > 48)) return 'Room type name must be at most 48 characters.';
  const total = b.totalBeds !== undefined && b.totalBeds !== null && b.totalBeds !== '' ? Number(b.totalBeds) : (current ? Number(current.totalBeds) : null);
  const avail = b.availableBeds !== undefined && b.availableBeds !== null && b.availableBeds !== '' ? Number(b.availableBeds) : (current ? Number(current.availableBeds) : null);
  if (total !== null && avail !== null && Number.isFinite(total) && Number.isFinite(avail) && avail > total) return 'Available beds cannot be more than total beds.';
  return null;
};

// Non-UUID ids answer 404 instead of a Postgres error (B27).
router.param('id', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'PG not found.' })));
router.param('roomId', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Room not found.' })));
router.param('bookingId', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Booking not found.' })));

const cleanPgImages = (images, req) =>
  require('../utils/imageStore').storeImageList(images, { req, ownerId: req.user && req.user.id, purpose: 'pg', maxItems: 12 });

const cleanArea = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : null);
const areaError = (v) => (v !== undefined && v !== null && typeof v !== 'string' ? 'Area must be text.' : typeof v === 'string' && v.trim().length > 80 ? 'Area must be at most 80 characters.' : null);
const cleanRoomType = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 48) : null);
const optNumber = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// Admin edits to listings are audited (VerificationLogs, same table as every other admin action).
const auditPg = async (req, pgId, action, details) => {
  try {
    const { getVerificationLogModel } = require('../models/VerificationLog');
    const Log = getVerificationLogModel();
    if (!Log) return;
    await Log.create({ adminId: String((req.user && req.user.id) || 'unknown'), targetId: String(pgId), action, details: JSON.stringify(details || {}).slice(0, 8000) });
  } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
};

// POST Create a PG (Admin only: listings are curated by the Zenvy team)
router.post('/', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const {
      name, address, distanceFromCollege, genderType, baseRent, securityDeposit,
      amenities, images, description, messMenu, foodTimetable, rules, contactInfo, isActive, area, isVerified
    } = req.body;
    const numErr = pgNumbersError(req.body || {}) || areaError(area);
    if (numErr) return res.status(400).json({ message: numErr });

    const imgs = await cleanPgImages(images, req);
    if (!imgs.ok) return res.status(imgs.status || 400).json({ message: imgs.message });
    const pg = await PGHostel.create({
      ownerId: req.user.id,
      name, address, distanceFromCollege, genderType, baseRent, securityDeposit,
      amenities, images: imgs.value, description, messMenu, foodTimetable, rules, contactInfo, isActive: isActive ?? true,
      area: cleanArea(area), isVerified: isVerified === true
    });
    await auditPg(req, pg.id, 'PG_CREATED', { name: pg.name });
    realtime.publish('pg', 'created', pg.id);
    res.status(201).json(pg);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// GET all PGs for Admin (includes inactive)
router.get('/admin/admin-all', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pgs = await PGHostel.findAll({
      order: [['distanceFromCollege', 'ASC']]
    });
    res.json(pgs);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// PUT Update a PG Hostel
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pg = await PGHostel.findByPk(req.params.id);
    if (!pg) return res.status(404).json({ message: 'PG not found.' });

    const {
      name, address, distanceFromCollege, genderType, baseRent, securityDeposit,
      amenities, images, description, messMenu, foodTimetable, rules, contactInfo, isActive, area, isVerified
    } = req.body;
    const numErr = pgNumbersError(req.body || {}) || areaError(area);
    if (numErr) return res.status(400).json({ message: numErr });
    let cleanImages;
    // Once a structured gallery exists it is the source of truth (PUT /:id/photos); `images` follows it.
    const hasGallery = Array.isArray(pg.photos) && pg.photos.length > 0;
    if (images !== undefined && !hasGallery) {
      const imgs = await cleanPgImages(images, req);
      if (!imgs.ok) return res.status(imgs.status || 400).json({ message: imgs.message });
      cleanImages = imgs.value;
    }
    // Only the fields sent are written (a partial PUT never blanks the rest).
    const patch = Object.fromEntries(Object.entries({
      name, address, distanceFromCollege, genderType, baseRent, securityDeposit,
      amenities, images: cleanImages, description, messMenu, foodTimetable, rules, contactInfo, isActive,
      area: area === undefined ? undefined : cleanArea(area),
      isVerified: isVerified === undefined ? undefined : isVerified === true,
    }).filter(([, v]) => v !== undefined));
    await pg.update(patch);
    await auditPg(req, pg.id, 'PG_UPDATED', { name: pg.name, fields: Object.keys(patch) });
    realtime.publish('pg', 'updated', pg.id);
    res.json(pg);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// DELETE a PG Hostel
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const PGHostel = getPGHostelModel();
    const pg = await PGHostel.findByPk(req.params.id);
    if (!pg) return res.status(404).json({ message: 'PG not found.' });
    await pg.destroy();
    await auditPg(req, req.params.id, 'PG_DELETED', { name: pg.name });
    realtime.publish('pg', 'deleted', req.params.id);
    res.json({ message: 'PG deleted successfully.' });
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// GET all rooms for a PG Hostel (Admin)
router.get('/:id/rooms-all', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const rooms = await PGRoom.findAll({
      where: { hostelId: req.params.id }
    });
    res.json(rooms);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// POST Create a Room
router.post('/:id/rooms', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const { roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive, roomType, securityDeposit } = req.body;
    const err = roomError(req.body || {});
    if (err) return res.status(400).json({ message: err });
    if (!(await getPGHostelModel().findByPk(req.params.id, { attributes: ['id'] }))) return res.status(404).json({ message: 'PG not found.' });
    const room = await PGRoom.create({
      hostelId: req.params.id,
      roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive: isActive ?? true,
      roomType: cleanRoomType(roomType), securityDeposit: optNumber(securityDeposit)
    });
    realtime.publish('pg', 'updated', req.params.id, { scope: 'room' });
    res.status(201).json(room);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// PUT Update a Room
router.put('/:id/rooms/:roomId', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const room = await PGRoom.findOne({
      where: { id: req.params.roomId, hostelId: req.params.id }
    });
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const { roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive, roomType, securityDeposit } = req.body;
    const err = roomError(req.body || {}, room);
    if (err) return res.status(400).json({ message: err });
    await room.update(Object.fromEntries(Object.entries({
      roomNumber, sharingType, pricePerBed, totalBeds, availableBeds, floorNumber, hasAttachedBathroom, hasAC, hasBalcony, furnishing, isActive,
      roomType: roomType === undefined ? undefined : cleanRoomType(roomType),
      securityDeposit: securityDeposit === undefined ? undefined : optNumber(securityDeposit),
    }).filter(([, v]) => v !== undefined)));
    realtime.publish('pg', 'updated', req.params.id, { scope: 'room' });
    res.json(room);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// DELETE a Room
router.delete('/:id/rooms/:roomId', protect, admin, async (req, res) => {
  try {
    const PGRoom = getPGRoomModel();
    const room = await PGRoom.findOne({
      where: { id: req.params.roomId, hostelId: req.params.id }
    });
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    await room.destroy();
    realtime.publish('pg', 'updated', req.params.id, { scope: 'room' });
    res.json({ message: 'Room deleted successfully.' });
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// ── Premium listing content (admin only; PG owners have no Zenvy accounts, the housing team curates) ──
// Each section has its own endpoint so a save never overwrites another section, and each write is audited.
const sendContentError = (res, err) => {
  if (err instanceof pgContent.PgInputError) {
    res.status(err.status || 400).json({ code: err.code, field: err.field, message: err.message });
    return true;
  }
  return false;
};
const loadPgOr404 = async (req, res) => {
  const pg = await getPGHostelModel().findByPk(req.params.id);
  if (!pg) res.status(404).json({ message: 'PG not found.' });
  return pg;
};
const afterContentSave = async (req, pg, action, details) => {
  await auditPg(req, pg.id, action, { name: pg.name, ...details });
  realtime.publish('pg', 'updated', pg.id, { scope: 'content' });
  const rooms = await getPGRoomModel().findAll({ where: { hostelId: pg.id, isActive: true } });
  return pgContent.publicPg(pg, rooms);
};

// PUT /api/pg/:id/photos  { photos: [{ url, category, caption?, order?, roomType?, isCover? }] }  (max 20)
// url: an uploaded media URL (/api/upload), a hosted https image or inline base64 (stored as PUBLIC 'pg'
// media). Private media (ID cards, chat photos, bills ...) is refused.
router.put('/:id/photos', protect, admin, async (req, res) => {
  try {
    const pg = await loadPgOr404(req, res);
    if (!pg) return;
    const imageStore = require('../utils/imageStore');
    const { loadMediaMeta } = require('../utils/mediaAccess');
    let photos;
    try {
      photos = await pgContent.validatePhotos((req.body || {}).photos, {
        storeUrl: (url) => imageStore.storeImageRef(url, { req, ownerId: req.user.id, purpose: 'pg', maxBytes: 5 * 1024 * 1024 }),
        isPrivateMedia: async (url) => {
          const id = imageStore.mediaIdOf(String(url).split('?')[0]);
          if (!id) return false;
          const m = (await loadMediaMeta([id])).get(id);
          return !!(m && m.isPrivate);
        },
      });
    } catch (err) {
      if (sendContentError(res, err)) return;
      throw err;
    }
    const before = (Array.isArray(pg.photos) ? pg.photos : []).length;
    await pg.update({ photos: photos.length ? photos : null, images: pgContent.imagesFromPhotos(photos) });
    res.json(await afterContentSave(req, pg, 'PG_PHOTOS_UPDATED', { before, after: photos.length, cover: (photos.find((p) => p.isCover) || {}).id || null }));
  } catch (err) {
    sendServerError(res, err, '[PG_PHOTOS_ERROR]');
  }
});

// PUT /api/pg/:id/videos  { videos: [{ youtubeUrl, title?, roomType?, order? }] }  (admin only, YouTube only)
router.put('/:id/videos', protect, admin, async (req, res) => {
  try {
    const pg = await loadPgOr404(req, res);
    if (!pg) return;
    let videos;
    try { videos = pgContent.validateVideos((req.body || {}).videos); } catch (err) {
      if (sendContentError(res, err)) return;
      throw err;
    }
    await pg.update({ videos: videos.length ? videos : null });
    res.json(await afterContentSave(req, pg, 'PG_VIDEOS_UPDATED', { videos: videos.map((v) => v.youtubeId) }));
  } catch (err) {
    sendServerError(res, err, '[PG_VIDEOS_ERROR]');
  }
});

// PUT /api/pg/:id/mess  { messTimetable: { meals, days, notes } | null }
router.put('/:id/mess', protect, admin, async (req, res) => {
  try {
    const pg = await loadPgOr404(req, res);
    if (!pg) return;
    let mess;
    try { mess = pgContent.validateMessTimetable((req.body || {}).messTimetable); } catch (err) {
      if (sendContentError(res, err)) return;
      throw err;
    }
    await pg.update({ messTimetable: mess });
    res.json(await afterContentSave(req, pg, 'PG_MESS_UPDATED', { meals: mess ? mess.meals.map((m) => m.key) : [], days: mess ? Object.keys(mess.days) : [] }));
  } catch (err) {
    sendServerError(res, err, '[PG_MESS_ERROR]');
  }
});

// PUT /api/pg/:id/timings  { timings: { gateOpen, gateClose, visitorFrom, visitorTo, checkIn, checkOut, quietFrom, quietTo, curfewNote } | null }
router.put('/:id/timings', protect, admin, async (req, res) => {
  try {
    const pg = await loadPgOr404(req, res);
    if (!pg) return;
    let timings;
    try { timings = pgContent.validateTimings((req.body || {}).timings); } catch (err) {
      if (sendContentError(res, err)) return;
      throw err;
    }
    await pg.update({ timings });
    res.json(await afterContentSave(req, pg, 'PG_TIMINGS_UPDATED', { fields: timings ? Object.keys(timings) : [] }));
  } catch (err) {
    sendServerError(res, err, '[PG_TIMINGS_ERROR]');
  }
});

module.exports = router;

