// Revenue page support (owner feedback, 6 Nov 2026): fields the reworked admin page needs to explain the numbers in
// plain words, without changing any money figure.
//   - noRider: a rider order marked Delivered with no rider on it (e.g. completed from the admin status control) has
//     rider pay 0, so its delivery fee stays with ZenWe; it is counted and listed. Every money total is unchanged and
//     the report still balances exactly.
//   - the settle preview's pending statements carry the store's payout UPI ID (null when not set).
//   - POST /settle and /settle/mark-paid honour an Idempotency-Key: the same key replays the first answer
//     (duplicate: true) instead of running again; a refused request (4xx) is not remembered.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');

const { api } = H;
const DAY = 24 * 60 * 60 * 1000;
let admin;
let rider;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  rider = await H.mkRider();
});
after(H.teardown);

const ist = (local) => new Date(`${local}:00+05:30`);

// The live 6 Nov case: ₹1,090 of items at 10%, ₹19 delivery + ₹4 platform fee, free delivery from 200+ ZenWe Points
// (₹19) + a Bronze member ₹5 order discount, no rider on the order -> customer paid ₹1,089, ZenWe keeps ₹108
// (109 + 19 + 4 - 24). Rider or not, ZenWe keeps the same: delivery fees are ZenWe income (owner, 6 Nov 2026).
const mkOrder = async ({ store, user, items, delivery = 19, platform = 4, discounts = [], withRider = true, at, method = 'COD' }) => {
  const { snapshotFields } = H.r('utils/commission');
  const totalDiscount = discounts.reduce((s, d) => s + d.amount, 0);
  const finalPrice = Math.round((items + delivery + platform - totalDiscount) * 100) / 100;
  return H.ctx.M('Order').create({
    userId: user.id, restaurantId: store.id, items: [], totalPrice: items, deliveryFee: delivery, platformFee: platform, finalPrice,
    priceBreakdown: { subtotal: items, deliveryFee: delivery, platformFee: platform, packagingFee: 0, taxes: 0, discounts, totalDiscount, finalPrice, couponCode: null },
    paymentMethod: method, paymentStatus: 'Completed', status: 'Delivered', fulfilment: 'ZENVY',
    deliveryPartnerId: withRider ? rider.id : null, deliveredAt: at, ...snapshotFields(store, items),
  });
};

test('an order delivered with no rider: counted and listed, totals unchanged and balanced', async () => {
  const at = ist('2026-08-06T13:00');
  const u = await H.mkUser();
  const { store } = await H.mkStore({ rate: 10 });
  const o = await mkOrder({
    store, user: u, items: 1090, withRider: false, at,
    discounts: [{ type: 'perk_delivery', label: '200+ ZenWe Points: free delivery', amount: 19 }, { type: 'perk_order', label: 'Bronze member: order discount', amount: 5 }],
  });
  const r = await api('GET', '/api/admin/revenue?period=day&date=2026-08-06', admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.totals;
  assert.equal(t.collectedPaise, 108900);
  assert.equal(t.itemsPaise, 109000);
  assert.equal(t.commissionPaise, 10900);
  assert.equal(t.storeSharePaise, 98100);
  assert.equal(t.owedPaise, 98100);
  assert.equal(t.discounts.perks, 2400);
  assert.equal(t.keepsPaise, 10800); // 109 + 19 + 4 - 24
  assert.equal(t.noRiderOrders, 1);
  assert.equal(r.body.noRider.orders, 1);
  assert.equal(r.body.noRider.sample[0].orderId, o.id);
  assert.equal(r.body.noRider.sample[0].channel, 'cod');
  assert.equal(r.body.reconciliation.ok, true);
  assert.equal(r.body.stores[0].noRiderOrders, 1);

  // With a rider the order is not counted, and ZenWe still keeps its whole delivery fee: 10 + 19 + 4.
  await mkOrder({ store, user: u, items: 100, at });
  const r2 = await api('GET', '/api/admin/revenue?period=day&date=2026-08-06', admin.token);
  assert.equal(r2.body.totals.noRiderOrders, 1);
  assert.equal(r2.body.totals.keepsPaise, 10800 + 1000 + 1900 + 400);
  assert.equal(r2.body.reconciliation.ok, true);
});

test('pending statements carry the UPI ID; settle and mark paid replay on the same Idempotency-Key', async () => {
  const u = await H.mkUser();
  const old = new Date(Date.now() - 3 * DAY);
  const { store: A } = await H.mkStore({ rate: 10 });
  const { store: B } = await H.mkStore({ rate: 10 });
  await A.update({ settlementCycle: 'daily', payoutUpiId: 'astore@upi' });
  await B.update({ settlementCycle: 'daily', payoutUpiId: null });
  await mkOrder({ store: A, user: u, items: 200, at: old });
  await mkOrder({ store: B, user: u, items: 300, at: old });

  const p = await api('GET', '/api/admin/revenue/settle/preview?cycle=daily', admin.token);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const expected = p.body.stores.filter((s) => [A.id, B.id].includes(s.storeId)).map((s) => ({ storeId: s.storeId, orderCount: s.orderCount, netPaise: s.netPaise }));
  assert.equal(expected.length, 2);
  const body = { cycle: 'daily', cutoff: p.body.cutoff, planHash: p.body.planHash, expected };

  // A refused request with a key is not remembered.
  const bad = await api('POST', '/api/admin/revenue/settle', admin.token, { ...body, cutoff: undefined }, { 'Idempotency-Key': 'settle-key-0001' });
  assert.equal(bad.status, 400);
  const first = await api('POST', '/api/admin/revenue/settle', admin.token, body, { 'Idempotency-Key': 'settle-key-0001' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.created.length, 2);
  const replay = await api('POST', '/api/admin/revenue/settle', admin.token, body, { 'Idempotency-Key': 'settle-key-0001' });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.duplicate, true);
  assert.deepEqual(replay.body.created.map((x) => x.id).sort(), first.body.created.map((x) => x.id).sort());
  assert.equal(await H.ctx.M('Payout').count({ where: { partnerId: A.id } }), 1);

  const p2 = await api('GET', '/api/admin/revenue/settle/preview?cycle=daily', admin.token);
  const pa = p2.body.pendingStatements.find((x) => x.partnerId === A.id);
  const pb = p2.body.pendingStatements.find((x) => x.partnerId === B.id);
  assert.equal(pa.payoutUpiId, 'astore@upi');
  assert.equal(pb.payoutUpiId, null);

  const items = [{ payoutId: pa.id, utr: 'UTR777000111', method: 'upi' }];
  const m1 = await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items }, { 'Idempotency-Key': 'markpaid-key-01' });
  assert.equal(m1.status, 200, JSON.stringify(m1.body));
  assert.equal(m1.body.paid.length, 1);
  const m2 = await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items }, { 'Idempotency-Key': 'markpaid-key-01' });
  assert.equal(m2.body.duplicate, true);
  assert.equal(m2.body.paid.length, 1);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'PAYOUT_MARKED_PAID', targetId: A.id } }), 1);
});
