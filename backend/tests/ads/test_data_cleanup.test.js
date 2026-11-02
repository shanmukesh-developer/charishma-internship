// scripts/test_data_cleanup_v1.js (owner, 1 Nov 2026: "remove all test data, only keep the entered data"): the "ZCS
// Test" stores go with their test orders (open ones cancelled first), a renamed one and every owner store / order stay;
// the 27 Oct partner test logins go (deleted when nothing points at them, else switched off: rider deactivated, PG
// listing hidden and its owner suspended); real riders are untouched; it runs once.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let ctx;
before(async () => {
  ctx = await H.setup();
  const s = ctx.sequelize;
  H.r('models/Order').initOrderModel(s);
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(s);
  H.r('models/DeliveryPartner').initDeliveryPartnerModel(s);
  H.r('models/RiderCashEntry').initRiderCashEntryModel(s);
  H.r('models/PGHostel').initPGHostelModel(s);
  H.r('models/PGRoom').initPGRoomModel(s);
  H.r('models/PGBooking').initPGBookingModel(s);
  H.r('modules/autoRide').initAutoRideModels(s);
  H.r('modules/pgOwner').initPgOwnerModels(s);
  await s.sync();
});
after(() => H.teardown());

test('every test store, test order and partner test login goes; the owner data stays; runs once', async () => {
  const { runTestDataCleanup } = H.r('scripts/test_data_cleanup_v1');
  const M = (n) => ctx.sequelize.models[n];
  await M('GlobalConfig').create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });

  // The owner's real data.
  const pickles = await H.mkStore({ name: 'AVR Pickles', vendorType: 'GROCERY' });
  await H.mkItem(pickles.id, { name: 'Tomato' });
  const nescafe = await H.mkStore({ name: 'Nescafe', vendorType: 'LOCAL_VENDOR', campusBookingEnabled: true });
  const amrutham = await H.mkStore({ name: 'Amrutham Restaurant' });
  // Test data: the six stores the 1 Nov test data seed made (ledger kind test-store; the seed itself was removed on
  // 3 Nov with the rest of the mock data), one renamed by the owner, and a 27 Oct partner test store.
  for (const name of ['ZCS Test Kitchen', 'ZCS Test Cafe', 'ZCS Test Bakery', 'ZCS Test Mart', 'ZCS Test Stationery', 'ZCS Test Chai Stall']) {
    const st = await H.mkStore({ name });
    await H.mkItem(st.id, { name: `${name} item` });
    await M('CatalogueImportLedger').create({ importKey: `test-data:v1:${name}`, kind: 'test-store', targetId: st.id, storeKey: 'test-data:v1', name });
  }
  await M('Restaurant').update({ name: 'Campus Stationery Point' }, { where: { name: 'ZCS Test Stationery' } });
  const oldTest = await H.mkStore({ name: 'ZCS Test Restaurant', phone: '6000000102' });
  await H.mkItem(oldTest.id);

  const user = await H.mkUser();
  const base = { userId: user.id, items: [{ name: 'x', price: 100, quantity: 1 }], totalPrice: 100, finalPrice: 100, deliveryFee: 0, paymentMethod: 'COD' };
  const kitchen = await M('Restaurant').findOne({ where: { name: 'ZCS Test Kitchen' } });
  const cafe = await M('Restaurant').findOne({ where: { name: 'ZCS Test Cafe' } });
  await M('Order').create({ ...base, restaurantId: kitchen.id, status: 'Delivered' });
  const openTest = await M('Order').create({ ...base, restaurantId: cafe.id, status: 'Pending' });
  const ownerOrder = await M('Order').create({ ...base, restaurantId: pickles.id, status: 'Pending' });

  // Partner test logins (as scripts/partner_test_accounts_seed made them) and a real rider.
  const testRider = await M('DeliveryPartner').create({ name: 'ZCS Test Rider', phone: '6000000101', password: 'x-test-only-1', isApproved: true });
  await M('RiderCashEntry').create({ riderId: testRider.id, amountPaise: 10000, balanceAfterPaise: 10000, type: 'collected' });
  const realRider = await M('DeliveryPartner').create({ name: 'Ravi', phone: '9000000777', password: 'x-test-only-2', isApproved: true });
  const driver = await M('AutoDriver').create({ name: 'ZCS Test Auto Driver', phone: '6000000105', password: 'x', status: 'VERIFIED' });
  await M('AutoVehicle').create({ driverId: driver.id, registrationNumber: 'AP07ZT0001', status: 'APPROVED' });
  const pgOwner = await M('PgOwner').create({ name: 'ZCS Test PG Owner', phone: '6000000106', password: 'x', status: 'ACTIVE' });
  const admin = await H.mkUser({ role: 'admin' });
  const pg = await M('PGHostel').create({ ownerId: admin.id, name: 'ZCS Test PG', address: 'Test', distanceFromCollege: 1, baseRent: 1000, isActive: true });
  const room = await M('PGRoom').create({ hostelId: pg.id, roomNumber: 'T1', sharingType: 2, pricePerBed: 1000, totalBeds: 2, availableBeds: 2 });
  await M('PgOwnerListing').create({ ownerId: pgOwner.id, hostelId: pg.id });
  await M('PGBooking').create({ userId: user.id, hostelId: pg.id, roomId: room.id, checkInDate: '2026-11-10' });
  await M('GlobalConfig').create({ key: 'PARTNER_TEST_ACCOUNTS_V1_DONE', value: { created: { rider: testRider.id, autoDriver: { driverId: driver.id }, pgOwner: { ownerId: pgOwner.id, hostelId: pg.id } } } });

  const r = await runTestDataCleanup();
  assert.deepStrictEqual([r.stores, r.kept, r.ordersCancelled, r.orders], [6, 1, 1, 2], JSON.stringify(r));
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.accounts, {
    'rider ZCS Test Rider': 'switched off',
    'auto driver ZCS Test Auto Driver': 'deleted',
    'pg ZCS Test PG': 'hidden',
    'pg owner ZCS Test PG Owner': 'suspended',
  });

  // Stores: only the owner's (and the renamed one) are left.
  const names = (await M('Restaurant').findAll({ attributes: ['name'] })).map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['AVR Pickles', 'Amrutham Restaurant', 'Campus Stationery Point', 'Nescafe']);
  assert.strictEqual(await M('MenuItem').count({ where: { restaurantId: [kitchen.id, cafe.id, oldTest.id] } }), 0);
  assert.strictEqual(await M('MenuItem').count({ where: { restaurantId: pickles.id } }), 1);
  assert.strictEqual(await M('Order').count({ where: { restaurantId: [kitchen.id, cafe.id] } }), 0, 'test orders gone');
  assert.strictEqual(await M('Order').findByPk(openTest.id), null);
  assert.strictEqual((await M('Order').findByPk(ownerOrder.id)).status, 'Pending', "the owner's order is untouched");
  for (const s of [pickles, nescafe, amrutham]) assert.strictEqual((await M('Restaurant').findByPk(s.id)).isActive, true);

  // Logins: the test rider can no longer sign in, the real rider is untouched; the auto is gone; the booked PG is hidden.
  const tr = await M('DeliveryPartner').findByPk(testRider.id);
  assert.strictEqual(tr.isApproved, false);
  assert.ok(tr.suspendedAt, 'login refused (C1-7)');
  assert.strictEqual((await M('DeliveryPartner').findByPk(realRider.id)).isApproved, true);
  assert.strictEqual(await M('AutoDriver').findByPk(driver.id), null);
  assert.strictEqual(await M('AutoVehicle').count({ where: { driverId: driver.id } }), 0);
  assert.strictEqual((await M('PGHostel').findByPk(pg.id)).isActive, false, 'a booked test PG is hidden, its booking kept');
  assert.strictEqual(await M('PGBooking').count({ where: { hostelId: pg.id } }), 1);
  assert.strictEqual((await M('PgOwner').findByPk(pgOwner.id)).status, 'SUSPENDED');

  assert.deepStrictEqual(await runTestDataCleanup(), { skipped: 'already done' });
});
