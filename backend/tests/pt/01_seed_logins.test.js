// The startup seed creates one ready-to-use test account per partner app, and each one signs in through its
// app's REAL auth route with the password whose bcrypt hash is in the data file (never hashed twice).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let seed;
let data;
let passwords;
let result;
let logins;

before(async () => {
  await H.setup();
  await H.mkAdmin();
  ({ data, passwords, dataPath: seed } = H.testDataFile());
  const { runPartnerTestAccountsSeed } = H.r('scripts/partner_test_accounts_seed');
  result = await runPartnerTestAccountsSeed({ dataPath: seed });
  logins = await H.loginAll(data, passwords);
});
after(H.teardown);

test('the seed creates all six accounts and records them in the marker', async () => {
  assert.deepEqual(result.skipped, {}, JSON.stringify(result.skipped));
  for (const k of H.ACCOUNT_KEYS) assert.ok(result.created[k], `${k} created`);
  assert.ok(result.created.pgOwner.hostelId, 'PG listing created and linked');
  const marker = await H.ctx.M.GlobalConfig.findOne({ where: { key: 'PARTNER_TEST_ACCOUNTS_V1_DONE' } });
  assert.ok(marker, 'marker written');
  assert.equal(marker.value.created.rider, result.created.rider, 'marker lists the created ids');
});

test('every account signs in through its app\'s real login route', async () => {
  for (const k of H.ACCOUNT_KEYS) {
    assert.equal(logins[k].status, 200, `${k}: ${JSON.stringify(logins[k].body)}`);
    assert.ok(logins[k].body.token, `${k}: token returned`);
  }
  assert.equal(logins.rider.body.isApproved, true, 'rider is approved');
  assert.equal(logins.rider.body.name, 'ZCS Test Rider');
  assert.equal(String(logins.restaurant.body.restaurant.vendorType).toUpperCase(), 'RESTAURANT');
  assert.equal(String(logins.vendorStall.body.restaurant.vendorType).toUpperCase(), 'LOCAL_VENDOR');
  assert.equal(String(logins.campusStall.body.restaurant.vendorType).toUpperCase(), 'LOCAL_VENDOR');
  assert.ok(!('password' in logins.restaurant.body.restaurant), 'no hash in the store reply');
  assert.equal(logins.autoDriver.body.driver.status, 'VERIFIED');
  assert.equal(logins.pgOwner.body.owner.mustChangePassword, false, 'no forced password change: the saved password keeps working');
});

test('stored passwords are the data file hashes (hooks bypassed, not hashed twice)', async () => {
  const M = H.ctx.M;
  assert.equal((await M.DeliveryPartner.findByPk(result.created.rider)).password, data.rider.passwordHash);
  assert.equal((await M.Restaurant.findByPk(result.created.restaurant.storeId)).password, data.restaurant.passwordHash);
  assert.equal((await M.AutoDriver.findByPk(result.created.autoDriver.driverId)).password, data.autoDriver.passwordHash);
  assert.equal((await M.PgOwner.findByPk(result.created.pgOwner.ownerId)).password, data.pgOwner.passwordHash);
});

test('wrong password and wrong app are still refused', async () => {
  assert.equal((await api('POST', '/api/delivery/login', null, { phone: data.rider.phone, password: 'Wrong1234x' })).status, 401);
  assert.equal((await api('POST', '/api/restaurants/login', null, { phone: data.restaurant.phone, password: 'Wrong1234x', app: 'restaurant' })).status, 401);
  assert.equal((await api('POST', '/api/auto-ride/driver/auth/login', null, { phone: data.autoDriver.phone, password: 'Wrong1234x' })).status, 401);
  assert.equal((await api('POST', '/api/pg-owner/auth/login', null, { phone: data.pgOwner.phone, password: 'Wrong1234x' })).status, 401);
  const restInVendor = await api('POST', '/api/restaurants/login', null, { phone: data.restaurant.phone, password: passwords.restaurant, app: 'vendor' });
  assert.equal(restInVendor.status, 403);
  assert.equal(restInVendor.body.code, 'NOT_A_VENDOR_ACCOUNT');
  const stallInRestaurant = await api('POST', '/api/restaurants/login', null, { id: data.vendorStall.phone, password: passwords.vendorStall, app: 'restaurant' });
  assert.equal(stallInRestaurant.status, 403);
  assert.equal(stallInRestaurant.body.code, 'USE_VENDOR_APP');
});

test('rider session works and the rider can take orders', async () => {
  const p = await api('GET', '/api/delivery/profile', logins.rider.body.token);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const row = await H.ctx.M.DeliveryPartner.findByPk(result.created.rider);
  assert.equal(row.isApproved, true);
  assert.equal(row.suspendedAt, null);
  assert.equal(row.isAvailable, true);
});

test('stores are live, open, have test items and their partner sessions work', async () => {
  for (const k of ['restaurant', 'vendorStall', 'campusStall']) {
    const { storeId, itemIds } = result.created[k];
    const tok = logins[k].body.token;
    const orders = await api('GET', `/api/restaurants/${storeId}/orders`, tok);
    assert.equal(orders.status, 200, `${k} orders: ${JSON.stringify(orders.body)}`);
    const menu = await api('GET', `/api/restaurants/${storeId}/menu`);
    assert.equal(menu.status, 200);
    assert.deepEqual(menu.body.map((m) => m.id || m._id).sort(), [...itemIds].sort(), `${k} menu has the test items`);
    const row = await H.ctx.M.Restaurant.findByPk(storeId);
    assert.equal(row.isActive, true);
    assert.equal(row.isOpenNow, true);
    assert.ok(row.publishedAt, 'publishedAt stamped (the create hook was bypassed)');
    assert.deepEqual(row.operatingHours, { start: '00:00', end: '00:00' }, 'open 24h');
  }
  const home = await api('GET', '/api/restaurants');
  assert.equal(home.status, 200);
  const homeRows = Array.isArray(home.body) ? home.body : (home.body.restaurants || home.body.data || []);
  assert.ok(homeRows.some((s) => (s.id || s._id) === result.created.restaurant.storeId), 'test restaurant listed for customers');
  const stalls = await api('GET', '/api/restaurants/local-vendors');
  assert.equal(stalls.status, 200);
  const stallRows = Array.isArray(stalls.body) ? stalls.body : (stalls.body.vendors || stalls.body.data || []);
  for (const k of ['vendorStall', 'campusStall']) {
    assert.ok(stallRows.some((s) => (s.id || s._id) === result.created[k].storeId), `${k} listed as a local vendor stall`);
  }
});

test('campus stall: In-Campus Booking is left off with no UPI ID (the owner sets a real UPI first)', async () => {
  const row = await H.ctx.M.Restaurant.findByPk(result.created.campusStall.storeId);
  assert.notEqual(row.campusBookingEnabled, true);
  assert.equal(row.campusUpiId ?? null, null);
});

test('auto driver is verified with an approved test auto', async () => {
  const tok = logins.autoDriver.body.token;
  const me = await api('GET', '/api/auto-ride/driver/me', tok);
  assert.equal(me.status, 200, JSON.stringify(me.body));
  const vs = await api('GET', '/api/auto-ride/driver/vehicles', tok);
  assert.equal(vs.status, 200, JSON.stringify(vs.body));
  const list = vs.body.vehicles || vs.body;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'APPROVED');
  assert.equal(list[0].approvedCapacity, 8);
  const v = await H.ctx.M.AutoVehicle.findByPk(result.created.autoDriver.vehicleId);
  assert.equal(v.registrationNumber, 'AP00TST0105');
  assert.match(v.registrationNumber, H.r('modules/autoRide/services/util').REG_RE,'plate passes the RC rule, so admin / driver edits keep working');
});

test('PG owner session works (no forced password change) and owns the test listing', async () => {
  const me = await api('GET', '/api/pg-owner/me', logins.pgOwner.body.token);
  assert.equal(me.status, 200, JSON.stringify(me.body));
  const names = (me.body.owner.listings || []).map((l) => l.name);
  assert.deepEqual(names, ['ZCS Test PG']);
  const pg = await H.ctx.M.PGHostel.findByPk(result.created.pgOwner.hostelId);
  assert.equal(pg.isActive, true);
  assert.equal(pg.isVerified, false, 'no invented site visit');
  assert.equal(await H.ctx.M.PGRoom.count({ where: { hostelId: pg.id, isActive: true } }), 1);
});

test('a second boot does nothing (marker)', async () => {
  const before = await H.ctx.M.Restaurant.count();
  const again = await H.r('scripts/partner_test_accounts_seed').runPartnerTestAccountsSeed({ dataPath: seed });
  assert.deepEqual(again, { skipped: 'already done' });
  assert.equal(await H.ctx.M.Restaurant.count(), before);
  assert.equal(await H.ctx.M.DeliveryPartner.count(), 1);
});
