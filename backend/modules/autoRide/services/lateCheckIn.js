// Late check-in (owner bug 26 Oct: "I booked and I sat, the auto went, and I got 'You missed the auto'").
// A booking marked NO_SHOW (not checked in when the driver started, released by the arrival window, or marked
// "did not come" by the driver) can still be checked in by the driver with the passenger's booking code + PIN for
// LIMITS.LATE_CHECKIN_MINUTES after it was marked, while its auto is still at the stand, leaving or on the way.
// The PIN stays the only proof: there is no passenger self check-in. allocation.checkIn() does the restore
// (seat reclaimed if still free, else another free seat the rider may take, else 409 SEAT_NOW_TAKEN).
const E = require('../enums');
const clock = require('./clock');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;
const MIN = 60 * 1000;
/** Trip statuses in which a missed passenger can still be checked in. */
const LATE_TRIP_STATUSES = [T.DRIVER_CONFIRMED, T.BOARDING, T.IN_PROGRESS];
const AT_STAND = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL];

const tripTakesLate = (trip) => !!trip
  && (LATE_TRIP_STATUSES.includes(trip.status) || (trip.dispatchMode === E.DISPATCH_MODE.ON_CHARGE && AT_STAND.includes(trip.status)));

/** Until when (ms) this NO_SHOW booking can still be checked in on this trip, or null. */
const untilMs = (booking, trip, nowMs = clock.nowMs()) => {
  if (!booking || booking.status !== B.NO_SHOW || booking.type === E.BOOKING_TYPE.WALK_IN || !booking.noShowAt) return null;
  if (!trip || String(booking.tripId) !== String(trip.id) || !tripTakesLate(trip)) return null;
  const at = new Date(booking.noShowAt).getTime();
  if (!Number.isFinite(at)) return null;
  const until = at + E.LIMITS.LATE_CHECKIN_MINUTES * MIN;
  return until > nowMs ? until : null;
};

const untilIso = (booking, trip) => {
  const u = untilMs(booking, trip);
  return u === null ? null : new Date(u).toISOString();
};

module.exports = { LATE_TRIP_STATUSES, tripTakesLate, untilMs, untilIso };
