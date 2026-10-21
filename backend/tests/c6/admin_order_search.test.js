// Admin global search: GET /api/admin/orders?q= finds an order by its full id or by the short
// reference (#A1B2C3 = last characters of the id), combines with other filters, rejects anything that
// is not hex, and stays admin-only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
let customer;
let orderA;
let orderB;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  customer = await H.mkUser();
  const { store } = await H.mkStore();
  const mk = (status) => H.ctx.M('Order').create({
    userId: customer.id, restaurantId: store.id, items: [], totalPrice: 100, deliveryFee: 30, finalPrice: 130,
    paymentMethod: 'COD', paymentStatus: 'Pending', status,
  });
  orderA = await mk('Pending');
  orderB = await mk('Delivered');
});
after(H.teardown);

const search = (q, extra = '') => api('GET', `/api/admin/orders?q=${encodeURIComponent(q)}${extra}`, admin.token);

test('full id returns exactly that order', async () => {
  const r = await search(orderA.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.orders.map((o) => o.id), [orderA.id]);
  assert.equal(r.body.total, 1);
});

test('short reference (#XXXXXX, any case) matches the id suffix', async () => {
  const short = `#${orderB.id.slice(-6).toUpperCase()}`;
  const r = await search(short);
  assert.equal(r.status, 200);
  assert.ok(r.body.orders.some((o) => o.id === orderB.id));
  assert.ok(r.body.orders.every((o) => o.id.endsWith(orderB.id.slice(-6))));
});

test('combines with the status filter', async () => {
  const r = await search(orderB.id.slice(-8), '&status=Pending');
  assert.equal(r.status, 200);
  assert.ok(!r.body.orders.some((o) => o.id === orderB.id));
});

test('non-hex or too short input matches nothing (no wildcard injection)', async () => {
  for (const q of ['%', '_', 'abc', 'zzzzzz', "1' OR '1'='1"]) {
    const r = await search(q);
    assert.equal(r.status, 200, q);
    assert.equal(r.body.orders.length, 0, q);
  }
});

test('without q the list is unchanged; customers cannot use the admin search', async () => {
  const all = await api('GET', '/api/admin/orders', admin.token);
  assert.equal(all.status, 200);
  assert.ok(all.body.orders.length >= 2);
  const denied = await api('GET', `/api/admin/orders?q=${orderA.id}`, customer.token);
  assert.ok(denied.status === 401 || denied.status === 403, String(denied.status));
});

test('userId filter returns only that customer\'s orders; a malformed id matches nothing', async () => {
  const other = await H.mkUser();
  const { store } = await H.mkStore();
  await H.ctx.M('Order').create({ userId: other.id, restaurantId: store.id, items: [], totalPrice: 50, deliveryFee: 30, finalPrice: 80, paymentMethod: 'COD', paymentStatus: 'Pending', status: 'Pending' });
  const mine = await api('GET', `/api/admin/orders?userId=${customer.id}`, admin.token);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.orders.length >= 2);
  assert.ok(mine.body.orders.every((o) => o.userId === customer.id));
  const bad = await api('GET', '/api/admin/orders?userId=not-a-uuid', admin.token);
  assert.equal(bad.body.orders.length, 0);
});
