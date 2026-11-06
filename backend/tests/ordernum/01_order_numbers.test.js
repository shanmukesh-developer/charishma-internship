// Human order IDs through the real order / admin routes (C8 harness: temp SQLite, real routers). A fresh server's
// first order is ZEN-1, the next ZEN-2; parallel checkouts (and one basket placed as parallel per-restaurant orders)
// get distinct numbers with no duplicates; a client can neither choose nor change the number; every order payload
// (create, my orders, detail, admin list, receipt, wallet history) carries orderNumber + orderCode; the admin and
// customer searches find "ZEN-123" / "123".
const test = require('node:test');
const assert = require('node:assert');
const H = require('../c8/helpers');

const ON = () => H.r('utils/orderNumbers');
let admin; let cust;

test.before(async () => {
  await H.setup();
  // The other two numbered tables share the counter (MegaBaskets, CampusBookings).
  H.r('models/MegaBasket').initMegaBasketModel(H.ctx.sequelize);
  H.r('modules/campusBooking').initCampusBookingModels(H.ctx.sequelize);
  await H.ctx.sequelize.models.MegaBasket.sync();
  await H.ctx.sequelize.models.CampusBooking.sync();
  const m = await ON().runOrderNumberMigrations(H.ctx.sequelize);
  assert.ok(m.ok, JSON.stringify(m));
  assert.strictEqual(m.numbered, 0);
  admin = await H.mkUser({ role: 'admin' });
  cust = await H.mkUser({ wallet: 5000 });
});
test.after(H.teardown);

const place = async (user, item, extra = {}) => {
  const res = await H.api('POST', '/api/orders', user.token, { ...{ items: [{ menuItemId: item.id, quantity: 1 }], paymentMethod: 'COD', deliveryAddress: 'Block A, Room 101, SRM AP', campus: 'srmap' }, ...extra });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return res.body;
};
const numbersInDb = async () => (await H.ctx.M('Order').findAll({ attributes: ['orderNumber'], raw: true })).map((o) => o.orderNumber);

test('unit: code, label, fields and search parsing', () => {
  const { codeOf, label, fields, parseCode } = ON();
  assert.strictEqual(codeOf(1), 'ZEN-1');
  assert.strictEqual(codeOf(null), null);
  assert.strictEqual(codeOf(0), null);
  assert.deepStrictEqual(fields({ orderNumber: 42 }), { orderNumber: 42, orderCode: 'ZEN-42' });
  assert.deepStrictEqual(fields({}), { orderNumber: null, orderCode: null });
  assert.strictEqual(label({ id: '0e5f7a2c-1111-4222-8333-abcdef123456', orderNumber: 7 }), 'ZEN-7');
  assert.strictEqual(label({ id: '0e5f7a2c-1111-4222-8333-abcdef123456' }), '#123456', 'old short id when not numbered');
  for (const [q, n] of [['ZEN-123', 123], ['zen 123', 123], ['zen123', 123], ['#123', 123], ['123', 123], [' 5 ', 5]]) assert.strictEqual(parseCode(q), n, q);
  for (const q of ['', 'ZEN-', 'abc', 'ZEN-12a', '-1', '0', '99999999999']) assert.strictEqual(parseCode(q), null, q);
});

test('the first order ever is ZEN-1 and the next is ZEN-2 (create reply carries orderNumber + orderCode)', async () => {
  const { item } = await H.mkStore();
  const a = await place(cust, item);
  assert.strictEqual(a.orderNumber, 1);
  assert.strictEqual(a.orderCode, 'ZEN-1');
  const b = await place(cust, item);
  assert.strictEqual(b.orderNumber, 2);
  assert.strictEqual(b.orderCode, 'ZEN-2');
});

test('a client cannot choose the number, and an update can never change it', async () => {
  const { item } = await H.mkStore();
  const before = Math.max(...(await numbersInDb()));
  const o = await place(cust, item, { orderNumber: 99999, orderCode: 'ZEN-99999' });
  assert.strictEqual(o.orderNumber, before + 1, 'next number, the body value is ignored');
  const Order = H.ctx.M('Order');
  await Order.update({ orderNumber: 5, status: 'Accepted' }, { where: { id: o.id } });
  const row = await Order.findByPk(o.id);
  assert.strictEqual(row.orderNumber, before + 1, 'bulk update drops orderNumber');
  assert.strictEqual(row.status, 'Accepted', 'the rest of the update still applies');
  row.orderNumber = 7;
  await row.save();
  assert.strictEqual((await Order.findByPk(o.id)).orderNumber, before + 1, 'instance save keeps the number');
});

test('parallel checkouts by many customers: every order gets its own number, no duplicates, no reuse', async () => {
  const stores = await Promise.all(Array.from({ length: 4 }, () => H.mkStore()));
  const users = await Promise.all(Array.from({ length: 10 }, () => H.mkUser()));
  const before = Math.max(...(await numbersInDb()));
  const placed = await Promise.all(users.map((u, i) => place(u, stores[i % stores.length].item)));
  const nums = placed.map((o) => o.orderNumber);
  assert.ok(nums.every((n) => Number.isInteger(n) && n > before), JSON.stringify(nums));
  assert.strictEqual(new Set(nums).size, nums.length, 'unique');
  // SQLite counter never skips (no rollbacks here): exactly the next 10 numbers.
  assert.deepStrictEqual([...nums].sort((x, y) => x - y), Array.from({ length: 10 }, (_, i) => before + 1 + i));
  const all = await numbersInDb();
  assert.strictEqual(new Set(all).size, all.length, 'no duplicate anywhere in Orders');
  for (const o of placed) assert.strictEqual(o.orderCode, `ZEN-${o.orderNumber}`);
});

test('one basket with several restaurants (parallel per-restaurant orders) gets distinct numbers', async () => {
  const u = await H.mkUser({ wallet: 2000 });
  const stores = await Promise.all([H.mkStore(), H.mkStore(), H.mkStore()]);
  const placed = await Promise.all(stores.map(({ item }, i) => place(u, item, { paymentMethod: i === 1 ? 'Wallet' : 'COD' })));
  const nums = placed.map((o) => o.orderNumber);
  assert.strictEqual(new Set(nums).size, 3, JSON.stringify(nums));
  assert.ok(nums.every((n) => Number.isInteger(n) && n > 0));
  // The customer's list shows each one with its own code.
  const mine = await H.api('GET', '/api/orders/myorders', u.token);
  assert.strictEqual(mine.status, 200);
  assert.deepStrictEqual(mine.body.map((o) => o.orderCode).sort(), nums.map((n) => `ZEN-${n}`).sort());
});

test('payloads: my orders, order detail, admin list, receipt and wallet history carry the code', async () => {
  const u = await H.mkUser({ wallet: 1000 });
  const { item } = await H.mkStore();
  const o = await place(u, item, { paymentMethod: 'Wallet' });
  const code = `ZEN-${o.orderNumber}`;

  const mine = await H.api('GET', '/api/orders/myorders', u.token);
  assert.strictEqual(mine.body[0].orderCode, code);
  assert.strictEqual(mine.body[0].orderNumber, o.orderNumber);

  const detail = await H.api('GET', `/api/orders/${o.id}`, u.token);
  assert.strictEqual(detail.status, 200, JSON.stringify(detail.body));
  assert.strictEqual(detail.body.orderCode, code);

  const list = await H.api('GET', '/api/admin/orders', admin.token);
  assert.strictEqual(list.status, 200);
  const row = list.body.orders.find((x) => x.id === o.id);
  assert.ok(row);
  assert.strictEqual(row.orderCode, code);
  assert.strictEqual(row.orderNumber, o.orderNumber);

  const d = await H.adminDeliver(o.id, admin);
  assert.strictEqual(d.status, 200, JSON.stringify(d.body));
  assert.ok(await H.waitReceipt(o.id));
  const rc = await H.api('GET', `/api/orders/${o.id}/receipt`, u.token);
  assert.strictEqual(rc.status, 200, JSON.stringify(rc.body));
  const receipt = rc.body.receipt || rc.body;
  assert.strictEqual(receipt.orderRef, code);
  assert.strictEqual(receipt.orderCode, code);

  const wl = H.r('utils/walletLedger');
  const { rows } = await wl.listFor({ ownerType: 'user', ownerId: u.id, sequelize: H.ctx.sequelize });
  const pay = rows.map(wl.toPublic).find((r) => r.ref && r.ref.type === 'ORDER' && r.ref.id === o.id);
  assert.ok(pay, 'wallet payment row');
  assert.strictEqual(pay.ref.label, `Order ${code}`);
  assert.strictEqual(pay.ref.orderCode, code);
});

test('admin search finds an order by "ZEN-n", "n" and the old short id; customer search by code', async () => {
  const u = await H.mkUser();
  const { item } = await H.mkStore();
  const o = await place(u, item);
  for (const q of [`ZEN-${o.orderNumber}`, `zen ${o.orderNumber}`, String(o.orderNumber), `#${o.orderNumber}`]) {
    const r = await H.api('GET', `/api/admin/orders?q=${encodeURIComponent(q)}`, admin.token);
    assert.strictEqual(r.status, 200, q);
    assert.ok(r.body.orders.some((x) => x.id === o.id), q);
    if (q.toLowerCase().startsWith('zen')) assert.ok(r.body.orders.every((x) => x.orderNumber === o.orderNumber), q);
  }
  const short = await H.api('GET', `/api/admin/orders?q=${encodeURIComponent(`#${o.id.slice(-6).toUpperCase()}`)}`, admin.token);
  assert.ok(short.body.orders.some((x) => x.id === o.id), 'old short reference still works');
  const none = await H.api('GET', `/api/admin/orders?q=${encodeURIComponent('ZEN-987654')}`, admin.token);
  assert.strictEqual(none.body.orders.length, 0);
  const mine = await H.api('GET', `/api/orders/myorders?q=${encodeURIComponent(`ZEN-${o.orderNumber}`)}`, u.token);
  assert.strictEqual(mine.status, 200);
  assert.deepStrictEqual(mine.body.map((x) => x.id), [o.id]);
});

test('MegaBaskets and CampusBookings draw from the same counter (one server-wide count)', async () => {
  const before = Math.max(...(await numbersInDb()));
  const u = await H.mkUser();
  const { store, item } = await H.mkStore();
  const basket = await H.ctx.M('MegaBasket').create({ userId: u.id, estimatedTotal: 100, deliveryAddress: 'Block B' });
  const booking = await H.ctx.M('CampusBooking').create({ userId: u.id, restaurantId: store.id, ref: 'CBT1', pickupCode: 'AB12', items: [] });
  const o = await place(u, item);
  assert.strictEqual(basket.orderNumber, before + 1);
  assert.strictEqual(booking.orderNumber, before + 2);
  assert.strictEqual(o.orderNumber, before + 3);
  assert.strictEqual(basket.toJSON().orderCode, `ZEN-${before + 1}`);
  const ser = H.r('modules/campusBooking/services/serialize');
  const out = ser.forVendor(booking, { name: 'Test Student' });
  assert.strictEqual(out.orderCode, `ZEN-${before + 2}`);
  assert.strictEqual(out.orderNumber, before + 2);
  assert.strictEqual(out.ref, 'CBT1', 'the booking ref stays');
});

test('reads that list attributes still get orderNumber + orderCode (and grouped reads are untouched)', async () => {
  const Order = H.ctx.M('Order');
  const one = await Order.findOne({ attributes: ['id', 'status'], order: [['createdAt', 'ASC']] });
  assert.strictEqual(one.toJSON().orderCode, 'ZEN-1');
  const raw = await Order.findOne({ attributes: ['id'], order: [['createdAt', 'ASC']], raw: true });
  assert.strictEqual(raw.orderNumber, 1);
  const grouped = await Order.findAll({ attributes: ['status', [H.ctx.sequelize.fn('COUNT', H.ctx.sequelize.col('id')), 'n']], group: ['status'], raw: true });
  assert.ok(grouped.length >= 1);
  assert.ok(!('orderNumber' in grouped[0]));
});
