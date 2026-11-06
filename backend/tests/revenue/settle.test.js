// Settle all (POST /api/admin/revenue/settle): one PENDING statement per store of the chosen cycle, covering its
// delivered, not-yet-settled orders up to the cutoff (never later orders, never test stores, never stores on
// another cycle); idempotent (a second run creates nothing); two parallel runs create exactly one statement per
// store; numbers changed since the preview -> that store is not settled. Mark all paid needs one reference per
// statement and is idempotent. The settlement cycle is changed from the store form or the Revenue page, audited.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');

const { api } = H;
const DAY = 24 * 60 * 60 * 1000;
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

const delivered = async ({ store, user, total, at, fulfilment = 'ZENVY', method = 'COD' }) => {
  const { snapshotFields } = H.r('utils/commission');
  const fee = fulfilment === 'VENDOR' ? 0 : 19;
  const pf = fulfilment === 'VENDOR' ? 0 : 4;
  return H.ctx.M('Order').create({
    userId: user.id, restaurantId: store.id, items: [], totalPrice: total, deliveryFee: fee, platformFee: pf, finalPrice: total + fee + pf,
    priceBreakdown: { subtotal: total, deliveryFee: fee, platformFee: pf, packagingFee: 0, taxes: 0, discounts: [], totalDiscount: 0, finalPrice: total + fee + pf },
    paymentMethod: method, paymentStatus: 'Completed', status: 'Delivered', deliveredAt: at, fulfilment, ...snapshotFields(store, total),
  });
};
const preview = (cycle) => api('GET', `/api/admin/revenue/settle/preview?cycle=${cycle}`, admin.token);
const settle = (p, storeIds, extra = {}) => api('POST', '/api/admin/revenue/settle', admin.token, {
  cycle: p.cycle, cutoff: p.cutoff, planHash: p.planHash,
  expected: p.stores.filter((s) => storeIds.includes(s.storeId)).map((s) => ({ storeId: s.storeId, orderCount: s.orderCount, netPaise: s.netPaise })),
  ...extra,
});

test('settle all (weekly): one statement per store up to last Sunday; idempotent; stall net negative; mark all paid', async () => {
  const u = await H.mkUser();
  const old = new Date(Date.now() - 10 * DAY);
  const { store: A } = await H.mkStore({ rate: 10 });
  const { store: S } = await H.mkStore({ rate: 10, vendorType: 'LOCAL_VENDOR' });
  const { store: D } = await H.mkStore({ rate: 10 });
  const { store: T } = await H.mkStore({ rate: 10 });
  await D.update({ settlementCycle: 'daily' });
  await A.update({ payoutUpiId: 'storea@okaxis' }); // Mark paid needs somewhere to send the money (UPI or bank)
  await T.update({ isTestData: true });
  const a1 = await delivered({ store: A, user: u, total: 200, at: old });
  const a2 = await delivered({ store: A, user: u, total: 100, at: old });
  const aNew = await delivered({ store: A, user: u, total: 50, at: new Date(Date.now() - 60000) }); // this week: not yet
  await delivered({ store: S, user: u, total: 80, at: old, fulfilment: 'VENDOR' });
  await delivered({ store: D, user: u, total: 70, at: old });
  await delivered({ store: T, user: u, total: 90, at: old });

  const p = await preview('weekly');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const cut = H.r('utils/revenueReport').settlementCutoff('weekly');
  assert.equal(p.body.cutoff, cut.cutoff.toISOString());
  const rowA = p.body.stores.find((s) => s.storeId === A.id);
  const rowS = p.body.stores.find((s) => s.storeId === S.id);
  assert.equal(rowA.orderCount, 2);
  assert.equal(rowA.grossPaise, 30000);
  assert.equal(rowA.commissionPaise, 3000);
  assert.equal(rowA.netPaise, 27000);
  assert.equal(rowS.kind, 'vendor');
  assert.equal(rowS.netPaise, 7200 - 8000); // the stall took ₹80 cash: it owes ZenWe ₹8
  assert.equal(rowS.direction, 'store_pays_zenwe');
  assert.equal(p.body.stores.find((s) => s.storeId === D.id), undefined); // daily store
  assert.equal(p.body.stores.find((s) => s.storeId === T.id), undefined); // test store
  assert.ok(p.body.testStoresSkipped >= 1);

  // Validation: cutoff required, a different cutoff is refused, empty plan refused.
  assert.equal((await settle(p.body, [A.id], { cutoff: undefined })).status, 400);
  assert.equal((await settle(p.body, [A.id], { cutoff: new Date(Date.now() - 3 * DAY).toISOString() })).body.code, 'CUTOFF_CHANGED');
  assert.equal((await settle(p.body, [])).status, 400);
  // The admin saw different numbers for A: not settled.
  const stale = await api('POST', '/api/admin/revenue/settle', admin.token, { cycle: 'weekly', cutoff: p.body.cutoff, expected: [{ storeId: A.id, orderCount: 2, netPaise: 26999 }] });
  assert.equal(stale.status, 200, JSON.stringify(stale.body));
  assert.equal(stale.body.created.length, 0);
  assert.equal(stale.body.changed.length, 1);

  const r = await settle(p.body, [A.id, S.id]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.created.length, 2);
  const payA = r.body.created.find((x) => x.partnerId === A.id);
  assert.equal(payA.status, 'PENDING');
  assert.equal(payA.netPaise, 27000);
  assert.equal(payA.orderCount, 2);
  assert.equal((await H.ctx.M('Order').findByPk(a1.id)).payoutId, payA.id);
  assert.equal((await H.ctx.M('Order').findByPk(a2.id)).payoutId, payA.id);
  assert.equal((await H.ctx.M('Order').findByPk(aNew.id)).payoutId, null); // after the cutoff
  const payS = r.body.created.find((x) => x.partnerId === S.id);
  assert.equal(payS.partnerType, 'vendor');
  assert.equal(payS.netPaise, -800);

  // Running it again creates nothing.
  const again = await settle(p.body, [A.id, S.id]);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.created.length, 0);
  assert.equal(again.body.alreadySettled.length, 2);
  assert.equal(await H.ctx.M('Payout').count({ where: { partnerId: A.id } }), 1);
  const p2 = await preview('weekly');
  assert.equal(p2.body.stores.find((s) => s.storeId === A.id), undefined);
  assert.ok(p2.body.pendingStatements.some((x) => x.id === payA.id));

  // Audited.
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'REVENUE_SETTLE_ALL' }, raw: true });
  assert.ok(logs.length >= 1);
  assert.ok((await H.ctx.M('VerificationLog').count({ where: { action: 'PAYOUT_STATEMENT_CREATED', targetId: A.id } })) === 1);

  // Mark all paid: a reference per statement; a short one is refused for that statement only.
  const mp = await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items: [{ payoutId: payA.id, utr: 'UPI123456789', method: 'upi' }, { payoutId: payS.id, utr: 'x' }] });
  assert.equal(mp.status, 200, JSON.stringify(mp.body));
  assert.equal(mp.body.paid.length, 1);
  assert.equal(mp.body.failed.length, 1);
  assert.equal(mp.body.failed[0].code, 'UTR_REQUIRED');
  assert.equal((await H.ctx.M('Order').findByPk(a1.id)).payoutSettled, true);
  const mp2 = await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items: [{ payoutId: payA.id, utr: 'UPI123456789' }] });
  assert.equal(mp2.body.alreadyPaid.length, 1);
  assert.equal((await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items: [{ payoutId: payA.id, utr: 'DIFFERENT999' }] })).body.failed[0].code, 'ALREADY_PAID');
  assert.equal((await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items: [] })).status, 400);

  // The report now shows A's two orders as settled and the newer one pending.
  const ymd = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const rep = await api('GET', `/api/admin/revenue?period=day&date=${ymd(old)}&storeId=${A.id}`, admin.token);
  assert.equal(rep.body.totals.settledPaise, 27000);
  assert.equal(rep.body.totals.pendingPaise, 0);
});

test('two parallel Settle all clicks create exactly one statement per store', async () => {
  const u = await H.mkUser();
  const old = new Date(Date.now() - 40 * DAY);
  const stores = [];
  for (let i = 0; i < 3; i++) {
    const { store } = await H.mkStore({ rate: 10 });
    await store.update({ settlementCycle: 'monthly' });
    await delivered({ store, user: u, total: 100 + i, at: old });
    await delivered({ store, user: u, total: 200 + i, at: old });
    stores.push(store);
  }
  const p = await preview('monthly');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const ids = stores.map((s) => s.id);
  const [r1, r2, r3] = await Promise.all([settle(p.body, ids), settle(p.body, ids), settle(p.body, ids)]);
  for (const r of [r1, r2, r3]) assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const created = [r1, r2, r3].reduce((n, r) => n + r.body.created.length, 0);
  assert.equal(created, 3);
  for (const s of stores) {
    assert.equal(await H.ctx.M('Payout').count({ where: { partnerId: s.id } }), 1);
    const orders = await H.ctx.M('Order').findAll({ where: { restaurantId: s.id }, raw: true });
    assert.equal(new Set(orders.map((o) => o.payoutId)).size, 1);
    assert.ok(orders[0].payoutId);
  }
  // The other runs saw those stores as already settled, never as an error.
  for (const r of [r1, r2, r3]) assert.equal(r.body.failed.length, 0);
});

test('settlement cycle: store form + Revenue page, validated and audited', async () => {
  const { store } = await H.mkStore({ rate: 10 });
  assert.equal(store.settlementCycle, 'weekly');
  const bad = await api('POST', `/api/admin/restaurants/${store.id}`, admin.token, { settlementCycle: 'yearly' });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  const ok = await api('POST', `/api/admin/restaurants/${store.id}`, admin.token, { settlementCycle: 'Daily' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.settlementCycle, 'daily');
  const log = await H.ctx.M('VerificationLog').findOne({ where: { action: 'STORE_SETTLEMENT_CYCLE_UPDATED', targetId: store.id }, order: [['timestamp', 'DESC']] });
  assert.ok(log);
  assert.deepEqual(JSON.parse(log.details), { name: store.name, from: 'weekly', to: 'daily' });
  assert.equal(log.adminId, String(admin.id));

  const r = await api('PUT', `/api/admin/revenue/stores/${store.id}/cycle`, admin.token, { cycle: 'monthly' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.changed, true);
  assert.equal((await H.ctx.M('Restaurant').findByPk(store.id)).settlementCycle, 'monthly');
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'STORE_SETTLEMENT_CYCLE_UPDATED', targetId: store.id } }), 2);
  // Same value again: no change, no new audit row.
  assert.equal((await api('PUT', `/api/admin/revenue/stores/${store.id}/cycle`, admin.token, { cycle: 'monthly' })).body.changed, false);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'STORE_SETTLEMENT_CYCLE_UPDATED', targetId: store.id } }), 2);
  assert.equal((await api('PUT', `/api/admin/revenue/stores/${store.id}/cycle`, admin.token, { cycle: 'hourly' })).status, 400);
  // Private: never in the customer store list.
  const pub = await api('GET', `/api/users/restaurants/${store.id}`);
  if (pub.status === 200) assert.equal(JSON.stringify(pub.body).includes('settlementCycle'), false);
});
