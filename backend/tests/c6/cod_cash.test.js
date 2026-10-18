// Rider cash ledger, delivery side: a COD delivery writes exactly one COD_COLLECTED row in the same
// transaction as the Delivered flip (also under a double tap / parallel delivers and via support), prepaid
// orders write none, buy-at-store orders also record what the rider paid the shop, a failing cash write
// rolls the delivery back.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

test('COD delivery: one COD_COLLECTED row (+order total), cashHeldPaise and balanceAfter match', async () => {
  const { item } = await H.mkStore({ price: 120 });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const { order, res } = await H.fullDelivery({ item, user: u, rider: d });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const fp = H.toPaise(order.finalPrice);
  assert.ok(fp > 0);
  const rows = await H.cashRows(d.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'COD_COLLECTED');
  assert.equal(rows[0].amountPaise, fp);
  assert.equal(rows[0].balanceAfterPaise, fp);
  assert.equal(rows[0].orderId, order.id);
  assert.equal(rows[0].actorType, 'rider');
  assert.equal(await H.cashHeld(d.id), fp);
  // Rider replies never carry the commission / payout internals.
  for (const k of ['commissionRate', 'commissionAmountPaise', 'storeNetPaise', 'payoutId', 'riderPayoutId']) assert.ok(!(k in res.body), k);
  // A replay after the flip is the existing 409 and writes nothing.
  const pin = (await H.ctx.M('Order').findByPk(order.id)).deliveryPin;
  const again = await H.deliver(order.id, d, pin);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_DELIVERED');
  assert.equal((await H.cashRows(d.id)).length, 1);
});

test('double tap / 8 parallel delivers with the right PIN: exactly one 200, exactly one cash row', async () => {
  const { item } = await H.mkStore({ price: 99 });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  const pin = await H.toPickedUp(order.id, d);
  const rs = await Promise.all(Array.from({ length: 8 }, () => H.deliver(order.id, d, pin)));
  assert.equal(rs.filter((x) => x.status === 200).length, 1, rs.map((x) => `${x.status}:${x.body && x.body.code}`).join(','));
  // The losers get the existing replies: 409 ALREADY_DELIVERED / ORDER_CHANGED, or 429 while parallel PIN attempts are claimed.
  assert.ok(rs.filter((x) => x.status !== 200).every((x) => x.status === 409 || x.status === 429), rs.map((x) => x.status).join(','));
  const rows = await H.cashRows(d.id);
  assert.equal(rows.filter((x) => x.type === 'COD_COLLECTED').length, 1);
  assert.equal(await H.cashHeld(d.id), H.toPaise(order.finalPrice));
  assert.equal(await H.cashSum(d.id), await H.cashHeld(d.id));
});

test('prepaid (Wallet) delivery writes no cash row', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 1000 });
  const d = await H.mkRider();
  const { res } = await H.fullDelivery({ item, user: u, rider: d, method: 'Wallet' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await H.cashRows(d.id)).length, 0);
  assert.equal(await H.cashHeld(d.id), 0);
});

test('support marks a rider COD order delivered: one row (actor admin); rider replay adds nothing', async () => {
  const { item } = await H.mkStore({ price: 150 });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  const pin = await H.toPickedUp(order.id, d);
  const rs = await Promise.all([1, 2, 3].map(() => api('PUT', `/api/orders/${order.id}/status`, admin.token, { status: 'Delivered' })));
  assert.ok(rs.every((x) => x.status === 200), rs.map((x) => x.status).join(','));
  const rider = await H.deliver(order.id, d, pin);
  assert.equal(rider.status, 409);
  const rows = await H.cashRows(d.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'COD_COLLECTED');
  assert.equal(rows[0].actorType, 'admin');
  assert.equal(rows[0].amountPaise, H.toPaise(order.finalPrice));
});

test('buy-at-store COD order: COD_COLLECTED (+total) and STORE_PURCHASE (-subtotal paid at the counter)', async () => {
  const { item } = await H.mkStore({ price: 200, riderBuys: true });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const { order, res } = await H.fullDelivery({ item, user: u, rider: d });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const o = await H.ctx.M('Order').findByPk(order.id);
  assert.equal(o.storePaidByRider, true);
  const rows = await H.cashRows(d.id);
  assert.deepEqual(rows.map((x) => [x.type, x.amountPaise]), [['COD_COLLECTED', H.toPaise(o.finalPrice)], ['STORE_PURCHASE', -H.toPaise(o.totalPrice)]]);
  assert.equal(await H.cashHeld(d.id), H.toPaise(o.finalPrice) - H.toPaise(o.totalPrice));
});

test('cash write fails -> the delivery rolls back (order stays PickedUp, no row, nothing credited)', async () => {
  const { item } = await H.mkStore({ price: 80 });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  const pin = await H.toPickedUp(order.id, d);
  const rc = H.r('utils/riderCash');
  const orig = rc.recordCodDelivery;
  rc.recordCodDelivery = async () => { throw new Error('simulated ledger failure'); };
  let res;
  try { res = await H.deliver(order.id, d, pin); } finally { rc.recordCodDelivery = orig; }
  assert.equal(res.status, 500);
  const o = await H.ctx.M('Order').findByPk(order.id);
  assert.equal(o.status, 'PickedUp');
  assert.equal((await H.cashRows(d.id)).length, 0);
  assert.equal(Number((await H.ctx.M('DeliveryPartner').findByPk(d.id)).totalEarnings) || 0, 0);
  // Retry once the ledger works: delivered, one row.
  const ok = await H.deliver(order.id, d, pin);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await H.cashRows(d.id)).length, 1);
});

test('unique (orderId, type) index: a second COD_COLLECTED row for the same order cannot exist', async () => {
  const { item } = await H.mkStore({ price: 60 });
  const u = await H.mkUser();
  const d = await H.mkRider();
  const { order } = await H.fullDelivery({ item, user: u, rider: d });
  await assert.rejects(H.ctx.M('RiderCashEntry').create({ riderId: d.id, amountPaise: 100, balanceAfterPaise: 100, type: 'COD_COLLECTED', orderId: order.id }));
});
