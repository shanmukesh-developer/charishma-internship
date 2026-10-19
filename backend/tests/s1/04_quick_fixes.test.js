// S1 quick fixes (core API): store click dedupe, services driverDetails bounded shape, rider public profile
// hides the vehicle number from non-order viewers, localhost CORS origins only outside production.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

test('POST /api/restaurants/:id/click counts once per viewer per day (by account, else IP)', async () => {
  const store = await H.mkStore();
  const u = await H.mkUser();
  const count = async () => (await H.ctx.M.Restaurant.findByPk(store.id)).clickCount || 0;
  const base = await count();
  for (let i = 0; i < 5; i++) await H.api('POST', `/api/restaurants/${store.id}/click`, null);
  assert.strictEqual(await count(), base + 1, 'anonymous: once per IP');
  for (let i = 0; i < 3; i++) await H.api('POST', `/api/restaurants/${store.id}/click`, u.token);
  assert.strictEqual(await count(), base + 2, 'signed in: once per account');
  const r = await H.api('POST', `/api/restaurants/${store.id}/click`, u.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.counted, false);
  // another store still counts
  const other = await H.mkStore();
  await H.api('POST', `/api/restaurants/${other.id}/click`, u.token);
  assert.strictEqual((await H.ctx.M.Restaurant.findByPk(other.id)).clickCount, 1);
  assert.strictEqual((await H.api('POST', '/api/restaurants/not-a-uuid/click', null)).status, 404);
});

test('PATCH /api/services/:id/status keeps only a bounded driverDetails shape', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const cust = await H.mkUser();
  const b = await H.ctx.M.ServiceBooking.create({ userId: cust.id, serviceType: 'LAUNDRY', title: 'Laundry', status: 'REQUESTED' });
  const r = await H.api('PATCH', `/api/services/${b.id}/status`, admin.token, {
    status: 'CONFIRMED',
    driverDetails: { name: `  Ravi <b>${'x'.repeat(200)}`, phone: '+91 98765-43210', vehicleNumber: 'AP39AB1234', eta: '10 min', evil: { deep: 'x'.repeat(5000) }, __proto__: { polluted: true }, isAdmin: true },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const row = await H.ctx.M.ServiceBooking.findByPk(b.id);
  const dd = typeof row.driverDetails === 'string' ? JSON.parse(row.driverDetails) : row.driverDetails;
  assert.deepStrictEqual(Object.keys(dd).sort(), ['eta', 'name', 'phone', 'vehicleNumber']);
  assert.ok(dd.name.length <= 60 && !dd.name.includes('<'));
  assert.strictEqual(dd.phone, '+919876543210');
  assert.strictEqual(({}).polluted, undefined);
});

test('GET /api/delivery/profile/:id/public: vehicle number only for the rider, admins and customers it delivers to', async () => {
  const rider = await H.mkRider();
  const other = await H.mkRider();
  const cust = await H.mkUser();
  const stranger = await H.mkUser();
  const admin = await H.mkUser({ role: 'admin' });
  const store = await H.mkStore();
  const get = (tok) => H.api('GET', `/api/delivery/profile/${rider.id}/public`, tok);
  let r = await get(stranger.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.vehicleNumber, undefined);
  assert.ok(r.body.name && r.body.vehicleType, 'card fields kept');
  assert.strictEqual((await get(other.token)).body.vehicleNumber, undefined, 'another rider');
  assert.strictEqual((await get(store.token)).body.vehicleNumber, undefined, 'a store');
  assert.strictEqual((await get(rider.token)).body.vehicleNumber, rider.vehicleNumber, 'the rider');
  assert.strictEqual((await get(admin.token)).body.vehicleNumber, rider.vehicleNumber, 'admin');
  await H.ctx.M.Order.create({ userId: cust.id, restaurantId: store.id, deliveryPartnerId: rider.id, items: [], totalPrice: 100, deliveryFee: 10, finalPrice: 110, status: 'PickedUp', paymentMethod: 'COD' }).catch(async (e) => {
    throw new Error(`order seed failed: ${e.message}`);
  });
  assert.strictEqual((await get(cust.token)).body.vehicleNumber, rider.vehicleNumber, 'customer of an order this rider delivers');
});

test('CORS: localhost origins only outside production (ALLOW_LOCAL_ORIGINS=1 escape hatch)', () => {
  const o = H.r('utils/origins');
  const silent = { warn: () => {} };
  const dev = o.makeOriginChecker({}, { log: silent });
  assert.strictEqual(dev('http://localhost:3004'), true);
  assert.strictEqual(dev('http://127.0.0.1:3000'), true);
  for (const prodEnv of [{ NODE_ENV: 'production' }, { RENDER: 'true' }]) {
    const prod = o.makeOriginChecker(prodEnv, { log: silent });
    assert.strictEqual(prod('http://localhost:3004'), false);
    assert.strictEqual(prod('http://localhost:3000'), false, 'listed LOCAL_ORIGINS dropped too');
    assert.strictEqual(prod('http://app.localhost'), false);
    assert.strictEqual(prod('https://hostelbites-admin-iyoy.onrender.com'), true);
    assert.strictEqual(prod(undefined), true, 'native apps (no Origin) unaffected');
    assert.ok(!o.allowedOrigins(prodEnv).some((x) => x.includes('localhost')));
  }
  const hatch = o.makeOriginChecker({ NODE_ENV: 'production', ALLOW_LOCAL_ORIGINS: '1' }, { log: silent });
  assert.strictEqual(hatch('http://localhost:3004'), true);
});
