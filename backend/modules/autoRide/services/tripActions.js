// Trip lifecycle actions (driver app, admin, lifecycle job). Each runs in withTripLock and moves the
// trip through stateMachine.transitionTrip, so impossible / unauthorised transitions are refused
// (409 INVALID_TRANSITION) and every change has an AutoTripEvent row. Notifications go out after commit.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, cleanText, num, money } = require('./util');
const clock = require('./clock');
const { withTripLock, withKeyLock, tx, lockOpt, retryOnConflict } = require('./locks');
const { transitionTrip, syncAvailability, logEvent } = require('./stateMachine');
const alloc = require('./allocation');
const payments = require('./payments');
const notify = require('./notify');
const queue = require('./queue');
const { readSettings, assertOn } = require('./flag');
const { layoutForTrip } = require('./layout');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;
const M = () => ({
  Trip: getModel('AutoTrip'), Booking: getModel('AutoBooking'), Seat: getModel('AutoSeat'), Driver: getModel('AutoDriver'),
  Vehicle: getModel('AutoVehicle'), Route: getModel('AutoRoute'), Pickup: getModel('AutoPickupPoint'),
});

const istDate = (d) => require('../../../utils/istTime').istYmd(d);
const expired = (ymd, onDate) => !!ymd && String(ymd).slice(0, 10) < onDate;

/** Refunds + notifications for bookings a trip-ending action cancelled. */
const afterClose = async (trip, cancelled, { title, body, type }) => {
  for (const b of cancelled) {
    if (b.status === B.REFUND_PENDING) await payments.processRefund(b.id);
  }
  // One push per cancelled booking, carrying its bookingId so the tap opens that booking.
  if (title) {
    const seen = new Set();
    for (const b of cancelled) {
      if (seen.has(String(b.userId))) continue;
      seen.add(String(b.userId));
      notify.toCustomers([b.userId], title, body, { type, tripId: trip.id, bookingId: b.id });
    }
  }
  for (const b of cancelled) notify.nudgeCustomers([b.userId], 'booking', b.id, B.CANCELLED);
  notify.tripEvent(trip, { type, statuses: [] });
};

/**
 * Checks everything a publish needs (driver verified + online, vehicle approved with valid papers,
 * capacity within approval and platform max, fares within the route bounds, time window, operating period).
 * Returns { driver, vehicle, route, pickup, settings }.
 */
const publishChecks = async (trip, driverId) => {
  const { Driver, Vehicle, Route, Pickup, Trip } = M();
  const settings = await readSettings();
  const driver = await Driver.findByPk(driverId);
  if (!driver || driver.status !== E.DRIVER_STATUS.VERIFIED) throw fail(403, 'DRIVER_NOT_VERIFIED', 'Your driver account must be verified by Zenvy before you can publish trips.');
  if (!driver.isOnline) throw fail(409, 'DRIVER_OFFLINE', 'Go online first, then publish your trip.');
  const vehicle = await Vehicle.findByPk(trip.vehicleId);
  if (!vehicle || String(vehicle.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Vehicle not found.');
  if (vehicle.status !== E.VEHICLE_STATUS.APPROVED || !vehicle.approvedCapacity) throw fail(403, 'VEHICLE_NOT_APPROVED', 'This auto has not been approved by Zenvy yet.');
  const depart = new Date(trip.departureAt);
  const day = istDate(depart);
  if (expired(driver.licenceExpiresOn, day)) throw fail(409, 'LICENCE_EXPIRED', 'Your driving licence on file has expired. Upload the renewed licence.');
  for (const [k, label] of [['permitExpiresOn', 'permit'], ['insuranceExpiresOn', 'insurance'], ['fitnessExpiresOn', 'fitness certificate'], ['pucExpiresOn', 'PUC certificate']]) {
    if (expired(vehicle[k], day)) throw fail(409, 'VEHICLE_PAPERS_EXPIRED', `The vehicle ${label} expires before this trip. Renew it and ask Zenvy to update the vehicle.`, { field: k });
  }
  const cap = Number(trip.capacity) || 0;
  const maxCap = Math.min(Number(vehicle.approvedCapacity) || 0, settings.platformMaxCapacity);
  if (cap < 1 || cap > maxCap) throw fail(400, 'CAPACITY_NOT_ALLOWED', `Capacity must be 1 to ${maxCap} (approved for this auto).`, { field: 'capacity', max: maxCap });
  const route = await Route.findByPk(trip.routeId);
  if (!route || route.isActive === false) throw fail(409, 'ROUTE_INACTIVE', 'This route is not active any more.');
  const pickup = await Pickup.findByPk(trip.pickupPointId);
  if (!pickup || pickup.isActive === false || String(pickup.routeId) !== String(route.id)) throw fail(409, 'PICKUP_INACTIVE', 'This pickup point is not active on the route.');
  const fare = Number(trip.seatFare);
  if (route.seatFareMin !== null && route.seatFareMin !== undefined && fare < Number(route.seatFareMin)) throw fail(400, 'FARE_OUT_OF_RANGE', `Seat fare must be at least ₹${route.seatFareMin} on this route.`, { field: 'seatFare' });
  if (route.seatFareMax !== null && route.seatFareMax !== undefined && fare > Number(route.seatFareMax)) throw fail(400, 'FARE_OUT_OF_RANGE', `Seat fare can be at most ₹${route.seatFareMax} on this route.`, { field: 'seatFare' });
  if (trip.privateBookingEnabled) {
    const ff = Number(trip.fullAutoFare);
    if (!ff) throw fail(400, 'INVALID_INPUT', 'Set a full-auto fare to accept full-auto bookings.', { field: 'fullAutoFare' });
    if (route.fullFareMin !== null && route.fullFareMin !== undefined && ff < Number(route.fullFareMin)) throw fail(400, 'FARE_OUT_OF_RANGE', `Full-auto fare must be at least ₹${route.fullFareMin}.`, { field: 'fullAutoFare' });
    if (route.fullFareMax !== null && route.fullFareMax !== undefined && ff > Number(route.fullFareMax)) throw fail(400, 'FARE_OUT_OF_RANGE', `Full-auto fare can be at most ₹${route.fullFareMax}.`, { field: 'fullAutoFare' });
  }
  const nowMs = clock.nowMs();
  if (depart.getTime() < nowMs + E.LIMITS.MIN_LEAD_MINUTES * 60 * 1000) throw fail(400, 'DEPARTURE_TOO_SOON', 'Pick a departure time a few minutes from now.', { field: 'departureAt' });
  if (depart.getTime() > nowMs + (settings.maxAdvanceDays + 1) * 24 * 60 * 60 * 1000) throw fail(400, 'DEPARTURE_TOO_FAR', `Trips can be published up to ${settings.maxAdvanceDays} days ahead.`, { field: 'departureAt' });
  queue.periodFor(route, depart); // throws OUTSIDE_OPERATING_HOURS
  const busy = await Trip.findOne({ where: { [Op.or]: [{ vehicleId: vehicle.id }, { driverId }], status: { [Op.in]: E.ACTIVE_TRIP_STATUSES }, id: { [Op.ne]: trip.id } }, attributes: ['id', 'status'] });
  if (busy) throw fail(409, 'ACTIVE_TRIP_EXISTS', 'You already have an active trip. Finish or cancel it before publishing another.', { tripId: busy.id });
  return { driver, vehicle, route, pickup, settings };
};

/** DRAFT -> PUBLISHED (+ queue number) -> OPEN_FOR_BOOKING when booking opens now. */
const publish = async ({ tripId, driverId }) => {
  await assertOn();
  const { Trip } = M();
  const draft = await Trip.findByPk(tripId);
  if (!draft || String(draft.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Trip not found.');
  if (draft.status !== T.DRAFT) throw fail(409, 'INVALID_TRANSITION', 'Only a draft trip can be published.', { from: draft.status, to: T.PUBLISHED });
  const { vehicle, route } = await publishChecks(draft, driverId);
  const key = queue.queueKey({ pickupPointId: draft.pickupPointId, routeId: draft.routeId, departureAt: draft.departureAt, route });
  const trip = await withKeyLock(key, () => withKeyLock(`trip:${tripId}`, () => retryOnConflict(() => tx(async (t) => {
    const tr = await Trip.findByPk(tripId, lockOpt(t));
    if (tr.status !== T.DRAFT) throw fail(409, 'INVALID_TRANSITION', 'Only a draft trip can be published.', { from: tr.status, to: T.PUBLISHED });
    const q = await queue.nextQueueNumber({ pickupPointId: tr.pickupPointId, routeId: tr.routeId, departureAt: tr.departureAt, route, t });
    await transitionTrip(tr, T.PUBLISHED, {
      actor: 'driver', actorId: driverId, t, note: `Queue #${q.queueNumber}`,
      set: { ...q, seatLayout: layoutForTrip(vehicle.seatLayout, tr.capacity), originalDepartureAt: tr.departureAt, seatsHeld: 0, seatsConfirmed: 0, seatsBoarded: 0 },
    });
    if (!tr.bookingOpensAt || new Date(tr.bookingOpensAt).getTime() <= clock.nowMs()) {
      await transitionTrip(tr, T.OPEN_FOR_BOOKING, { actor: 'system', t, note: 'Booking open' });
    }
    return tr;
  }))));
  notify.tripChanged(trip.id);
  notify.admin('auto_trip', 'created', trip.id);
  notify.nudgeDriver(driverId, 'trip', trip.id, trip.status);
  return trip;
};

const loadOwn = (trip, driverId) => {
  if (String(trip.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Trip not found.');
};

/** Ends a trip with an exception status, cancelling every live booking with a full refund. */
const endTrip = async ({ tripId, to, actor, actorId, reason, driverId }) => {
  const why = cleanText(reason, 300);
  if (actor !== 'system' && why.length < 3) throw fail(400, 'REASON_REQUIRED', 'Tell passengers why (at least 3 characters).', { field: 'reason' });
  const out = await withTripLock(tripId, async (t, trip) => {
    if (driverId) loadOwn(trip, driverId);
    await transitionTrip(trip, to, { actor, actorId, t, note: why || null, set: { cancelledBy: actor, cancelReason: why || null } });
    const closed = await alloc.closeTripBookings(trip, { by: actor, reason: why || E.STATUS_LABELS[to], t });
    return { trip, ...closed };
  });
  const label = { [T.CANCELLED]: 'cancelled', [T.DRIVER_UNAVAILABLE]: 'cancelled (driver unavailable)', [T.VEHICLE_UNAVAILABLE]: 'cancelled (vehicle unavailable)', [T.NO_SHOW]: 'cancelled (the auto did not depart)' }[to] || 'cancelled';
  await afterClose(out.trip, out.cancelled, {
    title: 'Your auto was cancelled',
    body: `The auto was ${label}${why ? `: ${why}` : ''}. Any wallet payment is refunded in full. Please book another auto.`,
    type: 'AUTO_TRIP_CANCELLED',
  });
  for (const r of out.privateClosed) {
    notify.toCustomers([r.userId], 'Full-auto request closed', 'The auto is no longer available. Please pick another auto.', { type: 'AUTO_PRIVATE_CLOSED', requestId: r.id });
    notify.nudgeCustomers([r.userId], 'private_request', r.id, r.status);
  }
  return out;
};

/** Driver trip actions. */
const ACTIONS = {
  'confirm-departure': async ({ trip, t, driverId, body }) => {
    if (body.ready !== true) throw fail(400, 'CONFIRM_REQUIRED', 'Confirm the auto is ready (ready: true).', { field: 'ready' });
    await transitionTrip(trip, T.DRIVER_CONFIRMED, { actor: 'driver', actorId: driverId, t });
    // Holds still open can no longer be confirmed: release them now.
    const { Booking } = M();
    const holds = await Booking.findAll({ where: { tripId: trip.id, status: B.HELD }, transaction: t });
    for (const b of holds) await alloc.cancelOneInTx(b, trip, { by: 'system', reason: 'Driver confirmed departure', t, pct: 0 });
    await alloc.recomputeCounters(trip, t);
    return { notice: { title: 'Driver confirmed departure 🛺', body: 'Your auto is getting ready. Be at the pickup point with your booking code and PIN.', type: 'AUTO_DEPARTURE_CONFIRMED' }, released: holds };
  },
  'start-boarding': async ({ trip, t, driverId }) => {
    await transitionTrip(trip, T.BOARDING, { actor: 'driver', actorId: driverId, t });
    return { notice: { title: 'Boarding has started', body: 'Show your booking code and PIN to the driver to board.', type: 'AUTO_BOARDING' } };
  },
  start: async ({ trip, t, driverId, body }) => {
    if (body.safetyConfirmed !== true) throw fail(400, 'SAFETY_CHECK_REQUIRED', 'Confirm the safety check (safetyConfirmed: true) before starting.', { field: 'safetyConfirmed' });
    if (trip.status === T.BOARDING && !(Number(trip.seatsBoarded) > 0)) throw fail(409, 'NOBODY_BOARDED', 'Check at least one passenger in before starting the trip.');
    await transitionTrip(trip, T.IN_PROGRESS, { actor: 'driver', actorId: driverId, t, set: { safetyConfirmedAt: clock.now() } });
    // Confirmed passengers who never boarded missed the auto.
    const { Booking } = M();
    const missed = await Booking.findAll({ where: { tripId: trip.id, status: B.CONFIRMED }, transaction: t });
    for (const b of missed) {
      await Booking.update({ status: B.NO_SHOW, noShowAt: clock.now(), paymentStatus: b.paymentMethod === E.PAYMENT_METHODS.WALLET ? E.PAYMENT_STATUS.NOT_REFUNDED : E.PAYMENT_STATUS.NONE }, { where: { id: b.id, status: B.CONFIRMED }, transaction: t });
    }
    await alloc.releaseSeatsOf(missed.map((b) => b.id), t);
    await alloc.recomputeCounters(trip, t);
    return { notice: { title: 'Your trip has started', body: 'Have a safe ride! Use Report a problem in the app if anything feels wrong.', type: 'AUTO_TRIP_STARTED', statuses: [B.BOARDED] }, missed };
  },
  arrive: async ({ trip, t, driverId }) => {
    if (trip.status !== T.IN_PROGRESS) throw fail(409, 'INVALID_TRANSITION', 'Mark arrival during the trip.', { from: trip.status });
    const { Trip } = M();
    await Trip.update({ arrivedAt: clock.now() }, { where: { id: trip.id }, transaction: t });
    trip.arrivedAt = clock.now();
    await logEvent(trip, { actor: 'driver', actorId: driverId, note: 'Arrived at destination', t });
    return {};
  },
  complete: async ({ trip, t, driverId }) => {
    await transitionTrip(trip, T.COMPLETED, { actor: 'driver', actorId: driverId, t });
    const { Booking } = M();
    await Booking.update({ status: B.COMPLETED, completedAt: clock.now() }, { where: { tripId: trip.id, status: B.BOARDED }, transaction: t });
    return { notice: { title: 'Trip completed ✅', body: 'Thanks for riding with Zenvy Auto-Ride.', type: 'AUTO_TRIP_COMPLETED', statuses: [B.COMPLETED] } };
  },
  delay: async ({ trip, t, driverId, body }) => {
    const minutes = num(body.minutes, { min: 5, max: E.LIMITS.MAX_DELAY_MINUTES, int: true, field: 'minutes', label: 'Delay' });
    if (minutes === null) throw fail(400, 'INVALID_INPUT', 'Say how many minutes late (5 to 120).', { field: 'minutes' });
    const reason = cleanText(body.reason, 300) || null;
    const departureAt = new Date(new Date(trip.departureAt).getTime() + minutes * 60 * 1000);
    await transitionTrip(trip, T.DELAYED, { actor: 'driver', actorId: driverId, t, note: reason, set: { departureAt, delayMinutes: (Number(trip.delayMinutes) || 0) + minutes, delayReason: reason } });
    return { notice: { title: `Your auto is delayed by ${minutes} min`, body: reason ? `Driver: ${reason}` : 'The new departure time is in the app.', type: 'AUTO_TRIP_DELAYED', statuses: E.LIVE_BOOKING_STATUSES } };
  },
  resume: async ({ trip, t, driverId }) => {
    if (trip.status !== T.DELAYED || !trip.statusBeforeDelay) throw fail(409, 'INVALID_TRANSITION', 'Only a delayed trip can resume.', { from: trip.status });
    await transitionTrip(trip, trip.statusBeforeDelay, { actor: 'driver', actorId: driverId, t, note: 'Resumed after delay' });
    await syncAvailability(trip, { t });
    return { notice: { title: 'Your auto is back on schedule', body: 'Check the app for the departure time.', type: 'AUTO_TRIP_RESUMED', statuses: E.LIVE_BOOKING_STATUSES } };
  },
};

const runAction = async ({ tripId, driverId, action, body = {} }) => {
  if (action === 'cancel') return endTrip({ tripId, to: T.CANCELLED, actor: 'driver', actorId: driverId, reason: body.reason, driverId });
  if (action === 'unavailable') {
    const kind = String(body.kind || '').toUpperCase();
    if (!['DRIVER', 'VEHICLE'].includes(kind)) throw fail(400, 'INVALID_INPUT', 'kind must be DRIVER or VEHICLE.', { field: 'kind' });
    return endTrip({ tripId, to: kind === 'DRIVER' ? T.DRIVER_UNAVAILABLE : T.VEHICLE_UNAVAILABLE, actor: 'driver', actorId: driverId, reason: body.reason, driverId });
  }
  const fn = Object.hasOwn(ACTIONS, String(action)) ? ACTIONS[action] : null;
  if (!fn) throw fail(404, 'UNKNOWN_ACTION', 'Unknown trip action.');
  const out = await withTripLock(tripId, async (t, trip) => {
    loadOwn(trip, driverId);
    const r = await fn({ trip, t, driverId, body });
    return { trip, ...r };
  });
  if (out.notice) {
    notify.tripEvent(out.trip, { title: out.notice.title, body: out.notice.body, type: out.notice.type, statuses: out.notice.statuses });
  } else notify.tripEvent(out.trip, {});
  for (const b of out.released || []) notify.toCustomers([b.userId], 'Seat hold released', 'The driver confirmed departure before you confirmed. Please pick another auto.', { type: 'AUTO_HOLD_RELEASED', bookingId: b.id });
  for (const b of out.missed || []) notify.toCustomers([b.userId], 'You missed your auto', 'The trip started without you. Contact support if this is wrong.', { type: 'AUTO_NO_SHOW', bookingId: b.id });
  return out;
};

/** Earnings from recorded money only: cash the driver marked collected + wallet payments, minus refunds. */
const earnings = async (driverId, from, to) => {
  const { Booking } = M();
  const rows = await Booking.findAll({
    where: {
      driverId,
      [Op.or]: [
        { cashCollectedAt: { [Op.gte]: from, [Op.lt]: to } },
        { paymentMethod: E.PAYMENT_METHODS.WALLET, confirmedAt: { [Op.gte]: from, [Op.lt]: to } },
      ],
    },
    attributes: ['amount', 'paymentMethod', 'paymentStatus', 'cashCollectedAt', 'walletDebited', 'refundAmount', 'status'],
  });
  let cash = 0;
  let wallet = 0;
  for (const b of rows) {
    if (b.cashCollectedAt) cash += Number(b.amount) || 0;
    if (b.paymentMethod === E.PAYMENT_METHODS.WALLET && Number(b.walletDebited) > 0) {
      wallet += (Number(b.walletDebited) || 0) - ([B.REFUNDED, B.REFUND_PENDING].includes(b.status) ? Number(b.refundAmount) || 0 : 0);
    }
  }
  return { cashCollected: money(cash), walletPayments: money(wallet), total: money(cash + wallet), note: 'Only payments recorded in Zenvy (cash you marked collected at check-in, wallet payments).' };
};

module.exports = { publish, publishChecks, runAction, endTrip, earnings, ACTIONS };
