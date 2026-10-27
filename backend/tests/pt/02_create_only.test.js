// Create-only: an account whose phone (or a store whose name) is already taken is skipped and never edited, the
// others are still created; without an admin user the PG owner is created but no listing (PGHostel.ownerId).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let data;
let passwords;
let result;
let existingRider;
let existingStore;

before(async () => {
  await H.setup();
  let dataPath;
  ({ data, passwords, dataPath } = H.testDataFile());
  // A real rider already uses the test rider's phone; a real store already has the test restaurant's name.
  existingRider = await H.ctx.M.DeliveryPartner.create({ name: 'Real Rider', phone: data.rider.phone, password: 'real-rider-pw-1', isApproved: false });
  existingStore = await H.ctx.M.Restaurant.create({ name: 'zcs test restaurant', location: 'Somewhere', password: 'real-store-pw-1', isActive: false });
  result = await H.r('scripts/partner_test_accounts_seed').runPartnerTestAccountsSeed({ dataPath });
});
after(H.teardown);

test('taken phone / name are skipped and the existing rows are untouched', async () => {
  assert.match(result.skipped.rider, /phone/);
  assert.match(result.skipped.restaurant, /name/);
  const rider = await H.ctx.M.DeliveryPartner.findByPk(existingRider.id);
  assert.equal(rider.name, 'Real Rider');
  assert.equal(rider.isApproved, false);
  assert.equal(await rider.comparePassword('real-rider-pw-1'), true, 'password unchanged');
  const store = await H.ctx.M.Restaurant.findByPk(existingStore.id);
  assert.equal(store.isActive, false);
  assert.equal(await store.comparePassword('real-store-pw-1'), true);
  assert.equal(await H.ctx.M.DeliveryPartner.count(), 1);
});

test('the other accounts are still created and sign in', async () => {
  for (const k of ['vendorStall', 'campusStall', 'autoDriver', 'pgOwner']) assert.ok(result.created[k], `${k} created`);
  const logins = await H.loginAll(data, passwords);
  for (const k of ['vendorStall', 'campusStall', 'autoDriver', 'pgOwner']) assert.equal(logins[k].status, 200, `${k}: ${JSON.stringify(logins[k].body)}`);
  assert.equal(logins.rider.status, 401, 'the real rider keeps its own password');
});

test('no admin user: the PG owner is created without a listing (and says so)', async () => {
  assert.ok(result.created.pgOwner.ownerId);
  assert.equal(result.created.pgOwner.hostelId, undefined);
  assert.match(result.skipped.pgListing, /admin/);
  assert.equal(await H.ctx.M.PGHostel.count(), 0);
});
