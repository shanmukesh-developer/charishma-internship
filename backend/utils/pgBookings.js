// PG booking status changes, shared by the admin routes (routes/pgRoutes.js) and the ZCS PG Partner app
// (modules/pgOwner). Statuses:
//   Pending    the student's request (no bed held)
//   Confirmed  accepted by the housing team or the PG owner: one bed of the room is taken (availableBeds - 1)
//   Cancelled  cancelled by the student or the admin (a confirmed bed is given back)
//   Rejected   declined by the PG owner, with a reason the student sees (only from Pending)
//   MovedOut   the tenant left (only from Confirmed; the bed is given back)
// Cancelled / Rejected / MovedOut are final. The one-open-booking index (config/db.js) only covers
// Pending + Confirmed, so a rejected student can ask again.
const { Op } = require('sequelize');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_STATUSES = ['Pending', 'Confirmed'];
const FINAL_STATUSES = ['Cancelled', 'Rejected', 'MovedOut'];
const ALL_STATUSES = [...OPEN_STATUSES, ...FINAL_STATUSES];

const models = () => ({
  PGBooking: require('../models/PGBooking').getPGBookingModel(),
  PGRoom: require('../models/PGRoom').getPGRoomModel(),
});

const finalMessage = (status) => (status === 'Cancelled' ? 'This booking was already cancelled.'
  : status === 'Rejected' ? 'This booking request was already declined.'
    : 'This tenant has already moved out.');

/**
 * Moves a booking to `nextStatus` inside a transaction, keeping the room's availableBeds in sync.
 *   mayChange(booking)  false -> 404 (the caller may not see this booking)
 *   opts.from           allowed current statuses (e.g. ['Pending'] for accept / reject)
 *   opts.roomId         accept into another active room of the same PG (Pending -> Confirmed only)
 *   opts.extra          extra fields written with the status (decisionReason, decidedAt, ...)
 * Returns { booking, changed } or { status, error, code }.
 */
async function changeBookingStatus(bookingId, nextStatus, mayChange, opts = {}) {
  if (!UUID_RE.test(String(bookingId || ''))) return { status: 404, error: 'Booking not found.', code: 'NOT_FOUND' };
  if (!ALL_STATUSES.includes(nextStatus)) return { status: 400, error: 'Unknown booking status.', code: 'INVALID_STATUS' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  return sequelize.transaction(async (t) => {
    const { PGBooking, PGRoom } = models();
    const booking = await PGBooking.findByPk(bookingId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!booking || !(await mayChange(booking))) return { status: 404, error: 'Booking not found.', code: 'NOT_FOUND' };
    if (booking.status === nextStatus) return { booking, changed: false };
    if (FINAL_STATUSES.includes(booking.status)) return { status: 400, error: finalMessage(booking.status), code: 'BOOKING_CLOSED' };
    if (Array.isArray(opts.from) && !opts.from.includes(booking.status)) {
      return { status: 409, error: `This booking is ${String(booking.status).toLowerCase()} now. Refresh and try again.`, code: 'INVALID_TRANSITION' };
    }
    if (nextStatus === 'Rejected' && booking.status !== 'Pending') return { status: 409, error: 'Only a new request can be declined.', code: 'INVALID_TRANSITION' };
    if (nextStatus === 'MovedOut' && booking.status !== 'Confirmed') return { status: 409, error: 'Only a confirmed tenant can be marked as moved out.', code: 'INVALID_TRANSITION' };

    if (opts.roomId && String(opts.roomId) !== String(booking.roomId)) {
      if (nextStatus !== 'Confirmed' || booking.status !== 'Pending') return { status: 409, error: 'The room can only be changed while accepting a new request.', code: 'INVALID_TRANSITION' };
      if (!UUID_RE.test(String(opts.roomId))) return { status: 404, error: 'Room not found.', code: 'ROOM_NOT_FOUND' };
      const other = await PGRoom.findByPk(opts.roomId, { transaction: t });
      if (!other || other.hostelId !== booking.hostelId || other.isActive === false) return { status: 404, error: 'Room not found.', code: 'ROOM_NOT_FOUND' };
      booking.roomId = other.id;
    }

    const room = await PGRoom.findByPk(booking.roomId, { transaction: t, lock: t.LOCK.UPDATE });
    if (nextStatus === 'Confirmed') {
      // Older duplicate rows (see /admin/bookings/duplicates): never reserve two beds for one student at one PG.
      const dup = await PGBooking.findOne({
        where: { userId: booking.userId, hostelId: booking.hostelId, status: 'Confirmed', id: { [Op.ne]: booking.id } },
        transaction: t,
      });
      if (dup) return { status: 409, error: 'This student already has a confirmed booking at this PG. Cancel this duplicate request instead.', code: 'ALREADY_CONFIRMED' };
      if (!room || room.availableBeds <= 0) return { status: 400, error: 'No beds left in this room.', code: 'NO_BEDS' };
      room.availableBeds -= 1;
      await room.save({ transaction: t });
    } else if (booking.status === 'Confirmed' && room) {
      room.availableBeds = Math.min(room.totalBeds || room.availableBeds + 1, room.availableBeds + 1);
      await room.save({ transaction: t });
    }
    booking.status = nextStatus;
    if (opts.extra && typeof opts.extra === 'object') {
      for (const [k, v] of Object.entries(opts.extra)) if (v !== undefined && PGBooking.rawAttributes[k]) booking[k] = v;
    }
    await booking.save({ transaction: t });
    return { booking, changed: true };
  });
}

const STATUS_PUSH = {
  Confirmed: { title: 'PG booking confirmed', body: (pg, room) => `${pg} accepted your request.${room ? ` Your bed in room ${room} is reserved.` : ' Your bed is reserved.'}` },
  Rejected: { title: 'PG booking update', body: (pg, _room, reason) => `${pg} could not accept your request${reason ? `: ${reason}` : '.'}` },
  Cancelled: { title: 'PG booking update', body: () => 'Your PG booking request was cancelled.' },
  MovedOut: { title: 'PG stay ended', body: (pg) => `${pg} marked your stay as ended. You can now review your stay.` },
};

/**
 * Push + in-app notification to the student (customer notification path: utils/push.js with
 * recipients = [userId], which also writes the Notifications row). Never throws.
 */
async function notifyStudentOfStatus(booking, { pgName, roomNumber, reason } = {}) {
  try {
    // An open "My PG bookings" reloads at once (ids / status only; 31 Oct 2026), whatever the push does.
    require('./realtime').toUser(booking.userId, 'pg:changed', { bookingId: String(booking.id), status: booking.status });
    const tpl = STATUS_PUSH[booking.status];
    if (!tpl) return false;
    const { getUserModel } = require('../models/User');
    const student = await getUserModel().findByPk(booking.userId, { attributes: ['id', 'fcmTokens'] });
    if (!student) return false;
    const { sendPushToTokens } = require('./push');
    await sendPushToTokens(student.fcmTokens, tpl.title, tpl.body(pgName || 'The PG', roomNumber || null, reason || null),
      { type: 'PG_BOOKING_STATUS', bookingId: String(booking.id), status: booking.status, hostelId: String(booking.hostelId) },
      { recipients: [student.id] });
    return true;
  } catch (e) {
    console.warn('[PG_STATUS_PUSH_WARN]', e.message);
    return false;
  }
}

module.exports = { changeBookingStatus, notifyStudentOfStatus, OPEN_STATUSES, FINAL_STATUSES, ALL_STATUSES, UUID_RE };
