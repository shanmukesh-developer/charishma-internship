// Store-accept timeout: an order the store never accepts is cancelled after STORE_ACCEPT_TIMEOUT_MIN
// (default 7, the older PENDING_ORDER_TIMEOUT_MINUTES still read), a Wallet payment comes back through
// the ledger, and the customer gets "The store didn't respond…" (push + in-app list). The rider timeout
// is unchanged. GET /api/orders/serviceability reports the window for the tracking screen.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { storeAcceptTimeoutMinutes } = H.r('utils/orderTimeouts');
const { autoCancelStalePendingOrders } = H.r('controllers/orderController');

const fakeIo = { to: () => ({ emit() {} }), emit() {} };
let saved;
before(async () => { await H.setup(); saved = { a: process.env.STORE_ACCEPT_TIMEOUT_MIN, b: process.env.PENDING_ORDER_TIMEOUT_MINUTES }; });
after(async () => {
  for (const [k, v] of [['STORE_ACCEPT_TIMEOUT_MIN', saved.a], ['PENDING_ORDER_TIMEOUT_MINUTES', saved.b]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await H.teardown();
});
beforeEach(() => { delete process.env.STORE_ACCEPT_TIMEOUT_MIN; delete process.env.PENDING_ORDER_TIMEOUT_MINUTES; });

const backdate = async (orderId, minutes) => {
  const Order = H.ctx.M('Order');
  const at = new Date(Date.now() - minutes * 60 * 1000);
  await H.ctx.sequelize.query(`UPDATE "${Order.getTableName()}" SET "createdAt" = ? WHERE id = ?`, { replacements: [at.toISOString().replace('T', ' ').replace('Z', ' +00:00'), orderId] });
};
const pushesFor = (orderId) => H.ctx.pushes.filter((p) => p.data && String(p.data.orderId) === String(orderId));

test('timeout setting: default 7, new env wins, legacy env still read, clamped to 3..60', () => {
  assert.equal(storeAcceptTimeoutMinutes({}), 7);
  assert.equal(storeAcceptTimeoutMinutes({ STORE_ACCEPT_TIMEOUT_MIN: '5' }), 5);
  assert.equal(storeAcceptTimeoutMinutes({ PENDING_ORDER_TIMEOUT_MINUTES: '15' }), 15);
  assert.equal(storeAcceptTimeoutMinutes({ STORE_ACCEPT_TIMEOUT_MIN: '9', PENDING_ORDER_TIMEOUT_MINUTES: '15' }), 9);
  assert.equal(storeAcceptTimeoutMinutes({ STORE_ACCEPT_TIMEOUT_MIN: '1' }), 3);
  assert.equal(storeAcceptTimeoutMinutes({ STORE_ACCEPT_TIMEOUT_MIN: '500' }), 60);
  assert.equal(storeAcceptTimeoutMinutes({ STORE_ACCEPT_TIMEOUT_MIN: 'abc' }), 7);
});

test('COD order the store ignores: kept at 6 min, cancelled after 7 min, "Nothing was charged."', async () => {
  const { item } = await H.mkStore({ price: 110 });
  const u = await H.mkUser();
  const order = await H.placeOrder({ item, user: u, method: 'COD' });
  assert.equal(order.status, 'Pending');
  await backdate(order.id, 6);
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Pending');
  await backdate(order.id, 8);
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Cancelled');
  const p = pushesFor(order.id).find((x) => /didn't respond/.test(x.body));
  assert.ok(p, JSON.stringify(pushesFor(order.id)));
  assert.equal(p.body, "The store didn't respond, so your order was cancelled. Nothing was charged.");
  assert.equal(p.title, "The store didn't respond");
});

test('Wallet order: refunded through the ledger and the message says so', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 500 });
  const order = await H.placeOrder({ item, user: u, method: 'Wallet' });
  const paid = Number(order.finalPrice);
  assert.ok(paid > 0);
  const afterPay = Number((await H.ctx.M('User').findByPk(u.id)).walletBalance);
  assert.ok(Math.abs(afterPay - (500 - paid)) < 0.01, `${afterPay} vs ${500 - paid}`);
  await backdate(order.id, 8);
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Cancelled');
  const balance = Number((await H.ctx.M('User').findByPk(u.id)).walletBalance);
  assert.ok(Math.abs(balance - 500) < 0.01, `balance ${balance}`);
  const rows = await H.ctx.M('WalletTransaction').findAll({ where: { ownerId: String(u.id) } });
  const refund = rows.find((t) => Number(t.amountPaise) > 0 && String(t.refId || '') === String(order.id));
  assert.ok(refund, JSON.stringify(rows.map((t) => [t.type, t.amountPaise, t.refId])));
  assert.equal(Number(refund.amountPaise), Math.round(paid * 100));
  const p = pushesFor(order.id).find((x) => /didn't respond/.test(x.body));
  assert.ok(p && /is back in your Wallet\.$/.test(p.body), p && p.body);
});

test('STORE_ACCEPT_TIMEOUT_MIN=10 keeps an 8-minute-old order; accepted orders are never store-timed out', async () => {
  process.env.STORE_ACCEPT_TIMEOUT_MIN = '10';
  const { item } = await H.mkStore({ price: 90 });
  const u = await H.mkUser();
  const order = await H.placeOrder({ item, user: u });
  await backdate(order.id, 8);
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Pending');
  // Accepted 12 minutes ago, within the 30-minute rider window: untouched.
  await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: new Date() }, { where: { id: order.id } });
  await backdate(order.id, 12);
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Accepted');
});

test('serviceability reports storeAcceptTimeoutMin (new key, old keys unchanged)', async () => {
  process.env.STORE_ACCEPT_TIMEOUT_MIN = '6';
  const u = await H.mkUser();
  const res = await H.api('GET', '/api/orders/serviceability', u.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.storeAcceptTimeoutMin, 6);
  assert.equal(typeof res.body.open, 'boolean');
  assert.deepEqual(res.body.paymentMethods, ['COD', 'Wallet']);
});
