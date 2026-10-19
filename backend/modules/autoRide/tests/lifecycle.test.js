// Lifecycle job (runAutoRideJobs with an injected clock) + boarding PIN lock + passenger no-show.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let run;

before(async () => {
  await H.setup({ label: 'ar-lifecycle' });
  await H.setFlag(true);
  run = () => H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
});
after(H.teardown);

test('booking opens at bookingOpensAt (PUBLISHED -> OPEN_FOR_BOOKING by the job)', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30, departInMin: 120, bookingOpensAt: new Date(H.now() + 30 * H.MIN).toISOString() });
  assert.equal(t.trip.status, 'PUBLISHED');
  const u = await H.mkUser();
  const card = await api('GET', `/api/auto-ride/trips/${t.trip.id}`, u.token);
  assert.equal(card.body.trip.availability, 'NOT_OPEN');
  assert.equal((await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 })).body.code, 'BOOKING_CLOSED');
  assert.equal((await run()).opened, 0);
  H.advance(31 * H.MIN);
  assert.equal((await run()).opened, 1);
  assert.equal((await H.ctx.M('AutoTrip').findByPk(t.trip.id)).status, 'OPEN_FOR_BOOKING');
  assert.equal((await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 })).status, 201);
});

test('unanswered full-auto requests expire; nothing was ever held', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30, fullAutoFare: 400, privateBookingEnabled: true });
  const u = await H.mkUser();
  const r = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, u.token, { passengers: 3 });
  H.advance(11 * H.MIN);
  const out = await run();
  assert.ok(out.privateExpired >= 1);
  const mine = await api('GET', `/api/auto-ride/private-requests/${r.body.request.id}`, u.token);
  assert.equal(mine.body.request.status, 'EXPIRED');
  assert.ok((await H.notificationsFor(u.id)).some((n) => n.type === 'AUTO_PRIVATE_EXPIRED'));
  const acc = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, t.token);
  assert.equal(acc.status, 409);
});

test('departure reminder goes out once to passengers and the driver', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30, departInMin: 25 });
  const b = await H.book(t.trip.id, { seatCount: 1 });
  H.advance(12 * H.MIN);
  const r1 = await run();
  const r2 = await run();
  assert.ok(r1.reminders >= 1);
  assert.equal(r2.reminders, 0);
  assert.equal((await H.notificationsFor(b.user.id)).filter((n) => n.type === 'AUTO_REMINDER').length, 1);
  assert.equal((await H.notificationsFor(t.driver.id)).filter((n) => n.title === 'Departure soon').length, 1);
});

test('driver no-show: confirmed passengers -> NO_SHOW + bookings cancelled; empty trip -> system CANCELLED', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30, departInMin: 20 });
  const b = await H.book(t.trip.id, { seatCount: 2 });
  const empty = await H.mkTrip({ capacity: 6, seatFare: 30, departInMin: 20 });
  H.advance(55 * H.MIN);
  const out = await run();
  assert.ok(out.driverNoShow >= 1 && out.systemCancelled >= 1);
  assert.equal((await H.ctx.M('AutoTrip').findByPk(t.trip.id)).status, 'NO_SHOW');
  assert.equal((await H.ctx.M('AutoTrip').findByPk(empty.trip.id)).status, 'CANCELLED');
  const bk = await api('GET', `/api/auto-ride/bookings/${b.booking.id}`, b.user.token);
  assert.equal(bk.body.booking.status, 'CANCELLED');
  assert.equal(bk.body.booking.cancelledBy, 'system');
  assert.ok((await H.notificationsFor(b.user.id)).some((n) => n.type === 'AUTO_TRIP_CANCELLED'));
  assert.ok((await H.notificationsFor(t.driver.id)).some((n) => n.type === 'AUTO_DRIVER_NO_SHOW'));
  const ev = await H.ctx.M('AutoTripEvent').findOne({ where: { tripId: t.trip.id, toStatus: 'NO_SHOW' } });
  assert.equal(ev.actorType, 'system');
  // The driver is free to publish again.
  const again = await H.mkTrip({ capacity: 3, seatFare: 30, driver: { driver: t.driver, vehicle: t.vehicle, token: t.token }, route: t.route, pickup: t.pickup });
  assert.equal(again.trip.status, 'OPEN_FOR_BOOKING');
});

test('boarding PIN: 5 wrong tries lock the booking for 15 minutes; passenger no-show after departure', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30, departInMin: 10, minSeatsToDepart: 2 });
  const a = await H.book(t.trip.id, { seatCount: 1 });
  const b = await H.book(t.trip.id, { seatCount: 1 });
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, { ready: true })).status, 200);
  const early = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/bookings/${b.booking.id}/no-show`, t.token);
  assert.equal(early.body.code, 'TOO_EARLY');
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start-boarding`, t.token, {});
  const wrong = a.booking.boardingPin === '9999' ? '0000' : '9999';
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: wrong });
    assert.equal(r.status, i < 4 ? 400 : 429, `attempt ${i + 1}`);
  }
  const locked = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: a.booking.boardingPin });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'PIN_LOCKED');
  H.advance(16 * H.MIN);
  const ok = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: a.booking.boardingPin });
  assert.equal(ok.status, 200);
  // S1: passenger no-show only noShowGraceMinutes (default 30) after the departure time.
  const graceEarly = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/bookings/${b.booking.id}/no-show`, t.token);
  assert.equal(graceEarly.body.code, 'TOO_EARLY');
  H.advance(25 * H.MIN);
  const ns = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/bookings/${b.booking.id}/no-show`, t.token);
  assert.equal(ns.status, 200);
  assert.equal(ns.body.booking.status, 'NO_SHOW');
  assert.equal(ns.body.trip.confirmedSeats, 1);
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});

test('forgotten IN_PROGRESS trips auto-complete; refund retries are exactly once', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30, departInMin: 10, minSeatsToDepart: 1 });
  const a = await H.book(t.trip.id, { seatCount: 1 });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, { ready: true });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start-boarding`, t.token, {});
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: a.booking.boardingPin });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start`, t.token, { safetyConfirmed: true });
  H.advance(7 * 60 * H.MIN);
  const out = await run();
  assert.ok(out.autoCompleted >= 1);
  assert.equal((await H.ctx.M('AutoTrip').findByPk(t.trip.id)).status, 'COMPLETED');
  assert.equal((await H.ctx.M('AutoBooking').findByPk(a.booking.id)).status, 'COMPLETED');
  // A refund left pending (e.g. a crash between the two steps) is retried once.
  const u = await H.mkUser({ wallet: 10 });
  const t2 = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const fake = await H.ctx.M('AutoBooking').create({
    bookingCode: 'ZATESTRF', tripId: t2.trip.id, userId: u.id, driverId: t2.driver.id, seatCount: 1, status: 'REFUND_PENDING',
    paymentMethod: 'WALLET', paymentStatus: 'REFUND_PENDING', amount: 30, walletDebited: 30, refundAmount: 30,
  });
  const [r1, r2] = await Promise.all([run(), run()]);
  assert.equal((r1.refunds || 0) + (r2.refunds || 0), 1);
  await run();
  await u.reload();
  assert.equal(u.walletBalance, 40, 'credited exactly once');
  assert.equal((await H.ctx.M('AutoBooking').findByPk(fake.id)).status, 'REFUNDED');
});
