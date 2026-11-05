// Order fees (owner, 5 Nov 2026): every restaurant order is its own order with ₹19 delivery + ₹4 platform fee.
// Through the real quote / order / cancel routes: the platform fee is server-computed, stored on the order, part of
// the total, never waived by a free-delivery coupon, refunded on cancel, and never charged on stall orders.
// No global overrides: GlobalConfig delivery_fee / platform_fee are ignored; only a store's admin-set
// deliveryFeeOverride replaces the ₹19 (stalls stay 0 + 0).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

const { api } = H;
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const quote = (u, itemId, extra = {}) => api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: itemId, quantity: 1 }], ...extra });
const place = (u, itemId, pay = 'COD', extra = {}) => api('POST', '/api/orders', u.token, { ...H.orderBody(itemId, pay), ...extra });
const setConfig = (key, value) => H.ctx.M('GlobalConfig').upsert({ key, value: String(value) });
const clearConfig = (key) => H.ctx.M('GlobalConfig').destroy({ where: { key } });

before(async () => { await H.setup(); });
after(H.teardown);

test('defaults: delivery ₹19 and platform fee ₹4 per order; total = subtotal + 19 + 4', async () => {
  const P = H.r('utils/orderPricing');
  assert.equal(P.DEFAULT_DELIVERY_FEE, 19);
  assert.equal(P.DEFAULT_PLATFORM_FEE, 4);
  const { item } = await H.mkStore({ price: 120 });
  const u = await H.mkUser();
  const q = await quote(u, item.id);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.deliveryFee, 19);
  assert.equal(q.body.platformFee, 4);
  assert.equal(q.body.subtotal, 120);
  assert.equal(q.body.finalPrice, 120 + 19 + 4);
});

test('the order stores the platform fee (column + bill) and the total the customer pays includes it', async () => {
  const { item } = await H.mkStore({ price: 150 });
  const u = await H.mkUser();
  const r = await place(u, item.id, 'COD', { expectedTotal: 173 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.finalPrice, 173);
  assert.equal(r.body.priceBreakdown.platformFee, 4);
  assert.equal(r.body.priceBreakdown.deliveryFee, 19);
  const row = await H.ctx.M('Order').findByPk(r.body.id);
  assert.equal(Number(row.platformFee), 4);
  assert.equal(Number(row.deliveryFee), 19);
  assert.equal(Number(row.finalPrice), 173);
});

test('a client cannot lower the platform fee: a wrong expectedTotal gets PRICE_CHANGED, client fee fields are ignored', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const bad = await place(u, item.id, 'COD', { expectedTotal: 119, platformFee: 0, deliveryFee: 0 });
  assert.equal(bad.status, 409, JSON.stringify(bad.body));
  assert.equal(bad.body.code, 'PRICE_CHANGED');
  assert.equal(bad.body.quote.platformFee, 4);
  const ok = await place(u, item.id, 'COD', { platformFee: 0, finalPrice: 1 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.finalPrice, 123);
});

test('discounts: a flat coupon comes off the items only, total = subtotal + 19 + 4 − discount', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await H.ctx.M('Coupon').create({ code: `FEE${Date.now().toString(36).toUpperCase()}${++seq}`, type: 'DISCOUNT', value: 30, userId: u.id, isUsed: false, expiryDate: new Date(Date.now() + DAY) });
  const q = await quote(u, item.id, { couponCode: c.code });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.totalDiscount, 30);
  assert.equal(q.body.finalPrice, 100 + 19 + 4 - 30);
});

test('a free-delivery coupon waives the ₹19 delivery but never the ₹4 platform fee', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await H.ctx.M('Coupon').create({ code: `FREE${Date.now().toString(36).toUpperCase()}${++seq}`, type: 'FREEDEL', value: 0, userId: u.id, isUsed: false, expiryDate: new Date(Date.now() + DAY) });
  const q = await quote(u, item.id, { couponCode: c.code });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.coupon.discount, 19);
  assert.equal(q.body.platformFee, 4);
  assert.equal(q.body.finalPrice, 100 + 4);
});

test('200+ ZenWe Points (free delivery perk) still pays the platform fee', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ zenPoints: 250 });
  const q = await quote(u, item.id);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.platformFee, 4);
  assert.ok(q.body.finalPrice >= 100 + 4, `final ${q.body.finalPrice}`);
});

test('stall orders (the stall delivers, cash to the stall): no delivery fee and no platform fee', async () => {
  const st = await H.ctx.M('Restaurant').create({ name: `Fee Stall ${++seq}`, location: 'SRM AP Food Court', vendorType: 'STALL', password: 'stallpass1', operatingHours: { start: '00:00', end: '00:00' }, isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064, whatsappNumber: '9876543210' });
  const it = await H.ctx.M('MenuItem').create({ restaurantId: st.id, name: 'Stall Tea', price: 20, isAvailable: true });
  const u = await H.mkUser();
  const q = await quote(u, it.id);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.deliveryFee, 0);
  assert.equal(q.body.platformFee, 0);
  assert.equal(q.body.finalPrice, 20);
  const r = await place(u, it.id, 'COD');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = await H.ctx.M('Order').findByPk(r.body.id);
  assert.equal(Number(row.platformFee), 0);
  assert.equal(Number(row.finalPrice), 20);
});

test('cancel refunds the full amount paid from the Wallet, platform fee included (one ledger refund row)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 500 });
  const r = await place(u, item.id, 'Wallet');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.finalPrice, 123);
  const toPaise = H.r('utils/walletLedger').toPaise;
  assert.equal(await H.balancePaise('user', u.id), 50000 - toPaise(123));
  const c = await api('PUT', `/api/orders/${r.body.id}/cancel`, u.token, {});
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(await H.balancePaise('user', u.id), 50000, 'everything back, the ₹4 platform fee too');
  const refunds = (await H.ledger('user', u.id)).filter((x) => x.type === 'ORDER_REFUND');
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amountPaise, toPaise(123));
  assert.equal(await H.ledgerSum('user', u.id), await H.balancePaise('user', u.id), 'ledger reconciles with the balance');
});

test('two restaurants, two separate orders: each charges its own ₹19 + ₹4', async () => {
  const a = await H.mkStore({ price: 80 });
  const b = await H.mkStore({ price: 60 });
  const u = await H.mkUser();
  const ra = await place(u, a.item.id, 'COD');
  const rb = await place(u, b.item.id, 'COD');
  assert.equal(ra.status, 201, JSON.stringify(ra.body));
  assert.equal(rb.status, 201, JSON.stringify(rb.body));
  assert.notEqual(ra.body.id, rb.body.id);
  assert.equal(ra.body.finalPrice, 80 + 23);
  assert.equal(rb.body.finalPrice, 60 + 23);
  // One basket with both stores in one order is still refused (one restaurant per order).
  const both = await api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: a.item.id, quantity: 1 }, { menuItemId: b.item.id, quantity: 1 }] });
  assert.equal(both.status, 400);
  assert.equal(both.body.code, 'MULTIPLE_STORES');
});

test('global config delivery_fee / platform_fee are IGNORED: still ₹19 + ₹4 (no global overrides)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  // Live may still hold an old ₹30 delivery_fee key: it must not apply.
  await setConfig('delivery_fee', 30);
  await setConfig('platform_fee', 6);
  try {
    const q = await quote(u, item.id);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.deliveryFee, 19);
    assert.equal(q.body.platformFee, 4);
    assert.equal(q.body.finalPrice, 123);
    const r = await place(u, item.id, 'COD', { expectedTotal: 123 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const row = await H.ctx.M('Order').findByPk(r.body.id);
    assert.equal(Number(row.deliveryFee), 19);
    assert.equal(Number(row.platformFee), 4);
  } finally {
    await clearConfig('delivery_fee');
    await clearConfig('platform_fee');
  }
});

test('a store with a special delivery price ₹10 charges 10 + 4 (global ₹30 still ignored)', async () => {
  const { store, item } = await H.mkStore({ price: 100 });
  await store.update({ deliveryFeeOverride: 10 });
  const u = await H.mkUser();
  await setConfig('delivery_fee', 30);
  try {
    const q = await quote(u, item.id);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.deliveryFee, 10);
    assert.equal(q.body.platformFee, 4);
    assert.equal(q.body.finalPrice, 114);
    const r = await place(u, item.id, 'COD', { expectedTotal: 114 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(Number((await H.ctx.M('Order').findByPk(r.body.id)).deliveryFee), 10);
  } finally {
    await clearConfig('delivery_fee');
  }
});

test('special delivery price ₹0 charges 0 + 4; clearing it (null) goes back to 19 + 4', async () => {
  const { store, item } = await H.mkStore({ price: 100 });
  await store.update({ deliveryFeeOverride: 0 });
  const u = await H.mkUser();
  const q = await quote(u, item.id);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.deliveryFee, 0);
  assert.equal(q.body.platformFee, 4);
  assert.equal(q.body.finalPrice, 104);
  await store.update({ deliveryFeeOverride: null });
  const q2 = await quote(u, item.id);
  assert.equal(q2.body.deliveryFee, 19);
  assert.equal(q2.body.finalPrice, 123);
});

test('a stall ignores any special delivery price: 0 + 0', async () => {
  const st = await H.ctx.M('Restaurant').create({ name: `Fee Stall Ovr ${++seq}`, location: 'SRM AP Food Court', vendorType: 'STALL', password: 'stallpass1', operatingHours: { start: '00:00', end: '00:00' }, isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064, whatsappNumber: '9876543211', deliveryFeeOverride: 15 });
  const it = await H.ctx.M('MenuItem').create({ restaurantId: st.id, name: 'Stall Coffee', price: 25, isAvailable: true });
  const u = await H.mkUser();
  const q = await quote(u, it.id);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.deliveryFee, 0);
  assert.equal(q.body.platformFee, 0);
  assert.equal(q.body.finalPrice, 25);
});

test('admin store API: sets, validates, clears and audits the special delivery price', async () => {
  const { store, item } = await H.mkStore({ price: 100 });
  const admin = await H.mkUser({ role: 'admin' });
  const u = await H.mkUser();
  const put = (body) => api('POST', `/api/admin/restaurants/${store.id}`, admin.token, body);
  const ok = await put({ deliveryFeeOverride: '12' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.deliveryFeeOverride, 12);
  assert.equal((await quote(u, item.id)).body.deliveryFee, 12);
  for (const bad of [-1, 201, 12.5, 'abc']) {
    const r = await put({ deliveryFeeOverride: bad });
    assert.equal(r.status, 400, `${bad}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(Number((await H.ctx.M('Restaurant').findByPk(store.id)).deliveryFeeOverride), 12, 'a bad value changes nothing');
  const audits = await H.ctx.M('VerificationLog').findAll({ where: { action: 'STORE_DELIVERY_FEE_UPDATED', targetId: String(store.id) }, raw: true });
  assert.equal(audits.length, 1);
  const cleared = await put({ deliveryFeeOverride: '' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.deliveryFeeOverride, null);
  assert.equal((await quote(u, item.id)).body.deliveryFee, 19);
  // Public helpers never carry the raw admin value.
  assert.ok(H.r('utils/publicFields').STORE_PRIVATE_FIELDS.includes('deliveryFeeOverride'));
  // Non-admins cannot set it.
  const denied = await api('POST', `/api/admin/restaurants/${store.id}`, u.token, { deliveryFeeOverride: 0 });
  assert.ok(denied.status === 401 || denied.status === 403, String(denied.status));
});

test('receipt shows the platform fee as its own line and adds up without an adjustment', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const r = await place(u, item.id, 'COD');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = await H.ctx.M('Order').findByPk(r.body.id);
  const receipts = H.r('utils/receipts');
  const rc = receipts.buildReceipt(row);
  assert.equal(rc.amounts.platformFee, 4);
  assert.equal(rc.amounts.deliveryFee, 19);
  assert.equal(rc.amounts.total, 123);
  assert.equal(rc.amounts.adjustment, undefined);
});
