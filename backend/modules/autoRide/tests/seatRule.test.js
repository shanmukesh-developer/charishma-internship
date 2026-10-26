// Owner rule: the real ZCS shared auto is  1 | driver | 2  /  3 4 5  /  6 7 8, and "seats 1 and 2 are only allowed
// for boys". Enforced on the server: holds, confirms, auto-assignment and moving bookings never give a seat beside the
// driver to a rider who is not 'Male' (profile gender, or the per-booking riderGender when the profile says
// 'Prefer not to say'). Walk-ins are the driver's call. Every vehicle / trip without a layout gets the default.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
const REAL_ROWS = [[1, 'D', 2], [3, 4, 5], [6, 7, 8]];
const FRONT_MSG = 'Seats beside the driver are for boys only. Please pick a seat in the back rows.';

before(async () => {
  await H.setup({ label: 'ar-seatrule' });
  await H.setFlag(true);
});
after(() => H.teardown());

const mkStand = async () => {
  const rp = await H.mkRoute({ name: `Stand ${Math.random().toString(36).slice(2, 8)}` });
  await rp.route.update({ seatFareDefault: 30 });
  return rp;
};
const charge = (dv, pickup) => api('POST', '/api/auto-ride/driver/charge', dv.token, { pickupPointId: pickup.id, vehicleId: dv.vehicle.id });
const hold = (u, tripId, body) => api('POST', `/api/auto-ride/trips/${tripId}/holds`, u.token, body);
const walk = (dv, tripId, action, seatNo) => api('POST', `/api/auto-ride/driver/trips/${tripId}/walk-ins`, dv.token, { action, ...(seatNo ? { seatNo } : {}) });
const bookingRow = (id) => H.ctx.M('AutoBooking').findByPk(id);
const tripRow = (id) => H.ctx.M('AutoTrip').findByPk(id);
const onChargeTrip = async (capacity = 8) => {
  const rp = await mkStand();
  const dv = await H.mkDriver({ capacity });
  const r = await charge(dv, rp.pickup);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { ...rp, dv, trip: r.body.trip };
};

test('default layout: 8 seats = 1 | driver | 2, 3 4 5, 6 7 8 with seats 1 and 2 boys only; snapshotted on the trip; old and missing layouts get it', async () => {
  const L = H.r('modules/autoRide/services/layout');
  assert.deepEqual(L.defaultLayout(8), { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  // Stored before the rule: the old generated arrangement, and nothing at all.
  assert.deepEqual(L.normalizeLayout({ rows: [['D', 1], [2, 3, 4], [5, 6, 7, 8]] }, 8), { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  assert.deepEqual(L.normalizeLayout(null, 8), { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  assert.deepEqual(L.normalizeLayout({ rows: [[1, 'DRIVER', 2], [3, 4, 5], [6, 7, 8]] }, 8).rows, REAL_ROWS, "'DRIVER' reads as 'D'");
  // A custom admin layout keeps its rows; the seats beside the driver are boys only unless the admin said otherwise.
  assert.deepEqual(L.normalizeLayout({ rows: [['D', 1], [2, 3, 4]] }, 4).maleOnlySeats, [1]);
  assert.deepEqual(L.normalizeLayout({ rows: [[1, 'D', 2], [3, 4, 5], [6, 7, 8]], maleOnlySeats: [] }, 8).maleOnlySeats, []);
  assert.deepEqual(L.validateLayout({ rows: [[1, 'DRIVER', 2], [3, 4, 5], [6, 7, 8]], maleOnlySeats: [2] }, 8), { rows: REAL_ROWS, maleOnlySeats: [2] });
  assert.throws(() => L.validateLayout({ rows: REAL_ROWS, maleOnlySeats: [9] }, 8), /Boys-only seats/);

  const { dv, trip } = await onChargeTrip(8);
  assert.deepEqual(trip.seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  const stored = await tripRow(trip.id);
  assert.deepEqual(stored.seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] }, 'snapshotted on the trip like capacity');
  const drv = await api('GET', `/api/auto-ride/driver/trips/${trip.id}/seats`, dv.token);
  assert.deepEqual(drv.body.layout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  assert.deepEqual(drv.body.seats.filter((s) => s.maleOnly).map((s) => s.seatNo), [1, 2]);

  // A vehicle with no layout and one with the old one: the trip snapshots the real layout.
  for (const old of [null, { rows: [['D', 1], [2, 3, 4], [5, 6, 7, 8]] }]) {
    const rp = await mkStand();
    const d2 = await H.mkDriver({ capacity: 8 });
    await d2.vehicle.update({ seatLayout: old });
    const t2 = (await charge(d2, rp.pickup)).body.trip;
    assert.deepEqual((await tripRow(t2.id)).seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  }

  // Startup backfill: approved vehicles and active trips without the rule get the real layout, once.
  const d3 = await H.mkDriver({ capacity: 8 });
  await d3.vehicle.update({ seatLayout: { rows: [['D', 1], [2, 3, 4], [5, 6, 7, 8]] } });
  await H.ctx.M('AutoTrip').update({ seatLayout: null }, { where: { id: trip.id } });
  const mig = H.r('modules/autoRide/migrations');
  assert.ok(await mig.backfillSeatLayouts(H.ctx.sequelize) >= 2);
  assert.deepEqual((await H.ctx.M('AutoVehicle').findByPk(d3.vehicle.id)).seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  assert.deepEqual((await tripRow(trip.id)).seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  assert.equal(await mig.backfillSeatLayouts(H.ctx.sequelize), 0, 'idempotent');
});

test('admin approval stores the layout with its boys-only seats (default, or the admin\'s choice)', async () => {
  const admin = await H.mkAdmin();
  const d = await H.mkDriver({ capacity: 8, vehicleStatus: 'PENDING_REVIEW' });
  await d.vehicle.update({ documents: { rc: 'x/rc.jpg', permit: 'x/p.jpg', insurance: 'x/i.jpg' } });
  const r = await api('POST', `/api/admin/auto-ride/vehicles/${d.vehicle.id}/approve`, admin.token, { approvedCapacity: 8, seatLayout: { rows: [[1, 'DRIVER', 2], [3, 4, 5], [6, 7, 8]], maleOnlySeats: [1, 2] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.vehicle.seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] });
  const d2 = await H.mkDriver({ capacity: 8, vehicleStatus: 'PENDING_REVIEW' });
  await d2.vehicle.update({ documents: { rc: 'x/rc.jpg', permit: 'x/p.jpg', insurance: 'x/i.jpg' } });
  const r2 = await api('POST', `/api/admin/auto-ride/vehicles/${d2.vehicle.id}/approve`, admin.token, { approvedCapacity: 8 });
  assert.deepEqual(r2.body.vehicle.seatLayout, { rows: REAL_ROWS, maleOnlySeats: [1, 2] }, 'no layout sent: the default');
});

test('a female passenger cannot hold seat 1 or 2 (409 FRONT_SEAT_MALE_ONLY); a male passenger can', async () => {
  const { trip } = await onChargeTrip(8);
  const girl = await H.mkUser({ gender: 'Female' });
  for (const seats of [[1], [2], [2, 3]]) {
    const r = await hold(girl, trip.id, { seatCount: seats.length, seatNumbers: seats });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'FRONT_SEAT_MALE_ONLY');
    assert.equal(r.body.message, FRONT_MSG);
    assert.deepEqual(r.body.seats, seats.filter((n) => n <= 2));
  }
  const other = await H.mkUser({ gender: 'Other' });
  assert.equal((await hold(other, trip.id, { seatCount: 1, seatNumbers: [1] })).body.code, 'FRONT_SEAT_MALE_ONLY');
  const ok = await hold(girl, trip.id, { seatCount: 1, seatNumbers: [3] });
  assert.equal(ok.status, 201, 'a back seat is fine');
  const boy = await H.mkUser({ gender: 'Male' });
  const b = await H.book(trip.id, { user: boy, seatCount: 2, seatNumbers: [1, 2] });
  assert.equal(b.hold.status, 201, JSON.stringify(b.hold.body));
  assert.equal(b.confirm.status, 200);
  assert.deepEqual(b.booking.seatNumbers, [1, 2]);
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
});

test('unknown gender ("Prefer not to say"): seats 1 and 2 refused without riderGender; riderGender Male is taken per booking, never stored in the profile; a known profile gender wins', async () => {
  const { trip } = await onChargeTrip(8);
  const u = await H.mkUser({ gender: 'Prefer not to say' });
  const r = await hold(u, trip.id, { seatCount: 1, seatNumbers: [1] });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'FRONT_SEAT_MALE_ONLY');
  assert.equal(r.body.genderUnknown, true);
  assert.equal((await hold(u, trip.id, { seatCount: 1, seatNumbers: [2], riderGender: 'Female' })).body.code, 'FRONT_SEAT_MALE_ONLY');
  assert.equal((await hold(u, trip.id, { seatCount: 1, seatNumbers: [2], riderGender: 'robot' })).status, 400, 'riderGender is validated');
  const yes = await hold(u, trip.id, { seatCount: 1, seatNumbers: [2], riderGender: 'Male' });
  assert.equal(yes.status, 201, JSON.stringify(yes.body));
  const row = await bookingRow(yes.body.booking.id);
  assert.equal(row.riderGender, 'Male', 'the answer stays on the booking');
  assert.equal((await H.ctx.M('User').findByPk(u.id)).gender, 'Prefer not to say', 'never written to the profile');
  const c = await api('POST', `/api/auto-ride/bookings/${yes.body.booking.id}/confirm`, u.token, { paymentMethod: 'CASH' });
  assert.equal(c.status, 200, JSON.stringify(c.body));

  // A known profile gender wins over riderGender.
  const girl = await H.mkUser({ gender: 'Female' });
  const g = await hold(girl, trip.id, { seatCount: 1, seatNumbers: [1], riderGender: 'Male' });
  assert.equal(g.body.code, 'FRONT_SEAT_MALE_ONLY');

  // The rule is checked again at confirm: a hold on a front seat whose rider is no longer a boy is given back.
  const v = await H.mkUser({ gender: 'Prefer not to say' });
  const hv = await hold(v, trip.id, { seatCount: 1, seatNumbers: [1], riderGender: 'Male' });
  assert.equal(hv.status, 201);
  await H.ctx.M('User').update({ gender: 'Female' }, { where: { id: v.id } });
  const cv = await api('POST', `/api/auto-ride/bookings/${hv.body.booking.id}/confirm`, v.token, { paymentMethod: 'CASH' });
  assert.equal(cv.status, 409);
  assert.equal(cv.body.code, 'FRONT_SEAT_MALE_ONLY');
  assert.equal(cv.body.released, true);
  assert.equal((await bookingRow(hv.body.booking.id)).status, 'CANCELLED');
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
});

test('auto-assign ("Book 1 seat") never gives seat 1 or 2 to a female / unknown passenger; only front seats left -> NO_SUITABLE_SEAT with the next auto; boys get them', async () => {
  const { pickup, trip } = await onChargeTrip(8);
  const nextDriver = await H.mkDriver({ capacity: 8 });
  const next = (await charge(nextDriver, pickup)).body.trip;
  const girl = await H.mkUser({ gender: 'Female' });
  const g = await H.book(trip.id, { user: girl, seatCount: 1 });
  assert.deepEqual(g.booking.seatNumbers, [3], 'lowest back seat, not seat 1');
  const unknown = await H.book(trip.id, { user: await H.mkUser({ gender: 'Prefer not to say' }), seatCount: 2 });
  assert.deepEqual(unknown.booking.seatNumbers, [4, 5]);
  // Fill 6 7 8.
  for (const n of [6, 7, 8]) assert.equal((await H.book(trip.id, { user: await H.mkUser({ gender: 'Female' }), seatNumbers: [n] })).confirm.status, 200);

  // Seat map per viewer: 2 free seats, none for her.
  const girl2 = await H.mkUser({ gender: 'Female' });
  const map = await api('GET', `/api/auto-ride/trips/${trip.id}/seats`, girl2.token);
  assert.equal(map.body.viewer, 'NOT_MALE');
  assert.deepEqual(map.body.summary, { available: 2, availableForYou: 0, onlyFrontSeatsLeft: true });
  assert.deepEqual(map.body.seats.filter((s) => s.state === 'AVAILABLE').map((s) => [s.seatNo, s.maleOnly, s.forYou]), [[1, true, false], [2, true, false]]);
  const line = (await api('GET', `/api/auto-ride/on-charge?pickupPointId=${pickup.id}`, girl2.token)).body.lines[0];
  assert.equal(line.onCharge.remainingSeats, 2);
  assert.equal(line.onCharge.seatsForYou, 0);
  assert.equal(line.onCharge.onlyFrontSeatsLeft, true);
  assert.equal(line.waitingAutos[0].seatsForYou, 6);

  const r = await hold(girl2, trip.id, { seatCount: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NO_SUITABLE_SEAT');
  assert.equal(r.body.onlyFrontSeatsLeft, true);
  assert.equal(r.body.nextTripId, next.id, 'the board can offer the next auto');
  const two = await hold(girl2, next.id, { seatCount: 1 });
  assert.equal(two.status, 201);
  assert.deepEqual(two.body.booking.seatNumbers, [3]);

  const boy = await H.mkUser({ gender: 'Male' });
  const bm = await api('GET', `/api/auto-ride/trips/${trip.id}/seats`, boy.token);
  assert.deepEqual(bm.body.summary, { available: 2, availableForYou: 2, onlyFrontSeatsLeft: false });
  const b = await H.book(trip.id, { user: boy, seatCount: 2 });
  assert.deepEqual(b.booking.seatNumbers, [1, 2]);
  assert.equal((await tripRow(trip.id)).status, 'FULL');
});

test('auto-assign for a boy (owner, 26 Oct): back rows first (3, 4, ...), the boys-only front seats 1 and 2 only when the back is full; a boy may still pick seat 1 himself', async () => {
  const { trip } = await onChargeTrip(8);
  const b1 = await H.book(trip.id, { user: await H.mkUser({ gender: 'Male' }), seatCount: 1 });
  assert.deepEqual(b1.booking.seatNumbers, [3], 'a back seat, not seat 1');
  const b2 = await H.book(trip.id, { user: await H.mkUser({ gender: 'Male' }), seatCount: 2 });
  assert.deepEqual(b2.booking.seatNumbers, [4, 5]);
  const pick = await H.book(trip.id, { user: await H.mkUser({ gender: 'Male' }), seatNumbers: [1] });
  assert.equal(pick.confirm.status, 200, 'a boy can choose seat 1');
  assert.deepEqual(pick.booking.seatNumbers, [1]);
  const b3 = await H.book(trip.id, { user: await H.mkUser({ gender: 'Male' }), seatCount: 4 });
  assert.deepEqual(b3.booking.seatNumbers, [6, 7, 8, 2], 'the front seat comes last');
});

test('auto-assign with a smaller margin: 3 free (1, 2, 8) -> a girl asking for 2 gets NOT_ENOUGH_SEATS "left for you"', async () => {
  const { dv, trip } = await onChargeTrip(8);
  for (const n of [3, 4, 5, 6, 7]) assert.equal((await walk(dv, trip.id, 'add', n)).status, 200);
  const girl = await H.mkUser({ gender: 'Female' });
  const r = await hold(girl, trip.id, { seatCount: 2 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_ENOUGH_SEATS');
  assert.equal(r.body.availableForYou, 1);
  assert.match(r.body.message, /left for you/);
  const one = await hold(girl, trip.id, { seatCount: 1 });
  assert.deepEqual(one.body.booking.seatNumbers, [8]);
});

test('walk-ins: the driver can mark seats 1 and 2 (the driver decides physically)', async () => {
  const { dv, trip } = await onChargeTrip(8);
  const w1 = await walk(dv, trip.id, 'add', 1);
  assert.equal(w1.status, 200, JSON.stringify(w1.body));
  assert.equal((await walk(dv, trip.id, 'add', 2)).status, 200);
  const auto = await walk(dv, trip.id, 'add');
  assert.equal(auto.body.seatNo, 3);
  const map = await api('GET', `/api/auto-ride/driver/trips/${trip.id}/seats`, dv.token);
  assert.deepEqual(map.body.seats.slice(0, 3).map((s) => s.state), ['WALK_IN', 'WALK_IN', 'WALK_IN']);
});

test('moving bookings off a cancelled auto respects the rule: a girl never lands on seat 1 or 2 (cancelled instead), a boy may', async () => {
  const { pickup, dv: a, trip: ta } = await onChargeTrip(8);
  const b = await H.mkDriver({ capacity: 8 });
  const tb = (await charge(b, pickup)).body.trip;
  // B: walk-ins on 3..7, so only 1, 2 and 8 are free.
  for (const n of [3, 4, 5, 6, 7]) assert.equal((await walk(b, tb.id, 'add', n)).status, 200);
  const g1 = await H.book(ta.id, { user: await H.mkUser({ gender: 'Female' }), seatCount: 1 });
  H.advance(1000);
  const g2 = await H.book(ta.id, { user: await H.mkUser({ gender: 'Prefer not to say' }), seatCount: 1 });
  H.advance(1000);
  const boy = await H.book(ta.id, { user: await H.mkUser({ gender: 'Male' }), seatCount: 1, seatNumbers: [8] });
  const un = await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/unavailable`, a.token, { kind: 'VEHICLE', reason: 'Puncture' });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.equal(un.body.bookingsMoved, 2);
  assert.equal(un.body.bookingsCancelled, 1);
  const r1 = await bookingRow(g1.booking.id);
  assert.equal(String(r1.tripId), String(tb.id));
  assert.deepEqual(r1.seatNumbers, [8], 'the only back seat');
  const r2 = await bookingRow(g2.booking.id);
  assert.equal(r2.status, 'CANCELLED', 'only front seats left: not moved onto them');
  assert.equal(String(r2.tripId), String(ta.id));
  const r3 = await bookingRow(boy.booking.id);
  assert.equal(String(r3.tripId), String(tb.id));
  assert.deepEqual(r3.seatNumbers, [1], 'a boy can take the seat beside the driver');
  for (const id of [ta.id, tb.id]) assert.deepEqual((await H.checkInvariants(id)).problems, []);
});
