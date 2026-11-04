// Driver onboarding end to end through the API (OTP sign-up, private documents, vehicle, review),
// admin verification with the capacity rules (approvedCapacity <= RC seating <= platform max, default
// min(RC, platform max) with a default layout), routes / pickup points / fare bounds / operating
// periods, audit rows, admin summary + booking search + cancel.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const H = require('./helpers');

const { api } = H;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (n) => `data:image/png;base64,${Buffer.concat([PNG, Buffer.from(`-${n}-${crypto.randomBytes(4).toString('hex')}`)]).toString('base64')}`;
const otpRow = async (phone, code) => {
  const hash = crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${phone}:auth:${code}`).digest('hex');
  await H.ctx.M('OtpCode').create({ phone, purpose: 'auth', codeHash: hash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
};

let admin;
before(async () => {
  await H.setup({ label: 'ar-onboarding' });
  await H.setFlag(true);
  admin = await H.mkAdmin();
});
after(H.teardown);

test('admin sets up a route with fare bounds, operating periods and pickup points (audited)', async () => {
  const bad = await api('POST', '/api/admin/auto-ride/routes', admin.token, { name: 'X', originLabel: 'SRM', destinationLabel: 'Tadepalli', seatFareMin: 50, seatFareMax: 20 });
  assert.equal(bad.status, 400);
  const r = await api('POST', '/api/admin/auto-ride/routes', admin.token, {
    name: 'SRM AP to Tadepalli', originLabel: 'SRM University-AP', destinationLabel: 'Tadepalli', distanceKm: 9.5,
    seatFareMin: 20, seatFareMax: 60, fullFareMin: 150, fullFareMax: 500, minSeatsToDepartDefault: 4,
    operatingPeriods: [{ key: 'morning', start: '07:00', end: '12:00' }, { key: 'EVENING', start: '15:00', end: '21:00' }],
    permittedStops: ['Undavalli Caves'],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.route.operatingPeriods[0].key, 'MORNING');
  const p = await api('POST', `/api/admin/auto-ride/routes/${r.body.route.id}/pickup-points`, admin.token, { name: 'Hostel Gate Stand', landmark: 'Near the bus bay', lat: 16.46, lon: 80.50, sequence: 1 });
  assert.equal(p.status, 201);
  assert.ok(p.body.pickupPoint.mapsUrl.includes('16.46'));
  const p2 = await api('POST', `/api/admin/auto-ride/routes/${r.body.route.id}/pickup-points`, admin.token, { name: 'Library Stand', lat: 16.5 });
  assert.equal(p2.status, 400, 'lat without lon refused');
  const list = await api('GET', '/api/admin/auto-ride/routes', admin.token);
  assert.equal(list.body.routes.length, 1);
  const audit = await H.ctx.M('VerificationLog').findAll({ where: { action: 'AUTO_ROUTE_CREATED' } });
  assert.equal(audit.length, 1);
  test.route = r.body.route;
  test.pickup = p.body.pickupPoint;
});

test('driver signs up with the existing OTP flow, uploads private documents, registers an auto and is verified', async () => {
  const phone = '9123456780';
  const noProof = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Suresh Babu', phone, password: 'Driver123' });
  assert.equal(noProof.status, 400);
  assert.equal(noProof.body.code, 'PHONE_VERIFICATION_REQUIRED');
  await otpRow(phone, '482913');
  const wrong = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Suresh Babu', phone, password: 'Driver123', otp: '111111' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'OTP_INVALID');
  const weak = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Suresh Babu', phone, password: 'short', otp: '482913' });
  assert.equal(weak.body.code, 'WEAK_PASSWORD');
  const reg = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Suresh Babu', phone, password: 'Driver123', otp: '482913' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.driver.status, 'PENDING_DOCS');
  assert.ok(!('password' in reg.body.driver));
  const tok = reg.body.token;
  const dup = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Other', phone, password: 'Driver123', otp: '482913' });
  assert.equal(dup.status, 409);
  const login = await api('POST', '/api/auto-ride/driver/auth/login', null, { phone: `+91 ${phone}`, password: 'Driver123' });
  assert.equal(login.status, 200);

  // registrationToken path (POST /api/users/verify-otp issues it for numbers without an account).
  const jwt = require(require('path').join(__dirname, '..', '..', '..', 'node_modules/jsonwebtoken'));
  const rt = jwt.sign({ purpose: 'register', phone: '9123456781' }, `${process.env.JWT_SECRET}:phone-verified`, { expiresIn: '15m' });
  const reg2 = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Ramesh K', phone: '9123456781', password: 'Driver123', registrationToken: rt });
  assert.equal(reg2.status, 201);

  const ups = {};
  for (const k of ['photo', 'licenceFront', 'licenceBack', 'rc', 'permit', 'insurance', 'v1']) {
    const u = await api('POST', '/api/auto-ride/driver/media', tok, { image: png(k) });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    assert.equal(u.body.isPrivate, true);
    assert.match(u.body.previewUrl, /\/api\/campus\/media\/[0-9a-f-]{36}\?exp=\d+&sig=[0-9a-f]{32}$/);
    ups[k] = u.body.url;
  }
  const row = await H.ctx.M('CampusMedia').findByPk(ups.photo.split('/').pop());
  assert.equal(row.purpose, 'auto_driver_doc');
  assert.equal(row.isPrivate, true);
  const notPng = await api('POST', '/api/auto-ride/driver/media', tok, { image: `data:text/html;base64,${Buffer.from('<script>x</script>').toString('base64')}` });
  assert.ok(notPng.status >= 400);
  // Someone else's upload cannot be attached.
  const other = await api('POST', '/api/auto-ride/driver/media', reg2.body.token, { image: png('other') });
  const steal = await api('PUT', '/api/auto-ride/driver/me/documents', tok, { documents: { photo: other.body.url } });
  assert.equal(steal.status, 400);
  assert.equal(steal.body.code, 'INVALID_MEDIA');
  const aadhaar = await api('PUT', '/api/auto-ride/driver/me/documents', tok, { documents: { aadhaar: ups.photo } });
  assert.equal(aadhaar.status, 400, 'no Aadhaar slot');
  const docs = await api('PUT', '/api/auto-ride/driver/me/documents', tok, { documents: { photo: ups.photo, licenceFront: ups.licenceFront, licenceBack: ups.licenceBack } });
  assert.equal(docs.status, 200);
  assert.ok(docs.body.driver.documentPreviews.photo.includes('sig='));
  const early = await api('POST', '/api/auto-ride/driver/me/submit', tok);
  assert.equal(early.status, 409);
  assert.ok(early.body.missing.includes('licenceNumber') && early.body.missing.includes('vehicle'));
  assert.equal((await api('PATCH', '/api/auto-ride/driver/me/profile', tok, { licenceNumber: 'AP02 2019 0012345', licenceExpiresOn: '2031-05-01', emergencyContactName: 'Lakshmi', emergencyContactPhone: '9988776655', preferredRouteIds: [test.route.id] })).status, 200);
  const tooMany = await api('POST', '/api/auto-ride/driver/vehicles', tok, { registrationNumber: 'AP 07 TB 4321', rcSeatingCapacity: 3, requestedCapacity: 8 });
  assert.equal(tooMany.status, 400, 'requested capacity above RC seating refused');
  const badReg = await api('POST', '/api/auto-ride/driver/vehicles', tok, { registrationNumber: 'HELLO', rcSeatingCapacity: 3 });
  assert.equal(badReg.status, 400);
  const v = await api('POST', '/api/auto-ride/driver/vehicles', tok, {
    registrationNumber: 'AP 07 TB 4321', make: 'Piaggio', model: 'Ape City', fuel: 'cng', rcSeatingCapacity: 8, requestedCapacity: 8,
    permitNumber: 'AP/CC/2024/77', permitExpiresOn: '2030-03-31', insuranceExpiresOn: '2027-06-30',
    documents: { rc: ups.rc, permit: ups.permit, insurance: ups.insurance }, photos: [ups.v1],
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.vehicle.approvedCapacity, null, 'drivers never set the approved capacity');
  const clash = await api('POST', '/api/auto-ride/driver/vehicles', reg2.body.token, { registrationNumber: 'ap07tb4321', rcSeatingCapacity: 3 });
  assert.equal(clash.status, 409, 'one registration number on ZenWe');
  const sub = await api('POST', '/api/auto-ride/driver/me/submit', tok);
  assert.equal(sub.status, 200);
  assert.equal(sub.body.driver.status, 'PENDING_REVIEW');
  const online = await api('POST', '/api/auto-ride/driver/online', tok, { online: true });
  assert.equal(online.status, 403, 'cannot go online before verification');

  const q = await api('GET', '/api/admin/auto-ride/drivers', admin.token);
  assert.ok(q.body.drivers.some((d) => d.id === reg.body.driver.id));
  const det = await api('GET', `/api/admin/auto-ride/drivers/${reg.body.driver.id}`, admin.token);
  assert.ok(det.body.driver.documentPreviews.licenceFront.includes('sig='));
  const ver = await api('POST', `/api/admin/auto-ride/drivers/${reg.body.driver.id}/verify`, admin.token);
  assert.equal(ver.status, 200);
  assert.equal(ver.body.driver.status, 'VERIFIED');
  const vq = await api('GET', '/api/admin/auto-ride/vehicles', admin.token);
  const mine = vq.body.vehicles.find((x) => x.id === v.body.vehicle.id);
  assert.equal(mine.suggestedApprovedCapacity, 8, 'prefilled min(RC 8, platform max 8)');
  const over = await api('POST', `/api/admin/auto-ride/vehicles/${v.body.vehicle.id}/approve`, admin.token, { approvedCapacity: 9 });
  assert.equal(over.status, 400, 'approved capacity above RC / platform max refused');
  const ap = await api('POST', `/api/admin/auto-ride/vehicles/${v.body.vehicle.id}/approve`, admin.token, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.vehicle.approvedCapacity, 8);
  assert.deepEqual(ap.body.vehicle.seatLayout, { rows: [[1, 'D', 2], [3, 4, 5], [6, 7, 8]], maleOnlySeats: [1, 2] }, 'default 8-seat layout: 1 | driver | 2, then 3 4 5, 6 7 8 (seats 1 and 2 boys only)');
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: ['AUTO_DRIVER_VERIFIED', 'AUTO_VEHICLE_APPROVED'] } });
  assert.equal(logs.length, 2);
  const notes = await H.notificationsFor(reg.body.driver.id);
  assert.ok(notes.some((n) => n.type === 'AUTO_DRIVER_VERIFIED') && notes.some((n) => n.type === 'AUTO_VEHICLE_APPROVED'), 'driver in-app notifications');
  const dn = await api('GET', '/api/auto-ride/driver/notifications', tok);
  assert.ok(dn.body.notifications.length >= 2 && dn.body.unread >= 2);
  assert.equal((await api('POST', '/api/auto-ride/driver/online', tok, { online: true })).status, 200);

  // Publish: operating period + fare bounds enforced, capacity defaults to the approved 8.
  const base = { vehicleId: v.body.vehicle.id, routeId: test.route.id, pickupPointId: test.pickup.id, seatFare: 30 };
  const at = (hhmm) => new Date(`2026-10-20T${hhmm}:00+05:30`).toISOString();
  const night = await api('POST', '/api/auto-ride/driver/trips', tok, { ...base, departureAt: at('13:30') });
  assert.equal(night.status, 201);
  const p1 = await api('POST', `/api/auto-ride/driver/trips/${night.body.trip.id}/publish`, tok);
  assert.equal(p1.body.code, 'OUTSIDE_OPERATING_HOURS');
  const pricey = await api('POST', '/api/auto-ride/driver/trips', tok, { ...base, seatFare: 90, departureAt: at('10:30') });
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${pricey.body.trip.id}/publish`, tok)).body.code, 'FARE_OUT_OF_RANGE');
  const okTrip = await api('POST', '/api/auto-ride/driver/trips', tok, { ...base, departureAt: at('10:30') });
  const pub = await api('POST', `/api/auto-ride/driver/trips/${okTrip.body.trip.id}/publish`, tok);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.trip.capacity, 8);
  assert.equal(pub.body.trip.minSeatsToDepart, 4, 'route default minimum occupancy');
  assert.equal(pub.body.trip.periodKey, 'MORNING');
  assert.equal(pub.body.trip.queueNumber, 1);
  const second = await api('POST', `/api/auto-ride/driver/trips/${pricey.body.trip.id}/publish`, tok);
  assert.ok([400, 409].includes(second.status));
  const home = await api('GET', '/api/auto-ride/driver/home', tok);
  assert.equal(home.body.currentTrip.id, okTrip.body.trip.id);
  // Editing an auto with an active trip is refused.
  assert.equal((await api('PATCH', `/api/auto-ride/driver/vehicles/${v.body.vehicle.id}`, tok, { colour: 'Yellow' })).status, 409);
});

test('capacity rules at approval: RC 3 -> 3; RC 10 with platform max 8 -> 8; platform max lowered to 6 -> 6; custom layout validated', async () => {
  const mk = async (rc) => {
    const d = await H.mkDriver({ capacity: rc, vehicleStatus: 'PENDING_REVIEW' });
    await d.vehicle.update({ rcSeatingCapacity: rc, documents: { rc: '/api/campus/media/00000000-0000-4000-8000-000000000001', permit: '/api/campus/media/00000000-0000-4000-8000-000000000002', insurance: '/api/campus/media/00000000-0000-4000-8000-000000000003' } });
    return d;
  };
  const a = await mk(3);
  assert.equal((await api('POST', `/api/admin/auto-ride/vehicles/${a.vehicle.id}/approve`, admin.token, {})).body.vehicle.approvedCapacity, 3);
  const b = await mk(10);
  const rb = await api('POST', `/api/admin/auto-ride/vehicles/${b.vehicle.id}/approve`, admin.token, {});
  assert.equal(rb.body.vehicle.approvedCapacity, 8);
  const s = await api('PUT', '/api/admin/auto-ride/settings', admin.token, { platformMaxCapacity: 6 });
  assert.equal(s.body.platformMaxCapacity, 6);
  const c = await mk(8);
  assert.equal((await api('POST', `/api/admin/auto-ride/vehicles/${c.vehicle.id}/approve`, admin.token, { approvedCapacity: 7 })).status, 400);
  const badLayout = await api('POST', `/api/admin/auto-ride/vehicles/${c.vehicle.id}/approve`, admin.token, { approvedCapacity: 5, seatLayout: { rows: [['D', 1], [2, 3]] } });
  assert.equal(badLayout.body.code, 'INVALID_LAYOUT');
  const custom = await api('POST', `/api/admin/auto-ride/vehicles/${c.vehicle.id}/approve`, admin.token, { approvedCapacity: 5, seatLayout: { rows: [['D', null, 1], [2, 3, null], [4, 5]] } });
  assert.equal(custom.status, 200);
  assert.equal(custom.body.vehicle.approvedCapacity, 5);
  // The platform max also caps trips of autos approved earlier (b was approved for 8).
  await b.driver.update({ isOnline: true });
  const { route, pickup } = await H.mkRoute();
  const tr = await api('POST', '/api/auto-ride/driver/trips', b.token, { vehicleId: b.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + 60 * H.MIN).toISOString(), seatFare: 30 });
  assert.equal(tr.body.trip.capacity, 6);
  await api('PUT', '/api/admin/auto-ride/settings', admin.token, { platformMaxCapacity: 8 });
  // Expired insurance blocks publishing.
  await c.vehicle.reload();
  await c.vehicle.update({ insuranceExpiresOn: '2026-10-19' });
  await c.driver.update({ isOnline: true });
  const tc = await api('POST', '/api/auto-ride/driver/trips', c.token, { vehicleId: c.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + 60 * H.MIN).toISOString(), seatFare: 30 });
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${tc.body.trip.id}/publish`, c.token)).body.code, 'VEHICLE_PAPERS_EXPIRED');
});

test('admin: live summary counts, booking search by code, cancel with audit, incidents, trip history, queues', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const b = await H.book(t.trip.id, { seatCount: 3 });
  const sum = await api('GET', '/api/admin/auto-ride/summary', admin.token);
  assert.equal(sum.status, 200);
  assert.ok(sum.body.fullTrips >= 1 && sum.body.bookedSeats >= 3 && sum.body.onlineVerifiedDrivers >= 1);
  assert.equal(sum.body.enabled, true);
  const found = await api('GET', `/api/admin/auto-ride/bookings?code=${b.booking.bookingCode}`, admin.token);
  assert.equal(found.body.bookings.length, 1);
  assert.equal(found.body.bookings[0].passenger.phone, b.user.phone, 'admins see the passenger contact');
  const inc = await api('POST', `/api/auto-ride/bookings/${b.booking.id}/incident`, b.user.token, { category: 'OVERCHARGE', description: 'Asked for more than the fare' });
  assert.equal(inc.status, 201);
  const di = await api('POST', '/api/auto-ride/driver/incidents', t.token, { tripId: t.trip.id, category: 'SAFETY', description: 'Road blocked near the canal' });
  assert.equal(di.status, 201);
  const list = await api('GET', '/api/admin/auto-ride/incidents?status=ACTIVE', admin.token);
  assert.equal(list.body.incidents.length, 2);
  assert.equal((await api('POST', `/api/admin/auto-ride/incidents/${inc.body.incident.id}/status`, admin.token, { status: 'RESOLVED', note: 'Driver warned' })).status, 200);
  const c = await api('POST', `/api/admin/auto-ride/bookings/${b.booking.id}/cancel`, admin.token, { reason: 'Duplicate test booking' });
  assert.equal(c.status, 200);
  assert.equal(c.body.booking.status, 'CANCELLED');
  const td = await api('GET', `/api/admin/auto-ride/trips/${t.trip.id}`, admin.token);
  assert.equal(td.body.trip.status, 'OPEN_FOR_BOOKING', 'FULL -> OPEN after the admin cancel');
  assert.ok(td.body.events.length >= 4);
  const qs = await api('GET', '/api/admin/auto-ride/queues?date=2026-10-20', admin.token);
  assert.ok(qs.body.queue.some((x) => x.id === t.trip.id));
  const audit = await api('GET', `/api/admin/auto-ride/audit?targetId=${b.booking.id}`, admin.token);
  assert.equal(audit.body.entries[0].action, 'AUTO_BOOKING_CANCELLED');
  const fares = await api('GET', '/api/admin/auto-ride/fares', admin.token);
  assert.equal(fares.status, 200);
  const ct = await api('POST', `/api/admin/auto-ride/trips/${t.trip.id}/cancel`, admin.token, { reason: 'Road closed by police' });
  assert.equal(ct.status, 200);
  assert.equal(ct.body.trip.status, 'CANCELLED');
  const dn = await H.notificationsFor(t.driver.id);
  assert.ok(dn.some((n) => n.title === 'Trip cancelled by ZenWe'));
});

// 1 Nov 2026: a handed-over phone. The second driver's device token is taken off the first driver, so the first
// driver's pushes (private requests with fares) stop ringing on that phone. The first driver's other phones keep theirs.
test('device token: a second driver signing in on the same phone takes it off the first driver', async () => {
  const a = await H.mkDriver({ name: 'First Driver' });
  const b = await H.mkDriver({ name: 'Second Driver' });
  a.id = a.driver.id; b.id = b.driver.id;
  const shared = `fcm-shared-phone-${'x'.repeat(40)}`;
  const own = `fcm-own-phone-of-a-${'y'.repeat(40)}`;
  for (const t of [own, shared]) assert.equal((await api('POST', '/api/auto-ride/driver/fcm-token', a.token, { token: t })).status, 200);
  assert.equal((await api('POST', '/api/auto-ride/driver/fcm-token', b.token, { token: shared })).status, 200);
  const D = H.ctx.sequelize.models.AutoDriver;
  const ra = await D.findByPk(a.id);
  const rb = await D.findByPk(b.id);
  assert.deepEqual(ra.fcmTokens, [own], 'first driver keeps only their own phone');
  assert.ok(rb.fcmTokens.includes(shared), 'second driver has the shared phone');
});
