// Owner rule: "after booking, if the passenger has not arrived in 15 minutes, auto-cancel" (union queue autos).
// A confirmed app seat must be checked in within arrivalWindowMinutes (default 15) of the LATER of its confirmation
// and the moment its auto went on charge. The lifecycle job warns 5 minutes before (once), then marks it NO_SHOW,
// frees the seat, recomputes the counters (a FULL auto is open again) and tells the student and the driver.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api, MIN } = H;
let admin;

before(async () => {
  await H.setup({ label: 'ar-arrival' });
  await H.setFlag(true);
  admin = await H.mkAdmin();
});
after(() => H.teardown());

const run = () => H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
const mkStand = async () => {
  const rp = await H.mkRoute({ name: `Stand ${Math.random().toString(36).slice(2, 8)}` });
  await rp.route.update({ seatFareDefault: 30 });
  await rp.pickup.update({ name: 'SRM AP Main Gate' });
  return rp;
};
const charge = (dv, pickup) => api('POST', '/api/auto-ride/driver/charge', dv.token, { pickupPointId: pickup.id, vehicleId: dv.vehicle.id });
const walk = (dv, tripId, seatNo) => api('POST', `/api/auto-ride/driver/trips/${tripId}/walk-ins`, dv.token, { action: 'add', ...(seatNo ? { seatNo } : {}) });
const bookingRow = (id) => H.ctx.M('AutoBooking').findByPk(id);
const tripRow = (id) => H.ctx.M('AutoTrip').findByPk(id);
const titles = async (id) => (await H.notificationsFor(id)).map((n) => `${n.title}: ${n.body}`);

test('not checked in 15 minutes after booking -> NO_SHOW, seat freed, counters updated, student + driver told; the 10-minute warning goes out once', async () => {
  const { pickup } = await mkStand();
  const dv = await H.mkDriver({ capacity: 8 });
  const trip = (await charge(dv, pickup)).body.trip;
  const b = await H.book(trip.id, { seatNumbers: [4] });
  assert.equal(b.confirm.status, 200);
  const deadline = new Date(b.booking.arriveBy).getTime();
  assert.equal(deadline, new Date(b.booking.confirmedAt).getTime() + 15 * MIN, 'customer ticket carries the deadline');
  assert.equal(b.booking.arrivalWindowMinutes, 15);
  const drvList = await api('GET', `/api/auto-ride/driver/trips/${trip.id}/bookings`, dv.token);
  assert.equal(drvList.body.bookings[0].arriveBy, b.booking.arriveBy, 'driver list carries the same countdown');

  H.advance(9 * MIN);
  assert.equal((await run()).arrivalWarned, 0, 'no warning before 10 minutes');
  H.advance(1 * MIN + 1000);
  const r1 = await run();
  assert.equal(r1.arrivalWarned, 1);
  H.advance(MIN);
  assert.equal((await run()).arrivalWarned, 0, 'warning sent once');
  const warn = (await titles(b.user.id)).filter((t) => t.startsWith('Reach your auto'));
  assert.equal(warn.length, 1);
  assert.match(warn[0], /Your auto at SRM AP Main Gate is waiting · [45] min left to reach, or your seat will be released\./);
  assert.ok((await bookingRow(b.booking.id)).arrivalWarnedAt);
  assert.equal((await bookingRow(b.booking.id)).status, 'CONFIRMED', 'still inside the window');

  H.advance(4 * MIN);
  const r2 = await run();
  assert.equal(r2.arrivalNoShow, 1);
  assert.equal(r2.errors, 0);
  const row = await bookingRow(b.booking.id);
  assert.equal(row.status, 'NO_SHOW');
  assert.equal(row.paymentStatus, 'NONE', 'cash: nothing charged');
  const tr = await tripRow(trip.id);
  assert.equal(tr.seatsConfirmed, 0);
  assert.equal(tr.queueState, 'ON_CHARGE');
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
  const seats = await api('GET', `/api/auto-ride/driver/trips/${trip.id}/seats`, dv.token);
  assert.equal(seats.body.seats[3].state, 'AVAILABLE', 'seat 4 free again');
  assert.ok((await titles(b.user.id)).includes("Seat released: Your seat was released because you didn't arrive in 15 minutes."));
  assert.ok((await titles(dv.driver.id)).some((t) => t.endsWith('Seat 4 is free again (no-show)')));

  // Idempotent: another run (and a direct call) changes nothing.
  assert.equal((await run()).arrivalNoShow, 0);
  const again = await H.r('modules/autoRide/services/allocation').expireArrivals(trip.id, { windowMinutes: 15, now: new Date(H.now()) });
  assert.equal(again.expired.length, 0);
  assert.equal((await titles(b.user.id)).filter((t) => t.startsWith('Seat released')).length, 1);
});

test('a checked-in (boarded) student is never cancelled', async () => {
  const { pickup } = await mkStand();
  const dv = await H.mkDriver({ capacity: 8 });
  const trip = (await charge(dv, pickup)).body.trip;
  const b = await H.book(trip.id, { seatCount: 1 });
  const pin = (await bookingRow(b.booking.id)).boardingPin;
  const ci = await api('POST', `/api/auto-ride/driver/trips/${trip.id}/check-in`, dv.token, { bookingCode: b.booking.bookingCode, pin });
  assert.equal(ci.status, 200, JSON.stringify(ci.body));
  H.advance(40 * MIN);
  const r = await run();
  assert.equal(r.arrivalNoShow, 0);
  assert.equal((await bookingRow(b.booking.id)).status, 'BOARDED');
  assert.equal((await tripRow(trip.id)).seatsConfirmed, 1);
});

test('a booking on a waiting auto: the clock starts when that auto goes on charge', async () => {
  const { pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 8 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  assert.equal(tb.queueState, 'WAITING');
  const bk = await H.book(tb.id, { seatCount: 1 });
  assert.equal(bk.booking.arriveBy, null, 'no clock while waiting in line');
  H.advance(30 * MIN);
  assert.equal((await run()).arrivalNoShow, 0);
  assert.equal((await bookingRow(bk.booking.id)).status, 'CONFIRMED', 'not penalised while the auto waits');

  // A fills with walk-ins -> B goes on charge now.
  for (let i = 0; i < 4; i++) assert.equal((await walk(a, ta.id)).status, 200);
  const B = await tripRow(tb.id);
  assert.equal(B.queueState, 'ON_CHARGE');
  const startedAt = new Date(B.chargeStartedAt).getTime();
  const detail = await api('GET', `/api/auto-ride/bookings/${bk.booking.id}`, bk.user.token);
  assert.equal(new Date(detail.body.booking.arriveBy).getTime(), startedAt + 15 * MIN);
  H.advance(14 * MIN);
  assert.equal((await run()).arrivalNoShow, 0);
  H.advance(MIN + 1000);
  assert.equal((await run()).arrivalNoShow, 1);
  assert.equal((await bookingRow(bk.booking.id)).status, 'NO_SHOW');
});

test('a FULL auto becomes not-full again when a seat is released; arrivalWindowMinutes is an admin setting', async () => {
  const set = await api('PUT', '/api/admin/auto-ride/settings', admin.token, { arrivalWindowMinutes: 20 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.arrivalWindowMinutes, 20);
  assert.equal((await api('PUT', '/api/admin/auto-ride/settings', admin.token, { arrivalWindowMinutes: 2 })).status, 400);
  try {
    const { pickup } = await mkStand();
    const dv = await H.mkDriver({ capacity: 4 });
    const trip = (await charge(dv, pickup)).body.trip;
    const late = await H.book(trip.id, { seatNumbers: [2] });
    H.advance(5 * MIN);
    for (const n of [1, 3, 4]) assert.equal((await H.book(trip.id, { seatNumbers: [n] })).confirm.status, 200);
    let tr = await tripRow(trip.id);
    assert.equal(tr.status, 'FULL');
    assert.equal(new Date(late.booking.arriveBy).getTime(), new Date(late.booking.confirmedAt).getTime() + 20 * MIN);
    H.advance(15 * MIN + 1000);
    const r = await run();
    assert.equal(r.arrivalNoShow, 1, 'only the first booking passed its 20 minutes');
    tr = await tripRow(trip.id);
    assert.equal(tr.status, 'DEPARTURE_THRESHOLD_REACHED', 'not FULL any more');
    assert.equal(tr.seatsConfirmed, 3);
    assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
    assert.ok((await titles(dv.driver.id)).some((t) => t.endsWith('Seat 2 is free again (no-show)')));
    assert.ok((await titles(late.user.id)).some((t) => t.includes("didn't arrive in 20 minutes")));
  } finally {
    await api('PUT', '/api/admin/auto-ride/settings', admin.token, { arrivalWindowMinutes: 15 });
  }
});

test('wallet booking: a no-show follows the existing no-show rule (not refunded)', async () => {
  await H.setWallet(true);
  try {
    const { pickup } = await mkStand();
    const dv = await H.mkDriver({ capacity: 8 });
    const trip = (await charge(dv, pickup)).body.trip;
    const u = await H.mkUser({ wallet: 500 });
    const b = await H.book(trip.id, { user: u, seatCount: 1, paymentMethod: 'WALLET' });
    assert.equal(b.confirm.status, 200, JSON.stringify(b.confirm.body));
    H.advance(16 * MIN);
    assert.ok((await run()).arrivalNoShow >= 1, 'this booking (and older test bookings still at a stand) passed the window');
    const row = await bookingRow(b.booking.id);
    assert.equal(row.status, 'NO_SHOW');
    assert.equal(row.paymentStatus, 'NOT_REFUNDED');
    assert.equal(Number(row.refundAmount) || 0, 0);
  } finally {
    await H.setWallet(false);
  }
});

test('the driver can mark a no-show early at the stand once the student was warned (10 of 15 minutes), not before', async () => {
  const { pickup } = await mkStand();
  const dv = await H.mkDriver({ capacity: 8 });
  const trip = (await charge(dv, pickup)).body.trip;
  const b = await H.book(trip.id, { seatNumbers: [5] });
  const url = `/api/auto-ride/driver/trips/${trip.id}/bookings/${b.booking.id}/no-show`;
  H.advance(3 * MIN);
  const early = await api('POST', url, dv.token);
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'TOO_EARLY');
  H.advance(7 * MIN + 1000);
  const ok = await api('POST', url, dv.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await bookingRow(b.booking.id)).status, 'NO_SHOW');
  assert.equal((await tripRow(trip.id)).seatsConfirmed, 0);
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
});
