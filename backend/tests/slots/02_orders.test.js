// Delivery slots on the real routes: the quote's slots (lead per item type, store hours), the order refusing a
// closed slot (409 SLOT_CLOSED + the open slots, nothing charged), the legacy 'ASAP' auto-assign, the slot on
// the order / partner payloads, store hours at the slot start, ordering at night for tomorrow.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers');

const { H, IST, setNow } = T;
before(async () => { await T.setup(); });
after(T.teardown);
afterEach(() => setNow(null));

const quote = (user, item) => H.api('POST', '/api/orders/quote', user.token, H.orderBody(item.id, 'COD'));
const place = (user, item, extra = {}, method = 'COD') => H.api('POST', '/api/orders', user.token, H.orderBody(item.id, method, extra));

test('quote: today + tomorrow, food closes 1 hour before the start, default = earliest open', async () => {
  setNow(IST('2026-10-27T11:45:00'));
  const { item } = await T.mkStore({ name: 'Paneer Wrap' });
  const u = await H.mkUser();
  const q = await quote(u, item);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const ds = q.body.deliverySlots;
  assert.equal(ds.leadMinutes, 60);
  assert.equal(ds.leadReason, null);
  assert.equal(ds.slots.length, 6);
  assert.deepEqual(ds.slots.map((s) => s.open), [false, true, true, true, true, true]);
  assert.equal(ds.slots[0].closedText, 'Closed at 11:30 AM');
  assert.equal(ds.defaultSlotId, '2026-10-27|S2');
  assert.equal(q.body.serviceability.open, true);
});

test('quote: a cake takes 2 hours, a specialized cake 2½ hours (MenuItem.isSpecializedCake)', async () => {
  setNow(IST('2026-10-27T10:15:00'));
  const u = await H.mkUser();
  const { item: cake } = await T.mkStore({ name: 'Chocolate Truffle Cake' });
  const q1 = await quote(u, cake);
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  assert.equal(q1.body.deliverySlots.leadMinutes, 120);
  assert.equal(q1.body.deliverySlots.leadReason, 'Cakes need 2 hours');
  assert.equal(q1.body.deliverySlots.slots[0].open, true); // closes 10:30
  const { item: special } = await T.mkStore({ name: 'Chocolate Truffle Cake', item: { isSpecializedCake: true } });
  const q2 = await quote(u, special);
  assert.equal(q2.body.deliverySlots.leadMinutes, 150);
  assert.equal(q2.body.deliverySlots.leadReason, 'This cake needs 2½ hours');
  assert.equal(q2.body.deliverySlots.slots[0].open, false); // closed at 10:00
  assert.equal(q2.body.deliverySlots.slots[0].closedText, 'Closed at 10:00 AM');
  assert.equal(q2.body.deliverySlots.defaultSlotId, '2026-10-27|S2');
});

test('order: the picked slot is stored (label + window) and shown to the customer, store and admin', async () => {
  setNow(IST('2026-10-27T09:00:00'));
  const { store, item } = await T.mkStore();
  const u = await H.mkUser();
  const r = await place(u, item, { deliverySlot: '2026-10-28|S3' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.deliverySlot, 'Wed 28 Oct, 8:30–9:30 PM');
  assert.equal(new Date(r.body.slotStart).toISOString(), '2026-10-28T15:00:00.000Z');
  assert.equal(new Date(r.body.slotEnd).toISOString(), '2026-10-28T16:00:00.000Z');
  const row = await H.ctx.M('Order').findByPk(r.body.id);
  assert.equal(row.deliverySlot, 'Wed 28 Oct, 8:30–9:30 PM');
  const mine = await H.api('GET', '/api/orders/myorders', u.token);
  const listed = mine.body.find((o) => o.id === r.body.id);
  assert.equal(listed.deliverySlot, 'Wed 28 Oct, 8:30–9:30 PM');
  assert.ok(listed.slotStart && listed.slotEnd);
  const one = await H.api('GET', `/api/orders/${r.body.id}`, u.token);
  assert.equal(new Date(one.body.slotStart).toISOString(), '2026-10-28T15:00:00.000Z');
  // Store store accept clock: an hour before the slot + the timeout.
  assert.ok(new Date(one.body.storeAcceptBy) > new Date('2026-10-28T14:00:00Z'), one.body.storeAcceptBy);
  const kitchen = await H.api('GET', `/api/restaurants/${store.id}/orders`, store.token);
  if (kitchen.status === 200) {
    const k = kitchen.body.find((o) => o.id === r.body.id);
    assert.equal(k.deliverySlot, 'Wed 28 Oct, 8:30–9:30 PM');
    assert.ok(k.slotStart);
  }
  const admin = await H.mkUser({ role: 'admin' });
  const all = await H.api('GET', '/api/orders?limit=50', admin.token);
  assert.equal(all.status, 200, JSON.stringify(all.body).slice(0, 200));
  const a = all.body.orders.find((o) => o.id === r.body.id);
  assert.equal(a.deliverySlot, 'Wed 28 Oct, 8:30–9:30 PM');
  assert.ok(a.slotStart && a.slotEnd);
  // The store's live new-order event carries the slot.
  const ev = H.ctx.emitted.filter((e) => e.ev === 'restaurant_newOrder' && e.p && e.p.id === r.body.id).pop();
  assert.ok(ev, 'restaurant_newOrder');
  assert.equal(ev.p.slotLabel, 'Wed 28 Oct, 8:30–9:30 PM');
});

test('order: a slot past its cutoff is refused with 409 SLOT_CLOSED and the open slots; nothing is charged', async () => {
  setNow(IST('2026-10-27T11:31:00'));
  const { item } = await T.mkStore({ price: 120 });
  const u = await H.mkUser({ wallet: 500 });
  const r = await place(u, item, { deliverySlot: '2026-10-27|S1' }, 'Wallet');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'SLOT_CLOSED');
  assert.match(r.body.message, /Booking for Today 12:30–1:00 PM closed at 11:30 AM/);
  assert.equal(r.body.nextSlot.id, '2026-10-27|S2');
  assert.ok(r.body.slots.length >= 4 && r.body.slots.every((s) => s.open));
  assert.equal(Number((await H.ctx.M('User').findByPk(u.id)).walletBalance), 500);
  assert.equal(await H.ctx.M('Order').count({ where: { userId: u.id } }), 0);
  // Beyond tomorrow / made-up ids are refused the same way.
  const far = await place(u, item, { deliverySlot: '2026-10-29|S1' });
  assert.equal(far.status, 409);
  assert.equal(far.body.code, 'SLOT_CLOSED');
  const fake = await place(u, item, { deliverySlot: '2026-10-27|S9' });
  assert.equal(fake.status, 409);
  // A cake basket re-checks the longer lead on the server: 2:31 PM for 4:30 PM is too late for a cake.
  setNow(IST('2026-10-27T14:31:00'));
  const { item: cake } = await T.mkStore({ name: 'Red Velvet Cake' });
  const c = await place(u, cake, { deliverySlot: '2026-10-27|S2' });
  assert.equal(c.status, 409, JSON.stringify(c.body));
  assert.match(c.body.message, /closed at 2:30 PM \(cakes need 2 hours\)/);
  const ok = await place(u, cake, { deliverySlot: '2026-10-27|S3' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test('legacy app builds: deliverySlot ASAP / missing gets the earliest open slot for the items', async () => {
  setNow(IST('2026-10-27T15:40:00')); // S2 closed at 3:30 for food
  const { item } = await T.mkStore();
  const u = await H.mkUser();
  const a = await place(u, item, { deliverySlot: 'ASAP' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.deliverySlot, 'Tue 27 Oct, 8:30–9:30 PM');
  const b = await place(u, item);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.deliverySlot, 'Tue 27 Oct, 8:30–9:30 PM');
  // A cake at 6:40 PM: today's 8:30 slot closed at 6:30 PM, so tomorrow 12:30.
  setNow(IST('2026-10-27T18:40:00'));
  const { item: cake } = await T.mkStore({ name: 'Mango Cheesecake' });
  const c = await place(u, cake, { deliverySlot: 'ASAP' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.deliverySlot, 'Wed 28 Oct, 12:30–1:00 PM');
});

test('night: ordering is open for the next slot (serviceability open, an order at 11 PM goes to tomorrow)', async () => {
  setNow(IST('2026-10-27T23:00:00'));
  const s = await H.api('GET', '/api/orders/serviceability');
  assert.equal(s.status, 200);
  assert.equal(s.body.open, true);
  assert.equal(s.body.night, true);
  assert.equal(s.body.nextSlot.label, 'Tomorrow 12:30–1:00 PM');
  const { item } = await T.mkStore();
  const u = await H.mkUser();
  const r = await place(u, item, { deliverySlot: '2026-10-28|S1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.deliverySlot, 'Wed 28 Oct, 12:30–1:00 PM');
});

test('store hours at the slot start: a store closed now takes orders for a slot it is open at', async () => {
  // 9 AM–10 PM store, 11 PM now: closed right now, open at tomorrow's slots.
  setNow(IST('2026-10-27T23:00:00'));
  const { item } = await T.mkStore({ hours: { start: '09:00', end: '22:00' } });
  const u = await H.mkUser();
  const q = await quote(u, item);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.deliverySlots.defaultSlotId, '2026-10-28|S1');
  const r = await place(u, item, { deliverySlot: '2026-10-28|S2' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // A dinner-only store (4 PM–10 PM) at 9 AM: the 12:30 slot is closed for it, 4:30 is open.
  setNow(IST('2026-10-27T09:00:00'));
  const { item: dinner, store: dinnerStore } = await T.mkStore({ hours: { start: '16:00', end: '22:00' } });
  const q2 = await quote(u, dinner);
  assert.equal(q2.status, 200, JSON.stringify(q2.body));
  assert.equal(q2.body.deliverySlots.slots[0].closedReason, 'store_closed');
  assert.equal(q2.body.deliverySlots.defaultSlotId, '2026-10-27|S2');
  const refused = await place(u, dinner, { deliverySlot: '2026-10-27|S1' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, new RegExp(`${dinnerStore.name} is closed then`));
  const legacy = await place(u, dinner, { deliverySlot: 'ASAP' });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.equal(legacy.body.deliverySlot, 'Tue 27 Oct, 4:30–5:30 PM');
});

test('genuinely closed stores are still refused: switched off, inactive, closed on both days', async () => {
  setNow(IST('2026-10-27T09:00:00'));
  const u = await H.mkUser();
  const { item: off } = await T.mkStore({ store: { isOpenNow: false } });
  const a = await quote(u, off);
  assert.equal(a.status, 400);
  assert.equal(a.body.code, 'STORE_CLOSED');
  const day = { open: true, start: '09:00', end: '22:00' };
  const shut = { open: false };
  // Open only on Fridays: no slot today (Tue) or tomorrow (Wed).
  const { item: fri } = await T.mkStore({ hours: { start: '09:00', end: '22:00', weekly: { mon: shut, tue: shut, wed: shut, thu: shut, fri: day, sat: shut, sun: shut } } });
  const b = await quote(u, fri);
  assert.equal(b.status, 400, JSON.stringify(b.body));
  assert.equal(b.body.code, 'STORE_CLOSED');
  const c = await place(u, fri, { deliverySlot: 'ASAP' });
  assert.equal(c.status, 400);
  assert.equal(c.body.code, 'STORE_CLOSED');
});

test('GET /api/orders/delivery-slots: per type, with store hours, no sign-in needed', async () => {
  setNow(IST('2026-10-27T10:10:00'));
  const food = await H.api('GET', '/api/orders/delivery-slots?type=list');
  assert.equal(food.status, 200);
  assert.equal(food.body.leadMinutes, 60);
  assert.equal(food.body.slots[0].open, true);
  const sp = await H.api('GET', '/api/orders/delivery-slots?type=specialized_cake');
  assert.equal(sp.body.leadMinutes, 150);
  assert.equal(sp.body.slots[0].open, false);
  const { store } = await T.mkStore({ hours: { start: '16:00', end: '22:00' } });
  const st = await H.api('GET', `/api/orders/delivery-slots?type=food&storeId=${store.id}`);
  assert.equal(st.body.slots[0].closedReason, 'store_closed');
  assert.equal(st.body.defaultSlotId, '2026-10-27|S2');
});
