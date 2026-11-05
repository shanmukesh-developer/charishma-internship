// Coupons at checkout, through the real quote / order / cancel routes and the auto-cancel job (31 Oct 2026). A coupon
// saves exactly what it says, only for its owner, only once (also when several orders race), never past its expiry or
// outside its store / item / minimum, never takes a bill below ₹0, is refused when it would save nothing (instead of
// being used up), and comes back exactly once when the order is cancelled before the coupon expires.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

const { api } = H;
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const mkCoupon = (user, extra = {}) => H.ctx.M('Coupon').create({
  code: `TST${Date.now().toString(36).toUpperCase()}${++seq}`, type: 'DISCOUNT', value: 40, userId: user.id, isUsed: false,
  expiryDate: new Date(Date.now() + DAY), ...extra,
});
const reload = (c) => H.ctx.M('Coupon').findByPk(c.id);
const placeWith = (u, itemId, couponCode, pay = 'COD', qty = 1) => api('POST', '/api/orders', u.token, { ...H.orderBody(itemId, pay), items: [{ menuItemId: itemId, quantity: qty }], couponCode });
const quoteWith = (u, itemId, couponCode, qty = 1) => api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: itemId, quantity: qty }], couponCode });
const cancel = (u, id) => api('PUT', `/api/orders/${id}/cancel`, u.token, {});
const backdate = async (orderId, minutes) => {
  const Order = H.ctx.M('Order');
  const at = new Date(Date.now() - minutes * 60 * 1000);
  await H.ctx.sequelize.query(`UPDATE "${Order.getTableName()}" SET "createdAt" = ? WHERE id = ?`, { replacements: [at.toISOString().replace('T', ' ').replace('Z', ' +00:00'), orderId] });
};

before(async () => { await H.setup(); });
after(H.teardown);

test('flat ₹ off: the quote and the order take exactly the coupon value, the bill adds up, the coupon is used once', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { value: 40 });
  const q = await quoteWith(u, item.id, c.code);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.coupon.discount, 40);
  assert.equal(q.body.finalPrice, q.body.subtotal + q.body.deliveryFee + q.body.platformFee + q.body.packagingFee + q.body.taxes - q.body.totalDiscount);
  assert.equal((await reload(c)).isUsed, false, 'a quote never uses the coupon');
  const r = await placeWith(u, item.id, c.code);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.finalPrice, q.body.finalPrice);
  assert.equal(r.body.priceBreakdown.couponCode, c.code);
  assert.equal((await reload(c)).isUsed, true);
  const again = await placeWith(u, item.id, c.code);
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'COUPON_INVALID');
  assert.equal((await quoteWith(u, item.id, c.code)).body.code, 'COUPON_INVALID');
  assert.equal(await H.ctx.M('Order').count({ where: { userId: u.id } }), 1, 'the refused second order was not created');
});

test('6 orders racing with one coupon: exactly one gets it, the rest are refused and not created', async () => {
  const { item } = await H.mkStore({ price: 120 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { value: 50 });
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => placeWith(u, item.id, c.code)));
  assert.equal(rs.filter((x) => x.status === 201).length, 1, rs.map((x) => `${x.status}:${x.body && x.body.code}`).join(','));
  assert.ok(rs.filter((x) => x.status !== 201).every((x) => x.status === 400 && x.body.code === 'COUPON_INVALID'));
  const orders = await H.ctx.M('Order').findAll({ where: { userId: u.id } });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].priceBreakdown.couponCode, c.code);
  assert.equal((await reload(c)).isUsed, true);
});

test('a coupon belongs to one student: anyone else is refused and the owner keeps it', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const owner = await H.mkUser();
  const other = await H.mkUser();
  const c = await mkCoupon(owner);
  assert.equal((await quoteWith(other, item.id, c.code)).body.code, 'COUPON_INVALID');
  const r = await placeWith(other, item.id, c.code);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'COUPON_INVALID');
  assert.equal((await reload(c)).isUsed, false);
  const mine = await quoteWith(owner, item.id, `  ${c.code} `);
  assert.equal(mine.status, 200, 'spaces around the code are fine');
  assert.equal(mine.body.coupon.code, c.code);
  const v = await api('POST', '/api/rewards/validate-coupon', other.token, { code: c.code });
  assert.equal(v.status, 404, 'validate does not reveal another student\'s coupon');
});

test('expired coupons are refused at the quote and the order; an expired-today coupon never applies', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { expiryDate: new Date(Date.now() - 60 * 1000) });
  assert.equal((await quoteWith(u, item.id, c.code)).body.code, 'COUPON_INVALID');
  const r = await placeWith(u, item.id, c.code);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'COUPON_INVALID');
  assert.equal(await H.ctx.M('Order').count({ where: { userId: u.id } }), 0);
  const v = await api('POST', '/api/rewards/validate-coupon', u.token, { code: c.code });
  assert.equal(v.status, 400);
});

test('a coupon worth more than the item total takes the items to ₹0, never the bill below ₹0', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { value: 500 });
  const q = await quoteWith(u, item.id, c.code);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.coupon.discount, 100, 'capped at the item total');
  assert.equal(q.body.finalPrice, q.body.deliveryFee + q.body.platformFee + q.body.packagingFee + q.body.taxes);
  assert.ok(q.body.finalPrice >= 0);
  const r = await placeWith(u, item.id, c.code);
  assert.equal(r.status, 201);
  assert.equal(r.body.finalPrice, q.body.finalPrice);
});

test('free delivery: takes off exactly the delivery fee; refused (and kept) when delivery is already free', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { type: 'FREEDEL', value: 0 });
  const q = await quoteWith(u, item.id, c.code);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.ok(q.body.deliveryFee > 0);
  assert.equal(q.body.coupon.discount, q.body.deliveryFee);
  // The platform fee is never waived by a free-delivery coupon (owner, 5 Nov 2026).
  assert.ok(q.body.platformFee > 0);
  assert.equal(q.body.finalPrice, q.body.subtotal + q.body.platformFee + q.body.packagingFee + q.body.taxes);
  // 200+ ZCS Points already give free delivery: the coupon would save nothing, so it is refused, not used up.
  const rich = await H.mkUser({ zenPoints: 250 });
  const c2 = await mkCoupon(rich, { type: 'FREEDEL', value: 0 });
  assert.equal((await quoteWith(rich, item.id, c2.code)).body.code, 'COUPON_NO_SAVING');
  const r = await placeWith(rich, item.id, c2.code);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'COUPON_NO_SAVING');
  assert.equal((await reload(c2)).isUsed, false);
  assert.equal(await H.ctx.M('Order').count({ where: { userId: rich.id } }), 0);
});

test('store / item / minimum-order coupons (Vault deals) only work where they are meant to, and stay unused when refused', async () => {
  const { store, item } = await H.mkStore({ price: 100 });
  const { item: elsewhere } = await H.mkStore({ price: 100 });
  const extra = await H.ctx.M('MenuItem').create({ restaurantId: store.id, name: 'Deal Brownie', price: 60, isAvailable: true });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { value: 50, restaurantId: store.id, menuItemId: extra.id, minOrderValue: 250 });
  assert.equal((await quoteWith(u, elsewhere.id, c.code)).body.code, 'COUPON_WRONG_STORE');
  assert.equal((await quoteWith(u, item.id, c.code, 3)).body.code, 'COUPON_ITEM_REQUIRED');
  const small = await api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: extra.id, quantity: 1 }, { menuItemId: item.id, quantity: 1 }], couponCode: c.code });
  assert.equal(small.body.code, 'COUPON_MIN_ORDER', '₹160 is under the ₹250 minimum');
  const bad = await placeWith(u, elsewhere.id, c.code);
  assert.equal(bad.status, 400);
  assert.equal((await reload(c)).isUsed, false);
  const okBody = { ...H.orderBody(item.id, 'COD'), items: [{ menuItemId: extra.id, quantity: 1 }, { menuItemId: item.id, quantity: 2 }], couponCode: c.code };
  const ok = await api('POST', '/api/orders', u.token, okBody);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await reload(c)).isUsed, true);
});

test('stall orders (paid to the stall in cash) refuse coupons; the coupon stays unused', async () => {
  const st = await H.ctx.M('Restaurant').create({ name: `Coupon Stall ${++seq}`, location: 'SRM AP Food Court', vendorType: 'STALL', password: 'stallpass1', operatingHours: { start: '00:00', end: '00:00' }, isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064, whatsappNumber: '9876543210' });
  const it = await H.ctx.M('MenuItem').create({ restaurantId: st.id, name: 'Stall Tea', price: 20, isAvailable: true });
  const u = await H.mkUser();
  const c = await mkCoupon(u);
  const q = await quoteWith(u, it.id, c.code);
  assert.equal(q.status, 400, JSON.stringify(q.body));
  assert.equal(q.body.code, 'COUPON_NOT_FOR_STALL');
  assert.equal((await reload(c)).isUsed, false);
});

test('cancel before expiry: Wallet refunded once and the coupon back once (also when two cancels race)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 500 });
  const c = await mkCoupon(u, { value: 40 });
  const r = await placeWith(u, item.id, c.code, 'Wallet');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const paid = H.r('utils/walletLedger').toPaise(r.body.finalPrice);
  assert.equal(await H.balancePaise('user', u.id), 50000 - paid, 'only the bill after the coupon is taken');
  const rs = await Promise.all([cancel(u, r.body.id), cancel(u, r.body.id)]);
  assert.equal(rs.filter((x) => x.status === 200).length, 1, rs.map((x) => `${x.status}:${x.body && (x.body.code || x.body.message)}`).join(' | '));
  assert.equal(await H.balancePaise('user', u.id), 50000, 'refunded exactly once');
  assert.equal((await H.ledger('user', u.id)).filter((x) => x.type === 'ORDER_REFUND').length, 1);
  assert.equal((await reload(c)).isUsed, false, 'the coupon is back');
  // Back means usable again, once.
  const again = await placeWith(u, item.id, c.code, 'Wallet');
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal((await reload(c)).isUsed, true);
});

test('cancel after the coupon expired: the order is refunded but the expired coupon is not revived', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { value: 40 });
  const r = await placeWith(u, item.id, c.code);
  assert.equal(r.status, 201);
  await H.ctx.M('Coupon').update({ expiryDate: new Date(Date.now() - 1000) }, { where: { id: c.id } });
  assert.equal((await cancel(u, r.body.id)).status, 200);
  assert.equal((await reload(c)).isUsed, true, 'stays used: it can no longer be spent');
});

test('the store never accepts: the auto-cancel job gives the coupon back', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const c = await mkCoupon(u, { value: 40 });
  const r = await placeWith(u, item.id, c.code);
  assert.equal(r.status, 201);
  await backdate(r.body.id, 61); // store-accept timeout is 60 min since 5 Nov 2026
  await H.r('controllers/orderController').autoCancelStalePendingOrders({ to: () => ({ emit() {} }), emit() {} });
  assert.equal((await H.ctx.M('Order').findByPk(r.body.id)).status, 'Cancelled');
  assert.equal((await reload(c)).isUsed, false);
});

test('admin revokes a coupon: it can no longer be used', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const admin = await H.mkUser({ role: 'admin' });
  const u = await H.mkUser();
  const c = await mkCoupon(u);
  const del = await api('DELETE', `/api/admin/coupons/${c.id}`, admin.token);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const r = await placeWith(u, item.id, c.code);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'COUPON_INVALID');
});
