// The apps' remote API address override (<app>/…/endpointOverride.ts, identical in all five apps), run under
// Node's TypeScript type stripping, against a fake fetch / store. Plus the backend side it talks to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const COPIES = [
  'customer-mobile/utils/endpointOverride.ts',
  'delivery-boy-app/src/services/endpointOverride.ts',
  'restaurant-mobile/src/lib/endpointOverride.ts',
  'vendor-app/src/lib/endpointOverride.ts',
  'auto-driver-app/src/lib/endpointOverride.ts',
];
const BUILT_IN = 'https://hostelbites-backend-jwmt.onrender.com';
const NEW = 'https://api.zenvy.in';

let eo = null;
try { eo = require(path.join(ROOT, COPIES[0])); } catch (e) { eo = null; }
const skip = !eo && 'this Node cannot load .ts files (needs Node 22.18+ / 23.6+ type stripping)';

const memStore = (initial = null) => {
  let v = initial;
  return { get: () => v, set: (x) => { v = x; }, remove: () => { v = null; }, peek: () => v };
};
// servers: { [base]: { alive: bool, endpoints: object|null } }
const fakeFetch = (servers, log = []) => async (url) => {
  log.push(url);
  const u = new URL(url);
  const s = servers[u.origin];
  if (!s || s.down) throw new Error('network');
  if (u.pathname === '/livez') return { ok: !!s.alive, status: s.alive ? 200 : 503, json: async () => (s.alive ? { status: 'alive' } : {}) };
  if (u.pathname === '/api/config/endpoints') return { ok: true, status: 200, json: async () => s.endpoints || { apiBaseUrl: null, socketUrl: null } };
  return { ok: false, status: 404, json: async () => ({}) };
};
const TRUSTED = [new URL(BUILT_IN).hostname, 'api.zenvy.in', '*.zenvy.app'];

test('all five app copies are identical', () => {
  const texts = COPIES.map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'));
  for (const t of texts) assert.equal(t, texts[0]);
});

test('host trust rules: https only, host only, exact or *.suffix', { skip }, () => {
  assert.equal(eo.hostMatches('api.zenvy.in', 'api.zenvy.in'), true);
  assert.equal(eo.hostMatches('x.zenvy.app', '*.zenvy.app'), true);
  assert.equal(eo.hostMatches('zenvy.app', '*.zenvy.app'), false);
  assert.equal(eo.hostMatches('evilzenvy.app', '*.zenvy.app'), false);
  assert.equal(eo.trustedBase('https://api.zenvy.in/', TRUSTED), NEW);
  for (const bad of ['http://api.zenvy.in', 'https://api.zenvy.in:8443', 'https://api.zenvy.in/api', 'https://user@api.zenvy.in', 'https://api.zenvy.in.evil.com', 'https://evil.com', 'javascript:alert(1)', 42, null]) {
    assert.equal(eo.trustedBase(bad, TRUSTED), null, String(bad));
  }
  assert.deepEqual(eo.trustedHostsFrom(BUILT_IN, ' API.zenvy.in ,*.zenvy.app', ['https://x.y/z'], undefined), ['hostelbites-backend-jwmt.onrender.com', 'api.zenvy.in', '*.zenvy.app', 'x.y']);
});

test('resolveEndpoint: built-in by default, dev override wins, saved trusted override used, untrusted ignored', { skip }, () => {
  assert.deepEqual(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store: memStore() }), { api: BUILT_IN, socket: BUILT_IN, source: 'built-in' });
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, devOverride: 'http://192.168.1.5:5000/', trusted: TRUSTED, store: memStore(JSON.stringify({ api: NEW })) }).api, 'http://192.168.1.5:5000');
  assert.deepEqual(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store: memStore(JSON.stringify({ api: NEW })) }), { api: NEW, socket: NEW, source: 'remote' });
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store: memStore(JSON.stringify({ api: 'https://evil.com' })) }).source, 'built-in');
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store: memStore('{garbage') }).source, 'built-in');
  // A trust list without the new host (an older app build) ignores a saved value.
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: [new URL(BUILT_IN).hostname], store: memStore(JSON.stringify({ api: NEW })) }).source, 'built-in');
  // Storage that throws (web / no keystore) → built-in.
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store: { get() { throw new Error('x'); }, set() {}, remove() {} } }).source, 'built-in');
});

test('refresh: backend advertises nothing (default) → nothing stored', { skip }, async () => {
  const store = memStore();
  const r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active: { api: BUILT_IN, socket: BUILT_IN, source: 'built-in' }, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true } }) });
  assert.equal(r.action, 'none'); assert.equal(store.peek(), null);
});

test('refresh: trusted, healthy, self-consistent new address is saved for the next launch', { skip }, async () => {
  const store = memStore();
  const ep = { apiBaseUrl: NEW, socketUrl: NEW };
  const r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active: { api: BUILT_IN, socket: BUILT_IN, source: 'built-in' }, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true, endpoints: ep }, [NEW]: { alive: true, endpoints: ep } }) });
  assert.equal(r.action, 'saved'); assert.equal(JSON.parse(store.peek()).api, NEW);
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store }).api, NEW);
});

test('refresh: never switches to an untrusted, unhealthy or non-self-consistent address', { skip }, async () => {
  const active = { api: BUILT_IN, socket: BUILT_IN, source: 'built-in' };
  let store = memStore();
  let r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true, endpoints: { apiBaseUrl: 'https://evil.com' } } }) });
  assert.equal(r.action, 'untrusted'); assert.equal(store.peek(), null);
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true, endpoints: { apiBaseUrl: NEW } }, [NEW]: { alive: false } }) });
  assert.equal(r.action, 'candidate-down'); assert.equal(store.peek(), null);
  // A parked domain that answers /livez but is not our backend (does not advertise itself).
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true, endpoints: { apiBaseUrl: NEW } }, [NEW]: { alive: true, endpoints: { apiBaseUrl: null } } }) });
  assert.equal(r.action, 'candidate-mismatch'); assert.equal(store.peek(), null);
  // Untrusted socket URL → falls back to the API address.
  store = memStore();
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true, endpoints: { apiBaseUrl: NEW, socketUrl: 'https://evil.com' } }, [NEW]: { alive: true, endpoints: { apiBaseUrl: NEW } } }) });
  assert.equal(r.action, 'saved'); assert.equal(JSON.parse(store.peek()).socket, NEW);
  // Offline / backend down: nothing changes.
  store = memStore();
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({}) });
  assert.equal(r.action, 'no-answer'); assert.equal(store.peek(), null);
  // Dev builds never touch the override.
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active: { api: 'http://192.168.1.5:5000', socket: '', source: 'dev' }, trusted: TRUSTED, store, fetchImpl: fakeFetch({}) });
  assert.equal(r.action, 'skip-dev');
});

test('refresh: self-heal — a saved address that stops answering is removed when the built-in one answers', { skip }, async () => {
  const saved = JSON.stringify({ api: NEW, socket: NEW });
  let store = memStore(saved);
  const active = eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store });
  assert.equal(active.source, 'remote');
  let r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [BUILT_IN]: { alive: true }, [NEW]: { down: true } }) });
  assert.equal(r.action, 'reverted'); assert.equal(store.peek(), null);
  assert.equal(eo.resolveEndpoint({ builtIn: BUILT_IN, trusted: TRUSTED, store }).source, 'built-in');
  // Phone offline (neither answers): keep the override.
  store = memStore(saved);
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({}) });
  assert.equal(r.action, 'offline'); assert.equal(store.peek(), saved);
  // Owner rollback: PUBLIC_API_URL unset → the backend advertises nothing → override cleared.
  store = memStore(saved);
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [NEW]: { alive: true, endpoints: { apiBaseUrl: null } } }) });
  assert.equal(r.action, 'cleared'); assert.equal(store.peek(), null);
  // Advertising the built-in address also clears it.
  store = memStore(saved);
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [NEW]: { alive: true, endpoints: { apiBaseUrl: BUILT_IN } } }) });
  assert.equal(r.action, 'cleared');
  // Still advertised and healthy → unchanged.
  store = memStore(saved);
  r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active, trusted: TRUSTED, store, fetchImpl: fakeFetch({ [NEW]: { alive: true, endpoints: { apiBaseUrl: NEW, socketUrl: NEW } } }) });
  assert.equal(r.action, 'none'); assert.equal(store.peek(), saved);
});

test('refresh: a hanging server times out instead of blocking', { skip }, async () => {
  const t0 = Date.now();
  const r = await eo.refreshEndpointOverride({ builtIn: BUILT_IN, active: { api: BUILT_IN, socket: BUILT_IN, source: 'built-in' }, trusted: TRUSTED, store: memStore(), timeoutMs: 150, fetchImpl: () => new Promise(() => {}) });
  assert.equal(r.action, 'no-answer'); assert.ok(Date.now() - t0 < 2000);
});

test('backend: GET /api/config/endpoints payload matches what the apps expect', () => {
  const { advertisedEndpoints } = require('../../utils/publicUrl');
  const off = advertisedEndpoints({});
  assert.equal(off.apiBaseUrl, null);
  const on = advertisedEndpoints({ PUBLIC_API_URL: NEW });
  if (eo) assert.equal(eo.trustedBase(on.apiBaseUrl, TRUSTED), NEW);
});
