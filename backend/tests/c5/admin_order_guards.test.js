// Admin order tools (29 Oct 2026 admin audit):
//  • assigning a rider uses the riders' own limits: all jobs together (3), the COD cash limit, and an off-duty
//    rider only after support confirms (allowOffline);
//  • a rider order cannot be marked picked up without a rider (it left the pool with nobody carrying it);
//  • the admin order list carries the rider (name, phone) for "where is my order" calls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let admin;
before(async () => { await H.setup(); admin = await H.mkUser({ role: 'admin' }); });
after(H.teardown);

const acceptedOrder = async (store, item) => {
  const u = await H.mkUser();
  const r = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD'));
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const id = r.body.id || r.body._id || (r.body.order && r.body.order.id);
  await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: new Date() }, { where: { id } });
  return id;
};
const assign = (orderId, riderId, extra = {}) => H.api('PUT', `/api/admin/orders/${orderId}/rider`, admin.token, { riderId, ...extra });

test('an off-duty rider is assigned only after support confirms', async () => {
  const { store, item } = await H.mkStore({ riderBuys: true });
  const rider = await H.mkRider();
  await rider.update({ isOnline: false });
  const id = await acceptedOrder(store, item);
  let r = await assign(id, rider.id);
  assert.deepEqual([r.status, r.body.code], [409, 'RIDER_OFFLINE']);
  r = await assign(id, rider.id, { allowOffline: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('a rider already carrying 3 jobs cannot be given a 4th', async () => {
  const { store, item } = await H.mkStore({ riderBuys: true });
  const rider = await H.mkRider();
  for (let i = 0; i < 3; i++) {
    const id = await acceptedOrder(store, item);
    assert.equal((await assign(id, rider.id)).status, 200);
  }
  const fourth = await acceptedOrder(store, item);
  const r = await assign(fourth, rider.id);
  assert.deepEqual([r.status, r.body.code], [409, 'MAX_ACTIVE']);
  assert.match(r.body.message, /3 orders/);
});

test('no "picked up" without a rider; the order list shows the rider', async () => {
  const { store, item } = await H.mkStore({ riderBuys: true });
  const id = await acceptedOrder(store, item);
  let r = await H.api('PUT', `/api/orders/${id}/status`, admin.token, { status: 'PickedUp' });
  assert.deepEqual([r.status, r.body.code], [409, 'NO_RIDER']);

  const rider = await H.mkRider();
  assert.equal((await assign(id, rider.id)).status, 200);
  r = await H.api('GET', '/api/orders?limit=100', admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const row = (r.body.orders || []).find((o) => o.id === id || o._id === id);
  assert.ok(row, 'the order is listed');
  assert.equal(row.deliveryPartner && row.deliveryPartner.name, rider.name);
  assert.equal(row.deliveryPartner && row.deliveryPartner.phone, rider.phone);
});
