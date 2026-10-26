// Owner's test scenarios (AUTO_RIDE_SPEC.md §9), backend part. Capacities and fares vary on purpose
// (3, 6, 8 seats; ₹25 .. ₹70) so nothing silently depends on 8.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;

before(async () => {
  await H.setup({ label: 'ar-scenarios' });
  await H.setFlag(true);
});
after(H.teardown);

test('S1 view autos to Mangalagiri (admin routes, real trips only, filtered by destination)', async () => {
  const mg = await H.mkRoute({ name: 'SRM to Mangalagiri', destinationLabel: 'Mangalagiri' });
  const vj = await H.mkRoute({ name: 'SRM to Vijayawada', destinationLabel: 'Vijayawada' });
  const a = await H.mkTrip({ capacity: 6, seatFare: 35, ...mg });
  const b = await H.mkTrip({ capacity: 3, seatFare: 60, ...vj });
  const u = await H.mkUser();
  const r = await api('GET', '/api/auto-ride/trips?destination=mangalagiri', u.token);
  assert.equal(r.status, 200);
  const ids = r.body.trips.map((t) => t.id);
  assert.ok(ids.includes(a.trip.id), 'Mangalagiri trip listed');
  assert.ok(!ids.includes(b.trip.id), 'Vijayawada trip not listed');
  const card = r.body.trips.find((t) => t.id === a.trip.id);
  assert.equal(card.capacity, 6);
  assert.equal(card.seatFare, 35);
  assert.equal(card.remainingSeats, 6);
  assert.equal(card.destination, 'Mangalagiri');
  assert.equal(card.driver.verified, true);
  assert.equal(card.driver.rating, null, 'no fabricated rating');
  assert.match(card.vehicle.registration, /••/, 'registration masked before booking');
  assert.equal(card.queueNumber, 1);
  assert.equal(card.sharedBookingAllowed, true);
  const routes = await api('GET', '/api/auto-ride/routes', u.token);
  assert.ok(routes.body.routes.some((x) => x.destination === 'Mangalagiri' && x.pickupPoints.length === 1));
});

test('S2 book one seat (server fare, PIN, pickup instructions, CASH)', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 45 });
  const u = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1, amount: 1, seatFare: 1 });
  assert.equal(h.status, 201);
  assert.equal(h.body.booking.status, 'HELD');
  assert.equal(h.body.booking.amount, 45, 'client fare ignored');
  assert.ok(h.body.booking.holdExpiresAt);
  const c = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, {});
  assert.equal(c.status, 200);
  const b = c.body.booking;
  assert.equal(b.status, 'CONFIRMED');
  assert.equal(b.paymentMethod, 'CASH');
  assert.equal(b.paymentStatus, 'CASH_DUE');
  assert.match(b.boardingPin, /^\d{4}$/);
  assert.match(b.bookingCode, /^ZA[A-Z2-9]{6}$/);
  assert.ok(b.pickupInstructions.includes(b.bookingCode));
  assert.equal(b.trip.confirmedSeats, 1);
  assert.equal(b.trip.remainingSeats, 5);
  assert.ok(!b.trip.vehicle.registrationMasked, 'full registration after confirmation');
  assert.ok(b.driverPhone, 'driver phone shown for a confirmed booking');
});

test('S3 book multiple seats with seat selection (fare = seats x fare)', async () => {
  const t = await H.mkTrip({ capacity: 8, seatFare: 25 });
  const r = await H.book(t.trip.id, { seatCount: 3, seatNumbers: [2, 5, 7] });
  assert.equal(r.confirm.status, 200);
  assert.deepEqual(r.booking.seatNumbers, [2, 5, 7]);
  assert.equal(r.booking.amount, 75);
  assert.deepEqual(r.booking.fareBreakdown, { seats: 3, seatFare: 25, total: 75 });
  const map = await api('GET', `/api/auto-ride/trips/${t.trip.id}/seats`, r.user.token);
  const st = Object.fromEntries(map.body.seats.map((s) => [s.seatNo, s.state]));
  assert.equal(st[2], 'MINE');
  assert.equal(st[1], 'AVAILABLE');
  assert.equal(map.body.seats.length, 8);
  assert.ok(map.body.layout.rows.flat().includes('D'), 'driver seat in layout');
  const other = await H.mkUser();
  const taken = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, other.token, { seatCount: 1, seatNumbers: [5] });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'SEAT_TAKEN');
});

test('S4 two students race for the final seat: exactly one wins', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  await H.book(t.trip.id, { seatCount: 2 });
  const [u1, u2] = [await H.mkUser(), await H.mkUser()];
  const rs = await Promise.all([u1, u2].map((u) => api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 })));
  const ok = rs.filter((x) => x.status === 201);
  const lost = rs.filter((x) => x.status === 409);
  assert.equal(ok.length, 1);
  assert.equal(lost.length, 1);
  assert.ok(['TRIP_FULL', 'SEAT_TAKEN', 'NOT_ENOUGH_SEATS'].includes(lost[0].body.code));
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});

for (const cap of [3, 6, 8]) {
  test(`S5 S6 S7 ${cap}/${cap} confirmed -> FULL, new bookings refused, driver told`, async () => {
    const t = await H.mkTrip({ capacity: cap, seatFare: 20 + cap });
    let left = cap;
    while (left > 0) {
      const n = Math.min(left, 2);
      const r = await H.book(t.trip.id, { seatCount: n });
      assert.equal(r.confirm.status, 200, JSON.stringify(r.confirm.body));
      left -= n;
    }
    const u = await H.mkUser();
    const d = await api('GET', `/api/auto-ride/trips/${t.trip.id}`, u.token);
    assert.equal(d.body.trip.status, 'FULL');
    assert.equal(d.body.trip.availability, 'FULL');
    assert.equal(d.body.trip.remainingSeats, 0);
    assert.equal(d.body.trip.confirmedSeats, cap);
    const again = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'TRIP_FULL');
    const notes = await H.notificationsFor(t.driver.id);
    assert.ok(notes.some((n) => n.title === 'Your auto is full' && n.type === 'AUTO_TRIP_FULL'), 'driver in-app notification');
    assert.ok(H.emitted.some((e) => e.room === `autodriver_${t.driver.id}` && e.ev === 'autoride:changed'), 'driver socket nudge');
    const passengers = await H.ctx.M('AutoBooking').findAll({ where: { tripId: t.trip.id } });
    const pn = await H.notificationsFor(passengers[0].userId);
    assert.ok(pn.some((n) => n.type === 'AUTO_TRIP_FULL'), 'passengers told the auto is full');
    const st = await api('GET', `/api/auto-ride/trips/${t.trip.id}`, u.token);
    assert.notEqual(st.body.trip.status, 'IN_PROGRESS', 'never implies the vehicle moved');
  });
}

test('S8 driver confirms departure, boards with code + PIN, starts and completes', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 50, minSeatsToDepart: 2 });
  const a = await H.book(t.trip.id, { seatCount: 1 });
  const b = await H.book(t.trip.id, { seatCount: 1 });
  let s = await api('GET', `/api/auto-ride/driver/trips/${t.trip.id}`, t.token);
  assert.equal(s.body.trip.status, 'DEPARTURE_THRESHOLD_REACHED', 'min occupancy reached');
  const early = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start`, t.token, { safetyConfirmed: true });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'INVALID_TRANSITION');
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, {})).status, 400, 'readiness must be confirmed');
  s = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, { ready: true });
  assert.equal(s.status, 200);
  assert.equal(s.body.trip.status, 'DRIVER_CONFIRMED');
  s = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start-boarding`, t.token, {});
  assert.equal(s.body.trip.status, 'BOARDING');
  const bad = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: a.booking.boardingPin === '0000' ? '1111' : '0000' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'WRONG_PIN');
  const ci = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: a.booking.boardingPin, cashCollected: true });
  assert.equal(ci.status, 200);
  assert.equal(ci.body.booking.status, 'BOARDED');
  assert.equal(ci.body.booking.boardingPin, undefined, 'PIN never in driver payloads');
  assert.equal(ci.body.booking.paymentStatus, 'CASH_COLLECTED');
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start`, t.token, {})).status, 400, 'safety check required');
  // Start never drops the unboarded passenger silently: refused with the list, then the driver marks them not here.
  s = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start`, t.token, { safetyConfirmed: true, noShowConfirmed: [] });
  assert.equal(s.status, 409);
  assert.equal(s.body.code, 'PASSENGERS_NOT_CHECKED_IN');
  assert.deepEqual(s.body.passengers.map((x) => x.bookingId), [b.booking.id]);
  s = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start`, t.token, { safetyConfirmed: true, noShowConfirmed: [b.booking.id] });
  assert.equal(s.status, 200);
  assert.equal(s.body.trip.status, 'IN_PROGRESS');
  const missed = await api('GET', `/api/auto-ride/bookings/${b.booking.id}`, b.user.token);
  assert.equal(missed.body.booking.status, 'NO_SHOW', 'passenger the driver marked as not here is no-show at start');
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/arrive`, t.token, {})).status, 200);
  s = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/complete`, t.token, {});
  assert.equal(s.body.trip.status, 'COMPLETED');
  const done = await api('GET', `/api/auto-ride/bookings/${a.booking.id}`, a.user.token);
  assert.equal(done.body.booking.status, 'COMPLETED');
  assert.equal(done.body.booking.driverPhone, null, 'driver phone hidden once the trip ended');
  const events = await H.ctx.M('AutoTripEvent').findAll({ where: { tripId: t.trip.id }, order: [['createdAt', 'ASC']] });
  const path = events.filter((e) => e.fromStatus !== e.toStatus).map((e) => e.toStatus);
  assert.deepEqual(path, ['DRAFT', 'PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'DRIVER_CONFIRMED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED']);
  const earn = await api('GET', '/api/auto-ride/driver/earnings?from=2026-10-20&to=2026-10-20', t.token);
  assert.equal(earn.body.cashCollected, 50, 'earnings = recorded cash only');
});

test('S9 S12 book the entire auto: driver accepts the private request', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30, fullAutoFare: 450, privateBookingEnabled: true });
  const u = await H.mkUser();
  const r = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, u.token, { passengers: 4, purpose: 'Team outing' });
  assert.equal(r.status, 201);
  assert.equal(r.body.request.status, 'REQUESTED');
  assert.equal(r.body.request.fare, 450);
  let tr = await api('GET', `/api/auto-ride/trips/${t.trip.id}`, u.token);
  assert.equal(tr.body.trip.status, 'OPEN_FOR_BOOKING', 'a pending request books nothing');
  assert.equal(tr.body.trip.confirmedSeats, 0);
  const list = await api('GET', '/api/auto-ride/driver/private-requests?status=REQUESTED', t.token);
  assert.equal(list.body.requests.length, 1);
  assert.equal(list.body.requests[0].passengerName, 'Test');
  const acc = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, t.token);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.trip.status, 'FULL');
  assert.equal(acc.body.trip.mode, 'PRIVATE');
  assert.equal(acc.body.booking.seatCount, 6);
  assert.equal(acc.body.booking.amount, 450);
  const mine = await api('GET', `/api/auto-ride/private-requests/${r.body.request.id}`, u.token);
  assert.equal(mine.body.request.status, 'ACCEPTED');
  const bk = await api('GET', `/api/auto-ride/bookings/${mine.body.request.bookingId}`, u.token);
  assert.equal(bk.body.booking.type, 'PRIVATE');
  assert.equal(bk.body.booking.status, 'CONFIRMED');
  tr = await api('GET', `/api/auto-ride/trips/${t.trip.id}`, u.token);
  assert.equal(tr.body.trip.availability, 'PRIVATE');
  // S10: the private booking blocks individual seats.
  const other = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, other.token, { seatCount: 1 });
  assert.equal(h.status, 409);
  assert.equal(h.body.code, 'TRIP_PRIVATE');
  // Accepting twice is idempotent.
  const again = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, t.token);
  assert.equal(again.status, 200);
  assert.equal((await H.ctx.M('AutoBooking').count({ where: { tripId: t.trip.id } })), 1);
});

test('S12 driver declines a private request (nothing booked, customer told)', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 40, fullAutoFare: 300, privateBookingEnabled: true });
  const u = await H.mkUser();
  const r = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, u.token, { passengers: 2 });
  const d = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/decline`, t.token, { reason: 'Going for CNG' });
  assert.equal(d.status, 200);
  assert.equal(d.body.request.status, 'DECLINED');
  const n = await H.notificationsFor(u.id);
  assert.ok(n.some((x) => x.type === 'AUTO_PRIVATE_DECLINED'));
  assert.equal((await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, t.token)).status, 409);
});

test('S11 private request refused when seats are already booked (request and accept)', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30, fullAutoFare: 400, privateBookingEnabled: true });
  const u = await H.mkUser();
  const r = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, u.token, { passengers: 5 });
  assert.equal(r.status, 201);
  await H.book(t.trip.id, { seatCount: 1 });
  const late = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, (await H.mkUser()).token, { passengers: 2 });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'SEATS_ALREADY_BOOKED');
  const acc = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, t.token);
  assert.equal(acc.status, 409);
  assert.equal(acc.body.code, 'SEATS_ALREADY_BOOKED');
  const mine = await api('GET', `/api/auto-ride/private-requests/${r.body.request.id}`, u.token);
  assert.equal(mine.body.request.status, 'CONFLICT');
  const trip = await H.ctx.M('AutoTrip').findByPk(t.trip.id);
  assert.equal(trip.mode, 'SHARED');
});

test('S13 expired holds are released (job + lazy expiry) and cannot be confirmed', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const u = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 3 });
  assert.equal(h.status, 201);
  const blocked = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, (await H.mkUser()).token, { seatCount: 1 });
  assert.equal(blocked.status, 409);
  H.advance(6 * H.MIN);
  const job = await H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
  assert.ok(job.holdsExpired >= 1);
  const mine = await api('GET', `/api/auto-ride/bookings/${h.body.booking.id}`, u.token);
  assert.equal(mine.body.booking.status, 'EXPIRED');
  const c = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, {});
  assert.equal(c.status, 410);
  assert.equal(c.body.code, 'HOLD_EXPIRED');
  const map = await api('GET', `/api/auto-ride/trips/${t.trip.id}/seats`, u.token);
  assert.ok(map.body.seats.every((s) => s.state === 'AVAILABLE'));
  // Lazy expiry without the job: a new hold expires the stale one in the same transaction.
  const h2 = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 3 });
  assert.equal(h2.status, 201);
  H.advance(6 * H.MIN);
  const v = await H.mkUser();
  const h3 = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, v.token, { seatCount: 2 });
  assert.equal(h3.status, 201);
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});

test('S15 cancellation frees seats, updates FULL status + queue view; cash -> nothing owed', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 40 });
  const a = await H.book(t.trip.id, { seatCount: 2 });
  await H.book(t.trip.id, { seatCount: 1 });
  let q = await api('GET', `/api/auto-ride/pickup-points/${t.pickup.id}/queue?date=2026-10-20`, a.user.token);
  let entry = q.body.queue.find((x) => x.id === t.trip.id);
  assert.equal(entry.status, 'FULL');
  assert.equal(entry.confirmedSeats, 3);
  const c = await api('POST', `/api/auto-ride/bookings/${a.booking.id}/cancel`, a.user.token, { reason: 'Plans changed' });
  assert.equal(c.status, 200);
  assert.equal(c.body.booking.status, 'CANCELLED');
  assert.equal(c.body.booking.paymentStatus, 'NONE');
  q = await api('GET', `/api/auto-ride/pickup-points/${t.pickup.id}/queue?date=2026-10-20`, a.user.token);
  entry = q.body.queue.find((x) => x.id === t.trip.id);
  assert.equal(entry.status, 'OPEN_FOR_BOOKING');
  assert.equal(entry.confirmedSeats, 1);
  assert.equal(entry.remainingSeats, 2);
  assert.equal(entry.queueNumber, t.trip.queueNumber, 'queue number unchanged');
  const re = await H.book(t.trip.id, { seatCount: 2, seatNumbers: [1, 2] });
  assert.equal(re.confirm.status, 200, 'freed seats can be re-booked');
  const dn = await H.notificationsFor(t.driver.id);
  assert.ok(dn.some((n) => n.title === 'Booking cancelled'));
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});

test('S16 a driver cannot read or change another driver\'s trip', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const other = await H.mkDriver({ capacity: 3 });
  for (const [m, url, body] of [
    ['GET', `/api/auto-ride/driver/trips/${t.trip.id}`],
    ['PATCH', `/api/auto-ride/driver/trips/${t.trip.id}`, { seatFare: 1 }],
    ['POST', `/api/auto-ride/driver/trips/${t.trip.id}/publish`],
    ['POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/cancel`, { reason: 'mine now' }],
    ['GET', `/api/auto-ride/driver/trips/${t.trip.id}/bookings`],
    ['POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, { bookingCode: 'ZAAAAAAA', pin: '1234' }],
  ]) {
    const r = await api(m, url, other.token, body);
    assert.equal(r.status, 404, `${m} ${url} -> ${r.status}`);
  }
  const still = await H.ctx.M('AutoTrip').findByPk(t.trip.id);
  assert.equal(still.status, 'OPEN_FOR_BOOKING');
});

test('S17 a customer cannot see or touch another customer\'s booking', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30 });
  const a = await H.book(t.trip.id, { seatCount: 1 });
  const u = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, a.user.token, { seatCount: 1 });
  assert.equal(h.status, 409, 'one live booking per customer per trip');
  for (const [m, url] of [
    ['GET', `/api/auto-ride/bookings/${a.booking.id}`],
    ['POST', `/api/auto-ride/bookings/${a.booking.id}/cancel`],
    ['POST', `/api/auto-ride/bookings/${a.booking.id}/confirm`],
    ['POST', `/api/auto-ride/bookings/${a.booking.id}/release`],
    ['POST', `/api/auto-ride/bookings/${a.booking.id}/incident`],
  ]) {
    const r = await api(m, url, u.token, m === 'GET' ? undefined : { category: 'OTHER', description: 'not mine' });
    assert.equal(r.status, 404, `${m} ${url}`);
  }
  const list = await api('GET', '/api/auto-ride/bookings', u.token);
  assert.equal(list.body.bookings.length, 0);
});

test('S18 unverified driver / unapproved auto cannot publish', async () => {
  const { route, pickup } = await H.mkRoute();
  for (const opts of [{ status: 'PENDING_REVIEW' }, { status: 'REJECTED' }, { vehicleStatus: 'PENDING_REVIEW' }]) {
    const d = await H.mkDriver({ capacity: 3, ...opts });
    const c = await api('POST', '/api/auto-ride/driver/trips', d.token, {
      vehicleId: d.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + 60 * H.MIN).toISOString(), seatFare: 30, capacity: 3,
    });
    assert.equal(c.status, 201, 'drafts are allowed');
    const p = await api('POST', `/api/auto-ride/driver/trips/${c.body.trip.id}/publish`, d.token);
    assert.equal(p.status, 403);
    assert.equal(p.body.code, opts.vehicleStatus ? 'VEHICLE_NOT_APPROVED' : 'DRIVER_NOT_VERIFIED');
    const u = await H.mkUser();
    const vis = await api('GET', `/api/auto-ride/trips/${c.body.trip.id}`, u.token);
    assert.equal(vis.status, 404, 'drafts are invisible to customers');
  }
  const off = await H.mkDriver({ capacity: 3, online: false });
  const c = await api('POST', '/api/auto-ride/driver/trips', off.token, { vehicleId: off.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + 60 * H.MIN).toISOString(), seatFare: 30 });
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${c.body.trip.id}/publish`, off.token)).body.code, 'DRIVER_OFFLINE');
});

test('S20 duplicate requests / retries after a network failure never double-book', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30 });
  const u = await H.mkUser();
  const key = { 'Idempotency-Key': 'retry-key-0001' };
  const rs = await Promise.all([1, 2, 3].map(() => api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 }, key)));
  const ids = new Set(rs.map((r) => r.body.booking.id));
  assert.equal(ids.size, 1, 'same booking for every retry');
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  const again = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 });
  assert.equal(again.status, 200, 'second hold without key returns the existing hold');
  assert.equal(again.body.booking.id, [...ids][0]);
  const id = [...ids][0];
  const cs = await Promise.all([1, 2].map(() => api('POST', `/api/auto-ride/bookings/${id}/confirm`, u.token, {})));
  assert.ok(cs.every((c) => c.status === 200));
  assert.equal(cs.filter((c) => c.body.duplicate).length, 1, 'one confirm, one replay');
  const trip = await H.ctx.M('AutoTrip').findByPk(t.trip.id);
  assert.equal(trip.seatsConfirmed, 2);
  const dn = (await H.notificationsFor(t.driver.id)).filter((n) => n.title === 'New booking');
  assert.equal(dn.length, 1, 'driver told once');
});

test('S21 capacity never exceeded: approval / trip / per-booking limits', async () => {
  const { route, pickup } = await H.mkRoute();
  const d = await H.mkDriver({ capacity: 6 });
  const over = await api('POST', '/api/auto-ride/driver/trips', d.token, { vehicleId: d.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + 60 * H.MIN).toISOString(), seatFare: 30, capacity: 7 });
  assert.equal(over.status, 400, 'trip capacity above the approved capacity refused');
  const t = await H.mkTrip({ capacity: 6, seatFare: 30, driver: d, route, pickup });
  const u = await H.mkUser();
  const big = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 7 });
  assert.equal(big.status, 400);
  const bad = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1, seatNumbers: [9] });
  assert.equal(bad.status, 400, 'seat number beyond capacity refused');
  const dup = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2, seatNumbers: [3, 3] });
  assert.equal(dup.status, 400);
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});

test('S22 a completed trip cannot restart or change', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const a = await H.book(t.trip.id, { seatCount: 3 });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, { ready: true });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start-boarding`, t.token, {});
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: a.booking.bookingCode, pin: a.booking.boardingPin });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start`, t.token, { safetyConfirmed: true });
  const done = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/complete`, t.token, {});
  assert.equal(done.body.trip.status, 'COMPLETED');
  for (const [action, body] of [['start', { safetyConfirmed: true }], ['start-boarding', {}], ['confirm-departure', { ready: true }], ['complete', {}], ['delay', { minutes: 10 }], ['resume', {}], ['cancel', { reason: 'again' }]]) {
    const r = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/${action}`, t.token, body);
    assert.equal(r.status, 409, `${action} on COMPLETED`);
  }
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/publish`, t.token)).status, 409);
  const u = await H.mkUser();
  assert.equal((await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 })).status, 409);
  assert.equal((await api('POST', `/api/auto-ride/bookings/${a.booking.id}/cancel`, a.user.token, {})).status, 409);
});

test('S23 one status source of truth: customer and driver endpoints return the same status block', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30, minSeatsToDepart: 2 });
  const a = await H.book(t.trip.id, { seatCount: 2 });
  await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, (await H.mkUser()).token, { seatCount: 1 });
  const keys = ['status', 'statusLabel', 'availability', 'availabilityLabel', 'mode', 'capacity', 'confirmedSeats', 'heldSeats', 'boardedSeats', 'remainingSeats', 'minSeatsToDepart', 'queueNumber', 'departureAt', 'delayMinutes', 'version'];
  const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  const check = async () => {
    const c = await api('GET', `/api/auto-ride/trips/${t.trip.id}`, a.user.token);
    const d = await api('GET', `/api/auto-ride/driver/trips/${t.trip.id}`, t.token);
    const b = await api('GET', `/api/auto-ride/bookings/${a.booking.id}`, a.user.token);
    const s = await api('GET', `/api/auto-ride/driver/trips/${t.trip.id}/bookings`, t.token);
    assert.deepEqual(pick(c.body.trip), pick(d.body.trip));
    assert.deepEqual(pick(b.body.booking.trip), pick(d.body.trip));
    assert.deepEqual(pick(s.body.trip), pick(d.body.trip));
    return d.body.trip;
  };
  assert.equal((await check()).status, 'DEPARTURE_THRESHOLD_REACHED');
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/delay`, t.token, { minutes: 15, reason: 'Traffic' });
  const delayed = await check();
  assert.equal(delayed.status, 'DELAYED');
  assert.equal(delayed.delayMinutes, 15);
  const n = await H.notificationsFor(a.user.id);
  assert.ok(n.some((x) => x.type === 'AUTO_TRIP_DELAYED'), 'passenger told about the delay');
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/resume`, t.token, {});
  assert.equal((await check()).status, 'DEPARTURE_THRESHOLD_REACHED');
  assert.ok(H.emitted.some((e) => e.room === `user_${a.user.id}` && e.ev === 'autoride:changed' && e.p.kind === 'trip' && !('name' in e.p) && !('phone' in e.p)), 'customer socket nudge, ids only');
});

test('S24 existing Co-Ride (BikePool / campus ride pool) untouched: separate tables, routes and module', async () => {
  const fs = require('fs');
  const path = require('path');
  const B = path.join(__dirname, '..', '..', '..');
  const tables = Object.values(H.ctx.sequelize.models).filter((m) => m.name.startsWith('Auto')).map((m) => m.getTableName());
  assert.ok(tables.every((t) => /^Auto[A-Z]/.test(t)), 'only Auto* tables');
  for (const t of ['BikePools', 'PoolRequests', 'RidePools']) assert.ok(!tables.includes(t));
  const src = fs.readdirSync(path.join(__dirname, '..'), { recursive: true }).filter((f) => f.endsWith('.js') && !f.includes('tests'))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  assert.ok(!/BikePool|PoolRequest|RidePool|bikepool/i.test(src), 'auto-ride never touches the Co-Ride pool code');
  const server = fs.readFileSync(path.join(B, 'server.js'), 'utf8');
  assert.ok(server.includes("app.use('/api/bikepool'") || /\/api\/bikepool/.test(server), 'Co-Ride routes still mounted');
  assert.ok(server.indexOf("'/api/auto-ride/driver'") < server.indexOf("'/api/auto-ride', autoRideRoutes.router"), 'driver router mounted first');
  assert.ok(server.indexOf("'/api/admin/auto-ride'") < server.indexOf("app.use('/api/admin', require('./routes/adminRoutes'))"), 'admin auto-ride before /api/admin');
});
