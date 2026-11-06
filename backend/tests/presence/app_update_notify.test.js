// "ZenWe update available" push (utils/appUpdateNotify, routes/appUpdateRoutes): admin-only; the target version is
// Config > App versions latest (or a given x.y.z); only customers whose recorded app version is older get it (not
// the same / newer / unknown version, not admins / deleted / deactivated); push text + data; idempotent per version
// (409 ALREADY_SENT, resend only with confirmResend: true); every send audited; preview counts. Mocked FCM.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('../c6/helpers');

const { api } = H;
const push = require(path.join(__dirname, '..', '..', 'utils', 'push.js'));
let admin;
const tok = (tag) => `${tag}:APA91b${'z'.repeat(120)}`;

before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  // The helper's push stub counts nothing as sent: count every device as delivered here.
  push.sendPushToTokens = async (tokens, title, body, data, opts) => {
    H.ctx.pushes.push({ tokens, title, body, data, opts });
    return { successCount: tokens.length, failureCount: 0, staleTokens: [] };
  };
});
after(H.teardown);

const onVersion = (u, version, tokens) => H.ctx.M('User').update(
  { lastAppVersion: version, lastSeenAt: new Date(), fcmTokens: tokens },
  { where: { id: u.id }, silent: true },
);
const audits = () => H.ctx.M('VerificationLog').findAll({ where: { action: 'APP_UPDATE_PUSH_SENT' }, order: [['timestamp', 'ASC']] });
const setLatest = (v) => api('PUT', '/api/admin/app-versions', admin.token, { apps: { customer: { latestVersion: v } } });

test('admin only', async () => {
  const u = await H.mkUser();
  for (const [m, url] of [['GET', '/api/admin/app-update/notify'], ['POST', '/api/admin/app-update/notify']]) {
    assert.equal((await api(m, url, u.token, m === 'POST' ? {} : undefined)).status, 403, url);
    assert.equal((await api(m, url, null, m === 'POST' ? {} : undefined)).status, 401, url);
  }
  assert.equal(H.ctx.pushes.length, 0);
});

test('no latest version configured and none given: 400, nothing sent', async () => {
  const r = await api('POST', '/api/admin/app-update/notify', admin.token, {});
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'NO_LATEST_VERSION');
  const bad = await api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: '1.0' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_VERSION');
  assert.equal((await api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: 5 })).status, 400);
  assert.equal((await api('POST', '/api/admin/app-update/notify', admin.token, { confirmResend: 'yes', minVersion: '1.0.9' })).status, 400);
  assert.equal(H.ctx.pushes.length, 0);
  assert.equal((await audits()).length, 0);
});

test('targets only customers on an older version; idempotent per version; audited', async () => {
  const s = await setLatest('1.0.68');
  assert.equal(s.status, 200, JSON.stringify(s.body));

  const old1 = await H.mkUser({ name: 'Old one' });
  const old2 = await H.mkUser({ name: 'Old two' });
  const oldNoDevice = await H.mkUser({ name: 'Old no device' });
  const same = await H.mkUser({ name: 'Same' });
  const newer = await H.mkUser({ name: 'Newer' });
  const unknown = await H.mkUser({ name: 'Never opened' });
  const deleted = await H.mkUser({ name: 'Deleted', role: 'deleted' });
  const inactive = await H.mkUser({ name: 'Inactive', isActive: false });
  await onVersion(old1, '1.0.66', [tok('old1a'), tok('old1b')]);
  await onVersion(old2, '1.0.9', [tok('old2')]); // 1.0.9 < 1.0.68 numerically
  await onVersion(oldNoDevice, '1.0.60', []);
  await onVersion(same, '1.0.68', [tok('same')]);
  await onVersion(newer, '1.0.70', [tok('newer')]);
  await H.ctx.M('User').update({ fcmTokens: [tok('unknown')] }, { where: { id: unknown.id } });
  await onVersion(deleted, '1.0.50', [tok('deleted')]);
  await onVersion(inactive, '1.0.50', [tok('inactive')]);
  await onVersion(admin, '1.0.50', [tok('admin')]);

  const p = await api('GET', '/api/admin/app-update/notify', admin.token);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.version, '1.0.68');
  assert.equal(p.body.versionSource, 'policy');
  assert.equal(p.body.behind, 3);
  assert.equal(p.body.withDevice, 2);
  assert.equal(p.body.lastSent, null);
  assert.deepEqual(p.body.versions.map((v) => v.version), ['1.0.66', '1.0.60', '1.0.9']);

  const r = await api('POST', '/api/admin/app-update/notify', admin.token, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.version, '1.0.68');
  assert.equal(r.body.targeted, 3);
  assert.equal(r.body.withDevice, 2);
  assert.equal(r.body.devices, 3);
  assert.equal(r.body.sent, 3);
  assert.equal(r.body.resend, false);

  assert.equal(H.ctx.pushes.length, 1);
  const sent = H.ctx.pushes[0];
  assert.deepEqual([...sent.tokens].sort(), [tok('old1a'), tok('old1b'), tok('old2')].sort());
  assert.equal(sent.title, 'ZenWe update available');
  assert.equal(sent.body, 'Version 1.0.68 is ready. Open ZenWe to update in the app.');
  assert.deepEqual(sent.data, { type: 'APP_UPDATE', version: '1.0.68' });
  assert.deepEqual(sent.opts.recipients.map(String).sort(), [String(old1.id), String(old2.id)].sort());

  let a = await audits();
  assert.equal(a.length, 1);
  assert.equal(a[0].targetId, 'customer@1.0.68');
  assert.equal(a[0].adminId, String(admin.id));
  assert.equal(JSON.parse(a[0].details).sent, 3);

  // Same version again: refused without confirmation, nothing sent, no new audit row.
  const again = await api('POST', '/api/admin/app-update/notify', admin.token, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_SENT');
  assert.ok(again.body.lastSent && again.body.lastSent.sentAt);
  assert.equal(H.ctx.pushes.length, 1);
  assert.equal((await audits()).length, 1);

  // Preview now shows the last send.
  const p2 = await api('GET', '/api/admin/app-update/notify', admin.token);
  assert.equal(p2.body.lastSent.sent, 3);

  // Explicit confirmation: sent again and audited as a resend.
  const re = await api('POST', '/api/admin/app-update/notify', admin.token, { confirmResend: true });
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.equal(re.body.resend, true);
  assert.equal(H.ctx.pushes.length, 2);
  a = await audits();
  assert.equal(a.length, 2);
  assert.equal(JSON.parse(a[1].details).resend, true);

  // A given version overrides the configured latest: only versions older than 1.0.61 (1.0.60 has no device, 1.0.9 has one).
  const given = await api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: '1.0.61' });
  assert.equal(given.status, 200, JSON.stringify(given.body));
  assert.equal(given.body.version, '1.0.61');
  assert.equal(given.body.versionSource, 'given');
  assert.equal(given.body.targeted, 2);
  assert.equal(given.body.devices, 1);
  assert.deepEqual(H.ctx.pushes[2].tokens, [tok('old2')]);
  assert.equal((await audits()).length, 3);
});

test('two clicks at once send once', async () => {
  const [x, y] = await Promise.all([
    api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: '1.0.67' }),
    api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: '1.0.67' }),
  ]);
  const codes = [x.status, y.status].sort();
  assert.deepEqual(codes, [200, 409], JSON.stringify([x.body, y.body]));
  assert.equal((await H.ctx.M('VerificationLog').count({ where: { action: 'APP_UPDATE_PUSH_SENT', targetId: 'customer@1.0.67' } })), 1);
});

test('nobody behind: still recorded (so a second send needs confirmation), nothing pushed', async () => {
  const before = H.ctx.pushes.length;
  const r = await api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: '0.0.1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.targeted, 0);
  assert.equal(r.body.sent, 0);
  assert.equal(H.ctx.pushes.length, before);
  assert.equal((await api('POST', '/api/admin/app-update/notify', admin.token, { minVersion: '0.0.1' })).status, 409);
});
