// Revenue report (utils/revenueReport, GET /api/admin/revenue): what was collected (COD / Wallet / stall cash),
// commission (percentage and flat, fixed at order time; "rate at report time" only for old orders without a
// snapshot), a store with a special delivery price + a ZenWe-funded coupon placed through the real order API, a
// stall that holds the cash (negative owed), a buy-at-store order, exclusions (cancelled, not delivered, test
// store), IST day / week / month boundaries, and the reconciliation (exactly 0 on a mixed dataset; mismatches
// listed by order id). Non-admins are refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URLSearchParams } = require('url');
const H = require('../c6/helpers');

const { api } = H;
let admin;
let rider;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  rider = await H.mkRider();
});
after(H.teardown);

// An IST wall-clock time as a Date: ist('2026-09-10T13:00').
const ist = (local) => new Date(`${local}:00+05:30`);

/** A delivered order written directly (bill parts as the server saves them). */
const mkOrder = async ({ store, user, items, delivery = 19, platform = 4, packaging = 0, discounts = [], method = 'COD', fulfilment = 'ZENVY', withRider = true, at, status = 'Delivered', snapshot = true, extra = {} }) => {
  const { snapshotFields } = H.r('utils/commission');
  const totalDiscount = discounts.reduce((s, d) => s + d.amount, 0);
  const finalPrice = Math.round((items + delivery + platform + packaging - totalDiscount) * 100) / 100;
  return H.ctx.M('Order').create({
    userId: user.id, restaurantId: store.id, items: [], totalPrice: items, deliveryFee: delivery, platformFee: platform, finalPrice,
    priceBreakdown: { subtotal: items, deliveryFee: delivery, platformFee: platform, packagingFee: packaging, taxes: 0, discounts, totalDiscount, finalPrice, couponCode: null },
    paymentMethod: method, paymentStatus: 'Completed', status, fulfilment,
    deliveryPartnerId: withRider ? rider.id : null, deliveredAt: status === 'Delivered' ? at : null,
    ...(snapshot ? snapshotFields(store, items) : {}),
    ...extra,
  });
};
const report = (q) => api('GET', `/api/admin/revenue?${new URLSearchParams(q)}`, admin.token);

test('mixed day: every number, COD vs Wallet vs stall cash, flat + percentage commission, override + coupon, reconciliation exactly 0', async () => {
  const at = ist('2026-09-10T13:00');
  const u = await H.mkUser();
  const { store: A } = await H.mkStore({ rate: 10 });
  const { store: B } = await H.mkStore({ rate: 15, type: 'flat' });
  const { store: S } = await H.mkStore({ rate: 10, vendorType: 'LOCAL_VENDOR' });
  const { store: R } = await H.mkStore({ rate: 10 });
  const { store: T } = await H.mkStore({ rate: 10 });
  await T.update({ isTestData: true });

  // C: special delivery price ₹25 + 12% commission, ordered through the real API with a ₹30 ZenWe coupon.
  const { store: C, item: cItem } = await H.mkStore({ rate: 12, price: 150 });
  await C.update({ deliveryFeeOverride: 25 });
  const buyer = await H.mkUser();
  await H.ctx.M('Coupon').create({ code: `REV30-${Date.now()}`, type: 'DISCOUNT', value: 30, userId: buyer.id });
  const coupon = await H.ctx.M('Coupon').findOne({ where: { userId: buyer.id } });
  const placed = await api('POST', '/api/orders', buyer.token, { ...H.orderBody(cItem.id, 'COD'), couponCode: coupon.code });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.finalPrice, 150 + 25 + 4 - 30);
  await H.ctx.M('Order').update({ status: 'Delivered', deliveredAt: at, deliveryPartnerId: rider.id }, { where: { id: placed.body.id } });

  await mkOrder({ store: A, user: u, items: 200, at });                                                      // COD
  await mkOrder({ store: B, user: u, items: 99.5, method: 'Wallet', discounts: [{ type: 'perk_order', label: 'Gold member', amount: 10 }], at });
  await mkOrder({ store: S, user: u, items: 80, delivery: 0, platform: 0, packaging: 5, fulfilment: 'VENDOR', withRider: false, at });
  await mkOrder({ store: R, user: u, items: 60, at, extra: { storePaidByRider: true } });                     // rider paid the shop
  // Excluded: cancelled, not yet delivered, owner test store.
  await mkOrder({ store: A, user: u, items: 500, at, status: 'Cancelled', extra: { deliveredAt: at } });
  await mkOrder({ store: A, user: u, items: 700, at, status: 'OutForDelivery', extra: { updatedAt: at } });
  await mkOrder({ store: T, user: u, items: 300, at, extra: { isTestData: true } });

  const r = await report({ period: 'day', date: '2026-09-10' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.totals;
  assert.equal(t.orders, 5);
  assert.equal(r.body.excluded.testOrders, 1);
  assert.equal(t.collectedPaise, 22300 + 11250 + 14900 + 8500 + 8300);
  assert.deepEqual(t.byChannel, { cod: 22300 + 14900 + 8300, wallet: 11250, stall: 8500, other: 0 });
  assert.equal(t.zenweReceivedPaise, 22300 + 14900 + 8300 + 11250);
  assert.equal(t.commissionPaise, 2000 + 1500 + 1800 + 800 + 0);
  assert.equal(t.storeSharePaise, 18000 + 8450 + 13200 + 7200 + 6000);
  assert.equal(t.counterPaidPaise, 6000);
  assert.equal(t.stallCashPaise, 8500);
  // Delivery fees are ZenWe income (owner, 6 Nov 2026): no rider pay is taken off what ZenWe keeps.
  assert.equal(t.riderPayPaise, undefined);
  assert.equal(t.deliveryFeesPaise, 1900 + 1900 + 2500 + 1900);
  assert.equal(t.platformFeesPaise, 400 * 4);
  assert.equal(t.packagingFeesPaise, 500);
  assert.equal(t.discounts.coupon, 3000);
  assert.equal(t.discounts.perks, 1000);
  // Per order (commission + fees - discounts): A 2000+1900+400, B 1500+1900+400-1000, S 800+500 (stall: no fees),
  // R 0+1900+400 (buy-at-store), C 1800+2500+400-3000.
  assert.equal(t.keepsPaise, (2000 + 1900 + 400) + (1500 + 1900 + 400 - 1000) + (800 + 500) + (1900 + 400) + (1800 + 2500 + 400 - 3000));
  assert.equal(r.body.keepsLines.find((l) => l.key === 'riderPay'), undefined);
  assert.equal(t.owedPaise, 18000 + 8450 + 13200 - 1300);
  assert.equal(t.pendingPaise, t.owedPaise);
  assert.equal(t.settledPaise, 0);
  // Reconciliation: collected - refunds = store share + keeps, exactly.
  assert.equal(r.body.reconciliation.ok, true, JSON.stringify(r.body.reconciliation));
  assert.equal(r.body.reconciliation.differencePaise, 0);
  assert.equal(r.body.reconciliation.mismatches.length, 0);
  assert.equal(t.collectedPaise - t.refundsPaise, t.storeSharePaise + t.keepsPaise);
  // The keeps lines add up to the keeps total.
  assert.equal(r.body.keepsLines.reduce((s, l) => s + l.paise, 0), t.keepsPaise);

  const row = (id) => r.body.stores.find((s) => s.storeId === String(id));
  assert.equal(row(B.id).commissionPaise, 1500);
  assert.deepEqual(row(B.id).ratesAtOrderTime, [{ type: 'flat', rate: 15 }]);
  assert.equal(row(C.id).commissionPaise, 1800);
  assert.equal(row(C.id).effectiveCommissionPct, 12);
  assert.equal(row(C.id).deliveryFeesPaise, 2500);
  assert.equal(row(S.id).kind, 'vendor');
  assert.equal(row(S.id).owedPaise, -1300); // the stall holds ₹85 and owes ZenWe ₹8 commission + ₹5 packaging
  assert.equal(row(R.id).owedPaise, 0);
  assert.equal(row(R.id).counterPaidPaise, 6000);
  assert.equal(row(A.id).settlementCycle, 'weekly');
  assert.equal(row(T.id), undefined);

  // Store filter: only that store.
  const one = await report({ period: 'day', date: '2026-09-10', storeId: A.id });
  assert.equal(one.body.totals.orders, 1);
  assert.equal(one.body.totals.collectedPaise, 22300);
  assert.equal(one.body.reconciliation.ok, true);
});

test('IST boundaries: 23:59 and 00:01 land on different days, weeks (Mon-Sun) and months', async () => {
  const u = await H.mkUser();
  const { store: E } = await H.mkStore({ rate: 10 });
  await mkOrder({ store: E, user: u, items: 100, at: ist('2026-10-11T23:59') }); // Sunday night
  await mkOrder({ store: E, user: u, items: 101, at: ist('2026-10-12T00:01') }); // Monday morning
  await mkOrder({ store: E, user: u, items: 102, at: ist('2026-10-31T23:59') });
  await mkOrder({ store: E, user: u, items: 103, at: ist('2026-11-01T00:01') });
  const items = async (period, date) => {
    const r = await report({ period, date, storeId: E.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.totals.itemsPaise;
  };
  assert.equal(await items('day', '2026-10-11'), 10000);
  assert.equal(await items('day', '2026-10-12'), 10100);
  assert.equal(await items('week', '2026-10-08'), 10000); // Mon 5 - Sun 11 Oct
  assert.equal(await items('week', '2026-10-12'), 10100); // Mon 12 - Sun 18 Oct
  assert.equal(await items('day', '2026-10-31'), 10200);
  assert.equal(await items('day', '2026-11-01'), 10300);
  assert.equal(await items('month', '2026-10-15'), 10000 + 10100 + 10200);
  assert.equal(await items('month', '2026-11-20'), 10300);

  const P = H.r('utils/revenueReport');
  const w = P.periodBounds('week', '2026-10-14');
  assert.equal(w.startDate, '2026-10-12');
  assert.equal(w.endDate, '2026-10-18');
  assert.equal(w.start.toISOString(), '2026-10-11T18:30:00.000Z');
  assert.equal(w.end.toISOString(), '2026-10-18T18:29:59.999Z');
  assert.equal(w.prevDate, '2026-10-05');
  assert.equal(w.nextDate, '2026-10-19');
  const m = P.periodBounds('month', '2026-12-31');
  assert.equal(m.startDate, '2026-12-01');
  assert.equal(m.endDate, '2026-12-31');
  assert.equal(m.nextDate, '2027-01-01');
  assert.equal(m.prevDate, '2026-11-01');
  // The series covers the period's days (a day view: the 14 days ending on it).
  const series = (await report({ period: 'month', date: '2026-10-01', storeId: E.id })).body.series;
  assert.equal(series.length, 31);
  assert.equal(series.find((d) => d.date === '2026-10-11').orders, 1);
  assert.equal((await report({ period: 'day', date: '2026-10-12', storeId: E.id })).body.series.length, 14);
  // Bad input.
  assert.equal((await report({ period: 'year' })).status, 400);
  assert.equal((await report({ period: 'day', date: '2026-02-30' })).status, 400);
});

test('settlement cutoffs in IST: yesterday, last complete 3-day block, last Sunday', () => {
  const { settlementCutoff } = H.r('utils/revenueReport');
  const fri = new Date('2026-11-06T10:00:00Z'); // Fri 6 Nov 15:30 IST
  assert.equal(settlementCutoff('daily', fri).cutoff.toISOString(), '2026-11-05T18:29:59.999Z');
  assert.equal(settlementCutoff('weekly', fri).cutoff.toISOString(), '2026-11-01T18:29:59.999Z');
  // Fri 6 Nov is in the 5-7 Nov block: the last complete block is 2-4 Nov.
  assert.equal(settlementCutoff('3days', fri).cutoff.toISOString(), '2026-11-04T18:29:59.999Z');
  assert.equal(settlementCutoff('3days', new Date('2026-11-07T18:31:00Z')).cutoff.toISOString(), '2026-11-07T18:29:59.999Z'); // Sun 8 Nov 00:01 IST
  assert.equal(settlementCutoff('monthly', fri).cycle, '3days'); // old saved value
  const sunNight = new Date('2026-11-01T18:00:00Z'); // Sun 1 Nov 23:30 IST: this week is not over yet
  assert.equal(settlementCutoff('weekly', sunNight).cutoff.toISOString(), '2026-10-25T18:29:59.999Z');
  assert.equal(settlementCutoff('daily', sunNight).cutoff.toISOString(), '2026-10-31T18:29:59.999Z');
  const monEarly = new Date('2026-11-01T19:00:00Z'); // Mon 2 Nov 00:30 IST (still Sunday in UTC)
  assert.equal(settlementCutoff('weekly', monEarly).cutoff.toISOString(), '2026-11-01T18:29:59.999Z');
  // Mon 2 Nov starts the first block; the one before it is 30 Oct - 1 Nov.
  assert.equal(settlementCutoff('3days', monEarly).cutoff.toISOString(), '2026-11-01T18:29:59.999Z');
  assert.throws(() => settlementCutoff('yearly', fri));
});

test('old order without a commission snapshot: rate at report time, flagged; a total that does not match its parts is listed', async () => {
  const u = await H.mkUser();
  const { store } = await H.mkStore({ rate: 20 });
  const old = await mkOrder({ store, user: u, items: 100, at: ist('2026-08-03T12:00'), snapshot: false, extra: { payoutSettled: true } });
  let r = await report({ period: 'day', date: '2026-08-03' });
  assert.equal(r.body.totals.commissionPaise, 2000); // the store's 20% today
  assert.equal(r.body.totals.commissionEstimatedOrders, 1);
  assert.equal(r.body.commissionEstimated.sample[0].orderId, old.id);
  assert.equal(r.body.totals.settledPaise, 8000);
  assert.equal(r.body.totals.pendingPaise, 0);
  assert.equal(r.body.reconciliation.ok, true);

  // finalPrice 100 but the parts say 100 + 19 + 4: listed, never forced to balance.
  const bad = await mkOrder({ store, user: u, items: 100, at: ist('2026-08-04T12:00') });
  await bad.update({ finalPrice: 100 });
  r = await report({ period: 'day', date: '2026-08-04' });
  assert.equal(r.body.reconciliation.ok, false);
  assert.equal(r.body.reconciliation.differencePaise, -2300);
  assert.equal(r.body.reconciliation.mismatches.length, 1);
  assert.equal(r.body.reconciliation.mismatches[0].orderId, bad.id);
  assert.equal(r.body.reconciliation.mismatches[0].differencePaise, -2300);
});

test('a wallet refund on a delivered order comes off collected and off what ZenWe keeps; the store share is unchanged', async () => {
  const u = await H.mkUser();
  const { store } = await H.mkStore({ rate: 10 });
  const o = await mkOrder({ store, user: u, items: 100, method: 'Wallet', at: ist('2026-08-10T12:00') });
  await H.ctx.M('WalletTransaction').create({ ownerType: 'user', ownerId: String(u.id), amountPaise: 5000, balanceAfterPaise: 5000, type: 'ORDER_REFUND', refType: 'ORDER', refId: String(o.id), actorType: 'admin', actorId: 'x', reason: 'partial goodwill refund' });
  const r = await report({ period: 'day', date: '2026-08-10' });
  const t = r.body.totals;
  assert.equal(t.refundsPaise, 5000);
  assert.equal(t.storeSharePaise, 9000);
  assert.equal(t.keepsPaise, 1000 + 1900 + 400 - 5000);
  assert.equal(r.body.reconciliation.ok, true, JSON.stringify(r.body.reconciliation));
});

test('only admins: no token 401, customer / store / rider tokens 403', async () => {
  const u = await H.mkUser();
  const { store } = await H.mkStore();
  assert.equal((await api('GET', '/api/admin/revenue')).status, 401);
  for (const tok of [u.token, store.token, rider.token]) {
    assert.equal((await api('GET', '/api/admin/revenue', tok)).status, 403);
    assert.equal((await api('GET', '/api/admin/revenue/settle/preview?cycle=weekly', tok)).status, 403);
    assert.equal((await api('POST', '/api/admin/revenue/settle', tok, { cycle: 'weekly', cutoff: new Date().toISOString(), expected: [] })).status, 403);
    assert.equal((await api('POST', '/api/admin/revenue/settle/mark-paid', tok, { items: [] })).status, 403);
    assert.equal((await api('PUT', `/api/admin/revenue/stores/${store.id}/cycle`, tok, { cycle: 'daily' })).status, 403);
  }
  assert.equal((await H.ctx.M('Restaurant').findByPk(store.id)).settlementCycle, 'weekly');
});
