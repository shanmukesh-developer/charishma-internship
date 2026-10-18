// Payout statements: math for a restaurant, a stall (cash it collected itself is deducted) and a rider
// (earnings + tips, cash held NOT deducted); preview -> create claims the orders; mark paid needs a UTR,
// sets the old flags and takes tips out through the wallet ledger; cancel releases; the legacy settle
// endpoints now record a Payout too (UTR required); the store / rider see their own statements only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URLSearchParams } = require('url');
const H = require('./helpers');

const { api } = H;
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

const delivered = async ({ store, user, rider = null, total = 100, fee = 30, method = 'COD', fulfilment = 'ZENVY', rate = null, extra = {} }) => {
  const { snapshotFields } = H.r('utils/commission');
  const st = rate === null ? store : { commissionRate: rate, commissionType: 'percentage' };
  return H.ctx.M('Order').create({
    userId: user.id, restaurantId: store.id, items: [], totalPrice: total, deliveryFee: fee, finalPrice: total + fee, paymentMethod: method,
    paymentStatus: 'Completed', status: 'Delivered', deliveryPartnerId: rider ? rider.id : null, deliveredAt: new Date(Date.now() - 60000), fulfilment,
    ...snapshotFields(st, total), ...extra,
  });
};
const preview = (q) => api('GET', `/api/admin/payouts/preview?${new URLSearchParams(q)}`, admin.token);
const create = (p, extra = {}) => api('POST', '/api/admin/payouts', admin.token, { partnerType: p.partnerType, partnerId: p.partnerId, to: p.periodEnd, expectedOrders: p.orderCount, expectedNetPaise: p.netPaise, ...extra });

test('restaurant statement: gross - commission (snapshot) = net; create claims orders; mark paid needs UTR; flags set', async () => {
  const { store } = await H.mkStore({ rate: 10 });
  const u = await H.mkUser();
  const a = await delivered({ store, user: u, total: 200 });
  const b = await delivered({ store, user: u, total: 99.5, rate: 15 }); // older snapshot at 15%
  const p = await preview({ partnerType: 'restaurant', partnerId: store.id });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.orderCount, 2);
  assert.equal(p.body.grossPaise, 20000 + 9950);
  assert.equal(p.body.commissionPaise, 2000 + 1493); // 9950 * 15% = 1492.5 -> 1493
  assert.equal(p.body.adjustmentsPaise, 0);
  assert.equal(p.body.netPaise, 29950 - 3493);
  // Wrong type for this store.
  assert.equal((await preview({ partnerType: 'vendor', partnerId: store.id })).body.code, 'WRONG_PARTNER_TYPE');
  // The admin saw a different number -> 409.
  const stale = await create(p.body, { expectedNetPaise: p.body.netPaise + 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'PAYOUT_CHANGED');
  const c = await create(p.body, { notes: 'Week 42' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const pay = c.body.payout;
  assert.equal(pay.status, 'PENDING');
  assert.equal(pay.netPaise, 26457);
  assert.equal((await H.ctx.M('Order').findByPk(a.id)).payoutId, pay.id);
  // Nothing left for a second statement.
  const again = await preview({ partnerType: 'restaurant', partnerId: store.id });
  assert.equal(again.body.orderCount, 0);
  assert.equal((await create(again.body)).body.code, 'NOTHING_TO_PAY');
  // Mark paid: UTR required.
  for (const utr of [undefined, '', '  ', 'ab']) {
    const r = await api('POST', `/api/admin/payouts/${pay.id}/mark-paid`, admin.token, { utr });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'UTR_REQUIRED');
  }
  assert.equal((await H.ctx.M('Order').findByPk(a.id)).payoutSettled, false);
  const ok = await api('POST', `/api/admin/payouts/${pay.id}/mark-paid`, admin.token, { utr: 'HDFC00012345', method: 'bank' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.payout.status, 'PAID');
  assert.equal(ok.body.payout.utr, 'HDFC00012345');
  assert.ok(ok.body.payout.paidAt);
  assert.equal((await H.ctx.M('Order').findByPk(a.id)).payoutSettled, true);
  assert.equal((await H.ctx.M('Order').findByPk(b.id)).payoutSettled, true);
  // Same UTR again: idempotent; different UTR: 409; cancel a paid one: 409.
  assert.equal((await api('POST', `/api/admin/payouts/${pay.id}/mark-paid`, admin.token, { utr: 'HDFC00012345' })).body.alreadyPaid, true);
  assert.equal((await api('POST', `/api/admin/payouts/${pay.id}/mark-paid`, admin.token, { utr: 'OTHER9999' })).status, 409);
  assert.equal((await api('POST', `/api/admin/payouts/${pay.id}/cancel`, admin.token, { reason: 'mistake made' })).status, 409);
  // History + detail.
  const hist = await api('GET', `/api/admin/payouts?partnerId=${store.id}`, admin.token);
  assert.equal(hist.body.payouts.length, 1);
  const one = await api('GET', `/api/admin/payouts/${pay.id}`, admin.token);
  assert.equal(one.body.orders.length, 2);
  assert.equal(one.body.orders.reduce((s, l) => s + l.netPaise, 0), 26457);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'PAYOUT_MARKED_PAID', targetId: store.id } }), 1);
});

test('stall (vendor) statement: the cash the stall collected is an adjustment; net can be negative (stall owes the commission)', async () => {
  const { store } = await H.mkStore({ rate: 10, vendorType: 'LOCAL_VENDOR' });
  const u = await H.mkUser();
  await delivered({ store, user: u, total: 150, fee: 0, fulfilment: 'VENDOR' });
  const p = await preview({ partnerType: 'vendor', partnerId: store.id });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.grossPaise, 15000);
  assert.equal(p.body.commissionPaise, 1500);
  assert.equal(p.body.adjustmentsPaise, -15000);
  assert.equal(p.body.netPaise, -1500);
  assert.equal(p.body.breakdown.stallCashCollectedPaise, 15000);
});

test('buy-at-store orders are never on a store statement', async () => {
  const { store } = await H.mkStore({ rate: 10 });
  const u = await H.mkUser();
  await delivered({ store, user: u, total: 300, extra: { storePaidByRider: true } });
  const p = await preview({ partnerType: 'restaurant', partnerId: store.id });
  assert.equal(p.body.orderCount, 0);
});

test('rider statement: earnings + tips, cash held shown but not deducted; mark paid debits tips once (TIP_PAYOUT); cancel releases', async () => {
  const d = await H.mkRider({ wallet: 40 });
  const { store } = await H.mkStore();
  const u = await H.mkUser();
  const o1 = await delivered({ store, user: u, rider: d, fee: 30 });
  await delivered({ store, user: u, rider: d, fee: 0 });
  await H.r('utils/riderCash'); // cash held for the view
  await H.ctx.sequelize.transaction((t) => H.r('utils/riderCash').applyCashChange({ t, riderId: d.id, amountPaise: 50000, type: 'ADJUSTMENT', actor: { type: 'admin', id: admin.id }, reason: 'Test cash held' }));
  const p = await preview({ partnerType: 'rider', partnerId: d.id });
  assert.equal(p.body.grossPaise, 6000);
  assert.equal(p.body.tipsPaise, 4000);
  assert.equal(p.body.netPaise, 10000);
  assert.equal(p.body.cashHeldPaise, 50000);
  // Cancel releases the orders.
  const c1 = await create(p.body);
  assert.equal(c1.status, 201, JSON.stringify(c1.body));
  assert.equal((await api('POST', `/api/admin/payouts/${c1.body.payout.id}/cancel`, admin.token, { reason: 'no' })).body.code, 'REASON_REQUIRED');
  const can = await api('POST', `/api/admin/payouts/${c1.body.payout.id}/cancel`, admin.token, { reason: 'Wrong period chosen' });
  assert.equal(can.status, 200);
  assert.equal(can.body.releasedOrders, 2);
  assert.equal((await H.ctx.M('Order').findByPk(o1.id)).riderPayoutId, null);
  // New statement, pay it.
  const p2 = await preview({ partnerType: 'rider', partnerId: d.id });
  const c2 = await create(p2.body);
  const paid = await api('POST', `/api/admin/payouts/${c2.body.payout.id}/mark-paid`, admin.token, { utr: 'UPI-REF-42', method: 'upi' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal((await H.ctx.M('Order').findByPk(o1.id)).riderPayoutSettled, true);
  const tipRows = await H.ctx.M('WalletTransaction').findAll({ where: { ownerType: 'rider', ownerId: d.id, type: 'TIP_PAYOUT' } });
  assert.equal(tipRows.length, 1);
  assert.equal(tipRows[0].amountPaise, -4000);
  assert.equal(Number((await H.ctx.M('DeliveryPartner').findByPk(d.id)).walletBalance), 0);
  assert.equal(await H.cashHeld(d.id), 50000, 'cash held is untouched by a payout');
  // The rider sees their statements; the cancelled one is hidden.
  const mine = await api('GET', '/api/delivery/payouts', d.token);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.payouts.map((x) => x.status), ['PAID']);
  assert.ok(!('paidBy' in mine.body.payouts[0]));
});

test('legacy settle endpoints: UTR required; record a PAID Payout + old flags in one go', async () => {
  const { store } = await H.mkStore({ rate: 10 });
  const u = await H.mkUser();
  const o = await delivered({ store, user: u, total: 100 });
  const list = await api('GET', '/api/admin/finance/payouts', admin.token);
  const row = list.body.find((x) => x.restaurantId === store.id);
  assert.equal(row.totalOrders, 1);
  const noUtr = await api('POST', '/api/admin/finance/settle-restaurant', admin.token, { restaurantId: store.id, upTo: row.asOf, expectedOrders: 1 });
  assert.equal(noUtr.status, 400);
  assert.equal(noUtr.body.code, 'UTR_REQUIRED');
  const mism = await api('POST', '/api/admin/finance/settle-restaurant', admin.token, { restaurantId: store.id, upTo: row.asOf, expectedOrders: 3, utr: 'UTR777' });
  assert.equal(mism.status, 409);
  assert.equal(mism.body.code, 'PAYOUT_CHANGED');
  assert.equal(mism.body.currentOrders, 1);
  const ok = await api('POST', '/api/admin/finance/settle-restaurant', admin.token, { restaurantId: store.id, upTo: row.asOf, expectedOrders: 1, utr: 'UTR777' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.updatedOrdersCount, 1);
  assert.equal((await H.ctx.M('Order').findByPk(o.id)).payoutSettled, true);
  const p = await H.ctx.M('Payout').findByPk(ok.body.payoutId);
  assert.equal(p.status, 'PAID');
  assert.equal(p.utr, 'UTR777');
  assert.equal(p.netPaise, 9000);

  const d = await H.mkRider({ wallet: 10 });
  await delivered({ store, user: u, rider: d, fee: 30 });
  const fleet = await api('GET', '/api/admin/fleet/payouts', admin.token);
  const fr = fleet.body.find((x) => x.riderId === d.id);
  assert.equal(fr.totalPayout, 40);
  assert.equal((await api('POST', '/api/admin/finance/settle-rider', admin.token, { riderId: d.id, upTo: fr.asOf })).body.code, 'UTR_REQUIRED');
  const rs = await api('POST', '/api/admin/finance/settle-rider', admin.token, { riderId: d.id, upTo: fr.asOf, includeTips: true, tipsAmount: fr.unsettledTips, utr: 'UPI-1234' });
  assert.equal(rs.status, 200, JSON.stringify(rs.body));
  assert.equal(rs.body.updatedOrdersCount, 1);
  assert.equal(rs.body.tipsSettled, 10);
});

test('store payouts API: owner or admin only', async () => {
  const { store } = await H.mkStore({ rate: 10 });
  const other = await H.mkStore({ rate: 10 });
  const u = await H.mkUser();
  await delivered({ store, user: u, total: 100 });
  const mine = await api('GET', `/api/restaurants/${store.id}/payouts`, store.token);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.notYetOnStatement.orders, 1);
  assert.equal(mine.body.notYetOnStatement.netPaise, 9000);
  assert.equal((await api('GET', `/api/restaurants/${store.id}/payouts`, other.store.token)).status, 403);
  assert.equal((await api('GET', `/api/restaurants/${store.id}/payouts`, admin.token)).status, 200);
});
