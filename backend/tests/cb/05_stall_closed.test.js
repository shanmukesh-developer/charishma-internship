// Booking needs the stall to be open NOW (own switch, hours, offline flag), In-Campus Booking switched on by the
// admin, a UPI ID, and items in stock. Listing shows only bookable stalls, with real ratings only.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

test('closed by the stall switch: 409 STALL_CLOSED, nothing created', async () => {
  const s = await T.mkStall({ store: { isOpenNow: false } });
  const u = await T.mkUser();
  const before = await T.ctx.M('CampusBooking').count();
  const r = await T.book(u, s);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'STALL_CLOSED');
  assert.match(r.body.message, /closed/i);
  assert.strictEqual(await T.ctx.M('CampusBooking').count(), before);
  const card = (await T.cb('GET', '/api/campus-booking/stalls', u.token)).body.stalls.find((x) => x.id === s.store.id);
  assert.strictEqual(card.isOpen, false);
});

test('outside the stall hours (IST): 409 with when it opens', async () => {
  // A one-minute window 12 hours from now (IST) is closed whatever the time of day.
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  const h = (istNow.getUTCHours() + 12) % 24;
  const hh = String(h).padStart(2, '0');
  const s = await T.mkStall({ hours: { start: `${hh}:00`, end: `${hh}:01` } });
  const u = await T.mkUser();
  const r = await T.book(u, s);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'STALL_CLOSED');
  assert.strictEqual(r.body.opensAt, `${hh}:00`);
});

test('marked offline by ZCS: closed', async () => {
  const s = await T.mkStall({ store: { isOffline: true } });
  const r = await T.book(await T.mkUser(), s);
  assert.strictEqual(r.body.code, 'STALL_CLOSED');
});

test('switch off / no UPI / not a stall / hidden: not listed and not bookable', async () => {
  const u = await T.mkUser();
  const off = await T.mkStall({ enabled: false });
  const noUpi = await T.mkStall({ upi: null });
  const restaurant = await T.mkStall({ store: { vendorType: 'RESTAURANT' } });
  const hidden = await T.mkStall({ store: { isActive: false } });
  const ids = (await T.cb('GET', '/api/campus-booking/stalls', u.token)).body.stalls.map((x) => x.id);
  for (const s of [off, noUpi, restaurant, hidden]) {
    assert.ok(!ids.includes(s.store.id));
    const r = await T.book(u, s);
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'NOT_TAKING_BOOKINGS');
    assert.strictEqual((await T.cb('GET', `/api/campus-booking/stalls/${s.store.id}`, u.token)).status, 404);
  }
});

test('sold-out or foreign items are refused with the item ids', async () => {
  const s = await T.mkStall({ prices: [20, 30] });
  const other = await T.mkStall();
  const u = await T.mkUser();
  await s.items[1].update({ isAvailable: false });
  const sold = await T.book(u, s, [{ menuItemId: s.items[0].id, quantity: 1 }, { menuItemId: s.items[1].id, quantity: 1 }]);
  assert.strictEqual(sold.status, 409);
  assert.strictEqual(sold.body.code, 'ITEM_UNAVAILABLE');
  assert.deepStrictEqual(sold.body.itemIds, [s.items[1].id]);
  const foreign = await T.book(u, s, [{ menuItemId: other.items[0].id, quantity: 1 }]);
  assert.strictEqual(foreign.body.code, 'ITEM_GONE');
  const menu = (await T.cb('GET', `/api/campus-booking/stalls/${s.store.id}`, u.token)).body.menu;
  assert.strictEqual(menu.find((m) => m.id === s.items[1].id).isAvailable, false);
});

test('stall card: real data only (no invented rating), prep default 10, category from tags, search', async () => {
  const s = await T.mkStall({ store: { name: 'Sweet Crumbs Test Bakery', tags: ['bakery', 'puffs'] } });
  await T.mkStall({ store: { name: 'Campus Xerox Test', tags: ['stationery', 'xerox'] } });
  const u = await T.mkUser();
  const home = (await T.cb('GET', '/api/campus-booking/home', u.token)).body;
  assert.deepStrictEqual(home.categories.map((c) => c.label), ['Food & Beverages', 'Snacks & Bakery', 'Stationery', 'More']);
  const card = home.stalls.find((x) => x.id === s.store.id);
  assert.strictEqual(card.rating, null);
  assert.strictEqual(card.ratingCount, 0);
  assert.strictEqual(card.prepMinutes, 10);
  assert.strictEqual(card.category, 'snacks');
  assert.strictEqual(card.categoryLabel, 'Snacks & Bakery');
  assert.strictEqual(card.itemCount, 2);
  const stationery = (await T.cb('GET', '/api/campus-booking/stalls?category=stationery', u.token)).body.stalls;
  assert.ok(stationery.length >= 1 && stationery.every((x) => x.category === 'stationery'));
  const found = (await T.cb('GET', '/api/campus-booking/stalls?q=crumbs', u.token)).body.stalls;
  assert.deepStrictEqual(found.map((x) => x.id), [s.store.id]);
  const byItem = (await T.cb('GET', `/api/campus-booking/stalls?q=${encodeURIComponent(s.items[0].name)}`, u.token)).body.stalls;
  assert.ok(byItem.some((x) => x.id === s.store.id && x.matchedItem === s.items[0].name));
});
