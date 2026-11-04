// C8 order receipts: numbering (per financial year, unique + sequential + gap-free under parallel delivers),
// immutability, totals exactly as stored, access control, signed short-lived HTML link, FSSAI display,
// snapshot at issue, tax display settings.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let cust; let other; let rider;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  cust = await H.mkUser({ wallet: 5000, name: 'Asha Receipt Tester' });
  other = await H.mkUser();
  rider = await H.mkRider();
});
test.after(H.teardown);

const R = () => H.r('utils/receipts');
const delivered = async ({ store, item, method = 'COD', qty = 1 } = {}) => {
  if (!store) ({ store, item } = await H.mkStore());
  const order = await H.placeOrder({ item, user: cust, method, qty });
  const d = await H.adminDeliver(order.id, admin);
  assert.strictEqual(d.status, 200, JSON.stringify(d.body));
  const number = await H.waitReceipt(order.id);
  assert.ok(number, 'receipt number assigned after the Delivered flip');
  return { store, item, order, number };
};

test('unit: financial year is April-March in IST', () => {
  const { financialYearOf } = R();
  assert.strictEqual(financialYearOf('2026-03-31T18:29:00Z'), '2025-26'); // 31 Mar 23:59 IST
  assert.strictEqual(financialYearOf('2026-03-31T18:30:00Z'), '2026-27'); // 1 Apr 00:00 IST
  assert.strictEqual(financialYearOf('2026-10-18T10:00:00Z'), '2026-27');
  assert.strictEqual(financialYearOf('2099-12-31T00:00:00Z'), '2099-00');
});

test('receipt number is assigned at Delivered, in the ZNV/<FY>/<6 digits> format; never before', async () => {
  const { store, item } = await H.mkStore();
  const order = await H.placeOrder({ item, user: cust });
  let res = await H.api('GET', `/api/orders/${order.id}/receipt`, cust.token);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, 'RECEIPT_NOT_READY');
  assert.strictEqual(await R().assignReceiptNumber(order.id), null, 'not delivered: no number');
  await H.adminDeliver(order.id, admin);
  const n = await H.waitReceipt(order.id);
  assert.match(n, R().RECEIPT_NO_RE);
  assert.ok(n.startsWith(`ZNV/${R().financialYearOf(new Date())}/`));
  res = await H.api('GET', `/api/orders/${order.id}/receipt`, cust.token);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.receipt.receiptNumber, n);
  assert.strictEqual(res.body.receipt.seller.name, store.name);
  const mine = await H.api('GET', '/api/orders/myorders', cust.token);
  assert.strictEqual(mine.body.find((o) => o.id === order.id).receiptNumber, n);
});

test('totals match the stored order exactly (COD with packaging fee, Wallet, quantity > 1)', async () => {
  const { store, item } = await H.mkStore({ price: 123.45, packagingFee: 12 });
  for (const method of ['COD', 'Wallet']) {
    const { order } = await delivered({ store, item, method, qty: 3 });
    const row = await H.ctx.M('Order').findByPk(order.id, { raw: true });
    const pb = typeof row.priceBreakdown === 'string' ? JSON.parse(row.priceBreakdown) : row.priceBreakdown;
    const res = await H.api('GET', `/api/orders/${order.id}/receipt`, cust.token);
    assert.strictEqual(res.status, 200);
    const rc = res.body.receipt;
    assert.strictEqual(rc.amounts.total, row.finalPrice);
    assert.strictEqual(rc.amounts.itemsSubtotal, pb.subtotal);
    assert.strictEqual(rc.amounts.packagingFee, pb.packagingFee);
    assert.strictEqual(rc.amounts.packagingFee, 12);
    assert.strictEqual(rc.amounts.deliveryFee, pb.deliveryFee);
    assert.strictEqual(rc.amounts.totalDiscount, pb.totalDiscount);
    assert.strictEqual(rc.amounts.taxesCharged, 0);
    assert.strictEqual(rc.amounts.adjustment, undefined, 'stored lines add up to the stored total');
    assert.strictEqual(rc.items.length, 1);
    assert.strictEqual(rc.items[0].quantity, 3);
    assert.strictEqual(rc.items[0].unitPrice, 123.45);
    assert.strictEqual(rc.items[0].lineTotal, 370.35);
    if (method === 'Wallet') { assert.strictEqual(rc.payment.walletUsed, row.finalPrice); assert.strictEqual(rc.payment.cashCollected, 0); }
    else { assert.strictEqual(rc.payment.cashCollected, row.finalPrice); assert.strictEqual(rc.payment.walletUsed, 0); }
    assert.strictEqual(rc.tax.mode, 'inclusive');
    assert.strictEqual(rc.tax.note, 'Prices inclusive of applicable taxes');
    assert.strictEqual(rc.customer.name, 'Asha');
  }
});

test('access: customer, its store and admin 200; another customer / store / a rider 404', async () => {
  const { store, order } = await delivered();
  const { store: store2 } = await H.mkStore();
  assert.strictEqual((await H.api('GET', `/api/orders/${order.id}/receipt`, cust.token)).status, 200);
  assert.strictEqual((await H.api('GET', `/api/orders/${order.id}/receipt`, store.token)).status, 200);
  assert.strictEqual((await H.api('GET', `/api/orders/${order.id}/receipt`, admin.token)).status, 200);
  for (const t of [other.token, store2.token, rider.token]) {
    const res = await H.api('GET', `/api/orders/${order.id}/receipt`, t);
    assert.strictEqual(res.status, 404);
    assert.ok(!JSON.stringify(res.body).includes('ZNV/'));
  }
  assert.strictEqual((await H.api('GET', `/api/orders/${order.id}/receipt`)).status, 401);
  assert.strictEqual((await H.api('GET', '/api/orders/not-a-uuid/receipt', cust.token)).status, 404);
});

test('receipt numbers are unique, sequential and gap-free under parallel delivers', async () => {
  const { item } = await H.mkStore();
  const orders = [];
  for (let i = 0; i < 12; i++) orders.push(await H.placeOrder({ item, user: cust }));
  const before = await H.ctx.M('ReceiptCounter').findByPk(R().seriesOf(new Date()));
  const start = before ? before.lastNumber : 0;
  // All delivered at once, and every order's receipt also requested at once (racing the hook).
  const results = await Promise.all(orders.flatMap((o) => [H.adminDeliver(o.id, admin), R().assignReceiptNumber(o.id), R().assignReceiptNumber(o.id)]));
  for (let i = 0; i < results.length; i += 3) assert.strictEqual(results[i].status, 200);
  const numbers = [];
  for (const o of orders) numbers.push(await H.waitReceipt(o.id));
  assert.strictEqual(new Set(numbers).size, orders.length, 'unique');
  const seqs = numbers.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
  assert.deepStrictEqual(seqs, Array.from({ length: orders.length }, (_, i) => start + i + 1), 'sequential, no gaps');
  await new Promise((res) => setTimeout(res, 150));
  const after = await H.ctx.M('ReceiptCounter').findByPk(R().seriesOf(new Date()));
  assert.strictEqual(after.lastNumber, start + orders.length, 'lost races rolled their increment back');
});

test('a receipt number is immutable once assigned', async () => {
  const { order, number } = await delivered();
  const Order = H.ctx.M('Order');
  await assert.rejects(Order.update({ receiptNumber: 'ZNV/2026-27/999999' }, { where: { id: order.id } }), /receipt/i);
  await assert.rejects(Order.update({ receiptSnapshot: '{}' }, { where: { id: order.id } }), /receipt/i);
  const row = await Order.findByPk(order.id);
  row.receiptNumber = 'ZNV/2026-27/888888';
  await assert.rejects(row.save(), /immutable/);
  assert.strictEqual(await R().assignReceiptNumber(order.id), number, 'second assignment returns the same number');
  assert.strictEqual((await Order.findByPk(order.id)).receiptNumber, number);
  // Ordinary order updates still work.
  await Order.update({ rating: 5 }, { where: { id: order.id } });
});

test('seller FSSAI: shown when set, "not provided" (muted) when missing; snapshot frozen at issue', async () => {
  const { store: noLic, item: i1 } = await H.mkStore();
  const a = await delivered({ store: noLic, item: i1 });
  let res = await H.api('GET', `/api/orders/${a.order.id}/receipt`, cust.token);
  assert.strictEqual(res.body.receipt.seller.fssaiLicenseNumber, null);
  assert.strictEqual(res.body.receipt.seller.fssaiText, 'FSSAI licence not provided');
  let html = await (await H.raw('GET', res.body.url)).text();
  assert.match(html, /<p class="muted">FSSAI licence not provided<\/p>/);

  const num = H.fakeFssai();
  const { store, item } = await H.mkStore({ extra: { fssaiLicenseNumber: num, legalName: 'C8 Legal Kitchen LLP', gstin: '37ABCDE1234F1Z5' } });
  const b = await delivered({ store, item });
  res = await H.api('GET', `/api/orders/${b.order.id}/receipt`, cust.token);
  assert.strictEqual(res.body.receipt.seller.fssaiText, `FSSAI Lic. No. ${num}`);
  assert.strictEqual(res.body.receipt.seller.gstin, '37ABCDE1234F1Z5');
  html = await (await H.raw('GET', res.body.url)).text();
  assert.ok(html.includes(`FSSAI Lic. No. ${num}`));
  assert.ok(html.includes('C8 Legal Kitchen LLP'));
  assert.ok(html.includes(b.number));

  // The store changes its licence later: the issued receipt does not change.
  await store.update({ fssaiLicenseNumber: H.fakeFssai() });
  res = await H.api('GET', `/api/orders/${b.order.id}/receipt`, cust.token);
  assert.strictEqual(res.body.receipt.seller.fssaiLicenseNumber, num);
});

test('signed receipt link: opens without login, expires, rejects tampered and login tokens', async () => {
  const { order, number } = await delivered();
  const res = await H.api('GET', `/api/orders/${order.id}/receipt`, cust.token);
  assert.match(res.body.url, /\/receipts\/[^/]+$/);
  assert.ok(new Date(res.body.urlExpiresAt).getTime() - Date.now() <= 15 * 60 * 1000 + 5000);
  const page = await H.raw('GET', res.body.url);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.strictEqual(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.ok(html.includes(number));
  assert.ok(html.includes('Prices inclusive of applicable taxes'));
  assert.ok(!html.includes('<script'), 'no scripts');

  const expired = R().signLink(order.id, { ttlSec: -10 });
  const e = await H.raw('GET', `/receipts/${expired}`);
  assert.strictEqual(e.status, 410);
  assert.ok((await e.text()).includes('expired'));
  const token = res.body.url.split('/receipts/')[1];
  const tampered = `${token.slice(0, -3)}${token.slice(-3) === 'AAA' ? 'BBB' : 'AAA'}`;
  assert.strictEqual((await H.raw('GET', `/receipts/${tampered}`)).status, 404);
  // A login token (same JWT_SECRET) is not a receipt link, and a receipt link is not a login token.
  assert.strictEqual((await H.raw('GET', `/receipts/${cust.token}`)).status, 404);
  assert.strictEqual((await H.api('GET', '/api/orders/myorders', token)).status, 401);
  // A link for a not-delivered order shows nothing.
  const { item } = await H.mkStore();
  const pending = await H.placeOrder({ item, user: cust });
  assert.strictEqual((await H.raw('GET', `/receipts/${R().signLink(pending.id)}`)).status, 404);
});

test('a pre-C8 delivered order gets its number on first receipt request (lazy, once)', async () => {
  const { item } = await H.mkStore();
  const order = await H.placeOrder({ item, user: cust });
  // Delivered without the hook (as before C8): raw SQL flip.
  await H.ctx.sequelize.query('UPDATE "Orders" SET "status" = \'Delivered\', "deliveredAt" = :now WHERE "id" = :id', { replacements: { id: order.id, now: new Date().toISOString() } });
  const [a, b] = await Promise.all([
    H.api('GET', `/api/orders/${order.id}/receipt`, cust.token),
    H.api('GET', `/api/orders/${order.id}/receipt`, admin.token),
  ]);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(a.body.receipt.receiptNumber, b.body.receipt.receiptNumber);
});

test('tax display: breakdown refused without GSTIN + rate; with both, GST contained in the total is shown, total unchanged', async () => {
  await H.resetSettings();
  let res = await H.api('PUT', '/api/admin/receipt-settings', admin.token, { taxDisplayMode: 'breakdown' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'INVALID_RECEIPT_SETTINGS');
  res = await H.api('PUT', '/api/admin/receipt-settings', admin.token, { platformGstin: '37ABCDE1234F1Z5', gstRatePercent: 5, taxDisplayMode: 'breakdown', footerNote: 'Thank you for ordering on ZENV.' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.effectiveTaxDisplayMode, 'breakdown');
  const { order } = await delivered();
  const rc = (await H.api('GET', `/api/orders/${order.id}/receipt`, cust.token)).body.receipt;
  const row = await H.ctx.M('Order').findByPk(order.id, { raw: true });
  assert.strictEqual(rc.amounts.total, row.finalPrice);
  assert.strictEqual(rc.tax.mode, 'breakdown');
  assert.strictEqual(rc.platform.gstin, '37ABCDE1234F1Z5');
  assert.strictEqual(Math.round((rc.tax.taxableValue + rc.tax.gstIncluded) * 100), Math.round(row.finalPrice * 100));
  assert.strictEqual(Math.round((rc.tax.cgst + rc.tax.sgst) * 100), Math.round(rc.tax.gstIncluded * 100));
  assert.strictEqual(rc.footerNote, 'Thank you for ordering on ZENV.');
  await H.resetSettings();
});
