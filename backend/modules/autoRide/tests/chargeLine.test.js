// Union queue ("on charge") + walk-in seats + driver fare + moving bookings. Owner's model: autos line up one
// by one at a stand; the front auto is on charge (leaves next); students can book any auto in the line; when the
// front fills, departs, is cancelled or unavailable the next auto goes on charge; when an auto is cancelled or
// unavailable its confirmed bookings move (whole, same fare) to the next auto in the line with room.
// Races run with the in-process queue on and OFF (database guards only).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
let locks;

before(async () => {
  await H.setup({ label: 'ar-charge' });
  await H.setFlag(true);
  admin = await H.mkAdmin();
  locks = H.r('modules/autoRide/services/locks');
});
after(async () => { locks.setInProcessQueue(true); await H.teardown(); });

/** A stand (route + pickup) with a default seat fare (route range 10..200 from the helper). */
const mkStand = async ({ seatFareDefault = 30, name } = {}) => {
  const rp = await H.mkRoute({ name: name || `Stand ${Math.random().toString(36).slice(2, 8)}` });
  if (seatFareDefault !== null) await rp.route.update({ seatFareDefault });
  return rp;
};
const charge = (dv, pickup, extra = {}) => api('POST', '/api/auto-ride/driver/charge', dv.token, { pickupPointId: pickup.id, vehicleId: dv.vehicle.id, ...extra });
const walk = (dv, tripId, action, seatNo) => api('POST', `/api/auto-ride/driver/trips/${tripId}/walk-ins`, dv.token, { action, ...(seatNo ? { seatNo } : {}) });
const setFare = (dv, tripId, seatFare) => api('POST', `/api/auto-ride/driver/trips/${tripId}/fare`, dv.token, { seatFare });
const tripRow = (id) => H.ctx.M('AutoTrip').findByPk(id);
const bookingRow = (id) => H.ctx.M('AutoBooking').findByPk(id);
const onChargeCount = async (pickup, route) => H.ctx.M('AutoTrip').count({ where: { pickupPointId: pickup.id, routeId: route.id, queueState: 'ON_CHARGE' } });
const board = async (u, pickup) => (await api('GET', `/api/auto-ride/on-charge?pickupPointId=${pickup.id}`, u.token)).body.lines[0];
const unavailable = (dv, tripId) => api('POST', `/api/auto-ride/driver/trips/${tripId}/actions/unavailable`, dv.token, { kind: 'VEHICLE', reason: 'Puncture' });

test('put on charge: the first auto goes on charge, the next ones wait in check-in order and take bookings too', async () => {
  const { route, pickup } = await mkStand({ seatFareDefault: 30 });
  const [a, b, c] = [await H.mkDriver({ capacity: 8 }), await H.mkDriver({ capacity: 6 }), await H.mkDriver({ capacity: 8 })];
  const ra = await charge(a, pickup);
  assert.equal(ra.status, 201, JSON.stringify(ra.body));
  assert.equal(ra.body.trip.status, 'OPEN_FOR_BOOKING');
  assert.equal(ra.body.trip.queueState, 'ON_CHARGE');
  assert.equal(ra.body.trip.onCharge, true);
  assert.equal(ra.body.trip.dispatchMode, 'ON_CHARGE');
  assert.equal(ra.body.trip.seatFare, 30, 'route default seat fare');
  assert.equal(ra.body.trip.capacity, 8, 'approved capacity');
  assert.equal(ra.body.trip.availabilityLabel, 'On charge now');
  assert.deepEqual(ra.body.trip.line, { position: 1, ahead: 0, inLine: 1 });
  assert.deepEqual(ra.body.trip.fareRange, { min: 10, max: 200 });
  assert.equal(ra.body.trip.fareLocked, false);
  const rb = await charge(b, pickup);
  assert.equal(rb.body.trip.status, 'OPEN_FOR_BOOKING', 'a waiting auto is bookable');
  assert.equal(rb.body.trip.queueState, 'WAITING');
  assert.equal(rb.body.trip.availabilityLabel, 'Waiting in line');
  assert.equal(rb.body.trip.capacity, 6);
  assert.equal(rb.body.trip.line.position, 2);
  const rc = await charge(c, pickup);
  assert.equal(rc.body.trip.line.position, 3);
  assert.deepEqual(rc.body.line.map((x) => [x.position, x.mine, x.onCharge]), [[1, false, true], [2, false, false], [3, true, false]]);
  assert.ok(rc.body.line.every((x) => x.mine || x.tripId === null), 'other drivers\' trip ids are not shown');
  assert.equal(await onChargeCount(pickup, route), 1);

  assert.equal((await charge(a, pickup)).body.code, 'ACTIVE_TRIP_EXISTS');
  const bare = await H.mkRoute({ name: 'No fare route', seatFareMin: null, seatFareMax: null });
  const d = await H.mkDriver();
  assert.equal((await charge(d, bare.pickup)).body.code, 'FARE_NOT_SET');
  const minOnly = await mkStand({ seatFareDefault: null });
  assert.equal((await charge(d, minOnly.pickup)).body.trip.seatFare, 10, 'no default: the route minimum');

  // Customer board: the auto on charge first, then every waiting auto with its own seats and seat map.
  const u = await H.mkUser();
  const line = await board(u, pickup);
  assert.equal(line.onCharge.id, ra.body.trip.id);
  assert.equal(line.onCharge.position, 1);
  assert.equal(line.waitingCount, 2);
  assert.deepEqual(line.waitingAutos.map((x) => [x.id, x.position, x.remainingSeats, x.sharedBookingAllowed]), [[rb.body.trip.id, 2, 6, true], [rc.body.trip.id, 3, 8, true]]);
  assert.equal(line.waitingAutos[0].seatMap.seats.length, 6);
  assert.ok(line.onCharge.driver.firstName);
  assert.match(line.onCharge.vehicle.registration, /••/, 'auto number masked before booking');
  assert.equal(line.onCharge.departureAt, null);
  assert.equal(line.onCharge.leavesWhenFull, true);
  const br = await api('GET', `/api/auto-ride/trips?pickupPointId=${pickup.id}`, u.token);
  assert.deepEqual(br.body.trips.map((t) => t.id), [], 'autos on charge are on the board, not in the scheduled list');
  const empty = await mkStand();
  const el = await board(u, empty.pickup);
  assert.equal(el.onCharge, null);
  assert.deepEqual(el.waitingAutos, []);
  assert.equal(el.seatFare, 30);
});

test('a student can book an auto waiting in the line; its seats are real seats', async () => {
  const { pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const u = await H.mkUser();
  const ok = await H.book(tb.id, { seatCount: 2, user: u });
  assert.equal(ok.confirm.status, 200, JSON.stringify(ok.hold.body));
  assert.equal(ok.booking.amount, 60, 'fare x seats, server side');
  assert.equal(ok.booking.paymentMethod, 'CASH');
  const B = await tripRow(tb.id);
  assert.equal(B.queueState, 'WAITING');
  assert.equal(B.seatsConfirmed, 2);
  assert.equal((await tripRow(ta.id)).queueState, 'ON_CHARGE', 'booking a waiting auto does not change the line');
  // A waiting auto that is not full cannot leave ahead of the auto on charge; a full one can.
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${tb.id}/actions/depart`, b.token, {})).body.code, 'WAITING_IN_LINE');
  await H.book(tb.id, { seatCount: 2 });
  assert.equal((await tripRow(tb.id)).status, 'FULL');
  const dep = await api('POST', `/api/auto-ride/driver/trips/${tb.id}/actions/depart`, b.token, {});
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  assert.equal(dep.body.trip.queueState, 'DONE');
  assert.equal((await tripRow(ta.id)).queueState, 'ON_CHARGE');
  assert.deepEqual((await H.checkInvariants(tb.id)).problems, []);
});

test('driver fare: picked at put on charge inside the route range, changeable at the stand until someone books', async () => {
  const { pickup } = await mkStand({ seatFareDefault: 30 });
  const a = await H.mkDriver({ capacity: 4 });
  assert.equal((await charge(a, pickup, { seatFare: 5 })).body.code, 'FARE_OUT_OF_RANGE');
  assert.equal((await charge(a, pickup, { seatFare: 500 })).body.code, 'FARE_OUT_OF_RANGE');
  const ra = await charge(a, pickup, { seatFare: 35 });
  assert.equal(ra.status, 201);
  assert.equal(ra.body.trip.seatFare, 35);
  const ta = ra.body.trip;
  const lower = await setFare(a, ta.id, 25);
  assert.equal(lower.status, 200, JSON.stringify(lower.body));
  assert.equal(lower.body.trip.seatFare, 25);
  assert.equal((await setFare(a, ta.id, 250)).body.code, 'FARE_OUT_OF_RANGE');
  // A walk-in does not lock the fare; an app booking (even a hold) does.
  await walk(a, ta.id, 'add');
  assert.equal((await setFare(a, ta.id, 28)).status, 200);
  const u = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, u.token, { seatCount: 1 });
  assert.equal(h.status, 201);
  assert.equal(h.body.booking.amount, 28);
  const locked = await setFare(a, ta.id, 30);
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, 'FARE_LOCKED');
  const view = await api('GET', `/api/auto-ride/driver/trips/${ta.id}`, a.token);
  assert.equal(view.body.trip.fareLocked, true);
  assert.equal((await setFare((await H.mkDriver()), ta.id, 30)).status, 404, 'another driver cannot touch it');
});

test('front fills with bookings -> next auto on charge (driver told), the filled auto refuses with AUTO_JUST_FILLED + the next one', async () => {
  const { route, pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 4 });
  const c = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const tc = (await charge(c, pickup)).body.trip;
  const first = await H.book(ta.id, { seatCount: 2 });
  const second = await H.book(ta.id, { seatCount: 2 });
  assert.equal(second.confirm.status, 200);
  const A = await tripRow(ta.id);
  assert.equal(A.status, 'FULL');
  assert.equal(A.queueState, 'DONE');
  const B = await tripRow(tb.id);
  assert.equal(B.status, 'OPEN_FOR_BOOKING');
  assert.equal(B.queueState, 'ON_CHARGE');
  assert.equal(await onChargeCount(pickup, route), 1);
  const notes = await H.notificationsFor(b.driver.id);
  assert.ok(notes.some((n) => n.title === 'You are on charge now'), JSON.stringify(notes.map((n) => n.title)));
  assert.ok(!(await H.notificationsFor(c.driver.id)).some((n) => n.title === 'You are on charge now'), 'only the next driver');
  const mine = await api('GET', `/api/auto-ride/bookings/${first.booking.id}`, first.user.token);
  assert.equal(mine.body.booking.tripId, ta.id, 'filling never moves bookings');
  const late = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, late.token, { seatCount: 1 });
  assert.equal(h.status, 409);
  assert.equal(h.body.code, 'AUTO_JUST_FILLED');
  assert.equal(h.body.message, 'This auto just filled. The next auto is on charge now.');
  assert.equal(h.body.nextTripId, tb.id);
  await api('POST', `/api/auto-ride/bookings/${first.booking.id}/cancel`, first.user.token, {});
  const again = await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, late.token, { seatCount: 1 });
  assert.equal(again.body.code, 'AUTO_OFF_CHARGE');
  assert.equal(again.body.nextTripId, tb.id);
  const ln = await board(late, pickup);
  assert.equal(ln.onCharge.id, tb.id);
  assert.equal(ln.waitingCount, 1);
  assert.equal((await tripRow(tc.id)).queueState, 'WAITING');
  assert.deepEqual((await H.checkInvariants(ta.id)).problems, []);
});

test('walk-ins: +1 / -1 and tapped seats are real seat rows; app seats cannot be freed; walk-ins + bookings at capacity -> FULL and the next auto goes on charge', async () => {
  const { route, pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const wb = await walk(b, tb.id, 'add');
  assert.equal(wb.status, 200, JSON.stringify(wb.body));
  assert.equal(wb.body.trip.walkInSeats, 1);
  assert.equal(wb.body.trip.queueState, 'WAITING');

  const w1 = await walk(a, ta.id, 'add');
  assert.equal(w1.body.seatNo, 1, 'lowest free seat');
  const w3 = await walk(a, ta.id, 'add', 3);
  assert.equal(w3.body.seatNo, 3);
  assert.equal(w3.body.trip.walkInSeats, 2);
  assert.equal(w3.body.trip.remainingSeats, 2);
  assert.deepEqual(w3.body.seats.filter((s) => s.state === 'WALK_IN').map((s) => s.seatNo), [1, 3]);
  assert.equal((await walk(a, ta.id, 'add', 3)).body.code, 'ALREADY_WALK_IN');

  const u = await H.mkUser();
  const taken = await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, u.token, { seatCount: 1, seatNumbers: [3] });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'SEAT_TAKEN');
  const st = await H.book(ta.id, { user: u, seatCount: 1 });
  assert.deepEqual(st.booking.seatNumbers, [2], 'the app gets the lowest seat not taken by a walk-in');
  const drv = await api('GET', `/api/auto-ride/driver/trips/${ta.id}/seats`, a.token);
  assert.deepEqual(drv.body.seats.map((s) => s.state), ['WALK_IN', 'BOOKED', 'WALK_IN', 'AVAILABLE'], 'the app seat closed on its own and looks different from walk-ins');
  const cust = await api('GET', `/api/auto-ride/trips/${ta.id}/seats`, u.token);
  assert.deepEqual(cust.body.seats.map((s) => s.state), ['BOOKED', 'MINE', 'BOOKED', 'AVAILABLE'], 'walk-ins look booked to customers');
  const free2 = await walk(a, ta.id, 'remove', 2);
  assert.equal(free2.status, 409);
  assert.equal(free2.body.code, 'APP_BOOKING_SEAT');
  assert.equal((await walk(a, ta.id, 'add', 2)).body.code, 'SEAT_BOOKED_IN_APP');
  assert.equal((await walk(a, ta.id, 'remove', 4)).body.code, 'NO_WALK_IN');
  const minus = await walk(a, ta.id, 'remove');
  assert.equal(minus.body.seatNo, 3);
  assert.equal(minus.body.trip.walkInSeats, 1);
  assert.equal(minus.body.trip.appSeats, 1);
  assert.deepEqual((await H.checkInvariants(ta.id)).problems, []);
  const list = await api('GET', `/api/auto-ride/driver/trips/${ta.id}/bookings`, a.token);
  assert.deepEqual(list.body.bookings.map((x) => x.type), ['SHARED']);
  assert.equal((await walk(b, ta.id, 'add')).status, 404);

  await walk(a, ta.id, 'add');
  const last = await walk(a, ta.id, 'add');
  assert.equal(last.body.trip.status, 'FULL');
  assert.equal(last.body.trip.queueState, 'DONE');
  assert.equal(last.body.trip.walkInSeats, 3);
  assert.equal((await walk(a, ta.id, 'add')).body.code, 'NO_FREE_SEAT');
  const B = await tripRow(tb.id);
  assert.equal(B.queueState, 'ON_CHARGE');
  assert.equal(B.status, 'DEPARTURE_THRESHOLD_REACHED', 'bookable, and one passenger is enough to depart');
  assert.equal(B.seatsWalkIn, 1, 'walk-ins taken while waiting are kept');
  assert.equal(await onChargeCount(pickup, route), 1);
  assert.deepEqual((await H.checkInvariants(ta.id)).problems, []);
  assert.deepEqual((await H.checkInvariants(tb.id)).problems, []);
  const back = await walk(a, ta.id, 'remove');
  assert.equal(back.body.trip.status, 'DEPARTURE_THRESHOLD_REACHED');
  assert.equal(back.body.trip.availability, 'CLOSED');
  assert.equal((await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, (await H.mkUser()).token, { seatCount: 1 })).body.code, 'AUTO_OFF_CHARGE');
  const wrow = await H.ctx.M('AutoBooking').findOne({ where: { tripId: ta.id, type: 'WALK_IN' } });
  assert.equal(String(wrow.userId), String(a.driver.id));
  assert.equal(wrow.amount, 0);
});

test('a waiting auto that is already full is passed over when the front leaves; the one behind goes on charge', async () => {
  const { route, pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 3 });
  const b = await H.mkDriver({ capacity: 3 });
  const c = await H.mkDriver({ capacity: 3 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const tc = (await charge(c, pickup)).body.trip;
  for (let i = 0; i < 3; i++) await walk(b, tb.id, 'add');
  assert.equal((await tripRow(tb.id)).status, 'FULL');
  assert.equal((await tripRow(tb.id)).queueState, 'WAITING');
  for (let i = 0; i < 3; i++) await walk(a, ta.id, 'add');
  assert.equal((await tripRow(ta.id)).status, 'FULL');
  assert.equal((await tripRow(tb.id)).queueState, 'DONE');
  assert.equal((await tripRow(tc.id)).queueState, 'ON_CHARGE');
  assert.equal(await onChargeCount(pickup, route), 1);
});

test('depart before full: the next auto goes on charge, bookings are NOT moved, check-in and start work', async () => {
  const { route, pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 6 });
  const b = await H.mkDriver({ capacity: 6 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/depart`, a.token, {})).body.code, 'AUTO_EMPTY');
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/delay`, a.token, { minutes: 10 })).body.code, 'NOT_FOR_CHARGE');
  const st = await H.book(ta.id, { seatCount: 1 });
  const pin = (await bookingRow(st.booking.id)).boardingPin;
  const ci = await api('POST', `/api/auto-ride/driver/trips/${ta.id}/check-in`, a.token, { bookingCode: st.booking.bookingCode, pin, cashCollected: true });
  assert.equal(ci.status, 200, JSON.stringify(ci.body));
  const other = await H.book(ta.id, { seatCount: 1 });
  await walk(a, ta.id, 'add');
  const holder = await H.mkUser();
  const held = await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, holder.token, { seatCount: 1 });
  assert.equal(held.status, 201);
  const dep = await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/depart`, a.token, {});
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  assert.equal(dep.body.trip.status, 'BOARDING');
  assert.equal(dep.body.trip.queueState, 'DONE');
  assert.equal((await bookingRow(held.body.booking.id)).status, 'CANCELLED', 'an open hold is released');
  assert.equal((await tripRow(tb.id)).queueState, 'ON_CHARGE');
  assert.equal((await tripRow(tb.id)).seatsConfirmed, 0, 'nothing moved to the next auto');
  assert.equal(await onChargeCount(pickup, route), 1);
  assert.equal(String((await bookingRow(other.booking.id)).tripId), String(ta.id));
  const mine = await bookingRow(st.booking.id);
  assert.equal(String(mine.tripId), String(ta.id));
  assert.equal(mine.status, 'BOARDED');
  // `other` never checked in: Start names them first (never a silent no-show); the driver marks them not here.
  const refused = await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/start`, a.token, { safetyConfirmed: true, noShowConfirmed: [] });
  assert.equal(refused.body.code, 'PASSENGERS_NOT_CHECKED_IN');
  const go = await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/start`, a.token, { safetyConfirmed: true, noShowConfirmed: [other.booking.id] });
  assert.equal(go.body.trip.status, 'IN_PROGRESS');
  const done = await api('POST', `/api/auto-ride/driver/trips/${ta.id}/actions/complete`, a.token, {});
  assert.equal(done.body.trip.status, 'COMPLETED');
  assert.equal((await bookingRow(st.booking.id)).status, 'COMPLETED');
});

test('move: the auto on charge becomes unavailable -> its bookings move whole to the next auto, same fare, students and the new driver told', async () => {
  const { route, pickup } = await mkStand({ seatFareDefault: 30 });
  const a = await H.mkDriver({ capacity: 4, name: 'Ravi Kumar' });
  const b = await H.mkDriver({ capacity: 6, name: 'Suresh Babu' });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup, { seatFare: 40 })).body.trip;
  const s1 = await H.book(ta.id, { seatCount: 2 });
  const s2 = await H.book(ta.id, { seatCount: 1 });
  const pin = (await bookingRow(s2.booking.id)).boardingPin;
  await api('POST', `/api/auto-ride/driver/trips/${ta.id}/check-in`, a.token, { bookingCode: s2.booking.bookingCode, pin });
  await walk(a, ta.id, 'add');
  const holder = await H.mkUser();
  const held = await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, holder.token, { seatCount: 1 });
  assert.equal(held.status, 409, 'auto A is full (2 + 1 + walk-in)');
  await walk(a, ta.id, 'remove');
  assert.equal((await api('POST', `/api/auto-ride/trips/${ta.id}/holds`, holder.token, { seatCount: 1 })).body.code, 'AUTO_OFF_CHARGE', 'A left the charge when it filled');

  // A is DONE but still at the stand. Make B leave too: then test the on-charge case with C.
  const c = await H.mkDriver({ capacity: 4, name: 'Mahesh Rao' });
  const tc = (await charge(c, pickup)).body.trip;
  assert.equal((await tripRow(tb.id)).queueState, 'ON_CHARGE');
  const x1 = await H.book(tb.id, { seatCount: 3 });
  const x2 = await H.book(tb.id, { seatCount: 1 });
  const un = await unavailable(b, tb.id);
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.equal(un.body.bookingsMoved, 2);
  assert.equal(un.body.bookingsCancelled, 0);
  for (const [bk, seats] of [[x1, 3], [x2, 1]]) {
    const row = await bookingRow(bk.booking.id);
    assert.equal(String(row.tripId), String(tc.id), 'moved to the next auto in the line');
    assert.equal(String(row.driverId), String(c.driver.id));
    assert.equal(row.status, 'CONFIRMED');
    assert.equal(row.seatCount, seats, 'seat count kept');
    assert.equal(row.seatFare, 40, 'original fare kept');
    assert.equal(row.amount, 40 * seats);
    assert.equal(row.fareBreakdown.movedFromTripId, tb.id);
  }
  const C = await tripRow(tc.id);
  assert.equal(C.status, 'FULL');
  assert.equal(C.seatsConfirmed, 4);
  assert.equal(C.queueState, 'DONE', 'C filled with the moved bookings');
  assert.deepEqual((await H.checkInvariants(tc.id)).problems, []);
  assert.deepEqual((await H.checkInvariants(tb.id)).problems, []);
  const notes = await H.notificationsFor(x1.user.id);
  const moved = notes.find((n) => n.title === 'Your auto changed');
  assert.ok(moved, JSON.stringify(notes.map((n) => n.title)));
  assert.match(moved.body, /^You are now on auto [A-Z]{2} \d{2} •• \d+ \(Mahesh\), same fare\.$/);
  assert.ok((await H.notificationsFor(c.driver.id)).some((n) => n.title === 'Passengers moved to your auto'));
  // The moved student can be checked in on the new auto with the same code + PIN.
  const pinX = (await bookingRow(x2.booking.id)).boardingPin;
  const ci = await api('POST', `/api/auto-ride/driver/trips/${tc.id}/check-in`, c.token, { bookingCode: x2.booking.bookingCode, pin: pinX });
  assert.equal(ci.status, 200, JSON.stringify(ci.body));
  const view = await api('GET', `/api/auto-ride/bookings/${x1.booking.id}`, x1.user.token);
  assert.equal(view.body.booking.trip.id, tc.id);
  assert.equal(await onChargeCount(pickup, route), 0, 'A and C left the charge (full), B left the line');
  assert.deepEqual([s1, s2].map((s) => s.booking.tripId), [ta.id, ta.id]);
});

test('move: a waiting auto is cancelled -> a checked-in student moves too (checks in again); no room anywhere -> cancelled as before and told', async () => {
  const { pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const s = await H.book(tb.id, { seatCount: 2 });
  const pin = (await bookingRow(s.booking.id)).boardingPin;
  await api('POST', `/api/auto-ride/driver/trips/${tb.id}/check-in`, b.token, { bookingCode: s.booking.bookingCode, pin });
  assert.equal((await bookingRow(s.booking.id)).status, 'BOARDED');
  const cancel = await api('POST', `/api/auto-ride/driver/trips/${tb.id}/actions/cancel`, b.token, { reason: 'Left the line' });
  assert.equal(cancel.body.bookingsMoved, 1);
  const row = await bookingRow(s.booking.id);
  assert.equal(String(row.tripId), String(ta.id), 'moved forward to the auto on charge');
  assert.equal(row.status, 'CONFIRMED', 'checks in again on the new auto');
  assert.equal((await tripRow(ta.id)).queueState, 'ON_CHARGE');

  // Alone in the line: nowhere to move -> cancelled with the usual refund, and told why.
  const w = await H.book(ta.id, { seatCount: 1, paymentMethod: 'CASH' });
  const un = await unavailable(a, ta.id);
  assert.equal(un.body.bookingsMoved, 0);
  assert.equal(un.body.bookingsCancelled, 2);
  for (const id of [s.booking.id, w.booking.id]) assert.equal((await bookingRow(id)).status, 'CANCELLED');
  const notes = await H.notificationsFor(w.user.id);
  const n = notes.find((x) => x.title === 'Your auto left the line');
  assert.ok(n);
  assert.match(n.body, /No other auto in the line had room/);
});

test('move: partial room -> whole bookings only, never split; a big booking can go to a later auto with room', async () => {
  const { pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 8 });
  const b = await H.mkDriver({ capacity: 4 });
  const c = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const tc = (await charge(c, pickup)).body.trip;
  await H.book(tb.id, { seatCount: 2 }); // B: 2 free
  await walk(c, tc.id, 'add'); // C: 3 free
  const big = await H.book(ta.id, { seatCount: 4 }); // fits nowhere whole (B 2, C 3): never split into 2 + 2
  const three = await H.book(ta.id, { seatCount: 3 }); // B has only 2 -> goes to C (3)
  assert.equal((await tripRow(ta.id)).queueState, 'ON_CHARGE', '7 of 8 seats: A is still on charge');
  const un = await unavailable(a, ta.id);
  assert.equal(un.body.bookingsMoved, 1);
  assert.equal(un.body.bookingsCancelled, 1);
  const bigRow = await bookingRow(big.booking.id);
  assert.equal(bigRow.status, 'CANCELLED');
  assert.equal(String(bigRow.tripId), String(ta.id), 'never split across autos');
  assert.equal(String((await bookingRow(three.booking.id)).tripId), String(tc.id), 'skipped B (2 free) for C (3 free)');
  assert.equal((await bookingRow(three.booking.id)).seatCount, 3);
  for (const id of [ta.id, tb.id, tc.id]) assert.deepEqual((await H.checkInvariants(id)).problems, []);
  assert.equal((await tripRow(tb.id)).seatsConfirmed, 2, 'B unchanged');
  assert.equal((await tripRow(tc.id)).status, 'FULL');
});

for (const [label, queueOn] of [['in-process queue on', true], ['in-process queue OFF (database guards only)', false]]) {
  test(`race: 12 autos put on charge at once at an empty stand -> exactly one on charge, serials 1..12 (${label})`, async () => {
    locks.setInProcessQueue(true);
    const { route, pickup } = await mkStand();
    const drivers = [];
    for (let i = 0; i < 12; i++) drivers.push(await H.mkDriver({ capacity: 4 }));
    locks.setInProcessQueue(queueOn);
    const rs = await Promise.all(drivers.map((d) => charge(d, pickup)));
    locks.setInProcessQueue(true);
    assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.filter((r) => r.status !== 201).map((r) => r.body)));
    assert.equal(rs.filter((r) => r.body.trip.queueState === 'ON_CHARGE').length, 1);
    assert.equal(await onChargeCount(pickup, route), 1);
    const seqs = (await H.ctx.M('AutoTrip').findAll({ where: { pickupPointId: pickup.id } })).map((t) => t.lineSeq).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: 12 }, (_, i) => i + 1));
    const front = rs.find((r) => r.body.trip.queueState === 'ON_CHARGE').body.trip;
    assert.equal((await tripRow(front.id)).lineSeq, 1, 'the first to check in is on charge');
  });

  test(`race: the last seat (5 app holds vs a walk-in) while 4 more autos join -> one winner, one auto on charge (${label})`, async () => {
    locks.setInProcessQueue(true);
    const { route, pickup } = await mkStand();
    const a = await H.mkDriver({ capacity: 4 });
    const b = await H.mkDriver({ capacity: 4 });
    const ta = (await charge(a, pickup)).body.trip;
    const tb = (await charge(b, pickup)).body.trip;
    await H.book(ta.id, { seatCount: 2 });
    await walk(a, ta.id, 'add');
    const users = await Promise.all(Array.from({ length: 5 }, () => H.mkUser()));
    const joiners = [];
    for (let i = 0; i < 4; i++) joiners.push(await H.mkDriver({ capacity: 4 }));
    locks.setInProcessQueue(queueOn);
    const rs = await Promise.all([
      walk(a, ta.id, 'add'),
      ...users.map((u) => api('POST', `/api/auto-ride/trips/${ta.id}/holds`, u.token, { seatCount: 1 })),
      ...joiners.map((d) => charge(d, pickup)),
    ]);
    const wins = rs.slice(0, 6).filter((r) => r.status === 200 || r.status === 201);
    assert.equal(wins.length, 1, `exactly one gets seat 4: ${rs.slice(0, 6).map((r) => `${r.status}:${r.body.code || ''}`).join(',')}`);
    assert.ok(rs.slice(6).every((r) => r.status === 201), 'every joining auto got into the line');
    const winnerHold = rs.slice(1, 6).find((r) => r.status === 201);
    if (winnerHold) {
      const u = users[rs.slice(1, 6).indexOf(winnerHold)];
      const late = await H.mkDriver({ capacity: 4 });
      const [cf, jn] = await Promise.all([
        api('POST', `/api/auto-ride/bookings/${winnerHold.body.booking.id}/confirm`, u.token, { paymentMethod: 'CASH' }),
        charge(late, pickup),
      ]);
      assert.equal(cf.status, 200, JSON.stringify(cf.body));
      assert.equal(jn.status, 201);
    }
    locks.setInProcessQueue(true);
    const A = await tripRow(ta.id);
    assert.equal(A.status, 'FULL');
    assert.equal(A.queueState, 'DONE');
    assert.equal(await onChargeCount(pickup, route), 1, 'never two autos on charge');
    assert.equal((await tripRow(tb.id)).queueState, 'ON_CHARGE', 'the next in line, not a later joiner');
    assert.deepEqual((await H.checkInvariants(ta.id)).problems, []);
  });

  test(`race: an auto becomes unavailable while students book the next auto's seats -> no seat sold twice, every booking moved or cancelled (${label})`, async () => {
    locks.setInProcessQueue(true);
    const { route, pickup } = await mkStand();
    const a = await H.mkDriver({ capacity: 6 });
    const b = await H.mkDriver({ capacity: 4 });
    const ta = (await charge(a, pickup)).body.trip;
    const tb = (await charge(b, pickup)).body.trip;
    const onA = [];
    for (let i = 0; i < 3; i++) onA.push(await H.book(ta.id, { seatCount: 1 }));
    const users = await Promise.all(Array.from({ length: 6 }, () => H.mkUser()));
    locks.setInProcessQueue(queueOn);
    const [un, ...holds] = await Promise.all([
      unavailable(a, ta.id),
      ...users.map((u) => api('POST', `/api/auto-ride/trips/${tb.id}/holds`, u.token, { seatCount: 1 })),
    ]);
    locks.setInProcessQueue(true);
    assert.equal(un.status, 200, JSON.stringify(un.body));
    assert.ok(holds.every((h) => [201, 409].includes(h.status)), holds.map((h) => `${h.status}:${h.body.code}`).join(','));
    const wonHolds = holds.filter((h) => h.status === 201).length;
    const moved = un.body.bookingsMoved;
    assert.equal(moved + un.body.bookingsCancelled, 3, 'each booking on A was moved or cancelled');
    assert.ok(moved + wonHolds <= 4, `never over capacity: moved ${moved} + holds ${wonHolds}`);
    for (const s of onA) {
      const row = await bookingRow(s.booking.id);
      assert.ok((String(row.tripId) === String(tb.id) && row.status === 'CONFIRMED') || (String(row.tripId) === String(ta.id) && row.status === 'CANCELLED'), `${row.tripId} ${row.status}`);
    }
    assert.deepEqual((await H.checkInvariants(tb.id)).problems, []);
    assert.deepEqual((await H.checkInvariants(ta.id)).problems, []);
    assert.ok(await onChargeCount(pickup, route) <= 1);
  });
}

test('admin: default seat fare per route (inside the bounds), live lines with app seats and walk-ins, chargeMaxHours setting', async () => {
  const { route, pickup } = await mkStand({ seatFareDefault: null });
  const bad = await api('PATCH', `/api/admin/auto-ride/routes/${route.id}`, admin.token, { seatFareDefault: 5 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'seatFareDefault');
  const good = await api('PATCH', `/api/admin/auto-ride/routes/${route.id}`, admin.token, { seatFareDefault: 25 });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(good.body.route.seatFareDefault, 25);
  assert.equal(good.body.route.chargeSeatFare, 25);
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  await charge(b, pickup);
  assert.equal(ta.seatFare, 25);
  await H.book(ta.id, { seatCount: 1 });
  await walk(a, ta.id, 'add');
  const ls = await api('GET', '/api/admin/auto-ride/lines', admin.token);
  assert.equal(ls.status, 200);
  const line = ls.body.lines.find((l) => l.pickup.id === pickup.id);
  assert.equal(line.seatFare, 25);
  assert.equal(line.fareSource, 'DEFAULT');
  assert.deepEqual(line.autos.map((x) => [x.position, x.queueState, x.appSeats, x.walkInSeats]), [[1, 'ON_CHARGE', 1, 1], [2, 'WAITING', 0, 0]]);
  assert.equal((await api('PUT', '/api/admin/auto-ride/settings', admin.token, { chargeMaxHours: 30 })).status, 400);
  assert.equal((await api('PUT', '/api/admin/auto-ride/settings', admin.token, { chargeMaxHours: 4 })).body.chargeMaxHours, 4);
  await api('PUT', '/api/admin/auto-ride/settings', admin.token, { chargeMaxHours: 6 });
  const setup = await api('GET', '/api/auto-ride/driver/charge/setup', (await H.mkDriver()).token);
  const stand = setup.body.stands.find((x) => x.pickupPointId === pickup.id);
  assert.equal(stand.seatFare, 25);
  assert.equal(stand.seatFareMin, 10);
  assert.equal(stand.seatFareMax, 200);
  assert.equal(stand.inLine, 2);
  assert.equal(stand.onCharge, true);
  assert.equal(setup.body.vehicles.length, 1);
});

test('lifecycle: the 6-hour close cancels as before (no move), the next auto goes on charge; a line left without a front is healed', async () => {
  const run = () => H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
  const { route, pickup } = await mkStand();
  const a = await H.mkDriver({ capacity: 4 });
  const b = await H.mkDriver({ capacity: 4 });
  const c = await H.mkDriver({ capacity: 4 });
  const ta = (await charge(a, pickup)).body.trip;
  const tb = (await charge(b, pickup)).body.trip;
  const tc = (await charge(c, pickup)).body.trip;
  await H.ctx.M('AutoTrip').update({ queueState: 'DONE', status: 'CANCELLED' }, { where: { id: ta.id } });
  const r1 = await run();
  assert.equal(r1.linesHealed, 1);
  assert.equal((await tripRow(tb.id)).queueState, 'ON_CHARGE');
  const hold = await H.book(tb.id, { seatCount: 1 });
  H.advance(6 * 60 * H.MIN + 31 * H.MIN);
  const r2 = await run();
  assert.equal(r2.reminders, 0);
  const B = await tripRow(tb.id);
  assert.equal(B.status, 'NO_SHOW');
  assert.equal(B.queueState, 'DONE');
  const bk = await bookingRow(hold.booking.id);
  assert.equal(bk.status, 'CANCELLED', 'the automatic close never moves bookings');
  assert.equal(String(bk.tripId), String(tb.id));
  const C = await tripRow(tc.id);
  assert.equal(C.queueState, 'ON_CHARGE');
  assert.equal(C.status, 'OPEN_FOR_BOOKING');
  assert.ok(new Date(C.departureAt).getTime() > H.now() + 5 * 60 * H.MIN, 'a fresh window from the moment it reached the front');
  assert.equal(await onChargeCount(pickup, route), 1);
  const r3 = await run();
  assert.equal((await tripRow(tc.id)).queueState, 'ON_CHARGE', 'not closed in the next run');
  assert.equal(r3.errors, 0);
});

test('scheduled trips are untouched: publish with a departure time still works and is bookable at once', async () => {
  const t = await H.mkTrip({ capacity: 4 });
  assert.equal(t.trip.dispatchMode, 'SCHEDULED');
  assert.equal(t.trip.queueState, null);
  const bk = await H.book(t.trip.id, { seatCount: 1 });
  assert.equal(bk.confirm.status, 200);
  const w = await walk({ token: t.token }, t.trip.id, 'add');
  assert.equal(w.status, 200);
  assert.equal(w.body.trip.walkInSeats, 1);
  assert.equal((await setFare({ token: t.token }, t.trip.id, 50)).body.code, 'NOT_ON_CHARGE_TRIP');
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});
