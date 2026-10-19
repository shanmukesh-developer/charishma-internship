// S1 quick fixes (Auto-Ride): prototype-safe trip actions, unsuspend restores the pre-suspension status,
// rider / store tokens are not customers, passenger no-show only after noShowGraceMinutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../modules/autoRide/tests/helpers');

const { api } = H;

test.before(async () => {
  await H.setup({ label: 's1-ar' });
  await H.setFlag(true);
  // rider + store accounts for the customer-gate check
  H.r('models/DeliveryPartner').initDeliveryPartnerModel(H.ctx.sequelize);
  H.r('models/Restaurant').initRestaurantModel(H.ctx.sequelize);
  await H.ctx.M('DeliveryPartner').sync();
  await H.ctx.M('Restaurant').sync();
});
test.after(() => H.teardown());

test('trip actions: prototype keys are unknown actions (404), not a crash', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  for (const a of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const r = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/${a}`, t.token, {});
    assert.equal(r.status, 404, a);
    assert.equal(r.body.code, 'UNKNOWN_ACTION', a);
  }
});

test('unsuspend restores exactly the status the suspension interrupted (never VERIFIED for a driver under review)', async () => {
  const admin = await H.mkAdmin();
  const cases = [['PENDING_REVIEW', 'PENDING_REVIEW'], ['VERIFIED', 'VERIFIED'], ['PENDING_DOCS', 'PENDING_DOCS']];
  for (const [before, after] of cases) {
    const d = await H.mkDriver({ status: before });
    // reviewedAt set (the old code restored VERIFIED whenever reviewedAt was set)
    await d.driver.update({ reviewedAt: new Date(), submittedAt: new Date() });
    const s = await api('POST', `/api/admin/auto-ride/drivers/${d.driver.id}/suspend`, admin.token, { reason: 'Document check' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const un = await api('POST', `/api/admin/auto-ride/drivers/${d.driver.id}/unsuspend`, admin.token, {});
    assert.equal(un.status, 200);
    assert.equal(un.body.driver.status, after, before);
    assert.equal((await H.ctx.M('AutoDriver').findByPk(d.driver.id)).statusBeforeSuspension, null);
  }
  // a row suspended before S1 (no record): re-reviewed, never silently VERIFIED
  const legacy = await H.mkDriver({ status: 'SUSPENDED' });
  await legacy.driver.update({ reviewedAt: new Date(), submittedAt: new Date(), statusBeforeSuspension: null });
  const un = await api('POST', `/api/admin/auto-ride/drivers/${legacy.driver.id}/unsuspend`, admin.token, {});
  assert.equal(un.body.driver.status, 'PENDING_REVIEW');
});

test('customer gate: rider and store tokens are refused (also on reads); students pass', async () => {
  const rider = await H.ctx.M('DeliveryPartner').create({ name: 'S1 rider', phone: H.nextPhone(), password: 'x-test-only-1', isApproved: true });
  const store = await H.ctx.M('Restaurant').create({ name: 'S1 store', location: 'x', phone: H.nextPhone(), password: 'x-test-only-2', isActive: true });
  const jwt = require(require('path').join(__dirname, '..', '..', 'node_modules/jsonwebtoken'));
  const rt = jwt.sign({ id: rider.id, role: 'rider', tv: 0 }, process.env.JWT_SECRET);
  const st = jwt.sign({ id: store.id, role: 'restaurant', tv: 0 }, process.env.JWT_SECRET);
  for (const [tok, who] of [[rt, 'rider'], [st, 'store']]) {
    for (const p of ['/api/auto-ride/trips', '/api/auto-ride/routes', '/api/auto-ride/bookings', '/api/auto-ride/status']) {
      const r = await api('GET', p, tok);
      assert.equal(r.status, 401, `${who} ${p} ${r.status}`);
    }
  }
  const u = await H.mkUser();
  assert.equal((await api('GET', '/api/auto-ride/trips', u.token)).status, 200);
});

test('passenger no-show: only after departure + noShowGraceMinutes', async () => {
  await H.r('modules/autoRide/services/flag').writeSettings({ noShowGraceMinutes: 10 });
  const t = await H.mkTrip({ capacity: 3, seatFare: 30, departInMin: 5, minSeatsToDepart: 1 });
  const b = await H.book(t.trip.id, { seatCount: 1 });
  assert.equal((await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, { ready: true })).status, 200);
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/start-boarding`, t.token, {});
  H.advance(6 * H.MIN); // 1 min after departure
  let r = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/bookings/${b.booking.id}/no-show`, t.token);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'TOO_EARLY');
  H.advance(8 * H.MIN); // 9 min after
  r = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/bookings/${b.booking.id}/no-show`, t.token);
  assert.equal(r.body.code, 'TOO_EARLY');
  H.advance(2 * H.MIN); // 11 min after
  r = await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/bookings/${b.booking.id}/no-show`, t.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.booking.status, 'NO_SHOW');
});
