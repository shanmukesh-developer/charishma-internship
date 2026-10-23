// Saved delivery places on the account: GET/PUT /api/users/addresses (own list, cleaned, max 10).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

let u; let other;
before(async () => {
  await H.setup();
  u = await H.mkUser();
  other = await H.mkUser();
});
after(H.teardown);

test('starts empty; sign-in required', async () => {
  const r = await H.api('GET', '/api/users/addresses', u.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.addresses, []);
  assert.equal((await H.api('GET', '/api/users/addresses')).status, 401);
  assert.equal((await H.api('PUT', '/api/users/addresses', null, { addresses: [] })).status, 401);
});

test('PUT keeps labelled places, cleans text, drops empty ones; GET reads them back', async () => {
  const r = await H.api('PUT', '/api/users/addresses', u.token, {
    addresses: [
      { id: 'phostel123', label: 'Hostel', block: 'Ganga', room: '304', landmark: '' },
      { label: 'Library', block: '', room: '', landmark: 'Central library, <b>2nd floor</b> reading hall' },
      { label: 'Nothing', block: '', room: '', landmark: '   ' },
      { label: 'A very long label that goes on and on', block: 'Block B lab', room: '12', landmark: 'x'.repeat(500) },
      'not-an-object',
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = r.body.addresses;
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: 'phostel123', label: 'Hostel', block: 'Ganga', room: '304', landmark: '' });
  assert.equal(list[1].label, 'Library');
  assert.ok(!/[<>]/.test(list[1].landmark), 'no angle brackets kept');
  assert.ok(list[1].id && list[1].id.length >= 6, 'an id is given when missing');
  assert.ok(list[2].label.length <= 24);
  assert.ok(list[2].landmark.length <= 120);
  const g = await H.api('GET', '/api/users/addresses', u.token);
  assert.deepEqual(g.body.addresses, list);
  assert.deepEqual((await H.api('GET', '/api/users/addresses', other.token)).body.addresses, [], 'other accounts untouched');
});

test('bad bodies are refused and the list is capped at 10', async () => {
  assert.equal((await H.api('PUT', '/api/users/addresses', u.token, { addresses: 'Ganga 304' })).status, 400);
  const many = Array.from({ length: 15 }, (_, i) => ({ label: 'Other', block: `Block ${i}`, room: String(100 + i) }));
  const r = await H.api('PUT', '/api/users/addresses', u.token, { addresses: many });
  assert.equal(r.status, 200);
  assert.equal(r.body.addresses.length, 10);
  assert.deepEqual((await H.api('PUT', '/api/users/addresses', u.token, { addresses: [] })).body.addresses, []);
});
