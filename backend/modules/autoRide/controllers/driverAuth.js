// Zenvy Auto Driver accounts: sign-up (mobile proven with the existing OTP flow: POST
// /api/users/send-otp { phone, purpose: 'auth' } then { otp } here, or a registrationToken /
// Firebase phone token), password login (accountLockout + auth rate limit on the route), refresh,
// password change (bumps tokenVersion: every other session signs out), device tokens.
const bcrypt = require('bcryptjs');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUniqueError } = require('../services/util');
const { signDriverToken } = require('../services/driverAuth');
const { normalizePhone } = require('../../../utils/phoneUtils');
const { cleanFcmToken } = require('../../../utils/fcmToken');
const S = require('../services/serialize');
const clock = require('../services/clock');

const MOBILE_RE = /^[6-9]\d{9}$/;
const Driver = () => getModel('AutoDriver');
// Same bcrypt work for unknown numbers (no timing hint about which numbers have accounts).
let dummy = null;
const dummyHash = () => (dummy || (dummy = bcrypt.hashSync(`no-account-${Date.now()}`, 10)));

const checkPassword = (pw) => {
  const p = typeof pw === 'string' ? pw : '';
  if (p.length < 8 || p.length > 72 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) {
    throw fail(400, 'WEAK_PASSWORD', 'Use a password of 8 to 72 characters with letters and numbers.', { field: 'password' });
  }
  return p;
};

// POST /api/auto-ride/driver/auth/register { name, phone, password, otp | registrationToken | firebaseToken }
const register = async (req, res) => {
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  if (!MOBILE_RE.test(phone)) throw fail(400, 'INVALID_PHONE', 'Enter a valid 10-digit mobile number.', { field: 'phone' });
  const name = cleanText(body.name, 80);
  if (name.length < 2) throw fail(400, 'INVALID_INPUT', 'Enter your full name as on your driving licence.', { field: 'name' });
  const password = checkPassword(body.password);
  if (await Driver().findOne({ where: { phone }, attributes: ['id'] })) {
    throw fail(409, 'PHONE_TAKEN', 'A driver account already uses this number. Sign in instead.');
  }
  const { verifyPhoneProof } = require('../../../controllers/userController');
  const proof = await verifyPhoneProof({ phone, firebaseToken: body.firebaseToken, registrationToken: body.registrationToken, otp: body.otp, purpose: 'auth' });
  if (!proof.ok) {
    // Keep the OTP layer's extra fields (attemptsLeft on OTP_INVALID, retryAfter, ...) for the app.
    const { code: pc, message: pm, ...extra } = proof.body || {};
    if (pc === 'OTP_LOCKED' && extra.attemptsLeft === undefined) extra.attemptsLeft = 0;
    throw fail(proof.status || 400, pc || 'PHONE_VERIFICATION_REQUIRED', pm || 'Please verify your mobile number.', Object.keys(extra).length ? extra : undefined);
  }
  let driver;
  try {
    // C4: { acceptTerms: true, termsVersion } from the sign-up screen is recorded; older builds without it still sign up.
    const consent = await require('../../../utils/legalSettings').consentFromBody(body);
    driver = await Driver().create({
      name, phone, password: await bcrypt.hash(password, 10), status: E.DRIVER_STATUS.PENDING_DOCS, tokenVersion: 0, lastLoginAt: clock.now(),
      ...consent,
    });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'PHONE_TAKEN', 'A driver account already uses this number. Sign in instead.');
    throw err;
  }
  require('../services/notify').admin('auto_driver', 'created', driver.id);
  res.status(201).json({ token: signDriverToken(driver), driver: S.driverSelf(req, driver) });
};

// POST /api/auto-ride/driver/auth/login { phone, password }
const login = async (req, res) => {
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!MOBILE_RE.test(phone) || !password) throw fail(400, 'INVALID_INPUT', 'Enter your mobile number and password.');
  const driver = await Driver().findOne({ where: { phone } });
  const ok = driver ? await bcrypt.compare(password, driver.password) : await bcrypt.compare(password, dummyHash());
  if (!driver || !ok) throw fail(401, 'INVALID_CREDENTIALS', 'Wrong mobile number or password.');
  if (driver.status === E.DRIVER_STATUS.SUSPENDED) {
    throw fail(403, 'DRIVER_SUSPENDED', driver.suspendedReason ? `Your driver account is suspended: ${driver.suspendedReason}` : 'Your driver account is suspended. Please contact Zenvy support.');
  }
  await driver.update({ lastLoginAt: clock.now() });
  res.json({ token: signDriverToken(driver), driver: S.driverSelf(req, driver) });
};

// POST /api/auto-ride/driver/auth/refresh   (protectDriver)
const refresh = async (req, res) => res.json({ token: signDriverToken(req.driver), driver: S.driverSelf(req, req.driver) });

// POST /api/auto-ride/driver/auth/password { currentPassword, newPassword }
const changePassword = async (req, res) => {
  const body = req.body || {};
  const d = req.driver;
  if (!(await bcrypt.compare(String(body.currentPassword || ''), d.password))) throw fail(401, 'INVALID_CREDENTIALS', 'Your current password is wrong.');
  const pw = checkPassword(body.newPassword);
  await d.update({ password: await bcrypt.hash(pw, 10), tokenVersion: (Number(d.tokenVersion) || 0) + 1 });
  try { require('../../../utils/realtime').disconnectRevokedSockets(d.id, d.tokenVersion); } catch { /* sockets drop on reconnect */ }
  res.json({ token: signDriverToken(d), message: 'Password changed. Other devices were signed out.' });
};

// POST /api/auto-ride/driver/fcm-token { token }  /  POST /fcm-token/remove { token }
const saveFcmToken = async (req, res) => {
  const token = cleanFcmToken((req.body || {}).token);
  if (!token) throw fail(400, 'INVALID_INPUT', 'Invalid device token.', { field: 'token' });
  const d = req.driver;
  const list = (Array.isArray(d.fcmTokens) ? d.fcmTokens : []).filter((t) => t !== token);
  list.push(token);
  await d.update({ fcmTokens: list.slice(-5) });
  res.json({ ok: true });
};
const removeFcmToken = async (req, res) => {
  const token = cleanFcmToken((req.body || {}).token);
  const d = req.driver;
  await d.update({ fcmTokens: (Array.isArray(d.fcmTokens) ? d.fcmTokens : []).filter((t) => t !== token) });
  res.json({ ok: true });
};

module.exports = { register, login, refresh, changePassword, saveFcmToken, removeFcmToken, checkPassword, MOBILE_RE };
