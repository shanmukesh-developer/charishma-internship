// Home store list: ?fields=summary sends the same stores with a light menu (available dishes only, list
// fields only, no descriptions / specs), the old response is unchanged without it, and the public list /
// detail show stores closed during the campus night window (campusClosed, opensAt 06:00). The night
// message has no emoji and ends with a full stop.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let store;
test.before(async () => {
  await H.setup();
  store = await H.mkStore({ name: 'Summary Kitchen', vendorType: 'RESTAURANT' });
  await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'Veg Thali', price: 120, description: 'A long description '.repeat(20), category: 'Meals', isAvailable: true, specs: { weight: '500 g' } });
  await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'Sold Out Biryani', price: 180, isAvailable: false });
});
test.after(() => H.teardown());

test('full list unchanged; ?fields=summary trims the menu and marks menuMode', async () => {
  const full = await H.api('GET', '/api/users/restaurants');
  assert.strictEqual(full.status, 200);
  const f = full.body.find((r) => r.id === store.id);
  assert.ok(f, 'store listed');
  assert.strictEqual(f.menu.length, 2);
  assert.ok(f.menu.some((m) => m.description), 'full menu keeps descriptions');
  assert.strictEqual(f.menuMode, undefined);
  assert.strictEqual(typeof f.isOpen, 'boolean');
  assert.ok('campusClosed' in f);

  const sum = await H.api('GET', '/api/users/restaurants?fields=summary');
  assert.strictEqual(sum.status, 200);
  const s = sum.body.find((r) => r.id === store.id);
  assert.ok(s);
  assert.strictEqual(s.menuMode, 'summary');
  assert.strictEqual(s.menuCount, 2);
  assert.deepStrictEqual(s.menu.map((m) => m.name), ['Veg Thali']);
  const item = s.menu[0];
  for (const k of ['description', 'specs', 'image', 'createdAt', 'updatedAt']) assert.ok(!(k in item), `no ${k}`);
  for (const k of ['id', 'name', 'price', 'category', 'isAvailable']) assert.ok(k in item, `has ${k}`);
  assert.strictEqual(s.isOpen, f.isOpen);
  assert.strictEqual(s.name, f.name);
  assert.ok(JSON.stringify(sum.body).length < JSON.stringify(full.body).length);
});

test('night window: store shown closed with opensAt 06:00 and the plain message (production only)', () => {
  const { withCampusWindow, getCampusServiceability } = H.r('utils/storeHours');
  const night = new Date('2026-10-20T17:00:00Z'); // 22:30 IST
  const day = new Date('2026-10-20T06:00:00Z'); // 11:30 IST
  const saved = process.env.RENDER;
  process.env.RENDER = 'true';
  try {
    const c = getCampusServiceability(night);
    assert.strictEqual(c.open, false);
    assert.strictEqual(c.message, 'Campus ordering is closed for the night. Ordering opens at 6:00 am.');
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(c.message), 'no emoji');
    const w = withCampusWindow({ isOpen: true, closesAt: '23:59' }, night);
    assert.strictEqual(w.isOpen, false);
    assert.strictEqual(w.campusClosed, true);
    assert.strictEqual(w.opensAt, '06:00');
    assert.strictEqual(w.reason, 'campus_night');
    const d = withCampusWindow({ isOpen: true }, day);
    assert.strictEqual(d.isOpen, true);
    assert.strictEqual(d.campusClosed, false);
  } finally {
    if (saved === undefined) delete process.env.RENDER; else process.env.RENDER = saved;
  }
  // Outside production the window never applies (local and test servers take orders at any hour).
  assert.strictEqual(withCampusWindow({ isOpen: true }, night).isOpen, true);
});
