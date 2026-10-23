// Favourite stores on the account: GET/PUT /api/users/favorites (own list only, ids validated and
// de-duplicated, capped at 200, sign-in required).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

let u; let other; let a; let b;
before(async () => {
  await H.setup();
  u = await H.mkUser();
  other = await H.mkUser();
  a = (await H.mkStore()).store;
  b = (await H.mkStore()).store;
});
after(H.teardown);

test('a new account starts with no favourites; sign-in is required', async () => {
  const r = await H.api('GET', '/api/users/favorites', u.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.storeIds, []);
  assert.equal((await H.api('GET', '/api/users/favorites')).status, 401);
  assert.equal((await H.api('PUT', '/api/users/favorites', null, { storeIds: [a.id] })).status, 401);
});

test('PUT replaces the list (valid ids only, no duplicates) and GET reads it back', async () => {
  const r = await H.api('PUT', '/api/users/favorites', u.token, { storeIds: [a.id, 'not-an-id', a.id.toUpperCase(), b.id, 42] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.storeIds, [a.id.toLowerCase(), b.id.toLowerCase()]);
  const g = await H.api('GET', '/api/users/favorites', u.token);
  assert.deepEqual(g.body.storeIds, [a.id.toLowerCase(), b.id.toLowerCase()]);
  // Another customer's list is untouched.
  assert.deepEqual((await H.api('GET', '/api/users/favorites', other.token)).body.storeIds, []);
  // Emptying works.
  assert.deepEqual((await H.api('PUT', '/api/users/favorites', u.token, { storeIds: [] })).body.storeIds, []);
});

test('bad bodies are refused and the list is capped at 200', async () => {
  assert.equal((await H.api('PUT', '/api/users/favorites', u.token, { storeIds: 'x' })).status, 400);
  assert.equal((await H.api('PUT', '/api/users/favorites', u.token, {})).status, 400);
  const many = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const r = await H.api('PUT', '/api/users/favorites', u.token, { storeIds: many });
  assert.equal(r.status, 200);
  assert.equal(r.body.storeIds.length, 200);
});
