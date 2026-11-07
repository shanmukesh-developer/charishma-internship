// Partner-app polish (21 Oct): rider earnings history by day / week (GET /api/delivery/stats/range),
// whole-category stock switch (PUT /api/restaurants/:id/menu/category-stock) and the waiting-order
// reminder pushes for store phones (utils/storeOrderReminder).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
before(async () => { await H.setup(); });
after(H.teardown);

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;
const istKey = (ms) => new Date(ms + IST).toISOString().slice(0, 10);

const delivered = async (rider, store, user, { at, fee = 30, method = 'Wallet', price = 100 }) => H.ctx.M('Order').create({
  userId: user.id, restaurantId: store.id, items: [], totalPrice: price, deliveryFee: fee, finalPrice: price + fee, paymentMethod: method,
  paymentStatus: 'Completed', status: 'Delivered', deliveryPartnerId: rider.id, deliveredAt: new Date(at), fulfilment: 'ZENVY',
});

test('stats/range: day and week buckets, totals, own orders only, validation', async () => {
  const d = await H.mkRider();
  const other = await H.mkRider();
  const { store } = await H.mkStore();
  const u = await H.mkUser();
  const now = Date.now();
  await delivered(d, store, u, { at: now - 60 * 1000, fee: 40 }); // today
  await delivered(d, store, u, { at: now - 2 * DAY, fee: 0, method: 'COD' }); // ₹30 base fee, COD ₹100
  await delivered(d, store, u, { at: now - 20 * DAY, fee: 25 });
  await delivered(d, store, u, { at: now - 40 * DAY, fee: 50 }); // outside the default 30 days
  await delivered(other, store, u, { at: now - 60 * 1000, fee: 99 }); // another rider

  const r = await api('GET', '/api/delivery/stats/range', d.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.days.length, 30);
  assert.equal(r.body.to, istKey(now));
  assert.equal(r.body.days[r.body.days.length - 1].date, istKey(now));
  assert.equal(r.body.totalOrders, 3);
  assert.equal(r.body.totalEarningsPaise, 4000 + 3000 + 2500);
  assert.equal(r.body.totalEarnings, 95);
  assert.equal(r.body.codCollectedPaise, 10000);
  assert.equal(r.body.timezone, 'Asia/Kolkata');
  const today = r.body.days.find((x) => x.date === istKey(now));
  assert.equal(today.earnings, 40);
  assert.equal(today.orders, 1);
  // Weeks add up to the days and start on a Monday.
  assert.equal(r.body.weeks.reduce((s, w) => s + w.earningsPaise, 0), r.body.totalEarningsPaise);
  assert.equal(r.body.weeks.reduce((s, w) => s + w.orders, 0), 3);
  for (const w of r.body.weeks) assert.equal(new Date(`${w.weekStart}T00:00:00Z`).getUTCDay(), 1, w.weekStart);
  assert.equal(r.body.weeks[0].from, r.body.from);

  // ?days= and from / to
  const week = await api('GET', '/api/delivery/stats/range?days=7', d.token);
  assert.equal(week.body.days.length, 7);
  assert.equal(week.body.totalOrders, 2);
  const from = istKey(now - 45 * DAY);
  const to = istKey(now - 30 * DAY);
  const old = await api('GET', `/api/delivery/stats/range?from=${from}&to=${to}`, d.token);
  assert.equal(old.status, 200);
  assert.equal(old.body.totalOrders, 1);
  assert.equal(old.body.totalEarnings, 50);
  // A future "to" is clipped to today.
  const fut = await api('GET', `/api/delivery/stats/range?from=${istKey(now - 2 * DAY)}&to=2099-01-01`, d.token);
  assert.equal(fut.body.to, istKey(now));
  assert.equal(fut.body.days.length, 3);

  assert.equal((await api('GET', '/api/delivery/stats/range?from=2026-13-01', d.token)).status, 400);
  assert.equal((await api('GET', `/api/delivery/stats/range?from=${istKey(now)}&to=${istKey(now - DAY)}`, d.token)).status, 400);
  const tooLong = await api('GET', `/api/delivery/stats/range?from=${istKey(now - 200 * DAY)}`, d.token);
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.code, 'RANGE_TOO_LONG');
  // Riders only.
  assert.equal((await api('GET', '/api/delivery/stats/range', u.token)).status, 403);
  assert.equal((await api('GET', '/api/delivery/stats/range')).status, 401);
});

test('category-stock: switches only that category of the store\'s own items, Other covers no category', async () => {
  const { store, item } = await H.mkStore();
  const other = await H.mkStore();
  const MI = H.ctx.M('MenuItem');
  await item.update({ category: 'Snacks' });
  const snack2 = await MI.create({ restaurantId: store.id, name: 'Samosa', price: 20, category: ' Snacks ', isAvailable: true });
  const timed = await MI.create({ restaurantId: store.id, name: 'Puff', price: 25, category: 'Snacks', isAvailable: false, outOfStockUntil: new Date(Date.now() + 3600 * 1000) });
  const drink = await MI.create({ restaurantId: store.id, name: 'Tea', price: 10, category: 'Drinks', isAvailable: true });
  const loose = await MI.create({ restaurantId: store.id, name: 'Mystery', price: 10, category: null, isAvailable: true });
  await other.item.update({ category: 'Snacks' });

  const off = await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, store.token, { category: 'Snacks', isAvailable: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.total, 3);
  assert.equal(off.body.updated, 2); // the timed one was already out
  const ids = off.body.items.map((x) => x.id).sort();
  assert.deepEqual(ids, [item.id, snack2.id, timed.id].sort());
  assert.equal((await MI.findByPk(item.id)).isAvailable, false);
  assert.equal((await MI.findByPk(snack2.id)).isAvailable, false);
  assert.ok((await MI.findByPk(timed.id)).outOfStockUntil, 'an existing back-at time is kept when switching off');
  assert.equal((await MI.findByPk(drink.id)).isAvailable, true);
  assert.equal((await MI.findByPk(other.item.id)).isAvailable, true, 'another store\'s item never changes');

  const on = await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, store.token, { category: 'Snacks', isAvailable: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.updated, 3);
  const t = await MI.findByPk(timed.id);
  assert.equal(t.isAvailable, true);
  assert.equal(t.outOfStockUntil, null);

  const oth = await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, store.token, { category: 'Other', isAvailable: false });
  assert.equal(oth.status, 200);
  assert.deepEqual(oth.body.items.map((x) => x.id), [loose.id]);
  assert.equal((await MI.findByPk(loose.id)).isAvailable, false);

  // Another store cannot switch this store's menu; bad input; unknown category.
  assert.equal((await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, other.store.token, { category: 'Snacks', isAvailable: false })).status, 403);
  assert.equal((await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, store.token, { category: '', isAvailable: false })).status, 400);
  assert.equal((await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, store.token, { category: 'Snacks', isAvailable: 'no' })).status, 400);
  assert.equal((await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, store.token, { category: 'Biryani', isAvailable: false })).status, 404);
  const u = await H.mkUser();
  assert.equal((await api('PUT', `/api/restaurants/${store.id}/menu/category-stock`, u.token, { category: 'Snacks', isAvailable: false })).status, 403);
});

test('waiting-order reminders: Pending only, at most N per order, gap respected, last minute skipped, can be turned off', async () => {
  const R = H.r('utils/storeOrderReminder');
  R._resetReminders();
  // Reminder mechanics against a short 7-minute accept window (the default is 60 min since 5 Nov 2026).
  const prevTimeout = process.env.STORE_ACCEPT_TIMEOUT_MIN;
  process.env.STORE_ACCEPT_TIMEOUT_MIN = '7';
  const { store } = await H.mkStore();
  const u = await H.mkUser();
  const Order = H.ctx.M('Order');
  const now = Date.now();
  const mk = (ageMs, status = 'Pending') => Order.create({
    userId: u.id, restaurantId: store.id, items: [{ name: 'Dosa', quantity: 2 }], totalPrice: 100, deliveryFee: 0, finalPrice: 120, paymentMethod: 'COD',
    paymentStatus: 'Pending', status, createdAt: new Date(now - ageMs),
  });
  const waiting = await mk(2 * 60 * 1000);
  const fresh = await mk(30 * 1000); // too new: the first push just rang
  const late = await mk(6.5 * 60 * 1000); // last minute before the 7 min cancel
  const accepted = await mk(3 * 60 * 1000, 'Accepted');
  // createdAt is set by Sequelize on create: force the ages.
  for (const [o, age] of [[waiting, 2 * 60 * 1000], [fresh, 30 * 1000], [late, 6.5 * 60 * 1000], [accepted, 3 * 60 * 1000]]) {
    await Order.update({ createdAt: new Date(now - age) }, { where: { id: o.id }, silent: true });
  }
  const calls = [];
  const push = async (...args) => { calls.push(args); return { successCount: 1 }; };

  const prevMax = process.env.STORE_ORDER_REMINDER_MAX;
  delete process.env.STORE_ORDER_REMINDER_MAX;
  delete process.env.STORE_ORDER_REMINDER_PUSH;
  const first = await R.remindPendingStoreOrders({ now, push });
  assert.equal(first, 1);
  assert.equal(calls.length, 1);
  const [rid, title, body, data, opts] = calls[0];
  assert.equal(rid, store.id);
  assert.equal(title, 'Order still waiting');
  assert.match(body, /^2 items · ₹120 \(cash\)\. Accept it in the next 5 min or it will be cancelled\.$/);
  assert.deepEqual(data, { orderId: String(waiting.id), type: 'NEW_ORDER', reminder: '1' });
  assert.deepEqual(opts, { tag: `order-${waiting.id}` });
  assert.doesNotMatch(`${title} ${body}`, /!/);

  // The store accepts the newer order: it is never reminded.
  await fresh.update({ status: 'Accepted' });
  // The schedule for a 7-minute window is minutes 1.5 and 5 (utils/storeOrderReminder reminderOffsetsMin): the same
  // tick again and minute 4 send nothing, minute 5 sends the second, minute 6 is past the end of the schedule.
  assert.equal(await R.remindPendingStoreOrders({ now: now + 30 * 1000, push }), 0);
  assert.equal(await R.remindPendingStoreOrders({ now: now + 120 * 1000, push }), 0);
  assert.equal(await R.remindPendingStoreOrders({ now: now + 180 * 1000, push }), 1);
  assert.equal(await R.remindPendingStoreOrders({ now: now + 240 * 1000, push }), 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c[3].orderId === String(waiting.id)));

  // Turned off by env.
  R._resetReminders();
  process.env.STORE_ORDER_REMINDER_PUSH = 'off';
  assert.equal(await R.remindPendingStoreOrders({ now, push }), 0);
  delete process.env.STORE_ORDER_REMINDER_PUSH;
  process.env.STORE_ORDER_REMINDER_MAX = '0';
  assert.equal(await R.remindPendingStoreOrders({ now, push }), 0);
  if (prevMax === undefined) delete process.env.STORE_ORDER_REMINDER_MAX; else process.env.STORE_ORDER_REMINDER_MAX = prevMax;
  assert.equal(calls.length, 2);

  // The real push path: a store without device tokens is a quiet no-op (never throws).
  R._resetReminders();
  assert.equal(await R.remindPendingStoreOrders({ now }), 1);
  if (prevTimeout === undefined) delete process.env.STORE_ACCEPT_TIMEOUT_MIN; else process.env.STORE_ACCEPT_TIMEOUT_MIN = prevTimeout;
});

test('PF-04: reminders keep coming across the whole 60-minute accept window, until accept or the auto-cancel', async () => {
  const R = H.r('utils/storeOrderReminder');
  R._resetReminders();
  delete process.env.STORE_ACCEPT_TIMEOUT_MIN;
  delete process.env.STORE_ORDER_REMINDER_MAX;
  delete process.env.STORE_ORDER_REMINDER_PUSH;
  assert.deepEqual(R.reminderOffsetsMin(60), [1.5, 5, 10, 15, 20, 30, 40, 50, 55]);
  const { store } = await H.mkStore();
  const u = await H.mkUser();
  const Order = H.ctx.M('Order');
  const t0 = Date.now();
  const o = await Order.create({ userId: u.id, restaurantId: store.id, items: [{ name: 'Idli', quantity: 1 }], totalPrice: 60, deliveryFee: 0, finalPrice: 60, paymentMethod: 'COD', paymentStatus: 'Pending', status: 'Pending' });
  await Order.update({ createdAt: new Date(t0) }, { where: { id: o.id }, silent: true });
  const at = [];
  const push = async (rid, title, body, data) => { if (data.orderId === String(o.id)) at.push({ min: null, body }); return { successCount: 1 }; };
  // The job ticks every 2 minutes for the whole hour.
  const minutes = [];
  for (let m = 0; m <= 60; m += 2) {
    const before = at.length;
    await R.remindPendingStoreOrders({ now: t0 + m * 60 * 1000, push });
    if (at.length > before) minutes.push(m);
  }
  assert.deepEqual(minutes, [2, 6, 10, 16, 20, 30, 40, 50, 56], 'one reminder per schedule point, the last 4 min before the cancel');
  assert.ok(minutes.every((m, i) => i === 0 || m - minutes[i - 1] <= 10), 'never more than 10 minutes of silence');
  assert.match(at[at.length - 1].body, /Accept it in the next 4 min/);
  // Accepted: no more reminders.
  R._resetReminders();
  await o.update({ status: 'Accepted' });
  at.length = 0;
  await R.remindPendingStoreOrders({ now: t0 + 30 * 60 * 1000, push });
  assert.equal(at.length, 0);
});

test('PF-04: the store gets storeAcceptBy (the accept deadline) in the new-order event and in its order list', async () => {
  const { item, store } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  H.ctx.emitted.length = 0;
  const order = await H.placeOrder({ item, user: u });
  await new Promise((r) => setTimeout(r, 200));
  const ev = H.ctx.emitted.find((e) => e.ev === 'restaurant_newOrder' && e.room === `restaurant_${store.id}`);
  assert.ok(ev, 'restaurant_newOrder sent');
  const placed = new Date((await H.ctx.M('Order').findByPk(order.id)).createdAt).getTime();
  assert.equal(new Date(ev.p.storeAcceptBy).getTime(), placed + 60 * 60 * 1000);
  const list = await api('GET', `/api/restaurants/${store.id}/orders?scope=active`, store.token);
  assert.equal(list.status, 200);
  const row = list.body.find((x) => String(x.id) === String(order.id));
  assert.equal(new Date(row.storeAcceptBy).getTime(), placed + 60 * 60 * 1000);
  await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: new Date() }, { where: { id: order.id } });
  const after = await api('GET', `/api/restaurants/${store.id}/orders?scope=active`, store.token);
  assert.equal(after.body.find((x) => String(x.id) === String(order.id)).storeAcceptBy, null);
});

test('store push carries the per-order tag; the new-order title has no emoji', () => {
  const src = require('fs').readFileSync(require('path').join(H.B, 'controllers/orderController.js'), 'utf8');
  assert.doesNotMatch(src, /'New order 🔔'/);
  assert.match(src, /pushToStore\(restaurant, 'New order', .*\{ tag: `order-\$\{order\.id\}` \}\)/);
});
