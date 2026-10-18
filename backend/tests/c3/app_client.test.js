// The apps' force-update module (<app>/…/forceUpdate.ts + UpdateGate.tsx, identical in all five apps), run
// under Node's TypeScript type stripping against a fake fetch, plus a live round trip against the real gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIRS = ['customer-mobile/utils', 'delivery-boy-app/src/services', 'restaurant-mobile/src/lib', 'vendor-app/src/lib', 'auto-driver-app/src/lib'];

let fu = null;
try { fu = require(path.join(ROOT, DIRS[0], 'forceUpdate.ts')); } catch { fu = null; }
const skip = !fu && 'this Node cannot load .ts files (needs Node 22.18+ / 23.6+ type stripping)';

const CLIENT = (version = '1.0.5', build = 6, app = 'customer') => ({ app, version, build, packageId: 'com.srm.hostelbites' });
const API = 'https://api.example.test';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return res(status, body); } });

test('forceUpdate.ts and UpdateGate.tsx are identical in all five apps', () => {
  for (const f of ['forceUpdate.ts', 'UpdateGate.tsx']) {
    const texts = DIRS.map((d) => fs.readFileSync(path.join(ROOT, d, f), 'utf8').replace(/\r\n/g, '\n'));
    for (let i = 1; i < texts.length; i++) assert.equal(texts[i], texts[0], `${DIRS[i]}/${f}`);
  }
});

test('every app configures its own key and sends the headers from its HTTP client + socket handshake', () => {
  const expect = {
    'customer-mobile': { cfg: 'constants/api.ts', key: 'customer', http: 'utils/auth.ts', sockets: ['utils/socket.ts', 'context/CartContext.tsx', 'modules/campus/campusSocketClient.ts'], root: 'app/_layout.tsx' },
    'delivery-boy-app': { cfg: 'src/config.ts', key: 'rider', http: 'src/services/apiClient.ts', sockets: ['src/services/socket.ts'], root: 'App.tsx' },
    'restaurant-mobile': { cfg: 'src/config.ts', key: 'restaurant', http: 'src/lib/http.ts', sockets: ['src/state/SocketProvider.tsx'], root: 'App.tsx' },
    'vendor-app': { cfg: 'src/config.ts', key: 'vendor', http: 'src/lib/http.ts', sockets: ['src/state/SocketProvider.tsx'], root: 'App.tsx' },
    'auto-driver-app': { cfg: 'src/config.ts', key: 'autodriver', http: 'src/lib/http.ts', sockets: ['src/state/SocketProvider.tsx'], root: 'App.tsx' },
  };
  for (const [app, e] of Object.entries(expect)) {
    const read = (f) => fs.readFileSync(path.join(ROOT, app, f), 'utf8');
    assert.match(read(e.cfg), new RegExp(`configureForceUpdate\\(\\{ app: '${e.key}'`), app);
    assert.match(read(e.http), /versionHeaders\(\)/, `${app} http headers`);
    assert.match(read(e.http), /426/, `${app} http 426`);
    for (const s of e.sockets) assert.match(read(s), /socketVersionAuth\(\)/, `${app} ${s}`);
    assert.match(read(e.root), /<UpdateGate>/, `${app} root`);
  }
});

test('version compare + decision match the server', { skip }, () => {
  const avp = require(path.join(__dirname, '..', '..', 'utils', 'appVersionPolicy'));
  const pairs = [['1.0.10', '1.0.9'], ['1.0.9', '1.0.10'], ['1.0.5-beta', '1.0.5'], ['2.0', '1.9.9'], ['x', '1.0.0'], ['1.0.5+7', '1.0.5'], ['10.0.0', '9.99.99']];
  for (const [a, b] of pairs) assert.equal(fu.compareVersions(a, b), avp.compareVersions(a, b), `${a} vs ${b}`);
  const pol = (o) => fu.policyFromBody({ app: 'customer', storeUrl: 'https://play.google.com/store/apps/details?id=com.srm.hostelbites', ...o });
  assert.equal(fu.evaluatePolicy(pol({ minSupportedVersion: '1.0.6' }), CLIENT('1.0.5')), 'blocked');
  assert.equal(fu.evaluatePolicy(pol({ minSupportedVersion: '1.0.6' }), CLIENT('1.0.10')), 'ok');
  assert.equal(fu.evaluatePolicy(pol({ minSupportedBuild: 7 }), CLIENT('1.0.5', 6)), 'blocked');
  assert.equal(fu.evaluatePolicy(pol({ latestVersion: '1.0.7', softPromptEnabled: true }), CLIENT('1.0.5')), 'soft');
  assert.equal(fu.evaluatePolicy(pol({ latestVersion: '1.0.7', softPromptEnabled: false }), CLIENT('1.0.5')), 'ok');
  assert.equal(fu.evaluatePolicy(pol({ minSupportedVersion: '1.0.6' }), CLIENT(null)), 'ok');
  assert.equal(fu.evaluatePolicy(null, CLIENT('0.0.1')), 'ok');
});

test('store links: market:// first on Android, https fallback; non-Play links kept as-is', { skip }, () => {
  const play = 'https://play.google.com/store/apps/details?id=com.srm.hostelbites';
  assert.deepEqual(fu.storeLinks(play, null, true), ['market://details?id=com.srm.hostelbites', play]);
  assert.deepEqual(fu.storeLinks(play, null, false), [play]);
  assert.deepEqual(fu.storeLinks('market://details?id=com.srm.zenvyvendor', null, true), ['market://details?id=com.srm.zenvyvendor', 'https://play.google.com/store/apps/details?id=com.srm.zenvyvendor']);
  assert.deepEqual(fu.storeLinks('https://zenvy.app/download', null, true), ['https://zenvy.app/download']);
  assert.deepEqual(fu.storeLinks(null, 'com.srm.zenvyautodriver', true), ['market://details?id=com.srm.zenvyautodriver', 'https://play.google.com/store/apps/details?id=com.srm.zenvyautodriver']);
  assert.deepEqual(fu.storeLinks('javascript:alert(1)', null, true), []);
});

test('web / unknown version: no headers, no socket fields, no fetch hook, never blocked', { skip }, async () => {
  fu.resetForceUpdateForTests();
  const target = { fetch: async () => res(200, {}) };
  // Under Node there is no react-native: readNativeClientInfo -> null (same as Platform.OS === 'web').
  assert.equal(fu.readNativeClientInfo('customer'), null);
  assert.equal(fu.configureForceUpdate({ app: 'customer', apiBase: API, hookFetch: false }), null);
  assert.deepEqual(fu.versionHeaders(), {});
  assert.deepEqual(fu.socketVersionAuth(), {});
  assert.equal(fu.reportUpgradeRequired({ code: 'UPGRADE_REQUIRED' }), false);
  assert.equal(fu.getUpdateState().status, 'ok');
  assert.equal((await fu.checkForUpdate({ fetchImpl: async () => { throw new Error('must not be called'); } })).status, 'ok');
  void target;
});

test('fetch hook: headers only on API calls, existing headers win, 426 -> blocked', { skip }, async () => {
  fu.resetForceUpdateForTests();
  fu.configureForceUpdate({ app: 'customer', apiBase: `${API}/api`, info: CLIENT('1.0.5', 6), hookFetch: false });
  assert.deepEqual(fu.versionHeaders(), { 'X-App-Name': 'customer', 'X-App-Version': '1.0.5', 'X-App-Build': '6' });
  assert.deepEqual(fu.socketVersionAuth(), { appName: 'customer', appVersion: '1.0.5', appBuild: '6' });
  const seen = [];
  let answer = res(200, { ok: true });
  const wrapped = fu.wrapFetch(async (url, init) => { seen.push({ url, init }); return answer; });
  await wrapped(`${API}/api/orders`, { headers: { Authorization: 'Bearer t' } });
  assert.equal(seen[0].init.headers['X-App-Version'], '1.0.5');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer t');
  await wrapped('https://images.unsplash.com/x.jpg');
  assert.equal(seen[1].init, undefined);
  await wrapped(`${API}/api/x`, { headers: { 'x-app-version': '9.9.9' } });
  assert.equal(seen[2].init.headers['x-app-version'], '9.9.9');
  assert.equal(seen[2].init.headers['X-App-Version'], undefined);
  await wrapped(`${API}/api/y`, { headers: [['Accept', 'application/json']] });
  assert.ok(seen[3].init.headers.some(([k]) => k === 'X-App-Name'));
  const states = [];
  const unsub = fu.subscribeUpdateState((s) => states.push(s.status));
  answer = res(426, { success: false, code: 'UPGRADE_REQUIRED', app: 'customer', appName: 'Zenvy', minSupportedVersion: '1.0.6', storeUrl: 'https://play.google.com/store/apps/details?id=com.srm.hostelbites', message: 'Please update' });
  await wrapped(`${API}/api/orders`, {});
  assert.equal(fu.getUpdateState().status, 'blocked');
  assert.equal(fu.getUpdateState().policy.message, 'Please update');
  assert.deepEqual(states, ['blocked']);
  // a 426 from some other host is ignored
  fu.resetForceUpdateForTests();
  fu.configureForceUpdate({ app: 'customer', apiBase: API, info: CLIENT('1.0.5'), hookFetch: false });
  const w2 = fu.wrapFetch(async () => res(426, { code: 'UPGRADE_REQUIRED' }));
  await w2('https://elsewhere.test/api/x');
  assert.equal(fu.getUpdateState().status, 'ok');
  unsub();
});

test('installFetchHook wraps the global fetch once', { skip }, async () => {
  fu.resetForceUpdateForTests();
  const target = { fetch: async (u, i) => ({ u, i, status: 200 }) };
  fu.configureForceUpdate({ app: 'vendor', apiBase: API, info: CLIENT('1.0.0', 1, 'vendor'), hookFetch: false });
  assert.equal(fu.installFetchHook(target), true);
  assert.equal(fu.installFetchHook(target), false);
  const out = await target.fetch(`${API}/api/vendor/me`, {});
  assert.equal(out.i.headers['X-App-Name'], 'vendor');
});

test('checkForUpdate: blocked / soft / ok from the server answer; offline keeps state; Retry clears a block', { skip }, async () => {
  fu.resetForceUpdateForTests();
  fu.configureForceUpdate({ app: 'customer', apiBase: API, info: CLIENT('1.0.5', 6), hookFetch: false });
  let answer = { app: 'customer', appName: 'Zenvy', minSupportedVersion: '1.0.6', latestVersion: '1.0.7', storeUrl: 'https://play.google.com/store/apps/details?id=com.srm.hostelbites', message: 'm', softPromptEnabled: true };
  const urls = [];
  const f = async (url, init) => { urls.push({ url, init }); return res(200, { success: true, ...answer }); };
  assert.equal((await fu.checkForUpdate({ fetchImpl: f })).status, 'blocked');
  assert.equal(urls[0].url, `${API}/api/config/app-version?app=customer`);
  assert.equal(urls[0].init.headers['X-App-Name'], 'customer');
  answer = { ...answer, minSupportedVersion: '1.0.4' };
  assert.equal((await fu.checkForUpdate({ fetchImpl: f })).status, 'soft');
  answer = { ...answer, latestVersion: '1.0.5' };
  assert.equal((await fu.checkForUpdate({ fetchImpl: f })).status, 'ok');
  // a 426 from an API call, then the owner lowers the minimum: Retry (a check) unblocks
  fu.reportUpgradeRequired({ code: 'UPGRADE_REQUIRED', app: 'customer' });
  assert.equal(fu.getUpdateState().status, 'blocked');
  assert.equal(fu.getUpdateState().policy.message, fu.DEFAULT_UPDATE_MESSAGE);
  assert.equal((await fu.checkForUpdate({ fetchImpl: f })).status, 'ok');
  // offline / 500: state unchanged
  fu.reportUpgradeRequired({ code: 'UPGRADE_REQUIRED', app: 'customer' });
  assert.equal((await fu.checkForUpdate({ fetchImpl: async () => { throw new Error('offline'); } })).status, 'blocked');
  assert.equal((await fu.checkForUpdate({ fetchImpl: async () => res(500, {}) })).status, 'blocked');
  // concurrent checks share one request
  let calls = 0;
  const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return res(200, { success: true, ...answer }); };
  await Promise.all([fu.checkForUpdate({ fetchImpl: slow }), fu.checkForUpdate({ fetchImpl: slow }), fu.checkForUpdate({ fetchImpl: slow })]);
  assert.equal(calls, 1);
});

test('socket refusal with UPGRADE_REQUIRED -> blocked; other socket errors ignored', { skip }, () => {
  fu.resetForceUpdateForTests();
  fu.configureForceUpdate({ app: 'rider', apiBase: API, info: CLIENT('1.0.3', 4, 'rider'), hookFetch: false });
  assert.equal(fu.reportSocketError(new Error('Authentication error')), false);
  assert.equal(fu.reportSocketError(Object.assign(new Error('Server is starting'), { data: { code: 'SERVER_STARTING' } })), false);
  assert.equal(fu.getUpdateState().status, 'ok');
  assert.equal(fu.reportSocketError(Object.assign(new Error('UPGRADE_REQUIRED'), { data: { code: 'UPGRADE_REQUIRED', app: 'rider', storeUrl: 'market://details?id=com.srm.hostelbitesdelivery' } })), true);
  assert.equal(fu.getUpdateState().status, 'blocked');
  assert.equal(fu.getUpdateState().policy.app, 'rider');
});

test('live round trip: app module against the real gate + app-version endpoint', { skip }, async (t) => {
  const h = require('./helpers');
  const ctx = await h.setup();
  t.after(() => h.teardown());
  await h.setPolicy({ apps: { customer: { minSupportedVersion: '1.0.6', latestVersion: '1.0.7', softPromptEnabled: true } } });
  fu.resetForceUpdateForTests();
  fu.configureForceUpdate({ app: 'customer', apiBase: ctx.base, info: CLIENT('1.0.5', 6), hookFetch: false });
  const wrapped = fu.wrapFetch(fetch);
  const r = await wrapped(`${ctx.base}/api/orders/mine`, {});
  assert.equal(r.status, 426);
  assert.equal(fu.getUpdateState().status, 'blocked');
  assert.equal(fu.getUpdateState().policy.storeUrl, 'https://play.google.com/store/apps/details?id=com.srm.hostelbites');
  // updated app
  fu.resetForceUpdateForTests();
  fu.configureForceUpdate({ app: 'customer', apiBase: ctx.base, info: CLIENT('1.0.6', 7), hookFetch: false });
  assert.equal((await fu.wrapFetch(fetch)(`${ctx.base}/api/orders/mine`, {})).status, 200);
  assert.equal((await fu.checkForUpdate({ fetchImpl: fetch })).status, 'soft');
  await h.setPolicy(null);
});
