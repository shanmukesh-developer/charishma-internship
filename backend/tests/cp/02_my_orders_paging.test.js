// GET /api/orders/myorders: ?before= pages past the newest 50, ?limit= caps the page, ?q= finds an order by
// store name or dish name. No parameters = the newest 50, as before.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

let u; let other; let storeA; let storeB; let otherOrderId;
before(async () => {
  await H.setup();
  u = await H.mkUser();
  other = await H.mkUser();
  storeA = (await H.mkStore({ price: 100 })).store;
  storeB = (await H.mkStore({ price: 100 })).store;
  await H.ctx.M('Restaurant').update({ name: 'Paradise Biryani Point' }, { where: { id: storeB.id } });
  const Order = H.ctx.M('Order');
  const t0 = Date.parse('2026-09-01T06:00:00Z');
  for (let i = 0; i < 60; i += 1) {
    const isOld = i < 5; // the 5 oldest come from store B with a distinct dish
    await Order.create({
      userId: u.id,
      restaurantId: isOld ? storeB.id : storeA.id,
      items: [{ name: isOld ? 'Chicken Dum Biryani' : 'Veg Thali', quantity: 1, price: 100 }],
      totalPrice: 100, deliveryFee: 10, finalPrice: 110, status: 'Delivered', paymentMethod: 'COD',
      createdAt: new Date(t0 + i * 3600 * 1000), updatedAt: new Date(t0 + i * 3600 * 1000),
    }, { silent: true });
  }
  otherOrderId = (await Order.create({ userId: other.id, restaurantId: storeB.id, items: [{ name: 'Chicken Dum Biryani', quantity: 1, price: 100 }], totalPrice: 100, deliveryFee: 10, finalPrice: 110, status: 'Delivered', paymentMethod: 'COD' })).id;
});
after(H.teardown);

const get = (url) => H.api('GET', url, u.token);

test('no parameters: the newest 50, newest first (unchanged)', async () => {
  const r = await get('/api/orders/myorders');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body.length, 50);
  assert.ok(new Date(r.body[0].createdAt) > new Date(r.body[49].createdAt));
});

test('?before= the oldest createdAt returns the next (older) page; ?limit= caps it', async () => {
  const first = (await get('/api/orders/myorders')).body;
  const oldest = first[first.length - 1].createdAt;
  const next = await get(`/api/orders/myorders?before=${encodeURIComponent(oldest)}`);
  assert.equal(next.status, 200);
  assert.equal(next.body.length, 10);
  const ids = new Set(first.map((o) => o.id));
  assert.ok(next.body.every((o) => !ids.has(o.id)), 'no overlap with the first page');
  assert.ok(next.body.every((o) => new Date(o.createdAt) < new Date(oldest)));
  const small = await get('/api/orders/myorders?limit=7');
  assert.equal(small.body.length, 7);
  const big = await get('/api/orders/myorders?limit=500');
  assert.equal(big.body.length, 50);
  const bad = await get('/api/orders/myorders?before=not-a-date');
  assert.equal(bad.body.length, 50);
});

test('?q= finds orders by store name and by dish name, only the caller\'s own', async () => {
  const byStore = await get('/api/orders/myorders?q=paradise');
  assert.equal(byStore.status, 200);
  assert.equal(byStore.body.length, 5);
  assert.ok(byStore.body.every((o) => o.id !== otherOrderId), 'never another customer order');
  const byDish = await get('/api/orders/myorders?q=DUM%20biryani');
  assert.equal(byDish.body.length, 5);
  const none = await get('/api/orders/myorders?q=pizza');
  assert.equal(none.body.length, 0);
  const wild = await get('/api/orders/myorders?q=%25%25');
  assert.equal(wild.body.length, 50, 'a wildcard-only search is ignored');
});
