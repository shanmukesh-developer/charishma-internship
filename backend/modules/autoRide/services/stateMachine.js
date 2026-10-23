// Trip state machine. Every status change goes through transitionTrip: checked against the table in
// enums.js (from -> to -> allowed actors), applied as a conditional UPDATE (WHERE status = from) so a
// concurrent change wins cleanly, and recorded as an AutoTripEvent row in the SAME transaction.
const { getModel } = require('../index');
const E = require('../enums');
const { fail } = require('./util');
const clock = require('./clock');

const T = E.TRIP_STATUS;
const STAMP = {
  [T.PUBLISHED]: 'publishedAt',
  [T.OPEN_FOR_BOOKING]: 'openedAt',
  [T.FULL]: 'fullAt',
  [T.DRIVER_CONFIRMED]: 'confirmedAt',
  [T.BOARDING]: 'boardingAt',
  [T.IN_PROGRESS]: 'startedAt',
  [T.COMPLETED]: 'completedAt',
};

const invalid = (from, to) => fail(409, 'INVALID_TRANSITION', `This trip is ${E.STATUS_LABELS[from] ? E.STATUS_LABELS[from].toLowerCase() : from}; it cannot move to ${E.STATUS_LABELS[to] ? E.STATUS_LABELS[to].toLowerCase() : to}.`, { from, to });

/**
 * Moves `trip` (a model instance, ideally locked) from its current status to `to`.
 * opts: { actor: 'driver'|'system'|'admin', actorId, note, set: {extra columns}, t: transaction, meta }
 * Throws 409 INVALID_TRANSITION when the table forbids it or the row changed meanwhile.
 */
const transitionTrip = async (trip, to, opts = {}) => {
  const { actor = 'system', actorId = null, note = null, set = {}, t, meta = {} } = opts;
  const from = trip.status;
  if (!E.canTransition(from, to, actor)) throw invalid(from, to);
  const Trip = getModel('AutoTrip');
  const Event = getModel('AutoTripEvent');
  const now = clock.now();
  const changes = { status: to, version: (Number(trip.version) || 0) + 1, ...set };
  if (STAMP[to] && !set[STAMP[to]]) changes[STAMP[to]] = now;
  if (E.TERMINAL_TRIP_STATUSES.includes(to)) changes.endedAt = now;
  if (to === T.DELAYED) changes.statusBeforeDelay = from;
  else if (from === T.DELAYED) changes.statusBeforeDelay = null;
  const [n] = await Trip.update(changes, { where: { id: trip.id, status: from }, transaction: t });
  if (!n) throw fail(409, 'TRIP_CHANGED', 'This trip changed just now. Refresh and try again.', { from, to });
  await Event.create({
    tripId: trip.id, fromStatus: from, toStatus: to, actorType: actor, actorId: actorId ? String(actorId) : null,
    note: note ? String(note).slice(0, 300) : null, meta,
  }, { transaction: t });
  Object.assign(trip, changes);
  if (typeof trip.setDataValue === 'function') for (const [k, v] of Object.entries(changes)) trip.setDataValue(k, v);
  // Union queue: the front auto leaving the charge moves the next one up, in this same transaction.
  if (trip.dispatchMode === E.DISPATCH_MODE.ON_CHARGE) await require('./chargeLine').afterTransition(trip, from, to, t);
  return trip;
};

/** Non-status history line (delay notes, check-ins, admin edits). */
const logEvent = (trip, { actor = 'system', actorId = null, note = null, meta = {}, t }) => getModel('AutoTripEvent').create({
  tripId: trip.id, fromStatus: trip.status, toStatus: trip.status, actorType: actor, actorId: actorId ? String(actorId) : null,
  note: note ? String(note).slice(0, 300) : null, meta,
}, { transaction: t });

/**
 * Seat-availability status after counters changed (only between OPEN / THRESHOLD / FULL; any other
 * status is left alone). Returns the new status or null when unchanged.
 */
const syncAvailability = async (trip, { t, actor = 'system', actorId = null } = {}) => {
  if (!E.AVAILABILITY_STATUSES.includes(trip.status)) return null;
  const cap = Number(trip.capacity) || 0;
  const confirmed = Number(trip.seatsConfirmed) || 0;
  const min = Math.max(1, Math.min(cap, Number(trip.minSeatsToDepart) || cap));
  let want = T.OPEN_FOR_BOOKING;
  if (cap > 0 && confirmed >= cap) want = T.FULL;
  else if (confirmed >= min) want = T.DEPARTURE_THRESHOLD_REACHED;
  if (want === trip.status) return null;
  await transitionTrip(trip, want, { actor, actorId, t, note: `${confirmed}/${cap} seats confirmed`, set: want === T.FULL ? {} : { fullAt: null } });
  return want;
};

module.exports = { transitionTrip, logEvent, syncAvailability, invalid };
