// C3 force update over HTTP + socket.io: the real gate, the real config + admin endpoints, a temp DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');
const { io: ioClient } = require(path.join(h.B, 'node_modules/socket.io-client'));

let adminUser;
let student;
test.before(async () => {
  await h.setup();
  adminUser = await h.mkUser('admin');
  student = await h.mkUser('student');
});
test.after(() => h.teardown());

const BASE_POLICY = {
  apps: {
    customer: { minSupportedVersion: '1.0.6', latestVersion: '1.0.8', softPromptEnabled: true, message: 'Security fix: please update.' },
    rider: { minSupportedVersion: '1.0.4', minSupportedBuild: 5 },
  },
};

test('no policy stored: nothing is blocked, app-version answers defaults', async () => {
  await h.setPolicy(null);
  const r = await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '0.0.1', 1) });
  assert.equal(r.status, 200);
  const v = await h.api('GET', '/api/config/app-version?app=customer');
  assert.equal(v.status, 200);
  assert.equal(v.body.success, true);
  assert.equal(v.body.app, 'customer');
  assert.equal(v.body.minSupportedVersion, null);
  assert.equal(v.body.storeUrl, 'https://play.google.com/store/apps/details?id=com.srm.hostelbites');
});

test('GET /api/config/app-version: per app, unknown app 400, no auth, small and cacheable', async () => {
  await h.setPolicy(BASE_POLICY);
  const v = await h.api('GET', '/api/config/app-version?app=customer');
  assert.equal(v.status, 200);
  assert.equal(v.body.minSupportedVersion, '1.0.6');
  assert.equal(v.body.latestVersion, '1.0.8');
  assert.equal(v.body.softPromptEnabled, true);
  assert.equal(v.body.message, 'Security fix: please update.');
  assert.ok(JSON.stringify(v.body).length < 600);
  const rider = await h.api('GET', '/api/config/app-version?app=rider');
  assert.equal(rider.body.minSupportedBuild, 5);
  assert.equal((await h.api('GET', '/api/config/app-version?app=delivery')).body.app, 'rider');
  assert.equal((await h.api('GET', '/api/config/app-version?app=nope')).status, 400);
  assert.equal((await h.api('GET', '/api/config/app-version')).status, 400);
  // A blocked version may still read it (it is how the app learns where to update).
  const blocked = await h.api('GET', '/api/config/app-version?app=customer', { headers: h.app('customer', '1.0.0') });
  assert.equal(blocked.status, 200);
});

test('426 UPGRADE_REQUIRED below min (version or build); newer / equal / other apps pass', async () => {
  await h.setPolicy(BASE_POLICY);
  const r = await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.5', 6), token: student.token });
  assert.equal(r.status, 426);
  assert.equal(r.body.code, 'UPGRADE_REQUIRED');
  assert.equal(r.body.storeUrl, 'https://play.google.com/store/apps/details?id=com.srm.hostelbites');
  assert.equal(r.body.message, 'Security fix: please update.');
  assert.equal(r.body.minSupportedVersion, '1.0.6');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await h.api('POST', '/api/orders', { headers: h.app('customer', '1.0.5'), body: { x: 1 } })).status, 426);
  // 1.0.10 > 1.0.6 numerically (string compare would say otherwise)
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.10') })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.6') })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.6-beta.2') })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.5-beta') })).status, 426);
  // rider: build rule
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('rider', '1.0.4', 4) })).status, 426);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('rider', '1.0.4', 5) })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('delivery', '1.0.3', 9) })).status, 426);
  // apps without a policy
  for (const a of ['vendor', 'restaurant', 'autodriver']) {
    assert.equal((await h.api('GET', '/api/auto-ride/driver/me', { headers: h.app(a, '0.0.1', 1) })).status, 200, a);
  }
  // junk / unknown values never block
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', 'not-a-version') })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer') })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('someapp', '0.0.1') })).status, 200);
});

test('allow-list still answers a blocked version: health, config, logout, push removal, account deletion', async () => {
  await h.setPolicy(BASE_POLICY);
  const old = h.app('customer', '1.0.0', 1);
  for (const [m, u, body] of [
    ['GET', '/api/health'],
    ['GET', '/api/config/app-version?app=customer'],
    ['POST', '/api/users/logout', {}],
    ['POST', '/api/users/fcm-token/remove', {}],
    ['GET', '/api/users/account/deletion-check'],
    ['POST', '/api/users/account/delete', { confirm: 'DELETE' }],
    ['POST', '/api/users/send-otp', { phone: '9000000000', purpose: 'delete_account' }],
  ]) {
    const r = await h.api(m, u, { headers: old, body });
    assert.notEqual(r.status, 426, `${m} ${u}`);
  }
  assert.equal((await h.api('POST', '/api/users/send-otp', { headers: old, body: { phone: '9000000000' } })).status, 426);
  assert.equal((await h.api('GET', '/api/restaurants', { headers: old })).status, 426);
});

test('requests WITHOUT X-App-Name are never blocked (web, admin, tests, old builds) while the switch is off', async () => {
  await h.setPolicy({ ...BASE_POLICY, blockUnversionedClients: false });
  assert.equal((await h.api('GET', '/api/orders/mine')).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: { 'User-Agent': 'okhttp/4.12.0' } })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: { 'X-App-Version': '0.0.1' } })).status, 200);
});

test('blockUnversionedClients: only header-less NATIVE-looking requests are refused; browsers and the allow-list pass', async () => {
  await h.setPolicy({ ...BASE_POLICY, blockUnversionedClients: true });
  const r = await h.api('GET', '/api/orders/mine', { headers: { 'User-Agent': 'okhttp/4.12.0' } });
  assert.equal(r.status, 426);
  assert.equal(r.body.code, 'UPGRADE_REQUIRED');
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: { 'User-Agent': 'okhttp/4.12.0', Origin: 'http://localhost:3004' } })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: { 'User-Agent': 'Mozilla/5.0' } })).status, 200);
  assert.equal((await h.api('GET', '/api/orders/mine')).status, 200); // node fetch (tests)
  assert.equal((await h.api('POST', '/api/users/account/delete', { headers: { 'User-Agent': 'okhttp/4.12.0' }, body: {} })).status, 200);
  // a current app that sends its version is unaffected by the switch
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: { 'User-Agent': 'okhttp/4.12.0', ...h.app('customer', '1.0.8') } })).status, 200);
  await h.setPolicy(BASE_POLICY);
});

test('a policy that cannot be read fails open', async () => {
  const GC = h.r('models/GlobalConfig').getGlobalConfigModel();
  const orig = GC.findOne;
  h.r('utils/appVersionPolicy').clearCache();
  GC.findOne = async () => { throw new Error('db down (test)'); };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '0.0.1') })).status, 200);
  } finally {
    GC.findOne = orig; console.warn = warn;
    h.r('utils/appVersionPolicy').clearCache();
  }
});

test('admin GET/PUT /api/admin/app-versions: auth, validation, partial merge, audit, takes effect at once', async () => {
  await h.setPolicy(null);
  assert.equal((await h.api('GET', '/api/admin/app-versions')).status, 401);
  assert.equal((await h.api('GET', '/api/admin/app-versions', { token: student.token })).status, 403);
  assert.equal((await h.api('PUT', '/api/admin/app-versions', { token: student.token, body: { apps: { customer: { minSupportedVersion: '9.9.9' } } } })).status, 403);

  const g = await h.api('GET', '/api/admin/app-versions', { token: adminUser.token });
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.apps, ['customer', 'rider', 'restaurant', 'vendor', 'autodriver', 'pgowner', 'campusstall']);
  assert.equal(g.body.packages.vendor, 'com.srm.zenvyvendor');
  assert.equal(g.body.policy.apps.customer.minSupportedVersion, '');

  for (const body of [
    { apps: { customer: { minSupportedVersion: '1.0' } } },
    { apps: { customer: { minSupportedVersion: '1.0.9', latestVersion: '1.0.8' } } },
    { apps: { customer: { storeUrl: 'http://evil.example' } } },
    { apps: { nope: {} } },
    { blockUnversionedClients: 'on' },
  ]) {
    const r = await h.api('PUT', '/api/admin/app-versions', { token: adminUser.token, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'INVALID_APP_VERSION_POLICY');
  }
  // nothing was written by the rejected attempts
  const logs0 = await h.r('models/VerificationLog').getVerificationLogModel().count({ where: { action: 'APP_VERSION_POLICY_UPDATED' } });
  assert.equal(logs0, 0);

  // warm the gate's cache with "no policy" first, then the PUT must still apply immediately
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.5') })).status, 200);
  const put = await h.api('PUT', '/api/admin/app-versions', { token: adminUser.token, body: { apps: { customer: { minSupportedVersion: '1.0.6', latestVersion: '1.0.7', minSupportedBuild: 7, message: '<b>Update</b> now', softPromptEnabled: true } } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.changed, true);
  assert.equal(put.body.policy.apps.customer.minSupportedVersion, '1.0.6');
  assert.equal(put.body.policy.apps.rider.minSupportedVersion, '');
  assert.ok(put.body.updatedAt);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.5') })).status, 426);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.6', 6) })).status, 426); // build 6 < 7
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.6', 7) })).status, 200);
  const pub = await h.api('GET', '/api/config/app-version?app=customer');
  assert.equal(pub.body.minSupportedVersion, '1.0.6'); // public cache cleared by the write

  // audit row with only the changes, attributed to the admin
  const VL = h.r('models/VerificationLog').getVerificationLogModel();
  const logs = await VL.findAll({ where: { action: 'APP_VERSION_POLICY_UPDATED' } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].adminId, String(adminUser.id));
  assert.equal(logs[0].targetId, 'app_versions');
  const det = JSON.parse(logs[0].details);
  assert.deepEqual(det.changes['customer.minSupportedVersion'], ['', '1.0.6']);
  assert.equal(det.changes['rider.minSupportedVersion'], undefined);

  // same values again: no write, no audit row
  const same = await h.api('PUT', '/api/admin/app-versions', { token: adminUser.token, body: { apps: { customer: { minSupportedVersion: '1.0.6' } } } });
  assert.equal(same.status, 200);
  assert.equal(same.body.changed, false);
  assert.equal(await VL.count({ where: { action: 'APP_VERSION_POLICY_UPDATED' } }), 1);

  // stale editor (ifUpdatedAt from before) -> 409, nothing changed
  const stale = await h.api('PUT', '/api/admin/app-versions', { token: adminUser.token, body: { ifUpdatedAt: '2020-01-01T00:00:00.000Z', apps: { customer: { minSupportedVersion: '' } } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'CONFIG_CONFLICT');
  // with the current version it works; clearing the minimum unblocks at once
  const g2 = await h.api('GET', '/api/admin/app-versions', { token: adminUser.token });
  const clr = await h.api('PUT', '/api/admin/app-versions', { token: adminUser.token, body: { ifUpdatedAt: g2.body.updatedAt, apps: { customer: { minSupportedVersion: '', minSupportedBuild: null } } } });
  assert.equal(clr.status, 200, JSON.stringify(clr.body));
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.0', 1) })).status, 200);
  assert.equal(await VL.count({ where: { action: 'APP_VERSION_POLICY_UPDATED' } }), 2);

  // the generic config write cannot bypass validation
  const gen = await h.api('POST', '/api/admin/config', { token: adminUser.token, body: { key: 'APP_VERSION_POLICY', value: { apps: { customer: { minSupportedVersion: '99.0.0' } } } } });
  assert.equal(gen.status, 400);
  assert.equal((await h.api('GET', '/api/orders/mine', { headers: h.app('customer', '1.0.0', 1) })).status, 200);

  // admin web requests (no X-App-Name) are never blocked even with a strict policy
  await h.api('PUT', '/api/admin/app-versions', { token: adminUser.token, body: { blockUnversionedClients: true, apps: { customer: { minSupportedVersion: '1.0.7' } } } });
  assert.equal((await h.api('GET', '/api/admin/app-versions', { token: adminUser.token, headers: { Origin: 'http://localhost:3004' } })).status, 200);
  await h.setPolicy(null);
});

const sock = (auth = {}, query = undefined) => new Promise((resolve) => {
  const s = ioClient(globalThis.__c3base, { transports: ['websocket'], auth, query, reconnection: false, timeout: 5000 });
  const done = (v) => { s.close(); resolve(v); };
  s.on('connect', () => done({ ok: true }));
  s.on('connect_error', (err) => done({ ok: false, message: err.message, data: err.data }));
});

test('socket handshake: retired version refused with UPGRADE_REQUIRED; others and no-appName connect', async () => {
  const ctx = await h.setup();
  globalThis.__c3base = ctx.base;
  await h.setPolicy(BASE_POLICY);
  const refused = await sock({ token: null, appName: 'customer', appVersion: '1.0.5', appBuild: '6' });
  assert.equal(refused.ok, false);
  assert.equal(refused.data && refused.data.code, 'UPGRADE_REQUIRED');
  assert.match(refused.data.storeUrl, /id=com\.srm\.hostelbites$/);
  assert.deepEqual(await sock({ appName: 'customer', appVersion: '1.0.10' }), { ok: true });
  assert.deepEqual(await sock({}), { ok: true });
  assert.deepEqual(await sock({ appName: 'vendor', appVersion: '0.0.1' }), { ok: true });
  // query-string form too
  const q = await sock({}, { appName: 'rider', appVersion: '1.0.4', appBuild: '4' });
  assert.equal(q.ok, false);
  assert.equal(q.data.code, 'UPGRADE_REQUIRED');
  await h.setPolicy(null);
  assert.deepEqual(await sock({ appName: 'customer', appVersion: '1.0.5' }), { ok: true });
});
