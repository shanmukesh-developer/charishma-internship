// utils/cacheHeaders + utils/responseCache: unchanged headers by default, CDN-friendly ones with EDGE_CACHE=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const cacheHeaders = require('../../utils/cacheHeaders');
const responseCache = require('../../utils/responseCache');

const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
  }).on('error', reject);
});
const listen = (app) => require('../listenFree').listenFree(app);

const buildApp = () => {
  const app = express();
  const mw = cacheHeaders.apiDefaultsMiddleware();
  if (mw) app.use(mw);
  app.get('/api/users/restaurants', responseCache.cacheGet('catalog', { ttlMs: 30000 }), (req, res) => res.json({ list: [1, 2, 3] }));
  app.get('/api/config', responseCache.cacheGet('config', { ttlMs: 30000, bypass: async () => false }), (req, res) => res.json({ c: 1 }));
  app.get('/api/orders/myorders', (req, res) => res.json({ mine: true }));
  app.get('/api/own', (req, res) => { res.set('Cache-Control', 'public, max-age=60'); res.json({ ok: 1 }); });
  app.get('/legal/privacy', (req, res) => res.send('<html></html>'));
  return app;
};

test('forCachedGroup: off = no-cache; on = public s-maxage for shared groups only', () => {
  const off = cacheHeaders.settings({});
  assert.equal(cacheHeaders.forCachedGroup('catalog', {}, off), 'no-cache');
  const on = cacheHeaders.settings({ EDGE_CACHE: '1' });
  assert.equal(cacheHeaders.forCachedGroup('catalog', {}, on), 'public, max-age=0, s-maxage=15, stale-while-revalidate=60');
  assert.equal(cacheHeaders.forCachedGroup('config', {}, on), 'no-cache', 'config is never shared');
  assert.equal(cacheHeaders.forCachedGroup('catalog', { bypassable: true }, on), 'no-cache', 'routes with a per-caller bypass are never shared');
  assert.equal(cacheHeaders.forCachedGroup('unknownGroup', {}, on), 'no-cache');
  const custom = cacheHeaders.settings({ EDGE_CACHE: 'true', EDGE_CACHE_GROUPS: 'campus,config', EDGE_CACHE_SMAXAGE: '5', EDGE_CACHE_SWR: '0' });
  assert.equal(cacheHeaders.forCachedGroup('campus', {}, custom), 'public, max-age=0, s-maxage=5');
  assert.equal(cacheHeaders.forCachedGroup('catalog', {}, custom), 'no-cache');
  assert.equal(cacheHeaders.forCachedGroup('config', {}, custom), 'no-cache');
  const clamp = cacheHeaders.settings({ EDGE_CACHE: '1', EDGE_CACHE_SMAXAGE: '99999', EDGE_CACHE_SWR: '-5' });
  assert.equal(clamp.sMaxAge, 300); assert.equal(clamp.swr, 0);
});

test('default (EDGE_CACHE unset): headers exactly as before', async () => {
  cacheHeaders.reload({});
  responseCache.invalidateAll();
  const s = await listen(buildApp());
  try {
    const p = s.address().port;
    let r = await get(p, '/api/users/restaurants', { 'accept-encoding': 'gzip' });
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(String(r.headers.vary), /Accept-Encoding/i);
    assert.ok(r.headers.etag);
    r = await get(p, '/api/users/restaurants', { 'if-none-match': r.headers.etag });
    assert.equal(r.status, 304);
    r = await get(p, '/api/orders/myorders', { authorization: 'Bearer x' });
    assert.equal(r.headers['cache-control'], undefined, 'no header added by default');
    r = await get(p, '/api/config');
    assert.equal(r.headers['cache-control'], 'no-cache');
  } finally { s.close(); }
});

test('EDGE_CACHE=1: shared groups public, user data private/no-store, own headers kept', async () => {
  cacheHeaders.reload({ EDGE_CACHE: '1' });
  responseCache.invalidateAll();
  const s = await listen(buildApp());
  try {
    const p = s.address().port;
    let r = await get(p, '/api/users/restaurants');
    assert.equal(r.headers['cache-control'], 'public, max-age=0, s-maxage=15, stale-while-revalidate=60');
    r = await get(p, '/api/users/restaurants'); // HIT path
    assert.equal(r.headers['x-cache'], 'HIT');
    assert.equal(r.headers['cache-control'], 'public, max-age=0, s-maxage=15, stale-while-revalidate=60');
    r = await get(p, '/api/config');
    assert.equal(r.headers['cache-control'], 'no-cache', 'config (admin bypass) is never shared');
    r = await get(p, '/api/orders/myorders', { authorization: 'Bearer abc' });
    assert.equal(r.headers['cache-control'], 'private, no-store');
    assert.match(String(r.headers.vary), /Authorization/i);
    r = await get(p, '/api/orders/myorders', { cookie: 'token=abc' });
    assert.equal(r.headers['cache-control'], 'private, no-store');
    r = await get(p, '/api/orders/myorders');
    assert.equal(r.headers['cache-control'], 'no-store');
    r = await get(p, '/api/own');
    assert.equal(r.headers['cache-control'], 'public, max-age=60', 'a route that sets its own header keeps it');
    r = await get(p, '/legal/privacy');
    assert.equal(r.headers['cache-control'], undefined, 'non-/api paths untouched');
  } finally {
    s.close();
    cacheHeaders.reload({});
  }
});
