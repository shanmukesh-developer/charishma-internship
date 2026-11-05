// Guests browse campus stalls (QA Q23, 5 Nov 2026): the stall list and a stall's menu are public reads, like the
// restaurant menus; they carry only what a public menu shows (names, items, prices, hours, campus), never the
// stall's UPI details, owner phone, commission, earnings or anyone's bookings. Every write and the student's own
// home / bookings still need a signed-in student.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

let s1; let off; let alice; let id;

// Keys a public stall card / menu item may carry (services/stalls serializeStall / serializeItem + list extras).
const STALL_KEYS = new Set(['id', 'name', 'location', 'campus', 'imageUrl', 'logoUrl', 'description', 'category', 'categoryLabel', 'tags',
  'isOpen', 'opensAt', 'closesAt', 'closedReason', 'hoursToday', 'prepMinutes', 'rating', 'ratingCount', 'itemCount', 'legalName',
  'fssaiLicenseNumber', 'preview', 'menuCategories', 'matchedItem']);
const ITEM_KEYS = new Set(['id', 'name', 'price', 'originalPrice', 'description', 'imageUrl', 'category', 'isVeg', 'dietType', 'isAvailable']);
const PRIVATE = /campusUpi|upi|whatsapp|phone|password|commission|earning|payout|ownerName|bankAccount|ifsc|email|pickupCode|booking/i;

test.before(async () => {
  await T.setup();
  s1 = await T.mkStall({ store: { whatsappNumber: '9876500011', phone: '9876500012', ownerPhone: '9876500013' } });
  off = await T.mkStall({ enabled: false });
  alice = await T.mkUser();
  id = (await T.book(alice, s1)).body.booking.id;
});
test.after(async () => { await T.teardown(); });

const leaksNothing = (body, label) => {
  const text = JSON.stringify(body);
  for (const v of ['chaiadda@okaxis', 'Owner', '9876500011', '9876500012', '9876500013', 'stallpass1', id]) {
    assert.ok(!text.includes(v), `${label}: must not carry ${v}`);
  }
};

test('a guest (no token) lists the bookable stalls with the public card only', async () => {
  const r = await T.cb('GET', '/api/campus-booking/stalls');
  assert.strictEqual(r.status, 200);
  const ids = r.body.stalls.map((x) => x.id);
  assert.ok(ids.includes(String(s1.store.id)));
  assert.ok(!ids.includes(String(off.store.id)), 'a stall with bookings switched off stays hidden');
  for (const card of r.body.stalls) {
    for (const k of Object.keys(card)) assert.ok(STALL_KEYS.has(k), `unexpected stall key ${k}`);
    for (const k of Object.keys(card)) assert.ok(!PRIVATE.test(k), `private-looking key ${k}`);
  }
  const card = r.body.stalls.find((x) => x.id === String(s1.store.id));
  assert.deepStrictEqual(card.preview.map((m) => m.price), [20, 40]);
  assert.ok(Array.isArray(r.body.categories));
  leaksNothing(r.body, 'list');
});

test('a guest opens a stall menu: items and prices, nothing private', async () => {
  const r = await T.cb('GET', `/api/campus-booking/stalls/${s1.store.id}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.stall.id, String(s1.store.id));
  assert.deepStrictEqual(Object.keys(r.body).sort(), ['menu', 'stall']);
  for (const k of Object.keys(r.body.stall)) assert.ok(STALL_KEYS.has(k), `unexpected stall key ${k}`);
  assert.strictEqual(r.body.menu.length, 2);
  for (const m of r.body.menu) for (const k of Object.keys(m)) assert.ok(ITEM_KEYS.has(k), `unexpected item key ${k}`);
  assert.deepStrictEqual(r.body.menu.map((m) => m.price).sort((a, b) => a - b), [20, 40]);
  leaksNothing(r.body, 'detail');
  // A stall that does not take bookings is still a 404 for guests.
  assert.strictEqual((await T.cb('GET', `/api/campus-booking/stalls/${off.store.id}`)).status, 404);
  assert.strictEqual((await T.cb('GET', '/api/campus-booking/stalls/not-a-uuid')).status, 404);
});

test('a guest gets the same stall data a signed-in student gets', async () => {
  const guest = await T.cb('GET', `/api/campus-booking/stalls/${s1.store.id}`);
  const signed = await T.cb('GET', `/api/campus-booking/stalls/${s1.store.id}`, alice.token);
  assert.strictEqual(signed.status, 200);
  assert.deepStrictEqual(guest.body, signed.body);
});

test('everything else still needs a signed-in student (401 for guests, nothing written)', async () => {
  const before = await T.ctx.M('CampusBooking').count();
  for (const [m, u, b] of [
    ['GET', '/api/campus-booking/home'],
    ['GET', '/api/campus-booking/bookings'],
    ['GET', `/api/campus-booking/bookings/${id}`],
    ['POST', '/api/campus-booking/bookings', { stallId: s1.store.id, items: [{ menuItemId: s1.items[0].id, quantity: 1 }] }],
    ['POST', `/api/campus-booking/bookings/${id}/proof`, { upiRef: 'GUEST1112223' }],
    ['POST', `/api/campus-booking/bookings/${id}/cancel`, {}],
    ['GET', '/api/campus-booking/vendor/summary'],
    ['GET', '/api/admin/campus-booking/bookings'],
  ]) {
    const r = await T.cb(m, u, undefined, b);
    assert.strictEqual(r.status, 401, `${m} ${u}`);
  }
  assert.strictEqual(await T.ctx.M('CampusBooking').count(), before);
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'PAYMENT_PENDING');
});
