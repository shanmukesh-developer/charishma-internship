// Rider dispatch gating for slot orders: the store gets the order at once, riders only from 45 minutes before
// the slot start (pool, claim, live event, push), released once by the 'orders.slotDispatch' job. Plus the
// slot-aware timers: a night order for tomorrow is not store-timed-out at night, and an unclaimed slot order is
// cancelled only after its slot started; the shopping list follows the same slot rules.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers');

const { H, S, IST, setNow } = T;
const { releaseDueSlotOrders, autoCancelStalePendingOrders } = H.r('controllers/orderController');
const { expireStaleBaskets } = H.r('controllers/megaBasketController');
const fakeIo = { to: () => ({ emit() {} }), emit() {} };

before(async () => { await T.setup(); });
after(T.teardown);
afterEach(() => setNow(null));

const MIN = 60 * 1000;
const deliveryRequests = (orderId) => H.ctx.emitted.filter((e) => e.ev === 'delivery_request' && e.p && String(e.p.orderId) === String(orderId)).length;
const settle = () => new Promise((r) => setTimeout(r, 60)); // realtime.deliveryRequest looks the order up async

test('jobs registry runs the slot release every minute (single runner)', () => {
  const jobs = H.r('jobs/index').listJobs();
  const j = jobs.find((x) => x.name === 'orders.slotDispatch');
  assert.ok(j, jobs.map((x) => x.name).join(', '));
});

test('a slot order is not offered to riders early: pool, claim and live event wait for the 45-minute window', async () => {
  // 10 PM: an order for tomorrow 12:30. The store accepts it at once (it plans), riders do not see it.
  setNow(IST('2026-10-27T22:00:00'));
  const { store, item } = await T.mkStore();
  const u = await H.mkUser();
  const rider = await H.mkRider();
  const placed = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD', { deliverySlot: '2026-10-28|S1' }));
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const id = placed.body.id;
  const acc = await H.api('PUT', `/api/orders/${id}/restaurant-accept`, store.token, { estDuration: 20 });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  await settle();
  assert.equal(deliveryRequests(id), 0, 'no delivery_request before the window');

  const pool = await H.api('GET', '/api/delivery/orders/pending', rider.token);
  assert.equal(pool.status, 200, JSON.stringify(pool.body));
  assert.ok(!pool.body.some((o) => o.id === id), 'not in the pool at 10 PM');
  const early = await H.api('PUT', `/api/delivery/accept/${id}`, rider.token);
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.equal(early.body.code, 'SLOT_NOT_OPEN');
  assert.match(early.body.message, /Riders can take it from 11:45 AM/);
  assert.equal((await H.ctx.M('Order').findByPk(id)).deliveryPartnerId, null);

  // 11:44 tomorrow: still held; the job releases nothing.
  setNow(IST('2026-10-28T11:44:00'));
  assert.deepEqual(await releaseDueSlotOrders(), { released: 0, marked: 0 });
  assert.ok(!(await H.api('GET', '/api/delivery/orders/pending', rider.token)).body.some((o) => o.id === id));

  // 11:45: the window opens. The job releases it once (live event), the pool shows it, a claim works.
  setNow(IST('2026-10-28T11:45:00'));
  const first = await releaseDueSlotOrders();
  assert.equal(first.released, 1);
  await settle();
  assert.equal(deliveryRequests(id), 1);
  assert.deepEqual(await releaseDueSlotOrders(), { released: 0, marked: 0 }, 'released once');
  const inPool = await H.api('GET', '/api/delivery/orders/pending', rider.token);
  const card = inPool.body.find((o) => o.id === id);
  assert.ok(card, 'in the pool from 11:45');
  assert.equal(card.deliverySlot, 'Wed 28 Oct, 12:30–1:00 PM');
  assert.equal(card.slotLabel, 'Wed 28 Oct, 12:30–1:00 PM');
  assert.equal(card.riderVisibleFrom, '2026-10-28T06:15:00.000Z');
  const claim = await H.api('PUT', `/api/delivery/accept/${id}`, rider.token);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.slotStart, '2026-10-28T07:00:00.000Z');
});

test('an order accepted inside the window goes to riders at once and the job only marks it', async () => {
  setNow(IST('2026-10-28T11:00:00'));
  const { store, item } = await T.mkStore();
  const u = await H.mkUser();
  const placed = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD', { deliverySlot: '2026-10-28|S1' }));
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  setNow(IST('2026-10-28T11:50:00')); // the kitchen accepts late, inside the rider window
  const acc = await H.api('PUT', `/api/orders/${placed.body.id}/restaurant-accept`, store.token);
  assert.equal(acc.status, 200);
  // acceptedAt is the real clock; put it inside the window so the job sees "dispatched on the spot".
  await H.ctx.M('Order').update({ acceptedAt: IST('2026-10-28T11:50:00') }, { where: { id: placed.body.id } });
  await settle();
  assert.equal(deliveryRequests(placed.body.id), 1);
  const r = await releaseDueSlotOrders();
  assert.equal(r.released, 0);
  assert.equal(r.marked, 1);
  await settle();
  assert.equal(deliveryRequests(placed.body.id), 1, 'no second event');
});

test('orders without a slot (older rows, kill switch) still go to riders at once', async () => {
  const { item } = await T.mkStore();
  const u = await H.mkUser();
  const rider = await H.mkRider();
  process.env.DELIVERY_SLOTS = 'off';
  let id;
  try {
    const placed = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD'));
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.deliverySlot, 'ASAP');
    assert.ok(!placed.body.slotStart);
    id = placed.body.id;
  } finally {
    process.env.DELIVERY_SLOTS = 'on';
  }
  await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: new Date() }, { where: { id } });
  const pool = await H.api('GET', '/api/delivery/orders/pending', rider.token);
  assert.ok(pool.body.some((o) => o.id === id));
});

test('store-accept timeout: a night order for tomorrow is not cancelled at night, only from an hour before its slot', async () => {
  const { item } = await T.mkStore();
  const u = await H.mkUser();
  const placed = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD', { deliverySlot: 'ASAP' }));
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const Order = H.ctx.M('Order');
  const id = placed.body.id;
  const backdate = (min) => H.ctx.sequelize.query(`UPDATE "Orders" SET "createdAt" = ? WHERE id = ?`, { replacements: [new Date(Date.now() - min * MIN).toISOString().replace('T', ' ').replace('Z', ' +00:00'), id] });
  // Placed 20 min ago for a slot 14 hours away: the store has until an hour before the slot.
  await backdate(20);
  await Order.update({ slotStart: new Date(Date.now() + 14 * 60 * MIN), slotEnd: new Date(Date.now() + 14.5 * 60 * MIN) }, { where: { id } });
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await Order.findByPk(id)).status, 'Pending');
  // The slot is 50 minutes away: the accept clock started 10 minutes ago (> 7) -> cancelled.
  await Order.update({ slotStart: new Date(Date.now() + 50 * MIN), slotEnd: new Date(Date.now() + 80 * MIN) }, { where: { id } });
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await Order.findByPk(id)).status, 'Cancelled');
});

test('no-rider timeout: an accepted slot order waits until 15 minutes after its slot started', async () => {
  const { item } = await T.mkStore();
  const u = await H.mkUser();
  const placed = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD'));
  const Order = H.ctx.M('Order');
  const id = placed.body.id;
  const old = new Date(Date.now() - 3 * 60 * MIN);
  await H.ctx.sequelize.query(`UPDATE "Orders" SET "createdAt" = ?, "status" = 'Accepted', "acceptedAt" = ? WHERE id = ?`, { replacements: [old.toISOString().replace('T', ' ').replace('Z', ' +00:00'), old.toISOString().replace('T', ' ').replace('Z', ' +00:00'), id] });
  await Order.update({ slotStart: new Date(Date.now() - 10 * MIN), slotEnd: new Date(Date.now() + 20 * MIN) }, { where: { id } });
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await Order.findByPk(id)).status, 'Accepted', 'slot started 10 min ago: still waiting for a rider');
  await Order.update({ slotStart: new Date(Date.now() - 16 * MIN) }, { where: { id } });
  await autoCancelStalePendingOrders(fakeIo);
  assert.equal((await Order.findByPk(id)).status, 'Cancelled');
});

test('store reminders follow the slot accept clock (none at night for tomorrow)', async () => {
  const reminder = H.r('utils/storeOrderReminder');
  reminder._resetReminders();
  const { item } = await T.mkStore();
  const u = await H.mkUser();
  const placed = await H.api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD'));
  const id = placed.body.id;
  const Order = H.ctx.M('Order');
  await H.ctx.sequelize.query(`UPDATE "Orders" SET "createdAt" = ? WHERE id = ?`, { replacements: [new Date(Date.now() - 3 * MIN).toISOString().replace('T', ' ').replace('Z', ' +00:00'), id] });
  await Order.update({ slotStart: new Date(Date.now() + 12 * 60 * MIN), slotEnd: new Date(Date.now() + 12.5 * 60 * MIN) }, { where: { id } });
  const sent = [];
  const push = async (storeId, title, body, data) => { sent.push({ storeId, title, body, data }); };
  await reminder.remindPendingStoreOrders({ push });
  assert.equal(sent.filter((x) => x.data.orderId === id).length, 0, 'no reminder 12 hours before the slot');
  // The accept clock started 2 minutes ago (slot in 58 min): reminded, with the slot named.
  await Order.update({ slotStart: new Date(Date.now() + 58 * MIN), slotEnd: new Date(Date.now() + 88 * MIN) }, { where: { id } });
  await reminder.remindPendingStoreOrders({ push });
  const mine = sent.filter((x) => x.data.orderId === id);
  assert.equal(mine.length, 1);
  assert.match(mine[0].body, /For .+\. Accept it in the next [1-5] min/);
});

test('shopping list: slot picked / auto-assigned, closed slot refused, riders only in the window', async () => {
  setNow(IST('2026-10-27T15:45:00'));
  const u = await H.mkUser();
  const rider = await H.mkRider();
  const body = (extra = {}) => ({ items: [{ name: 'Amul milk 1L', quantity: 2, priceEstimated: 30 }], deliveryAddress: 'Block A, Room 101, SRM AP', paymentMethod: 'COD', ...extra });
  const closed = await T.basketApi('POST', '/api/mega-basket', u.token, body({ deliverySlot: '2026-10-27|S2' }));
  assert.equal(closed.status, 409, JSON.stringify(closed.body));
  assert.equal(closed.body.code, 'SLOT_CLOSED');
  assert.equal(closed.body.nextSlot.id, '2026-10-27|S3');
  const legacy = await T.basketApi('POST', '/api/mega-basket', u.token, body());
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.equal(legacy.body.deliverySlot, 'Tue 27 Oct, 8:30–9:30 PM');
  const picked = await T.basketApi('POST', '/api/mega-basket', u.token, body({ deliverySlot: '2026-10-28|S2' }));
  assert.equal(picked.status, 201, JSON.stringify(picked.body));
  assert.equal(picked.body.deliverySlot, 'Wed 28 Oct, 4:30–5:30 PM');

  // 7:44 PM: neither list is in the rider pool yet; 7:45 PM the 8:30 one is, tomorrow's is not.
  setNow(IST('2026-10-27T19:44:00'));
  let pool = await T.basketApi('GET', '/api/mega-basket/rider/pending', rider.token);
  assert.equal(pool.status, 200, JSON.stringify(pool.body));
  assert.ok(!pool.body.some((b) => b.id === legacy.body.id));
  const early = await T.basketApi('POST', `/api/mega-basket/${legacy.body.id}/claim`, rider.token);
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'SLOT_NOT_OPEN');
  setNow(IST('2026-10-27T19:45:00'));
  pool = await T.basketApi('GET', '/api/mega-basket/rider/pending', rider.token);
  const card = pool.body.find((b) => b.id === legacy.body.id);
  assert.ok(card);
  assert.equal(card.slotLabel, 'Tue 27 Oct, 8:30–9:30 PM');
  assert.ok(!pool.body.some((b) => b.id === picked.body.id));
  const claim = await T.basketApi('POST', `/api/mega-basket/${legacy.body.id}/claim`, rider.token);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  // Unclaimed list for a later slot is not expired after an hour; only once its slot started 15 min ago.
  const MB = H.ctx.M('MegaBasket');
  const old = new Date(Date.now() - 2 * 60 * MIN).toISOString().replace('T', ' ').replace('Z', ' +00:00');
  await H.ctx.sequelize.query(`UPDATE "MegaBaskets" SET "createdAt" = ? WHERE id = ?`, { replacements: [old, picked.body.id] });
  await MB.update({ slotStart: new Date(Date.now() + 60 * MIN) }, { where: { id: picked.body.id } });
  await expireStaleBaskets(null);
  assert.equal((await MB.findByPk(picked.body.id)).status, 'PaidEstimate');
  await MB.update({ slotStart: new Date(Date.now() - 16 * MIN) }, { where: { id: picked.body.id } });
  await expireStaleBaskets(null);
  assert.equal((await MB.findByPk(picked.body.id)).status, 'Cancelled');
});

test('slot fields helper is safe on rows without a slot', () => {
  assert.deepEqual(S.slotFields({ deliverySlot: 'ASAP' }), { deliverySlot: 'ASAP', slotStart: null, slotEnd: null, slotLabel: null, riderVisibleFrom: null });
});
