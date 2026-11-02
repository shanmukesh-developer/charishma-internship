// publicUrl, origins, clientIp, dbSettings (SSL / host type), advertised endpoints.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const publicUrl = require('../../utils/publicUrl');
const origins = require('../../utils/origins');
const clientIp = require('../../utils/clientIp');
const dbSettings = require('../../config/dbSettings');

const fakeReq = (host, protocol = 'https') => ({ protocol, get: (k) => (String(k).toLowerCase() === 'host' ? host : undefined) });

test('publicUrl.apiBase: defaults reproduce the old campusHelpers / imageStore behaviour', () => {
  const env = {};
  assert.equal(publicUrl.apiBase(fakeReq('x.onrender.com'), { env }), 'https://x.onrender.com');
  assert.equal(publicUrl.apiBase(null, { env }), '');
  assert.equal(publicUrl.apiBase(null, { env: { RENDER_EXTERNAL_URL: 'https://r.onrender.com/' }, renderFallback: true }), 'https://r.onrender.com');
  assert.equal(publicUrl.apiBase(null, { env: { RENDER_EXTERNAL_URL: 'https://r.onrender.com' }, renderFallback: false }), '');
  // A request beats RENDER_EXTERNAL_URL (old imageStore order).
  assert.equal(publicUrl.apiBase(fakeReq('h:5000', 'http'), { env: { RENDER_EXTERNAL_URL: 'https://r' }, renderFallback: true }), 'http://h:5000');
});

test('publicUrl.apiBase: PUBLIC_API_URL wins, trailing slashes removed, invalid values ignored', () => {
  assert.equal(publicUrl.apiBase(fakeReq('x'), { env: { PUBLIC_API_URL: 'https://api.zenvy.in//' } }), 'https://api.zenvy.in');
  assert.equal(publicUrl.apiBase(null, { env: { PUBLIC_API_URL: 'https://api.zenvy.in' } }), 'https://api.zenvy.in');
  assert.equal(publicUrl.apiBase(fakeReq('x.onrender.com'), { env: { PUBLIC_API_URL: 'api.zenvy.in' } }), 'https://x.onrender.com');
  assert.equal(publicUrl.apiBase(fakeReq('x.onrender.com'), { env: { PUBLIC_API_URL: 'https://bad host' } }), 'https://x.onrender.com');
  assert.equal(publicUrl.apiUrl(null, '/api/campus/media/1', { env: { PUBLIC_API_URL: 'https://a.b' } }), 'https://a.b/api/campus/media/1');
});

test('publicUrl: tracking links, keep-alive URL, web base', () => {
  assert.equal(publicUrl.orderTrackingUrl('o1', {}), 'https://zenvy.app/orders/o1');
  assert.equal(publicUrl.orderTrackingUrl('o1', { FRONTEND_URL: 'https://t.example' }), 'https://t.example/orders/o1');
  assert.equal(publicUrl.selfUrl(5000, {}), 'http://localhost:5000');
  assert.equal(publicUrl.selfUrl(5000, { RENDER_EXTERNAL_URL: 'https://r', PUBLIC_API_URL: 'https://api.x.y' }), 'https://r');
  assert.equal(publicUrl.webBase({}), '');
  assert.equal(publicUrl.webBase({ PUBLIC_WEB_URL: 'https://admin.zenvy.in/' }), 'https://admin.zenvy.in');
});

test('advertisedEndpoints: all null until PUBLIC_API_URL (https) is set', () => {
  assert.deepEqual(publicUrl.advertisedEndpoints({}), { apiBaseUrl: null, socketUrl: null, webUrl: null });
  assert.deepEqual(publicUrl.advertisedEndpoints({ PUBLIC_API_URL: 'http://api.zenvy.in' }), { apiBaseUrl: null, socketUrl: null, webUrl: null });
  assert.deepEqual(publicUrl.advertisedEndpoints({ PUBLIC_API_URL: 'https://api.zenvy.in/' }), { apiBaseUrl: 'https://api.zenvy.in', socketUrl: 'https://api.zenvy.in', webUrl: null });
  assert.deepEqual(publicUrl.advertisedEndpoints({ PUBLIC_API_URL: 'https://api.zenvy.in', PUBLIC_SOCKET_URL: 'https://ws.zenvy.in', PUBLIC_WEB_URL: 'https://admin.zenvy.in' }),
    { apiBaseUrl: 'https://api.zenvy.in', socketUrl: 'https://ws.zenvy.in', webUrl: 'https://admin.zenvy.in' });
});

test('origins: with no env the list is exactly the old one', () => {
  assert.deepEqual(origins.allowedOrigins({}), [
    'https://hostelbites-admin-iyoy.onrender.com',
    'https://hostelbites-backend-jwmt.onrender.com',
    'https://hostelbites-customer.onrender.com',
    'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002',
    'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002',
  ]);
  assert.deepEqual(origins.productionOrigins({}), origins.BUILT_IN_PRODUCTION_ORIGINS.slice());
});

test('origins: ALLOWED_ORIGINS + PUBLIC_WEB_URL / PUBLIC_API_URL extend the list, exact match only', () => {
  const env = { ALLOWED_ORIGINS: ' https://zenvy.in/ , https://www.zenvy.in', PUBLIC_WEB_URL: 'https://admin.zenvy.in/', PUBLIC_API_URL: 'https://api.zenvy.in' };
  const list = origins.productionOrigins(env);
  for (const o of ['https://zenvy.in', 'https://www.zenvy.in', 'https://admin.zenvy.in', 'https://api.zenvy.in', 'https://hostelbites-admin-iyoy.onrender.com']) assert.ok(list.includes(o), o);
  const silent = { warn: () => {} };
  const ok = origins.makeOriginChecker(env, { log: silent });
  assert.equal(ok('https://admin.zenvy.in'), true);
  assert.equal(ok('https://evil-admin.zenvy.in'), false);
  assert.equal(ok('https://admin.zenvy.in.evil.com'), false);
  assert.equal(ok(undefined), true);
  assert.equal(ok('http://localhost:8081'), true);
  assert.equal(ok('exp://192.168.1.2:8081'), true);
  assert.equal(ok('https://zenvy-fake.onrender.com'), false);
  const def = origins.makeOriginChecker({}, { log: silent });
  assert.equal(def('https://admin.zenvy.in'), false, 'nothing new is allowed by default');
  assert.equal(def('https://hostelbites-admin-iyoy.onrender.com'), true);
});

test('clientIp: TRUST_PROXY default 1, TRUST_CLOUDFLARE off installs nothing', () => {
  assert.equal(clientIp.trustProxySetting({}), 1);
  assert.equal(clientIp.trustProxySetting({ TRUST_PROXY: '2' }), 2);
  assert.equal(clientIp.trustProxySetting({ TRUST_PROXY: 'abc' }), 1);
  assert.equal(clientIp.trustProxySetting({ TRUST_PROXY: '0' }), 1);
  assert.equal(clientIp.cloudflareIpMiddleware({}), null);
  const list = clientIp.buildBlockList(clientIp.CLOUDFLARE_RANGES);
  assert.equal(clientIp.isInList(list, '173.245.48.10'), true);
  assert.equal(clientIp.isInList(list, '::ffff:104.16.0.1'), true);
  assert.equal(clientIp.isInList(list, '2606:4700::1111'), true);
  assert.equal(clientIp.isInList(list, '8.8.8.8'), false);
});

const ipApp = (env) => {
  const app = express();
  app.set('trust proxy', clientIp.trustProxySetting(env));
  const mw = clientIp.cloudflareIpMiddleware(env);
  if (mw) app.use(mw);
  app.get('/ip', (req, res) => res.json({ ip: req.ip, cf: !!req.viaCloudflare }));
  return app;
};
const getJson = (port, path, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    let b = '';
    res.on('data', (d) => { b += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b ? JSON.parse(b) : null }));
  }).on('error', reject);
});
const listen = (app) => require('../listenFree').listenFree(app);

test('clientIp: CF-Connecting-IP is used only when the hop that reached Render is a Cloudflare edge', async () => {
  const on = await listen(ipApp({ TRUST_CLOUDFLARE: '1' }));
  const off = await listen(ipApp({}));
  try {
    const p = on.address().port;
    // Render appends the Cloudflare edge address as the last X-Forwarded-For hop.
    let r = await getJson(p, '/ip', { 'x-forwarded-for': '49.37.1.2, 172.70.10.5', 'cf-connecting-ip': '49.37.1.2' });
    assert.equal(r.body.ip, '49.37.1.2'); assert.equal(r.body.cf, true);
    // Direct to onrender.com with a forged header: the hop is not Cloudflare, nothing changes.
    r = await getJson(p, '/ip', { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '1.1.1.1' });
    assert.equal(r.body.ip, '203.0.113.9'); assert.equal(r.body.cf, false);
    // Garbage header ignored.
    r = await getJson(p, '/ip', { 'x-forwarded-for': '172.70.10.5', 'cf-connecting-ip': 'not-an-ip' });
    assert.equal(r.body.ip, '172.70.10.5');
    // Default: the header is never looked at.
    r = await getJson(off.address().port, '/ip', { 'x-forwarded-for': '49.37.1.2, 172.70.10.5', 'cf-connecting-ip': '49.37.1.2' });
    assert.equal(r.body.ip, '172.70.10.5'); assert.equal(r.body.cf, false);
  } finally { on.close(); off.close(); }
});

test('dbSettings: DB_SSL auto reproduces the old rule; disable / require / verify; host types', () => {
  assert.deepEqual(dbSettings.getSslOptions('aws-0-ap-northeast-2.pooler.supabase.com', {}), { require: true, rejectUnauthorized: false });
  assert.equal(dbSettings.getSslOptions('dpg-abc123-a', {}), null);
  assert.deepEqual(dbSettings.getSslOptions('dpg-abc123-a.oregon-postgres.render.com', {}), { require: true, rejectUnauthorized: false });
  assert.equal(dbSettings.getSslOptions('db.example.com', { DB_SSL: 'disable' }), null);
  assert.deepEqual(dbSettings.getSslOptions('dpg-abc123-a', { DB_SSL: 'require' }), { require: true, rejectUnauthorized: false });
  assert.deepEqual(dbSettings.getSslOptions('h.x', { DB_SSL: 'verify', DB_SSL_CA: '-----BEGIN-----\\nabc' }), { require: true, rejectUnauthorized: true, ca: '-----BEGIN-----\nabc' });
  assert.deepEqual(dbSettings.getSslOptions('h.x', { DB_SSL: 'weird' }), { require: true, rejectUnauthorized: false });
  assert.equal(dbSettings.dbHostType(undefined), 'sqlite');
  assert.equal(dbSettings.dbHostType('postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres'), 'supabase');
  assert.equal(dbSettings.dbHostType('postgresql://u:p@db.abcd.supabase.co:5432/postgres'), 'supabase');
  assert.equal(dbSettings.dbHostType('postgresql://u:p@dpg-abc123-a/db'), 'render');
  assert.equal(dbSettings.dbHostType('postgresql://u:p@dpg-abc123-a.oregon-postgres.render.com/db'), 'render');
  assert.equal(dbSettings.dbHostType('postgresql://u:p@localhost/db'), 'local');
  assert.equal(dbSettings.dbHostType('postgresql://u:p@db.neon.tech/db'), 'other');
  assert.equal(dbSettings.dbPoolerMode('postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres'), 'transaction');
  assert.equal(dbSettings.dbPoolerMode('postgresql://u:p@aws-0.pooler.supabase.com:5432/postgres'), 'session');
  assert.equal(dbSettings.dbPoolerMode('postgresql://u:p@dpg-x/db'), null);
  assert.ok(!/p@|:p@/.test(dbSettings.describe({ DATABASE_URL: 'postgresql://user:secret@dpg-x/db' })), 'describe never prints credentials');
  assert.ok(!dbSettings.describe({ DATABASE_URL: 'postgresql://user:secret@dpg-x/db' }).includes('secret'));
});
