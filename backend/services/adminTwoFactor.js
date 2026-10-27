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
const { getAdminTwoFactorModel } = require('../models/AdminTwoFactor');

const MFA_TOKEN_TTL_S = 5 * 60;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const PENDING_TTL_MS = 30 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const MFA_PURPOSE = 'admin_mfa';

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

/** A wrong code: count it, lock after MAX_FAILS (and void the sign-in challenge). Returns the reply body. */
const recordFailure = async (row, userId, what, req) => {
  const M = await getAdminTwoFactorModel();
  await M.increment('failedCount', { by: 1, where: { id: row.id } });
  const fresh = await M.findByPk(row.id);
  const n = Number(fresh.failedCount) || 0;
  if (n >= MAX_FAILS) {
    await M.update({ failedCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS), mfaJti: null }, { where: { id: row.id } });
    await audit(userId, 'ADMIN_2FA_LOCKED', { what, fails: n }, req);
    return { status: 429, body: lockedBody(lockInfo({ lockedUntil: new Date(Date.now() + LOCK_MS) })) };
  }
  await audit(userId, 'ADMIN_2FA_CODE_FAILED', { what, fails: n }, req);
  return { status: 401, body: { code: 'MFA_INVALID_CODE', message: 'That code is not right. Check the time on your phone and try again.', attemptsLeft: MAX_FAILS - n } };
};

const parseRecovery = (row) => {
  try { const a = JSON.parse(row.recoveryCodes || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
};
const newRecoverySet = () => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => T.newRecoveryCode());
  return { codes, stored: JSON.stringify(codes.map((c) => ({ h: T.hashRecoveryCode(c), usedAt: null }))) };
};

/**
 * Checks a TOTP code (or, when allowRecovery, a one-time recovery code) for an ENABLED row.
 * -> { ok: true, method, step?, consume: {fields to save} } | { ok: false, status, body }
 */
const checkSecondFactor = async (row, { code, recoveryCode }, { allowRecovery = true, what, req } = {}) => {
  const li = lockInfo(row);
  if (li.locked) return { ok: false, status: 429, body: lockedBody(li) };
  if (recoveryCode && allowRecovery) {
    const h = T.hashRecoveryCode(recoveryCode);
    const list = parseRecovery(row);
    // stored values are SHA-256 hashes (fixed length): comparing hashes leaks nothing about the code
    const idx = list.findIndex((x) => x && !x.usedAt && typeof x.h === 'string' && x.h.length === h.length && crypto.timingSafeEqual(Buffer.from(x.h), Buffer.from(h)));
    if (idx === -1 || T.normalizeRecoveryCode(recoveryCode).length !== 10) {
      const f = await recordFailure(row, row.userId, `${what}:recovery`, req);
      return { ok: false, ...f };
    }
    list[idx] = { ...list[idx], usedAt: new Date().toISOString() };
    return { ok: true, method: 'recovery', consume: { recoveryCodes: JSON.stringify(list) }, prevRecovery: row.recoveryCodes, left: list.filter((x) => !x.usedAt).length };
  }
  let dec;
  try { dec = T.decryptSecret(row.secretEnc); } catch (err) {
    console.error('[ADMIN_2FA_DECRYPT_ERROR]', err.message);
    return { ok: false, status: 500, body: { code: 'MFA_KEY_ERROR', message: 'The 2-step key cannot be read on the server (TOTP_ENC_KEY changed?). Use a recovery code.' } };
  }
  const step = T.verify(dec.secret, code, { lastUsedStep: row.lastUsedStep === null || row.lastUsedStep === undefined ? null : Number(row.lastUsedStep) });
  if (step === null) {
    const f = await recordFailure(row, row.userId, what, req);
    return { ok: false, ...f };
  }
  const consume = { lastUsedStep: step };
  if (dec.stale) consume.secretEnc = T.encryptSecret(dec.secret); // re-encrypt under TOTP_ENC_KEY
  return { ok: true, method: 'totp', step, consume };
};

// ── sign-in challenge ────────────────────────────────────────────────────────────────────────────
/** Called by sendSession for admins. -> { mfaRequired, mfaToken, expiresIn } | { setupRequired } | {} */
const loginGate = async (user) => {
  const row = await getRow(user.id);
  if (row && row.enabled) {
    const secret = mfaSecret();
    if (!secret) throw new Error('JWT_SECRET missing');
    const jti = crypto.randomBytes(16).toString('hex');
    const M = await getAdminTwoFactorModel();
    await M.update({ mfaJti: jti }, { where: { id: row.id } });
    const mfaToken = jwt.sign({ sub: String(user.id), tv: Number(user.tokenVersion) || 0, purpose: MFA_PURPOSE, jti }, secret, { expiresIn: MFA_TOKEN_TTL_S });
    await audit(user.id, 'ADMIN_2FA_CHALLENGE', {});
    return { mfaRequired: true, mfaToken, expiresIn: MFA_TOKEN_TTL_S };
  }
  if (required()) return { setupRequired: true };
  return {};
};

/** POST /api/users/login/mfa { mfaToken, code | recoveryCode } */
const loginMfa = async (req, res) => {
  try {
    const { mfaToken, code, recoveryCode } = req.body || {};
    const secret = mfaSecret();
    let decoded;
    try {
      decoded = jwt.verify(String(mfaToken || ''), secret || 'missing', { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(401).json({ code: 'MFA_TOKEN_INVALID', message: err && err.name === 'TokenExpiredError' ? 'The sign-in step expired. Enter your phone and password again.' : 'Sign in again with your phone and password.' });
    }
    if (!decoded || decoded.purpose !== MFA_PURPOSE || !decoded.sub || !decoded.jti) return res.status(401).json({ code: 'MFA_TOKEN_INVALID', message: 'Sign in again with your phone and password.' });
    const { getUserModel } = require('../models/User');
    const user = await getUserModel().findByPk(decoded.sub);
    if (!user || !isAdminRole(user.role) || (Number(user.tokenVersion) || 0) !== (Number(decoded.tv) || 0)) {
      return res.status(401).json({ code: 'MFA_TOKEN_INVALID', message: 'Sign in again with your phone and password.' });
    }
    if (user.isActive === false) return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Please contact ZCS support.' });
    const row = await getRow(user.id);
    if (!row || !row.enabled) return res.status(401).json({ code: 'MFA_TOKEN_INVALID', message: 'Sign in again with your phone and password.' });
    if (row.mfaJti !== decoded.jti) return res.status(401).json({ code: 'MFA_TOKEN_USED', message: 'This sign-in step was already used. Sign in again.' });
    if (!code && !recoveryCode) return res.status(400).json({ code: 'MFA_CODE_REQUIRED', message: 'Enter the 6-digit code from your authenticator app.' });
    const r = await checkSecondFactor(row, { code, recoveryCode }, { what: 'login', req });
    if (!r.ok) return res.status(r.status).json(r.body);
    const M = await getAdminTwoFactorModel();
    const where = { id: row.id, mfaJti: decoded.jti };
    if (r.method === 'recovery') where.recoveryCodes = r.prevRecovery;
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
  res.json({ enabled: !!(row && row.enabled), required: required(), enabledAt: row && row.enabled ? row.enabledAt : null, recoveryCodesLeft: left, locked: li.locked, lockedUntil: li.locked ? new Date(li.until).toISOString() : null, sessionVerified: !req.user.adminMfaPending });
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
  res.json({ otpauthUri: T.otpauthUri({ secretB32, account }), secret: secretB32.replace(/(.{4})/g, '$1 ').trim(), issuer: 'ZCS Admin', account, digits: T.DIGITS, period: T.STEP_SECONDS, expiresInMinutes: PENDING_TTL_MS / 60000 });
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
  const step = T.verify(secret, (req.body || {}).code);
  if (step === null) {
    const f = await recordFailure(row, req.user.id, 'enable', req);
    return res.status(codeStatus(f.status)).json(f.body);
  }
  const rc = newRecoverySet();
  const M = await getAdminTwoFactorModel();
  const [n] = await M.update({ enabled: true, secretEnc: row.pendingSecretEnc, pendingSecretEnc: null, pendingCreatedAt: null, enabledAt: new Date(), lastUsedStep: step, recoveryCodes: rc.stored, failedCount: 0, lockedUntil: null, mfaJti: null }, { where: { id: row.id, enabled: false } });
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
  await M.update({ enabled: false, secretEnc: null, pendingSecretEnc: null, pendingCreatedAt: null, enabledAt: null, lastUsedStep: null, recoveryCodes: null, failedCount: 0, lockedUntil: null, mfaJti: null }, { where: { id: row.id } });
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
  await M.update({ ...r.consume, recoveryCodes: rc.stored, failedCount: 0 }, { where: { id: row.id } });
  await audit(req.user.id, 'ADMIN_2FA_RECOVERY_CODES_RENEWED', {}, req);
  res.set('Cache-Control', 'no-store');
  res.json({ recoveryCodes: rc.codes, message: 'New recovery codes. The old ones no longer work.' });
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
  return r;
};

module.exports = {
  required, isEnabled, mfaPending, applyTo, effectiveRole, loginGate, loginMfa, requireAdminAccount, router,
  MFA_TOKEN_TTL_S, MAX_FAILS, LOCK_MS, RECOVERY_CODE_COUNT,
};
