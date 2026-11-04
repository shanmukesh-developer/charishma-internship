// S1: admin 2-step sign-in (TOTP, RFC 6238) — policy, sign-in challenge and the /api/admin/2fa endpoints.
//
// Sign-in: every session-issuing path (password, OTP, Firebase phone, Google) goes through
// userController.sendSession. For an admin with 2FA enabled it answers
//   { mfaRequired: true, mfaToken, mfaExpiresIn: 300 }      (no session token, no cookie)
// and POST /api/users/login/mfa { mfaToken, code | recoveryCode } issues the real admin token (claim mfa: 1).
// The mfaToken is signed with a derived secret (never accepted as a session), lives 5 minutes, is bound to
// the account's tokenVersion and is single-use (its jti is stored on the row and cleared atomically).
//
// Enforcement (env ADMIN_2FA_REQUIRED, default false): when true, an admin token without the mfa claim has
// NO admin powers — protect() treats it as a customer account (req.user.role 'student',
// req.user.adminMfaPending = true) and only /api/admin/me and /api/admin/2fa/* accept it. Customer features
// keep working for that account. The same rule applies to an admin with 2FA enabled whose token lacks the
// claim (defence in depth; enabling 2FA also revokes every older session).
//
// Wrong codes: 5 in a row lock 2-step sign-in for 15 minutes (login, enable, disable, new recovery codes);
// a lock also voids the outstanding mfaToken. Every event is written to the admin audit log
// (VerificationLogs, action ADMIN_2FA_*).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const T = require('../utils/totp');
const { Op } = require('sequelize');
const { getAdminTwoFactorModel } = require('../models/AdminTwoFactor');

const MFA_TOKEN_TTL_S = 5 * 60;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const PENDING_TTL_MS = 30 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const MFA_PURPOSE = 'admin_mfa';

// Email codes (method 'email', owner 1 Nov 2026: "add mail or otp verification for admin"): instead of the
// authenticator app, a 6-digit code to the address the admin confirmed at setup, free through Brevo
// (utils/mailer). Stored as an HMAC (a database copy cannot be brute-forced offline), valid 10 minutes, once; a
// new code replaces the old one. One email a minute, at most EMAIL_MAX_PER_HOUR an hour per admin, so someone
// who knows the password cannot flood the inbox. Same lock, recovery codes and audit log as the app codes.
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_RESEND_MS = 60 * 1000;
const EMAIL_MAX_PER_HOUR = 10;
// At sign-in a code with at least this long left is kept (signing in again never kills the code in the inbox).
const EMAIL_REUSE_MIN_LEFT_MS = 5 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;

const required = (env = process.env) => ['1', 'true', 'yes'].includes(String(env.ADMIN_2FA_REQUIRED || '').trim().toLowerCase());
const isAdminRole = (role) => String(role || '').toLowerCase() === 'admin';
const mfaSecret = () => (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}:admin-mfa-challenge` : null);

// ── audit ────────────────────────────────────────────────────────────────────────────────────────
const audit = async (adminId, action, details = {}, req = null) => {
  try {
    const { getVerificationLogModel } = require('../models/VerificationLog');
    const VL = getVerificationLogModel();
    if (!VL) return;
    const d = { ...details };
    if (req) {
      d.ip = req.ip || null;
      d.ua = String((req.headers && req.headers['user-agent']) || '').slice(0, 160) || null;
    }
    await VL.create({ adminId: String(adminId || 'unknown'), targetId: String(adminId || 'unknown'), action, details: JSON.stringify(d).slice(0, 2000) });
  } catch (err) {
    console.error('[ADMIN_2FA_AUDIT_ERROR]', err.message);
  }
};

// ── email codes ──────────────────────────────────────────────────────────────────────────────────
const mailer = () => require('../utils/mailer');
const emailAvailable = () => { try { return !!mailer().isMailerConfigured(); } catch { return false; } };
const normEmail = (e) => String(e || '').trim().toLowerCase();
const maskEmail = (e) => { const [u, d] = normEmail(e).split('@'); return d ? `${u.slice(0, 2)}***@${d}` : '***'; };
const hashEmailCode = (userId, code) => crypto.createHmac('sha256', `${process.env.JWT_SECRET || ''}:admin-email-code`).update(`${userId}:${code}`).digest('hex');
const isEmailMethod = (row) => !!row && row.method === 'email';
const RESEND_S = Math.ceil(EMAIL_RESEND_MS / 1000);
// Clears the email method (authenticator enabled, 2-step turned off). The hourly send count stays.
const NO_EMAIL = { email: null, pendingEmail: null, emailCodeHash: null, emailCodeExpiresAt: null };

const PURPOSE_TEXT = { login: 'sign in to ZENV Admin', setup: 'turn on email codes for ZENV Admin', manage: 'change 2-step sign-in for ZENV Admin' };
const sendCodeEmail = (to, code, purpose) => {
  const what = PURPOSE_TEXT[purpose] || PURPOSE_TEXT.login;
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const text = [
    `Your code to ${what} is: ${code}`,
    '',
    `It expires in 10 minutes and works once. Asked for on ${when} IST.`,
    'If this was not you, someone knows your admin password: change it now. Never share this code.',
    '',
    'ZENV',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:16px">ZENV Admin</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:20px">Your code to ${what}:</td></tr>
<tr><td align="center" style="padding-bottom:20px"><div style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:bold;background:#f1f2f5;border-radius:12px;padding:14px 22px">${code}</div></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#555">It expires in 10 minutes and works once. Asked for on ${when} IST. If this was not you, someone knows your admin password: change it now. Never share this code.</td></tr>
</table></td></tr></table></body></html>`;
  return mailer().sendMail({ to, subject: 'Your ZENV Admin verification code', text, html });
};

/**
 * Emails a new code to `to` (replacing the old one) within the limits: no new email while an unused code sent
 * under a minute ago is still valid (with reuseRecent, at sign-in, that code simply counts as sent), and at most
 * EMAIL_MAX_PER_HOUR an hour. A used or expired code never blocks the next one.
 * -> { sent: true, reused? } | { sent: false, reason: 'not_configured' | 'too_soon' | 'hourly_cap' | 'send_failed', retryAfter? }
 */
const issueEmailCode = async (row, to, purpose, req, { reuseRecent = false } = {}) => {
  if (!emailAvailable()) return { sent: false, reason: 'not_configured' };
  const now = Date.now();
  const last = row.emailCodeSentAt ? new Date(row.emailCodeSentAt).getTime() : 0;
  const stillValid = !!(row.emailCodeHash && row.emailCodeExpiresAt && new Date(row.emailCodeExpiresAt).getTime() > now);
  if (stillValid && now - last < EMAIL_RESEND_MS) {
    if (reuseRecent) return { sent: true, reused: true };
    return { sent: false, reason: 'too_soon', retryAfter: Math.ceil((EMAIL_RESEND_MS - (now - last)) / 1000) };
  }
  const windowStart = row.emailWindowStart ? new Date(row.emailWindowStart).getTime() : 0;
  const inWindow = now - windowStart < 60 * 60 * 1000;
  const count = inWindow ? Number(row.emailSendCount) || 0 : 0;
  if (count >= EMAIL_MAX_PER_HOUR) return { sent: false, reason: 'hourly_cap', retryAfter: Math.ceil((windowStart + 60 * 60 * 1000 - now) / 1000) };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const fields = {
    emailCodeHash: hashEmailCode(row.userId, code),
    emailCodeExpiresAt: new Date(now + EMAIL_CODE_TTL_MS),
    emailCodeSentAt: new Date(now),
    emailWindowStart: inWindow ? row.emailWindowStart : new Date(now),
    emailSendCount: count + 1,
  };
  const M = await getAdminTwoFactorModel();
  // Only the request that still sees the code and count it read may send: parallel resends send one email.
  const [won] = await M.update(fields, { where: { id: row.id, emailCodeHash: row.emailCodeHash || null, emailSendCount: row.emailSendCount === undefined ? null : row.emailSendCount } });
  if (!won) return reuseRecent ? { sent: true, reused: true } : { sent: false, reason: 'too_soon', retryAfter: RESEND_S };
  Object.assign(row, fields);
  const r = await sendCodeEmail(to, code, purpose);
  if (!r || !r.ok) {
    // It never arrived: a resend may go out at once.
    await M.update({ emailCodeSentAt: null }, { where: { id: row.id } });
    row.emailCodeSentAt = null;
    await audit(row.userId, 'ADMIN_2FA_EMAIL_FAILED', { purpose, reason: (r && r.reason) || 'unknown' }, req);
    return { sent: false, reason: 'send_failed' };
  }
  await audit(row.userId, 'ADMIN_2FA_EMAIL_SENT', { purpose, to: maskEmail(to) }, req);
  return { sent: true };
};

/** Reply for an email that did not go out. ctx 'login' (no session yet) or 'dashboard'. */
const emailSendError = (r, ctx = 'dashboard') => {
  if (r.reason === 'too_soon') return { status: 429, body: { code: 'MFA_EMAIL_TOO_SOON', message: `A code was just sent. You can ask for a new one in ${r.retryAfter} seconds.`, retryAfter: r.retryAfter } };
  if (r.reason === 'hourly_cap') return { status: 429, body: { code: 'MFA_EMAIL_LIMIT', message: 'Too many code emails this hour. Wait a while or use a recovery code.', retryAfter: r.retryAfter } };
  if (r.reason === 'not_configured') {
    const message = {
      login: 'Code emails are not working on the server right now. Use a recovery code.',
      manage: 'Code emails are not working on the server right now. Use a recovery code to turn 2-step sign-in off.',
    }[ctx] || 'Email sending is not set up on the server (Render > Environment > BREVO_API_KEY). Use the authenticator app instead.';
    return { status: 503, body: { code: 'MFA_EMAIL_UNAVAILABLE', message } };
  }
  return { status: 502, body: { code: 'MFA_EMAIL_FAILED', message: ctx === 'login' ? 'The code email could not be sent. Try again in a minute, or use a recovery code.' : 'The email could not be sent. Check the address and try again in a minute.' } };
};

// ── row helpers ──────────────────────────────────────────────────────────────────────────────────
const getRow = async (userId) => {
  const M = await getAdminTwoFactorModel();
  if (!M) return null;
  return M.findOne({ where: { userId: String(userId) } });
};
const getOrCreateRow = async (userId) => {
  const M = await getAdminTwoFactorModel();
  const [row] = await M.findOrCreate({ where: { userId: String(userId) }, defaults: { userId: String(userId), enabled: false, failedCount: 0 } });
  return row;
};

/** Has this admin turned 2FA on? (false when the table cannot be read: protect() must not break). */
const isEnabled = async (userId) => {
  try {
    const row = await getRow(userId);
    return !!(row && row.enabled);
  } catch (err) {
    console.warn('[ADMIN_2FA_STATUS_WARN]', err.message);
    return false;
  }
};

/** Should this admin token lose admin powers? (no mfa claim and 2FA enabled / required) */
const mfaPending = (decoded, twoFactorEnabled) => !(decoded && (decoded.mfa === 1 || decoded.mfa === true)) && (!!twoFactorEnabled || required());

/** req.user for protect(): an admin without a 2-step session is a plain customer account. */
const applyTo = (user, decoded, twoFactorEnabled) => {
  if (!user || !isAdminRole(user.role)) return user;
  if (!mfaPending(decoded, twoFactorEnabled)) return user;
  return { ...user, role: 'student', adminMfaPending: true };
};

/** Effective role for sockets / optional-auth checks. */
const effectiveRole = async (role, decoded, userId) => {
  if (!isAdminRole(role)) return role;
  if (decoded && (decoded.mfa === 1 || decoded.mfa === true)) return role;
  if (required() || await isEnabled(userId)) return 'student';
  return role;
};

const lockInfo = (row) => {
  const until = row && row.lockedUntil ? new Date(row.lockedUntil).getTime() : 0;
  if (until > Date.now()) return { locked: true, until, retryAfter: Math.ceil((until - Date.now()) / 1000) };
  return { locked: false };
};
const lockedBody = (li) => ({ code: 'MFA_LOCKED', message: 'Too many wrong codes. 2-step sign-in is locked for 15 minutes.', retryAfter: li.retryAfter, lockedUntil: new Date(li.until).toISOString() });

/**
 * Takes one attempt from the allowance BEFORE a code is compared, in one conditional UPDATE: parallel guesses can
 * never get more than MAX_FAILS compares per lock (a read-then-check let hundreds through at once; review 1 Nov).
 * Out of attempts: the lock is set (once) and the sign-in step voided.
 * -> { ok: true, count } | { ok: false, status: 429, body }
 */
const reserveAttempt = async (row, what, req) => {
  const M = await getAdminTwoFactorModel();
  const qi = M.sequelize.getQueryInterface();
  const [n] = await M.update({ failedCount: M.sequelize.literal(`${qi.quoteIdentifier('failedCount')} + 1`) }, {
    where: { id: row.id, failedCount: { [Op.lt]: MAX_FAILS }, [Op.or]: [{ lockedUntil: null }, { lockedUntil: { [Op.lt]: new Date() } }] },
  });
  if (n === 1) {
    const fresh = await M.findByPk(row.id, { attributes: ['failedCount'] });
    return { ok: true, count: Number(fresh && fresh.failedCount) || 0 };
  }
  const fresh = await M.findByPk(row.id);
  let li = lockInfo(fresh);
  if (!li.locked) {
    const until = new Date(Date.now() + LOCK_MS);
    const [m] = await M.update({ failedCount: 0, lockedUntil: until, mfaJti: null }, { where: { id: row.id, failedCount: { [Op.gte]: MAX_FAILS } } });
    if (m) await audit(row.userId, 'ADMIN_2FA_LOCKED', { what, fails: MAX_FAILS }, req);
    li = lockInfo(m ? { lockedUntil: until } : await M.findByPk(row.id));
    if (!li.locked) li = lockInfo({ lockedUntil: until });
  }
  return { ok: false, status: 429, body: lockedBody(li) };
};

/** A wrong code (its attempt already reserved, `count` = attempts used): lock at MAX_FAILS and void the sign-in step. */
const recordFailure = async (row, userId, what, req, count) => {
  const M = await getAdminTwoFactorModel();
  const n = Number(count) || 0;
  if (n >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MS);
    await M.update({ failedCount: 0, lockedUntil: until, mfaJti: null }, { where: { id: row.id } });
    await audit(userId, 'ADMIN_2FA_LOCKED', { what, fails: n }, req);
    return { status: 429, body: lockedBody(lockInfo({ lockedUntil: until })) };
  }
  await audit(userId, 'ADMIN_2FA_CODE_FAILED', { what, fails: n }, req);
  const message = isEmailMethod(row) || String(what).startsWith('email')
    ? 'That code is not right. Use the latest code we emailed you.'
    : 'That code is not right. Check the time on your phone and try again.';
  return { status: 401, body: { code: 'MFA_INVALID_CODE', message, attemptsLeft: MAX_FAILS - n } };
};

/** Checks an emailed code against the row's latest one (unexpired, once). Wrong codes count toward the lock. */
const checkEmailCode = async (row, code, { what, req }) => {
  const li = lockInfo(row);
  if (li.locked) return { ok: false, status: 429, body: lockedBody(li) };
  // No valid code exists, so nothing can be guessed: not counted as a wrong code.
  if (!(row.emailCodeHash && row.emailCodeExpiresAt && new Date(row.emailCodeExpiresAt).getTime() > Date.now())) {
    return { ok: false, status: 401, body: { code: 'MFA_CODE_EXPIRED', message: 'That code expired or was already used. Send a new code.' } };
  }
  const slot = await reserveAttempt(row, what, req);
  if (!slot.ok) return slot;
  const digits = String(code || '').replace(/\s/g, '');
  const want = Buffer.from(String(row.emailCodeHash));
  const got = Buffer.from(/^\d{6}$/.test(digits) ? hashEmailCode(row.userId, digits) : '');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    const f = await recordFailure(row, row.userId, what, req, slot.count);
    return { ok: false, ...f };
  }
  return { ok: true, method: 'email', consume: { emailCodeHash: null, emailCodeExpiresAt: null }, prevEmailHash: row.emailCodeHash };
};

const parseRecovery = (row) => {
  try { const a = JSON.parse(row.recoveryCodes || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
};
const newRecoverySet = () => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => T.newRecoveryCode());
  return { codes, stored: JSON.stringify(codes.map((c) => ({ h: T.hashRecoveryCode(c), usedAt: null }))) };
};

/**
 * Checks a TOTP code or, on an email-method row, the latest emailed code (or, when allowRecovery, a one-time
 * recovery code) for an ENABLED row.
 * -> { ok: true, method, step?, consume: {fields to save} } | { ok: false, status, body }
 */
const checkSecondFactor = async (row, { code, recoveryCode }, { allowRecovery = true, what, req } = {}) => {
  const li = lockInfo(row);
  if (li.locked) return { ok: false, status: 429, body: lockedBody(li) };
  if (recoveryCode && allowRecovery) {
    const slot = await reserveAttempt(row, `${what}:recovery`, req);
    if (!slot.ok) return slot;
    const h = T.hashRecoveryCode(recoveryCode);
    const list = parseRecovery(row);
    // stored values are SHA-256 hashes (fixed length): comparing hashes leaks nothing about the code
    const idx = list.findIndex((x) => x && !x.usedAt && typeof x.h === 'string' && x.h.length === h.length && crypto.timingSafeEqual(Buffer.from(x.h), Buffer.from(h)));
    if (idx === -1 || T.normalizeRecoveryCode(recoveryCode).length !== 10) {
      const f = await recordFailure(row, row.userId, `${what}:recovery`, req, slot.count);
      return { ok: false, ...f };
    }
    list[idx] = { ...list[idx], usedAt: new Date().toISOString() };
    return { ok: true, method: 'recovery', consume: { recoveryCodes: JSON.stringify(list) }, prevRecovery: row.recoveryCodes, left: list.filter((x) => !x.usedAt).length };
  }
  if (isEmailMethod(row)) return checkEmailCode(row, code, { what, req });
  let dec;
  try { dec = T.decryptSecret(row.secretEnc); } catch (err) {
    console.error('[ADMIN_2FA_DECRYPT_ERROR]', err.message);
    return { ok: false, status: 500, body: { code: 'MFA_KEY_ERROR', message: 'The 2-step key cannot be read on the server (TOTP_ENC_KEY changed?). Use a recovery code.' } };
  }
  const slot = await reserveAttempt(row, what, req);
  if (!slot.ok) return slot;
  const step = T.verify(dec.secret, code, { lastUsedStep: row.lastUsedStep === null || row.lastUsedStep === undefined ? null : Number(row.lastUsedStep) });
  if (step === null) {
    const f = await recordFailure(row, row.userId, what, req, slot.count);
    return { ok: false, ...f };
  }
  const consume = { lastUsedStep: step };
  if (dec.stale) consume.secretEnc = T.encryptSecret(dec.secret); // re-encrypt under TOTP_ENC_KEY
  return { ok: true, method: 'totp', step, consume };
};

// ── sign-in challenge ────────────────────────────────────────────────────────────────────────────
/**
 * Called by sendSession for admins. -> { mfaRequired, mfaToken, expiresIn, method, emailHint?, emailSent?,
 * emailError?, resendAfter?, message? } | { setupRequired } | {}. On an email-method row the code is emailed here;
 * a code with 5+ minutes left is kept instead (signing in again never kills the code already in the inbox), and
 * the sign-in step then lasts as long as a code (10 min). When no email goes out (locked, hourly cap, email off,
 * send failed) the step still opens with the reason: Resend later, or a recovery code, finishes the sign-in.
 */
const EMAIL_GATE_MESSAGES = {
  locked: 'Too many wrong codes. 2-step sign-in is locked for 15 minutes. Then sign in again.',
  hourly_cap: 'Too many code emails this hour. Use a recovery code, or try again later.',
  not_configured: 'Code emails are not working on the server right now. Use a recovery code.',
  send_failed: 'The code email could not be sent. Send a new code, or use a recovery code.',
};
const loginGate = async (user) => {
  const row = await getRow(user.id);
  if (row && row.enabled) {
    const secret = mfaSecret();
    if (!secret) throw new Error('JWT_SECRET missing');
    const emailMethod = isEmailMethod(row);
    const ttl = emailMethod ? Math.round(EMAIL_CODE_TTL_MS / 1000) : MFA_TOKEN_TTL_S;
    const jti = crypto.randomBytes(16).toString('hex');
    const M = await getAdminTwoFactorModel();
    await M.update({ mfaJti: jti }, { where: { id: row.id } });
    const mfaToken = jwt.sign({ sub: String(user.id), tv: Number(user.tokenVersion) || 0, purpose: MFA_PURPOSE, jti }, secret, { expiresIn: ttl });
    if (emailMethod) {
      const now = Date.now();
      const li = lockInfo(row);
      const left = row.emailCodeHash && row.emailCodeExpiresAt ? new Date(row.emailCodeExpiresAt).getTime() - now : 0;
      let sent;
      if (li.locked) sent = { sent: false, reason: 'locked', retryAfter: li.retryAfter };
      else if (left >= EMAIL_REUSE_MIN_LEFT_MS) sent = { sent: true, reused: true };
      else sent = await issueEmailCode(row, row.email, 'login', null, { reuseRecent: true });
      const sinceSend = row.emailCodeSentAt ? now - new Date(row.emailCodeSentAt).getTime() : EMAIL_RESEND_MS;
      const hint = maskEmail(row.email);
      await audit(user.id, 'ADMIN_2FA_CHALLENGE', { method: 'email', emailSent: !!sent.sent, reused: !!sent.reused, reason: sent.reason || null });
      return {
        mfaRequired: true, mfaToken, expiresIn: ttl, method: 'email', emailHint: hint, emailSent: !!sent.sent, emailError: sent.sent ? null : sent.reason,
        resendAfter: sent.sent ? Math.max(0, Math.ceil((EMAIL_RESEND_MS - sinceSend) / 1000)) : (sent.retryAfter || 0),
        message: sent.sent
          ? (sent.reused ? `Enter the latest 6-digit code we emailed to ${hint}.` : `Enter the 6-digit code we emailed to ${hint}.`)
          : (EMAIL_GATE_MESSAGES[sent.reason] || EMAIL_GATE_MESSAGES.send_failed),
      };
    }
    await audit(user.id, 'ADMIN_2FA_CHALLENGE', {});
    return { mfaRequired: true, mfaToken, expiresIn: ttl, method: 'totp' };
  }
  if (required()) return { setupRequired: true };
  return {};
};

/** The open sign-in step behind an mfaToken. -> { ok: true, decoded, user, row } | { ok: false, status, body } */
const readChallenge = async (mfaToken) => {
  const again = { ok: false, status: 401, body: { code: 'MFA_TOKEN_INVALID', message: 'Sign in again with your phone and password.' } };
  let decoded;
  try {
    decoded = jwt.verify(String(mfaToken || ''), mfaSecret() || 'missing', { algorithms: ['HS256'] });
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') return { ...again, body: { ...again.body, message: 'The sign-in step expired. Enter your phone and password again.' } };
    return again;
  }
  if (!decoded || decoded.purpose !== MFA_PURPOSE || !decoded.sub || !decoded.jti) return again;
  const { getUserModel } = require('../models/User');
  const user = await getUserModel().findByPk(decoded.sub);
  if (!user || !isAdminRole(user.role) || (Number(user.tokenVersion) || 0) !== (Number(decoded.tv) || 0)) return again;
  if (user.isActive === false) return { ok: false, status: 403, body: { code: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Please contact ZENV support.' } };
  const row = await getRow(user.id);
  if (!row || !row.enabled) return again;
  if (row.mfaJti !== decoded.jti) return { ok: false, status: 401, body: { code: 'MFA_TOKEN_USED', message: 'This sign-in step was already used. Sign in again.' } };
  return { ok: true, decoded, user, row };
};

/** POST /api/users/login/mfa { mfaToken, code | recoveryCode } */
const loginMfa = async (req, res) => {
  try {
    const { mfaToken, code, recoveryCode } = req.body || {};
    const ch = await readChallenge(mfaToken);
    if (!ch.ok) return res.status(ch.status).json(ch.body);
    const { decoded, user, row } = ch;
    if (!code && !recoveryCode) {
      return res.status(400).json({ code: 'MFA_CODE_REQUIRED', message: isEmailMethod(row) ? 'Enter the 6-digit code we emailed you.' : 'Enter the 6-digit code from your authenticator app.' });
    }
    const r = await checkSecondFactor(row, { code, recoveryCode }, { what: 'login', req });
    if (!r.ok) return res.status(r.status).json(r.body);
    const M = await getAdminTwoFactorModel();
    const where = { id: row.id, mfaJti: decoded.jti };
    if (r.method === 'recovery') where.recoveryCodes = r.prevRecovery;
    if (r.method === 'email') where.emailCodeHash = r.prevEmailHash; // the code works once, even when sent twice at the same moment
    const [n] = await M.update({ ...r.consume, mfaJti: null, failedCount: 0, lockedUntil: null }, { where });
    if (!n) return res.status(401).json({ code: 'MFA_TOKEN_USED', message: 'This sign-in step was already used. Sign in again.' });
    await audit(user.id, r.method === 'recovery' ? 'ADMIN_2FA_LOGIN_RECOVERY' : 'ADMIN_2FA_LOGIN_OK', r.method === 'recovery' ? { recoveryCodesLeft: r.left } : {}, req);
    const { sendSession } = require('../controllers/userController');
    return sendSession(res, user, 200, { mfaVerified: true, extra: r.method === 'recovery' ? { recoveryCodesLeft: r.left } : {} });
  } catch (err) {
    console.error('[ADMIN_2FA_LOGIN_ERROR]', err.message);
    return res.status(500).json({ message: 'Sign-in failed due to a server error. Please try again.' });
  }
};

/** POST /api/users/login/mfa/resend { mfaToken }: a new emailed code for the open sign-in step (email method). */
const loginMfaResend = async (req, res) => {
  try {
    const ch = await readChallenge((req.body || {}).mfaToken);
    if (!ch.ok) return res.status(ch.status).json(ch.body);
    const { row } = ch;
    if (!isEmailMethod(row)) return res.status(400).json({ code: 'MFA_NOT_EMAIL', message: 'This account uses an authenticator app for 2-step sign-in.' });
    const li = lockInfo(row);
    if (li.locked) return res.status(429).json(lockedBody(li));
    const r = await issueEmailCode(row, row.email, 'login', req);
    if (!r.sent) {
      const e = emailSendError(r, 'login');
      return res.status(e.status).json(e.body);
    }
    return res.json({ emailSent: true, emailHint: maskEmail(row.email), resendAfter: RESEND_S, message: `A new code was sent to ${maskEmail(row.email)}.` });
  } catch (err) {
    console.error('[ADMIN_2FA_RESEND_ERROR]', err.message);
    return res.status(500).json({ message: 'Could not send a new code. Please try again.' });
  }
};

// ── /api/admin/2fa endpoints ─────────────────────────────────────────────────────────────────────
/** Middleware after protect(): a real admin account (full or 2FA-pending session). */
const requireAdminAccount = (req, res, next) => {
  if (req.user && (isAdminRole(req.user.role) || req.user.adminMfaPending)) return next();
  return res.status(403).json({ message: 'Forbidden: Admin access required' });
};

const revokeOtherSessions = async (userId) => {
  const { getUserModel } = require('../models/User');
  const User = getUserModel();
  await User.increment('tokenVersion', { by: 1, where: { id: userId } });
  require('../middleware/authMiddleware').clearCachedUser(userId);
  const fresh = await User.findByPk(userId);
  try { require('../utils/realtime').disconnectRevokedSockets(userId, fresh.tokenVersion); } catch { /* best effort */ }
  return fresh;
};

const status = async (req, res) => {
  const row = await getRow(req.user.id);
  const left = row && row.enabled ? parseRecovery(row).filter((x) => !x.usedAt).length : 0;
  const li = lockInfo(row);
  res.set('Cache-Control', 'no-store');
  const on = !!(row && row.enabled);
  res.json({
    enabled: on, required: required(), enabledAt: on ? row.enabledAt : null, recoveryCodesLeft: left, locked: li.locked, lockedUntil: li.locked ? new Date(li.until).toISOString() : null, sessionVerified: !req.user.adminMfaPending,
    method: on ? (isEmailMethod(row) ? 'email' : 'totp') : null,
    emailHint: on && isEmailMethod(row) ? maskEmail(row.email) : null,
    emailAvailable: emailAvailable(),
    profileEmail: req.user.email || null,
  });
};

const setup = async (req, res) => {
  const row = await getOrCreateRow(req.user.id);
  if (row.enabled) return res.status(409).json({ code: 'MFA_ALREADY_ENABLED', message: '2-step sign-in is already on. Turn it off first to move it to a new phone.' });
  const li = lockInfo(row);
  if (li.locked) return res.status(429).json(lockedBody(li));
  const secret = T.newSecret();
  const secretB32 = T.base32Encode(secret);
  await row.update({ pendingSecretEnc: T.encryptSecret(secret), pendingCreatedAt: new Date() });
  const phone = String(req.user.phone || '');
  const account = `${String(req.user.name || 'admin').replace(/[:]/g, ' ').trim().slice(0, 30) || 'admin'}${phone ? ` (${phone.slice(-4)})` : ''}`;
  await audit(req.user.id, 'ADMIN_2FA_SETUP_STARTED', {}, req);
  res.set('Cache-Control', 'no-store');
  res.json({ otpauthUri: T.otpauthUri({ secretB32, account }), secret: secretB32.replace(/(.{4})/g, '$1 ').trim(), issuer: 'ZENV Admin', account, digits: T.DIGITS, period: T.STEP_SECONDS, expiresInMinutes: PENDING_TTL_MS / 60000 });
};

const enable = async (req, res) => {
  const row = await getRow(req.user.id);
  if (row && row.enabled) return res.status(409).json({ code: 'MFA_ALREADY_ENABLED', message: '2-step sign-in is already on.' });
  if (!row || !row.pendingSecretEnc || !row.pendingCreatedAt || Date.now() - new Date(row.pendingCreatedAt).getTime() > PENDING_TTL_MS) {
    return res.status(409).json({ code: 'MFA_SETUP_REQUIRED', message: 'Start the setup again (the key expired after 30 minutes).' });
  }
  const li = lockInfo(row);
  if (li.locked) return res.status(429).json(lockedBody(li));
  let secret;
  try { secret = T.decryptSecret(row.pendingSecretEnc).secret; } catch { return res.status(409).json({ code: 'MFA_SETUP_REQUIRED', message: 'Start the setup again.' }); }
  const slot = await reserveAttempt(row, 'enable', req);
  if (!slot.ok) return res.status(slot.status).json(slot.body);
  const step = T.verify(secret, (req.body || {}).code);
  if (step === null) {
    const f = await recordFailure(row, req.user.id, 'enable', req, slot.count);
    return res.status(codeStatus(f.status)).json(f.body);
  }
  const rc = newRecoverySet();
  const M = await getAdminTwoFactorModel();
  const [n] = await M.update({ enabled: true, method: 'totp', secretEnc: row.pendingSecretEnc, pendingSecretEnc: null, pendingCreatedAt: null, enabledAt: new Date(), lastUsedStep: step, recoveryCodes: rc.stored, failedCount: 0, lockedUntil: null, mfaJti: null, ...NO_EMAIL }, { where: { id: row.id, enabled: false } });
  if (!n) return res.status(409).json({ code: 'MFA_ALREADY_ENABLED', message: '2-step sign-in is already on.' });
  const user = await revokeOtherSessions(req.user.id);
  await audit(req.user.id, 'ADMIN_2FA_ENABLED', {}, req);
  const { generateToken } = require('../controllers/userController');
  const token = generateToken(user.id, user.role, user.tokenVersion, { mfa: 1 });
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: true, recoveryCodes: rc.codes, token, message: '2-step sign-in is on. Save the recovery codes now: they are shown only once. Other sessions were signed out.' });
};

const disable = async (req, res) => {
  const row = await getRow(req.user.id);
  if (!row || !row.enabled) return res.status(409).json({ code: 'MFA_NOT_ENABLED', message: '2-step sign-in is not on.' });
  const r = await checkSecondFactor(row, req.body || {}, { what: 'disable', req });
  if (!r.ok) return res.status(codeStatus(r.status)).json(r.body);
  const M = await getAdminTwoFactorModel();
  await M.update({ enabled: false, method: null, secretEnc: null, pendingSecretEnc: null, pendingCreatedAt: null, enabledAt: null, lastUsedStep: null, recoveryCodes: null, failedCount: 0, lockedUntil: null, mfaJti: null, ...NO_EMAIL }, { where: { id: row.id } });
  const user = await revokeOtherSessions(req.user.id);
  await audit(req.user.id, 'ADMIN_2FA_DISABLED', { method: r.method, requiredPolicy: required() }, req);
  const { generateToken } = require('../controllers/userController');
  const token = generateToken(user.id, user.role, user.tokenVersion);
  res.json({ enabled: false, token, mfaSetupRequired: required(), message: required() ? '2-step sign-in is off. It is required for admins: set it up again to keep admin access.' : '2-step sign-in is off. Other sessions were signed out.' });
};

const regenerateRecoveryCodes = async (req, res) => {
  const row = await getRow(req.user.id);
  if (!row || !row.enabled) return res.status(409).json({ code: 'MFA_NOT_ENABLED', message: '2-step sign-in is not on.' });
  const r = await checkSecondFactor(row, { code: (req.body || {}).code }, { allowRecovery: false, what: 'recovery_codes', req });
  if (!r.ok) return res.status(codeStatus(r.status)).json(r.body);
  const rc = newRecoverySet();
  const M = await getAdminTwoFactorModel();
  // One code, one new set: two requests with the same code (two tabs) must not both "succeed" with different sets.
  const where = { id: row.id };
  if (r.method === 'email') where.emailCodeHash = r.prevEmailHash;
  if (r.method === 'totp') where.lastUsedStep = row.lastUsedStep === undefined ? null : row.lastUsedStep;
  const [n] = await M.update({ ...r.consume, recoveryCodes: rc.stored, failedCount: 0 }, { where });
  if (!n) return res.status(409).json({ code: 'MFA_CODE_USED', message: 'That code was just used. Get a new code and try again.' });
  await audit(req.user.id, 'ADMIN_2FA_RECOVERY_CODES_RENEWED', {}, req);
  res.set('Cache-Control', 'no-store');
  res.json({ recoveryCodes: rc.codes, message: 'New recovery codes. The old ones no longer work.' });
};

/** POST /api/admin/2fa/email/setup { email }: emails a code to confirm the address (2-step must be off). */
const emailSetup = async (req, res) => {
  const row = await getOrCreateRow(req.user.id);
  if (row.enabled) return res.status(409).json({ code: 'MFA_ALREADY_ENABLED', message: '2-step sign-in is already on. Turn it off first to switch to email codes.' });
  const li = lockInfo(row);
  if (li.locked) return res.status(429).json(lockedBody(li));
  const email = normEmail((req.body || {}).email);
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ code: 'MFA_EMAIL_INVALID', message: 'Enter a valid email address.' });
  if (!emailAvailable()) {
    const e = emailSendError({ reason: 'not_configured' });
    return res.status(e.status).json(e.body);
  }
  // A new address: a code sent to the old one must never confirm it.
  if (row.pendingEmail !== email) await row.update({ pendingEmail: email, emailCodeHash: null, emailCodeExpiresAt: null });
  const r = await issueEmailCode(row, email, 'setup', req);
  if (!r.sent) {
    const e = emailSendError(r);
    return res.status(e.status).json(e.body);
  }
  await audit(req.user.id, 'ADMIN_2FA_EMAIL_SETUP_STARTED', { to: maskEmail(email) }, req);
  res.set('Cache-Control', 'no-store');
  res.json({ sentTo: maskEmail(email), expiresInMinutes: EMAIL_CODE_TTL_MS / 60000, resendAfter: RESEND_S });
};

/** POST /api/admin/2fa/email/enable { code }: the emailed code confirms the address and turns email codes on. */
const emailEnable = async (req, res) => {
  const row = await getRow(req.user.id);
  if (row && row.enabled) return res.status(409).json({ code: 'MFA_ALREADY_ENABLED', message: '2-step sign-in is already on.' });
  if (!row || !row.pendingEmail) return res.status(409).json({ code: 'MFA_SETUP_REQUIRED', message: 'Send a code to your email first.' });
  const r = await checkEmailCode(row, (req.body || {}).code, { what: 'email_enable', req });
  if (!r.ok) return res.status(codeStatus(r.status)).json(r.body);
  const rc = newRecoverySet();
  const email = row.pendingEmail;
  const M = await getAdminTwoFactorModel();
  const [n] = await M.update({
    enabled: true, method: 'email', email, pendingEmail: null, secretEnc: null, pendingSecretEnc: null, pendingCreatedAt: null, enabledAt: new Date(),
    lastUsedStep: null, recoveryCodes: rc.stored, failedCount: 0, lockedUntil: null, mfaJti: null, emailCodeHash: null, emailCodeExpiresAt: null,
  }, { where: { id: row.id, enabled: false, emailCodeHash: r.prevEmailHash } });
  if (!n) return res.status(409).json({ code: 'MFA_ALREADY_ENABLED', message: '2-step sign-in is already on.' });
  const user = await revokeOtherSessions(req.user.id);
  await audit(req.user.id, 'ADMIN_2FA_ENABLED', { method: 'email', to: maskEmail(email) }, req);
  const { generateToken } = require('../controllers/userController');
  const token = generateToken(user.id, user.role, user.tokenVersion, { mfa: 1 });
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: true, method: 'email', recoveryCodes: rc.codes, token, message: `Email codes are on: every sign-in now asks for a code sent to ${maskEmail(email)}. Save the recovery codes now: they are shown only once. Other sessions were signed out.` });
};

/** POST /api/admin/2fa/email/send-code: a code to the confirmed address, for turning 2-step off or new recovery codes. */
const emailSendCode = async (req, res) => {
  const row = await getRow(req.user.id);
  if (!row || !row.enabled || !isEmailMethod(row)) return res.status(409).json({ code: 'MFA_NOT_EMAIL', message: 'Email codes are not on for this account.' });
  const li = lockInfo(row);
  if (li.locked) return res.status(429).json(lockedBody(li));
  const r = await issueEmailCode(row, row.email, 'manage', req);
  if (!r.sent) {
    const e = emailSendError(r, 'manage');
    return res.status(e.status).json(e.body);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ sentTo: maskEmail(row.email), resendAfter: RESEND_S, message: `Code sent to ${maskEmail(row.email)}. It expires in 10 minutes.` });
};

// Wrong codes on the /api/admin/2fa endpoints answer 400 (not 401): a 401 would end the dashboard session.
const codeStatus = (st) => (st === 401 ? 400 : st);

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    console.error('[ADMIN_2FA_ERROR]', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

/** Router for /api/admin/2fa (protect + requireAdminAccount are applied by the caller). */
const router = () => {
  const express = require('express');
  const rateLimit = require('express-rate-limit');
  const r = express.Router();
  const lim = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyGenerator: (req) => `admin2fa:${req.user && req.user.id}`, message: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' }, ...require('../utils/sharedRateLimit').expressStore('admin.twoFactor') });
  r.get('/status', wrap(status));
  r.post('/setup', lim, wrap(setup));
  r.post('/enable', lim, wrap(enable));
  r.post('/disable', lim, wrap(disable));
  r.post('/recovery-codes', lim, wrap(regenerateRecoveryCodes));
  r.post('/email/setup', lim, wrap(emailSetup));
  r.post('/email/enable', lim, wrap(emailEnable));
  r.post('/email/send-code', lim, wrap(emailSendCode));
  return r;
};

module.exports = {
  required, isEnabled, mfaPending, applyTo, effectiveRole, loginGate, loginMfa, loginMfaResend, requireAdminAccount, router,
  MFA_TOKEN_TTL_S, MAX_FAILS, LOCK_MS, RECOVERY_CODE_COUNT, EMAIL_CODE_TTL_MS, EMAIL_RESEND_MS, EMAIL_MAX_PER_HOUR,
};
