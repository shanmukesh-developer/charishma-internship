// Customer side (/api/auto-ride): browse autos, seat map, hold -> confirm, cancel, full-auto requests,
// my bookings, pickup points + queue, incident reports. Fares, availability and seat numbers always
// come from the server; the client only says what it wants.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUuid, hit, ymd, num } = require('../services/util');
const { readIdempotencyKey, claim: claimIdempotency } = require('../../../utils/idempotency');
const S = require('../services/serialize');
const alloc = require('../services/allocation');
const notify = require('../services/notify');
const payments = require('../services/payments');
const clock = require('../services/clock');
const { readFlag, publicSettings } = require('../services/flag');
const { istDayStartOf } = require('../../../utils/istTime');
const chargeLine = require('../services/chargeLine');
const seatRule = require('../services/layout');
const { readSettings } = require('../services/flag');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;
const M = () => ({
  Trip: getModel('AutoTrip'), Booking: getModel('AutoBooking'), Seat: getModel('AutoSeat'), Driver: getModel('AutoDriver'),
  Vehicle: getModel('AutoVehicle'), Route: getModel('AutoRoute'), Pickup: getModel('AutoPickupPoint'),
  Private: getModel('AutoPrivateRequest'), Incident: getModel('AutoIncident'),
});

const byIds = async (Model, ids) => {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const rows = await Model.findAll({ where: { id: { [Op.in]: list } } });
  return new Map(rows.map((r) => [String(r.id), r]));
};

/** Context rows for a list of trips (drivers, vehicles, routes, pickups, my bookings). */
const tripContext = async (trips, userId) => {
  const { Driver, Vehicle, Route, Pickup, Booking } = M();
  const [drivers, vehicles, routes, pickups] = await Promise.all([
    byIds(Driver, trips.map((t) => t.driverId)), byIds(Vehicle, trips.map((t) => t.vehicleId)),
    byIds(Route, trips.map((t) => t.routeId)), byIds(Pickup, trips.map((t) => t.pickupPointId)),
  ]);
  const mine = userId && trips.length ? await Booking.findAll({ where: { userId, tripId: { [Op.in]: trips.map((t) => t.id) }, status: { [Op.in]: E.LIVE_BOOKING_STATUSES } } }) : [];
  const mineByTrip = new Map(mine.map((b) => [String(b.tripId), b]));
  return (t) => ({
    driver: drivers.get(String(t.driverId)), vehicle: vehicles.get(String(t.vehicleId)), route: routes.get(String(t.routeId)),
    pickup: pickups.get(String(t.pickupPointId)), myBooking: mineByTrip.get(String(t.id)) || null,
  });
};

const loadVisibleTrip = async (id) => {
  if (!isUuid(String(id || ''))) throw fail(404, 'NOT_FOUND', 'This auto trip was not found.');
  const trip = await M().Trip.findByPk(id);
  if (!trip || trip.status === T.DRAFT) throw fail(404, 'NOT_FOUND', 'This auto trip was not found.');
  return trip;
};

// GET /api/auto-ride/status   (no feature gate: the app decides whether to show the entry)
// settings: the public limits (seats per booking, hold minutes, refund %, ...) so the app's steppers and
// cancel dialogs match what the server will enforce.
const status = async (req, res) => {
  const enabled = await readFlag();
  res.json({ enabled, paymentMethods: enabled ? await payments.enabledMethods() : [], settings: await publicSettings() });
};

// GET /api/auto-ride/settings/public   (same block as /status settings)
const settingsPublic = async (req, res) => {
  res.json({ settings: await publicSettings() });
};

// GET /api/auto-ride/routes
const routes = async (req, res) => {
  const { Route, Pickup } = M();
  const rows = await Route.findAll({ where: { isActive: { [Op.not]: false } }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const pickups = rows.length ? await Pickup.findAll({ where: { routeId: { [Op.in]: rows.map((r) => r.id) }, isActive: { [Op.not]: false } }, order: [['sequence', 'ASC']] }) : [];
  res.json({ routes: rows.map((r) => S.routeFull(r, pickups.filter((p) => String(p.routeId) === String(r.id)))) });
};

// GET /api/auto-ride/pickup-points?routeId=
const pickupPoints = async (req, res) => {
  const { Pickup, Route } = M();
  const where = { isActive: { [Op.not]: false } };
  if (req.query.routeId) {
    if (!isUuid(String(req.query.routeId))) throw fail(400, 'INVALID_INPUT', 'Unknown route.');
    where.routeId = String(req.query.routeId);
  }
  const rows = await Pickup.findAll({ where, order: [['sequence', 'ASC'], ['name', 'ASC']], limit: 200 });
  const rmap = await byIds(Route, rows.map((p) => p.routeId));
  res.json({
    pickupPoints: rows.filter((p) => { const r = rmap.get(String(p.routeId)); return r && r.isActive !== false; })
      .map((p) => ({ ...S.pickupBrief(p), route: S.routeBrief(rmap.get(String(p.routeId))) })),
    note: 'Locations are the stands set by ZCS. Live auto locations are not shown.',
  });
};

/**
 * The queue at one pickup point for one IST day (customer + driver apps). No passenger data at all: only
 * trip cards (driver short name, masked registration, seat counts). viewer: { userId } or { driverId }.
 */
const queueFor = async (req, pickupId, rawDate, viewer = {}) => {
  const { Pickup, Trip } = M();
  if (!isUuid(String(pickupId || ''))) throw fail(404, 'NOT_FOUND', 'Pickup point not found.');
  const p = await Pickup.findByPk(pickupId);
  if (!p || p.isActive === false) throw fail(404, 'NOT_FOUND', 'Pickup point not found.');
  const date = ymd(rawDate, 'date') || require('../../../utils/istTime').istYmd(clock.now());
  const trips = await Trip.findAll({
    where: { pickupPointId: p.id, operatingDate: date, status: { [Op.notIn]: [T.DRAFT] }, queueNumber: { [Op.ne]: null } },
    order: [['periodKey', 'ASC'], ['queueNumber', 'ASC']], limit: 200,
  });
  const ctx = await tripContext(trips, viewer.userId || null);
  return {
    pickupPoint: S.pickupBrief(p), date,
    queue: trips.map((t) => ({
      ...S.tripCustomer(req, t, ctx(t)), periodKey: t.periodKey, checkInAt: S.iso(t.publishedAt),
      ...(viewer.driverId ? { mine: String(t.driverId) === String(viewer.driverId) } : {}),
    })),
    note: 'Queue numbers show the order autos checked in. The departure order can differ (an auto that fills up first may leave first).',
  };
};

// GET /api/auto-ride/pickup-points/:id/queue?date=YYYY-MM-DD
const pickupQueue = async (req, res) => {
  res.json(await queueFor(req, req.params.id, req.query.date, { userId: req.user.id }));
};

// GET /api/auto-ride/trips?routeId=&pickupPointId=&destination=&date=&time=HH:MM&passengers=&mode=private
const browse = async (req, res) => {
  const { Trip, Route } = M();
  const q = req.query || {};
  const where = { status: { [Op.in]: E.LISTED_STATUSES } };
  if (q.routeId) { if (!isUuid(String(q.routeId))) throw fail(400, 'INVALID_INPUT', 'Unknown route.'); where.routeId = String(q.routeId); }
  if (q.pickupPointId) { if (!isUuid(String(q.pickupPointId))) throw fail(400, 'INVALID_INPUT', 'Unknown pickup point.'); where.pickupPointId = String(q.pickupPointId); }
  const dest = cleanText(q.destination, 80).toLowerCase();
  if (dest) {
    const rs = await Route.findAll({ attributes: ['id', 'destinationLabel', 'name'] });
    const ids = rs.filter((r) => `${r.destinationLabel} ${r.name}`.toLowerCase().includes(dest)).map((r) => r.id);
    where[Op.or] = [{ routeId: { [Op.in]: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] } }, { destinationLabel: { [Op.like]: `%${dest.replace(/[%_\\]/g, '')}%` } }];
  }
  const date = ymd(q.date, 'date');
  const nowMs = clock.nowMs();
  let from = new Date(nowMs - 30 * 60 * 1000);
  let to = new Date(nowMs + 8 * 24 * 60 * 60 * 1000);
  if (date) {
    from = new Date(Math.max(istDayStartOf(date).getTime(), from.getTime()));
    to = new Date(istDayStartOf(date).getTime() + 24 * 60 * 60 * 1000);
  }
  if (q.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(q.time)) && date) {
    const pref = new Date(`${date}T${q.time}:00+05:30`).getTime();
    from = new Date(Math.max(from.getTime(), pref - 60 * 60 * 1000));
  }
  where.departureAt = { [Op.gte]: from, [Op.lt]: to };
  const passengers = num(q.passengers, { min: 1, max: E.LIMITS.ABSOLUTE_MAX_CAPACITY, int: true, field: 'passengers' });
  const trips = await Trip.findAll({ where, order: [['departureAt', 'ASC'], ['queueNumber', 'ASC']], limit: 100 });
  const ctx = await tripContext(trips, req.user.id);
  // Union queue autos have no departure time; they are offered on the on-charge board (GET /on-charge) instead.
  const shown = trips.filter((t) => !chargeLine.isCharge(t));
  let list = shown.map((t) => S.tripCustomer(req, t, ctx(t)));
  if (passengers) list = list.filter((t) => t.remainingSeats >= passengers || t.myBookingId || (String(q.mode || '') === 'private' && t.privateBookingAllowed && t.capacity >= passengers));
  if (String(q.mode || '') === 'private') list = list.filter((t) => t.privateBookingAllowed);
  res.json({ trips: list, serverTime: new Date(nowMs).toISOString() });
};

// GET /api/auto-ride/trips/:id
const detail = async (req, res) => {
  const trip = await loadVisibleTrip(req.params.id);
  const ctx = await tripContext([trip], req.user.id);
  res.json({ trip: S.tripCustomer(req, trip, ctx(trip)), serverTime: clock.now().toISOString() });
};

/**
 * Seat map (read-only: stale holds shown as available; the next write expires them). Walk-in seats (people who
 * sat in without the app) are BOOKED for customers and WALK_IN for the driver (opts.driver), whose free seats
 * stay AVAILABLE while walk-ins can still be added (the auto is at the stand).
 * Front-seat rule: layout.maleOnlySeats and seat.maleOnly mark the seats beside the driver (boys only). For a
 * customer, seat.forYou says whether THEY can book that free seat, viewer is MALE | NOT_MALE | UNKNOWN (profile
 * gender; UNKNOWN = 'Prefer not to say': the app asks "Are you booking for a boy?" before a front seat) and
 * summary counts { available, availableForYou, onlyFrontSeatsLeft }. UNKNOWN counts like NOT_MALE (the safe side).
 * opts.viewerGender: the customer's profile gender when the caller already has it.
 */
const seatMapFor = async (trip, userId, opts = {}) => {
  const { Seat, Booking } = M();
  const rows = await Seat.findAll({ where: { tripId: trip.id, status: { [Op.in]: E.LIVE_SEAT_STATUSES } } });
  const mine = new Set((await Booking.findAll({ where: { tripId: trip.id, userId: userId || null, status: { [Op.in]: E.LIVE_BOOKING_STATUSES } }, attributes: ['id'] })).map((b) => String(b.id)));
  const walk = new Set((await Booking.findAll({ where: { tripId: trip.id, type: E.BOOKING_TYPE.WALK_IN, status: { [Op.in]: E.LIVE_BOOKING_STATUSES } }, attributes: ['id'] })).map((b) => String(b.id)));
  const nowMs = clock.nowMs();
  const state = new Map();
  for (const s of rows) {
    if (s.status === E.SEAT_STATUS.HELD && s.holdExpiresAt && new Date(s.holdExpiresAt).getTime() <= nowMs) continue;
    if (walk.has(String(s.bookingId))) { state.set(Number(s.seatNo), opts.driver ? 'WALK_IN' : 'BOOKED'); continue; }
    const own = mine.has(String(s.bookingId));
    state.set(Number(s.seatNo), s.status === E.SEAT_STATUS.HELD ? (own ? 'MINE_HELD' : 'HELD') : (own ? 'MINE' : 'BOOKED'));
  }
  const closed = opts.driver
    ? !E.WALK_IN_STATUSES.includes(trip.status) || trip.mode === E.MODE.PRIVATE
    : !E.BOOKABLE_STATUSES.includes(trip.status) || trip.mode === E.MODE.PRIVATE || (chargeLine.isCharge(trip) && ![E.QUEUE_STATE.ON_CHARGE, E.QUEUE_STATE.WAITING].includes(trip.queueState));
  const layout = seatRule.normalizeLayout(trip.seatLayout, trip.capacity);
  const maleOnly = new Set(layout.maleOnlySeats);
  const legend = ['AVAILABLE', 'HELD', 'BOOKED', 'UNAVAILABLE', ...(opts.driver ? ['WALK_IN'] : ['MINE', 'MINE_HELD'])];
  if (opts.driver) {
    const seats = Array.from({ length: Number(trip.capacity) || 0 }, (_, i) => {
      const n = i + 1;
      return { seatNo: n, state: state.get(n) || (closed ? 'UNAVAILABLE' : 'AVAILABLE'), maleOnly: maleOnly.has(n) };
    });
    return { layout, seats, legend };
  }
  const gender = seatRule.knownGender(opts.viewerGender !== undefined ? opts.viewerGender : userId ? await alloc.profileGenderOf(userId) : null);
  const viewer = gender === seatRule.MALE ? 'MALE' : gender ? 'NOT_MALE' : 'UNKNOWN';
  const seats = Array.from({ length: Number(trip.capacity) || 0 }, (_, i) => {
    const n = i + 1;
    const st = state.get(n) || (closed ? 'UNAVAILABLE' : 'AVAILABLE');
    return { seatNo: n, state: st, maleOnly: maleOnly.has(n), forYou: st === 'AVAILABLE' && (viewer === 'MALE' || !maleOnly.has(n)) };
  });
  const available = seats.filter((x) => x.state === 'AVAILABLE').length;
  const availableForYou = seats.filter((x) => x.forYou).length;
  const heldByYou = seats.filter((x) => x.state === 'MINE_HELD').length;
  return {
    layout, seats, legend, viewer,
    summary: { available, availableForYou, heldByYou, onlyFrontSeatsLeft: viewer !== 'MALE' && available > 0 && availableForYou === 0 },
  };
};

/**
 * Union queue board: per stand (pickup point = one destination) the auto on charge, then the autos waiting
 * behind it (#2, #3 ...), each with its live seat map, fare and seats left (all of them take bookings).
 * No passenger data. Lines with no auto at all are included (empty state) so the customer sees every
 * destination ZCS Auto serves.
 * filter: { routeId?, pickupPointId? }. userId marks the customer's own seats.
 */
const chargeBoard = async (req, userId, filter = {}) => {
  const { Route, Pickup } = M();
  const routeWhere = { isActive: { [Op.not]: false } };
  if (filter.routeId) routeWhere.id = filter.routeId;
  const routes = await Route.findAll({ where: routeWhere, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const pickWhere = { routeId: { [Op.in]: routes.map((r) => r.id) }, isActive: { [Op.not]: false } };
  if (filter.pickupPointId) pickWhere.id = filter.pickupPointId;
  const pickups = routes.length ? await Pickup.findAll({ where: pickWhere, order: [['sequence', 'ASC'], ['name', 'ASC']] }) : [];
  const viewerGender = userId ? await alloc.profileGenderOf(userId) : null;
  const lines = [];
  for (const r of routes) {
    for (const p of pickups.filter((x) => String(x.routeId) === String(r.id))) {
      const inLine = await chargeLine.lineTrips(p.id, r.id);
      const front = inLine.find((t) => t.queueState === E.QUEUE_STATE.ON_CHARGE) || null;
      const waiting = inLine.filter((t) => t.queueState === E.QUEUE_STATE.WAITING);
      const ctx = await tripContext(inLine, userId);
      const card = async (t, position) => {
        const seatMap = await seatMapFor(t, userId, { viewerGender });
        const base = S.tripCustomer(req, t, ctx(t));
        // "N of 8 left" is counted from this same seat map, so it always matches the seats drawn: a seat held by
        // anyone (the viewer included) is not left; a stale hold the next write expires is shown free and counted
        // free. The viewer's own held seats stay bookable for them (heldByYou; Book confirms that hold).
        // (A map closed to booking draws free seats as UNAVAILABLE: the counter answer stays then.)
        const closedMap = seatMap.seats.some((x) => x.state === 'UNAVAILABLE');
        const left = base.mode === E.MODE.PRIVATE ? 0 : closedMap ? base.remainingSeats : seatMap.summary.available;
        const mineHeld = seatMap.summary.heldByYou;
        return {
          ...base, position, seatMap, remainingSeats: left, heldByYou: mineHeld,
          sharedBookingAllowed: base.sharedBookingAllowed || (mineHeld > 0 && base.myBookingStatus === B.HELD),
          seatsForYou: seatMap.summary.availableForYou, onlyFrontSeatsLeft: seatMap.summary.onlyFrontSeatsLeft,
        };
      };
      const onCharge = front ? await card(front, 1) : null;
      const waitingAutos = [];
      for (const [i, t] of waiting.entries()) waitingAutos.push(await card(t, (front ? 2 : 1) + i));
      const fare = chargeLine.routeSeatFare(r);
      lines.push({
        key: `${p.id}:${r.id}`,
        route: S.routeBrief(r),
        pickup: S.pickupBrief(p),
        destination: r.destinationLabel,
        seatFare: onCharge ? onCharge.seatFare : fare ? fare.fare : null,
        onCharge,
        waitingCount: waiting.length,
        waiting: waiting.map((t, i) => ({ position: (front ? 2 : 1) + i, lineSeq: t.lineSeq || null })),
        waitingAutos,
      });
    }
  }
  return lines;
};

// GET /api/auto-ride/on-charge?routeId=&pickupPointId=   (union queue board)
const onChargeBoard = async (req, res) => {
  const q = req.query || {};
  for (const k of ['routeId', 'pickupPointId']) if (q[k] && !isUuid(String(q[k]))) throw fail(400, 'INVALID_INPUT', `Unknown ${k}.`, { field: k });
  const settings = await publicSettings();
  res.json({
    lines: await chargeBoard(req, req.user.id, { routeId: q.routeId ? String(q.routeId) : null, pickupPointId: q.pickupPointId ? String(q.pickupPointId) : null }),
    maxSeatsPerBooking: settings.maxSeatsPerBooking,
    serverTime: clock.now().toISOString(),
    note: 'Autos leave the stand in line order. You can book the auto on charge or one waiting behind it; pay the driver in cash when you board.',
  });
};

// GET /api/auto-ride/trips/:id/seats
const seats = async (req, res) => {
  const trip = await loadVisibleTrip(req.params.id);
  res.json({ tripId: trip.id, ...S.tripStatus(trip), seatSelectionEnabled: !!trip.seatSelectionEnabled, seatFare: Number(trip.seatFare), ...(await seatMapFor(trip, req.user.id)) });
};

const presentBooking = async (req, b) => {
  const { Trip, Driver, Vehicle, Route, Pickup } = M();
  const trip = await Trip.findByPk(b.tripId);
  const [driver, vehicle, route, pickup] = trip ? await Promise.all([
    Driver.findByPk(trip.driverId), Vehicle.findByPk(trip.vehicleId), Route.findByPk(trip.routeId), Pickup.findByPk(trip.pickupPointId),
  ]) : [];
  const { arrivalWindowMinutes } = await readSettings();
  return S.bookingCustomer(req, b, { trip, driver, vehicle, route, pickup, arrivalWindowMinutes });
};

/**
 * A 409 front-seat / no-suitable-seat refusal names the next auto in the same line this customer can book
 * (nextTripId), so the board can offer it. Never throws.
 */
const withNextSuitable = async (err, tripId, gender) => {
  try {
    if (!err || !['NO_SUITABLE_SEAT', 'FRONT_SEAT_MALE_ONLY'].includes(err.code)) return err;
    const trip = await M().Trip.findByPk(tripId);
    if (!trip || !chargeLine.isCharge(trip)) return err;
    const line = await chargeLine.lineTrips(trip.pickupPointId, trip.routeId);
    const after = line.slice(line.findIndex((x) => String(x.id) === String(trip.id)) + 1);
    for (const c of after) {
      if (!E.BOOKABLE_STATUSES.includes(c.status) || c.mode !== E.MODE.SHARED) continue;
      const taken = await alloc.liveSeatNumbers(c.id);
      const free = Array.from({ length: Number(c.capacity) || 0 }, (_, i) => i + 1).filter((n) => !taken.has(n));
      if (seatRule.seatsForRider(free, seatRule.maleOnlySeatsOf(c), gender).length) {
        err.extra = { ...(err.extra || {}), nextTripId: c.id };
        break;
      }
    }
  } catch { /* the refusal still goes out as it is */ }
  return err;
};

const requirePhone = async (userId) => {
  const { getUserModel } = require('../../../models/User');
  const u = await getUserModel().findByPk(userId, { attributes: ['id', 'phone', 'isActive', 'gender'] });
  if (!u || u.isActive === false) throw fail(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended.');
  if (!u.phone) throw fail(403, 'PHONE_REQUIRED', 'Add and verify your mobile number in your profile to book an auto.');
  return u;
};

// POST /api/auto-ride/trips/:id/holds { seatCount, seatNumbers?, riderGender? }  (Idempotency-Key header optional)
// riderGender ('Male' | 'Female' | 'Other'): the answer to "Are you booking for a boy?", taken ONLY when the profile
// gender is unknown ('Prefer not to say'); a known profile gender always wins. Kept on the booking, never the profile.
const createHold = async (req, res) => {
  const tripId = String(req.params.id || '');
  if (!isUuid(tripId)) throw fail(404, 'NOT_FOUND', 'This auto trip was not found.');
  const body = req.body || {};
  hit('hold', req.user.id);
  const u = await requirePhone(req.user.id);
  const rider = seatRule.resolveRider(u.gender, body.riderGender);
  const key = readIdempotencyKey(req, body.idempotencyKey) || null;
  const seatNumbers = Array.isArray(body.seatNumbers) ? body.seatNumbers.slice(0, E.LIMITS.ABSOLUTE_MAX_CAPACITY) : undefined;
  const seatCount = body.seatCount !== undefined ? body.seatCount : (seatNumbers ? seatNumbers.length : 1);
  let r;
  try {
    r = await alloc.hold({ tripId, userId: req.user.id, seatCount, seatNumbers, idempotencyKey: key, riderGender: rider.gender, riderGenderSource: rider.source });
  } catch (err) {
    await withNextSuitable(err, tripId, rider.gender);
    // A refused retry key (409 IDEMPOTENCY_KEY_REUSED) may have expired stale holds on the way: tell them.
    for (const b of (err && err.expiredHolds) || []) notify.bookingEvent(b, { title: 'Seat hold expired', body: 'Your held seats were released because the booking was not confirmed in time.', type: 'AUTO_HOLD_EXPIRED' });
    if (err && err.expiredHolds && err.expiredHolds.length) notify.tripChanged(tripId);
    throw err;
  }
  if (r.created) {
    notify.nudgeDriver(r.booking.driverId, 'trip', tripId, null);
    notify.tripChanged(tripId);
  }
  for (const b of r.expired || []) notify.nudgeCustomers([b.userId], 'booking', b.id, b.status);
  res.status(r.created ? 201 : 200).json({ booking: await presentBooking(req, r.booking), created: !!r.created, duplicate: !r.created });
};

// POST /api/auto-ride/bookings/:id/confirm { paymentMethod }   (Idempotency-Key header / body idempotencyKey optional)
// With a key (utils/idempotency.claim, shared across processes): a retry while the first is running -> 409
// CONFIRM_IN_PROGRESS (keep the key, retry); after it succeeded -> the SAME response again with duplicate: true.
// A failed attempt releases the key, so a retry after e.g. PAYMENT_METHOD_OFF runs again. Without a key the
// confirm is still safe to repeat (an already-confirmed booking answers 200 duplicate).
const confirmBooking = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const key = readIdempotencyKey(req, (req.body || {}).idempotencyKey) || '';
  const claim = await claimIdempotency('autoride_confirm', req.user.id, key);
  if (claim.state === 'busy') throw fail(409, 'CONFIRM_IN_PROGRESS', 'Your booking is being confirmed. Please wait a moment.', { retryable: true });
  if (claim.state === 'done') {
    const body = claim.body || {};
    if (!body.booking || String(body.booking.id) !== id) throw fail(409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key was already used for another booking.');
    return res.status(claim.status || 200).json({ ...body, duplicate: true });
  }
  let out;
  try {
    out = await confirmOnce(req, id);
  } catch (err) {
    await claim.release();
    throw err;
  }
  await claim.finish(200, out);
  res.json(out);
};

const confirmOnce = async (req, id) => {
  hit('confirm', req.user.id);
  const r = await alloc.confirm({ bookingId: id, userId: req.user.id, paymentMethod: (req.body || {}).paymentMethod });
  const b = r.booking;
  if (!r.already) {
    const paid = b.paymentMethod === E.PAYMENT_METHODS.WALLET;
    notify.bookingEvent(b, {
      title: 'Auto seat booked ✅',
      body: `Booking ${b.bookingCode}: ${b.seatCount} seat${b.seatCount === 1 ? '' : 's'}, ₹${b.amount} ${paid ? 'paid from your ZCS Wallet' : 'to pay the driver in cash'}.`,
      type: 'AUTO_BOOKING_CONFIRMED',
      driverTitle: 'New booking', driverBody: `${b.seatCount} seat${b.seatCount === 1 ? '' : 's'} booked (${b.bookingCode}).`,
    });
    if (r.becameFull) {
      notify.tripEvent(r.trip, {
        title: 'Your auto is full 🛺', body: 'All seats are booked. The auto is ready for the driver to confirm departure.', type: 'AUTO_TRIP_FULL',
        driverTitle: 'Your auto is full', driverBody: `All ${r.trip.capacity} seats are confirmed. Confirm departure when you are ready.`,
      });
    } else if (r.almostFull) {
      notify.tripEvent(r.trip, { driverTitle: 'Almost full', driverBody: `${r.trip.seatsConfirmed}/${r.trip.capacity} seats confirmed.`, type: 'AUTO_TRIP_ALMOST_FULL', statuses: [] });
    } else notify.tripEvent(r.trip, {});
  }
  return { booking: await presentBooking(req, b), duplicate: !!r.already };
};

// POST /api/auto-ride/bookings/:id/release   (HELD only)
const releaseBooking = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const b0 = await M().Booking.findByPk(id);
  if (!b0 || String(b0.userId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  if (b0.status !== B.HELD) throw fail(409, 'BOOKING_NOT_HELD', 'Only a seat hold can be released. Use cancel for a confirmed booking.');
  const r = await alloc.cancelByCustomer({ bookingId: id, userId: req.user.id, reason: 'Hold released' });
  notify.bookingEvent(r.booking, {});
  notify.tripEvent(r.trip, {});
  res.json({ booking: await presentBooking(req, r.booking) });
};

// POST /api/auto-ride/bookings/:id/cancel { reason? }
const cancelBooking = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const r = await alloc.cancelByCustomer({ bookingId: id, userId: req.user.id, reason: (req.body || {}).reason });
  const b = r.booking;
  const refund = Number(b.refundAmount) || 0;
  notify.bookingEvent(b, {
    title: 'Auto booking cancelled',
    body: refund > 0 ? `₹${refund} ${b.status === B.REFUNDED ? 'is back in' : 'will be refunded to'} your ZCS Wallet.` : `Booking ${b.bookingCode} is cancelled.`,
    type: 'AUTO_BOOKING_CANCELLED',
    driverTitle: 'Booking cancelled', driverBody: `${b.bookingCode} cancelled ${b.seatCount} seat${b.seatCount === 1 ? '' : 's'}.`,
  });
  notify.tripEvent(r.trip, {});
  res.json({ booking: await presentBooking(req, b) });
};

// GET /api/auto-ride/bookings?scope=upcoming|past
const myBookings = async (req, res) => {
  const { Booking, Trip } = M();
  const scope = String(req.query.scope || '').toLowerCase();
  const where = { userId: req.user.id };
  if (scope === 'upcoming') where.status = { [Op.in]: E.LIVE_BOOKING_STATUSES };
  else if (scope === 'past') where.status = { [Op.notIn]: E.LIVE_BOOKING_STATUSES };
  const rows = await Booking.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
  const trips = await byIds(Trip, rows.map((b) => b.tripId));
  const ctx = await tripContext([...trips.values()], null);
  const { arrivalWindowMinutes } = await readSettings();
  res.json({ bookings: rows.map((b) => { const t = trips.get(String(b.tripId)); return S.bookingCustomer(req, b, t ? { trip: t, ...ctx(t), arrivalWindowMinutes } : {}); }) });
};

// GET /api/auto-ride/bookings/:id   (own bookings only; anything else is 404 so ids cannot be probed)
const bookingDetail = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const b = await M().Booking.findByPk(id);
  if (!b || String(b.userId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  res.json({ booking: await presentBooking(req, b) });
};

// POST /api/auto-ride/trips/:id/private-requests { passengers, purpose?, paymentMethod? }
const createPrivate = async (req, res) => {
  const tripId = String(req.params.id || '');
  if (!isUuid(tripId)) throw fail(404, 'NOT_FOUND', 'This auto trip was not found.');
  const body = req.body || {};
  hit('private_request', req.user.id);
  await requirePhone(req.user.id);
  const r = await alloc.createPrivateRequest({
    tripId, userId: req.user.id, passengers: body.passengers, purpose: body.purpose, paymentMethod: body.paymentMethod,
    idempotencyKey: readIdempotencyKey(req, body.idempotencyKey) || null,
  });
  if (r.created) {
    notify.toDriver(r.request.driverId, 'Full-auto request 🛺', `A passenger wants the whole auto for ${r.request.passengers} (₹${r.request.fare}). Accept or decline in the app.`, { type: 'AUTO_PRIVATE_REQUEST', requestId: r.request.id, tripId });
    notify.nudgeDriver(r.request.driverId, 'private_request', r.request.id, r.request.status);
    notify.admin('auto_private_request', 'created', r.request.id);
  }
  res.status(r.created ? 201 : 200).json({ request: S.privateRequestCustomer(r.request), duplicate: !r.created });
};

// GET /api/auto-ride/private-requests
const myPrivate = async (req, res) => {
  const rows = await M().Private.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 50 });
  res.json({ requests: rows.map(S.privateRequestCustomer) });
};
const privateDetail = async (req, res) => {
  const id = String(req.params.id || '');
  const r = isUuid(id) ? await M().Private.findByPk(id) : null;
  if (!r || String(r.userId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'Request not found.');
  res.json({ request: S.privateRequestCustomer(r) });
};
const cancelPrivate = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Request not found.');
  const r = await alloc.cancelPrivateRequest({ requestId: id, userId: req.user.id });
  notify.nudgeDriver(r.driverId, 'private_request', r.id, r.status);
  notify.nudgeCustomers([r.userId], 'private_request', r.id, r.status); // the passenger's other devices
  notify.admin('auto_private_request', 'updated', r.id);
  res.json({ request: S.privateRequestCustomer(r) });
};

// POST /api/auto-ride/bookings/:id/incident { category, description }
const reportIncident = async (req, res) => {
  const id = String(req.params.id || '');
  const b = isUuid(id) ? await M().Booking.findByPk(id) : null;
  if (!b || String(b.userId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const category = String((req.body || {}).category || '').toUpperCase();
  if (!E.INCIDENT_CATEGORIES.includes(category)) throw fail(400, 'INVALID_INPUT', `Category must be one of: ${E.INCIDENT_CATEGORIES.join(', ')}.`, { field: 'category' });
  const description = cleanText((req.body || {}).description, 2000, { multiline: true });
  if (description.length < 5) throw fail(400, 'INVALID_INPUT', 'Describe what happened (at least 5 characters).', { field: 'description' });
  hit('incident', req.user.id);
  const priority = E.HIGH_PRIORITY_CATEGORIES.includes(category) ? E.INCIDENT_PRIORITY.HIGH : E.INCIDENT_PRIORITY.NORMAL;
  const row = await M().Incident.create({ tripId: b.tripId, bookingId: b.id, reporterType: 'CUSTOMER', reporterId: req.user.id, category, priority, description });
  notify.admin('auto_incident', 'created', row.id);
  res.status(201).json({ incident: S.incident(row), message: category === 'SAFETY' || category === 'HARASSMENT' ? 'Reported. If you are in danger call 112 now.' : 'Reported. The ZCS team will look into it.' });
};

module.exports = {
  status, settingsPublic, routes, pickupPoints, pickupQueue, browse, onChargeBoard, chargeBoard, detail, seats, createHold, confirmBooking, releaseBooking, cancelBooking,
  myBookings, bookingDetail, createPrivate, myPrivate, privateDetail, cancelPrivate, reportIncident, seatMapFor, tripContext, queueFor,
};
