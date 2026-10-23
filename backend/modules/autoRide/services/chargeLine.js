// Union queue ("on charge"). Autos at one pickup point (a pickup point belongs to one route, so one line =
// pickup point + route) line up in check-in order. Every auto in the line takes seat bookings (trip status
// OPEN_FOR_BOOKING / DEPARTURE_THRESHOLD_REACHED, FULL when full). The FRONT auto is ON_CHARGE (it leaves
// next); the autos behind are WAITING (#2, #3 ...). When the front auto fills, departs, is cancelled or becomes
// unavailable, stateMachine.transitionTrip calls afterTransition() IN THE SAME TRANSACTION: the front becomes
// DONE and the next waiting auto moves up (promoteNext). A waiting auto that is already full is skipped (it
// can leave as soon as its driver taps Depart). An auto that left the charge (DONE) takes no more bookings.
// Bookings move to another auto only when their auto is cancelled or unavailable (allocation.moveLineBookings).
// Serialisation for one line:
//   - the line row (AutoQueueCounters, operatingDate 'LINE', periodKey 'CHARGE') is read FOR UPDATE on Postgres
//     inside every line change (SQLite IMMEDIATE transactions are already exclusive), so two promotions or two
//     check-ins of one line never interleave across processes;
//   - partial unique index auto_trips_line_on_charge: the database refuses a second ON_CHARGE auto per line.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, money } = require('./util');
const clock = require('./clock');
const { lockOpt } = require('./locks');

const T = E.TRIP_STATUS;
const Q = E.QUEUE_STATE;
const CHARGE = E.DISPATCH_MODE.ON_CHARGE;
const LINE_DATE = 'LINE';
const LINE_PERIOD = 'CHARGE';
const HOUR = 60 * 60 * 1000;
/** Statuses of an auto standing at the stand (in the line, not yet departed). */
const AT_STAND = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL];

const Trip = () => getModel('AutoTrip');
const isCharge = (trip) => !!trip && trip.dispatchMode === CHARGE;
const lineKey = (pickupPointId, routeId) => `line:${pickupPointId}:${routeId}`;

/**
 * The seat fare an auto put on charge uses by default: the admin's default for the route, else the route
 * minimum, else the maximum. { fare, source: DEFAULT | MIN | MAX } or null when the route has no seat fare.
 */
const routeSeatFare = (route) => {
  for (const [k, source] of [['seatFareDefault', 'DEFAULT'], ['seatFareMin', 'MIN'], ['seatFareMax', 'MAX']]) {
    const raw = route ? route[k] : null;
    const v = Number(raw);
    if (raw !== null && raw !== undefined && Number.isFinite(v) && v > 0) return { fare: money(v), source };
  }
  return null;
};

/** The seat fare range a driver may pick on this route: { min, max } (null = no bound). */
const fareRange = (route) => {
  const n = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  return { min: route ? n(route.seatFareMin) : null, max: route ? n(route.seatFareMax) : null };
};

/** Throws 400 FARE_OUT_OF_RANGE when the fare is outside the route's seat fare bounds. */
const assertFareInRange = (route, fare) => {
  const { min, max } = fareRange(route);
  if (min !== null && fare < min) throw fail(400, 'FARE_OUT_OF_RANGE', `Seat fare must be at least ₹${min} on this route.`, { field: 'seatFare', min, max });
  if (max !== null && fare > max) throw fail(400, 'FARE_OUT_OF_RANGE', `Seat fare can be at most ₹${max} on this route.`, { field: 'seatFare', min, max });
};

/** Writes columns on a trip row (inside t) and mirrors them on the instance. */
const setCols = async (trip, changes, t) => {
  await Trip().update(changes, { where: { id: trip.id }, transaction: t });
  Object.assign(trip, changes);
  if (typeof trip.setDataValue === 'function') for (const [k, v] of Object.entries(changes)) trip.setDataValue(k, v);
  return trip;
};

/** The line row of a pickup point + route, locked FOR UPDATE on Postgres (created on first use). */
const lockLine = async (t, pickupPointId, routeId) => {
  const Counter = getModel('AutoQueueCounter');
  const key = { pickupPointId, routeId, operatingDate: LINE_DATE, periodKey: LINE_PERIOD };
  let row = await Counter.findOne({ where: key, ...lockOpt(t) });
  if (!row) {
    await Counter.create({ ...key, lastNumber: 0 }, { transaction: t });
    row = await Counter.findOne({ where: key, ...lockOpt(t) });
  }
  return row;
};

/** Next check-in serial of the line (compare-and-set on the locked line row). */
const nextLineSeq = async (row, t) => {
  const current = Number(row.lastNumber) || 0;
  const [n] = await getModel('AutoQueueCounter').update({ lastNumber: current + 1 }, { where: { id: row.id, lastNumber: current }, transaction: t });
  if (!n) throw fail(409, 'QUEUE_RETRY', 'The line moved just now. Please try again.');
  row.lastNumber = current + 1;
  return current + 1;
};

/** Autos still in the line (on charge first, then waiting in check-in order). */
const lineTrips = async (pickupPointId, routeId, t) => {
  const rows = await Trip().findAll({
    where: { dispatchMode: CHARGE, pickupPointId, routeId, queueState: { [Op.in]: [Q.ON_CHARGE, Q.WAITING] }, status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } },
    order: [['lineSeq', 'ASC'], ['id', 'ASC']],
    ...(t ? { transaction: t } : {}),
  });
  return [...rows.filter((r) => r.queueState === Q.ON_CHARGE), ...rows.filter((r) => r.queueState !== Q.ON_CHARGE)];
};

const currentOnCharge = (pickupPointId, routeId, t) => Trip().findOne({
  where: { dispatchMode: CHARGE, pickupPointId, routeId, queueState: Q.ON_CHARGE },
  ...(t ? { transaction: t } : {}),
});

/** Position in the line (1 = on charge), the autos ahead and the total, or null when the trip is not in line. */
const positionOf = async (trip) => {
  if (!isCharge(trip) || ![Q.ON_CHARGE, Q.WAITING].includes(trip.queueState)) return null;
  const line = await lineTrips(trip.pickupPointId, trip.routeId);
  const i = line.findIndex((r) => String(r.id) === String(trip.id));
  if (i < 0) return null;
  return { position: i + 1, ahead: i, inLine: line.length };
};

/** "You are on charge now" to the driver, after commit, only if the auto is still on charge then. */
const notifyOnCharge = (tripId) => {
  require('./notify').track(Promise.resolve().then(async () => {
    const tr = await Trip().findByPk(tripId);
    if (!tr || tr.queueState !== Q.ON_CHARGE) return;
    const notify = require('./notify');
    const pickup = await getModel('AutoPickupPoint').findByPk(tr.pickupPointId, { attributes: ['id', 'name'] });
    notify.toDriver(tr.driverId, 'You are on charge now', `Your auto${tr.destinationLabel ? ` to ${tr.destinationLabel}` : ''}${pickup ? ` at ${pickup.name}` : ''} is at the front of the line. Add walk-in passengers as they sit.`, { type: 'AUTO_ON_CHARGE', tripId: tr.id });
    notify.nudgeDriver(tr.driverId, 'trip', tr.id, tr.status);
    notify.tripChanged(tr.id);
  }).catch((err) => console.warn('[AUTORIDE_CHARGE_NOTIFY_WARN]', err.message)));
};

const afterCommit = (t, fn) => {
  if (t && typeof t.afterCommit === 'function') t.afterCommit(fn);
  else fn();
};

/**
 * Moves the first waiting auto of the line to the front when nobody is on charge (inside t).
 * A waiting auto that is already full is passed over (DONE: it leaves when its driver departs).
 * Returns the promoted trip or null. opts.quietFor: a trip id that gets no push (its driver just checked in).
 */
const promoteNext = async (t, pickupPointId, routeId, opts = {}) => {
  await lockLine(t, pickupPointId, routeId);
  if (await currentOnCharge(pickupPointId, routeId, t)) return null;
  const waiting = await Trip().findAll({
    where: { dispatchMode: CHARGE, pickupPointId, routeId, queueState: Q.WAITING, status: { [Op.in]: AT_STAND } },
    order: [['lineSeq', 'ASC'], ['id', 'ASC']], limit: 20, attributes: ['id'], transaction: t,
  });
  const { transitionTrip, syncAvailability } = require('./stateMachine');
  const { readSettings } = require('./flag');
  for (const w of waiting) {
    const tr = await Trip().findByPk(w.id, lockOpt(t));
    if (!tr || tr.queueState !== Q.WAITING || !AT_STAND.includes(tr.status)) continue;
    const now = clock.now();
    if (tr.status === T.FULL) {
      await setCols(tr, { queueState: Q.DONE, chargeEndedAt: now }, t);
      continue;
    }
    const hours = (await readSettings()).chargeMaxHours;
    const set = { queueState: Q.ON_CHARGE, chargeStartedAt: now, departureAt: new Date(now.getTime() + hours * HOUR) };
    if (tr.status === T.PUBLISHED) {
      // Rows from before waiting autos were bookable: open them now.
      await transitionTrip(tr, T.OPEN_FOR_BOOKING, { actor: 'system', t, note: 'On charge (front of the line)', set: { ...set, bookingOpensAt: now } });
      await syncAvailability(tr, { t });
    } else {
      await setCols(tr, set, t);
      await require('./stateMachine').logEvent(tr, { actor: 'system', t, note: 'On charge (front of the line)' });
    }
    if (String(tr.id) !== String(opts.quietFor || '')) afterCommit(t, () => notifyOnCharge(tr.id));
    afterCommit(t, () => require('./notify').tripChanged(tr.id));
    return tr;
  }
  return null;
};

/**
 * Called by transitionTrip for every status change of an ON_CHARGE-mode trip (same transaction).
 * The front auto leaves the charge as soon as it is no longer bookable (FULL, departing, cancelled,
 * unavailable, no-show); a waiting auto that departs or ends just leaves the line.
 */
const afterTransition = async (trip, from, to, t) => {
  if (!isCharge(trip)) return;
  if (trip.queueState === Q.ON_CHARGE && !E.BOOKABLE_STATUSES.includes(to)) {
    await setCols(trip, { queueState: Q.DONE, chargeEndedAt: clock.now() }, t);
    await promoteNext(t, trip.pickupPointId, trip.routeId);
  } else if (trip.queueState === Q.WAITING && !AT_STAND.includes(to)) {
    await setCols(trip, { queueState: Q.DONE, chargeEndedAt: clock.now() }, t);
  }
};

/**
 * Why a charge-mode trip cannot take a booking right now (inside t), with the auto on charge instead.
 * Autos on charge and waiting in line both take bookings; one that left the charge (DONE) does not.
 * Returns null when it can.
 */
const bookingRefusal = async (trip, t) => {
  if (!isCharge(trip) || trip.queueState === Q.ON_CHARGE || trip.queueState === Q.WAITING) return null;
  const next = await currentOnCharge(trip.pickupPointId, trip.routeId, t);
  const extra = { nextTripId: next ? next.id : null, queueState: trip.queueState || null };
  const filled = trip.status === T.FULL || (Number(trip.seatsConfirmed) || 0) >= (Number(trip.capacity) || 0);
  if (filled) return fail(409, 'AUTO_JUST_FILLED', next ? 'This auto just filled. The next auto is on charge now.' : 'This auto just filled. The next auto will be on charge soon.', extra);
  return fail(409, 'AUTO_OFF_CHARGE', next ? 'This auto is no longer taking bookings. The next auto is on charge now.' : 'This auto is no longer taking bookings.', extra);
};

/** Lifecycle healer: lines with waiting autos but nobody on charge (e.g. a crash mid-way) get their front back. */
const healLines = async () => {
  const { tx, withKeyLock } = require('./locks');
  const rows = await Trip().findAll({ where: { dispatchMode: CHARGE, queueState: Q.WAITING, status: { [Op.in]: AT_STAND } }, attributes: ['pickupPointId', 'routeId'], limit: 500 });
  const seen = new Map();
  for (const r of rows) seen.set(`${r.pickupPointId}:${r.routeId}`, r);
  const promoted = [];
  for (const r of seen.values()) {
    if (await currentOnCharge(r.pickupPointId, r.routeId)) continue;
    const tr = await withKeyLock(lineKey(r.pickupPointId, r.routeId), () => tx((t) => promoteNext(t, r.pickupPointId, r.routeId)));
    if (tr) promoted.push(tr);
  }
  return promoted;
};

module.exports = {
  LINE_DATE, LINE_PERIOD, AT_STAND, routeSeatFare, fareRange, assertFareInRange, isCharge, lineKey, setCols, lockLine, nextLineSeq,
  lineTrips, currentOnCharge, positionOf, promoteNext, afterTransition, bookingRefusal, healLines, notifyOnCharge,
};
