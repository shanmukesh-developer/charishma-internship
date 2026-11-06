// Active testers admin API (routes/activeUsersRoutes, utils/activeUsers): filters (today in IST / last 7 days /
// not seen 2+ days / never), summary counts, version breakdown with "older than latest", search, sort, order counts
// without owner test orders, admins and deleted accounts left out, non-admins refused; the closed-tester phone list:
// validation, save, audit row, per-tester status, and the generic Config endpoint refusing the key.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URLSearchParams } = require('url');
const H = require('../c6/helpers');

const { api } = H;
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

const HOUR = 60 * 60 * 1000;
const list = (q = {}) => api('GET', `/api/admin/active-users?${new URLSearchParams(q)}`, admin.token);
const seen = (u, msAgo, version = '1.0.65', build = '66') => H.ctx.M('User').update(
  { lastSeenAt: new Date(Date.now() - msAgo), firstSeenAt: new Date(Date.now() - msAgo - HOUR), lastAppVersion: version, lastAppBuild: build, lastPlatform: 'android' },
  { where: { id: u.id }, silent: true },
);
const istMidnightAgo = () => {
  const off = 330 * 60 * 1000;
  const ist = new Date(Date.now() + off);
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - off;
  return Date.now() - start;
};

test('non-admins are refused', async () => {
  const u = await H.mkUser();
  for (const [m, url] of [['GET', '/api/admin/active-users'], ['GET', '/api/admin/active-users/testers'], ['PUT', '/api/admin/active-users/testers']]) {
    assert.equal((await api(m, url, u.token, m === 'PUT' ? { phones: '9876543210' } : undefined)).status, 403, url);
    assert.equal((await api(m, url, null)).status, 401, url);
  }
});

test('filters, summary counts, versions, search, sort and order counts', async () => {
  const base = (await list()).body;
  assert.equal(base.summary.signedUp, base.summary.neverSeen + base.summary.seenEver);

  const sinceMidnight = istMidnightAgo();
  const todayAgo = Math.min(5 * 60 * 1000, Math.max(1000, sinceMidnight - 1000));
  const today = await H.mkUser({ name: 'Presence Today' });
  const week = await H.mkUser({ name: 'Presence ThreeDays' });
  const old = await H.mkUser({ name: 'Presence Old' });
  const never = await H.mkUser({ name: 'Presence Never' });
  const deleted = await H.mkUser({ name: 'Presence Deleted', role: 'deleted' });
  await seen(today, todayAgo, '1.0.65', '66');
  await seen(week, 3 * 24 * HOUR, '1.0.64', '65');
  await seen(old, 10 * 24 * HOUR, '1.0.60', '61');
  await seen(deleted, 1000, '1.0.65', '66');
  await seen(admin, 1000, '1.0.65', '66');

  // Orders: two real + one owner test order for `today`.
  const { store } = await H.mkStore();
  const mk = (extra) => H.ctx.M('Order').create({ userId: today.id, restaurantId: store.id, items: [], totalPrice: 100, deliveryFee: 19, platformFee: 4, finalPrice: 123, paymentMethod: 'COD', status: 'Delivered', ...extra });
  await mk({});
  await mk({});
  await mk({ isTestData: true });

  const all = await list();
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const s = all.body.summary;
  assert.equal(s.signedUp - base.summary.signedUp, 4, 'admins and deleted accounts are not counted');
  assert.equal(s.seenToday - base.summary.seenToday, 1);
  assert.equal(s.seenWeek - base.summary.seenWeek, 2);
  assert.equal(s.inactive2d - base.summary.inactive2d, 2);
  assert.equal(s.neverSeen - base.summary.neverSeen, 1);
  assert.equal(all.body.trackingStartedAt !== null, true);

  // Versions: newest first; latest = highest seen (no policy set); older ones flagged.
  const v = all.body.versions;
  assert.deepEqual(v.map((x) => x.version).slice(0, 3), ['1.0.65', '1.0.64', '1.0.60']);
  assert.equal(all.body.latestVersion, '1.0.65');
  assert.equal(all.body.latestVersionSource, 'seen');
  assert.equal(v[0].isLatest, true);
  assert.equal(v[0].olderThanLatest, false);
  assert.equal(v[1].olderThanLatest, true);
  assert.equal(v.find((x) => x.version === '1.0.65').count, 1, 'deleted + admin rows not counted');

  const ids = (r) => r.body.users.map((u) => u.id);
  const t = await list({ filter: 'today' });
  assert.ok(ids(t).includes(String(today.id)));
  assert.ok(!ids(t).includes(String(week.id)));
  const w = await list({ filter: 'week' });
  assert.ok(ids(w).includes(String(today.id)) && ids(w).includes(String(week.id)) && !ids(w).includes(String(old.id)));
  const i = await list({ filter: 'inactive2d' });
  assert.ok(ids(i).includes(String(week.id)) && ids(i).includes(String(old.id)) && !ids(i).includes(String(today.id)) && !ids(i).includes(String(never.id)));
  const n = await list({ filter: 'never' });
  assert.ok(ids(n).includes(String(never.id)) && !ids(n).includes(String(today.id)));
  assert.ok(!ids(await list()).includes(String(deleted.id)) && !ids(await list()).includes(String(admin.id)));

  // Row shape: full phone (as on Customers), dates, version flags, orders without the test order.
  const rowToday = all.body.users.find((u) => u.id === String(today.id));
  assert.equal(rowToday.phone, today.phone);
  assert.equal(rowToday.orders, 2);
  assert.equal(rowToday.lastAppVersion, '1.0.65');
  assert.equal(rowToday.lastAppBuild, '66');
  assert.equal(rowToday.olderThanLatest, false);
  assert.ok(rowToday.createdAt && rowToday.firstSeenAt && rowToday.lastSeenAt);
  assert.equal('password' in rowToday, false);
  assert.equal(all.body.users.find((u) => u.id === String(week.id)).olderThanLatest, true);

  // Default sort: last opened, newest first, never-seen last.
  const order = ids(all).filter((x) => [today, week, old, never].map((u) => String(u.id)).includes(x));
  assert.deepEqual(order, [today, week, old, never].map((u) => String(u.id)));
  const asc = ids(await list({ sort: 'lastSeen_asc' })).filter((x) => [today, week, old].map((u) => String(u.id)).includes(x));
  assert.deepEqual(asc, [old, week, today].map((u) => String(u.id)));

  // Search by name and by the last digits of the phone.
  const byName = await list({ search: 'ThreeDays' });
  assert.deepEqual(ids(byName), [String(week.id)]);
  const byPhone = await list({ search: old.phone.slice(-6) });
  assert.ok(ids(byPhone).includes(String(old.id)));
  // Junk filter falls back to all.
  assert.equal((await list({ filter: 'bogus' })).body.filter, 'all');
});

test('latest version comes from Config > App versions when it is set', async () => {
  await H.ctx.M('GlobalConfig').upsert({ key: 'APP_VERSION_POLICY', value: { apps: { customer: { latestVersion: '1.0.66' } } } });
  H.r('utils/appVersionPolicy').clearCache();
  const r = await list();
  assert.equal(r.body.latestVersion, '1.0.66');
  assert.equal(r.body.latestVersionSource, 'policy');
  assert.equal(r.body.versions.find((x) => x.version === '1.0.65').olderThanLatest, true);
  await H.ctx.M('GlobalConfig').destroy({ where: { key: 'APP_VERSION_POLICY' } });
  H.r('utils/appVersionPolicy').clearCache();
});

test('closed-tester list: validation, save, audit, per-tester status, generic config refused', async () => {
  const tester = await H.mkUser({ name: 'Presence Tester' });
  await seen(tester, 1000, '1.0.65', '66');
  const quiet = await H.mkUser({ name: 'Presence Quiet' });
  const empty = await api('GET', '/api/admin/active-users/testers', admin.token);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.testers, []);

  const bad = await api('PUT', '/api/admin/active-users/testers', admin.token, { phones: `${tester.phone}\n12345\nabcdefghij` });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_TESTER_PHONES');
  assert.deepEqual(bad.body.invalid, ['12345', 'abcdefghij']);
  assert.equal((await api('PUT', '/api/admin/active-users/testers', admin.token, { phones: { a: 1 } })).status, 400);
  assert.equal(await H.ctx.M('GlobalConfig').count({ where: { key: 'CLOSED_TESTER_PHONES' } }), 0, 'nothing saved on a bad list');

  const missing = '9000000001';
  const text = `+91 ${tester.phone.slice(0, 5)} ${tester.phone.slice(5)}, ${quiet.phone}\n0${missing}\n${tester.phone}`;
  const ok = await api('PUT', '/api/admin/active-users/testers', admin.token, { phones: text });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.changed, true);
  assert.deepEqual(ok.body.phones, [tester.phone, quiet.phone, missing]);
  const st = Object.fromEntries(ok.body.testers.map((x) => [x.phone, x]));
  assert.equal(st[missing].status, 'not_signed_up');
  assert.equal(st[missing].user, null);
  assert.equal(st[quiet.phone].status, 'never_opened');
  assert.equal(st[tester.phone].status, 'today');
  assert.equal(st[tester.phone].user.lastAppVersion, '1.0.65');
  assert.deepEqual(
    { total: ok.body.counts.total, signedUp: ok.body.counts.signedUp, notSignedUp: ok.body.counts.notSignedUp, neverOpened: ok.body.counts.neverOpened, openedToday: ok.body.counts.openedToday },
    { total: 3, signedUp: 2, notSignedUp: 1, neverOpened: 1, openedToday: 1 },
  );

  // Audited, phones masked to the last 4 digits.
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'CLOSED_TESTERS_UPDATED' }, raw: true });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].adminId, String(admin.id));
  const d = JSON.parse(logs[0].details);
  assert.equal(d.count, 3);
  assert.equal(d.added.length, 3);
  assert.ok(d.added.every((p) => /^\*{6}\d{4}$/.test(p)));
  assert.equal(logs[0].details.includes(tester.phone), false);

  // Same list again: no change, no new audit row.
  const same = await api('PUT', '/api/admin/active-users/testers', admin.token, { phones: [tester.phone, quiet.phone, missing] });
  assert.equal(same.body.changed, false);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'CLOSED_TESTERS_UPDATED' } }), 1);

  // Stale ifUpdatedAt: 409.
  const stale = await api('PUT', '/api/admin/active-users/testers', admin.token, { phones: missing, ifUpdatedAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(stale.status, 409);

  // Remove one: audited with the removed numbers.
  const fewer = await api('PUT', '/api/admin/active-users/testers', admin.token, { phones: [tester.phone, quiet.phone], ifUpdatedAt: same.body.updatedAt });
  assert.equal(fewer.status, 200, JSON.stringify(fewer.body));
  assert.equal(fewer.body.removed, 1);
  assert.equal((await api('GET', '/api/admin/active-users/testers', admin.token)).body.testers.length, 2);

  // The generic Config endpoint cannot write the list.
  const generic = await api('POST', '/api/admin/config', admin.token, { key: 'CLOSED_TESTER_PHONES', value: { phones: ['9999999999'] } });
  assert.equal(generic.status, 400);
});
