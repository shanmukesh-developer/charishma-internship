// S1 item 2 (HTTP): admin 2-step sign-in — setup / enable / login challenge / mfaToken single use + expiry /
// lockout after 5 wrong codes / recovery codes / disable / ADMIN_2FA_REQUIRED enforcement / audit rows.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const T = H.r('utils/totp');
const jwt = require(require('path').join(H.B, 'node_modules/jsonwebtoken'));

// Injected clock: every code use moves 30 s on (a step can be used only once).
let clockMs = Date.parse('2026-10-19T06:00:00Z');
T._setClock(() => clockMs);
const tick = () => { clockMs += 30 * 1000; };
const codeFor = (secretB32, offsetSteps = 0) => T.hotp(T.base32Decode(secretB32), T.stepAt(clockMs) + offsetSteps);
const wrong = (secretB32) => { const c = codeFor(secretB32); return c === '000000' ? '111111' : '000000'; };

const login = (u, headers = {}) => H.api('POST', '/api/users/login', null, { phone: u.phone, password: u.plainPassword }, headers);
const mfa = (mfaToken, body) => H.api('POST', '/api/users/login/mfa', null, { mfaToken, ...body });
const audits = async (id) => (await H.ctx.M.VerificationLog.findAll({ where: { adminId: String(id) } })).map((a) => a.action);

/** Enrols 2FA for `admin` (session token `tok`). Returns { secret, recoveryCodes, token }. */
const enrol = async (tok) => {
  const s = await H.api('POST', '/api/admin/2fa/setup', tok, {});
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  const secret = s.body.secret.replace(/\s/g, '');
  tick();
  const e = await H.api('POST', '/api/admin/2fa/enable', tok, { code: codeFor(secret) });
  assert.strictEqual(e.status, 200, JSON.stringify(e.body));
  return { secret, recoveryCodes: e.body.recoveryCodes, token: e.body.token, setup: s.body };
};

test.before(() => H.setup());
test.after(() => { delete process.env.ADMIN_2FA_REQUIRED; T._setClock(null); return H.teardown(); });

test('setup returns an otpauth URI + base32 secret; secret stored encrypted; enable needs a right code', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  let st = await H.api('GET', '/api/admin/2fa/status', admin.token);
  assert.deepStrictEqual([st.status, st.body.enabled, st.body.required], [200, false, false]);
  const s = await H.api('POST', '/api/admin/2fa/setup', admin.token, {});
  assert.strictEqual(s.status, 200);
  assert.match(s.body.otpauthUri, /^otpauth:\/\/totp\/ZenWe%20Admin%3A/);
  const secret = s.body.secret.replace(/\s/g, '');
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.ok(s.body.otpauthUri.includes(`secret=${secret}`));
  const row = await H.ctx.M.AdminTwoFactor.findOne({ where: { userId: String(admin.id) } });
  assert.ok(row.pendingSecretEnc && !row.pendingSecretEnc.includes(secret), 'encrypted at rest');
  assert.strictEqual(row.enabled, false);
  let e = await H.api('POST', '/api/admin/2fa/enable', admin.token, { code: wrong(secret) });
  assert.strictEqual(e.status, 400, 'wrong code = 400 on dashboard endpoints (a 401 would sign the admin out)');
  assert.strictEqual(e.body.code, 'MFA_INVALID_CODE');
  tick();
  e = await H.api('POST', '/api/admin/2fa/enable', admin.token, { code: codeFor(secret) });
  assert.strictEqual(e.status, 200);
  assert.strictEqual(e.body.recoveryCodes.length, 10);
  assert.ok(e.body.token);
  // other sessions (the token used to enrol) are revoked; the returned one is a 2-step admin session
  H.clearAuthCache(admin.id);
  assert.strictEqual((await H.api('GET', '/api/admin/me', admin.token)).status, 401);
  const me = await H.api('GET', '/api/admin/me', e.body.token);
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.twoFactorEnabled, true);
  assert.strictEqual(jwt.decode(e.body.token).mfa, 1);
  const fresh = await H.ctx.M.AdminTwoFactor.findOne({ where: { userId: String(admin.id) } });
  assert.ok(fresh.secretEnc && !fresh.secretEnc.includes(secret));
  assert.ok(JSON.parse(fresh.recoveryCodes).every((x) => /^[0-9a-f]{64}$/.test(x.h)), 'recovery codes stored as hashes');
  assert.ok(!fresh.recoveryCodes.includes(e.body.recoveryCodes[0]));
  st = await H.api('GET', '/api/admin/2fa/status', e.body.token);
  assert.strictEqual(st.body.recoveryCodesLeft, 10);
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/setup', e.body.token, {})).status, 409, 'cannot re-setup while on');
  // non-admins never reach the 2FA endpoints
  const student = await H.mkUser();
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/setup', student.token, {})).status, 403);
  const acts = await audits(admin.id);
  for (const a of ['ADMIN_2FA_SETUP_STARTED', 'ADMIN_2FA_CODE_FAILED', 'ADMIN_2FA_ENABLED']) assert.ok(acts.includes(a), a);
});

test('login: password -> mfaRequired (no session); /login/mfa with the code -> admin token; mfaToken single-use', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const { secret } = await enrol(admin.token);
  const l = await login(admin, { 'X-Zenvy-Client': 'admin-web' });
  assert.strictEqual(l.status, 200);
  assert.strictEqual(l.body.mfaRequired, true);
  assert.ok(!l.body.token, 'no session token before the second step');
  assert.ok(!l.headers.get('set-cookie'), 'no cookie either');
  assert.strictEqual(l.body.mfaExpiresIn, 300);
  // the mfaToken is not a session
  assert.strictEqual((await H.api('GET', '/api/users/profile', l.body.mfaToken)).status, 401);
  assert.strictEqual((await mfa(l.body.mfaToken, {})).body.code, 'MFA_CODE_REQUIRED');
  tick();
  const ok = await mfa(l.body.mfaToken, { code: codeFor(secret) });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.token);
  assert.strictEqual(ok.body.role, 'admin');
  assert.strictEqual(jwt.decode(ok.body.token).mfa, 1);
  assert.strictEqual((await H.api('GET', '/api/admin/me', ok.body.token)).status, 200);
  // replay of the same mfaToken (even with a new code) is refused
  tick();
  const again = await mfa(l.body.mfaToken, { code: codeFor(secret) });
  assert.strictEqual(again.status, 401);
  assert.strictEqual(again.body.code, 'MFA_TOKEN_USED');
  // the same code twice (same step) is refused even with a new challenge
  const l2 = await login(admin);
  const c = codeFor(secret);
  assert.strictEqual((await mfa(l2.body.mfaToken, { code: c })).status, 200);
  const l3 = await login(admin);
  const replay = await mfa(l3.body.mfaToken, { code: c });
  assert.strictEqual(replay.status, 401);
  assert.strictEqual(replay.body.code, 'MFA_INVALID_CODE');
  // only the newest challenge is valid
  const a1 = await login(admin);
  const a2 = await login(admin);
  tick();
  assert.strictEqual((await mfa(a1.body.mfaToken, { code: codeFor(secret) })).body.code, 'MFA_TOKEN_USED');
  assert.strictEqual((await mfa(a2.body.mfaToken, { code: codeFor(secret) })).status, 200);
  // OTP / other sign-in paths go through the same gate (sendSession): verify-otp is covered by sendSession;
  // a forged / other-purpose token is refused
  const forged = jwt.sign({ sub: admin.id, tv: 0, purpose: 'admin_mfa', jti: 'x' }, process.env.JWT_SECRET);
  assert.strictEqual((await mfa(forged, { code: '123456' })).body.code, 'MFA_TOKEN_INVALID');
  assert.ok((await audits(admin.id)).includes('ADMIN_2FA_LOGIN_OK'));
});

test('mfaToken expiry (5 min) and binding to the password version', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const { secret } = await enrol(admin.token);
  const l = await login(admin);
  const d = jwt.decode(l.body.mfaToken);
  assert.ok(d.exp - d.iat === 300);
  const secretKey = `${process.env.JWT_SECRET}:admin-mfa-challenge`;
  const expired = jwt.sign({ sub: d.sub, tv: d.tv, purpose: d.purpose, jti: d.jti, iat: Math.floor(Date.now() / 1000) - 400, exp: Math.floor(Date.now() / 1000) - 100 }, secretKey);
  tick();
  const r = await mfa(expired, { code: codeFor(secret) });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'MFA_TOKEN_INVALID');
  assert.match(r.body.message, /expired/);
  // password changed (tokenVersion bumped) after the challenge -> refused
  await H.ctx.M.User.increment('tokenVersion', { by: 1, where: { id: admin.id } });
  const r2 = await mfa(l.body.mfaToken, { code: codeFor(secret) });
  assert.strictEqual(r2.body.code, 'MFA_TOKEN_INVALID');
});

test('5 wrong codes lock 2-step sign-in for 15 minutes and void the challenge', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const { secret } = await enrol(admin.token);
  const l = await login(admin);
  for (let i = 1; i <= 4; i++) {
    const r = await mfa(l.body.mfaToken, { code: wrong(secret) });
    assert.strictEqual(r.status, 401, `attempt ${i}`);
    assert.strictEqual(r.body.attemptsLeft, 5 - i);
  }
  const fifth = await mfa(l.body.mfaToken, { code: wrong(secret) });
  assert.strictEqual(fifth.status, 429);
  assert.strictEqual(fifth.body.code, 'MFA_LOCKED');
  tick();
  // even the right code is refused now (challenge voided); a new challenge is locked too
  assert.strictEqual((await mfa(l.body.mfaToken, { code: codeFor(secret) })).body.code, 'MFA_TOKEN_USED');
  const l2 = await login(admin);
  const locked = await mfa(l2.body.mfaToken, { code: codeFor(secret) });
  assert.strictEqual(locked.status, 429);
  assert.ok(locked.body.retryAfter > 800);
  // recovery codes are locked out as well
  assert.strictEqual((await mfa(l2.body.mfaToken, { recoveryCode: 'aaaaa-bbbbb' })).status, 429);
  assert.ok((await audits(admin.id)).includes('ADMIN_2FA_LOCKED'));
  // after the lock window
  await H.ctx.M.AdminTwoFactor.update({ lockedUntil: new Date(Date.now() - 1000) }, { where: { userId: String(admin.id) } });
  const l3 = await login(admin);
  tick();
  assert.strictEqual((await mfa(l3.body.mfaToken, { code: codeFor(secret) })).status, 200);
});

test('recovery codes: each works once; renew needs a TOTP code; disable needs a code and revokes sessions', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const { secret, recoveryCodes, token } = await enrol(admin.token);
  const l = await login(admin);
  const rc = await mfa(l.body.mfaToken, { recoveryCode: recoveryCodes[3].toUpperCase() });
  assert.strictEqual(rc.status, 200, JSON.stringify(rc.body));
  assert.strictEqual(rc.body.recoveryCodesLeft, 9);
  const l2 = await login(admin);
  const reuse = await mfa(l2.body.mfaToken, { recoveryCode: recoveryCodes[3] });
  assert.strictEqual(reuse.status, 401, 'a used recovery code is dead');
  assert.ok((await audits(admin.id)).includes('ADMIN_2FA_LOGIN_RECOVERY'));
  // renew
  const session = rc.body.token;
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/recovery-codes', session, { code: wrong(secret) })).status, 400);
  tick();
  const renew = await H.api('POST', '/api/admin/2fa/recovery-codes', session, { code: codeFor(secret) });
  assert.strictEqual(renew.status, 200);
  assert.strictEqual(renew.body.recoveryCodes.length, 10);
  const l3 = await login(admin);
  assert.strictEqual((await mfa(l3.body.mfaToken, { recoveryCode: recoveryCodes[0] })).status, 401, 'old set no longer works');
  // disable
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/disable', session, {})).status, 400);
  tick();
  const dis = await H.api('POST', '/api/admin/2fa/disable', session, { code: codeFor(secret) });
  assert.strictEqual(dis.status, 200, JSON.stringify(dis.body));
  assert.strictEqual(dis.body.enabled, false);
  H.clearAuthCache(admin.id);
  assert.strictEqual((await H.api('GET', '/api/admin/me', session)).status, 401, 'old sessions revoked');
  assert.strictEqual((await H.api('GET', '/api/admin/me', dis.body.token)).status, 200);
  const row = await H.ctx.M.AdminTwoFactor.findOne({ where: { userId: String(admin.id) } });
  assert.strictEqual(row.secretEnc, null);
  assert.strictEqual(row.recoveryCodes, null);
  // password login is back to one step
  const plain = await login(admin);
  assert.ok(plain.body.token);
  assert.ok(!plain.body.mfaRequired);
  assert.ok((await audits(admin.id)).includes('ADMIN_2FA_DISABLED'));
  void token;
});

test('ADMIN_2FA_REQUIRED=false (default): admins without 2FA keep working unchanged', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const l = await login(admin);
  assert.ok(l.body.token);
  assert.strictEqual(l.body.mfaSetupRequired, undefined);
  assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', l.body.token)).status, 200);
});

test('ADMIN_2FA_REQUIRED=true: an admin without 2FA gets a session that only reaches /me + /2fa (customer features still work)', async () => {
  process.env.ADMIN_2FA_REQUIRED = 'true';
  try {
    const admin = await H.mkUser({ role: 'admin' });
    // an older admin token without the claim loses admin powers too
    H.clearAuthCache(admin.id);
    assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', admin.token)).status, 403);
    const l = await login(admin, { 'X-Zenvy-Client': 'admin-web' });
    assert.strictEqual(l.status, 200);
    assert.strictEqual(l.body.mfaSetupRequired, true);
    const tok = l.body.token;
    assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', tok)).status, 403);
    const me = await H.api('GET', '/api/admin/me', tok);
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.mfaSetupRequired, true);
    assert.strictEqual((await H.api('GET', '/api/users/profile', tok)).status, 200, 'customer side unaffected');
    assert.strictEqual(await H.r('services/adminTwoFactor').effectiveRole('admin', jwt.decode(tok), admin.id), 'student', 'sockets / optional auth downgraded too');
    // enrol -> full admin session
    const { token, secret } = await enrol(tok);
    assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', token)).status, 200);
    const me2 = await H.api('GET', '/api/admin/me', token);
    assert.strictEqual(me2.body.mfaSetupRequired, false);
    // and from now on sign-in asks for the code
    const l2 = await login(admin);
    assert.strictEqual(l2.body.mfaRequired, true);
    tick();
    const ok = await mfa(l2.body.mfaToken, { code: codeFor(secret) });
    assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', ok.body.token)).status, 200);
  } finally {
    delete process.env.ADMIN_2FA_REQUIRED;
  }
});

test('an admin session without the 2-step claim has no admin powers once 2FA is on (defence in depth)', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const { token } = await enrol(admin.token);
  const user = await H.ctx.M.User.findByPk(admin.id);
  const noClaim = jwt.sign({ id: admin.id, role: 'admin', tv: user.tokenVersion }, process.env.JWT_SECRET);
  H.clearAuthCache(admin.id);
  assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', noClaim)).status, 403);
  assert.strictEqual((await H.api('GET', '/api/admin/me', noClaim)).body.code, 'MFA_REQUIRED');
  assert.strictEqual((await H.api('GET', '/api/admin/metrics/perf', token)).status, 200);
  const { isLiveAdminRequest } = H.r('middleware/authMiddleware');
  assert.strictEqual(await isLiveAdminRequest({ headers: { authorization: `Bearer ${noClaim}` } }), false);
  assert.strictEqual(await isLiveAdminRequest({ headers: { authorization: `Bearer ${token}` } }), true);
});
