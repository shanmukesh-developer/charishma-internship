// GET /api/users/search with no query (the food search's suggestions, 3 Nov 2026): stores and dishes come from food
// stores only (restaurants and campus stalls); a grocery store's products never show here (they used to be the first
// rows in table order: six pickles). Groceries are searched in the catalogue instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

test('empty search: trending stores and dishes are from food stores only', async () => {
  const M = (n) => H.ctx.M(n);
  // The search reads each dish's store (as the app's models do; the shared test setup leaves it out).
  if (!M('MenuItem').associations.restaurant) M('MenuItem').belongsTo(M('Restaurant'), { foreignKey: 'restaurantId', as: 'restaurant' });
  const hours = { start: '00:00', end: '00:00' };
  const grocery = await M('Restaurant').create({ name: 'Pickle House', vendorType: 'GROCERY', location: 'Mangalagiri', operatingHours: hours, isActive: true, isOpenNow: true, rating: 5 });
  for (const name of ['Mango Pickle', 'Lemon Pickle', 'Ginger Pickle']) await M('MenuItem').create({ restaurantId: grocery.id, name, price: 120, isAvailable: true });
  const { store, item } = await H.mkStore();
  const r = await H.api('GET', '/api/users/search?q=');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.isTrending, true);
  const storeIds = r.body.restaurants.map((s) => String(s.id));
  assert.ok(storeIds.includes(String(store.id)), 'the restaurant is suggested');
  assert.ok(!storeIds.includes(String(grocery.id)), 'the grocery store is not');
  const names = r.body.items.map((i) => i.name);
  assert.ok(names.includes(item.name), names.join(', '));
  assert.ok(!names.some((n) => /Pickle/.test(n)), names.join(', '));
});
