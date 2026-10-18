// S0 item 5: contact search by name / friend code needs >= 3 characters, has a daily budget and never
// returns phone digits; exact full-number lookup keeps its own budget and still works.
// S0 item 6: GET /api/users/config returns only the public allow-list to anyone but a live admin.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let me; let target; let admin;
test.before(async () => {
  await H.setup();
  me = await H.mkUser({ name: 'Searcher Sam' });
  target = await H.mkUser({ name: 'Zelda Uniquename' });
  admin = await H.mkUser({ role: 'admin' });
  const GC = H.ctx.M.GlobalConfig;
  await GC.create({ key: 'AUTO_RIDE_SETTINGS', value: { secretFare: 42 }, description: 'internal' });
  await GC.create({ key: 'RIDER_CASH_LIMIT', value: 2500, description: 'internal' });
  await GC.create({ key: 'AFTER_DARK_ENABLED', value: true, description: 'switch' });
  await GC.create({ key: 'CAMPUS_WHISPERS_ENABLED', value: false, description: 'switch' });
});
test.after(() => H.teardown());

test('2-character name searches return nothing; 3+ characters find the person without any phone digits', async () => {
  H.resetLimits();
  let r = await H.api('POST', '/api/friends/contacts', me.token, { query: 'Ze' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, []);
  r = await H.api('POST', '/api/friends/contacts', me.token, { query: 'Zel' });
  assert.strictEqual(r.status, 200);
  const hit = r.body.find((u) => u.id === target.id);
  assert.ok(hit, 'found by 3 letters');
  assert.strictEqual(hit.phone, null, 'no masked last-4 any more');
  assert.ok(!JSON.stringify(r.body).includes(String(target.phone).slice(-4)));
});

test('text searches are budgeted per day (429 SEARCH_LIMIT), exact phone lookup still works', async () => {
  H.resetLimits();
  let last = null;
  for (let i = 0; i < 61; i++) last = await H.api('POST', '/api/friends/contacts', me.token, { query: `abc${i}` });
  assert.strictEqual(last.status, 429);
  assert.strictEqual(last.body.code, 'SEARCH_LIMIT');
  // full-number lookup has its own (contact-sync) budget and returns the full number for that match
  const r = await H.api('POST', '/api/friends/contacts', me.token, { query: target.phone });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const hit = r.body.find((u) => u.id === target.id);
  assert.ok(hit);
  assert.strictEqual(hit.phone, target.phone);
  H.resetLimits();
});

test('public config: only allow-listed keys for anonymous and signed-in non-admins; admins get every row', async () => {
  for (const tok of [null, me.token]) {
    const r = await H.api('GET', '/api/users/config', tok);
    assert.strictEqual(r.status, 200);
    const keys = r.body.map((c) => c.key).sort();
    assert.deepStrictEqual(keys, ['AFTER_DARK_ENABLED', 'CAMPUS_WHISPERS_ENABLED']);
    assert.ok(!JSON.stringify(r.body).includes('secretFare'));
    assert.ok(r.body.every((c) => Object.keys(c).sort().join(',') === '_id,id,key,value'));
  }
  const a = await H.api('GET', '/api/users/config', admin.token);
  assert.strictEqual(a.status, 200);
  const keys = a.body.map((c) => c.key);
  assert.ok(keys.includes('AUTO_RIDE_SETTINGS') && keys.includes('RIDER_CASH_LIMIT'));
  assert.strictEqual(a.headers.get('x-cache'), 'BYPASS');
  // the anonymous response cached after an admin read is still the public one
  const again = await H.api('GET', '/api/users/config');
  assert.deepStrictEqual(again.body.map((c) => c.key).sort(), ['AFTER_DARK_ENABLED', 'CAMPUS_WHISPERS_ENABLED']);
});
