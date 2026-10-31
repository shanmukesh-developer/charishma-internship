// Address search (GET /api/system/nominatim-proxy, 31 Oct 2026): signed-in students only, and one lookup per account
// in the shared one-per-second queue at a time, so nobody can hold the queue and make every other student wait.
// The upstream map service is stubbed (tests never touch the network).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

let server; let base; let realFetch;
test.before(async () => {
  await H.setup();
  realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://nominatim.openstreetmap.org/')) {
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, status: 200, json: async () => [{ display_name: 'SRM University AP, Neerukonda' }] };
    }
    return realFetch(url, opts);
  };
  const express = require(path.join(H.B, 'node_modules/express'));
  const app = express();
  app.use('/api/system', H.r('routes/systemRoutes'));
  server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  global.fetch = realFetch;
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

const get = (q, token) => realFetch(`${base}/api/system/nominatim-proxy?type=search&q=${encodeURIComponent(q)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('signed out is refused; a signed-in student gets results', async () => {
  assert.strictEqual((await get('Neerukonda', null)).status, 401);
  const u = await H.mkUser();
  const r = await get('SRM AP main gate', u.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json())[0].display_name, 'SRM University AP, Neerukonda');
});

test('one pending lookup per account: a second one at the same time is asked to wait', async () => {
  const u = await H.mkUser();
  const [a, b] = await Promise.all([get('Mangalagiri bus stand', u.token), get('Vijayawada railway station', u.token)]);
  assert.deepStrictEqual([a.status, b.status].sort(), [200, 429]);
  const other = await H.mkUser();
  assert.strictEqual((await get('Guntur', other.token)).status, 200, 'another student is not affected');
});
