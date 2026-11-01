// S1 item 1: Firebase App Check middleware — off / monitor / enforce, fail-open when the provider is down,
// firebase-admin mocked (no network), protected route table, admin / health / legal never checked.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

const AC = H.r('utils/appCheck');

// firebase-admin mock: getApps() reports an initialised app; verifyToken accepts 'good-*' tokens.
const verifyCalls = [];
let providerDown = false;
let slow = false;
const mockAdmin = () => {
  const appPath = require.resolve(path.join(H.B, 'node_modules/firebase-admin/lib/app/index.js'));
  const acPath = require.resolve(path.join(H.B, 'node_modules/firebase-admin/lib/app-check/index.js'));
  const err = (code, msg) => Object.assign(new Error(msg), { code: `app-check/${code}` });
  require.cache[appPath] = { id: appPath, filename: appPath, loaded: true, exports: { getApps: () => [{ name: '[DEFAULT]' }] } };
  require.cache[acPath] = {
    id: acPath, filename: acPath, loaded: true,
    exports: {
      getAppCheck: () => ({
        verifyToken: async (t) => {
          verifyCalls.push(t);
          if (slow) await new Promise((res) => setTimeout(res, 1500));
          if (providerDown) throw err('internal-error', 'Error fetching Json Web Keys');
          if (t === 'expired-token') throw err('app-check-token-expired', 'expired');
          if (!String(t).startsWith('good-')) throw err('invalid-argument', 'Decoding App Check token failed');
          return { appId: '1:123:android:abc', token: {} };
        },
      }),
    },
  };
};

const env = (o) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const OTP = (h = {}) => H.api('POST', '/api/users/send-otp', null, { phone: '12' }, h);

test.before(async () => { mockAdmin(); await H.setup(); });
test.after(() => { env({ APP_CHECK_MODE: undefined, APP_CHECK_ENFORCE_GROUPS: undefined, APP_CHECK_TIMEOUT_MS: undefined }); return H.teardown(); });
test.beforeEach(() => { AC.resetStats(); verifyCalls.length = 0; providerDown = false; slow = false; });

test('route table: abuse-prone POSTs are protected; admin, health, legal, webhooks, reads never', () => {
  const yes = [
    ['POST', '/api/users/send-otp', 'otp'], ['POST', '/api/users/login', 'auth'], ['POST', '/api/users/register', 'auth'],
    ['POST', '/api/users/verify-otp', 'auth'], ['POST', '/api/delivery/account/delete-otp', 'partner'], ['POST', '/api/auto-ride/driver/account/delete-otp', 'partner'],
    ['POST', '/api/users/send-email-otp', 'otp'],
    ['POST', '/api/delivery/login', 'partner'], ['POST', '/api/restaurants/login', 'partner'], ['POST', '/api/auto-ride/driver/auth/login', 'partner'],
    ['POST', '/api/orders', 'order'], ['POST', '/api/orders/', 'order'], ['POST', '/api/mega-basket', 'order'], ['POST', '/api/mega-basket/abc/pay', 'wallet'],
    ['POST', '/api/features/gift', 'wallet'], ['POST', '/api/vault/claim/x1', 'wallet'], ['POST', '/api/rentals/bookings', 'order'],
    ['POST', '/api/campus-events/9f1/register', 'events'], ['POST', '/api/campus-events/9f1/slots/s2/hold', 'events'], ['POST', '/api/campus-events/registrations/r1/confirm', 'events'],
    ['POST', '/api/auto-ride/trips/t1/holds', 'autoride'], ['POST', '/api/auto-ride/bookings/b1/confirm', 'autoride'],
  ];
  for (const [m, p, g] of yes) assert.strictEqual(AC.groupFor(m, p), g, `${m} ${p}`);
  const no = [
    ['POST', '/api/users/login/mfa'], ['GET', '/api/orders'], ['POST', '/api/orders/quote'], ['POST', '/api/admin/2fa/enable'], ['POST', '/api/admin/orders'],
    ['GET', '/api/health'], ['GET', '/legal/terms'], ['POST', '/api/campus-events/webhooks/razorpay'], ['POST', '/api/campus-events/organizer/events'],
    ['POST', '/api/campus-events/check-in/confirm'], ['POST', '/api/users/fcm-token'], ['PUT', '/api/orders/1/cancel'],
  ];
  for (const [m, p] of no) assert.strictEqual(AC.groupFor(m, p), null, `${m} ${p}`);
});

test('off (default): nothing verified, nothing counted, no header needed', async () => {
  env({ APP_CHECK_MODE: undefined });
  assert.strictEqual(AC.readMode(), 'off');
  const r = await OTP();
  assert.notStrictEqual(r.status, 401);
  assert.strictEqual(verifyCalls.length, 0);
  assert.strictEqual(AC.stats().totals.missing, 0);
  env({ APP_CHECK_MODE: 'bogus' });
  assert.strictEqual(AC.readMode(), 'off', 'unknown value = off');
});

test('monitor: verifies and counts valid / invalid / missing, never blocks', async () => {
  env({ APP_CHECK_MODE: 'monitor' });
  assert.notStrictEqual((await OTP()).status, 401);
  assert.notStrictEqual((await OTP({ 'X-Firebase-AppCheck': 'forged' })).status, 401);
  assert.notStrictEqual((await OTP({ 'X-Firebase-AppCheck': 'expired-token' })).status, 401);
  assert.notStrictEqual((await OTP({ 'X-Firebase-AppCheck': 'good-1' })).status, 401);
  const s = AC.stats();
  assert.deepStrictEqual({ v: s.totals.valid, i: s.totals.invalid, m: s.totals.missing, b: s.totals.blocked }, { v: 1, i: 2, m: 1, b: 0 });
  assert.strictEqual(s.byGroup.otp.valid, 1);
  assert.strictEqual(s.mode, 'monitor');
});

test('enforce: missing / invalid -> 401 APP_CHECK_REQUIRED; valid passes; unprotected routes untouched', async () => {
  env({ APP_CHECK_MODE: 'enforce' });
  let r = await OTP();
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'APP_CHECK_REQUIRED');
  r = await OTP({ 'X-Firebase-AppCheck': 'forged' });
  assert.strictEqual(r.body.code, 'APP_CHECK_REQUIRED');
  r = await OTP({ 'X-Firebase-AppCheck': 'good-2' });
  assert.notStrictEqual(r.status, 401);
  assert.strictEqual(r.status, 400, 'reached the controller (bad phone)');
  // admin + public reads never checked
  r = await H.api('GET', '/api/admin/me', null);
  assert.strictEqual(r.status, 401);
  assert.notStrictEqual(r.body.code, 'APP_CHECK_REQUIRED');
  r = await H.api('GET', '/api/users/config');
  assert.notStrictEqual(r.body && r.body.code, 'APP_CHECK_REQUIRED');
  assert.strictEqual(AC.stats().totals.blocked, 2);
});

test('enforce: provider unavailable / timeout fails OPEN (logged, counted)', async () => {
  env({ APP_CHECK_MODE: 'enforce', APP_CHECK_TIMEOUT_MS: '300' });
  providerDown = true;
  let r = await H.silent(() => OTP({ 'X-Firebase-AppCheck': 'good-3' }));
  assert.notStrictEqual(r.status, 401);
  providerDown = false;
  slow = true;
  r = await H.silent(() => OTP({ 'X-Firebase-AppCheck': 'good-4' }));
  assert.notStrictEqual(r.status, 401, 'timeout = unavailable = allowed');
  const s = AC.stats();
  assert.strictEqual(s.totals.unavailable, 2);
  assert.ok(s.lastUnavailable && s.lastUnavailable.reason);
  // no Firebase app at all (no credentials) -> unavailable, allowed
  AC._setVerifier(null);
  const appPath = require.resolve(path.join(H.B, 'node_modules/firebase-admin/lib/app/index.js'));
  const saved = require.cache[appPath];
  require.cache[appPath] = { ...saved, exports: { getApps: () => [] } };
  slow = false;
  r = await H.silent(() => OTP({ 'X-Firebase-AppCheck': 'good-5' }));
  assert.notStrictEqual(r.status, 401);
  assert.strictEqual(AC.stats().totals.unavailable, 3);
  require.cache[appPath] = saved;
  env({ APP_CHECK_TIMEOUT_MS: undefined });
});

test('enforce groups: APP_CHECK_ENFORCE_GROUPS limits blocking; the rest stays monitor', async () => {
  env({ APP_CHECK_MODE: 'enforce', APP_CHECK_ENFORCE_GROUPS: 'order,wallet' });
  const r = await OTP();
  assert.notStrictEqual(r.status, 401, 'otp group only monitored');
  const mw = AC.middleware();
  const run = (method, p) => new Promise((resolve) => {
    const req = { method, path: p, headers: {} };
    const res = { status: (c) => ({ json: (b) => resolve({ c, b }) }) };
    mw(req, res, () => resolve('next'));
  });
  assert.strictEqual((await run('POST', '/api/orders')).c, 401);
  assert.strictEqual(await run('POST', '/api/users/register'), 'next');
  env({ APP_CHECK_ENFORCE_GROUPS: undefined });
});

// 1 Nov 2026: enforce with no group list must not lock the partner apps out (they send no App Check token).
test('enforce, no group list: partner sign-ins stay open, customer calls are blocked; partner only when listed', async () => {
  env({ APP_CHECK_MODE: 'enforce', APP_CHECK_ENFORCE_GROUPS: undefined });
  const mw = AC.middleware();
  const run = (method, p) => new Promise((resolve) => {
    const req = { method, path: p, headers: {} };
    const res = { status: (c) => ({ json: (b) => resolve({ c, b }) }) };
    mw(req, res, () => resolve('next'));
  });
  assert.strictEqual(await run('POST', '/api/restaurants/login'), 'next');
  assert.strictEqual(await run('POST', '/api/delivery/login'), 'next');
  assert.strictEqual(await run('POST', '/api/auto-ride/driver/auth/login'), 'next');
  assert.strictEqual(await run('POST', '/api/delivery/account/delete-otp'), 'next');
  assert.strictEqual((await run('POST', '/api/orders')).c, 401, 'customer order still enforced');
  env({ APP_CHECK_ENFORCE_GROUPS: 'partner' });
  assert.strictEqual((await run('POST', '/api/delivery/login')).c, 401, 'listed explicitly: enforced');
  env({ APP_CHECK_ENFORCE_GROUPS: undefined, APP_CHECK_MODE: undefined });
});

test('admin web sign-in (X-Zenvy-Client: admin-web) is exempt, and then only admin accounts can sign in there', async () => {
  env({ APP_CHECK_MODE: 'enforce' });
  const admin = await H.mkUser({ role: 'admin' });
  const student = await H.mkUser();
  let r = await H.api('POST', '/api/users/login', null, { phone: admin.phone, password: admin.plainPassword }, { 'X-Zenvy-Client': 'admin-web' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  r = await H.api('POST', '/api/users/login', null, { phone: student.phone, password: student.plainPassword }, { 'X-Zenvy-Client': 'admin-web' });
  assert.strictEqual(r.status, 401, 'customer accounts cannot use the exempt admin path');
  assert.strictEqual(r.body.message, 'Invalid phone or password');
  r = await H.api('POST', '/api/users/login', null, { phone: student.phone, password: student.plainPassword });
  assert.strictEqual(r.body.code, 'APP_CHECK_REQUIRED', 'app sign-in without a token is blocked in enforce');
  r = await H.api('POST', '/api/users/login', null, { phone: student.phone, password: student.plainPassword }, { 'X-Firebase-AppCheck': 'good-6' });
  assert.strictEqual(r.status, 200);
  assert.ok(AC.stats().totals.exempt >= 2);
});

test('metrics: /api/admin/metrics/perf carries the appCheck counters', async () => {
  env({ APP_CHECK_MODE: 'monitor' });
  await OTP();
  const admin = await H.mkUser({ role: 'admin' });
  const r = await H.api('GET', '/api/admin/metrics/perf', admin.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.strictEqual(r.body.appCheck.mode, 'monitor');
  assert.ok(r.body.appCheck.totals.missing >= 1);
  env({ APP_CHECK_MODE: undefined });
});

test('error classification: bad-token codes are invalid, everything else is provider trouble', () => {
  assert.strictEqual(AC.isInvalidTokenError({ code: 'app-check/invalid-argument' }), true);
  assert.strictEqual(AC.isInvalidTokenError({ code: 'app-check/app-check-token-expired' }), true);
  assert.strictEqual(AC.isInvalidTokenError({ code: 'app-check/internal-error' }), false);
  assert.strictEqual(AC.isInvalidTokenError({ code: 'app-check/invalid-credential' }), false);
  assert.strictEqual(AC.isInvalidTokenError(new Error('ECONNRESET')), false);
});
