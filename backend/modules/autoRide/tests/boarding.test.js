// Owner bug 26 Oct: "I booked and I sat, the auto started and went, and I got 'You missed the auto'". The driver
// tapped Depart and Start without checking the student in, and Start silently marked every booked passenger who was
// not checked in as NO_SHOW. Now:
//  - Start refuses with 409 PASSENGERS_NOT_CHECKED_IN and the list; the driver checks them in or names exactly the
//    ones who are not here (noShowConfirmed); driver app 1.0.6 (no list) gets the refusal and must tap Start again;
//  - a passenger marked not here can be checked in late with code + PIN (30 minutes), seat reclaimed;
//  - the leaving / boarding push tells each unboarded passenger "Show PIN 1234 to the driver now";
//  - the board's "N of 8 left" is counted from the same seat map (a held seat is not left; the holder can book it).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api, MIN } = H;

before(async () => {
  await H.setup({ label: 'ar-boarding' });
  await H.setFlag(true);
});
after(() => H.teardown());

const mkStand = async () => {
  const rp = await H.mkRoute({ name: `Stand ${Math.random().toString(36).slice(2, 8)}` });
  await rp.route.update({ seatFareDefault: 30 });
  await rp.pickup.update({ name: 'SRM AP Main Gate' });
  return rp;
};
const charge = (dv, pickup) => api('POST', '/api/auto-ride/driver/charge', dv.token, { pickupPointId: pickup.id, vehicleId: dv.vehicle.id });
const act = (dv, tripId, action, body = {}) => api('POST', `/api/auto-ride/driver/trips/${tripId}/actions/${action}`, dv.token, body);
const pinOf = async (id) => (await H.ctx.M('AutoBooking').findByPk(id)).boardingPin;
const checkIn = async (dv, tripId, bk, pin) => api('POST', `/api/auto-ride/driver/trips/${tripId}/check-in`, dv.token, { bookingCode: bk.bookingCode, pin: pin || await pinOf(bk.id) });
const bookingRow = (id) => H.ctx.M('AutoBooking').findByPk(id);
const tripRow = (id) => H.ctx.M('AutoTrip').findByPk(id);
const notes = async (id) => (await H.notificationsFor(id)).map((n) => ({ title: n.title, body: n.body, type: n.type || (n.data && n.data.type) }));
const board = async (u, pickup) => (await api('GET', `/api/auto-ride/on-charge?pickupPointId=${pickup.id}`, u.token)).body.lines[0];

/** An auto on charge with three students on seats 3, 4, 5; A checked in at the stand; then Depart (BOARDING). */
const departed = async () => {
  const { pickup } = await mkStand();
  const dv = await H.mkDriver({ capacity: 8 });
  const trip = (await charge(dv, pickup)).body.trip;
  const a = await H.book(trip.id, { seatNumbers: [3], user: await H.mkUser({ name: 'Asha Rao' }) });
  const b = await H.book(trip.id, { seatNumbers: [4], user: await H.mkUser({ name: 'Bhanu Teja' }) });
  const c = await H.book(trip.id, { seatNumbers: [5], user: await H.mkUser({ name: 'Charan K' }) });
  assert.equal((await checkIn(dv, trip.id, a.booking)).status, 200);
  const d = await act(dv, trip.id, 'depart');
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.trip.status, 'BOARDING');
  return { pickup, dv, trip, a, b, c };
};

test('Start with booked passengers not checked in: 409 PASSENGERS_NOT_CHECKED_IN with the list, nothing changes', async () => {
  const { dv, trip, b, c } = await departed();
  const r = await act(dv, trip.id, 'start', { safetyConfirmed: true, noShowConfirmed: [] });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'PASSENGERS_NOT_CHECKED_IN');
  assert.equal(r.body.confirmAgain, false);
  assert.deepEqual(r.body.passengers, [
    { bookingId: b.booking.id, firstName: 'Bhanu', seats: [4], seatCount: 1, code: b.booking.bookingCode },
    { bookingId: c.booking.id, firstName: 'Charan', seats: [5], seatCount: 1, code: c.booking.bookingCode },
  ]);
  assert.match(r.body.message, /2 passengers are not checked in yet: Bhanu \(seat 4\), Charan \(seat 5\)\. Check them in with their booking code and PIN\. If they are not in the auto, mark them as not here\./);
  assert.ok(!/phone|pin":/i.test(JSON.stringify(r.body.passengers)), 'no phone / PIN in the driver list');
  assert.equal((await tripRow(trip.id)).status, 'BOARDING');
  for (const x of [b, c]) assert.equal((await bookingRow(x.booking.id)).status, 'CONFIRMED');
  // Naming only one of them still refuses, listing the other one.
  const r2 = await act(dv, trip.id, 'start', { safetyConfirmed: true, noShowConfirmed: [b.booking.id] });
  assert.equal(r2.status, 409);
  assert.deepEqual(r2.body.passengers.map((x) => x.bookingId), [c.booking.id]);
  assert.equal((await bookingRow(b.booking.id)).status, 'CONFIRMED', 'a partial list marks nobody');
  assert.equal((await act(dv, trip.id, 'start', { safetyConfirmed: true, noShowConfirmed: 'all' })).status, 400, 'the list must be a list');
  // Checked in meanwhile: the refusal is gone for them.
  assert.equal((await checkIn(dv, trip.id, b.booking)).status, 200);
  assert.equal((await checkIn(dv, trip.id, c.booking)).status, 200);
  const ok = await act(dv, trip.id, 'start', { safetyConfirmed: true, noShowConfirmed: [] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.trip.status, 'IN_PROGRESS');
  for (const x of [b, c]) assert.ok(!(await notes(x.user.id)).some((n) => n.type === 'AUTO_NO_SHOW'), 'nobody told they missed the auto');
});

test('Start with noShowConfirmed marks exactly those as not here; the push is honest and actionable (PIN + late check-in)', async () => {
  const { dv, trip, a, b, c } = await departed();
  assert.equal((await checkIn(dv, trip.id, c.booking)).status, 200);
  const r = await act(dv, trip.id, 'start', { safetyConfirmed: true, noShowConfirmed: [b.booking.id, c.booking.id, '00000000-0000-0000-0000-000000000000'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.trip.status, 'IN_PROGRESS');
  assert.equal((await bookingRow(a.booking.id)).status, 'BOARDED');
  assert.equal((await bookingRow(c.booking.id)).status, 'BOARDED', 'named but checked in: stays on board');
  const bRow = await bookingRow(b.booking.id);
  assert.equal(bRow.status, 'NO_SHOW');
  assert.ok(bRow.noShowAt);
  const tr = await tripRow(trip.id);
  assert.equal(tr.seatsBoarded, 2);
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
  const bn = (await notes(b.user.id)).filter((n) => n.type === 'AUTO_NO_SHOW');
  assert.equal(bn.length, 1);
  assert.equal(bn[0].title, 'Your auto left without checking you in');
  assert.equal(bn[0].body, `If you are on it, ask the driver to check you in with your PIN ${bRow.boardingPin} (within 30 minutes). If you missed it, open the booking and tap Report a problem.`);
  assert.ok(!(await notes(b.user.id)).some((n) => /You missed your auto/.test(n.title)), 'the old copy is gone');
  assert.ok(!/[\u{1F300}-\u{1FAFF}✅]/u.test(bn[0].title + bn[0].body), 'no emoji');
  const ev = await H.ctx.M('AutoTripEvent').findOne({ where: { tripId: trip.id, toStatus: 'IN_PROGRESS', fromStatus: 'BOARDING' } });
  assert.deepEqual(ev.meta.notHere, [b.booking.id], 'who the driver left is on record');
});

test('driver app 1.0.6 (no list): Start is refused with the names; a second Start soon after for the same passengers leaves them', async () => {
  const { dv, trip, b, c } = await departed();
  const r1 = await act(dv, trip.id, 'start', { safetyConfirmed: true });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.code, 'PASSENGERS_NOT_CHECKED_IN');
  assert.equal(r1.body.confirmAgain, true);
  assert.match(r1.body.message, /Bhanu \(seat 4\), Charan \(seat 5\).*tap Start trip again to leave without them\./);
  assert.equal((await tripRow(trip.id)).status, 'BOARDING');
  // After the confirm window the refusal comes back (a stale tap never leaves anyone).
  H.advance(4 * MIN);
  const r2 = await act(dv, trip.id, 'start', { safetyConfirmed: true });
  assert.equal(r2.status, 409, 'confirm window passed: refused again');
  // A different set (one checked in meanwhile) is refused again too, with the new list.
  assert.equal((await checkIn(dv, trip.id, c.booking)).status, 200);
  const r3 = await act(dv, trip.id, 'start', { safetyConfirmed: true });
  assert.equal(r3.status, 409);
  assert.deepEqual(r3.body.passengers.map((x) => x.bookingId), [b.booking.id]);
  H.advance(30 * 1000);
  const r4 = await act(dv, trip.id, 'start', { safetyConfirmed: true });
  assert.equal(r4.status, 200, JSON.stringify(r4.body));
  assert.equal((await bookingRow(b.booking.id)).status, 'NO_SHOW');
  assert.equal((await bookingRow(c.booking.id)).status, 'BOARDED');
});

test('late check-in while the trip is on the way: BOARDED again, same seat, no-show cleared, passenger told; closed after 30 minutes', async () => {
  const { dv, trip, b, c } = await departed();
  const s = await act(dv, trip.id, 'start', { safetyConfirmed: true, noShowConfirmed: [b.booking.id, c.booking.id] });
  assert.equal(s.status, 200);
  // The passenger's ticket explains it and still shows the PIN for the driver.
  const tk = (await api('GET', `/api/auto-ride/bookings/${b.booking.id}`, b.user.token)).body.booking;
  assert.equal(tk.status, 'NO_SHOW');
  assert.equal(tk.boardingPin, await pinOf(b.booking.id));
  assert.equal(new Date(tk.lateCheckInUntil).getTime(), new Date(tk.noShowAt).getTime() + 30 * MIN);
  assert.equal(tk.trip.status, 'IN_PROGRESS');
  assert.ok(tk.trip.startedAt);
  const list = (await api('GET', `/api/auto-ride/driver/trips/${trip.id}/bookings`, dv.token)).body.bookings;
  assert.equal(list.find((x) => x.id === b.booking.id).lateCheckInUntil, tk.lateCheckInUntil, 'the driver list shows who can still be checked in');
  assert.equal(list.find((x) => x.id === b.booking.id).cashToCollect, 30);

  const wrong = await checkIn(dv, trip.id, b.booking, (await pinOf(b.booking.id)) === '0000' ? '1111' : '0000');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'WRONG_PIN', 'the PIN is still the proof');
  H.advance(5 * MIN);
  const ok = await api('POST', `/api/auto-ride/driver/trips/${trip.id}/check-in`, dv.token, { bookingCode: b.booking.bookingCode, pin: await pinOf(b.booking.id), cashCollected: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.late, true);
  assert.equal(ok.body.seatsChanged, false);
  assert.equal(ok.body.booking.status, 'BOARDED');
  assert.deepEqual(ok.body.booking.seatNumbers, [4]);
  const row = await bookingRow(b.booking.id);
  assert.equal(row.noShowAt, null, 'missed record cleared');
  assert.equal(row.paymentStatus, 'CASH_COLLECTED');
  assert.equal((await tripRow(trip.id)).seatsBoarded, 2);
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);
  const told = (await notes(b.user.id)).filter((n) => n.type === 'AUTO_BOARDED');
  assert.equal(told.length, 1);
  assert.equal(told[0].title, 'You are checked in');
  assert.match(told[0].body, /Seat 4\. The missed auto note is cleared/);
  const tk2 = (await api('GET', `/api/auto-ride/bookings/${b.booking.id}`, b.user.token)).body.booking;
  assert.equal(tk2.status, 'BOARDED');
  assert.equal(tk2.lateCheckInUntil, null);

  // c waits too long: closed after 30 minutes.
  H.advance(26 * MIN);
  const late = await checkIn(dv, trip.id, c.booking);
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'LATE_CHECK_IN_CLOSED');
  assert.equal((await api('GET', `/api/auto-ride/bookings/${c.booking.id}`, c.user.token)).body.booking.boardingPin, null, 'PIN hidden once it can no longer be used');
  // Completing the trip completes the late passenger too.
  assert.equal((await act(dv, trip.id, 'complete')).status, 200);
  assert.equal((await bookingRow(b.booking.id)).status, 'COMPLETED');
});

test('late check-in at the stand after the arrival window: own seat if free, another free seat if not, SEAT_NOW_TAKEN when none', async () => {
  const run = () => H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
  const { pickup } = await mkStand();
  const dv = await H.mkDriver({ capacity: 4 });
  const trip = (await charge(dv, pickup)).body.trip;
  const a = await H.book(trip.id, { seatNumbers: [3] });
  H.advance(16 * MIN);
  assert.equal((await run()).arrivalNoShow, 1);
  assert.equal((await bookingRow(a.booking.id)).status, 'NO_SHOW');
  // Someone else takes seat 3 meanwhile.
  const other = await H.book(trip.id, { seatNumbers: [3] });
  assert.equal(other.confirm.status, 200);
  const ok = await checkIn(dv, trip.id, a.booking);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.seatsChanged, true);
  assert.equal(ok.body.booking.seatNumbers.length, 1);
  assert.notEqual(ok.body.booking.seatNumbers[0], 3);
  assert.deepEqual((await H.checkInvariants(trip.id)).problems, []);

  // Full auto: nothing free for a second late passenger.
  const dv2 = await H.mkDriver({ capacity: 4 });
  const { pickup: p2 } = await mkStand();
  const t2 = (await charge(dv2, p2)).body.trip;
  const x = await H.book(t2.id, { seatNumbers: [4] });
  H.advance(16 * MIN);
  await run();
  assert.equal((await bookingRow(x.booking.id)).status, 'NO_SHOW');
  const fill = await H.book(t2.id, { seatCount: 4 });
  assert.equal(fill.confirm.status, 200);
  assert.equal((await tripRow(t2.id)).status, 'FULL');
  const no = await checkIn(dv2, t2.id, x.booking);
  assert.equal(no.status, 409);
  assert.equal(no.body.code, 'SEAT_NOW_TAKEN');
  assert.equal((await bookingRow(x.booking.id)).status, 'NO_SHOW', 'unchanged');
  assert.deepEqual((await H.checkInvariants(t2.id)).problems, []);
});

test('Depart: each passenger not checked in gets "Show PIN 1234 to the driver now"; one already in is told they are checked in', async () => {
  const { a, b } = await departed();
  const pin = await pinOf(b.booking.id);
  const bn = (await notes(b.user.id)).filter((n) => n.type === 'AUTO_DEPARTURE_CONFIRMED');
  assert.equal(bn.length, 1);
  assert.equal(bn[0].title, `Show PIN ${pin} to the driver now`);
  assert.equal(bn[0].body, `Your auto is leaving now. Show booking code ${b.booking.bookingCode} and PIN ${pin} to the driver so you are checked in. Anyone not checked in is left behind.`);
  const an = (await notes(a.user.id)).filter((n) => n.type === 'AUTO_DEPARTURE_CONFIRMED');
  assert.equal(an.length, 1);
  assert.equal(an[0].title, 'Your auto is leaving now');
  assert.equal(an[0].body, 'You are checked in. Have a safe ride.');
  assert.ok(!an[0].body.includes(await pinOf(a.booking.id)), 'no PIN for a passenger already in');
});

test('board count: a held seat is not "left" for anyone; the holder still books it; a stale hold counts as free like the map', async () => {
  const { pickup } = await mkStand();
  const dv = await H.mkDriver({ capacity: 8 });
  const trip = (await charge(dv, pickup)).body.trip;
  const me = await H.mkUser();
  const other = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${trip.id}/holds`, me.token, { seatCount: 1, seatNumbers: [5] });
  assert.equal(h.status, 201);
  const mine = (await board(me, pickup)).onCharge;
  assert.equal(mine.remainingSeats, 7, 'seat 5 is held: 7 of 8 left');
  assert.equal(mine.seatMap.seats[4].state, 'MINE_HELD');
  assert.equal(mine.seatMap.summary.available, 7);
  assert.equal(mine.heldByYou, 1);
  assert.equal(mine.sharedBookingAllowed, true);
  assert.equal(mine.myBookingStatus, 'HELD');
  const theirs = (await board(other, pickup)).onCharge;
  assert.equal(theirs.remainingSeats, 7);
  assert.equal(theirs.seatMap.seats[4].state, 'HELD');
  assert.equal(theirs.heldByYou, 0);
  // Count always equals the free seats drawn.
  for (const c of [mine, theirs]) assert.equal(c.remainingSeats, c.seatMap.seats.filter((s) => s.state === 'AVAILABLE').length);
  // A hold past its time (not yet expired by the job) is drawn free and counted free.
  H.advance(6 * MIN);
  const stale = (await board(other, pickup)).onCharge;
  assert.equal(stale.seatMap.seats[4].state, 'AVAILABLE');
  assert.equal(stale.remainingSeats, 8);

  // The holder of the last free seats can still book them; others see the auto as taken.
  const { pickup: p2 } = await mkStand();
  const dv2 = await H.mkDriver({ capacity: 4 });
  const t2 = (await charge(dv2, p2)).body.trip;
  const first = await H.book(t2.id, { seatCount: 2 });
  assert.equal(first.confirm.status, 200);
  const freeSeats = [1, 2, 3, 4].filter((n) => !first.booking.seatNumbers.includes(n));
  const h2 = await api('POST', `/api/auto-ride/trips/${t2.id}/holds`, me.token, { seatCount: 2, seatNumbers: freeSeats });
  assert.equal(h2.status, 201, JSON.stringify(h2.body));
  const mine2 = (await board(me, p2)).onCharge;
  assert.equal(mine2.remainingSeats, 0);
  assert.equal(mine2.heldByYou, 2);
  assert.equal(mine2.sharedBookingAllowed, true, 'the holder can still confirm their hold');
  assert.equal((await board(other, p2)).onCharge.sharedBookingAllowed, false);
  const conf = await api('POST', `/api/auto-ride/bookings/${h2.body.booking.id}/confirm`, me.token, { paymentMethod: 'CASH' });
  assert.equal(conf.status, 200);
  assert.equal((await tripRow(t2.id)).status, 'FULL');
});
