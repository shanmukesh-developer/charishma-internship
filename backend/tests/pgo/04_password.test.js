// Plan B accounts: the admin creates the owner with a temporary password; the owner must set an own password
// before anything else works. Password change / admin reset / suspension sign old sessions out. Every admin
// write is audited.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let pg;

test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  pg = await H.mkPg(admin);
  await H.mkRoom(admin, pg.id);
});
test.after(H.teardown);

test('admin create: validation, duplicate phone, audit', async () => {
  const weak = await H.api('POST', '/api/admin/pg-owners', admin.token, { name: 'Weak Owner', phone: H.phone(), password: 'short' });
  assert.strictEqual(weak.status, 400);
  assert.strictEqual(weak.body.code, 'WEAK_PASSWORD');
  const badPhone = await H.api('POST', '/api/admin/pg-owners', admin.token, { name: 'Bad Phone', phone: '12345', password: H.TEMP_PASSWORD });
  assert.strictEqual(badPhone.status, 400);
  const { owner, phone } = await H.adminCreateOwner(admin, [pg.id]);
  assert.strictEqual(owner.mustChangePassword, true);
  assert.deepStrictEqual(owner.listings.map((l) => l.id), [pg.id]);
  const dup = await H.api('POST', '/api/admin/pg-owners', admin.token, { name: 'Again', phone, password: H.TEMP_PASSWORD });
  assert.strictEqual(dup.status, 409);
  const rows = await H.auditRows('PG_OWNER_CREATED');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].adminId, admin.id);
  assert.ok(!JSON.stringify(rows[0]).includes(H.TEMP_PASSWORD), 'never audit the password');
  const stored = await H.ctx.M('PgOwner').findByPk(owner.id);
  assert.notStrictEqual(stored.password, H.TEMP_PASSWORD, 'stored hashed');
  // Non-admins cannot create owners.
  const student = await H.mkUser();
  const denied = await H.api('POST', '/api/admin/pg-owners', student.token, { name: 'X Y', phone: H.phone(), password: H.TEMP_PASSWORD });
  assert.ok(denied.status === 401 || denied.status === 403, String(denied.status));
});

test('the temporary password must be changed before the app works', async () => {
  const { owner, phone } = await H.adminCreateOwner(admin);
  const login = await H.api('POST', '/api/pg-owner/auth/login', null, { phone, password: H.TEMP_PASSWORD });
  assert.strictEqual(login.status, 200, JSON.stringify(login.body));
  assert.strictEqual(login.body.owner.mustChangePassword, true);
  const t = login.body.token;
  for (const url of ['/api/pg-owner/home', '/api/pg-owner/bookings', '/api/pg-owner/tenants', '/api/pg-owner/rent', '/api/pg-owner/complaints']) {
    const r = await H.api('GET', url, t);
    assert.strictEqual(r.status, 403, `${url}: ${r.status}`);
    assert.strictEqual(r.body.code, 'PASSWORD_CHANGE_REQUIRED');
  }
  // Still allowed: profile, refresh, the password change itself.
  assert.strictEqual((await H.api('GET', '/api/pg-owner/me', t)).status, 200);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/auth/refresh', t)).status, 200);

  const same = await H.api('POST', '/api/pg-owner/auth/password', t, { currentPassword: H.TEMP_PASSWORD, newPassword: H.TEMP_PASSWORD });
  assert.strictEqual(same.status, 400);
  assert.strictEqual(same.body.code, 'SAME_PASSWORD');
  const wrong = await H.api('POST', '/api/pg-owner/auth/password', t, { currentPassword: 'nope12345', newPassword: H.OWN_PASSWORD });
  assert.strictEqual(wrong.status, 401);
  const weak = await H.api('POST', '/api/pg-owner/auth/password', t, { currentPassword: H.TEMP_PASSWORD, newPassword: 'abcdefgh' });
  assert.strictEqual(weak.status, 400);

  const ok = await H.api('POST', '/api/pg-owner/auth/password', t, { currentPassword: H.TEMP_PASSWORD, newPassword: H.OWN_PASSWORD });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.owner.mustChangePassword, false);
  // The old session is revoked; the new token works.
  const old = await H.api('GET', '/api/pg-owner/me', t);
  assert.strictEqual(old.status, 401);
  assert.strictEqual(old.body.code, 'SESSION_REVOKED');
  assert.strictEqual((await H.api('GET', '/api/pg-owner/home', ok.body.token)).status, 200);
  // The temporary password no longer signs in.
  assert.strictEqual((await H.api('POST', '/api/pg-owner/auth/login', null, { phone, password: H.TEMP_PASSWORD })).status, 401);
  const relogin = await H.api('POST', '/api/pg-owner/auth/login', null, { phone, password: H.OWN_PASSWORD });
  assert.strictEqual(relogin.status, 200);
  assert.strictEqual(relogin.body.owner.mustChangePassword, false);
  assert.ok((await H.ctx.M('PgOwner').findByPk(owner.id)).passwordChangedAt);
});

test('admin reset sets a new temporary password and signs every phone out', async () => {
  const o = await H.readyOwner(admin);
  const reset = await H.api('POST', `/api/admin/pg-owners/${o.id}/reset-password`, admin.token, { password: 'Reset5678pw' });
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
  assert.strictEqual((await H.api('GET', '/api/pg-owner/home', o.token)).status, 401);
  const login = await H.api('POST', '/api/pg-owner/auth/login', null, { phone: o.phone, password: 'Reset5678pw' });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.owner.mustChangePassword, true);
  assert.strictEqual((await H.api('GET', '/api/pg-owner/home', login.body.token)).body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.strictEqual((await H.auditRows('PG_OWNER_PASSWORD_RESET')).length, 1);
});

test('suspend blocks sign-in and live sessions; unsuspend restores sign-in', async () => {
  const o = await H.readyOwner(admin);
  const noReason = await H.api('POST', `/api/admin/pg-owners/${o.id}/suspend`, admin.token, {});
  assert.strictEqual(noReason.status, 400);
  const s = await H.api('POST', `/api/admin/pg-owners/${o.id}/suspend`, admin.token, { reason: 'Listing under review' });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  assert.strictEqual((await H.api('GET', '/api/pg-owner/home', o.token)).status, 401, 'old session revoked');
  const login = await H.api('POST', '/api/pg-owner/auth/login', null, { phone: o.phone, password: H.OWN_PASSWORD });
  assert.strictEqual(login.status, 403);
  assert.strictEqual(login.body.code, 'PG_OWNER_SUSPENDED');
  assert.match(login.body.message, /Listing under review/);
  const u = await H.api('POST', `/api/admin/pg-owners/${o.id}/unsuspend`, admin.token, {});
  assert.strictEqual(u.status, 200);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/auth/login', null, { phone: o.phone, password: H.OWN_PASSWORD })).status, 200);
  assert.strictEqual((await H.auditRows('PG_OWNER_SUSPENDED')).length, 1);
  assert.strictEqual((await H.auditRows('PG_OWNER_REACTIVATED')).length, 1);
});

test('admin list masks phones; detail shows the full number', async () => {
  const o = await H.readyOwner(admin);
  const list = await H.api('GET', '/api/admin/pg-owners', admin.token);
  assert.strictEqual(list.status, 200);
  const row = list.body.owners.find((x) => x.id === o.id);
  assert.ok(row && !row.phone.includes(o.phone.slice(0, 6)), JSON.stringify(row));
  const d = await H.api('GET', `/api/admin/pg-owners/${o.id}`, admin.token);
  assert.strictEqual(d.body.owner.phone, o.phone);
});

test('deletion request needs the password and is shown to admins', async () => {
  const o = await H.readyOwner(admin);
  const wrong = await H.api('POST', '/api/pg-owner/account/deletion-request', o.token, { password: 'nope' });
  assert.strictEqual(wrong.status, 401);
  const ok = await H.api('POST', '/api/pg-owner/account/deletion-request', o.token, { password: H.OWN_PASSWORD, reason: 'Sold the PG' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.owner.deletionRequestedAt);
  const list = await H.api('GET', '/api/admin/pg-owners?status=DELETION', admin.token);
  assert.ok(list.body.owners.some((x) => x.id === o.id && x.deletionReason === 'Sold the PG'));
});

// 1 Nov 2026: a handed-over phone. The second owner's device token is taken off the first owner, so the first owner's
// pushes (new bookings, complaints) stop ringing on that phone. The first owner's other phones keep theirs.
test('device token: a second owner signing in on the same phone takes it off the first owner', async () => {
  const a = await H.readyOwner(admin, []);
  const b = await H.readyOwner(admin, []);
  const shared = `fcm-shared-owner-phone-${'x'.repeat(40)}`;
  const own = `fcm-own-phone-of-owner-a-${'y'.repeat(40)}`;
  for (const t of [own, shared]) assert.strictEqual((await H.api('POST', '/api/pg-owner/fcm-token', a.token, { token: t })).status, 200);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/fcm-token', b.token, { token: shared })).status, 200);
  const O = H.r('modules/pgOwner/index').getModel('PgOwner');
  const ra = await O.findByPk(a.id);
  const rb = await O.findByPk(b.id);
  assert.deepStrictEqual(ra.fcmTokens, [own], 'first owner keeps only their own phone');
  assert.ok(rb.fcmTokens.includes(shared), 'second owner has the shared phone');
});
