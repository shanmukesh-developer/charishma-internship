// Follow-up batch (17 Oct): pickup coordinate precision, public settings, live private-request updates,
// per-booking ids on trip-wide pushes, full-auto extra charges, stale hold retry keys, confirm
// Idempotency-Key, admin filters / names / pagination / phone search, driver OTP attemptsLeft, driver
// pickup queue, driver settings and SOS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const H = require('./helpers');

const { api } = H;
let admin;

before(async () => {
  await H.setup({ label: 'ar-followups' });
  admin = await H.mkAdmin();
});
after(H.teardown);

const notes = async (id, type) => (await H.notificationsFor(id)).filter((n) => !type || n.type === type);
const nudges = (userId, kind, status) => H.emitted.filter((e) => e.room === `user_${userId}` && e.ev === 'autoride:changed' && e.p.kind === kind && (!status || e.p.status === status));

// ── 1. Pickup coordinates ────────────────────────────────────────────────────
test('F1 pickup lat/lon keep 6 decimals (create + update) and are range-checked', async () => {
  await H.setFlag(true);
  const r = await api('POST', '/api/admin/auto-ride/routes', admin.token, { name: 'Precision Route', originLabel: 'SRM AP', destinationLabel: 'Tadepalli' });
  assert.equal(r.status, 201);
  const c = await api('POST', `/api/admin/auto-ride/routes/${r.body.route.id}/pickup-points`, admin.token, { name: 'Library Stand', lat: 16.4625127, lon: 80.5065439 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.pickupPoint.lat, 16.462513, 'rounded to 6 decimals, not 2');
  assert.equal(c.body.pickupPoint.lon, 80.506544);
  assert.match(c.body.pickupPoint.mapsUrl, /16\.462513,80\.506544/);
  const u = await api('PATCH', `/api/admin/auto-ride/pickup-points/${c.body.pickupPoint.id}`, admin.token, { lat: -12.345678, lon: -179.999999 });
  assert.equal(u.status, 200);
  assert.equal(u.body.pickupPoint.lat, -12.345678);
  assert.equal(u.body.pickupPoint.lon, -179.999999);
  const row = await H.ctx.M('AutoPickupPoint').findByPk(c.body.pickupPoint.id);
  assert.equal(Number(row.lat), -12.345678, 'stored with full precision');
  for (const bad of [{ lat: 90.5, lon: 10 }, { lat: -91, lon: 10 }, { lat: 10, lon: 180.01 }, { lat: 10, lon: -181 }, { lat: 'abc', lon: 10 }]) {
    const x = await api('PATCH', `/api/admin/auto-ride/pickup-points/${c.body.pickupPoint.id}`, admin.token, bad);
    assert.equal(x.status, 400, JSON.stringify(bad));
    assert.equal(x.body.code, 'INVALID_INPUT');
  }
  const cust = await H.mkUser();
  const pps = await api('GET', `/api/auto-ride/pickup-points?routeId=${r.body.route.id}`, cust.token);
  assert.equal(pps.body.pickupPoints[0].lat, -12.345678, 'customers see the precise point');
  // Other numbers keep 2 decimals (money / km).
  const r2 = await api('PATCH', `/api/admin/auto-ride/routes/${r.body.route.id}`, admin.token, { distanceKm: 12.3456, seatFareMin: 10.005 });
  assert.equal(r2.body.route.distanceKm, 12.35);
});

// ── 2. Public settings ──────────────────────────────────────────────────────
test('F2 /status + /settings/public expose the public limits; settings keep seats per booking <= platform max', async () => {
  const u = await H.mkUser();
  await H.setFlag(false);
  const off = await api('GET', '/api/auto-ride/status', u.token);
  assert.equal(off.body.enabled, false);
  assert.deepEqual(off.body.paymentMethods, []);
  assert.deepEqual(off.body.settings, {
    maxSeatsPerBooking: 4, holdMinutes: 5, refundBeforeDriverConfirmPct: 100, refundAfterDriverConfirmPct: 0,
    maxAdvanceDays: 7, platformMaxCapacity: 8, privateRespondMinutes: 10, arrivalWindowMinutes: 15, walletEnabled: false,
  }, 'available while the feature is off');
  await H.setFlag(true);
  const pub = await api('GET', '/api/auto-ride/settings/public', u.token);
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.body.settings, off.body.settings);

  const tooMany = await api('PUT', '/api/admin/auto-ride/settings', admin.token, { maxSeatsPerBooking: 9 });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.field, 'maxSeatsPerBooking');
  const tooSmall = await api('PUT', '/api/admin/auto-ride/settings', admin.token, { platformMaxCapacity: 3 });
  assert.equal(tooSmall.status, 400, 'platform max below the current seats-per-booking');
  assert.equal(tooSmall.body.field, 'platformMaxCapacity');
  const both = await api('PUT', '/api/admin/auto-ride/settings', admin.token, { platformMaxCapacity: 6, maxSeatsPerBooking: 6, customerRefundAfterConfirmPct: 25, holdMinutes: 7 });
  assert.equal(both.status, 200);
  const s2 = await api('GET', '/api/auto-ride/status', u.token);
  assert.equal(s2.body.settings.maxSeatsPerBooking, 6);
  assert.equal(s2.body.settings.refundAfterDriverConfirmPct, 25);
  assert.equal(s2.body.settings.holdMinutes, 7);
  const back = await api('PUT', '/api/admin/auto-ride/settings', admin.token, { maxSeatsPerBooking: 4, platformMaxCapacity: 8, customerRefundAfterConfirmPct: 0, holdMinutes: 5 });
  assert.equal(back.status, 200);
});

// ── 3. Live private-request updates ─────────────────────────────────────────
test('F3 the customer gets autoride:changed for ACCEPTED / CONFLICT / DECLINED / EXPIRED / CANCELLED full-auto requests', async () => {
  const t = await H.mkTrip({ capacity: 4, seatFare: 30, fullAutoFare: 300, privateBookingEnabled: true });
  const a = await H.mkUser({ name: 'Anil Accept' });
  const b = await H.mkUser({ name: 'Bhanu Beaten' });
  const ra = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, a.token, { passengers: 3 });
  const rb = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, b.token, { passengers: 2 });
  assert.equal(ra.status, 201);
  assert.equal(rb.status, 201);
  const acc = await api('POST', `/api/auto-ride/driver/private-requests/${ra.body.request.id}/accept`, t.token);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  await H.notificationsFor(a.id);
  assert.ok(nudges(a.id, 'private_request', 'ACCEPTED').some((e) => e.p.id === ra.body.request.id), 'ACCEPTED nudge');
  assert.ok(nudges(b.id, 'private_request', 'CONFLICT').some((e) => e.p.id === rb.body.request.id), 'CONFLICT nudge to the other requester');
  const accNote = (await notes(a.id, 'AUTO_PRIVATE_ACCEPTED'))[0];
  assert.equal(accNote.data.bookingId, acc.body.booking.id);
  assert.equal(accNote.data.requestId, ra.body.request.id);

  // DECLINED
  const t2 = await H.mkTrip({ capacity: 4, seatFare: 30, fullAutoFare: 300, privateBookingEnabled: true });
  const c = await H.mkUser();
  const rc = await api('POST', `/api/auto-ride/trips/${t2.trip.id}/private-requests`, c.token, { passengers: 2 });
  await api('POST', `/api/auto-ride/driver/private-requests/${rc.body.request.id}/decline`, t2.token, { reason: 'Going home' });
  assert.ok(nudges(c.id, 'private_request', 'DECLINED').length >= 1, 'DECLINED nudge');

  // CANCELLED by the trip ending (driver cancels the trip)
  const d = await H.mkUser();
  const rd = await api('POST', `/api/auto-ride/trips/${t2.trip.id}/private-requests`, d.token, { passengers: 2 });
  assert.equal(rd.status, 201);
  const cancel = await api('POST', `/api/auto-ride/driver/trips/${t2.trip.id}/actions/cancel`, t2.token, { reason: 'Vehicle problem' });
  assert.equal(cancel.status, 200);
  assert.ok(nudges(d.id, 'private_request', 'CANCELLED').some((e) => e.p.id === rd.body.request.id), 'CANCELLED nudge (trip ended)');

  // CANCELLED by the customer (their other devices) + EXPIRED by the lifecycle job
  const t3 = await H.mkTrip({ capacity: 4, seatFare: 30, fullAutoFare: 300, privateBookingEnabled: true, departInMin: 120 });
  const e = await H.mkUser();
  const re = await api('POST', `/api/auto-ride/trips/${t3.trip.id}/private-requests`, e.token, { passengers: 2 });
  await api('POST', `/api/auto-ride/private-requests/${re.body.request.id}/cancel`, e.token);
  assert.ok(nudges(e.id, 'private_request', 'CANCELLED').length >= 1, 'customer cancel nudge');
  const f = await H.mkUser();
  const rf = await api('POST', `/api/auto-ride/trips/${t3.trip.id}/private-requests`, f.token, { passengers: 2 });
  H.advance(11 * H.MIN);
  const out = await H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
  assert.ok(out.privateExpired >= 1);
  assert.ok(nudges(f.id, 'private_request', 'EXPIRED').some((x) => x.p.id === rf.body.request.id), 'EXPIRED nudge');
  for (const x of H.emitted.filter((y) => y.ev === 'autoride:changed')) assert.ok(!/phone|name|pin/i.test(JSON.stringify(x.p)), 'ids only');
});

// ── 4. Trip-wide pushes carry each passenger's bookingId ─────────────────────
test('F4 trip-wide pushes (full, delayed, departure, started, completed, cancelled) carry each passenger\'s own bookingId', async () => {
  const t = await H.mkTrip({ capacity: 2, seatFare: 30 });
  const a = await H.book(t.trip.id, { seatCount: 1 });
  const b = await H.book(t.trip.id, { seatCount: 1 });
  const mine = { [a.user.id]: a.booking.id, [b.user.id]: b.booking.id };
  const dt = (action, body) => api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/${action}`, t.token, body);
  assert.equal((await dt('delay', { minutes: 10, reason: 'Traffic' })).status, 200);
  assert.equal((await dt('resume')).status, 200);
  assert.equal((await dt('confirm-departure', { ready: true })).status, 200);
  assert.equal((await dt('start-boarding')).status, 200);
  for (const x of [a, b]) {
    const pin = (await H.ctx.M('AutoBooking').findByPk(x.booking.id)).boardingPin;
    const ci = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: x.booking.bookingCode, pin, cashCollected: true });
    assert.equal(ci.status, 200, JSON.stringify(ci.body));
  }
  assert.equal((await dt('start', { safetyConfirmed: true })).status, 200);
  assert.equal((await dt('complete')).status, 200);
  for (const uid of [a.user.id, b.user.id]) {
    const list = await notes(uid);
    for (const type of ['AUTO_TRIP_FULL', 'AUTO_TRIP_DELAYED', 'AUTO_DEPARTURE_CONFIRMED', 'AUTO_BOARDING', 'AUTO_TRIP_STARTED', 'AUTO_TRIP_COMPLETED']) {
      const n = list.filter((x) => x.type === type);
      assert.equal(n.length, 1, `${type} once for ${uid}`);
      assert.equal(n[0].data.bookingId, mine[uid], `${type} carries this passenger's bookingId`);
      assert.equal(n[0].data.tripId, t.trip.id);
    }
  }
  // Cancelled trip
  const t2 = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const c = await H.book(t2.trip.id, { seatCount: 2 });
  const d = await H.book(t2.trip.id, { seatCount: 1 });
  await api('POST', `/api/auto-ride/driver/trips/${t2.trip.id}/actions/cancel`, t2.token, { reason: 'Puncture' });
  for (const x of [c, d]) {
    const n = await notes(x.user.id, 'AUTO_TRIP_CANCELLED');
    assert.equal(n.length, 1);
    assert.equal(n[0].data.bookingId, x.booking.id);
  }
  // The app opens the booking for any of these (customer-mobile autoRideLinks prefers bookingId).
});

// ── 5. Full-auto extra charges ──────────────────────────────────────────────
test('F5 full-auto extra charges: bounded, shown to the customer, added to the private fare by the server', async () => {
  const { route, pickup } = await H.mkRoute();
  const dv = await H.mkDriver({ capacity: 4 });
  const base = { vehicleId: dv.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + 60 * H.MIN).toISOString(), seatFare: 40, fullAutoFare: 300, privateBookingEnabled: true };
  const draft = (extra) => api('POST', '/api/auto-ride/driver/trips', dv.token, { ...base, ...extra });
  for (const [extra, field] of [
    [{ extraCharges: { amount: 301, note: 'Luggage' } }, 'extraCharges.amount'],
    [{ extraCharges: { amount: 50 } }, 'extraCharges.note'],
    [{ extraCharges: { amount: -5, note: 'Luggage' } }, 'extraCharges.amount'],
    [{ fullAutoFare: 5000, extraCharges: { amount: 2500, note: 'Night trip' } }, 'extraCharges.amount'],
  ]) {
    const x = await draft(extra);
    assert.equal(x.status, 400, JSON.stringify(extra));
    assert.equal(x.body.field, field);
  }
  const c = await draft({ extraCharges: { amount: 50, note: 'Luggage carrier' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.deepEqual(c.body.trip.extraCharges, { amount: 50, note: 'Luggage carrier' });
  const cleared = await api('PATCH', `/api/auto-ride/driver/trips/${c.body.trip.id}`, dv.token, { extraCharges: null });
  assert.equal(cleared.body.trip.extraCharges, null, 'null clears');
  const set = await api('PATCH', `/api/auto-ride/driver/trips/${c.body.trip.id}`, dv.token, { extraChargesAmount: 50, extraChargesNote: 'Luggage carrier' });
  assert.deepEqual(set.body.trip.extraCharges, { amount: 50, note: 'Luggage carrier' }, 'flat fields work too');
  const p = await api('POST', `/api/auto-ride/driver/trips/${c.body.trip.id}/publish`, dv.token);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const u = await H.mkUser();
  const det = await api('GET', `/api/auto-ride/trips/${c.body.trip.id}`, u.token);
  assert.equal(det.body.trip.fullAutoFare, 300);
  assert.deepEqual(det.body.trip.extraCharges, { amount: 50, note: 'Luggage carrier' });
  assert.equal(det.body.trip.fullAutoTotal, 350);
  const r = await api('POST', `/api/auto-ride/trips/${c.body.trip.id}/private-requests`, u.token, { passengers: 3, fare: 1, extraCharges: { amount: 0 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.request.fare, 350, 'client fare ignored; server adds the extra charges');
  assert.equal(r.body.request.baseFare, 300);
  assert.deepEqual(r.body.request.extraCharges, { amount: 50, note: 'Luggage carrier' });
  const dr = await api('GET', '/api/auto-ride/driver/private-requests?status=REQUESTED', dv.token);
  assert.equal(dr.body.requests[0].fare, 350);
  assert.deepEqual(dr.body.requests[0].extraCharges, { amount: 50, note: 'Luggage carrier' });
  const acc = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, dv.token);
  assert.equal(acc.status, 200);
  const bk = await api('GET', `/api/auto-ride/bookings/${acc.body.booking.id}`, u.token);
  assert.equal(bk.body.booking.amount, 350);
  assert.deepEqual(bk.body.booking.fareBreakdown.extraCharges, { amount: 50, note: 'Luggage carrier' });
  assert.equal(bk.body.booking.fareBreakdown.baseFare, 300);
  assert.equal(bk.body.booking.fareBreakdown.total, 350);
  // A trip without extra charges is unchanged.
  const plain = await H.mkTrip({ capacity: 4, seatFare: 30, fullAutoFare: 200, privateBookingEnabled: true });
  const pd = await api('GET', `/api/auto-ride/trips/${plain.trip.id}`, u.token);
  assert.equal(pd.body.trip.extraCharges, null);
  assert.equal(pd.body.trip.fullAutoTotal, 200);
});

// ── 6. Stale hold retry keys ────────────────────────────────────────────────
test('F6 an old hold Idempotency-Key whose booking is released / expired -> 409 IDEMPOTENCY_KEY_REUSED (never the stale booking)', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30 });
  const u = await H.mkUser();
  const k1 = { 'Idempotency-Key': `hold-key-${crypto.randomBytes(4).toString('hex')}` };
  const h1 = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 }, k1);
  assert.equal(h1.status, 201);
  const replay = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 }, k1);
  assert.equal(replay.status, 200, 'live hold still replays');
  assert.equal(replay.body.booking.id, h1.body.booking.id);
  await api('POST', `/api/auto-ride/bookings/${h1.body.booking.id}/release`, u.token);
  const stale = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 }, k1);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(stale.body.bookingId, h1.body.booking.id);
  assert.equal(stale.body.status, 'CANCELLED');
  assert.ok(!stale.body.booking, 'the stale booking is not returned');

  const k2 = { 'Idempotency-Key': `hold-key-${crypto.randomBytes(4).toString('hex')}` };
  const h2 = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 }, k2);
  assert.equal(h2.status, 201);
  H.advance(6 * H.MIN); // past holdMinutes, before the job runs
  const exp = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 }, k2);
  assert.equal(exp.status, 409);
  assert.equal(exp.body.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(exp.body.status, 'EXPIRED');
  const row = await H.ctx.M('AutoBooking').findByPk(h2.body.booking.id);
  assert.equal(row.status, 'EXPIRED', 'the expiry was committed');
  assert.equal((await notes(u.id, 'AUTO_HOLD_EXPIRED')).length, 1, 'customer told about the expiry');
  const fresh = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 }, { 'Idempotency-Key': `hold-key-${crypto.randomBytes(4).toString('hex')}` });
  assert.equal(fresh.status, 201, 'a new key books again');
  assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
});

// ── 7. Confirm Idempotency-Key ──────────────────────────────────────────────
test('F7 confirm honours Idempotency-Key: replay = same result (duplicate), failure releases the key, other booking -> 409', async () => {
  const t = await H.mkTrip({ capacity: 6, seatFare: 30 });
  const u = await H.mkUser();
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 });
  const key = { 'Idempotency-Key': `confirm-key-${crypto.randomBytes(4).toString('hex')}` };
  const off = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod: 'WALLET' }, key);
  assert.equal(off.status, 403);
  assert.equal(off.body.code, 'PAYMENT_METHOD_OFF');
  const c1 = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod: 'CASH' }, key);
  assert.equal(c1.status, 200, 'a failed attempt released the key');
  assert.equal(c1.body.duplicate, false);
  const c2 = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod: 'CASH' }, key);
  assert.equal(c2.status, 200);
  assert.equal(c2.body.duplicate, true);
  assert.equal(c2.body.booking.id, c1.body.booking.id);
  assert.equal(c2.body.booking.bookingCode, c1.body.booking.bookingCode);
  assert.equal(c2.body.booking.boardingPin, c1.body.booking.boardingPin);
  assert.equal(c2.body.booking.status, 'CONFIRMED');
  const row = await H.ctx.M('IdempotencyKey').findOne({ where: { scope: 'autoride_confirm', userId: String(u.id), key: key['Idempotency-Key'] } });
  assert.equal(row && row.status, 'done', 'shared claim stored');
  const dn = (await notes(t.driver.id)).filter((n) => n.title === 'New booking');
  assert.equal(dn.length, 1, 'driver told once');
  const t2 = await H.mkTrip({ capacity: 4, seatFare: 30 });
  const h2 = await api('POST', `/api/auto-ride/trips/${t2.trip.id}/holds`, u.token, { seatCount: 1 });
  const other = await api('POST', `/api/auto-ride/bookings/${h2.body.booking.id}/confirm`, u.token, { paymentMethod: 'CASH' }, key);
  assert.equal(other.status, 409);
  assert.equal(other.body.code, 'IDEMPOTENCY_KEY_REUSED');
  const noKey = await api('POST', `/api/auto-ride/bookings/${h2.body.booking.id}/confirm`, u.token, { paymentMethod: 'CASH' });
  assert.equal(noKey.status, 200, 'without a key nothing changes');
  const trip = await H.ctx.M('AutoTrip').findByPk(t.trip.id);
  assert.equal(trip.seatsConfirmed, 2);
});

// ── 8. Admin ────────────────────────────────────────────────────────────────
test('F8 admin: vehicle detail, trip filters + names, phone search, fare outliers with departureAt, names, pagination', async () => {
  const a = await api('POST', '/api/admin/auto-ride/routes', admin.token, { name: 'Admin Route A', originLabel: 'SRM AP', destinationLabel: 'Vijayawada', seatFareMin: 10, seatFareMax: 200, fullFareMin: 50, fullFareMax: 2000 });
  const pa = await api('POST', `/api/admin/auto-ride/routes/${a.body.route.id}/pickup-points`, admin.token, { name: 'Hostel Gate', lat: 16.46, lon: 80.5 });
  const route = await H.ctx.M('AutoRoute').findByPk(a.body.route.id);
  const pickup = await H.ctx.M('AutoPickupPoint').findByPk(pa.body.pickupPoint.id);
  const t = await H.mkTrip({ capacity: 4, seatFare: 40, fullAutoFare: 300, privateBookingEnabled: true, route, pickup });
  await H.mkTrip({ capacity: 4, seatFare: 40 }); // another route

  // GET /vehicles/:id
  const v = await api('GET', `/api/admin/auto-ride/vehicles/${t.vehicle.id}`, admin.token);
  assert.equal(v.status, 200);
  assert.equal(v.body.vehicle.id, t.vehicle.id);
  assert.equal(v.body.driver.id, t.driver.id);
  assert.ok(v.body.trips.some((x) => x.id === t.trip.id));
  assert.equal(v.body.platformMaxCapacity, 8);
  assert.equal((await api('GET', `/api/admin/auto-ride/vehicles/${crypto.randomUUID()}`, admin.token)).status, 404);

  // /trips filters + names
  const byRoute = await api('GET', `/api/admin/auto-ride/trips?routeId=${route.id}`, admin.token);
  assert.equal(byRoute.status, 200);
  assert.deepEqual(byRoute.body.trips.map((x) => x.id), [t.trip.id]);
  assert.equal(byRoute.body.trips[0].routeName, 'Admin Route A');
  assert.equal(byRoute.body.trips[0].pickupName, 'Hostel Gate');
  assert.equal(byRoute.body.trips[0].route.name, 'Admin Route A');
  assert.equal(byRoute.body.trips[0].pickup.name, 'Hostel Gate');
  assert.equal(byRoute.body.trips[0].driverName, 'Ravi K.');
  const byPickup = await api('GET', `/api/admin/auto-ride/trips?pickupPointId=${pickup.id}`, admin.token);
  assert.deepEqual(byPickup.body.trips.map((x) => x.id), [t.trip.id]);
  assert.equal((await api('GET', '/api/admin/auto-ride/trips?routeId=nope', admin.token)).status, 400);
  const all = await api('GET', '/api/admin/auto-ride/trips', admin.token);
  assert.ok(all.body.trips.length >= 2 && all.body.pagination.hasMore === false && all.body.pagination.page === 1, 'default list unchanged');
  const p1 = await api('GET', '/api/admin/auto-ride/trips?limit=1', admin.token);
  const p2 = await api('GET', '/api/admin/auto-ride/trips?limit=1&page=2', admin.token);
  assert.equal(p1.body.trips.length, 1);
  assert.equal(p1.body.pagination.hasMore, true);
  assert.notEqual(p1.body.trips[0].id, p2.body.trips[0].id);
  assert.equal((await api('GET', '/api/admin/auto-ride/trips?limit=0', admin.token)).status, 400);

  // Bookings by phone (exact, or last 4 + code)
  const u = await H.mkUser({ name: 'Priya Sharma' });
  const bk = await H.book(t.trip.id, { seatCount: 1, user: u });
  const exact = await api('GET', `/api/admin/auto-ride/bookings?phone=${u.phone}`, admin.token);
  assert.deepEqual(exact.body.bookings.map((x) => x.id), [bk.booking.id]);
  const plus = await api('GET', `/api/admin/auto-ride/bookings?phone=${encodeURIComponent(`+91 ${u.phone}`)}`, admin.token);
  assert.deepEqual(plus.body.bookings.map((x) => x.id), [bk.booking.id]);
  const last4 = u.phone.slice(-4);
  const noCode = await api('GET', `/api/admin/auto-ride/bookings?phone=${last4}`, admin.token);
  assert.equal(noCode.status, 400, 'last 4 digits alone are not enough');
  const withCode = await api('GET', `/api/admin/auto-ride/bookings?phone=${last4}&code=${bk.booking.bookingCode}`, admin.token);
  assert.deepEqual(withCode.body.bookings.map((x) => x.id), [bk.booking.id]);
  const wrong4 = await api('GET', `/api/admin/auto-ride/bookings?phone=${last4 === '0000' ? '1111' : '0000'}&code=${bk.booking.bookingCode}`, admin.token);
  assert.equal(wrong4.body.bookings.length, 0);
  assert.equal((await api('GET', '/api/admin/auto-ride/bookings?phone=12345', admin.token)).status, 400);
  const nobody = await api('GET', '/api/admin/auto-ride/bookings?phone=9000000001', admin.token);
  assert.equal(nobody.body.bookings.length, 0, 'unknown number -> nothing (not everything)');
  const customerTry = await api('GET', `/api/admin/auto-ride/bookings?phone=${u.phone}`, u.token);
  assert.ok([401, 403].includes(customerTry.status), 'admin only');

  // Names on private requests, incidents, audit
  const t2 = await H.mkTrip({ capacity: 4, seatFare: 40, fullAutoFare: 300, privateBookingEnabled: true });
  const pu = await H.mkUser({ name: 'Kavya Reddy' });
  await api('POST', `/api/auto-ride/trips/${t2.trip.id}/private-requests`, pu.token, { passengers: 2 });
  const prs = await api('GET', `/api/admin/auto-ride/private-requests?tripId=${t2.trip.id}`, admin.token);
  assert.equal(prs.body.requests.length, 1);
  assert.equal(prs.body.requests[0].passenger.name, 'Kavya');
  assert.equal(prs.body.requests[0].passenger.phoneMasked, `•••• ${pu.phone.slice(-4)}`);
  assert.equal(prs.body.requests[0].driver.name, 'Ravi K.');
  assert.ok(!JSON.stringify(prs.body.requests[0].passenger).includes(pu.phone), 'masked');
  const inc = await api('POST', `/api/auto-ride/bookings/${bk.booking.id}/incident`, u.token, { category: 'HARASSMENT', description: 'Driver was rude to me.' });
  assert.equal(inc.status, 201);
  assert.equal(inc.body.incident.priority, 'HIGH');
  const incs = await api('GET', '/api/admin/auto-ride/incidents?status=ALL', admin.token);
  const row = incs.body.incidents.find((x) => x.id === inc.body.incident.id);
  assert.equal(row.reporter.name, 'Priya');
  assert.equal(row.priority, 'HIGH');
  const high = await api('GET', '/api/admin/auto-ride/incidents?status=ALL&priority=HIGH', admin.token);
  assert.ok(high.body.incidents.every((x) => x.priority === 'HIGH'));
  const audit = await api('GET', '/api/admin/auto-ride/audit?limit=2', admin.token);
  assert.equal(audit.body.entries.length, 2);
  assert.equal(audit.body.entries[0].actor.name, 'Test');
  assert.equal(audit.body.entries[0].actor.id, admin.id);
  assert.equal(audit.body.pagination.hasMore, true);

  // Fare outliers carry departureAt (route bounds tightened after publish)
  await api('PATCH', `/api/admin/auto-ride/routes/${route.id}`, admin.token, { seatFareMax: 20 });
  const fares = await api('GET', '/api/admin/auto-ride/fares', admin.token);
  const o = fares.body.outliers.find((x) => x.id === t.trip.id);
  assert.ok(o, 'outlier listed');
  assert.equal(o.departureAt, t.trip.departureAt);
  assert.equal(o.routeName, 'Admin Route A');

  // Pagination on the other lists keeps the default when absent
  for (const path of ['drivers?status=ALL', 'vehicles?status=ALL', 'routes', 'bookings', 'private-requests', 'incidents?status=ALL', 'queues', 'audit']) {
    const d = await api('GET', `/api/admin/auto-ride/${path}`, admin.token);
    assert.equal(d.status, 200, path);
    assert.equal(d.body.pagination.page, 1, path);
    assert.equal(d.body.pagination.hasMore, false, path);
    const sep = path.includes('?') ? '&' : '?';
    const one = await api('GET', `/api/admin/auto-ride/${path}${sep}limit=1`, admin.token);
    assert.equal(one.status, 200, path);
    const list = Object.values(one.body).find(Array.isArray);
    assert.ok(list.length <= 1, `${path} limit=1`);
  }
  const r1 = await api('GET', '/api/admin/auto-ride/routes?limit=1&page=1', admin.token);
  const r2 = await api('GET', '/api/admin/auto-ride/routes?limit=1&page=2', admin.token);
  assert.equal(r1.body.routes.length, 1);
  assert.notEqual(r1.body.routes[0].id, r2.body.routes[0].id);
});

// ── 9. Driver ───────────────────────────────────────────────────────────────
test('F9a driver sign-up: a wrong OTP keeps attemptsLeft; PIN_LOCKED carries attemptsLeft 0', async () => {
  const phone = H.nextPhone();
  const hash = crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${phone}:auth:482913`).digest('hex');
  await H.ctx.M('OtpCode').create({ phone, purpose: 'auth', codeHash: hash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  const wrong = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Suresh Babu', phone, password: 'Driver123', otp: '111111' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'OTP_INVALID');
  assert.equal(typeof wrong.body.attemptsLeft, 'number');
  assert.ok(wrong.body.attemptsLeft > 0);

  const t = await H.mkTrip({ capacity: 1, seatFare: 30 });
  const b = await H.book(t.trip.id, { seatCount: 1 });
  const dt = (action, body) => api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/${action}`, t.token, body);
  assert.equal((await dt('confirm-departure', { ready: true })).status, 200);
  assert.equal((await dt('start-boarding')).status, 200);
  const realPin = (await H.ctx.M('AutoBooking').findByPk(b.booking.id)).boardingPin;
  const bad = realPin === '0000' ? '1111' : '0000';
  let last;
  for (let i = 0; i < 4; i++) last = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: b.booking.bookingCode, pin: bad });
  assert.equal(last.body.code, 'WRONG_PIN');
  assert.equal(last.body.attemptsLeft, 1);
  const fifth = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: b.booking.bookingCode, pin: bad });
  assert.equal(fifth.status, 429, 'the 5th wrong PIN locks');
  assert.equal(fifth.body.code, 'PIN_LOCKED');
  assert.equal(fifth.body.attemptsLeft, 0);
  const locked = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/check-in`, t.token, { bookingCode: b.booking.bookingCode, pin: realPin });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'PIN_LOCKED');
  assert.equal(locked.body.attemptsLeft, 0);
  assert.ok(locked.body.lockedUntil);
});

test('F9b driver pickup-point queue: same trips as the customer queue, no passenger data', async () => {
  const { route, pickup } = await H.mkRoute();
  const a = await H.mkTrip({ capacity: 4, seatFare: 30, route, pickup });
  const b = await H.mkTrip({ capacity: 4, seatFare: 30, route, pickup, departInMin: 75 });
  const pax = await H.mkUser({ name: 'Meena Passenger' });
  await H.book(a.trip.id, { seatCount: 2, user: pax });
  const dq = await api('GET', `/api/auto-ride/driver/pickup-points/${pickup.id}/queue`, b.token);
  assert.equal(dq.status, 200);
  const cq = await api('GET', `/api/auto-ride/pickup-points/${pickup.id}/queue`, (await H.mkUser()).token);
  assert.deepEqual(dq.body.queue.map((x) => x.id), cq.body.queue.map((x) => x.id), 'same data as the customer queue');
  assert.deepEqual(dq.body.queue.map((x) => x.queueNumber), [1, 2]);
  assert.deepEqual(dq.body.queue.map((x) => x.mine), [false, true]);
  assert.equal(dq.body.queue[0].confirmedSeats, 2);
  const text = JSON.stringify(dq.body);
  assert.ok(!text.includes(pax.phone) && !text.includes('Meena') && !text.includes(String(pax.id)), 'no passenger PII');
  assert.ok(!/boardingPin|bookingCode/.test(text));
  assert.equal(dq.body.queue[0].myBookingId, null);
  assert.equal((await api('GET', `/api/auto-ride/driver/pickup-points/${crypto.randomUUID()}/queue`, b.token)).status, 404);
  assert.equal((await api('GET', `/api/auto-ride/driver/pickup-points/${pickup.id}/queue`, pax.token)).status, 401, 'customers use their own endpoint');
});

test('F9c drivers see platformMaxCapacity / maxAdvanceDays / holdMinutes on /home and /settings', async () => {
  const d = await H.mkDriver({ capacity: 3 });
  const home = await api('GET', '/api/auto-ride/driver/home', d.token);
  assert.equal(home.status, 200);
  assert.equal(home.body.settings.platformMaxCapacity, 8);
  assert.equal(home.body.settings.maxAdvanceDays, 7);
  assert.equal(home.body.settings.holdMinutes, 5);
  const s = await api('GET', '/api/auto-ride/driver/settings', d.token);
  assert.deepEqual(s.body.settings, home.body.settings);
});

test('F9d driver SOS: SAFETY incident with HIGH priority on the current trip + admin push / alert', async () => {
  const pushAdmin = await H.mkAdmin();
  await pushAdmin.update({ fcmTokens: ['test-admin-device-token'] });
  const t = await H.mkTrip({ capacity: 4, seatFare: 30 });
  const before = H.emitted.length;
  const r = await api('POST', '/api/auto-ride/driver/sos', t.token, { note: 'Passenger misbehaving', lat: 16.4625127, lon: 80.5065439 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.incident.category, 'SAFETY');
  assert.equal(r.body.incident.priority, 'HIGH');
  assert.equal(r.body.incident.tripId, t.trip.id, 'linked to the current trip');
  assert.equal(r.body.emergencyNumber, '112');
  assert.match(r.body.incident.description, /Passenger misbehaving/);
  assert.match(r.body.incident.description, /16\.462513,80\.506544/);
  await H.notificationsFor(pushAdmin.id);
  await new Promise((res) => setTimeout(res, 50));
  const alert = H.emitted.slice(before).find((e) => e.room === 'admin-room' && e.ev === 'adminAlert');
  assert.ok(alert, 'admin socket alert');
  assert.equal(alert.p.type, 'AUTO_DRIVER_SOS');
  assert.equal(alert.p.incidentId, r.body.incident.id);
  const pushed = await H.ctx.M('Notification').findAll({ where: { userId: String(pushAdmin.id) } });
  assert.ok(pushed.some((n) => n.type === 'AUTO_DRIVER_SOS' || (n.data && n.data.type === 'AUTO_DRIVER_SOS')), 'admin device push recorded');
  const list = await api('GET', '/api/admin/auto-ride/incidents?status=OPEN&priority=HIGH', admin.token);
  const row = list.body.incidents.find((x) => x.id === r.body.incident.id);
  assert.ok(row);
  assert.equal(row.reporterType, 'DRIVER');
  assert.equal(row.reporter.name, 'Ravi K.');
  const noTrip = await H.mkDriver({ capacity: 2 });
  const r2 = await api('POST', '/api/auto-ride/driver/sos', noTrip.token, {});
  assert.equal(r2.status, 201, 'works without a trip and without a note');
  assert.equal(r2.body.incident.tripId, null);
  const other = await api('POST', '/api/auto-ride/driver/sos', noTrip.token, { tripId: t.trip.id });
  assert.equal(other.status, 404, "cannot attach another driver's trip");
  const badLat = await api('POST', '/api/auto-ride/driver/sos', noTrip.token, { lat: 95, lon: 10 });
  assert.equal(badLat.status, 400);
});
