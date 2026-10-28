// utils/responseCache stale-while-revalidate (28 Oct live load test): an expired entry of the current
// generation is served at once and rebuilt in the background; an invalidated one never is.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const responseCache = require('../../utils/responseCache');

const get = (port, path) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  http.get({ host: '127.0.0.1', port, path }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null, ms: Date.now() - t0 }));
  }).on('error', reject);
});
const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const buildApp = (state) => {
  const app = express();
  app.get('/slow', responseCache.cacheGet('swrtest', { ttlMs: 100 }), async (req, res) => {
    state.calls++;
    await sleep(state.delayMs);
    if (state.fail) return res.status(500).json({ message: 'boom' });
    res.set('X-Extra', '1'); // a handler setting headers must not throw during a background refresh
    return res.json({ v: state.version });
  });
  return app;
};

test('expired entry: served stale at once, rebuilt once in the background, then fresh', async () => {
  responseCache.invalidateAll();
  const state = { calls: 0, version: 1, delayMs: 300, fail: false };
  const s = await listen(buildApp(state));
  try {
    const p = s.address().port;
    let r = await get(p, '/slow');
    assert.equal(r.headers['x-cache'], 'MISS');
    assert.deepEqual(r.body, { v: 1 });
    await sleep(150); // past the 100 ms TTL
    state.version = 2;
    const burst = await Promise.all([get(p, '/slow'), get(p, '/slow'), get(p, '/slow')]);
    for (const b of burst) {
      assert.equal(b.headers['x-cache'], 'STALE');
      assert.deepEqual(b.body, { v: 1 });
      assert.ok(b.ms < 200, `stale copy must not wait for the 300 ms rebuild (took ${b.ms} ms)`);
    }
    await sleep(320);
    assert.equal(state.calls, 2, 'one background rebuild for the whole burst');
    r = await get(p, '/slow');
    assert.equal(r.headers['x-cache'], 'HIT');
    assert.deepEqual(r.body, { v: 2 }, 'the rebuilt copy replaced the stale one');
  } finally { s.close(); }
});

test('invalidated entry is never served stale (writes show at once)', async () => {
  responseCache.invalidateAll();
  const state = { calls: 0, version: 1, delayMs: 10, fail: false };
  const s = await listen(buildApp(state));
  try {
    const p = s.address().port;
    await get(p, '/slow');
    await sleep(150);
    state.version = 2;
    responseCache.invalidate('swrtest');
    const r = await get(p, '/slow');
    assert.equal(r.headers['x-cache'], 'MISS');
    assert.deepEqual(r.body, { v: 2 });
  } finally { s.close(); }
});

test('a failing background rebuild keeps the stale copy and frees the key for the next try', async () => {
  responseCache.invalidateAll();
  const state = { calls: 0, version: 1, delayMs: 10, fail: false };
  const s = await listen(buildApp(state));
  try {
    const p = s.address().port;
    await get(p, '/slow');
    await sleep(150);
    state.fail = true;
    let r = await get(p, '/slow');
    assert.equal(r.headers['x-cache'], 'STALE');
    await sleep(60);
    state.fail = false;
    state.version = 3;
    r = await get(p, '/slow');
    assert.equal(r.headers['x-cache'], 'STALE', 'still the old copy');
    assert.deepEqual(r.body, { v: 1 });
    await sleep(60);
    r = await get(p, '/slow');
    assert.deepEqual(r.body, { v: 3 }, 'second refresh ran because the failed one freed the key');
    assert.equal(responseCache.stats().refreshing, 0);
  } finally { s.close(); }
});
