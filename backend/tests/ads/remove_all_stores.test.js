// scripts/remove_all_stores_v1: backup tables first, open orders cancelled, ads removed, stores without orders
// deleted (with items), stores with order history hidden, marker written, imports told to stop, runs once.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let ctx;
before(async () => {
  ctx = await H.setup();
  H.r('models/Order').initOrderModel(ctx.sequelize);
  await ctx.M('Order').sync();
});
after(() => H.teardown());

test('every store leaves: backup, cancel, delete or hide, marker, once only', async () => {
  const user = await H.mkUser();
  const empty = await H.mkStore({ name: 'No Orders Kitchen' });
  const past = await H.mkStore({ name: 'Past Orders Kitchen' });
  const live = await H.mkStore({ name: 'Open Order Kitchen' });
  await H.mkItem(empty.id); await H.mkItem(past.id); await H.mkItem(live.id);
  await ctx.M('SplashAd').create(H.adBody(empty));
  const Order = ctx.M('Order');
  const base = { userId: user.id, items: [{ name: 'x', price: 100, quantity: 1 }], totalPrice: 100, finalPrice: 100, deliveryFee: 0, paymentMethod: 'COD' };
  await Order.create({ ...base, restaurantId: past.id, status: 'Delivered' });
  const openOrder = await Order.create({ ...base, restaurantId: live.id, status: 'Pending' });

  const { runRemoveAllStores, realDataOnly } = H.r('scripts/remove_all_stores_v1');
  assert.strictEqual(await realDataOnly(), false);
  const r = await runRemoveAllStores();
  assert.strictEqual(r.stores, 3, JSON.stringify(r));
  assert.strictEqual(r.deleted, 1);
  assert.strictEqual(r.hidden, 2);
  assert.strictEqual(r.adsDeleted, 1);
  assert.strictEqual(r.ordersCancelled, 1);
  assert.deepStrictEqual(r.failed, []);
  assert.ok(r.backups.find((b) => b.table === '_zcs_backup_restaurants_20261028' && b.rows === 3));
  assert.ok(r.backups.find((b) => b.table === '_zcs_backup_menuitems_20261028' && b.rows === 3));

  assert.strictEqual(await ctx.M('Restaurant').findByPk(empty.id), null, 'store without orders deleted');
  assert.strictEqual(await ctx.M('MenuItem').count({ where: { restaurantId: empty.id } }), 0);
  for (const s of [past, live]) {
    const row = await ctx.M('Restaurant').findByPk(s.id);
    assert.strictEqual(row.isActive, false, 'store with orders hidden');
    assert.strictEqual(await ctx.M('MenuItem').count({ where: { restaurantId: s.id, isAvailable: true } }), 0);
  }
  assert.strictEqual((await Order.findByPk(openOrder.id)).status, 'Cancelled');
  assert.strictEqual(await Order.count(), 2, 'order history kept');

  assert.strictEqual(await realDataOnly(), true, 'imports now skip');
  assert.deepStrictEqual(await runRemoveAllStores(), { skipped: 'already done' });
});

test('v2 full clean: hidden stores, their test orders, items and the backup tables go', async () => {
  const { runRemoveAllStoresV2 } = H.r('scripts/remove_all_stores_v2');
  const r = await runRemoveAllStoresV2();
  assert.strictEqual(r.stores, 2, JSON.stringify(r));
  assert.strictEqual(r.orders, 2);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(await ctx.M('Restaurant').count(), 0);
  assert.strictEqual(await ctx.M('MenuItem').count(), 0);
  assert.strictEqual(await ctx.M('Order').count(), 0);
  const [tables] = await ctx.sequelize.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_zcs_backup_%'");
  assert.strictEqual(tables.length, 0, 'backup tables dropped');
  assert.deepStrictEqual(await runRemoveAllStoresV2(), { skipped: 'already done' });
});
