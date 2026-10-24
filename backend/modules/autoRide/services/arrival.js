// Union queue arrival window (owner rule: "after booking, if the passenger has not arrived in 15 minutes,
// auto-cancel"). A CONFIRMED app seat booking on an auto at the stand must be checked in (PIN check-in, BOARDED)
// within settings.arrivalWindowMinutes. The clock starts at the LATER of:
//   - the booking's confirmation (confirmedAt),
//   - the moment its auto went ON_CHARGE (trip.chargeStartedAt; a waiting auto #2 / #3 has none yet, so the
//     passenger is not penalised while it waits in line),
//   - the moment the booking was moved onto this auto (fareBreakdown.movedAt, when its first auto was cancelled).
// The lifecycle job (jobs.js) pushes a warning warnLeadMinutes() before the deadline (once, arrivalWarnedAt) and
// at the deadline allocation.expireArrivals() marks it NO_SHOW and frees the seat. Scheduled (non-queue) trips
// keep their own departure-time rules and are not covered.
const E = require('../enums');

const T = E.TRIP_STATUS;
const MIN = 60 * 1000;
/** Statuses of an auto still standing at the stand (the passenger can still reach it). */
const STAND = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL];

const ms = (d) => {
  if (!d) return null;
  const v = new Date(d).getTime();
  return Number.isFinite(v) ? v : null;
};

/** Does the window run for this trip right now (a union queue auto at the stand that has been on charge)? */
const windowApplies = (trip) => !!trip
  && trip.dispatchMode === E.DISPATCH_MODE.ON_CHARGE
  && STAND.includes(trip.status)
  && trip.mode !== E.MODE.PRIVATE
  && trip.queueState !== E.QUEUE_STATE.WAITING
  && !!ms(trip.chargeStartedAt);

/** When the arrival clock of this booking started (ms), or null when it has not started / does not apply. */
const startMs = (booking, trip) => {
  if (!booking || booking.status !== E.BOOKING_STATUS.CONFIRMED || booking.type !== E.BOOKING_TYPE.SHARED) return null;
  if (!windowApplies(trip)) return null;
  const moved = booking.fareBreakdown && String(booking.fareBreakdown.movedFromTripId || '') ? ms(booking.fareBreakdown.movedAt) : null;
  const parts = [ms(booking.confirmedAt), ms(trip.chargeStartedAt), moved].filter((v) => v !== null);
  return parts.length ? Math.max(...parts) : null;
};

/** The deadline (ms) to be checked in, or null. */
const deadlineMs = (booking, trip, windowMinutes) => {
  const start = startMs(booking, trip);
  return start === null ? null : start + Math.max(1, Number(windowMinutes) || E.DEFAULT_SETTINGS.arrivalWindowMinutes) * MIN;
};

/** Minutes before the deadline the passenger is warned (5 for the default 15-minute window). */
const warnLeadMinutes = (windowMinutes) => Math.max(1, Math.min(5, Math.floor((Number(windowMinutes) || 15) / 3)));

/** ISO deadline for payloads (customer ticket / driver list), or null. */
const deadlineIso = (booking, trip, windowMinutes) => {
  const d = deadlineMs(booking, trip, windowMinutes);
  return d === null ? null : new Date(d).toISOString();
};

module.exports = { STAND, windowApplies, startMs, deadlineMs, deadlineIso, warnLeadMinutes };
