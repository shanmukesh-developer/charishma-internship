// C9: Zenvy Auto Driver in-app account deletion (/api/auto-ride/driver/account/*).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const BASE = '/api/auto-ride/driver/account';

const mkRouteAndVehicle = async (driver) => {
  const M = H.ctx.M;
  const route = await M('AutoRoute').create({ name: `C9 route ${driver.id.slice(0, 4)}`, originLabel: 'Gate', destinationLabel: 'Town', seatFareMin: 10, seatFareMax: 50, isActive: true }).catch((e) => { throw new Error(`route: ${e.message}`); });
  const pickup = await M('AutoPickupPoint').create({ routeId: route.id, name: 'Main gate', sequence: 1, isActive: true });
  const vehicle = await M('AutoVehicle').create({
    driverId: driver.id, registrationNumber: `AP39C9${String(Date.now()).slice(-4)}`, status: 'APPROVED', approvedCapacity: 3,
    documents: { rc: '/api/campus/media/00000000-0000-4000-8000-000000000001' }, photos: ['/api/campus/media/00000000-0000-4000-8000-000000000002'],
  });
  return { route, pickup, vehicle };
};

const mkTrip = (driver, v, status) => H.ctx.M('AutoTrip').create({
  driverId: driver.id, vehicleId: v.vehicle.id, routeId: v.route.id, pickupPointId: v.pickup.id, departureAt: new Date(Date.now() + 3600e3), status, capacity: 3, seatFare: 20,
});

test('only an Auto Driver session; rider / customer tokens refused', async () => {
  assert.strictEqual((await H.api('GET', `${BASE}/deletion-check`)).status, 401);
  const rider = await H.mkRider();
  assert.strictEqual((await H.api('GET', `${BASE}/deletion-check`, rider.token)).status, 401);
  const u = await H.mkUser();
  assert.strictEqual((await H.api('POST', `${BASE}/delete`, u.token, { confirm: 'DELETE', password: 'x' })).status, 401);
});

test('a published trip or an open full-auto request blocks deletion', async () => {
  const d = await H.mkDriver();
  const v = await mkRouteAndVehicle(d);
  const trip = await mkTrip(d, v, 'OPEN_FOR_BOOKING');
  let r = await H.api('GET', `${BASE}/deletion-check`, d.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.canDelete, false);
  assert.strictEqual(r.body.blockers[0].code, 'ACTIVE_TRIPS');
  r = await H.api('POST', `${BASE}/delete`, d.token, { confirm: 'DELETE', password: H.DRIVER_PW });
  assert.strictEqual(r.status, 409);
  await trip.update({ status: 'COMPLETED' });
  r = await H.api('GET', `${BASE}/deletion-check`, d.token);
  assert.strictEqual(r.body.canDelete, true);
});

test('wrong password refused; DELETE confirm required', async () => {
  const d = await H.mkDriver();
  let r = await H.api('POST', `${BASE}/delete`, d.token, { password: H.DRIVER_PW });
  assert.strictEqual(r.body.code, 'CONFIRM_REQUIRED');
  r = await H.api('POST', `${BASE}/delete`, d.token, { confirm: 'DELETE', password: 'nope12345' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'WRONG_PASSWORD');
});

test('delete: driver anonymised + suspended, documents / media / drafts gone, trips + vehicle record kept, sessions revoked, audited', async () => {
  const M = H.ctx.M;
  const d = await H.mkDriver({ fcmTokens: ['t1'], documents: { photo: '/api/campus/media/00000000-0000-4000-8000-000000000003' } });
  const oldPhone = d.phone;
  const v = await mkRouteAndVehicle(d);
  const done = await mkTrip(d, v, 'COMPLETED');
  const draft = await mkTrip(d, v, 'DRAFT');
  const media = await M('CampusMedia').create({ ownerId: d.id, purpose: 'auto_driver_doc', mime: 'image/png', size: 4, sha256: 'y'.repeat(64), isPrivate: true, bytes: Buffer.from([1, 2, 3, 4]) });
  await M('Notification').create({ userId: d.id, title: 'New booking', body: 'x', type: 'autoride' });

  const r = await H.api('POST', `${BASE}/delete`, d.token, { confirm: 'DELETE', password: H.DRIVER_PW });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

  const row = await M('AutoDriver').findByPk(d.id);
  assert.strictEqual(row.name, 'Deleted driver');
  assert.notStrictEqual(row.phone, oldPhone);
  assert.ok(row.phone.length <= 16);
  assert.strictEqual(row.status, 'SUSPENDED');
  for (const f of ['emergencyContactName', 'emergencyContactPhone', 'licenceNumber', 'badgeNumber']) assert.strictEqual(row[f], null, f);
  assert.deepStrictEqual(row.documents, {});
  assert.deepStrictEqual(row.fcmTokens, []);
  assert.strictEqual(row.tokenVersion, 1);

  const veh = await M('AutoVehicle').findByPk(v.vehicle.id);
  assert.ok(veh, 'vehicle record kept');
  assert.strictEqual(veh.status, 'SUSPENDED');
  assert.deepStrictEqual(veh.documents, {});
  assert.deepStrictEqual(veh.photos, []);
  assert.ok(await M('AutoTrip').findByPk(done.id), 'completed trip kept');
  assert.strictEqual(await M('AutoTrip').findByPk(draft.id), null, 'draft deleted');
  assert.strictEqual(await M('CampusMedia').findByPk(media.id), null);
  assert.strictEqual(await M('Notification').count({ where: { userId: d.id } }), 0);

  // old session + login refused
  const me = await H.api('GET', '/api/auto-ride/driver/me', d.token);
  assert.strictEqual(me.status, 401);
  const login = await H.api('POST', '/api/auto-ride/driver/auth/login', null, { phone: oldPhone, password: H.DRIVER_PW });
  assert.strictEqual(login.status, 401);
  const log = await M('VerificationLog').findOne({ where: { targetId: d.id, action: 'AUTO_DRIVER_ACCOUNT_DELETED' } });
  assert.ok(log);
  assert.ok(!String(log.details).includes(oldPhone));
});

test('SMS code path works for drivers (purpose delete_partner_account)', async () => {
  const d = await H.mkDriver();
  let r = await H.api('POST', `${BASE}/delete-otp`, d.token);
  assert.strictEqual(r.status, 502, 'reaches the real sender (no SMS key in tests)');
  await H.seedOtp(d.phone, 'delete_partner_account', '777888');
  r = await H.api('POST', `${BASE}/delete`, d.token, { confirm: 'DELETE', otp: '777888' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
});
