// Active testers recording (utils/appPresence via middleware/authMiddleware protect): a signed-in customer-app
// request writes lastSeenAt / firstSeenAt / lastAppVersion / lastAppBuild / lastPlatform at most once per 10 minutes
// (a new app version is written at once); partner apps, requests without X-App-Name and load-test traffic are
// ignored; a failed write never breaks or slows the request; the columns never reach the customer's own profile.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');

const { api } = H;
let presence;
before(async () => {
  await H.setup();
  presence = H.r('utils/appPresence');
});
after(H.teardown);
beforeEach(() => presence._reset());

const CUSTOMER = (version = '1.0.65', build = '66') => ({ 'x-app-name': 'customer', 'x-app-version': version, 'x-app-build': build });
const row = (id) => H.ctx.M('User').findByPk(id, { raw: true });
const settle = async (id, check, ms = 2000) => {
  const end = Date.now() + ms;
  for (;;) {
    const r = await row(id);
    if (check(r)) return r;
    if (Date.now() > end) return r;
    await new Promise((res) => setTimeout(res, 20));
  }
};
const pause = (ms) => new Promise((res) => setTimeout(res, ms));

test('a customer-app request records last seen, version, build, platform and first seen; a second one within 10 min writes nothing', async () => {
  const u = await H.mkUser();
  const before0 = await row(u.id);
  assert.equal(before0.lastSeenAt, null);

  const r1 = await api('GET', '/api/users/profile', u.token, undefined, CUSTOMER());
  assert.equal(r1.status, 200);
  const a = await settle(u.id, (x) => x.lastSeenAt);
  assert.ok(a.lastSeenAt, 'lastSeenAt written');
  assert.ok(a.firstSeenAt, 'firstSeenAt written');
  assert.equal(new Date(a.firstSeenAt).getTime(), new Date(a.lastSeenAt).getTime());
  assert.equal(a.lastAppVersion, '1.0.65');
  assert.equal(a.lastAppBuild, '66');
  assert.equal(a.lastPlatform, 'android');
  // updatedAt is not touched by a presence write.
  assert.equal(new Date(a.updatedAt).getTime(), new Date(before0.updatedAt).getTime());
  // Never in the customer's own profile payload.
  for (const k of ['lastSeenAt', 'firstSeenAt', 'lastAppVersion', 'lastAppBuild', 'lastPlatform']) assert.equal(k in r1.body, false, k);

  await pause(30);
  const r2 = await api('GET', '/api/users/profile', u.token, undefined, CUSTOMER());
  assert.equal(r2.status, 200);
  await pause(150);
  const b = await row(u.id);
  assert.equal(new Date(b.lastSeenAt).getTime(), new Date(a.lastSeenAt).getTime(), 'second call within 10 min: no write');
});

test('throttle: the in-memory map skips a second call, and the conditional UPDATE refuses a write within 10 minutes', async () => {
  const u = await H.mkUser();
  const req = { user: { id: u.id, role: 'student' }, headers: CUSTOMER() };
  const p1 = presence.noteSeen(req);
  assert.ok(p1 && typeof p1.then === 'function');
  assert.equal(await p1, 1);
  assert.equal(presence.noteSeen(req), null, 'same instance, within 10 min: skipped before any database work');

  // Another instance (empty map) within 10 min: the WHERE clause refuses it.
  presence._reset();
  assert.equal(await presence.noteSeen(req), 0);

  // 11 minutes later: written again; firstSeenAt keeps the first value.
  const first = (await row(u.id)).firstSeenAt;
  const later = new Date(Date.now() + 11 * 60 * 1000);
  assert.equal(await presence.write(String(u.id), { version: '1.0.65', build: '66', platform: 'android', now: later }), 1);
  const r = await row(u.id);
  assert.equal(new Date(r.lastSeenAt).getTime(), later.getTime());
  assert.equal(new Date(r.firstSeenAt).getTime(), new Date(first).getTime());
});

test('a new app version is written at once, even inside the 10-minute window', async () => {
  const u = await H.mkUser();
  const req = (v, b) => ({ user: { id: u.id, role: 'student' }, headers: CUSTOMER(v, b) });
  assert.equal(await presence.noteSeen(req('1.0.64', '65')), 1);
  assert.equal(await presence.noteSeen(req('1.0.65', '66')), 1);
  const r = await row(u.id);
  assert.equal(r.lastAppVersion, '1.0.65');
  assert.equal(r.lastAppBuild, '66');
});

test('partner apps, no X-App-Name, store / rider tokens and load-test traffic are never recorded', async () => {
  const u = await H.mkUser();
  for (const name of ['rider', 'restaurant', 'vendor', 'autodriver', 'pgowner', 'campusstall', 'something-else']) {
    const r = await api('GET', '/api/users/profile', u.token, undefined, { 'x-app-name': name, 'x-app-version': '1.0.65' });
    assert.equal(r.status, 200);
  }
  const r = await api('GET', '/api/users/profile', u.token);
  assert.equal(r.status, 200);
  await pause(150);
  assert.equal((await row(u.id)).lastSeenAt, null);

  // Direct: a rider / store session with a customer header is not a User row.
  assert.equal(presence.noteSeen({ user: { id: 'x', role: 'rider' }, headers: CUSTOMER() }), null);
  assert.equal(presence.noteSeen({ user: { id: 'x', role: 'restaurant' }, headers: CUSTOMER() }), null);
  assert.equal(presence.noteSeen({ headers: CUSTOMER() }), null);

  // Load test: skipped only with the right key.
  const prev = process.env.LOADTEST_KEY;
  process.env.LOADTEST_KEY = 'presence-loadtest-key';
  try {
    const lt = await api('GET', '/api/users/profile', u.token, undefined, { ...CUSTOMER(), 'x-loadtest-key': 'presence-loadtest-key' });
    assert.equal(lt.status, 200);
    await pause(150);
    assert.equal((await row(u.id)).lastSeenAt, null);
  } finally {
    if (prev === undefined) delete process.env.LOADTEST_KEY; else process.env.LOADTEST_KEY = prev;
  }
});

test('platform header, and junk header values are cleaned', async () => {
  const u = await H.mkUser();
  const req = { user: { id: u.id, role: 'student' }, headers: { 'x-app-name': 'customer', 'x-app-version': '1.0.65<script>', 'x-app-build': '66abc', 'x-app-platform': 'iOS' } };
  assert.equal(await presence.noteSeen(req), 1);
  const r = await row(u.id);
  assert.equal(r.lastAppVersion, null);
  assert.equal(r.lastAppBuild, null);
  assert.equal(r.lastPlatform, 'ios');
  assert.ok(r.lastSeenAt);
});

test('a failing write never breaks the request', async () => {
  const u = await H.mkUser();
  const User = H.ctx.M('User');
  const orig = User.update;
  let calls = 0;
  User.update = async function (...args) {
    if (args[0] && 'lastSeenAt' in args[0]) { calls++; throw new Error('database is down'); }
    return orig.apply(this, args);
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await api('GET', '/api/users/profile', u.token, undefined, CUSTOMER());
    assert.equal(r.status, 200);
    assert.equal(r.body.name, u.name);
    await pause(100);
    assert.equal(calls, 1);
    presence._reset();
    assert.equal(await presence.noteSeen({ user: { id: u.id, role: 'student' }, headers: CUSTOMER() }), 0, 'the background promise resolves, never rejects');
    // Even a synchronous throw inside noteSeen is swallowed.
    assert.equal(presence.noteSeen({ get user() { throw new Error('boom'); } }), null);
  } finally {
    User.update = orig;
    console.warn = warn;
  }
});
