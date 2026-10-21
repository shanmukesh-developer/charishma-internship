// Silent session refresh (polish hunt C-H3 / R-H1, 21 Oct): customers and riders were signed out on day 30.
//  • POST /api/users/refresh (alias /refresh-token): sliding 30-day customer session; refuses suspended /
//    deleted accounts, tokens from before a password change (tokenVersion), admin sessions and other
//    account types; re-reads the DB row (a stale 60 s auth-cache entry cannot extend a revoked session).
//  • POST /api/delivery/refresh (alias /refresh-token): same for riders; deactivated (suspendedAt) and
//    deleted (accountDeletedAt) riders are refused, riders waiting for approval may refresh.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

const jwt = require(path.join(H.B, 'node_modules/jsonwebtoken'));
const DAY = 24 * 60 * 60;

test.before(() => H.setup());
test.after(() => H.teardown());

const refresh = (token) => H.api('POST', '/api/users/refresh', token);
const riderRefresh = (token) => H.api('POST', '/api/delivery/refresh', token);
const sign = (claims, expiresIn) => jwt.sign(claims, process.env.JWT_SECRET, expiresIn ? { expiresIn } : undefined);

test('customer: a near-expiry session is extended to 30 days; the new token works', async () => {
  const u = await H.mkUser();
  const old = sign({ id: u.id, role: 'student', tv: 0 }, '2d');
  const r = await refresh(old);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.strictEqual(r.body.expiresIn, 30 * DAY);
  assert.ok(Date.parse(r.body.expiresAt) > Date.now() + 29 * DAY * 1000);
  const d = jwt.verify(r.body.token, process.env.JWT_SECRET);
  assert.strictEqual(d.id, u.id);
  assert.strictEqual(d.role, 'student');
  assert.strictEqual(d.tv, 0);
  assert.ok(d.exp - Math.floor(Date.now() / 1000) > 29 * DAY);
  assert.ok(d.exp > jwt.decode(old).exp);
  const p = await H.api('GET', '/api/users/profile', r.body.token);
  assert.strictEqual(p.status, 200);
  // the alias path does the same
  const a = await H.api('POST', '/api/users/refresh-token', r.body.token);
  assert.strictEqual(a.status, 200);
});

test('customer: no token / expired token / garbage are 401', async () => {
  const u = await H.mkUser();
  assert.strictEqual((await refresh(null)).status, 401);
  const expired = sign({ id: u.id, role: 'student', tv: 0, exp: Math.floor(Date.now() / 1000) - 60 });
  assert.strictEqual((await refresh(expired)).status, 401);
  assert.strictEqual((await refresh('not-a-token')).status, 401);
  assert.strictEqual((await refresh(jwt.sign({ id: u.id, role: 'student', tv: 0 }, 'wrong-secret'))).status, 401);
});

test('customer: suspended account is refused', async () => {
  const u = await H.mkUser();
  await u.update({ isActive: false });
  H.clearAuthCache(u.id);
  const r = await refresh(u.token);
  assert.strictEqual(r.status, 403);
  assert.ok(!r.body.token);
});

test('customer: deleted account (anonymised: isActive false + tokenVersion bump) is refused', async () => {
  const u = await H.mkUser();
  await u.update({ isActive: false, tokenVersion: 1 });
  H.clearAuthCache(u.id);
  const r = await refresh(u.token);
  assert.ok([401, 403].includes(r.status), String(r.status));
  assert.ok(!r.body.token);
  const gone = await H.mkUser();
  await gone.destroy();
  H.clearAuthCache(gone.id);
  assert.strictEqual((await refresh(gone.token)).status, 401);
});

test('customer: a token from before a password change cannot be refreshed, even with a stale auth cache', async () => {
  const u = await H.mkUser();
  // warm the 60 s auth cache with tokenVersion 0
  assert.strictEqual((await H.api('GET', '/api/users/profile', u.token)).status, 200);
  u.password = 'N3w-passw0rd-s1';
  await u.save();
  await u.reload();
  assert.strictEqual(Number(u.tokenVersion), 1);
  // no cache clear on purpose: the controller re-reads the row
  const r = await refresh(u.token);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'SESSION_REVOKED');
  H.clearAuthCache(u.id);
  const fresh = sign({ id: u.id, role: 'student', tv: 1 }, '1d');
  const ok = await refresh(fresh);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(jwt.decode(ok.body.token).tv, 1);
});

test('customer route refuses admin, rider and store sessions', async () => {
  const a = await H.mkUser({ role: 'admin' });
  const ra = await refresh(a.token);
  assert.strictEqual(ra.status, 403);
  assert.strictEqual(ra.body.code, 'ADMIN_REFRESH_NOT_ALLOWED');
  const d = await H.mkRider();
  const rd = await refresh(d.token);
  assert.strictEqual(rd.status, 403);
  assert.strictEqual(rd.body.code, 'WRONG_ACCOUNT_TYPE');
  const s = await H.mkStore();
  const rs = await refresh(s.token);
  assert.strictEqual(rs.status, 403);
  assert.ok(!rs.body.token);
});

test('rider: session is extended to 30 days; the new token works', async () => {
  const d = await H.mkRider();
  const old = sign({ id: d.id, role: 'rider', tv: 0 }, '3d');
  const r = await riderRefresh(old);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const dec = jwt.verify(r.body.token, process.env.JWT_SECRET);
  assert.strictEqual(dec.id, d.id);
  assert.strictEqual(dec.role, 'rider');
  assert.ok(dec.exp - Math.floor(Date.now() / 1000) > 29 * DAY);
  assert.strictEqual((await H.api('GET', '/api/delivery/profile', r.body.token)).status, 200);
  assert.strictEqual((await H.api('POST', '/api/delivery/refresh-token', r.body.token)).status, 200);
});

test('rider: waiting for approval may refresh; deactivated and deleted riders may not', async () => {
  const pending = await H.ctx.M.DeliveryPartner.create({ name: 'S1 pending rider', phone: '6990001234', password: 'x-test-only-pending', isApproved: false });
  assert.strictEqual((await riderRefresh(H.tokenFor(pending.id, 'rider'))).status, 200);

  const d = await H.mkRider();
  await d.update({ isApproved: false }); // admin deactivation: suspendedAt + tokenVersion bump
  await d.reload();
  assert.ok(d.suspendedAt);
  // old token: revoked
  assert.strictEqual((await riderRefresh(d.token)).status, 401);
  // even a token carrying the current tokenVersion is refused while deactivated
  H.clearAuthCache(d.id);
  const cur = sign({ id: d.id, role: 'rider', tv: Number(d.tokenVersion) }, '1d');
  const r = await riderRefresh(cur);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'ACCOUNT_SUSPENDED');

  const del = await H.mkRider();
  await del.update({ accountDeletedAt: new Date() });
  H.clearAuthCache(del.id);
  const rr = await riderRefresh(del.token);
  assert.strictEqual(rr.status, 401);
  assert.ok(!rr.body.token);
});

test('rider: a token from before a password change cannot be refreshed', async () => {
  const d = await H.mkRider();
  assert.strictEqual((await H.api('GET', '/api/delivery/profile', d.token)).status, 200);
  d.password = 'N3w-rider-pw-1';
  await d.save();
  const r = await riderRefresh(d.token);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'SESSION_REVOKED');
});

test('rider route refuses customer and store sessions', async () => {
  const u = await H.mkUser();
  assert.strictEqual((await riderRefresh(u.token)).status, 403);
  const s = await H.mkStore();
  assert.strictEqual((await riderRefresh(s.token)).status, 403);
  assert.strictEqual((await riderRefresh(null)).status, 401);
});
