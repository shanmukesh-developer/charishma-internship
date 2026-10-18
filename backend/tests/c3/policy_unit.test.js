// C3 force update: pure policy logic (utils/appVersionPolicy.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const avp = require(path.join(__dirname, '..', '..', 'utils', 'appVersionPolicy'));

test('semver compare is numeric per part; prerelease / build metadata ignored', () => {
  assert.equal(avp.compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(avp.compareVersions('1.0.9', '1.0.10'), -1);
  assert.equal(avp.compareVersions('1.10.0', '1.9.99'), 1);
  assert.equal(avp.compareVersions('2.0.0', '10.0.0'), -1);
  assert.equal(avp.compareVersions('1.0.5', '1.0.5'), 0);
  assert.equal(avp.compareVersions('1.0.5-beta.1', '1.0.5'), 0);
  assert.equal(avp.compareVersions('1.0.6-rc1', '1.0.5'), 1);
  assert.equal(avp.compareVersions('1.0.5+45', '1.0.5'), 0);
  assert.equal(avp.compareVersions('v1.2', '1.2.0'), 0);
  assert.equal(avp.compareVersions('1', '1.0.0'), 0);
  assert.equal(avp.compareVersions('garbage', '1.0.0'), null);
  assert.equal(avp.compareVersions('1.0.0', ''), null);
  assert.equal(avp.compareVersions(null, '1.0.0'), null);
  assert.deepEqual(avp.parseVersion(' 1.2.3 '), [1, 2, 3]);
  assert.equal(avp.parseVersion('1.2.3.4'), null);
  assert.equal(avp.parseVersion('1.x'), null);
});

test('strict semver for stored values; builds are whole numbers', () => {
  for (const ok of ['0.0.1', '1.0.6', '10.20.30']) assert.equal(avp.isStrictSemver(ok), true, ok);
  for (const bad of ['1.0', '1.0.6-beta', 'v1.0.6', '01.0.0', '1.0.6 ', '', null, 106]) assert.equal(avp.isStrictSemver(bad), false, String(bad));
  assert.equal(avp.parseBuild('6'), 6);
  assert.equal(avp.parseBuild(7), 7);
  for (const bad of ['0', '-1', '1.5', 'abc', '', null, undefined, '99999999999']) assert.equal(avp.parseBuild(bad), null, String(bad));
});

test('app names: the five keys plus aliases, nothing else', () => {
  for (const a of avp.APPS) assert.equal(avp.normalizeApp(a), a);
  assert.equal(avp.normalizeApp('CUSTOMER'), 'customer');
  assert.equal(avp.normalizeApp('delivery'), 'rider');
  assert.equal(avp.normalizeApp('auto-driver'), 'autodriver');
  assert.equal(avp.normalizeApp('admin'), null);
  assert.equal(avp.normalizeApp(''), null);
  assert.equal(avp.normalizeApp(undefined), null);
});

test('policy parsing is lenient: defaults for missing / bad fields, JSON strings accepted', () => {
  const d = avp.parsePolicy(null);
  assert.equal(d.blockUnversionedClients, false);
  assert.deepEqual(Object.keys(d.apps).sort(), [...avp.APPS].sort());
  assert.equal(d.apps.customer.minSupportedVersion, '');
  assert.equal(d.apps.customer.storeUrl, 'https://play.google.com/store/apps/details?id=com.srm.hostelbites');
  assert.equal(d.apps.vendor.storeUrl, 'https://play.google.com/store/apps/details?id=com.srm.zenvyvendor');
  const p = avp.parsePolicy(JSON.stringify({
    blockUnversionedClients: 'yes', // not a boolean -> false
    apps: { customer: { minSupportedVersion: '1.0.6', latestVersion: 'nope', minSupportedBuild: '7', storeUrl: 'javascript:alert(1)', message: 'x'.repeat(500), softPromptEnabled: true }, bogus: { minSupportedVersion: '9.9.9' } },
  }));
  assert.equal(p.blockUnversionedClients, false);
  assert.equal(p.apps.customer.minSupportedVersion, '1.0.6');
  assert.equal(p.apps.customer.latestVersion, '');
  assert.equal(p.apps.customer.minSupportedBuild, 7);
  assert.match(p.apps.customer.storeUrl, /^https:\/\/play\.google\.com/);
  assert.equal(p.apps.customer.message.length, 300);
  assert.equal(p.apps.customer.softPromptEnabled, true);
  assert.equal(p.apps.bogus, undefined);
  assert.deepEqual(avp.parsePolicy('{not json'), avp.defaultPolicy());
  assert.deepEqual(avp.parsePolicy([1, 2]), avp.defaultPolicy());
});

test('evaluate: below min = blocked, below latest = soft, unknown version never blocked by version', () => {
  const p = avp.parsePolicy({ apps: { customer: { minSupportedVersion: '1.0.6', latestVersion: '1.0.10', minSupportedBuild: 7 } } });
  assert.equal(avp.evaluate(p, 'customer', '1.0.5', 6).status, 'blocked');
  assert.equal(avp.evaluate(p, 'customer', '1.0.5').status, 'blocked');
  assert.equal(avp.evaluate(p, 'customer', '1.0.6', 7).status, 'soft');
  assert.equal(avp.evaluate(p, 'customer', '1.0.9', 9).status, 'soft');
  assert.equal(avp.evaluate(p, 'customer', '1.0.10', 11).status, 'ok');
  assert.equal(avp.evaluate(p, 'customer', '1.0.10-beta', 11).status, 'ok');
  assert.equal(avp.evaluate(p, 'customer', '2.0.0', 20).status, 'ok');
  // build rule alone
  const r = avp.evaluate(p, 'customer', '1.0.10', 6);
  assert.deepEqual(r, { status: 'blocked', reason: 'build' });
  assert.equal(avp.evaluate(p, 'customer', 'garbage').status, 'ok');
  assert.equal(avp.evaluate(p, 'customer', undefined).status, 'ok');
  // other apps untouched
  assert.equal(avp.evaluate(p, 'rider', '0.0.1', 1).status, 'ok');
  assert.equal(avp.evaluate(avp.defaultPolicy(), 'customer', '0.0.1', 1).status, 'ok');
});

test('admin validation: semver, min <= latest, builds, urls, message length, unknown apps', () => {
  const cur = avp.defaultPolicy();
  const ok = avp.validateUpdate(cur, { apps: { customer: { minSupportedVersion: '1.0.6', latestVersion: '1.0.7', minSupportedBuild: 7, message: '  Please update  ', softPromptEnabled: true } } });
  assert.equal(ok.error, undefined);
  assert.equal(ok.policy.apps.customer.minSupportedVersion, '1.0.6');
  assert.equal(ok.policy.apps.customer.message, 'Please update');
  assert.equal(ok.policy.apps.rider.minSupportedVersion, ''); // untouched
  const bad = [
    [{ apps: { customer: { minSupportedVersion: '1.0' } } }, /not a version/],
    [{ apps: { customer: { minSupportedVersion: '1.0.6-beta' } } }, /not a version/],
    [{ apps: { customer: { latestVersion: 107 } } }, /must be a version/],
    [{ apps: { customer: { minSupportedVersion: '1.0.10', latestVersion: '1.0.9' } } }, /cannot be newer/],
    [{ apps: { customer: { minSupportedBuild: 0 } } }, /whole number/],
    [{ apps: { customer: { minSupportedBuild: '7.5' } } }, /whole number/],
    [{ apps: { customer: { storeUrl: 'http://play.google.com/x' } } }, /https/],
    [{ apps: { customer: { storeUrl: 'javascript:alert(1)' } } }, /https/],
    [{ apps: { customer: { message: 'x'.repeat(301) } } }, /too long/],
    [{ apps: { customer: { softPromptEnabled: 'yes' } } }, /true or false/],
    [{ apps: { admin: {} } }, /Unknown app/],
    [{ apps: [] }, /object keyed by app/],
    [{ blockUnversionedClients: 'true' }, /true or false/],
    [null, /JSON object/],
  ];
  for (const [body, re] of bad) {
    const r = avp.validateUpdate(cur, body);
    assert.ok(r.error, JSON.stringify(body));
    assert.match(r.error, re, JSON.stringify(body));
  }
  // min vs latest also checked against the already stored latest
  const stored = avp.validateUpdate(cur, { apps: { rider: { latestVersion: '1.0.3' } } }).policy;
  assert.match(avp.validateUpdate(stored, { apps: { rider: { minSupportedVersion: '1.0.4' } } }).error, /cannot be newer/);
  // clearing
  const cleared = avp.validateUpdate(ok.policy, { apps: { customer: { minSupportedVersion: '', minSupportedBuild: null, storeUrl: '' } } }).policy;
  assert.equal(cleared.apps.customer.minSupportedVersion, '');
  assert.equal(cleared.apps.customer.minSupportedBuild, null);
  assert.match(cleared.apps.customer.storeUrl, /id=com\.srm\.hostelbites$/);
  assert.equal(avp.validateUpdate(cur, { apps: { customer: { storeUrl: 'market://details?id=com.srm.hostelbites' } } }).policy.apps.customer.storeUrl, 'market://details?id=com.srm.hostelbites');
});

test('allow-list: health, config, logout, push-token removal, account deletion, deletion OTP only', () => {
  const req = (url, body) => ({ originalUrl: url, body });
  for (const u of ['/api/health', '/api/ping', '/api/config', '/api/config/', '/api/config/endpoints', '/api/config/app-version?app=customer',
    '/api/users/logout', '/api/users/fcm-token', '/api/users/fcm-token/remove', '/api/delivery/fcm-token/remove',
    '/api/users/account/deletion-check', '/api/users/account/delete', '/API/Users/Logout']) {
    assert.equal(avp.isAllowListed(req(u)), true, u);
  }
  for (const u of ['/api/orders', '/api/users/profile', '/api/users/login', '/api/configuration', '/api/users/accounts', '/api/users/logout-all', '/api/admin/app-versions', '/api/users/send-otp']) {
    assert.equal(avp.isAllowListed(req(u)), false, u);
  }
  assert.equal(avp.isAllowListed(req('/api/users/send-otp', { purpose: 'delete_account' })), true);
  assert.equal(avp.isAllowListed(req('/api/users/send-otp', { purpose: 'login' })), false);
});

test('native-app sniffing for the blockUnversionedClients switch: never a browser', () => {
  const req = (h) => ({ get: (k) => h[k] });
  assert.equal(avp.looksLikeNativeApp(req({ 'User-Agent': 'okhttp/4.12.0' })), true);
  assert.equal(avp.looksLikeNativeApp(req({ 'User-Agent': 'Zenvy/6 CFNetwork/1490 Darwin/23.0.0' })), true);
  assert.equal(avp.looksLikeNativeApp(req({ 'User-Agent': 'okhttp/4.12.0', Origin: 'https://admin.zenvy.app' })), false);
  assert.equal(avp.looksLikeNativeApp(req({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' })), false);
  assert.equal(avp.looksLikeNativeApp(req({ 'User-Agent': 'node' })), false);
  assert.equal(avp.looksLikeNativeApp(req({})), false);
});

test('public shape and 426 body', () => {
  const p = avp.parsePolicy({ apps: { rider: { minSupportedVersion: '1.0.4', latestVersion: '1.0.5', message: '' } } });
  const pub = avp.publicAppPolicy(p, 'rider');
  assert.deepEqual(Object.keys(pub).sort(), ['app', 'appName', 'latestVersion', 'message', 'minSupportedBuild', 'minSupportedVersion', 'softPromptEnabled', 'storeUrl']);
  assert.equal(pub.message, avp.DEFAULT_MESSAGE);
  assert.equal(pub.minSupportedBuild, null);
  const b = avp.upgradeBody(p, 'rider');
  assert.equal(b.code, 'UPGRADE_REQUIRED');
  assert.equal(b.storeUrl, 'https://play.google.com/store/apps/details?id=com.srm.hostelbitesdelivery');
  assert.equal(b.minSupportedVersion, '1.0.4');
});
