// Admin 2-step sign-in by email code (services/adminTwoFactor, method 'email'; owner 1 Nov 2026: "add mail or otp
// verification for admin"): setup confirms the address with an emailed code; sign-in emails a code (no session
// before it); codes are hashed, expire, work once and are replaced by a resend; one email a minute while a code
// is unused, 10 an hour; wrong codes lock like app codes; a failed email still lets a recovery code sign in;
// send-code for new recovery codes / turning it off; the authenticator method is unchanged.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const jwt = require(require('path').join(H.B, 'node_modules/jsonwebtoken'));
const T = H.r('utils/totp');

// The harness stubs utils/mailer with a plain object: switch it on and capture what would be sent.
const mailer = H.r('utils/mailer');
let outbox = [];
let failNext = false;
const mailOn = () => {
  mailer.isMailerConfigured = () => true;
  mailer.sendMail = async (m) => {
    if (failNext) { failNext = false; return { ok: false, reason: 'timeout' }; }
    outbox.push(m);
    return { ok: true };
  };
};
const mailOff = () => { mailer.isMailerConfigured = () => false; };
const lastCode = (to) => {
  const m = [...outbox].reverse().find((x) => !to || x.to === to);
  const hit = m && /is: (\d{6})/.exec(m.text);
  return hit ? hit[1] : null;
};
const otherCode = (c) => (c === '000000' ? '111111' : '000000');

const login = (u) => H.api('POST', '/api/users/login', null, { phone: u.phone, password: u.plainPassword }, { 'X-Zenvy-Client': 'admin-web' });
const mfa = (mfaToken, body) => H.api('POST', '/api/users/login/mfa', null, { mfaToken, ...body });
const resend = (mfaToken) => H.api('POST', '/api/users/login/mfa/resend', null, { mfaToken });
const row = (admin) => H.ctx.M.AdminTwoFactor.findOne({ where: { userId: String(admin.id) } });
const backdateSend = async (admin, ms = 61 * 1000) => (await row(admin)).update({ emailCodeSentAt: new Date(Date.now() - ms) });
const lockedNow = (r) => !!(r && r.lockedUntil && new Date(r.lockedUntil).getTime() > Date.now());

/** Turns email codes on for `admin` with address `email`. -> { token, recoveryCodes } */
const enrolEmail = async (admin, email) => {
  const s = await H.api('POST', '/api/admin/2fa/email/setup', admin.token, { email });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  const e = await H.api('POST', '/api/admin/2fa/email/enable', admin.token, { code: lastCode(email) });
  assert.strictEqual(e.status, 200, JSON.stringify(e.body));
  return { token: e.body.token, recoveryCodes: e.body.recoveryCodes };
};

test.before(() => H.setup());
test.after(() => H.teardown());
test.beforeEach(() => { outbox = []; failNext = false; mailOn(); });

test('setup: refused while email is not set up; the emailed code confirms the address; enable gives recovery codes and a 2-step session', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `owner.${admin.id.slice(0, 6)}@example.com`;
  mailOff();
  let st = await H.api('GET', '/api/admin/2fa/status', admin.token);
  assert.strictEqual(st.body.emailAvailable, false);
  let s = await H.api('POST', '/api/admin/2fa/email/setup', admin.token, { email });
  assert.strictEqual(s.status, 503);
  assert.strictEqual(s.body.code, 'MFA_EMAIL_UNAVAILABLE');
  mailOn();
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/email/setup', admin.token, { email: 'not-an-email' })).status, 400);
  s = await H.api('POST', '/api/admin/2fa/email/setup', admin.token, { email: ` ${email.toUpperCase()} ` });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  assert.strictEqual(s.body.sentTo, `${email.slice(0, 2)}***@example.com`);
  assert.strictEqual(outbox.length, 1);
  assert.strictEqual(outbox[0].to, email, 'address trimmed and lower-cased');
  assert.strictEqual(outbox[0].subject, 'Your ZCS Admin verification code');
  const code = lastCode(email);
  assert.match(code, /^\d{6}$/);
  const r = await row(admin);
  assert.strictEqual(r.pendingEmail, email);
  assert.match(r.emailCodeHash, /^[0-9a-f]{64}$/);
  assert.ok(!r.emailCodeHash.includes(code), 'stored as a hash');
  assert.strictEqual(r.enabled, false);
  // A second email at once is refused while that code is unused.
  const again = await H.api('POST', '/api/admin/2fa/email/setup', admin.token, { email });
  assert.strictEqual(again.status, 429);
  assert.strictEqual(again.body.code, 'MFA_EMAIL_TOO_SOON');
  assert.ok(again.body.retryAfter > 0 && again.body.retryAfter <= 60);
  let e = await H.api('POST', '/api/admin/2fa/email/enable', admin.token, { code: otherCode(code) });
  assert.strictEqual(e.status, 400, 'wrong code = 400 on dashboard endpoints');
  assert.strictEqual(e.body.code, 'MFA_INVALID_CODE');
  assert.strictEqual(e.body.attemptsLeft, 4);
  assert.match(e.body.message, /emailed/);
  e = await H.api('POST', '/api/admin/2fa/email/enable', admin.token, { code });
  assert.strictEqual(e.status, 200, JSON.stringify(e.body));
  assert.strictEqual(e.body.method, 'email');
  assert.strictEqual(e.body.recoveryCodes.length, 10);
  assert.strictEqual(jwt.decode(e.body.token).mfa, 1);
  H.clearAuthCache(admin.id);
  assert.strictEqual((await H.api('GET', '/api/admin/me', admin.token)).status, 401, 'older sessions revoked');
  st = await H.api('GET', '/api/admin/2fa/status', e.body.token);
  assert.deepStrictEqual([st.body.enabled, st.body.method, st.body.emailHint, st.body.recoveryCodesLeft], [true, 'email', `${email.slice(0, 2)}***@example.com`, 10]);
  const fresh = await row(admin);
  assert.deepStrictEqual([fresh.email, fresh.pendingEmail, fresh.emailCodeHash, fresh.secretEnc], [email, null, null, null]);
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/email/setup', e.body.token, { email })).status, 409, 'no second setup while on');
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/setup', e.body.token, {})).status, 409, 'nor an authenticator setup');
});

test('sign-in: the code is emailed (no session before it), works once, a resend replaces it, an expired code is refused', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `signin.${admin.id.slice(0, 6)}@example.com`;
  await enrolEmail(admin, email);
  outbox = [];
  let l = await login(admin);
  assert.strictEqual(l.status, 200);
  assert.strictEqual(l.body.mfaRequired, true);
  assert.strictEqual(l.body.mfaMethod, 'email');
  assert.strictEqual(l.body.emailSent, true);
  assert.strictEqual(l.body.emailHint, `${email.slice(0, 2)}***@example.com`);
  assert.ok(!l.body.token && !l.headers.get('set-cookie'), 'no session before the code');
  assert.match(l.body.message, /emailed/);
  assert.strictEqual(outbox.length, 1);
  const first = lastCode(email);
  // Signing in again within the minute sends no second email: the first code still works.
  const l2 = await login(admin);
  assert.strictEqual(l2.body.emailSent, true);
  assert.strictEqual(outbox.length, 1, 'no second email');
  assert.strictEqual((await mfa(l.body.mfaToken, { code: first })).body.code, 'MFA_TOKEN_USED', 'the newer sign-in step replaced the older one');
  l = l2;
  assert.strictEqual((await mfa(l.body.mfaToken, {})).body.code, 'MFA_CODE_REQUIRED');
  let bad = await mfa(l.body.mfaToken, { code: otherCode(first) });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(bad.body.code, 'MFA_INVALID_CODE');
  // Resend: refused while the code is fresh, then a new code that replaces the old one.
  const early = await resend(l.body.mfaToken);
  assert.strictEqual(early.status, 429);
  assert.strictEqual(early.body.code, 'MFA_EMAIL_TOO_SOON');
  await backdateSend(admin);
  const rs = await resend(l.body.mfaToken);
  assert.strictEqual(rs.status, 200, JSON.stringify(rs.body));
  assert.strictEqual(outbox.length, 2);
  const second = lastCode(email);
  if (second !== first) {
    bad = await mfa(l.body.mfaToken, { code: first });
    assert.strictEqual(bad.body.code, 'MFA_INVALID_CODE', 'the old code no longer works');
  }
  const ok = await mfa(l.body.mfaToken, { code: second });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.token);
  assert.strictEqual(jwt.decode(ok.body.token).mfa, 1);
  assert.strictEqual((await H.api('GET', '/api/admin/me', ok.body.token)).status, 200);
  // The code worked once: a new sign-in right away emails a new code (a used code never blocks the next).
  const l3 = await login(admin);
  assert.strictEqual(l3.body.emailSent, true);
  assert.strictEqual(outbox.length, 3);
  // Expired: refused without counting as a wrong code.
  const r = await row(admin);
  await r.update({ emailCodeExpiresAt: new Date(Date.now() - 1000) });
  const fails = (await row(admin)).failedCount;
  const exp = await mfa(l3.body.mfaToken, { code: lastCode(email) });
  assert.strictEqual(exp.status, 401);
  assert.strictEqual(exp.body.code, 'MFA_CODE_EXPIRED');
  assert.strictEqual((await row(admin)).failedCount, fails, 'an expired code is not a guess');
  const acts = (await H.ctx.M.VerificationLog.findAll({ where: { adminId: String(admin.id) } })).map((a) => a.action);
  for (const a of ['ADMIN_2FA_EMAIL_SENT', 'ADMIN_2FA_CHALLENGE', 'ADMIN_2FA_CODE_FAILED', 'ADMIN_2FA_LOGIN_OK']) assert.ok(acts.includes(a), a);
});

test('5 wrong emailed codes lock it; a failed email still lets a recovery code sign in; resend works at once after a failure', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `lock.${admin.id.slice(0, 6)}@example.com`;
  const { recoveryCodes } = await enrolEmail(admin, email);
  let l = await login(admin);
  const good = lastCode(email);
  let last;
  for (let i = 0; i < 5; i++) last = await mfa(l.body.mfaToken, { code: otherCode(good) });
  assert.strictEqual(last.status, 429);
  assert.strictEqual(last.body.code, 'MFA_LOCKED');
  assert.strictEqual((await resend(l.body.mfaToken)).status, 401, 'the lock voided the sign-in step');
  await (await row(admin)).update({ lockedUntil: null, failedCount: 0 });
  // The email fails: still a sign-in step, the message says so, a recovery code signs in.
  failNext = true;
  outbox = [];
  await (await row(admin)).update({ emailCodeHash: null, emailCodeExpiresAt: null });
  l = await login(admin);
  assert.strictEqual(l.body.mfaRequired, true);
  assert.strictEqual(l.body.emailSent, false);
  assert.match(l.body.message, /could not be sent/);
  // ...and a resend goes out at once.
  const rs = await resend(l.body.mfaToken);
  assert.strictEqual(rs.status, 200, JSON.stringify(rs.body));
  assert.strictEqual(outbox.length, 1);
  const rec = await mfa(l.body.mfaToken, { recoveryCode: recoveryCodes[0] });
  assert.strictEqual(rec.status, 200, JSON.stringify(rec.body));
  assert.strictEqual(rec.body.recoveryCodesLeft, 9);
});

test('at most 10 code emails an hour; email off on the server answers a clear message at sign-in', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `cap.${admin.id.slice(0, 6)}@example.com`;
  await enrolEmail(admin, email);
  await (await row(admin)).update({ emailWindowStart: new Date(), emailSendCount: 10, emailCodeHash: null, emailCodeExpiresAt: null });
  const l = await login(admin);
  assert.strictEqual(l.body.mfaRequired, true);
  assert.strictEqual(l.body.emailSent, false);
  const rs = await resend(l.body.mfaToken);
  assert.strictEqual(rs.status, 429);
  assert.strictEqual(rs.body.code, 'MFA_EMAIL_LIMIT');
  await (await row(admin)).update({ emailWindowStart: new Date(Date.now() - 61 * 60 * 1000) });
  mailOff();
  const off = await resend(l.body.mfaToken);
  assert.strictEqual(off.status, 503);
  assert.strictEqual(off.body.code, 'MFA_EMAIL_UNAVAILABLE');
  assert.match(off.body.message, /recovery code/);
  mailOn();
  assert.strictEqual((await resend(l.body.mfaToken)).status, 200, 'a new hour, email back: sent');
});

test('manage: send-code, then new recovery codes or turn off with the emailed code; off clears the email method; the authenticator still works', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `manage.${admin.id.slice(0, 6)}@example.com`;
  let { token } = await enrolEmail(admin, email);
  let sc = await H.api('POST', '/api/admin/2fa/email/send-code', token, {});
  assert.strictEqual(sc.status, 200, JSON.stringify(sc.body));
  const rc = await H.api('POST', '/api/admin/2fa/recovery-codes', token, { code: lastCode(email) });
  assert.strictEqual(rc.status, 200, JSON.stringify(rc.body));
  assert.strictEqual(rc.body.recoveryCodes.length, 10);
  // That code is used: a new one goes out at once.
  sc = await H.api('POST', '/api/admin/2fa/email/send-code', token, {});
  assert.strictEqual(sc.status, 200);
  const wrongOff = await H.api('POST', '/api/admin/2fa/disable', token, { code: otherCode(lastCode(email)) });
  assert.strictEqual(wrongOff.status, 400);
  const off = await H.api('POST', '/api/admin/2fa/disable', token, { code: lastCode(email) });
  assert.strictEqual(off.status, 200, JSON.stringify(off.body));
  token = off.body.token;
  const st = await H.api('GET', '/api/admin/2fa/status', token);
  assert.deepStrictEqual([st.body.enabled, st.body.method, st.body.emailHint], [false, null, null]);
  const r = await row(admin);
  assert.deepStrictEqual([r.email, r.method, r.emailCodeHash], [null, null, null]);
  assert.strictEqual((await H.api('POST', '/api/admin/2fa/email/send-code', token, {})).status, 409);
  // The authenticator method next: sign-in says totp and resend refuses.
  const s = await H.api('POST', '/api/admin/2fa/setup', token, {});
  assert.strictEqual(s.status, 200);
  const secret = s.body.secret.replace(/\s/g, '');
  const e = await H.api('POST', '/api/admin/2fa/enable', token, { code: T.hotp(T.base32Decode(secret), T.stepAt(Date.now())) });
  assert.strictEqual(e.status, 200, JSON.stringify(e.body));
  assert.strictEqual((await row(admin)).method, 'totp');
  outbox = [];
  const l = await login(admin);
  assert.strictEqual(l.body.mfaMethod, 'totp');
  assert.strictEqual(outbox.length, 0, 'no email for an authenticator account');
  const rs = await resend(l.body.mfaToken);
  assert.strictEqual(rs.status, 400);
  assert.strictEqual(rs.body.code, 'MFA_NOT_EMAIL');
});

// ── review fixes (1 Nov evening) ──────────────────────────────────────────────────────────────────

test('parallel wrong guesses never get more than 5 compares: the lock holds for email and authenticator codes', async () => {
  // Email method: 20 wrong codes at once, then the right one.
  const admin = await H.mkUser({ role: 'admin' });
  const email = `burst.${admin.id.slice(0, 6)}@example.com`;
  await enrolEmail(admin, email);
  const l = await login(admin);
  const good = lastCode(email);
  const burst = await Promise.all(Array.from({ length: 20 }, () => mfa(l.body.mfaToken, { code: otherCode(good) })));
  const compared = burst.filter((r) => r.status === 401).length;
  assert.ok(compared <= 4, `at most 4 wrong answers before the lock (got ${compared})`);
  assert.ok(burst.every((r) => [401, 429].includes(r.status)), burst.map((r) => r.status).join(','));
  const after = await mfa(l.body.mfaToken, { code: good });
  assert.notStrictEqual(after.status, 200, 'the right code after the burst does not sign in');
  const fails = (await H.ctx.M.VerificationLog.findAll({ where: { adminId: String(admin.id), action: 'ADMIN_2FA_CODE_FAILED' } })).length;
  assert.ok(fails <= 4, `wrong codes counted: ${fails}`);
  assert.ok(lockedNow(await row(admin)), 'locked');

  // Authenticator method: same burst.
  const a2 = await H.mkUser({ role: 'admin' });
  const s = await H.api('POST', '/api/admin/2fa/setup', a2.token, {});
  const secret = s.body.secret.replace(/\s/g, '');
  const en = await H.api('POST', '/api/admin/2fa/enable', a2.token, { code: T.hotp(T.base32Decode(secret), T.stepAt(Date.now())) });
  assert.strictEqual(en.status, 200, JSON.stringify(en.body));
  const l2 = await login(a2);
  const right = T.hotp(T.base32Decode(secret), T.stepAt(Date.now()) + 1);
  const wrongT = right === '000000' ? '111111' : '000000';
  const burst2 = await Promise.all(Array.from({ length: 20 }, () => mfa(l2.body.mfaToken, { code: wrongT })));
  assert.ok(burst2.filter((r) => r.status === 401).length <= 4, burst2.map((r) => r.status).join(','));
  assert.strictEqual((await mfa(l2.body.mfaToken, { code: right })).status === 200, false, 'locked: the right app code is refused too');
});

test('parallel resends send one email; a code renews the recovery codes only once', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `race.${admin.id.slice(0, 6)}@example.com`;
  let { token } = await enrolEmail(admin, email);
  const l = await login(admin);
  await (await row(admin)).update({ emailCodeHash: null, emailCodeExpiresAt: null, emailCodeSentAt: null });
  const before = outbox.length;
  const countBefore = Number((await row(admin)).emailSendCount) || 0;
  const rs = await Promise.all(Array.from({ length: 10 }, () => resend(l.body.mfaToken)));
  assert.strictEqual(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join(','));
  assert.strictEqual(outbox.length - before, 1, 'one email');
  assert.strictEqual(Number((await row(admin)).emailSendCount), countBefore + 1);
  // Two tabs renewing recovery codes with the same emailed code: exactly one wins.
  const sc = await H.api('POST', '/api/admin/2fa/email/send-code', token, {});
  assert.ok([200, 429].includes(sc.status), JSON.stringify(sc.body));
  if (sc.status === 429) { await backdateSend(admin); await (await row(admin)).update({ emailCodeHash: null }); assert.strictEqual((await H.api('POST', '/api/admin/2fa/email/send-code', token, {})).status, 200); }
  const code = lastCode(email);
  const two = await Promise.all([1, 2].map(() => H.api('POST', '/api/admin/2fa/recovery-codes', token, { code })));
  assert.strictEqual(two.filter((r) => r.status === 200).length, 1, two.map((r) => `${r.status}:${r.body && r.body.code}`).join(','));
});

test('sign-in keeps a code with time left (no second email), sends a new one when it is nearly used up, and says why when it cannot', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const email = `keep.${admin.id.slice(0, 6)}@example.com`;
  await enrolEmail(admin, email);
  outbox = [];
  const l1 = await login(admin);
  assert.strictEqual(l1.body.mfaExpiresIn, 600, 'the email sign-in step lasts as long as a code');
  assert.strictEqual(outbox.length, 1);
  const code = lastCode(email);
  await backdateSend(admin, 2 * 60 * 1000);
  const l2 = await login(admin);
  assert.strictEqual(l2.body.emailSent, true);
  assert.strictEqual(outbox.length, 1, 'no second email: the code in the inbox still works');
  assert.match(l2.body.message, /latest/);
  assert.strictEqual(l2.body.resendAfter, 0, 'sent 2 minutes ago: Resend is open');
  // Less than 5 minutes left: a new code.
  await (await row(admin)).update({ emailCodeExpiresAt: new Date(Date.now() + 3 * 60 * 1000) });
  const l3 = await login(admin);
  assert.strictEqual(l3.body.emailSent, true);
  assert.strictEqual(outbox.length, 2, 'new code');
  assert.notStrictEqual(lastCode(email), null);
  const ok = await mfa(l3.body.mfaToken, { code: lastCode(email) });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  void code;
  // Locked: no email, the reason, and Resend waits until the lock ends.
  await (await row(admin)).update({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
  outbox = [];
  const lk = await login(admin);
  assert.deepStrictEqual([lk.body.emailSent, lk.body.emailError], [false, 'locked']);
  assert.match(lk.body.message, /locked/);
  assert.ok(lk.body.resendAfter > 500, `resendAfter ${lk.body.resendAfter}`);
  assert.strictEqual(outbox.length, 0);
  await (await row(admin)).update({ lockedUntil: null, failedCount: 0 });
  // Hourly limit: the reason too.
  await (await row(admin)).update({ emailWindowStart: new Date(), emailSendCount: 10, emailCodeHash: null, emailCodeExpiresAt: null });
  const cap = await login(admin);
  assert.deepStrictEqual([cap.body.emailSent, cap.body.emailError], [false, 'hourly_cap']);
  assert.match(cap.body.message, /this hour/);
});
