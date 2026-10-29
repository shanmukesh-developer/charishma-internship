// Commission math: 1.5 % of the item total (round half up, in paise), snapshotted per booking; the student pays
// the item total only (no delivery or platform fee); stall earnings count paid, not-cancelled bookings.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const V = '/api/campus-booking/vendor';

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

test('commissionFor: 1.5 % rounded half up in paise; net = amount - commission', () => {
  const { commissionFor } = T.r('modules/campusBooking/services/bookings');
  const cases = [
    [8000, 120], // ₹80 -> ₹1.20 (board example)
    [1500, 23], // ₹15 -> 22.5 p -> 23 p
    [3300, 50], // ₹33 -> 49.5 p -> 50 p
    [100, 2], // ₹1 -> 1.5 p -> 2 p
    [2000, 30],
    [99999, 1500], // 1499.985 -> 1500
    [0, 0],
  ];
  for (const [amount, fee] of cases) {
    const c = commissionFor(amount);
    assert.strictEqual(c.commissionPct, 1.5);
    assert.strictEqual(c.commissionPaise, fee, `amount ${amount}`);
    assert.strictEqual(c.vendorNetPaise, amount - fee);
  }
});

test('the booking amount is the server price x quantity, no fees; commission snapshot stored on the row', async () => {
  const s = await T.mkStall({ prices: [20, 40] });
  const u = await T.mkUser();
  // Client prices are ignored: only menu ids and quantities count.
  const r = await T.book(u, s, [{ menuItemId: s.items[0].id, quantity: 2, price: 1 }, { menuItemId: s.items[1].id, quantity: 1, price: 1 }]);
  assert.strictEqual(r.status, 201);
  const b = r.body.booking;
  assert.strictEqual(b.amount, 80);
  assert.strictEqual(b.itemCount, 3);
  assert.deepStrictEqual(b.items.map((i) => [i.unitPrice, i.quantity, i.lineTotal]), [[20, 2, 40], [40, 1, 40]]);
  assert.match(b.payee.upiLink, /am=80\.00/);
  const row = await T.ctx.M('CampusBooking').findByPk(b.id);
  assert.strictEqual(row.amountPaise, 8000);
  assert.strictEqual(row.commissionPct, 1.5);
  assert.strictEqual(row.commissionPaise, 120);
  assert.strictEqual(row.vendorNetPaise, 7880);
  // A later price change never changes an existing booking.
  await s.items[0].update({ price: 25 });
  const again = (await T.cb('GET', `/api/campus-booking/bookings/${b.id}`, u.token)).body.booking;
  assert.strictEqual(again.amount, 80);
});

test('duplicate lines merge; quantity limits; ₹10,000 cap', async () => {
  const s = await T.mkStall({ prices: [30] });
  const u = await T.mkUser();
  const merged = await T.book(u, s, [{ menuItemId: s.items[0].id, quantity: 2 }, { menuItemId: s.items[0].id, quantity: 3 }]);
  assert.strictEqual(merged.body.booking.items.length, 1);
  assert.strictEqual(merged.body.booking.items[0].quantity, 5);
  assert.strictEqual((await T.book(u, s, [{ menuItemId: s.items[0].id, quantity: 0 }])).status, 400);
  assert.strictEqual((await T.book(u, s, [{ menuItemId: s.items[0].id, quantity: 11 }])).status, 400);
  assert.strictEqual((await T.book(u, s, [])).body.code, 'EMPTY_CART');
  const big = await T.mkStall({ prices: [600, 600] });
  const r = await T.book(u, big, [{ menuItemId: big.items[0].id, quantity: 10 }, { menuItemId: big.items[1].id, quantity: 10 }]);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'TOO_LARGE');
});

test('stall earnings: paid bookings only (cancelled and unpaid excluded), commission 1.5 % shown', async () => {
  const s = await T.mkStall({ prices: [80, 15] });
  const u1 = await T.mkUser();
  const u2 = await T.mkUser();
  const u3 = await T.mkUser();
  const pay = async (u, line, ref) => {
    const id = (await T.book(u, s, [line])).body.booking.id;
    await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: ref, imageUrl: await T.uploadProof(u) });
    return id;
  };
  const a = await pay(u1, { menuItemId: s.items[0].id, quantity: 1 }, 'ERN111222331'); // ₹80
  const b = await pay(u2, { menuItemId: s.items[1].id, quantity: 1 }, 'ERN111222332'); // ₹15
  const c = await pay(u3, { menuItemId: s.items[0].id, quantity: 1 }, 'ERN111222333'); // ₹80, cancelled after accept
  await T.book(u3, s, [{ menuItemId: s.items[1].id, quantity: 2 }]); // never paid
  for (const id of [a, b, c]) await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  await T.cb('POST', `${V}/bookings/${c}/cancel`, s.store.token, { code: 'OUT_OF_STOCK' });
  await T.cb('POST', `${V}/bookings/${a}/ready`, s.store.token, {});
  const code = (await T.ctx.M('CampusBooking').findByPk(a)).pickupCode;
  await T.cb('POST', `${V}/bookings/${a}/collect`, s.store.token, { code });

  const e = (await T.cb('GET', `${V}/earnings?range=today`, s.store.token)).body;
  assert.strictEqual(e.total, 95);
  assert.strictEqual(e.orders, 2);
  assert.strictEqual(e.collected, 1);
  assert.strictEqual(e.commissionPct, 1.5);
  assert.strictEqual(e.commission, 1.43); // 120 p + 23 p
  assert.strictEqual(e.net, 93.57);
  assert.deepStrictEqual(e.recent.map((x) => x.id).sort(), [a, b].sort());
  const sum = (await T.cb('GET', `${V}/summary`, s.store.token)).body;
  assert.strictEqual(sum.today.earnings, 95);
  assert.strictEqual(sum.today.paidOrders, 2);
  assert.strictEqual(sum.today.orders, 3, 'today = not cancelled (the unpaid one counts as an order, the cancelled one does not)');
  assert.strictEqual(sum.settings.commissionPct, 1.5);
  // Admin totals use the same snapshot.
  const admin = await T.mkUser({ role: 'admin' });
  const list = (await T.cb('GET', `/api/admin/campus-booking/bookings?storeId=${s.store.id}`, admin.token)).body;
  assert.strictEqual(list.total, 4);
  const rowA = list.bookings.find((x) => x.id === a);
  assert.strictEqual(rowA.commission, 1.2);
  assert.strictEqual(rowA.net, 78.8);
});
