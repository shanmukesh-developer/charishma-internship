// Auto-Ride lifecycle job (every 30 s, scheduled in jobs/index.js as 'autoRide.lifecycle' through
// utils/jobs.runExclusive, quietWhenIdle). runAutoRideJobs(now) is exported for tests.
//  1. expired seat holds          -> EXPIRED, seats released (per trip, in the trip lock)
//  2. PUBLISHED at bookingOpensAt -> OPEN_FOR_BOOKING
//  3. full-auto requests past respondBy -> EXPIRED (customer told)
//  4. reminder N min before departure (passengers + driver), once per trip
//  5. driver no-show: still not boarding noShowGraceMinutes after departure -> NO_SHOW (with confirmed
//     passengers, full refund) or CANCELLED by the system (nobody booked)
//  6. passenger safety net: CONFIRMED bookings on a trip already IN_PROGRESS -> NO_SHOW
//  7. IN_PROGRESS for longer than autoCompleteHours -> COMPLETED (system)
//  8. REFUND_PENDING bookings -> retried (exactly once each, payments.processRefund)
//  9. union queue: a line with waiting autos but nobody on charge gets its front auto back (crash safety net).
//     Autos on charge have no reminder (no departure time); one still on charge chargeMaxHours after it reached
//     the front is closed by step 5 like any trip that never left. Waiting autos never expire while waiting.
// Cheap when idle: one indexed lookup for any non-terminal trip / pending refund / open request,
// and nothing else when there is none (the case while the feature is off and unused).
const { Op } = require('sequelize');
const { getModel } = require('./index');
const E = require('./enums');
const clock = require('./services/clock');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;

const runAutoRideJobs = async (now = clock.now()) => {
  const Trip = getModel('AutoTrip');
  const Booking = getModel('AutoBooking');
  const Private = getModel('AutoPrivateRequest');
  if (!Trip || !Booking || !Private) return { skipped: true };
  const busy = await Trip.findOne({ where: { status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } }, attributes: ['id'] })
    || await Booking.findOne({ where: { status: { [Op.in]: [B.REFUND_PENDING, B.HELD] } }, attributes: ['id'] })
    || await Private.findOne({ where: { status: E.PRIVATE_STATUS.REQUESTED }, attributes: ['id'] });
  if (!busy) return { idle: true };

  // Lazy requires: nothing below loads while idle.
  const alloc = require('./services/allocation');
  const actions = require('./services/tripActions');
  const payments = require('./services/payments');
  const notify = require('./services/notify');
  const { withTripLock } = require('./services/locks');
  const { transitionTrip } = require('./services/stateMachine');
  const { readSettings } = require('./services/flag');
  const settings = await readSettings();
  const out = { linesHealed: 0, holdsExpired: 0, opened: 0, privateExpired: 0, reminders: 0, driverNoShow: 0, systemCancelled: 0, passengerNoShow: 0, autoCompleted: 0, refunds: 0, errors: 0 };
  const safe = async (fn) => {
    try { await fn(); } catch (err) { out.errors++; console.warn('[AUTORIDE_JOB_WARN]', err.message); }
  };

  // 1. Expired holds.
  const stale = await Booking.findAll({ where: { status: B.HELD, holdExpiresAt: { [Op.lte]: now } }, attributes: ['tripId'], limit: 500 });
  for (const tripId of [...new Set(stale.map((b) => String(b.tripId)))]) {
    await safe(async () => {
      const r = await alloc.expireTripHolds(tripId);
      out.holdsExpired += r.expired.length;
      for (const b of r.expired) notify.bookingEvent(b, { title: 'Seat hold expired', body: 'Your held seats were released because the booking was not confirmed in time.', type: 'AUTO_HOLD_EXPIRED' });
      if (r.expired.length) notify.tripEvent(r.trip, {});
    });
  }

  // 2. Booking opens.
  const opening = await Trip.findAll({ where: { status: T.PUBLISHED, bookingOpensAt: { [Op.lte]: now } }, attributes: ['id'], limit: 200 });
  for (const row of opening) {
    await safe(async () => {
      const trip = await withTripLock(row.id, async (t, tr) => {
        if (tr.status !== T.PUBLISHED) return null;
        await transitionTrip(tr, T.OPEN_FOR_BOOKING, { actor: 'system', t, note: 'Booking open' });
        return tr;
      });
      if (trip) { out.opened++; notify.tripEvent(trip, {}); }
    });
  }

  // 3. Full-auto requests nobody answered.
  const unanswered = await Private.findAll({ where: { status: E.PRIVATE_STATUS.REQUESTED, respondBy: { [Op.lte]: now } }, limit: 200 });
  for (const r of unanswered) {
    await safe(async () => {
      const [n] = await Private.update({ status: E.PRIVATE_STATUS.EXPIRED, respondedAt: now }, { where: { id: r.id, status: E.PRIVATE_STATUS.REQUESTED } });
      if (!n) return;
      out.privateExpired++;
      notify.toCustomers([r.userId], 'Full-auto request expired', 'The driver did not answer in time. Nothing was charged. Try another auto.', { type: 'AUTO_PRIVATE_EXPIRED', requestId: r.id });
      notify.nudgeCustomers([r.userId], 'private_request', r.id, E.PRIVATE_STATUS.EXPIRED);
      notify.nudgeDriver(r.driverId, 'private_request', r.id, E.PRIVATE_STATUS.EXPIRED);
    });
  }

  // 4. Departure reminders.
  if (settings.reminderMinutes > 0) {
    const soon = new Date(now.getTime() + settings.reminderMinutes * 60 * 1000);
    const due = await Trip.findAll({ where: { status: { [Op.in]: [T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL, T.DRIVER_CONFIRMED] }, reminderNotifiedAt: null, departureAt: { [Op.lte]: soon, [Op.gt]: now } }, limit: 200 });
    for (const trip of due) {
      if (trip.dispatchMode === E.DISPATCH_MODE.ON_CHARGE) continue; // leaves when full or on Depart: nothing to remind
      await safe(async () => {
        const [n] = await Trip.update({ reminderNotifiedAt: now }, { where: { id: trip.id, reminderNotifiedAt: null } });
        if (!n) return;
        out.reminders++;
        notify.tripEvent(trip, {
          title: 'Your auto leaves soon 🛺', body: 'Be at the pickup point with your booking code and PIN.', type: 'AUTO_REMINDER',
          driverTitle: 'Departure soon', driverBody: `${trip.seatsConfirmed || 0}/${trip.capacity} seats confirmed. Confirm departure when ready.`,
        });
      });
    }
  }

  // 5. Driver no-show.
  const graceAgo = new Date(now.getTime() - settings.noShowGraceMinutes * 60 * 1000);
  const late = await Trip.findAll({ where: { status: { [Op.in]: [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL, T.DRIVER_CONFIRMED, T.DELAYED] }, departureAt: { [Op.lte]: graceAgo } }, attributes: ['id', 'seatsConfirmed', 'driverId', 'dispatchMode', 'queueState'], limit: 200 });
  for (const row of late) {
    const charge = row.dispatchMode === E.DISPATCH_MODE.ON_CHARGE;
    // Union queue: a waiting auto's time limit starts when it reaches the front (promotion resets departureAt).
    if (charge && row.queueState === E.QUEUE_STATE.WAITING) continue;
    await safe(async () => {
      if (charge) {
        // An earlier close in this run may have moved this auto to the front with a fresh time limit.
        const fresh = await Trip.findByPk(row.id, { attributes: ['id', 'departureAt', 'queueState'] });
        if (!fresh || fresh.queueState === E.QUEUE_STATE.WAITING || new Date(fresh.departureAt).getTime() > graceAgo.getTime()) return;
        // (Bookings are not moved by this close: only a cancel / unavailable by the driver or an admin moves them.)
      }
      // Walk-in seats are not passengers who booked: they never turn a closed line slot into a driver no-show.
      const confirmed = await Booking.count({ where: { tripId: row.id, status: { [Op.in]: E.CONFIRMED_BOOKING_STATUSES }, type: { [Op.ne]: E.BOOKING_TYPE.WALK_IN } } });
      const to = confirmed > 0 ? T.NO_SHOW : T.CANCELLED;
      const reason = charge
        ? (confirmed > 0 ? 'The auto stayed on charge too long without leaving' : 'Time in the line ran out')
        : (confirmed > 0 ? 'The auto did not depart on time' : 'Departure time passed');
      await actions.endTrip({ tripId: row.id, to, actor: 'system', reason });
      if (to === T.NO_SHOW) {
        out.driverNoShow++;
        notify.toDriver(row.driverId, 'Trip marked as no-show', 'You did not start boarding in time. Passengers were refunded and told.', { type: 'AUTO_DRIVER_NO_SHOW', tripId: row.id });
      } else out.systemCancelled++;
    });
  }

  // 6. Passenger no-show safety net.
  const running = await Trip.findAll({ where: { status: T.IN_PROGRESS }, attributes: ['id'], limit: 200 });
  for (const row of running) {
    await safe(async () => {
      const r = await withTripLock(row.id, async (t, tr) => {
        if (tr.status !== T.IN_PROGRESS) return [];
        const missed = await Booking.findAll({ where: { tripId: tr.id, status: B.CONFIRMED }, transaction: t });
        for (const b of missed) await Booking.update({ status: B.NO_SHOW, noShowAt: now }, { where: { id: b.id, status: B.CONFIRMED }, transaction: t });
        if (missed.length) {
          await alloc.releaseSeatsOf(missed.map((b) => b.id), t);
          await alloc.recomputeCounters(tr, t);
        }
        return missed;
      });
      out.passengerNoShow += r.length;
    });
  }

  // 7. Auto-complete forgotten trips.
  const longAgo = new Date(now.getTime() - settings.autoCompleteHours * 60 * 60 * 1000);
  const forgotten = await Trip.findAll({ where: { status: T.IN_PROGRESS, startedAt: { [Op.lte]: longAgo } }, attributes: ['id'], limit: 200 });
  for (const row of forgotten) {
    await safe(async () => {
      const trip = await withTripLock(row.id, async (t, tr) => {
        if (tr.status !== T.IN_PROGRESS) return null;
        await transitionTrip(tr, T.COMPLETED, { actor: 'system', t, note: 'Auto-completed' });
        await Booking.update({ status: B.COMPLETED, completedAt: now }, { where: { tripId: tr.id, status: B.BOARDED }, transaction: t });
        return tr;
      });
      if (trip) { out.autoCompleted++; notify.tripEvent(trip, {}); }
    });
  }

  // 9. Lines without a front auto (normally fixed in the same transaction; this is the safety net).
  await safe(async () => {
    const healed = await require('./services/chargeLine').healLines();
    out.linesHealed += healed.length; // promoteNext already tells each driver after commit
  });

  // 8. Refund retries.
  const pending = await Booking.findAll({ where: { status: B.REFUND_PENDING }, attributes: ['id', 'userId'], limit: 200 });
  for (const b of pending) {
    await safe(async () => {
      const amt = await payments.processRefund(b.id);
      if (amt > 0) {
        out.refunds++;
        notify.toCustomers([b.userId], 'Refund done', `₹${amt} is back in your Zenvy Wallet.`, { type: 'AUTO_REFUND', bookingId: b.id });
      }
    });
  }
  return out;
};

module.exports = { runAutoRideJobs };
