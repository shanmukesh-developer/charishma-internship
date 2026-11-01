// scripts/test_data_seed.js removeTestData (owner switch REMOVE_TEST_DATA=true): only the stores the test data seed
// created leave; open orders on them are cancelled through the normal cancel path, a test store with order history
// is hidden (items unavailable) so its orders keep their store, the others are deleted with their items; an owner
// store is never touched; the seed does not run while removal is requested and never re-creates a removed store.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let ctx;
before(async () => {
  ctx = await H.setup();
  H.r('models/Order').initOrderModel(ctx.sequelize);
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('Order').sync();
  await ctx.M('CatalogueImportLedger').sync();
});
after(() => { delete process.env.REMOVE_TEST_DATA; return H.teardown(); });

test('REMOVE_TEST_DATA=true removes only the test stores: cancel open orders, hide stores with orders, delete the rest', async () => {
  delete process.env.REMOVE_TEST_DATA;
  const { runTestDataSeed, removeTestData, MARKER } = H.r('scripts/test_data_seed');
  await ctx.M('GlobalConfig').create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });
  const own = await H.mkStore({ name: 'Owner Real Kitchen' });
  await H.mkItem(own.id);
  const seeded = await runTestDataSeed();
  assert.strictEqual(seeded.storesCreated, 6, JSON.stringify(seeded));

  const Order = ctx.M('Order');
  const user = await H.mkUser();
  const kitchen = await ctx.M('Restaurant').findOne({ where: { name: 'ZCS Test Kitchen' } });
  const cafe = await ctx.M('Restaurant').findOne({ where: { name: 'ZCS Test Cafe' } });
  const base = { userId: user.id, items: [{ name: 'x', price: 100, quantity: 1 }], totalPrice: 100, finalPrice: 100, deliveryFee: 0, paymentMethod: 'COD' };
  await Order.create({ ...base, restaurantId: kitchen.id, status: 'Delivered' });
  const openOrder = await Order.create({ ...base, restaurantId: cafe.id, status: 'Pending' });
  const ownOrder = await Order.create({ ...base, restaurantId: own.id, status: 'Pending' });

  assert.deepStrictEqual(await removeTestData(), { skipped: 'not requested' }, 'off unless the owner sets the switch');
  assert.strictEqual(await ctx.M('Restaurant').count(), 7);

  process.env.REMOVE_TEST_DATA = 'true';
  const r = await removeTestData();
  assert.deepStrictEqual(r, { stores: 6, ordersCancelled: 1, deleted: 4, hidden: 2, failed: [] });
  for (const s of [kitchen, cafe]) {
    const row = await ctx.M('Restaurant').findByPk(s.id);
    assert.strictEqual(row.isActive, false, `${s.name} hidden, its orders keep their store`);
    assert.strictEqual(await ctx.M('MenuItem').count({ where: { restaurantId: s.id, isAvailable: true } }), 0);
  }
  assert.strictEqual(await ctx.M('Restaurant').count({ where: { name: ['ZCS Test Bakery', 'ZCS Test Mart', 'ZCS Test Stationery', 'ZCS Test Chai Stall'] } }), 0, 'stores without orders deleted');
  assert.strictEqual((await Order.findByPk(openOrder.id)).status, 'Cancelled', 'open test order cancelled');
  assert.strictEqual((await Order.findByPk(ownOrder.id)).status, 'Pending', "the owner's order is untouched");
  const ownRow = await ctx.M('Restaurant').findByPk(own.id);
  assert.strictEqual(ownRow.isActive, true, "the owner's store is untouched");
  assert.strictEqual(await ctx.M('MenuItem').count({ where: { restaurantId: own.id, isAvailable: true } }), 1);

  // While the switch is on the seed never runs, and without its marker it still never re-creates a removed store.
  await ctx.M('GlobalConfig').destroy({ where: { key: MARKER } });
  assert.deepStrictEqual(await runTestDataSeed(), { skipped: 'removal requested' });
  delete process.env.REMOVE_TEST_DATA;
  const again = await runTestDataSeed();
  assert.strictEqual(again.storesCreated, 0, JSON.stringify(again));
  assert.strictEqual(again.itemsCreated, 0);
  assert.strictEqual(await ctx.M('Restaurant').count({ where: { isActive: true } }), 1, 'only the owner store is live');

  // Idempotent: a second start with the switch on changes nothing.
  process.env.REMOVE_TEST_DATA = 'true';
  const second = await removeTestData();
  assert.deepStrictEqual(second, { stores: 2, ordersCancelled: 0, deleted: 0, hidden: 2, failed: [] });
});
