const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getPGHostelModel } = require('../models/PGHostel');
const { getPGRoomModel } = require('../models/PGRoom');
const { getPGBookingModel } = require('../models/PGBooking');
const { getPGReviewModel } = require('../models/PGReview');
const { getPgPromotionModel } = require('../models/PgPromotion');
const { getUserModel } = require('../models/User');
const { Op } = require('sequelize');

const pgContent = require('../utils/pgContent');
const { changeBookingStatus } = require('../utils/pgBookings');
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
const responseCache = require('../utils/responseCache');
// Every PG change also drops the cached list-page payload (GET /api/pg/home).
const publishPg = (action, id, extra) => {
  try { responseCache.invalidate('pg_home'); } catch (e) { console.warn('[PG_HOME_CACHE]', e.message); }
  realtime.publish('pg', action, id, extra);
};
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

// Average rating + count of VISIBLE reviews per PG: Map<hostelId, { average, count }>.
const reviewSummaries = async (ids) => {
  const out = new Map();
  const PGReview = getPGReviewModel();
  if (!PGReview || !ids.length) return out;
  const { fn, col } = require('sequelize');
  const rows = await PGReview.findAll({
    attributes: ['hostelId', [fn('AVG', col('rating')), 'avg'], [fn('COUNT', col('id')), 'n']],
    where: { hostelId: { [Op.in]: ids }, status: 'visible' },
    group: ['hostelId'],
    raw: true,
  });
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (n) out.set(r.hostelId, { average: Math.round(Number(r.avg) * 10) / 10, count: n });
  }
  return out;
};

// Active PGs as list items (one rooms query + one review roll-up), nearest first.
const loadActiveListItems = async () => {
  const pgs = await getPGHostelModel().findAll({ where: { isActive: true }, order: [['distanceFromCollege', 'ASC']] });
  const ids = pgs.map((p) => p.id);
  const [rooms, summaries] = await Promise.all([
    ids.length ? getPGRoomModel().findAll({ where: { hostelId: { [Op.in]: ids }, isActive: true } }) : [],
    reviewSummaries(ids),
  ]);
  const byPg = new Map();
  for (const r of rooms) {
    if (!byPg.has(r.hostelId)) byPg.set(r.hostelId, []);
    byPg.get(r.hostelId).push(r);
  }
  return { pgs, items: pgs.map((p) => pgContent.publicPgListItem(p, byPg.get(p.id) || [], { reviewSummary: summaries.get(p.id) || null })) };
};

// GET all PGs (Student Search)
router.get('/', async (req, res) => {
  try {
    const { items } = await loadActiveListItems();
    res.json(items);
  } catch (err) {
    sendServerError(res, err, '[PGROUTES_ERROR]');
  }
});

// GET /api/pg/home: everything the PG list page shows in one request (cached; every PG / promotion /
// review write clears it). Rails are id lists into `pgs`, shown only with 2+ items (a rail repeating the
// whole list of a small catalogue adds nothing).
const RAIL_MIN = 2;
const RAIL_MAX = 10;
const NEW_DAYS = 45;
router.get('/home', responseCache.cacheGet('pg_home', { ttlMs: 60 * 1000 }), async (req, res) => {
  try {
    const { pgs, items } = await loadActiveListItems();
    const byId = new Map(items.map((x) => [x.id, x]));
    const now = Date.now();
    const PgPromotion = getPgPromotionModel();
    const promoRows = PgPromotion ? await PgPromotion.findAll({
      where: { isActive: true, startsAt: { [Op.lte]: new Date(now) }, endsAt: { [Op.gt]: new Date(now) } },
      order: [['priority', 'ASC'], ['createdAt', 'DESC']],
      limit: 20,
    }) : [];
    const promotions = promoRows.filter((p) => byId.has(p.hostelId)).slice(0, 8).map((p) => pgContent.publicPromotion(p, byId.get(p.hostelId)));

    const tours = [];
    for (const pg of pgs) {
      for (const v of pgContent.videosForRead(pg.videos).slice(0, 2)) {
        if (tours.length >= 12) break;
        const it = byId.get(pg.id);
        tours.push({ pgId: pg.id, pgName: it.name, area: it.area, rentFrom: it.rentFrom, video: v });
      }
    }
    const rent = (x) => Number(x.rentFrom ?? x.baseRent) || Infinity;
    const gender = (x) => String(x.genderType || '').toLowerCase();
    const rail = (key, title, list) => ({ key, title, ids: list.slice(0, RAIL_MAX).map((x) => x.id) });
    const rails = [
      rail('near', 'Near campus', items.filter((x) => Number(x.distanceFromCollege) <= 2)),
      rail('verified', 'Verified', items.filter((x) => x.isVerified)),
      rail('new', 'New on ZCS', items.filter((x) => x.createdAt && now - new Date(x.createdAt).getTime() <= NEW_DAYS * 86400000)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))),
      // "Up to": the rail includes ₹6,000 itself (same words as the app's budget filter).
      rail('budget', 'Up to ₹6,000', items.filter((x) => rent(x) <= 6000).sort((a, b) => rent(a) - rent(b))),
      rail('girls', 'For girls', items.filter((x) => gender(x).startsWith('girl'))),
      rail('boys', 'For boys', items.filter((x) => gender(x).startsWith('boy'))),
    ].filter((r) => r.ids.length >= RAIL_MIN);
    res.json({ promotions, tours, rails, pgs: items });
  } catch (err) {
    sendServerError(res, err, '[PG_HOME_ERROR]');
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
    const summaries = await reviewSummaries([pg.id]);
    res.json(pgContent.publicPg(pg, pg.rooms || [], { reviewSummary: summaries.get(pg.id) || null }));
  } catch (err) {
    console.error('[PG_DETAIL_ERROR]', err);
    res.status(500).json({ message: 'Could not load this residence right now.' });
  }
});

const { sendWhatsAppMessage } = require('../utils/whatsappUtil');

// Booking request limits (31 Oct 2026). A student sends at most PG_DAILY_REQUESTS requests a day, and the admins / the
// PG owner / the WhatsApp desk hear about one student's requests for one residence once per PG_NOTIFY_ONCE_MS (in
// memory: after a restart at most one more round).
const PG_DAILY_REQUESTS = 10;
const PG_NOTIFY_ONCE_MS = 30 * 60 * 1000;
const pgNotifiedAt = new Map();
const pgNotifyFirst = (key, now = Date.now()) => {
  const last = pgNotifiedAt.get(key);
  if (last && now - last < PG_NOTIFY_ONCE_MS) return false;
  pgNotifiedAt.set(key, now);
  if (pgNotifiedAt.size > 5000) for (const [k, t] of pgNotifiedAt) if (now - t >= PG_NOTIFY_ONCE_MS) pgNotifiedAt.delete(k);
  return true;
};

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

    // Optional (shown to the PG owner): planned stay in months and a short note. Never a phone number:
    // students and owners talk through the ZCS housing desk.
    let durationMonths = null;
    if (req.body.durationMonths !== undefined && req.body.durationMonths !== null && req.body.durationMonths !== '') {
      const n = Number(req.body.durationMonths);
      if (!Number.isInteger(n) || n < 1 || n > 24) return res.status(400).json({ code: 'INVALID_DURATION', field: 'durationMonths', message: 'Stay length must be 1 to 24 months.' });
      durationMonths = n;
    }
    let note = null;
    if (req.body.note !== undefined && req.body.note !== null && req.body.note !== '') {
      if (typeof req.body.note !== 'string') return res.status(400).json({ code: 'INVALID_NOTE', field: 'note', message: 'The note must be text.' });
      // eslint-disable-next-line no-control-regex
      const clean = req.body.note.replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length > 300) return res.status(400).json({ code: 'INVALID_NOTE', field: 'note', message: 'The note must be at most 300 characters.' });
      if (pgContent.PHONE_RE.test(clean)) return res.status(400).json({ code: 'INVALID_NOTE', field: 'note', message: 'Please leave out phone numbers. The ZCS housing desk connects you with the PG.' });
      note = clean || null;
    }

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

    // At most PG_DAILY_REQUESTS requests a day per student, cancelled ones included (31 Oct 2026): book -> cancel ->
    // book loops pushed every admin and the PG owner each time. Counted in the database, so a restart never resets it.
    const lastDay = await PGBooking.count({ where: { userId: req.user.id, createdAt: { [Op.gt]: new Date(Date.now() - 24 * 3600 * 1000) } } });
    if (lastDay >= PG_DAILY_REQUESTS) {
      return res.status(429).json({
        code: 'BOOKING_LIMIT',
        message: 'You have sent a lot of booking requests today. Please try again tomorrow, or talk to the ZCS housing team.',
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
        status: 'Pending',
        durationMonths,
        note
      });
    } catch (createErr) {
      if (createErr && createErr.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ code: 'BOOKING_EXISTS', message: "You already have a booking request here. We'll update you soon." });
      }
      throw createErr;
    } finally {
      pgBookingInFlight.delete(pgKey);
    }

    const userName = user?.name || req.user.name || 'ZCS Student';
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
      `⚡ _Sent automatically via ZCS Super Ecosystem._`;

    // Real notifications: admin push + live dashboard alert. WhatsApp only when a provider is configured.
    // Once per student and residence in PG_NOTIFY_ONCE_MS: a request withdrawn and sent again is still listed in
    // admin and in the PG Partner app, without a second round of pushes and WhatsApp messages.
    let whatsappSent = false;
    if (pgNotifyFirst(`${req.user.id}:${room.hostelId}`)) {
      await notifyAdminsOfBooking(req, `${userName} requested ${sharingType} room ${room.roomNumber} at ${pgName}.`, {
        id: booking.id, hostelId: room.hostelId, roomId: room.id, userName, pgName, checkInDate: booking.checkInDate
      });
      // The PG's owner (ZCS PG Partner app), when the listing is linked to an owner account: first name only.
      await require('../modules/pgOwner/services/notify').toListingOwners(room.hostelId, 'New booking request',
        `${pgContent.firstNameOf(userName)} asked for a ${sharingType.toLowerCase()} bed at ${pgName} from ${checkIn}.`,
        { type: 'PG_OWNER_BOOKING', bookingId: String(booking.id), hostelId: String(room.hostelId) });
      try {
        const wa = await sendWhatsAppMessage(PG_DESK_WHATSAPP, whatsappMessage, 'PG_BOOKING');
        whatsappSent = !!wa?.success;
      } catch (waErr) {
        console.error('[PG_WHATSAPP_ERROR]', waErr.message);
      }
    }

    // Lets the student message the housing desk themselves from WhatsApp.
    const whatsappUrl = `https://wa.me/91${PG_DESK_WHATSAPP}?text=${encodeURIComponent(whatsappMessage)}`;

    res.status(201).json({
      message: 'Booking request received. The ZCS housing team will confirm it with you.',
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
    publishPg('updated', result.booking.hostelId, { scope: 'availability' });
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
      publishPg('updated', keep.hostelId, { scope: 'availability' });
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
    publishPg('updated', result.booking.hostelId, { scope: 'availability' });
    // The student's open "My PG bookings" reloads at once, as for a PG owner's decision (utils/pgBookings).
    try { realtime.toUser(result.booking.userId, 'pg:changed', { bookingId: String(result.booking.id), status: result.booking.status }); } catch { /* live update only */ }
    try {
      const student = await getUserModel().findByPk(result.booking.userId, { attributes: ['id', 'fcmTokens'] });
      if (student) {
        const { sendPushToTokens } = require('../utils/push');
        await sendPushToTokens(student.fcmTokens,
          status === 'Confirmed' ? 'PG booking confirmed' : 'PG booking update',
          status === 'Confirmed' ? 'Your bed is reserved. The housing team will share move-in details.' : 'Your PG booking request was cancelled.',
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

// Status changes (beds kept in sync) live in utils/pgBookings.js, shared with the ZCS PG Partner app.

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

// `keep` = the listing's current images (edits): links already on it pass unchanged.
const cleanPgImages = (images, req, keep = null) =>
  require('../utils/imageStore').storeImageList(images, { req, ownerId: req.user && req.user.id, purpose: 'pg', maxItems: 12, keep });

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
    publishPg('created', pg.id);
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
      const imgs = await cleanPgImages(images, req, Array.isArray(pg.images) ? pg.images : null);
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
    publishPg('updated', pg.id);
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
    publishPg('deleted', req.params.id);
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
    publishPg('updated', req.params.id, { scope: 'room' });
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
    publishPg('updated', req.params.id, { scope: 'room' });
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
    publishPg('updated', req.params.id, { scope: 'room' });
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
  publishPg('updated', pg.id, { scope: 'content' });
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
    // Photos already on the listing pass unchanged (the whole gallery is re-sent on every edit).
    const keep = (Array.isArray(pg.photos) ? pg.photos : []).map((p) => p && p.url).concat(Array.isArray(pg.images) ? pg.images : []);
    let photos;
    try {
      photos = await pgContent.validatePhotos((req.body || {}).photos, {
        storeUrl: (url) => imageStore.storeImageRef(url, { req, ownerId: req.user.id, purpose: 'pg', maxBytes: 5 * 1024 * 1024, keep }),
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
    const sentMess = (req.body || {}).messTimetable;
    try { mess = pgContent.validateMessTimetable(sentMess); } catch (err) {
      if (sendContentError(res, err)) return;
      throw err;
    }
    // The admin editor does not send the owner's mess holidays (ZCS PG Partner app): keep them.
    const keptHolidays = pg.messTimetable && Array.isArray(pg.messTimetable.holidays) ? pg.messTimetable.holidays : [];
    if (mess && sentMess && sentMess.holidays === undefined && keptHolidays.length) mess.holidays = keptHolidays;
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

// ── v2 sections (admin only, one endpoint each, audited) ────────────────────────────────────────
//   PUT /api/pg/:id/highlights      { highlights: ['5 min walk to Gate 1', ...] }
//   PUT /api/pg/:id/house-rules     { houseRules: [{ category, rules: [...] }] }
//   PUT /api/pg/:id/policies        { policies: { booking, rent, deposit, stay, cancellation, included, extraCharges, maintenance } }
//   PUT /api/pg/:id/safety          { safety: { cctv, entry, guard, ... } }
//   PUT /api/pg/:id/move-in         { moveIn: { documents, bring, provided, steps } }
//   PUT /api/pg/:id/location-guide  { locationGuide: { howToReach, nearby } }
//   PUT /api/pg/:id/faq             { faq: [{ q, a }] }
// An empty value (null, [], {}) clears the section; the app then hides it.
for (const [path, w] of Object.entries(pgContent.SECTION_WRITERS)) {
  router.put(`/:id/${path}`, protect, admin, async (req, res) => {
    try {
      const pg = await loadPgOr404(req, res);
      if (!pg) return;
      let value;
      try { value = w.validate((req.body || {})[w.field]); } catch (err) {
        if (sendContentError(res, err)) return;
        throw err;
      }
      const empty = value === null || (Array.isArray(value) && !value.length);
      await pg.update({ [w.field]: empty ? null : value });
      const shape = await afterContentSave(req, pg, w.audit, { cleared: empty, size: empty ? 0 : JSON.stringify(value).length });
      // The saved section exactly as stored (the public read may show fallbacks such as the older flat
      // rules list or the warden name from the contact fields; admin editors need the real value).
      res.json({ ...shape, [w.field]: empty ? (Array.isArray(value) ? [] : null) : value });
    } catch (err) {
      sendServerError(res, err, '[PG_SECTION_ERROR]');
    }
  });
}

// ── Reviews ─────────────────────────────────────────────────────────────────────────────────────
// Only students who stayed: a Confirmed (or MovedOut) booking at this PG whose check-in date has arrived. One review
// per booking (unique index on bookingId). Public reads show visible reviews: rating, text, first name, date.
router.param('reviewId', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Review not found.' })));
router.param('promoId', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Promotion not found.' })));

// Check-in dates are stored as the IST calendar day at 00:00 UTC (see POST /:roomId/book), so 'started'
// means check-in day <= today in IST.
const istTodayStart = () => new Date(new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00Z');
const reviewEligibility = async (userId, hostelId) => {
  const bookings = await getPGBookingModel().findAll({
    where: { userId, hostelId, status: { [Op.in]: ['Confirmed', 'MovedOut'] }, checkInDate: { [Op.lte]: istTodayStart() } },
    order: [['checkInDate', 'DESC']],
  });
  if (!bookings.length) return { eligibleBookingId: null, reviewed: [] };
  const reviews = await getPGReviewModel().findAll({ where: { bookingId: { [Op.in]: bookings.map((b) => b.id) } } });
  const reviewed = new Set(reviews.map((r) => r.bookingId));
  const open = bookings.find((b) => !reviewed.has(b.id));
  return { eligibleBookingId: open ? open.id : null, reviews, bookingIds: bookings.map((b) => b.id) };
};
const STAY_REQUIRED = 'Reviews are from students who stayed here: a confirmed booking whose check-in date has passed.';

// Admin moderation list (before /:id/... so "admin" is never read as a PG id).
router.get('/admin/reviews', protect, admin, async (req, res) => {
  try {
    const where = {};
    if (req.query.hostelId && UUID_RE.test(String(req.query.hostelId))) where.hostelId = String(req.query.hostelId);
    if (req.query.filter === 'hidden') where.status = 'hidden';
    if (req.query.filter === 'reported') where.reportCount = { [Op.gt]: 0 };
    const rows = await getPGReviewModel().findAll({ where, order: [['reportCount', 'DESC'], ['createdAt', 'DESC']], limit: 200 });
    const hostelIds = [...new Set(rows.map((r) => r.hostelId))];
    const hostels = hostelIds.length ? await getPGHostelModel().findAll({ where: { id: hostelIds }, attributes: ['id', 'name'] }) : [];
    const h = Object.fromEntries(hostels.map((x) => [x.id, x.name]));
    res.json(rows.map((r) => ({ ...r.toJSON(), hostelName: h[r.hostelId] || null })));
  } catch (err) {
    sendServerError(res, err, '[PG_REVIEWS_ADMIN_ERROR]');
  }
});

// PUT /api/pg/admin/reviews/:reviewId  { hidden: true|false, reason? }
router.put('/admin/reviews/:reviewId', protect, admin, async (req, res) => {
  try {
    const review = await getPGReviewModel().findByPk(req.params.reviewId);
    if (!review) return res.status(404).json({ message: 'Review not found.' });
    const hidden = (req.body || {}).hidden;
    if (typeof hidden !== 'boolean') return res.status(400).json({ message: 'hidden must be true or false.' });
    const reason = typeof req.body.reason === 'string' ? req.body.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (hidden && !reason) return res.status(400).json({ field: 'reason', message: 'Give a reason for hiding this review (kept in the audit log).' });
    await review.update({ status: hidden ? 'hidden' : 'visible', hiddenReason: hidden ? reason : null });
    await auditPg(req, review.hostelId, hidden ? 'PG_REVIEW_HIDDEN' : 'PG_REVIEW_SHOWN', { reviewId: review.id, reason: reason || null });
    publishPg('updated', review.hostelId, { scope: 'reviews' });
    res.json(review);
  } catch (err) {
    sendServerError(res, err, '[PG_REVIEW_HIDE_ERROR]');
  }
});

// POST /api/pg/reviews/:reviewId/report  { reason: spam | offensive | fake | personal_info | other }
router.post('/reviews/:reviewId/report', protect, async (req, res) => {
  try {
    const review = await getPGReviewModel().findByPk(req.params.reviewId);
    if (!review || review.status !== 'visible') return res.status(404).json({ message: 'Review not found.' });
    if (review.userId === req.user.id) return res.status(400).json({ message: 'You cannot report your own review.' });
    const reason = String((req.body || {}).reason || '').toLowerCase();
    if (!pgContent.REVIEW_REPORT_REASONS.includes(reason)) return res.status(400).json({ field: 'reason', message: 'Choose a reason.' });
    const reports = review.reports;
    if (reports.some((r) => r.userId === req.user.id)) return res.json({ message: 'Thanks. You already reported this review.', alreadyReported: true });
    reports.push({ userId: req.user.id, reason, at: new Date().toISOString() });
    await review.update({ reports: reports.slice(-100), reportCount: reports.length });
    realtime.notifyAdmin('pg', 'updated', review.hostelId, { scope: 'reviews' });
    res.json({ message: 'Thanks. The ZCS team will review it.' });
  } catch (err) {
    sendServerError(res, err, '[PG_REVIEW_REPORT_ERROR]');
  }
});

// GET /api/pg/:id/reviews?page=1&limit=10  (public)
router.get('/:id/reviews', async (req, res) => {
  try {
    const pg = await getPGHostelModel().findByPk(req.params.id, { attributes: ['id', 'isActive'] });
    if (!pg || pg.isActive === false) return res.status(404).json({ message: 'PG not found.' });
    const page = Math.max(1, Math.min(100, parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit, 10) || 10));
    const PGReview = getPGReviewModel();
    const where = { hostelId: pg.id, status: 'visible' };
    const [rows, all] = await Promise.all([
      PGReview.findAll({ where, order: [['createdAt', 'DESC']], offset: (page - 1) * limit, limit: limit + 1 }),
      PGReview.findAll({ where, attributes: ['rating'], raw: true }),
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    all.forEach((r) => { if (distribution[r.rating] !== undefined) distribution[r.rating]++; });
    const count = all.length;
    const average = count ? Math.round((all.reduce((a, r) => a + r.rating, 0) / count) * 10) / 10 : null;
    res.json({ summary: { average, count, distribution }, items: rows.slice(0, limit).map(pgContent.publicReview), page, hasMore: rows.length > limit });
  } catch (err) {
    sendServerError(res, err, '[PG_REVIEWS_ERROR]');
  }
});

// GET /api/pg/:id/reviews/eligibility  -> { canReview, reason, myReviews }
router.get('/:id/reviews/eligibility', protect, async (req, res) => {
  try {
    const e = await reviewEligibility(req.user.id, req.params.id);
    res.json({
      canReview: !!e.eligibleBookingId,
      reason: e.eligibleBookingId ? null : (e.reviews && e.reviews.length ? 'You have reviewed your stay here.' : STAY_REQUIRED),
      myReviews: (e.reviews || []).map((r) => ({ ...pgContent.publicReview(r), status: r.status })),
    });
  } catch (err) {
    sendServerError(res, err, '[PG_REVIEW_ELIGIBILITY_ERROR]');
  }
});

// POST /api/pg/:id/reviews  { rating: 1-5, text, bookingId? }
router.post('/:id/reviews', protect, async (req, res) => {
  try {
    const pg = await getPGHostelModel().findByPk(req.params.id, { attributes: ['id', 'isActive', 'name'] });
    if (!pg || pg.isActive === false) return res.status(404).json({ message: 'PG not found.' });
    let input;
    try { input = pgContent.validateReview(req.body); } catch (err) {
      if (sendContentError(res, err)) return;
      throw err;
    }
    const e = await reviewEligibility(req.user.id, pg.id);
    let bookingId = e.eligibleBookingId;
    const asked = (req.body || {}).bookingId;
    if (asked !== undefined && asked !== null && asked !== '') {
      if (!e.bookingIds || !e.bookingIds.includes(String(asked))) return res.status(403).json({ code: 'REVIEW_NOT_ALLOWED', message: STAY_REQUIRED });
      if (e.reviews && e.reviews.some((r) => r.bookingId === String(asked))) return res.status(409).json({ code: 'REVIEW_EXISTS', message: 'You have already reviewed this stay.' });
      bookingId = String(asked);
    }
    if (!bookingId) {
      if (e.reviews && e.reviews.length) return res.status(409).json({ code: 'REVIEW_EXISTS', message: 'You have already reviewed your stay here.' });
      return res.status(403).json({ code: 'REVIEW_NOT_ALLOWED', message: STAY_REQUIRED });
    }
    const user = await getUserModel().findByPk(req.user.id, { attributes: ['id', 'name'] });
    let review;
    try {
      review = await getPGReviewModel().create({
        hostelId: pg.id, userId: req.user.id, bookingId, rating: input.rating, text: input.text,
        firstName: pgContent.firstNameOf(user && user.name), status: 'visible', reports: [], reportCount: 0,
      });
    } catch (createErr) {
      if (createErr && createErr.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ code: 'REVIEW_EXISTS', message: 'You have already reviewed this stay.' });
      throw createErr;
    }
    realtime.notifyAdmin('pg', 'updated', pg.id, { scope: 'reviews' });
    publishPg('updated', pg.id, { scope: 'reviews' });
    res.status(201).json({ message: 'Thanks for reviewing your stay.', review: pgContent.publicReview(review) });
  } catch (err) {
    sendServerError(res, err, '[PG_REVIEW_CREATE_ERROR]');
  }
});

// ── Promotions (admin only; shown on the PG list page through GET /api/pg/home) ─────────────────
const promoState = (p, now = Date.now()) => {
  if (p.isActive === false) return 'paused';
  if (new Date(p.endsAt).getTime() <= now) return 'ended';
  if (new Date(p.startsAt).getTime() > now) return 'scheduled';
  return 'live';
};
const adminPromo = (p, names) => ({ ...p.toJSON(), state: promoState(p), pgName: names[p.hostelId] || null, ctaLabel: pgContent.PROMO_CTA_LABEL[p.cta] });
const promoNames = async (rows) => {
  const ids = [...new Set(rows.map((r) => r.hostelId))];
  const hs = ids.length ? await getPGHostelModel().findAll({ where: { id: ids }, attributes: ['id', 'name', 'isActive'] }) : [];
  return Object.fromEntries(hs.map((h) => [h.id, h.name]));
};
// Validates + stores (image) a promotion write. Returns { values } or sends the error and returns null.
const preparePromotion = async (req, res, current) => {
  let parsed;
  try { parsed = pgContent.validatePromotion(req.body, { current }); } catch (err) {
    if (sendContentError(res, err)) return null;
    throw err;
  }
  const pg = await getPGHostelModel().findByPk(parsed.values.hostelId, { attributes: ['id', 'isActive'] });
  if (!pg) { res.status(400).json({ field: 'hostelId', message: 'That PG does not exist.' }); return null; }
  // A listed PG is needed to create a promotion, to switch one back on, or to point it at another PG.
  // Pausing, editing or deleting a promotion whose PG was hidden later stays possible (GET /home never
  // shows promotions of hidden PGs).
  const cur = current ? current.get({ plain: true }) : null;
  const needsListedPg = !cur || cur.hostelId !== parsed.values.hostelId || (parsed.values.isActive && cur.isActive === false);
  if (pg.isActive === false && needsListedPg) { res.status(400).json({ field: 'hostelId', message: 'That PG is hidden. List it before promoting it.' }); return null; }
  const values = { ...parsed.values };
  if (values.type === 'IMAGE') {
    const imageStore = require('../utils/imageStore');
    const id = imageStore.mediaIdOf(String(parsed.imageUrl).split('?')[0]);
    if (id) {
      const m = (await require('../utils/mediaAccess').loadMediaMeta([id])).get(id);
      if (m && m.isPrivate) { res.status(400).json({ field: 'imageUrl', message: 'That image is private and cannot be used on a promotion.' }); return null; }
    }
    const stored = await imageStore.storeImageRef(parsed.imageUrl, { req, ownerId: req.user.id, purpose: 'pg', maxBytes: 5 * 1024 * 1024 });
    if (!stored || !stored.ok || !stored.value) { res.status((stored && stored.status) || 400).json({ field: 'imageUrl', message: (stored && stored.message) || 'That image could not be used.' }); return null; }
    if (String(stored.value).length > 600) { res.status(400).json({ field: 'imageUrl', message: 'Upload the image first (the link is too long).' }); return null; }
    values.imageUrl = stored.value;
  } else {
    values.imageUrl = null;
  }
  return values;
};
const afterPromoWrite = (req, id, action, details) => {
  try { responseCache.invalidate('pg_home'); } catch { /* best effort */ }
  realtime.notifyAdmin('pg', 'updated', null, { scope: 'promotions' });
  return auditPg(req, id, `PG_PROMOTION_${action.toUpperCase()}`, details);
};

router.get('/admin/promotions', protect, admin, async (req, res) => {
  try {
    const rows = await getPgPromotionModel().findAll({ order: [['priority', 'ASC'], ['createdAt', 'DESC']], limit: 200 });
    const names = await promoNames(rows);
    res.json(rows.map((p) => adminPromo(p, names)));
  } catch (err) {
    sendServerError(res, err, '[PG_PROMOS_ERROR]');
  }
});

router.post('/admin/promotions', protect, admin, async (req, res) => {
  try {
    const values = await preparePromotion(req, res, null);
    if (!values) return;
    const promo = await getPgPromotionModel().create({ ...values, createdBy: req.user.id });
    await afterPromoWrite(req, promo.id, 'created', { headline: promo.headline, hostelId: promo.hostelId, label: promo.label });
    res.status(201).json(adminPromo(promo, await promoNames([promo])));
  } catch (err) {
    sendServerError(res, err, '[PG_PROMO_CREATE_ERROR]');
  }
});

// PUT /api/pg/admin/promotions/order  { ids: [promoId, ...] }  (first = shown first)
router.put('/admin/promotions/order', protect, admin, async (req, res) => {
  try {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every((x) => UUID_RE.test(String(x)))) return res.status(400).json({ message: 'ids must be a list of promotion ids.' });
    const Promo = getPgPromotionModel();
    for (let i = 0; i < ids.length; i++) await Promo.update({ priority: Math.min(i, 999) }, { where: { id: String(ids[i]) } });
    await afterPromoWrite(req, 'order', 'reordered', { ids });
    const rows = await Promo.findAll({ order: [['priority', 'ASC'], ['createdAt', 'DESC']], limit: 200 });
    const names = await promoNames(rows);
    res.json(rows.map((p) => adminPromo(p, names)));
  } catch (err) {
    sendServerError(res, err, '[PG_PROMO_ORDER_ERROR]');
  }
});

router.put('/admin/promotions/:promoId', protect, admin, async (req, res) => {
  try {
    const promo = await getPgPromotionModel().findByPk(req.params.promoId);
    if (!promo) return res.status(404).json({ message: 'Promotion not found.' });
    const values = await preparePromotion(req, res, promo);
    if (!values) return;
    await promo.update(values);
    await afterPromoWrite(req, promo.id, 'updated', { headline: promo.headline, fields: Object.keys(req.body || {}) });
    res.json(adminPromo(promo, await promoNames([promo])));
  } catch (err) {
    sendServerError(res, err, '[PG_PROMO_UPDATE_ERROR]');
  }
});

router.delete('/admin/promotions/:promoId', protect, admin, async (req, res) => {
  try {
    const promo = await getPgPromotionModel().findByPk(req.params.promoId);
    if (!promo) return res.status(404).json({ message: 'Promotion not found.' });
    await promo.destroy();
    await afterPromoWrite(req, promo.id, 'deleted', { headline: promo.headline });
    res.json({ message: 'Promotion deleted.' });
  } catch (err) {
    sendServerError(res, err, '[PG_PROMO_DELETE_ERROR]');
  }
});

module.exports = router;

