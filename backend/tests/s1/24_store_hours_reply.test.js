// Saving opening hours (PUT /api/restaurants/:id/hours) answers with the store fields the ZCS Restaurant / Vendor apps
// show, not only the open state: the apps merge the reply over the store they hold and fill a missing field with a
// default, which hid the Offline / Paused-by-ZCS banner and blanked the store name until the next refresh (31 Oct 2026).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

test('the hours reply carries name, location, delivery time and the offline / active flags', async () => {
  const store = await H.mkStore();
  await store.update({ isOffline: true, deliveryTime: 35 });
  const r = await H.api('PUT', `/api/restaurants/${store.id}/hours`, store.token, { operatingHours: { start: '09:00', end: '21:00' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.name, store.name);
  assert.strictEqual(r.body.location, store.location);
  assert.strictEqual(Number(r.body.deliveryTime), 35);
  assert.strictEqual(r.body.isOffline, true, 'the Offline banner stays');
  assert.strictEqual(r.body.isActive, true);
  assert.ok(r.body.operatingHours, 'hours saved');
});
