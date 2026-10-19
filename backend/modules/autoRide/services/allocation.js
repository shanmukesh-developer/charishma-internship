// Seat allocation engine. Every seat-changing write runs inside withTripLock(tripId):
//   in-process FIFO per trip + write transaction (SQLite IMMEDIATE / Postgres row lock FOR UPDATE on the
//   trip) + partial unique index auto_seats_live_unique underneath. Counters on the trip are always
//   recomputed from the AutoSeats rows inside the same transaction, never incremented blindly.
// Rules:
//  - hold: lazy-expire stale holds first; idempotent per (user, trip) and per (user, Idempotency-Key);
//    requested seats must be free (else 409 SEAT_TAKEN), otherwise the lowest free seats; never more
//    than the trip's capacity snapshot; HELD until holdExpiresAt = min(now + holdMinutes, departure).
//  - confirm: HELD and unexpired (else 410 HOLD_EXPIRED, seats released); payment; CONFIRMED + PIN;
//    FULL when confirmed == capacity, DEPARTURE_THRESHOLD_REACHED when >= minSeatsToDepart.
//  - private (full auto): a pending request holds nothing; the driver's accept succeeds only when the
//    trip has ZERO live seats (else the request becomes CONFLICT), then books seats 1..capacity as one
//    PRIVATE booking and the trip is FULL / mode PRIVATE. Shared holds on a PRIVATE trip -> 409 TRIP_PRIVATE.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, money, newBookingCode, newPin, isUniqueError, cleanText } = require('./util');
const clock = require('./clock');
const { withTripLock, lockOpt } = require('./locks');
const { syncAvailability, transitionTrip } = require('./stateMachine');
const payments = require('./payments');
const { readSettings } = require('./flag');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;
const S = E.SEAT_STATUS;
const PR = E.PRIVATE_STATUS;

const M = () => ({
  Trip: getModel('AutoTrip'),
  Booking: getModel('AutoBooking'),
  Seat: getModel('AutoSeat'),
  Private: getModel('AutoPrivateRequest'),
});

/** Seat counters from the seat rows (inside t). Mutates and saves the trip. */
const recomputeCounters = async (trip, t) => {
  const { Seat, Trip } = M();
  const rows = await Seat.findAll({ where: { tripId: trip.id, status: { [Op.in]: E.LIVE_SEAT_STATUSES } }, attributes: ['status'], transaction: t });
  const held = rows.filter((r) => r.status === S.HELD).length;
  const confirmed = rows.filter((r) => r.status === S.CONFIRMED || r.status === S.BOARDED).length;
  const boarded = rows.filter((r) => r.status === S.BOARDED).length;
  const changes = { seatsHeld: held, seatsConfirmed: confirmed, seatsBoarded: boarded };
  await Trip.update(changes, { where: { id: trip.id }, transaction: t });
  Object.assign(trip, changes);
  if (typeof trip.setDataValue === 'function') for (const [k, v] of Object.entries(changes)) trip.setDataValue(k, v);
  if (confirmed + held > (Number(trip.capacity) || 0)) {
    // Impossible with the unique index + capacity check; refuse loudly rather than store it.
    throw fail(500, 'CAPACITY_INVARIANT', 'Seat count check failed. Please try again.');
  }
  return changes;
};

const releaseSeatsOf = async (bookingIds, t) => {
  if (!bookingIds.length) return 0;
  const { Seat } = M();
  const [n] = await Seat.update(
    { status: S.RELEASED, releasedAt: clock.now() },
    { where: { bookingId: { [Op.in]: bookingIds }, status: { [Op.in]: E.LIVE_SEAT_STATUSES } }, transaction: t },
  );
  return n;
};

/** Expires HELD bookings of this trip whose hold has passed (inside t). Returns the expired rows. */
const expireStaleHolds = async (trip, t) => {
  const { Booking } = M();
  const now = clock.now();
  const stale = await Booking.findAll({ where: { tripId: trip.id, status: B.HELD, holdExpiresAt: { [Op.lte]: now } }, transaction: t });
  const done = [];
  for (const b of stale) {
    const [n] = await Booking.update({ status: B.EXPIRED, expiredAt: now }, { where: { id: b.id, status: B.HELD }, transaction: t });
    if (n) { b.status = B.EXPIRED; done.push(b); }
  }
  await releaseSeatsOf(done.map((b) => b.id), t);
  return done;
};

const liveSeatNumbers = async (tripId, t) => {
  const rows = await M().Seat.findAll({ where: { tripId, status: { [Op.in]: E.LIVE_SEAT_STATUSES } }, attributes: ['seatNo'], transaction: t });
  return new Set(rows.map((r) => Number(r.seatNo)));
};

const seatList = (trip) => Array.from({ length: Number(trip.capacity) || 0 }, (_, i) => i + 1);

const uniqueCode = async (t) => {
  const { Booking } = M();
  for (let i = 0; i < 5; i++) {
    const code = newBookingCode();
    if (!(await Booking.findOne({ where: { bookingCode: code }, attributes: ['id'], transaction: t }))) return code;
  }
  return newBookingCode();
};

const assertBookable = (trip) => {
  if (!trip || trip.status === T.DRAFT) throw fail(404, 'NOT_FOUND', 'This auto trip was not found.');
  if (trip.mode === E.MODE.PRIVATE) throw fail(409, 'TRIP_PRIVATE', 'This auto has been booked as a full auto. Pick another auto.');
  if (trip.status === T.FULL) throw fail(409, 'TRIP_FULL', 'This auto is full. Pick another auto.');
  if (!E.BOOKABLE_STATUSES.includes(trip.status)) throw fail(409, 'BOOKING_CLOSED', `Booking is closed for this auto (${E.STATUS_LABELS[trip.status] || trip.status}).`, { status: trip.status });
  if (new Date(trip.departureAt).getTime() <= clock.nowMs()) throw fail(409, 'BOOKING_CLOSED', 'This auto is about to depart. Booking is closed.');
};

/**
 * Hold seats. Returns { booking, trip, created, expired: [] }.
 * input: { tripId, userId, seatCount, seatNumbers?, idempotencyKey? }
 */
/**
 * A retry key already used by this user. Replays only while that booking is live (HELD and unexpired,
 * CONFIRMED, BOARDED). A key whose booking has ended (EXPIRED, CANCELLED / released, ...) is refused with
 * 409 IDEMPOTENCY_KEY_REUSED { bookingId, status }: the unique (userId, idempotencyKey) index means a fresh
 * hold needs a fresh key (the app makes one and retries). Returns null when a lock pass is needed first
 * (a HELD booking past its holdExpiresAt is expired inside the trip lock, then refused).
 */
const replayHoldKey = (prior, tripId) => {
  if (String(prior.tripId) !== String(tripId)) throw fail(409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key was already used for another auto.', { bookingId: prior.id });
  if (prior.status === B.HELD && (!prior.holdExpiresAt || new Date(prior.holdExpiresAt).getTime() <= clock.nowMs())) return null;
  if (!E.LIVE_BOOKING_STATUSES.includes(prior.status)) {
    throw fail(409, 'IDEMPOTENCY_KEY_REUSED', 'That earlier hold has ended. Please hold the seats again.', { bookingId: prior.id, status: prior.status });
  }
  return { booking: prior, created: false, replay: true };
};

const hold = async ({ tripId, userId, seatCount, seatNumbers, idempotencyKey }) => {
  const settings = await readSettings();
  const { Booking, Seat } = M();
  if (idempotencyKey) {
    const prior = await Booking.findOne({ where: { userId, idempotencyKey } });
    const r = prior ? replayHoldKey(prior, tripId) : null;
    if (r) return { ...r, expired: [] };
  }
  let out;
  try {
    out = await withTripLock(tripId, async (t, trip) => {
      const expired = await expireStaleHolds(trip, t);
      if (idempotencyKey) {
        const prior = await Booking.findOne({ where: { userId, idempotencyKey }, transaction: t });
        if (prior) {
          if (expired.length) await recomputeCounters(trip, t);
          // An ended booking (incl. one expired just above) is refused AFTER commit, so the expiry sticks.
          try {
            const r = replayHoldKey(prior, tripId) || replayHoldKey(Object.assign(prior, { status: B.EXPIRED }), tripId);
            return { ...r, trip, expired };
          } catch (refused) {
            return { refused, trip, expired };
          }
        }
      }
      assertBookable(trip);
      const mine = await Booking.findOne({ where: { tripId: trip.id, userId, status: { [Op.in]: E.LIVE_BOOKING_STATUSES } }, transaction: t });
      if (mine && mine.status === B.HELD) {
        if (expired.length) await recomputeCounters(trip, t);
        return { booking: mine, trip, created: false, expired };
      }
      if (mine) throw fail(409, 'ALREADY_BOOKED', 'You already have seats on this auto.', { bookingId: mine.id });
      const openHolds = await Booking.count({ where: { userId, status: B.HELD, holdExpiresAt: { [Op.gt]: clock.now() } }, transaction: t });
      if (openHolds >= E.LIMITS.MAX_OPEN_HOLDS_PER_USER) throw fail(429, 'TOO_MANY_HOLDS', 'You are holding seats on other autos. Confirm or release them first.');

      const cap = Number(trip.capacity) || 0;
      const maxPer = Math.min(cap, settings.maxSeatsPerBooking);
      const count = Number(seatCount);
      if (!Number.isInteger(count) || count < 1 || count > maxPer) {
        throw fail(400, 'INVALID_INPUT', `You can book 1 to ${maxPer} seat${maxPer === 1 ? '' : 's'} on this auto.`, { field: 'seatCount', max: maxPer });
      }
      const taken = await liveSeatNumbers(trip.id, t);
      const free = seatList(trip).filter((n) => !taken.has(n));
      let chosen;
      if (Array.isArray(seatNumbers) && seatNumbers.length) {
        if (!trip.seatSelectionEnabled) throw fail(400, 'SEAT_SELECTION_OFF', 'Seats are assigned automatically on this auto.', { field: 'seatNumbers' });
        const want = [...new Set(seatNumbers.map(Number))];
        if (want.length !== count || want.some((n) => !Number.isInteger(n) || n < 1 || n > cap)) {
          throw fail(400, 'INVALID_INPUT', `Pick ${count} different seat${count === 1 ? '' : 's'} between 1 and ${cap}.`, { field: 'seatNumbers' });
        }
        const clash = want.filter((n) => taken.has(n));
        if (clash.length) throw fail(409, 'SEAT_TAKEN', `Seat ${clash.join(', ')} was just taken. Pick another seat.`, { seats: clash, available: free });
        chosen = want.sort((a, b) => a - b);
      } else {
        if (free.length === 0) throw fail(409, 'TRIP_FULL', 'All seats on this auto are taken.');
        if (free.length < count) throw fail(409, 'NOT_ENOUGH_SEATS', `Only ${free.length} seat${free.length === 1 ? '' : 's'} left on this auto.`, { available: free.length });
        chosen = free.slice(0, count);
      }
      const now = clock.nowMs();
      const holdExpiresAt = new Date(Math.min(now + settings.holdMinutes * 60 * 1000, new Date(trip.departureAt).getTime()));
      const fare = money(trip.seatFare);
      const booking = await Booking.create({
        bookingCode: await uniqueCode(t),
        tripId: trip.id,
        userId,
        driverId: trip.driverId,
        type: E.BOOKING_TYPE.SHARED,
        seatCount: count,
        seatNumbers: chosen,
        status: B.HELD,
        holdExpiresAt,
        paymentStatus: E.PAYMENT_STATUS.NONE,
        seatFare: fare,
        amount: money(fare * count),
        fareBreakdown: { seats: count, seatFare: fare, total: money(fare * count) },
        passengerCount: count,
        idempotencyKey: idempotencyKey || null,
      }, { transaction: t });
      await Seat.bulkCreate(chosen.map((seatNo) => ({ tripId: trip.id, seatNo, bookingId: booking.id, status: S.HELD, holdExpiresAt })), { transaction: t });
      await recomputeCounters(trip, t);
      return { booking, trip, created: true, expired };
    });
  } catch (err) {
    if (isUniqueError(err)) {
      // Another process sold the seat / the same user double-tapped in another process.
      if (idempotencyKey) {
        const prior = await Booking.findOne({ where: { userId, idempotencyKey } });
        const r = prior ? replayHoldKey(prior, tripId) : null;
        if (r) return { ...r, expired: [] };
      }
      throw fail(409, 'SEAT_TAKEN', 'Those seats were just taken. Please pick again.');
    }
    throw err;
  }
  if (out.refused) {
    out.refused.expiredHolds = out.expired;
    throw out.refused;
  }
  return out;
};

/** Confirm a hold. Returns { booking, trip, already, becameFull, almostFull, statusChanged }. */
const confirm = async ({ bookingId, userId, paymentMethod }) => {
  const { Booking, Seat, Trip } = M();
  const first = await Booking.findByPk(bookingId);
  if (!first || String(first.userId) !== String(userId)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const method = await payments.pickMethod(paymentMethod);
  const out = await withTripLock(first.tripId, async (t, trip) => {
    const b = await Booking.findByPk(bookingId, lockOpt(t));
    if (E.CONFIRMED_BOOKING_STATUSES.includes(b.status)) return { booking: b, trip, already: true };
    if (b.status === B.EXPIRED) return { gone: 'HOLD_EXPIRED', booking: b };
    if (b.status !== B.HELD) throw fail(409, 'BOOKING_NOT_HELD', `This booking is ${b.status.toLowerCase().replace('_', ' ')}.`, { status: b.status });
    if (!b.holdExpiresAt || new Date(b.holdExpiresAt).getTime() <= clock.nowMs()) {
      await Booking.update({ status: B.EXPIRED, expiredAt: clock.now() }, { where: { id: b.id, status: B.HELD }, transaction: t });
      await releaseSeatsOf([b.id], t);
      await recomputeCounters(trip, t);
      b.status = B.EXPIRED;
      return { gone: 'HOLD_EXPIRED', booking: b, trip };
    }
    const okStatus = E.BOOKABLE_STATUSES.includes(trip.status) || (trip.status === T.DELAYED && E.BOOKABLE_STATUSES.includes(trip.statusBeforeDelay));
    if (!okStatus || trip.mode !== E.MODE.SHARED) throw fail(409, 'BOOKING_CLOSED', 'Booking is closed for this auto.', { status: trip.status });
    const pay = await payments.charge({ userId, amount: b.amount, method, t, ref: { type: 'AUTO_BOOKING', id: b.id } });
    const now = clock.now();
    const [n] = await Booking.update(
      { status: B.CONFIRMED, confirmedAt: now, holdExpiresAt: null, boardingPin: newPin(), ...pay },
      { where: { id: b.id, status: B.HELD }, transaction: t },
    );
    if (!n) throw fail(409, 'BOOKING_CHANGED', 'This booking changed just now. Refresh and try again.');
    await Seat.update({ status: S.CONFIRMED, holdExpiresAt: null }, { where: { bookingId: b.id, status: S.HELD }, transaction: t });
    await recomputeCounters(trip, t);
    const before = trip.status;
    await syncAvailability(trip, { t });
    const res = { trip, already: false, statusChanged: before !== trip.status, becameFull: trip.status === T.FULL && !trip.fullNotifiedAt, almostFull: false };
    const cap = Number(trip.capacity) || 0;
    const remaining = cap - (Number(trip.seatsConfirmed) || 0) - (Number(trip.seatsHeld) || 0);
    if (res.becameFull) await Trip.update({ fullNotifiedAt: now }, { where: { id: trip.id }, transaction: t });
    else if (!trip.almostFullNotifiedAt && remaining > 0 && remaining <= Math.max(1, Math.ceil(cap * 0.25))) {
      await Trip.update({ almostFullNotifiedAt: now }, { where: { id: trip.id }, transaction: t });
      res.almostFull = true;
    }
    res.booking = await Booking.findByPk(b.id, { transaction: t });
    return res;
  });
  if (out.gone) throw fail(410, 'HOLD_EXPIRED', 'Your seat hold expired and the seats were released. Please book again.', { bookingId });
  return out;
};

/**
 * Cancel one booking (inside a trip lock). by: customer | driver | admin | system.
 * Returns the updated booking (REFUND_PENDING when a wallet refund is due: call payments.processRefund after commit).
 */
const cancelOneInTx = async (b, trip, { by, reason, t, pct }) => {
  const { Booking, Trip } = M();
  const now = clock.now();
  const cols = b.status === B.HELD
    ? { status: B.CANCELLED, paymentStatus: E.PAYMENT_STATUS.NONE, refundAmount: 0 }
    : payments.cancellationColumns(b, pct === undefined ? 100 : pct);
  const [n] = await Booking.update(
    { ...cols, cancelledAt: now, cancelledBy: by, cancelReason: reason ? String(reason).slice(0, 300) : null, holdExpiresAt: null },
    { where: { id: b.id, status: b.status }, transaction: t },
  );
  if (!n) throw fail(409, 'BOOKING_CHANGED', 'This booking changed just now. Refresh and try again.');
  await releaseSeatsOf([b.id], t);
  if (b.type === E.BOOKING_TYPE.PRIVATE && trip.mode === E.MODE.PRIVATE && String(trip.privateBookingId) === String(b.id)) {
    await Trip.update({ mode: E.MODE.SHARED, privateBookingId: null }, { where: { id: trip.id }, transaction: t });
    trip.mode = E.MODE.SHARED;
    trip.privateBookingId = null;
    if (typeof trip.setDataValue === 'function') { trip.setDataValue('mode', E.MODE.SHARED); trip.setDataValue('privateBookingId', null); }
  }
  Object.assign(b, cols, { cancelledAt: now, cancelledBy: by });
  return b;
};

/** Customer releases a hold or cancels a confirmed booking. Returns { booking, trip }. */
const cancelByCustomer = async ({ bookingId, userId, reason }) => {
  const { Booking } = M();
  const first = await Booking.findByPk(bookingId);
  if (!first || String(first.userId) !== String(userId)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const out = await withTripLock(first.tripId, async (t, trip) => {
    const b = await Booking.findByPk(bookingId, lockOpt(t));
    if (![B.HELD, B.CONFIRMED].includes(b.status)) throw fail(409, 'CANNOT_CANCEL', `This booking is already ${b.status.toLowerCase().replace('_', ' ')}.`, { status: b.status });
    if (b.status === B.CONFIRMED && [T.BOARDING, T.IN_PROGRESS, ...E.TERMINAL_TRIP_STATUSES].includes(trip.status)) {
      throw fail(409, 'CANNOT_CANCEL', 'Boarding has started; this booking can no longer be cancelled. Report a problem instead.');
    }
    const pct = b.status === B.HELD ? 0 : await payments.refundPct('customer', trip);
    await cancelOneInTx(b, trip, { by: 'customer', reason: cleanText(reason, 300) || (b.status === B.HELD ? 'Hold released' : 'Cancelled by passenger'), t, pct });
    await recomputeCounters(trip, t);
    await syncAvailability(trip, { t });
    return { booking: await Booking.findByPk(b.id, { transaction: t }), trip };
  });
  if (out.booking.status === B.REFUND_PENDING) {
    await payments.processRefund(out.booking.id);
    await out.booking.reload();
  }
  return out;
};

/** Trip-ending cleanup inside a trip lock: every live booking cancelled (100 % refund), open private requests closed. */
const closeTripBookings = async (trip, { by, reason, t }) => {
  const { Booking, Private } = M();
  const live = await Booking.findAll({ where: { tripId: trip.id, status: { [Op.in]: E.LIVE_BOOKING_STATUSES } }, transaction: t });
  const cancelled = [];
  for (const b of live) cancelled.push(await cancelOneInTx(b, trip, { by, reason, t, pct: 100 }));
  const open = await Private.findAll({ where: { tripId: trip.id, status: PR.REQUESTED }, transaction: t });
  for (const r of open) {
    const [n] = await Private.update({ status: PR.CANCELLED, respondedAt: clock.now(), declineReason: reason ? String(reason).slice(0, 300) : 'Trip cancelled' }, { where: { id: r.id, status: PR.REQUESTED }, transaction: t });
    if (n) r.status = PR.CANCELLED;
  }
  await recomputeCounters(trip, t);
  return { cancelled, privateClosed: open.filter((r) => r.status === PR.CANCELLED) };
};

// ── Full-auto (private) requests ────────────────────────────────────────────

/** Server-side private fare: the driver's full-auto fare + optional extra charges (both fixed at publish). */
const privateFare = (trip) => {
  const baseFare = money(trip.fullAutoFare);
  const extra = Number(trip.extraChargesAmount) > 0 ? money(trip.extraChargesAmount) : 0;
  return { fare: money(baseFare + extra), baseFare, extraChargesAmount: extra || null, extraChargesNote: extra ? (trip.extraChargesNote || null) : null };
};

const createPrivateRequest = async ({ tripId, userId, passengers, purpose, paymentMethod, idempotencyKey }) => {
  const { Private } = M();
  const settings = await readSettings();
  const method = await payments.pickMethod(paymentMethod);
  if (idempotencyKey) {
    const prior = await Private.findOne({ where: { userId, idempotencyKey } });
    if (prior) return { request: prior, created: false };
  }
  try {
    return await withTripLock(tripId, async (t, trip) => {
      await expireStaleHolds(trip, t);
      await recomputeCounters(trip, t);
      assertBookable(trip);
      if (!trip.privateBookingEnabled || !trip.fullAutoFare) throw fail(409, 'PRIVATE_OFF', 'This driver is not taking full-auto bookings on this trip.');
      if ((Number(trip.seatsConfirmed) || 0) + (Number(trip.seatsHeld) || 0) > 0) {
        throw fail(409, 'SEATS_ALREADY_BOOKED', 'Some seats on this auto are already booked, so it cannot be booked as a full auto. Book seats instead, or pick an empty auto.');
      }
      const pax = Number(passengers);
      if (!Number.isInteger(pax) || pax < 1 || pax > trip.capacity) throw fail(400, 'INVALID_INPUT', `Passengers must be 1 to ${trip.capacity}.`, { field: 'passengers' });
      const mineOpen = await Private.findOne({ where: { tripId: trip.id, userId, status: PR.REQUESTED }, transaction: t });
      if (mineOpen) return { request: mineOpen, created: false };
      const open = await Private.count({ where: { userId, status: PR.REQUESTED }, transaction: t });
      if (open >= E.LIMITS.MAX_OPEN_PRIVATE_REQUESTS_PER_USER) throw fail(429, 'TOO_MANY_REQUESTS', 'You already have full-auto requests waiting. Wait for the drivers to answer.');
      const respondBy = new Date(Math.min(clock.nowMs() + settings.privateRespondMinutes * 60 * 1000, new Date(trip.departureAt).getTime()));
      const request = await Private.create({
        userId, tripId: trip.id, driverId: trip.driverId, status: PR.REQUESTED, passengers: pax,
        purpose: cleanText(purpose, 200) || null, ...privateFare(trip), paymentMethod: method, respondBy,
        idempotencyKey: idempotencyKey || null,
      }, { transaction: t });
      return { request, created: true, trip };
    });
  } catch (err) {
    if (isUniqueError(err)) {
      const prior = await Private.findOne({ where: { userId, tripId, status: PR.REQUESTED } });
      if (prior) return { request: prior, created: false };
    }
    throw err;
  }
};

/** Driver accepts. Returns { request, booking, trip, conflict } (conflict = seats were sold meanwhile). */
const acceptPrivateRequest = async ({ requestId, driverId }) => {
  const { Private, Booking, Seat, Trip } = M();
  const first = await Private.findByPk(requestId);
  if (!first || String(first.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Request not found.');
  const out = await withTripLock(first.tripId, async (t, trip) => {
    const r = await Private.findByPk(requestId, lockOpt(t));
    if (r.status === PR.ACCEPTED) return { request: r, trip, booking: r.bookingId ? await Booking.findByPk(r.bookingId, { transaction: t }) : null, already: true };
    if (r.status !== PR.REQUESTED) throw fail(409, 'REQUEST_CLOSED', `This request is ${r.status.toLowerCase()}.`, { status: r.status });
    if (r.respondBy && new Date(r.respondBy).getTime() <= clock.nowMs()) {
      await Private.update({ status: PR.EXPIRED, respondedAt: clock.now() }, { where: { id: r.id, status: PR.REQUESTED }, transaction: t });
      r.status = PR.EXPIRED;
      return { request: r, trip, gone: 'REQUEST_EXPIRED' };
    }
    await expireStaleHolds(trip, t);
    await recomputeCounters(trip, t);
    const live = (Number(trip.seatsConfirmed) || 0) + (Number(trip.seatsHeld) || 0);
    if (live > 0 || trip.mode !== E.MODE.SHARED || !E.BOOKABLE_STATUSES.includes(trip.status) || new Date(trip.departureAt).getTime() <= clock.nowMs()) {
      await Private.update({ status: PR.CONFLICT, respondedAt: clock.now(), declineReason: live > 0 ? 'Seats were booked by other passengers first.' : 'The trip is no longer open.' }, { where: { id: r.id, status: PR.REQUESTED }, transaction: t });
      r.status = PR.CONFLICT;
      return { request: r, trip, conflict: true };
    }
    const cap = Number(trip.capacity) || 0;
    const pay = await payments.charge({ userId: r.userId, amount: r.fare, method: r.paymentMethod || E.PAYMENT_METHODS.CASH, t, ref: { type: 'AUTO_PRIVATE_REQUEST', id: r.id } }).catch(async (err) => {
      if (err && err.code === 'INSUFFICIENT_WALLET') return { failed: true };
      throw err;
    });
    if (pay.failed) {
      await Private.update({ status: PR.DECLINED, respondedAt: clock.now(), declineReason: 'Not enough Zenvy Wallet balance.' }, { where: { id: r.id, status: PR.REQUESTED }, transaction: t });
      r.status = PR.DECLINED;
      return { request: r, trip, paymentFailed: true };
    }
    const now = clock.now();
    const seats = seatList(trip);
    const booking = await Booking.create({
      bookingCode: await uniqueCode(t), tripId: trip.id, userId: r.userId, driverId: trip.driverId, type: E.BOOKING_TYPE.PRIVATE,
      seatCount: cap, seatNumbers: seats, status: B.CONFIRMED, confirmedAt: now, boardingPin: newPin(),
      seatFare: null, amount: money(r.fare),
      fareBreakdown: {
        fullAuto: true, fare: money(r.fare), total: money(r.fare),
        ...(Number(r.extraChargesAmount) > 0 ? { baseFare: money(r.baseFare), extraCharges: { amount: money(r.extraChargesAmount), note: r.extraChargesNote || null } } : {}),
      },
      passengerCount: r.passengers, purpose: r.purpose, privateRequestId: r.id, ...pay,
    }, { transaction: t });
    await Seat.bulkCreate(seats.map((seatNo) => ({ tripId: trip.id, seatNo, bookingId: booking.id, status: S.CONFIRMED })), { transaction: t });
    await Trip.update({ mode: E.MODE.PRIVATE, privateBookingId: booking.id }, { where: { id: trip.id }, transaction: t });
    trip.mode = E.MODE.PRIVATE;
    trip.privateBookingId = booking.id;
    if (typeof trip.setDataValue === 'function') { trip.setDataValue('mode', E.MODE.PRIVATE); trip.setDataValue('privateBookingId', booking.id); }
    await Private.update({ status: PR.ACCEPTED, respondedAt: now, bookingId: booking.id }, { where: { id: r.id, status: PR.REQUESTED }, transaction: t });
    r.status = PR.ACCEPTED;
    r.bookingId = booking.id;
    // Other pending full-auto requests on this trip can no longer be served.
    const others = await Private.findAll({ where: { tripId: trip.id, status: PR.REQUESTED, id: { [Op.ne]: r.id } }, transaction: t });
    for (const o of others) await Private.update({ status: PR.CONFLICT, respondedAt: now, declineReason: 'The auto was booked by someone else.' }, { where: { id: o.id, status: PR.REQUESTED }, transaction: t });
    await recomputeCounters(trip, t);
    await syncAvailability(trip, { t });
    if (trip.status === T.FULL && !trip.fullNotifiedAt) await Trip.update({ fullNotifiedAt: now }, { where: { id: trip.id }, transaction: t });
    return { request: r, booking, trip, others };
  });
  if (out.gone) throw fail(410, 'REQUEST_EXPIRED', 'This request expired before you answered.');
  return out;
};

const declinePrivateRequest = async ({ requestId, driverId, reason }) => {
  const { Private } = M();
  const r = await Private.findByPk(requestId);
  if (!r || String(r.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Request not found.');
  if (r.status !== PR.REQUESTED) throw fail(409, 'REQUEST_CLOSED', `This request is ${r.status.toLowerCase()}.`, { status: r.status });
  const [n] = await Private.update({ status: PR.DECLINED, respondedAt: clock.now(), declineReason: cleanText(reason, 300) || 'The driver declined.' }, { where: { id: r.id, status: PR.REQUESTED } });
  if (!n) throw fail(409, 'REQUEST_CLOSED', 'This request changed just now.');
  await r.reload();
  return r;
};

const cancelPrivateRequest = async ({ requestId, userId }) => {
  const { Private } = M();
  const r = await Private.findByPk(requestId);
  if (!r || String(r.userId) !== String(userId)) throw fail(404, 'NOT_FOUND', 'Request not found.');
  if (r.status !== PR.REQUESTED) throw fail(409, 'REQUEST_CLOSED', `This request is ${r.status.toLowerCase()}.`, { status: r.status });
  const [n] = await Private.update({ status: PR.CANCELLED, respondedAt: clock.now(), declineReason: 'Cancelled by you.' }, { where: { id: r.id, status: PR.REQUESTED } });
  if (!n) throw fail(409, 'REQUEST_CLOSED', 'This request changed just now.');
  await r.reload();
  return r;
};

// ── Boarding ────────────────────────────────────────────────────────────────

/** Driver checks a passenger in with booking code + PIN (5 wrong tries -> 15 min lock). */
const checkIn = async ({ tripId, driverId, bookingCode, pin, cashCollected }) => {
  const { Booking, Seat } = M();
  const code = String(bookingCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const p = String(pin || '').replace(/\D/g, '').slice(0, 6);
  if (!code) throw fail(400, 'INVALID_INPUT', 'Enter the passenger\'s booking code.', { field: 'bookingCode' });
  if (!p) throw fail(400, 'INVALID_INPUT', 'Enter the passenger\'s 4-digit PIN.', { field: 'pin' });
  const out = await withTripLock(tripId, async (t, trip) => {
    if (String(trip.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Trip not found.');
    if (trip.status !== T.BOARDING) throw fail(409, 'NOT_BOARDING', 'Start boarding first, then check passengers in.');
    const b = await Booking.findOne({ where: { tripId: trip.id, bookingCode: code }, ...lockOpt(t) });
    if (!b) return { wrong: 'NO_BOOKING' };
    if (b.status === B.BOARDED) return { booking: b, trip, already: true };
    if (b.status !== B.CONFIRMED) throw fail(409, 'NOT_CONFIRMED', `This booking is ${b.status.toLowerCase()}.`);
    if (b.pinLockedUntil && new Date(b.pinLockedUntil).getTime() > clock.nowMs()) {
      return { locked: true, until: b.pinLockedUntil };
    }
    if (p !== String(b.boardingPin || '')) {
      const attempts = (Number(b.pinAttempts) || 0) + 1;
      const lock = attempts >= E.LIMITS.PIN_MAX_ATTEMPTS;
      await Booking.update({ pinAttempts: lock ? 0 : attempts, pinLockedUntil: lock ? new Date(clock.nowMs() + E.LIMITS.PIN_LOCK_MS) : null }, { where: { id: b.id }, transaction: t });
      return { wrong: 'PIN', attemptsLeft: lock ? 0 : E.LIMITS.PIN_MAX_ATTEMPTS - attempts, locked: lock };
    }
    const now = clock.now();
    const cash = b.paymentMethod === E.PAYMENT_METHODS.CASH && cashCollected === true;
    await Booking.update({
      status: B.BOARDED, boardedAt: now, pinAttempts: 0, pinLockedUntil: null,
      ...(cash ? { cashCollectedAt: now, paymentStatus: E.PAYMENT_STATUS.CASH_COLLECTED } : {}),
    }, { where: { id: b.id, status: B.CONFIRMED }, transaction: t });
    await Seat.update({ status: S.BOARDED }, { where: { bookingId: b.id, status: S.CONFIRMED }, transaction: t });
    await recomputeCounters(trip, t);
    return { booking: await Booking.findByPk(b.id, { transaction: t }), trip };
  });
  if (out.locked) {
    const until = out.until ? new Date(out.until) : new Date(clock.nowMs() + E.LIMITS.PIN_LOCK_MS);
    throw fail(429, 'PIN_LOCKED', 'Too many wrong PINs for this booking. Try again in 15 minutes or ask the passenger to contact support.', {
      attemptsLeft: 0, lockedUntil: until.toISOString(), retryAfter: Math.max(1, Math.ceil((until.getTime() - clock.nowMs()) / 1000)),
    });
  }
  if (out.wrong === 'NO_BOOKING') throw fail(404, 'NOT_FOUND', 'No booking with that code on this trip.');
  if (out.wrong === 'PIN') throw fail(400, 'WRONG_PIN', `Wrong PIN. ${out.attemptsLeft} attempt${out.attemptsLeft === 1 ? '' : 's'} left.`, { attemptsLeft: out.attemptsLeft });
  return out;
};

/** Driver marks a confirmed passenger who did not turn up (after the departure time). */
const markNoShow = async ({ tripId, driverId, bookingId }) => {
  const { Booking } = M();
  // S1: a passenger can be marked no-show only noShowGraceMinutes after the departure time (late passengers
  // keep their seat; starting the trip still closes unboarded bookings as before).
  const graceMin = Number((await readSettings()).noShowGraceMinutes) || 0;
  return withTripLock(tripId, async (t, trip) => {
    if (String(trip.driverId) !== String(driverId)) throw fail(404, 'NOT_FOUND', 'Trip not found.');
    if (![T.DRIVER_CONFIRMED, T.BOARDING].includes(trip.status)) throw fail(409, 'INVALID_STATE', 'Passengers can be marked no-show only after you confirm departure.');
    if (new Date(trip.departureAt).getTime() + graceMin * 60 * 1000 > clock.nowMs()) throw fail(409, 'TOO_EARLY', `Wait ${graceMin} minutes after the departure time before marking a passenger as no-show.`, { graceMinutes: graceMin });
    const b = await Booking.findByPk(bookingId, lockOpt(t));
    if (!b || String(b.tripId) !== String(trip.id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
    if (b.status !== B.CONFIRMED) throw fail(409, 'INVALID_STATE', `This booking is ${b.status.toLowerCase()}.`);
    const now = clock.now();
    await Booking.update({ status: B.NO_SHOW, noShowAt: now, paymentStatus: b.paymentMethod === E.PAYMENT_METHODS.WALLET ? E.PAYMENT_STATUS.NOT_REFUNDED : E.PAYMENT_STATUS.NONE }, { where: { id: b.id, status: B.CONFIRMED }, transaction: t });
    await releaseSeatsOf([b.id], t);
    await recomputeCounters(trip, t);
    return { booking: await Booking.findByPk(b.id, { transaction: t }), trip };
  });
};

/** Lifecycle helper: expire stale holds of one trip in its lock. */
const expireTripHolds = (tripId) => withTripLock(tripId, async (t, trip) => {
  const expired = await expireStaleHolds(trip, t);
  if (expired.length) {
    await recomputeCounters(trip, t);
    await syncAvailability(trip, { t });
  }
  return { expired, trip };
});

module.exports = {
  hold, confirm, cancelByCustomer, cancelOneInTx, closeTripBookings, recomputeCounters, expireStaleHolds, expireTripHolds,
  releaseSeatsOf, liveSeatNumbers, createPrivateRequest, acceptPrivateRequest, declinePrivateRequest, cancelPrivateRequest,
  checkIn, markNoShow, assertBookable, transitionTrip, privateFare,
};
