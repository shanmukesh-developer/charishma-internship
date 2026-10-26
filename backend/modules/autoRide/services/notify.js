// Auto-Ride notifications. Never throws, never blocks the request (fire-and-forget, after commit).
//  Customers: push + in-app Notification row (campus pushToUsers -> utils/push recipients) and an
//             ids-only socket nudge `autoride:changed` { kind, id, status } to room user_<id>.
//  Drivers:   push to AutoDriver.fcmTokens + in-app Notification row with userId = driver id
//             (GET /api/auto-ride/driver/notifications) and `autoride:changed` to room autodriver_<id>.
//  Admins:    admin:changed (auto_* types) to admin-room.  Public: data:changed type 'auto_trip' (ids only).
const realtime = require('../../../utils/realtime');
const { getModel } = require('../index');

const pending = new Set(); // in-flight sends (tests await idle())
const track = (p) => {
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
};
const idle = async () => { while (pending.size) await Promise.allSettled([...pending]); };

const toCustomers = (userIds, title, body, data = {}) => {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length || !title) return;
  track(Promise.resolve()
    .then(() => require('../../campus/campusHelpers').pushToUsers(ids, title, body, { screen: 'auto_booking', ...data }))
    .catch((err) => console.warn('[AUTORIDE_PUSH_WARN]', err.message)));
};

const toDriver = (driverId, title, body, data = {}) => {
  if (!driverId || !title) return;
  track(Promise.resolve()
    .then(async () => {
      const Driver = getModel('AutoDriver');
      const d = Driver ? await Driver.findByPk(driverId, { attributes: ['id', 'fcmTokens'] }) : null;
      if (!d) return;
      const tokens = Array.isArray(d.fcmTokens) ? d.fcmTokens.filter((t) => typeof t === 'string') : [];
      const { sendPushToTokens } = require('../../../utils/push');
      await sendPushToTokens(tokens, title, body, { screen: 'auto_driver_trip', ...data }, { recipients: [String(d.id)] });
    })
    .catch((err) => console.warn('[AUTORIDE_DRIVER_PUSH_WARN]', err.message)));
};

/** Socket nudges (ids + status only). */
const nudgeCustomers = (userIds, kind, id, status) => {
  [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))]
    .forEach((uid) => realtime.toUser(uid, 'autoride:changed', { kind, id, ...(status ? { status } : {}) }));
};
const nudgeDriver = (driverId, kind, id, status) => {
  if (!driverId) return;
  if (typeof realtime.toDriver === 'function') realtime.toDriver(driverId, 'autoride:changed', { kind, id, ...(status ? { status } : {}) });
};

const admin = (type, action, id) => realtime.notifyAdmin(type, action, id);
/** A trip's public listing changed (availability / status): browsers refetch. */
const tripChanged = (tripId) => realtime.publish('auto_trip', 'updated', tripId);

/** Customer ids holding a live / confirmed booking on a trip (for broadcast-to-passengers). */
const passengersOf = async (tripId, statuses) => [...new Set((await passengerBookings(tripId, statuses)).map((r) => r.userId))];

/**
 * [{ userId, bookingId, status, code, pin }] of the trip's bookings in `statuses` (one row per booking). pin is the
 * passenger's own boarding PIN: only ever used for that passenger's own push (perBooking below).
 */
const passengerBookings = async (tripId, statuses) => {
  const Booking = getModel('AutoBooking');
  if (!Booking) return [];
  const { Op } = require('sequelize');
  // WALK_IN rows (people who sat in without the app) belong to no customer.
  const rows = await Booking.findAll({ where: { tripId, status: { [Op.in]: statuses }, type: { [Op.ne]: 'WALK_IN' } }, attributes: ['id', 'userId', 'status', 'bookingCode', 'boardingPin'], order: [['createdAt', 'ASC']] });
  return rows.map((r) => ({ userId: String(r.userId), bookingId: String(r.id), status: r.status, code: r.bookingCode, pin: r.boardingPin || null }));
};

/**
 * Trip-wide event: every passenger in `statuses` + the driver, plus socket nudges + public refresh.
 * Each passenger's push carries THEIR bookingId (one push per booking), so a tap opens their booking.
 * perBooking(row) -> { title, body } | null: per-passenger copy (e.g. "Show PIN 1234 to the driver now"); null
 * falls back to title / body.
 */
const tripEvent = (trip, { title, body, driverTitle, driverBody, type, statuses, perBooking }) => {
  track(Promise.resolve().then(async () => {
    const { CONFIRMED_BOOKING_STATUSES } = require('../enums');
    const rows = await passengerBookings(trip.id, statuses || CONFIRMED_BOOKING_STATUSES);
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.userId)) continue; // one live booking per passenger per trip; never two pushes
      seen.add(r.userId);
      const own = title && typeof perBooking === 'function' ? perBooking(r) : null;
      if (title) toCustomers([r.userId], own ? own.title : title, own ? own.body : body, { type, tripId: trip.id, bookingId: r.bookingId });
    }
    nudgeCustomers([...seen], 'trip', trip.id, trip.status);
    if (driverTitle) toDriver(trip.driverId, driverTitle, driverBody || '', { type, tripId: trip.id });
  }).catch((err) => console.warn('[AUTORIDE_NOTIFY_WARN]', err.message)));
  nudgeDriver(trip.driverId, 'trip', trip.id, trip.status);
  tripChanged(trip.id);
  admin('auto_trip', 'updated', trip.id);
};

/** One booking changed: its customer (push optional) + the trip's driver nudged. */
const bookingEvent = (b, { title, body, type, driverTitle, driverBody, requestId } = {}) => {
  if (title) toCustomers([b.userId], title, body, { type, bookingId: b.id, tripId: b.tripId, ...(requestId ? { requestId } : {}) });
  nudgeCustomers([b.userId], 'booking', b.id, b.status);
  if (driverTitle) toDriver(b.driverId, driverTitle, driverBody || '', { type, bookingId: b.id, tripId: b.tripId });
  nudgeDriver(b.driverId, 'booking', b.id, b.status);
  admin('auto_booking', 'updated', b.id);
};

module.exports = { track, toCustomers, toDriver, nudgeCustomers, nudgeDriver, admin, tripChanged, tripEvent, bookingEvent, passengersOf, passengerBookings, idle };
