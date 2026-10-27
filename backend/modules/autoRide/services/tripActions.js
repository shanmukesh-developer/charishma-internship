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
const chargeLine = require('./chargeLine');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;
const M = () => ({
  Trip: getModel('AutoTrip'), Booking: getModel('AutoBooking'), Seat: getModel('AutoSeat'), Driver: getModel('AutoDriver'),
  Vehicle: getModel('AutoVehicle'), Route: getModel('AutoRoute'), Pickup: getModel('AutoPickupPoint'),
});

const istDate = (d) => require('../../../utils/istTime').istYmd(d);
const expired = (ymd, onDate) => !!ymd && String(ymd).slice(0, 10) < onDate;

/** Refunds + notifications for bookings a trip-ending action cancelled. */
const afterClose = async (trip, all, { title, body, type }) => {
  // Walk-in seats belong to no customer (userId is the driver): nothing to refund or tell.
  const cancelled = all.filter((b) => b.type !== E.BOOKING_TYPE.WALK_IN);
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
const publishChecks = async (trip, driverId, opts = {}) => {
  const charge = opts.charge === true;
  const { Driver, Vehicle, Route, Pickup, Trip } = M();
  const settings = await readSettings();
  const driver = await Driver.findByPk(driverId);
  if (!driver || driver.status !== E.DRIVER_STATUS.VERIFIED) throw fail(403, 'DRIVER_NOT_VERIFIED', 'Your driver account must be verified by ZCS before you can publish trips.');
  if (!driver.isOnline) throw fail(409, 'DRIVER_OFFLINE', charge ? 'Go online first, then put your auto on charge.' : 'Go online first, then publish your trip.');
  const vehicle = await Vehicle.findByPk(trip.vehicleId);
  if (!vehicle || String(vehicle.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Vehicle not found.');
  if (vehicle.status !== E.VEHICLE_STATUS.APPROVED || !vehicle.approvedCapacity) throw fail(403, 'VEHICLE_NOT_APPROVED', 'This auto has not been approved by ZCS yet.');
  const depart = new Date(trip.departureAt);
  const day = istDate(charge ? clock.now() : depart);
  if (expired(driver.licenceExpiresOn, day)) throw fail(409, 'LICENCE_EXPIRED', 'Your driving licence on file has expired. Upload the renewed licence.');
  for (const [k, label] of [['permitExpiresOn', 'permit'], ['insuranceExpiresOn', 'insurance'], ['fitnessExpiresOn', 'fitness certificate'], ['pucExpiresOn', 'PUC certificate']]) {
    if (expired(vehicle[k], day)) throw fail(409, 'VEHICLE_PAPERS_EXPIRED', `The vehicle ${label} expires before this trip. Renew it and ask ZCS to update the vehicle.`, { field: k });
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
  if (!charge) {
    const nowMs = clock.nowMs();
    if (depart.getTime() < nowMs + E.LIMITS.MIN_LEAD_MINUTES * 60 * 1000) throw fail(400, 'DEPARTURE_TOO_SOON', 'Pick a departure time a few minutes from now.', { field: 'departureAt' });
    if (depart.getTime() > nowMs + (settings.maxAdvanceDays + 1) * 24 * 60 * 60 * 1000) throw fail(400, 'DEPARTURE_TOO_FAR', `Trips can be published up to ${settings.maxAdvanceDays} days ahead.`, { field: 'departureAt' });
    queue.periodFor(route, depart); // throws OUTSIDE_OPERATING_HOURS
  }
  const busy = await findBusy(vehicle.id, driverId, trip.id);
  if (busy) throw fail(409, 'ACTIVE_TRIP_EXISTS', charge ? 'You already have an active trip. Finish or leave it before putting your auto on charge.' : 'You already have an active trip. Finish or cancel it before publishing another.', { tripId: busy.id });
  return { driver, vehicle, route, pickup, settings };
};

/** An active trip of this vehicle or driver (other than exceptId), or null. */
const findBusy = (vehicleId, driverId, exceptId, t) => M().Trip.findOne({
  where: {
    [Op.or]: [{ vehicleId }, { driverId }], status: { [Op.in]: E.ACTIVE_TRIP_STATUSES },
    ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
  },
  attributes: ['id', 'status'],
  ...(t ? { transaction: t } : {}),
});

/** The seat fare an auto put on charge uses (services/chargeLine.routeSeatFare). */
const routeSeatFare = (route) => chargeLine.routeSeatFare(route);

/**
 * Union queue: the driver puts an auto on charge at a stand (pickup point; its route is the destination).
 * No departure time: the auto leaves when full or when the driver taps Depart. Capacity = the approved
 * capacity (<= platform max), fare = routeSeatFare (or input.seatFare inside the route bounds).
 * The new trip joins the line WAITING (bookable); if nobody is on charge it moves to the front at once.
 * Returns the trip (status OPEN_FOR_BOOKING, queueState ON_CHARGE or WAITING).
 */
const putOnCharge = async ({ driverId, pickupPointId, routeId, vehicleId, seatFare }) => {
  await assertOn();
  const { Trip, Vehicle, Route, Pickup } = M();
  const { isUuid } = require('./util');
  const pid = String(pickupPointId || '');
  const pickup = isUuid(pid) ? await Pickup.findByPk(pid) : null;
  if (!pickup || pickup.isActive === false) throw fail(400, 'INVALID_INPUT', 'Pick the stand where your auto is.', { field: 'pickupPointId' });
  if (routeId && String(routeId) !== String(pickup.routeId)) throw fail(400, 'INVALID_INPUT', 'This stand is not on that route.', { field: 'routeId' });
  const route = await Route.findByPk(pickup.routeId);
  if (!route || route.isActive === false) throw fail(400, 'INVALID_INPUT', 'Pick an active destination.', { field: 'routeId' });
  const vid = String(vehicleId || '');
  const vehicle = isUuid(vid) ? await Vehicle.findByPk(vid) : null;
  if (!vehicle || String(vehicle.driverId) !== String(driverId)) throw fail(400, 'INVALID_INPUT', 'Pick one of your autos.', { field: 'vehicleId' });
  const settings = await readSettings();
  const capacity = Math.min(Number(vehicle.approvedCapacity) || 0, settings.platformMaxCapacity);
  let fare;
  if (seatFare !== undefined && seatFare !== null && seatFare !== '') {
    // The driver may pick the fare inside the route's seat fare range (checked again in publishChecks).
    fare = num(seatFare, { min: 1, max: E.LIMITS.MAX_FARE, field: 'seatFare', label: 'Seat fare' });
    chargeLine.assertFareInRange(route, fare);
  } else {
    const f = routeSeatFare(route);
    if (!f) throw fail(409, 'FARE_NOT_SET', 'ZCS has not set the seat fare for this destination yet. Please ask the ZCS team.', { field: 'seatFare' });
    fare = f.fare;
  }
  const hours = settings.chargeMaxHours;
  const draft = { id: null, vehicleId: vehicle.id, routeId: route.id, pickupPointId: pickup.id, capacity, seatFare: fare, privateBookingEnabled: false, departureAt: new Date(clock.nowMs() + hours * 60 * 60 * 1000) };
  await publishChecks(draft, driverId, { charge: true });
  const trip = await withKeyLock(chargeLine.lineKey(pickup.id, route.id), () => retryOnConflict(() => tx(async (t) => {
    const line = await chargeLine.lockLine(t, pickup.id, route.id);
    const busy = await findBusy(vehicle.id, driverId, null, t);
    if (busy) throw fail(409, 'ACTIVE_TRIP_EXISTS', 'You already have an active trip. Finish or leave it before putting your auto on charge.', { tripId: busy.id });
    const seq = await chargeLine.nextLineSeq(line, t);
    const now = clock.now();
    const departureAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const tr = await Trip.create({
      driverId, vehicleId: vehicle.id, routeId: route.id, pickupPointId: pickup.id, destinationLabel: route.destinationLabel, stops: [],
      departureAt, originalDepartureAt: departureAt, status: T.DRAFT, mode: E.MODE.SHARED, capacity,
      seatLayout: layoutForTrip(vehicle.seatLayout, capacity, vehicle.approvedCapacity), seatSelectionEnabled: true, privateBookingEnabled: false,
      seatFare: fare, minSeatsToDepart: 1, seatsHeld: 0, seatsConfirmed: 0, seatsBoarded: 0, seatsWalkIn: 0,
      dispatchMode: E.DISPATCH_MODE.ON_CHARGE, lineSeq: seq, operatingDate: istDate(now), periodKey: chargeLine.LINE_PERIOD, queueNumber: seq,
    }, { transaction: t });
    await transitionTrip(tr, T.PUBLISHED, { actor: 'driver', actorId: driverId, t, note: `Put on charge (line serial ${seq})` });
    // Students can book any auto in the line (waiting ones too); the front one is "on charge" (leaves next).
    await transitionTrip(tr, T.OPEN_FOR_BOOKING, { actor: 'system', t, note: 'Booking open', set: { bookingOpensAt: now } });
    await chargeLine.setCols(tr, { queueState: E.QUEUE_STATE.WAITING }, t);
    // Front of the line when nobody is on charge (the earliest waiting auto always goes first).
    await chargeLine.promoteNext(t, pickup.id, route.id, { quietFor: tr.id });
    return Trip.findByPk(tr.id, { transaction: t });
  })));
  notify.tripChanged(trip.id);
  notify.admin('auto_trip', 'created', trip.id);
  notify.nudgeDriver(driverId, 'trip', trip.id, trip.status);
  return trip;
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
      set: { ...q, seatLayout: layoutForTrip(vehicle.seatLayout, tr.capacity, vehicle.approvedCapacity), originalDepartureAt: tr.departureAt, seatsHeld: 0, seatsConfirmed: 0, seatsBoarded: 0 },
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

/** Cancel / unavailable: the statuses after which a line auto's bookings move on (never on depart or no-show). */
const MOVE_ON = [T.CANCELLED, T.DRIVER_UNAVAILABLE, T.VEHICLE_UNAVAILABLE];

/** After commit: each moved student is told the new auto (masked number + driver first name); each new driver too. */
const afterMove = async (from, moved) => {
  const S = require('./serialize');
  const { Vehicle, Driver } = M();
  const byTrip = new Map();
  for (const m of moved) {
    const k = String(m.to.id);
    if (!byTrip.has(k)) byTrip.set(k, { to: m.to, list: [] });
    byTrip.get(k).list.push(m.booking);
  }
  for (const { to, list } of byTrip.values()) {
    const [v, d] = await Promise.all([Vehicle.findByPk(to.vehicleId, { attributes: ['id', 'registrationNumber'] }), Driver.findByPk(to.driverId, { attributes: ['id', 'name'] })]);
    const reg = v ? S.maskReg(v.registrationNumber) : null;
    const who = d ? S.firstName(d.name) : null;
    for (const b of list) {
      notify.toCustomers([b.userId], 'Your auto changed', `You are now on auto ${reg || 'the next auto'}${who ? ` (${who})` : ''}, same fare.`, { type: 'AUTO_BOOKING_MOVED', bookingId: b.id, tripId: to.id, fromTripId: from.id });
      notify.nudgeCustomers([b.userId], 'booking', b.id, b.status);
    }
    const seats = list.reduce((a, b) => a + (Number(b.seatCount) || 0), 0);
    notify.toDriver(to.driverId, 'Passengers moved to your auto', `${seats} seat${seats === 1 ? '' : 's'} from an auto that left the line are now booked on your auto.`, { type: 'AUTO_BOOKINGS_MOVED', tripId: to.id });
    notify.tripEvent(to, {});
  }
};

/**
 * Union queue: the driver changes the seat fare of an auto at the stand, inside the route's range, only while
 * no student has booked (or is booking) it. Returns the trip.
 */
const changeFare = async ({ tripId, driverId, seatFare }) => {
  const fare = num(seatFare, { min: 1, max: E.LIMITS.MAX_FARE, field: 'seatFare', label: 'Seat fare' });
  if (fare === null) throw fail(400, 'INVALID_INPUT', 'Enter the fare per seat.', { field: 'seatFare' });
  const out = await withTripLock(tripId, async (t, trip) => {
    loadOwn(trip, driverId);
    if (!chargeLine.isCharge(trip)) throw fail(409, 'NOT_ON_CHARGE_TRIP', 'The fare of a scheduled trip is set when it is published.');
    if (!chargeLine.AT_STAND.includes(trip.status) || ![E.QUEUE_STATE.ON_CHARGE, E.QUEUE_STATE.WAITING].includes(trip.queueState)) {
      throw fail(409, 'FARE_LOCKED', 'The fare can be changed only while your auto is in the line.');
    }
    const { Booking, Route } = M();
    const booked = await Booking.count({ where: { tripId: trip.id, status: { [Op.in]: E.LIVE_BOOKING_STATUSES }, type: { [Op.ne]: E.BOOKING_TYPE.WALK_IN } }, transaction: t });
    if (booked) throw fail(409, 'FARE_LOCKED', 'A student has booked this auto, so the fare is locked.');
    chargeLine.assertFareInRange(await Route.findByPk(trip.routeId, { transaction: t }), fare);
    const before = Number(trip.seatFare);
    await chargeLine.setCols(trip, { seatFare: fare }, t);
    await Booking.update({ seatFare: fare }, { where: { tripId: trip.id, type: E.BOOKING_TYPE.WALK_IN, status: { [Op.in]: E.LIVE_BOOKING_STATUSES } }, transaction: t });
    await logEvent(trip, { actor: 'driver', actorId: driverId, t, note: `Seat fare ₹${before} -> ₹${fare}` });
    return trip;
  });
  notify.tripEvent(out, {});
  return out;
};

/** Ends a trip with an exception status, cancelling every live booking with a full refund. */
const endTrip = async ({ tripId, to, actor, actorId, reason, driverId }) => {
  const why = cleanText(reason, 300);
  if (actor !== 'system' && why.length < 3) throw fail(400, 'REASON_REQUIRED', 'Tell passengers why (at least 3 characters).', { field: 'reason' });
  const out = await withTripLock(tripId, async (t, trip) => {
    if (driverId) loadOwn(trip, driverId);
    if (!E.canTransition(trip.status, to, actor)) {
      await transitionTrip(trip, to, { actor, actorId, t }); // throws the usual 409 INVALID_TRANSITION
    }
    // Union queue: an auto leaving the line because it is cancelled or unavailable hands its confirmed bookings
    // (whole, same fare) to the next auto in the line with room, in this same transaction. The lifecycle close
    // (system) cancels as before.
    const movable = chargeLine.isCharge(trip) && actor !== 'system' && MOVE_ON.includes(to)
      && [E.QUEUE_STATE.ON_CHARGE, E.QUEUE_STATE.WAITING].includes(trip.queueState);
    const mv = movable ? await alloc.moveLineBookings(trip, t) : { moved: [], expired: [] };
    await transitionTrip(trip, to, { actor, actorId, t, note: why || null, set: { cancelledBy: actor, cancelReason: why || null }, meta: mv.moved.length ? { bookingsMoved: mv.moved.length } : {} });
    const closed = await alloc.closeTripBookings(trip, { by: actor, reason: why || E.STATUS_LABELS[to], t });
    return { trip, moved: mv.moved, expiredElsewhere: mv.expired, movable, ...closed };
  });
  if (out.moved.length) await afterMove(out.trip, out.moved);
  for (const b of out.expiredElsewhere) notify.bookingEvent(b, { title: 'Seat hold expired', body: 'Your held seats were released because the booking was not confirmed in time.', type: 'AUTO_HOLD_EXPIRED' });
  const label = { [T.CANCELLED]: 'cancelled', [T.DRIVER_UNAVAILABLE]: 'cancelled (driver unavailable)', [T.VEHICLE_UNAVAILABLE]: 'cancelled (vehicle unavailable)', [T.NO_SHOW]: 'cancelled (the auto did not depart)' }[to] || 'cancelled';
  const charge = chargeLine.isCharge(out.trip);
  await afterClose(out.trip, out.cancelled, {
    title: charge ? 'Your auto left the line' : 'Your auto was cancelled',
    body: charge
      ? (out.movable
        ? `Your booking on this ZCS Auto was cancelled${why ? `: ${why}` : ''}. No other auto in the line had room for your seats. Any wallet payment is refunded in full.`
        : `Your booking on this ZCS Auto was cancelled${why ? `: ${why}` : ''}. Any wallet payment is refunded in full. You can book a seat on another auto in the line.`)
      : `The auto was ${label}${why ? `: ${why}` : ''}. Any wallet payment is refunded in full. Please book another auto.`,
    type: 'AUTO_TRIP_CANCELLED',
  });
  for (const r of out.privateClosed) {
    notify.toCustomers([r.userId], 'Full-auto request closed', 'The auto is no longer available. Please pick another auto.', { type: 'AUTO_PRIVATE_CLOSED', requestId: r.id });
    notify.nudgeCustomers([r.userId], 'private_request', r.id, r.status);
  }
  return out;
};

const seatText = (nums, count) => (nums.length ? `seat${nums.length === 1 ? '' : 's'} ${nums.join(', ')}` : `${count} seat${count === 1 ? '' : 's'}`);

/** The 409 PASSENGERS_NOT_CHECKED_IN refusal naming each booked passenger who is not checked in. */
const notCheckedInError = async (rows, t, { legacy }) => {
  const S = require('./serialize');
  let names = new Map();
  try {
    const User = require('../../../models/User').getUserModel();
    const ids = [...new Set(rows.map((b) => String(b.userId)))];
    const users = User && ids.length ? await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'], transaction: t }) : [];
    names = new Map(users.map((u) => [String(u.id), u.name]));
  } catch { /* first names fall back to "Passenger" */ }
  const passengers = rows.map((b) => {
    const seats = (Array.isArray(b.seatNumbers) ? b.seatNumbers : []).map(Number);
    return { bookingId: b.id, firstName: S.firstName(names.get(String(b.userId))), seats, seatCount: Number(b.seatCount) || seats.length, code: b.bookingCode };
  });
  const list = passengers.map((x) => `${x.firstName} (${seatText(x.seats, x.seatCount)})`).join(', ');
  const n = passengers.length;
  const message = `${n === 1 ? '1 passenger is' : `${n} passengers are`} not checked in yet: ${list}. Check them in with their booking code and PIN. `
    + (legacy ? 'If they are not in the auto, tap Start trip again to leave without them.' : 'If they are not in the auto, mark them as not here.');
  return fail(409, 'PASSENGERS_NOT_CHECKED_IN', message, { passengers, confirmAgain: !!legacy });
};

/**
 * Start's decision on booked passengers who are not checked in. Returns { missed: true } (mark every row in
 * `unboarded` NO_SHOW), or { refuse: error }. See ACTIONS.start.
 */
const missedDecision = async ({ trip, unboarded, body, driverId, t }) => {
  if (!unboarded.length) return { missed: true };
  const ids = unboarded.map((b) => String(b.id));
  if (Object.hasOwn(body, 'noShowConfirmed')) {
    if (!Array.isArray(body.noShowConfirmed)) throw fail(400, 'INVALID_INPUT', 'noShowConfirmed must be a list of booking ids.', { field: 'noShowConfirmed' });
    const named = new Set(body.noShowConfirmed.slice(0, 50).map(String));
    const pending = unboarded.filter((b) => !named.has(String(b.id)));
    return pending.length ? { refuse: await notCheckedInError(pending, t, { legacy: false }) } : { missed: true };
  }
  // Driver app 1.0.6 and older: no list. A refusal for this exact set of passengers less than
  // LEGACY_START_CONFIRM_MS ago (recorded below, committed with the refusal) means the driver saw the names and
  // tapped Start again.
  const Event = getModel('AutoTripEvent');
  const nowMs = clock.nowMs();
  const key = [...ids].sort().join(',');
  const recent = await Event.findAll({ where: { tripId: trip.id }, order: [['createdAt', 'DESC']], limit: 20, transaction: t });
  const prior = recent.find((e) => {
    const m = e.meta || {};
    return m.kind === 'START_REFUSED' && m.legacy === true && m.key === key && Number(m.at) <= nowMs && nowMs - Number(m.at) <= E.LIMITS.LEGACY_START_CONFIRM_MS;
  });
  if (prior) return { missed: true, legacy: true };
  await logEvent(trip, { actor: 'driver', actorId: driverId, t, note: `Start refused: ${ids.length} booked passenger${ids.length === 1 ? '' : 's'} not checked in`, meta: { kind: 'START_REFUSED', legacy: true, key, at: nowMs } });
  return { refuse: await notCheckedInError(unboarded, t, { legacy: true }) };
};

/** Driver trip actions. */
const ACTIONS = {
  'confirm-departure': async ({ trip, t, driverId, body }) => {
    if (body.ready !== true) throw fail(400, 'CONFIRM_REQUIRED', 'Confirm the auto is ready (ready: true).', { field: 'ready' });
    if (chargeLine.isCharge(trip) && trip.queueState === E.QUEUE_STATE.WAITING && trip.status !== T.FULL) {
      throw fail(409, 'WAITING_IN_LINE', 'Your auto is waiting in line. You can depart when it is full or when it is on charge.');
    }
    await transitionTrip(trip, T.DRIVER_CONFIRMED, { actor: 'driver', actorId: driverId, t, set: chargeLine.isCharge(trip) ? { departureAt: clock.now() } : {} });
    // Holds still open can no longer be confirmed: release them now.
    const { Booking } = M();
    const holds = await Booking.findAll({ where: { tripId: trip.id, status: B.HELD }, transaction: t });
    for (const b of holds) await alloc.cancelOneInTx(b, trip, { by: 'system', reason: 'Driver confirmed departure', t, pct: 0 });
    await alloc.recomputeCounters(trip, t);
    return { notice: { title: 'Driver confirmed departure 🛺', body: 'Your auto is getting ready. Be at the pickup point with your booking code and PIN.', type: 'AUTO_DEPARTURE_CONFIRMED' }, released: holds };
  },
  'start-boarding': async ({ trip, t, driverId }) => {
    await transitionTrip(trip, T.BOARDING, { actor: 'driver', actorId: driverId, t });
    return { notice: { title: 'Boarding has started', body: 'Show your booking code and PIN to the driver to board.', type: 'AUTO_BOARDING', perBooking: showPinNow(false) } };
  },
  // Start never drops a passenger silently. Booked passengers who are not checked in make Start answer
  // 409 PASSENGERS_NOT_CHECKED_IN { passengers: [{ bookingId, firstName, seats, seatCount, code }] }; the driver checks
  // them in, or sends Start again with noShowConfirmed: [bookingId, ...] naming exactly the ones who are not here
  // (only those become NO_SHOW; anyone not named keeps the refusal). Driver app 1.0.6 and older send no list: they
  // get the same refusal (its message is shown as the error toast) and a second Start within
  // LIMITS.LEGACY_START_CONFIRM_MS for the same passengers leaves them. Every NO_SHOW can be undone by a late
  // check-in (code + PIN) for LIMITS.LATE_CHECKIN_MINUTES (services/lateCheckIn.js).
  start: async ({ trip, t, driverId, body }) => {
    if (body.safetyConfirmed !== true) throw fail(400, 'SAFETY_CHECK_REQUIRED', 'Confirm the safety check (safetyConfirmed: true) before starting.', { field: 'safetyConfirmed' });
    if (!E.canTransition(trip.status, T.IN_PROGRESS, 'driver')) throw require('./stateMachine').invalid(trip.status, T.IN_PROGRESS);
    if (trip.status === T.BOARDING && !(Number(trip.seatsBoarded) > 0)) throw fail(409, 'NOBODY_BOARDED', 'Check at least one passenger in before starting the trip.');
    const { Booking } = M();
    const unboarded = await Booking.findAll({ where: { tripId: trip.id, status: B.CONFIRMED, type: { [Op.ne]: E.BOOKING_TYPE.WALK_IN } }, order: [['createdAt', 'ASC']], transaction: t });
    const decision = await missedDecision({ trip, unboarded, body, driverId, t });
    if (decision.refuse) return { refused: decision.refuse };
    await transitionTrip(trip, T.IN_PROGRESS, { actor: 'driver', actorId: driverId, t, set: { safetyConfirmedAt: clock.now() }, meta: unboarded.length ? { notHere: unboarded.map((b) => b.id), legacyConfirm: !!decision.legacy } : {} });
    const now = clock.now();
    const missed = [];
    for (const b of unboarded) {
      const [n] = await Booking.update({ status: B.NO_SHOW, noShowAt: now, paymentStatus: b.paymentMethod === E.PAYMENT_METHODS.WALLET ? E.PAYMENT_STATUS.NOT_REFUNDED : E.PAYMENT_STATUS.NONE }, { where: { id: b.id, status: B.CONFIRMED }, transaction: t });
      if (n) missed.push(b);
    }
    await alloc.releaseSeatsOf(missed.map((b) => b.id), t);
    await alloc.recomputeCounters(trip, t);
    return { notice: { title: 'Your trip has started', body: 'Have a safe ride. Use Report a problem in the app if anything feels wrong.', type: 'AUTO_TRIP_STARTED', statuses: [B.BOARDED] }, missed };
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
    return { notice: { title: 'Trip completed ✅', body: 'Thanks for riding with ZCS Auto-Ride.', type: 'AUTO_TRIP_COMPLETED', statuses: [B.COMPLETED] } };
  },
  // Union queue: the auto leaves now (before or when full). Holds still open are released, then boarding starts
  // at once so students not yet checked in can still be checked in before Start.
  depart: async ({ trip, t, driverId }) => {
    if (!chargeLine.isCharge(trip)) throw fail(409, 'NOT_ON_CHARGE_TRIP', 'Depart is for autos put on charge. Use Confirm departure for this trip.');
    if (trip.status === T.PUBLISHED || (trip.queueState === E.QUEUE_STATE.WAITING && trip.status !== T.FULL)) {
      throw fail(409, 'WAITING_IN_LINE', 'Your auto is waiting in line. You can depart when it is full or when it is on charge.');
    }
    if (!(Number(trip.seatsConfirmed) > 0)) throw fail(409, 'AUTO_EMPTY', 'Add at least one passenger before you depart, or leave the line.');
    const now = clock.now();
    await transitionTrip(trip, T.DRIVER_CONFIRMED, { actor: 'driver', actorId: driverId, t, note: 'Departing from the stand', set: { departureAt: now } });
    const { Booking } = M();
    const holds = await Booking.findAll({ where: { tripId: trip.id, status: B.HELD }, transaction: t });
    for (const b of holds) await alloc.cancelOneInTx(b, trip, { by: 'system', reason: 'The auto departed', t, pct: 0 });
    await alloc.recomputeCounters(trip, t);
    await transitionTrip(trip, T.BOARDING, { actor: 'driver', actorId: driverId, t });
    return { notice: { title: 'Your auto is leaving now', body: 'Show your booking code and PIN to the driver if you have not checked in yet.', type: 'AUTO_DEPARTURE_CONFIRMED', perBooking: showPinNow(true) }, released: holds };
  },
  delay: async ({ trip, t, driverId, body }) => {
    if (chargeLine.isCharge(trip)) throw fail(409, 'NOT_FOR_CHARGE', 'An auto on charge has no departure time to delay. It leaves when full or when you tap Depart.');
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
  // A refusal that recorded something (Start: the legacy confirm marker) is thrown only after its commit.
  if (out.refused) throw out.refused;
  if (out.notice) {
    notify.tripEvent(out.trip, { title: out.notice.title, body: out.notice.body, type: out.notice.type, statuses: out.notice.statuses, perBooking: out.notice.perBooking });
  } else notify.tripEvent(out.trip, {});
  for (const b of out.released || []) notify.toCustomers([b.userId], 'Seat hold released', chargeLine.isCharge(out.trip) ? 'The auto left before you confirmed. The next auto in line takes bookings now.' : 'The driver confirmed departure before you confirmed. Please pick another auto.', { type: 'AUTO_HOLD_RELEASED', bookingId: b.id });
  for (const b of out.missed || []) {
    notify.toCustomers([b.userId], missedNotice.title, missedNotice.body(b), { type: 'AUTO_NO_SHOW', bookingId: b.id, tripId: out.trip.id });
    notify.nudgeCustomers([b.userId], 'booking', b.id, B.NO_SHOW);
  }
  return out;
};

/** The push a passenger gets when the auto left without checking them in (start, lifecycle safety net). */
const missedNotice = {
  title: 'Your auto left without checking you in',
  body: (b) => `If you are on it, ask the driver to check you in with your PIN${b && b.boardingPin ? ` ${b.boardingPin}` : ''} (within ${E.LIMITS.LATE_CHECKIN_MINUTES} minutes). If you missed it, open the booking and tap Report a problem.`,
};

/**
 * Per-passenger push when the auto is leaving / boarding: a passenger not checked in yet is told to show their PIN
 * now (the PIN is in their own push only, never the driver's); one already checked in is told they are in.
 */
const showPinNow = (leaving) => (row) => {
  const lead = leaving ? 'Your auto is leaving now.' : 'Boarding has started.';
  if (row.status === B.CONFIRMED) {
    const pin = row.pin ? `PIN ${row.pin}` : 'your PIN';
    return { title: `Show ${pin} to the driver now`, body: `${lead} Show booking code ${row.code} and ${pin} to the driver so you are checked in. Anyone not checked in is left behind.` };
  }
  if (row.status === B.BOARDED) return { title: leaving ? 'Your auto is leaving now' : 'Boarding has started', body: 'You are checked in. Have a safe ride.' };
  return null;
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
  return { cashCollected: money(cash), walletPayments: money(wallet), total: money(cash + wallet), note: 'Only payments recorded in ZCS (cash you marked collected at check-in, wallet payments).' };
};

module.exports = { publish, publishChecks, putOnCharge, changeFare, routeSeatFare, runAction, endTrip, earnings, ACTIONS, missedNotice };
