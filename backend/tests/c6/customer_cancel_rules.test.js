// Customer self-cancel rules (owner, 5 Nov 2026). A store with a partner login: cancel any time until the store
// accepts (Pending), never after (no 2-minute grace any more). A buy-at-store shop (no partner login; the order
// starts Accepted and the rider buys at the counter): cancel until a delivery partner takes it. The order JSON's
// canCancel says the same as the server, so the app shows "Cancel order" exactly when it would work.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const ACCEPTED_MSG = "The restaurant has accepted your order, so it can't be cancelled now. Need help? Contact support from the order page.";
const cancel = (u, id) => H.api('PUT', `/api/orders/${id}/cancel`, u.token, {});
const getOrder = (u, id) => H.api('GET', `/api/orders/${id}`, u.token);

before(async () => { await H.setup(); });
after(H.teardown);

test('store with a login, Pending: canCancel true and the cancel works (Wallet refunded in full)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 500 });
  const order = await H.placeOrder({ item, user: u, method: 'Wallet' });
  assert.equal(order.status, 'Pending');
  const g = await getOrder(u, order.id);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.canCancel, true);
  // Still allowed long after placing (no timed window): placed 45 minutes ago.
  await H.ctx.M('Order').update({ createdAt: new Date(Date.now() - 45 * 60 * 1000) }, { where: { id: order.id }, silent: true });
  const c = await cancel(u, order.id);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Cancelled');
  assert.ok(Math.abs(Number((await H.ctx.M('User').findByPk(u.id)).walletBalance) - 500) < 0.01);
});

test('store with a login, accepted 30 seconds after placing: refused with the owner\'s message, canCancel false', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const order = await H.placeOrder({ item, user: u });
  await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: new Date() }, { where: { id: order.id } });
  const g = await getOrder(u, order.id);
  assert.equal(g.body.canCancel, false);
  const c = await cancel(u, order.id);
  assert.equal(c.status, 400, JSON.stringify(c.body));
  assert.equal(c.body.code, 'CANCEL_WINDOW_CLOSED');
  assert.equal(c.body.message, ACCEPTED_MSG);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Accepted');
  // The order list says the same.
  const list = await H.api('GET', '/api/orders/myorders', u.token);
  const row = (Array.isArray(list.body) ? list.body : (list.body.orders || [])).find((o) => String(o.id || o._id) === String(order.id));
  assert.ok(row, JSON.stringify(list.body).slice(0, 300));
  assert.equal(row.canCancel, false);
});

test('buy-at-store shop (no login), Accepted with no rider: canCancel true and the cancel works, even after 2 minutes', async () => {
  const { item } = await H.mkStore({ price: 100, riderBuys: true });
  const u = await H.mkUser();
  const order = await H.placeOrder({ item, user: u });
  const row = await H.ctx.M('Order').findByPk(order.id);
  assert.equal(row.status, 'Accepted');
  assert.equal(row.storePaidByRider, true);
  await H.ctx.M('Order').update({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }, { where: { id: order.id }, silent: true });
  assert.equal((await getOrder(u, order.id)).body.canCancel, true);
  const c = await cancel(u, order.id);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Cancelled');
});

test('buy-at-store shop with a rider on it: refused with the rider message, canCancel false', async () => {
  const { item } = await H.mkStore({ price: 100, riderBuys: true });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  await H.ctx.M('Order').update({ deliveryPartnerId: d.id }, { where: { id: order.id } });
  assert.equal((await getOrder(u, order.id)).body.canCancel, false);
  const c = await cancel(u, order.id);
  assert.equal(c.status, 400, JSON.stringify(c.body));
  assert.equal(c.body.code, 'CANCEL_WINDOW_CLOSED');
  assert.match(c.body.message, /delivery partner is already on this order/);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Accepted');
});

test('customerCancelRule: unit cases', () => {
  const { customerCancelRule } = H.r('controllers/orderController');
  assert.equal(customerCancelRule({ status: 'Pending' }).canCancel, true);
  assert.equal(customerCancelRule({ status: 'Accepted' }).canCancel, false);
  assert.equal(customerCancelRule({ status: 'Preparing' }).canCancel, false);
  assert.equal(customerCancelRule({ status: 'Accepted', storePaidByRider: true }).canCancel, true);
  assert.equal(customerCancelRule({ status: 'ReadyForPickup', storePaidByRider: true }).canCancel, true);
  assert.equal(customerCancelRule({ status: 'Accepted', storePaidByRider: true, deliveryPartnerId: 'x' }).canCancel, false);
  assert.equal(customerCancelRule({ status: 'PickedUp', storePaidByRider: true }).canCancel, false);
  assert.equal(customerCancelRule({ status: 'Cancelled' }).canCancel, false);
  assert.equal(customerCancelRule({ status: 'Delivered' }).canCancel, false);
});
