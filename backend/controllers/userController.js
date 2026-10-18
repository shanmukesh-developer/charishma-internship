const crypto = require('crypto');
const { getUserModel } = require('../models/User');
const { getOtpCodeModel } = require('../models/OtpCode');
const jwt = require('jsonwebtoken');
const admin = require('../config/firebase'); // eslint-disable-line no-unused-vars -- initialises Firebase Admin
const { getAuth } = require('firebase-admin/auth');
const { normalizePhone } = require('../utils/phoneUtils');
const pgLock = require('../utils/pgLock');
const legalSettings = require('../utils/legalSettings');

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL = /^\d+[smhd]$/.test(String(process.env.ADMIN_SESSION_TTL || '')) ? process.env.ADMIN_SESSION_TTL : '12h';

// `tv` = tokenVersion: a password change bumps it and protect() rejects older sessions.
const generateToken = (id, role, tokenVersion = 0) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[AUTH_FATAL] JWT_SECRET is not configured.');
    return null;
  }
  // Admin sessions are short (admin-7): a leaked dashboard token is useless after ADMIN_SESSION_TTL
  // (default 12 h) instead of 30 days. Customers keep 30-day phone sessions.
  const isAdminRole = String(role || '').toLowerCase() === 'admin';
  return jwt.sign({ id, role, tv: Number(tokenVersion) || 0 }, secret, { expiresIn: isAdminRole ? ADMIN_SESSION_TTL : '30d' });
};

// Indian mobile numbers only (10 digits, starting 6-9)
const isValidMobile = (p) => typeof p === 'string' && /^[6-9]\d{9}$/.test(p);
const maskPhone = (p) => (p ? `******${String(p).slice(-4)}` : '');

const generateFriendCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(crypto.randomInt(chars.length));
  return 'ZNV-' + code;
};

const ensureFriendCode = async (user) => {
  if (!user.friendCode) {
    user.friendCode = generateFriendCode();
    await user.save();
  }
};

// Random unguessable password for accounts that sign in with OTP / Google only.
const randomPassword = () => crypto.randomBytes(24).toString('base64url');

/**
 * The ONLY shape in which a user is ever returned by auth/profile endpoints.
 * Never includes the password hash, fcmTokens, googleId or other internals.
 */
// Next order-count badge from BadgeService (the Profile progress bar reads this instead of its own copy).
const nextOrderBadge = (completedOrders) => {
  const { BADGE_CRITERIA } = require('../services/BadgeService');
  const list = BADGE_CRITERIA.ORDERS;
  const n = Number(completedOrders) || 0;
  const next = list.find((b) => n < b.threshold);
  const done = list.filter((b) => n >= b.threshold);
  return {
    nextBadge: next ? { name: next.name, threshold: next.threshold, tier: next.tier, category: 'ORDERS' } : null,
    previousBadgeThreshold: done.length ? done[done.length - 1].threshold : 0,
  };
};

const sanitizeUser = (user) => {
  if (!user) return null;
  return {
    ...nextOrderBadge(user.completedOrders),
    _id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email || '',
    about: user.about || '',
    hostelBlock: user.hostelBlock || null,
    roomNumber: user.roomNumber || null,
    role: user.role || 'student',
    walletBalance: user.walletBalance || 0,
    zenPoints: user.zenPoints || 0,
    karmaPoints: user.karmaPoints || 0,
    streakCount: require('../middleware/rewardEngine').effectiveStreak(user),
    totalOrders: user.totalOrders || 0,
    completedOrders: user.completedOrders || 0,
    isElite: user.isElite || false,
    address: user.address || '',
    city: user.city || 'Amaravathi',
    profileImage: user.profileImage || null,
    badges: user.badges || [],
    dietaryPreference: user.dietaryPreference || 'None',
    gender: user.gender || 'Prefer not to say',
    genderPreference: user.genderPreference || 'Any',
    friendCode: user.friendCode || null,
    referralCode: user.referralCode || null,
    statusText: user.statusText || null,
    statusEmoji: user.statusEmoji || null,
    statusSeenBy: user.statusSeenBy || [],
    googleLinked: !!user.googleId,
    termsAcceptedVersion: user.termsAcceptedVersion || null,
    termsAcceptedAt: user.termsAcceptedAt || null,
    createdAt: user.createdAt
  };
};

const setSessionCookie = (res, token) => {
  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: SESSION_COOKIE_MAX_AGE
  });
};

// C4: { termsCurrentVersion, termsUpdateRequired } next to the user; a settings read failure never blocks sign-in.
const legalStatus = async (user) => {
  try {
    const s = await legalSettings.getSettings();
    const { termsCurrentVersion, termsUpdateRequired } = legalSettings.acceptanceStatus(user, s);
    return { termsCurrentVersion, termsUpdateRequired };
  } catch {
    return {};
  }
};

/** Issues a session for `user` and sends `{ ...sanitizeUser(user), token }`. */
const sendSession = async (res, user, status = 200, { skipCookie = false } = {}) => {
  if (user.isActive === false) {
    return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Please contact Zenvy support.' });
  }
  await ensureFriendCode(user);
  const token = generateToken(user.id, user.role, user.tokenVersion);
  if (!token) return res.status(500).json({ message: 'Server configuration error. Please try again later.' });
  if (!skipCookie) {
    if (String(user.role || '').toLowerCase() === 'admin') {
      // Cookie never outlives the (short) admin token.
      const decoded = jwt.decode(token);
      const maxAge = decoded && decoded.exp ? Math.max(0, decoded.exp * 1000 - Date.now()) : SESSION_COOKIE_MAX_AGE;
      res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge });
    } else {
      setSessionCookie(res, token);
    }
  }
  return res.status(status).json({ ...sanitizeUser(user), ...(await legalStatus(user)), token });
};

// ── Phone-verified registration token ───────────────────────────────────────
// Short-lived proof that the caller owns `phone` (issued after a successful OTP
// check for a number that has no account yet). Signed with a derived secret so
// it can never be accepted as a session token by `protect` or the sockets.
const REGISTRATION_TOKEN_TTL = '15m';
const registrationSecret = () => (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}:phone-verified` : null);

const signRegistrationToken = (phone) => {
  const secret = registrationSecret();
  if (!secret) return null;
  return jwt.sign({ purpose: 'register', phone }, secret, { expiresIn: REGISTRATION_TOKEN_TTL });
};

const verifyRegistrationToken = (token) => {
  const secret = registrationSecret();
  if (!secret || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token, secret);
    return decoded && decoded.purpose === 'register' && decoded.phone ? decoded.phone : null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SMS OTP (Fast2SMS) — codes are persisted only as an HMAC
// ─────────────────────────────────────────────────────────────────────────────

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_DAILY_CAP = Math.max(1, parseInt(process.env.OTP_DAILY_CAP, 10) || 8);
const OTP_PURPOSES = {
  auth: 'auth', login: 'auth', register: 'auth', link_google: 'auth',
  reset_password: 'reset_password', reset: 'reset_password',
  change_phone: 'change_phone',
  delete_account: 'delete_account' // re-authentication before POST /api/users/account/delete
};

const normalizePurpose = (p) => (p === undefined || p === null || p === '' ? 'auth' : OTP_PURPOSES[String(p)] || null);

const otpSecret = () => process.env.OTP_SECRET || process.env.JWT_SECRET || null;

const hashOtp = (phone, purpose, code) =>
  crypto.createHmac('sha256', otpSecret()).update(`${phone}:${purpose}:${code}`).digest('hex');

const safeEqualHex = (a, b) => {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

let otpTableReady = false;
const getOtpModel = async () => {
  const OtpCode = getOtpCodeModel();
  if (!OtpCode) throw new Error('OtpCode model not initialised');
  if (!otpTableReady) {
    await OtpCode.sync(); // creates the table if a startup alter-sync was skipped; no-op otherwise
    otpTableReady = true;
  }
  return OtpCode;
};

/** Sends the code through Fast2SMS. Resolves { ok, reason }. Never logs the code. */
const sendSmsOtp = async (phone, code) => {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return { ok: false, reason: 'FAST2SMS_API_KEY missing' };
  try {
    // API key in the `authorization` header (Fast2SMS documents it for GET too), not the query
    // string, so it never lands in proxy / provider access logs.
    const url = 'https://www.fast2sms.com/dev/bulkV2'
      + `?route=otp&variables_values=${encodeURIComponent(code)}&numbers=${encodeURIComponent(phone)}`;
    const smsRes = await fetch(url, { headers: { authorization: apiKey }, signal: AbortSignal.timeout(10000) });
    const smsData = await smsRes.json().catch(() => ({}));
    if (smsData && smsData.return === true) return { ok: true };
    return { ok: false, reason: (smsData && (smsData.message || smsData.status_code)) || `HTTP ${smsRes.status}` };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
};

/**
 * Checks `otp` against the latest live code for phone+purpose and consumes it.
 * Resolves { ok: true } or { ok: false, status, body }.
 */
const consumeOtp = async (phone, purpose, otp) => {
  const code = typeof otp === 'string' || typeof otp === 'number' ? String(otp).trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, status: 400, body: { code: 'OTP_INVALID', message: 'Enter the 6-digit code we sent you by SMS.' } };
  }
  if (!otpSecret()) {
    return { ok: false, status: 500, body: { message: 'Server configuration error. Please try again later.' } };
  }
  const OtpCode = await getOtpModel();
  const record = await OtpCode.findOne({
    where: { phone, purpose, consumedAt: null },
    order: [['createdAt', 'DESC']]
  });
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    return { ok: false, status: 400, body: { code: 'OTP_EXPIRED', message: 'This code has expired. Tap "Resend" to get a new one.' } };
  }
  // Reserve one attempt atomically BEFORE comparing: parallel guesses cannot all read the same
  // count and slip past the limit (only OTP_MAX_ATTEMPTS conditional increments can succeed).
  const { Op: OpA, literal } = require('sequelize');
  const [reserved] = await OtpCode.update(
    { attempts: literal('COALESCE("attempts", 0) + 1') },
    { where: { id: record.id, consumedAt: null, [OpA.or]: [{ attempts: null }, { attempts: { [OpA.lt]: OTP_MAX_ATTEMPTS } }] } }
  );
  if (!reserved) {
    return { ok: false, status: 429, body: { code: 'OTP_LOCKED', message: 'Too many wrong attempts. Please request a new code.' } };
  }

  if (!safeEqualHex(record.codeHash, hashOtp(phone, purpose, code))) {
    const fresh = await OtpCode.findByPk(record.id, { attributes: ['attempts'] });
    const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - (Number(fresh && fresh.attempts) || OTP_MAX_ATTEMPTS));
    if (attemptsLeft === 0) {
      await OtpCode.update({ consumedAt: new Date() }, { where: { id: record.id } });
      return { ok: false, status: 429, body: { code: 'OTP_LOCKED', message: 'Too many wrong attempts. Please request a new code.' } };
    }
    return {
      ok: false,
      status: 400,
      body: { code: 'OTP_INVALID', attemptsLeft, message: `That code doesn't match. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` }
    };
  }

  // Single use: only one concurrent request can flip consumedAt from NULL.
  const [updated] = await OtpCode.update({ consumedAt: new Date() }, { where: { id: record.id, consumedAt: null } });
  if (!updated) {
    return { ok: false, status: 400, body: { code: 'OTP_EXPIRED', message: 'This code was already used. Please request a new one.' } };
  }
  return { ok: true };
};

/**
 * Proves the caller owns `phone` using ONE of:
 *   firebaseToken      (Firebase phone-auth ID token, verified with Firebase Admin)
 *   registrationToken  (issued by POST /verify-otp for a number without an account)
 *   otp                (Fast2SMS code from POST /send-otp with the same purpose)
 * Resolves { ok: true, method } or { ok: false, status, body }.
 */
const verifyPhoneProof = async ({ phone, firebaseToken, registrationToken, otp, purpose = 'auth' }) => {
  if (firebaseToken) {
    try {
      const decoded = await getAuth().verifyIdToken(firebaseToken);
      if (!decoded.phone_number || normalizePhone(decoded.phone_number) !== phone) {
        return { ok: false, status: 401, body: { code: 'PHONE_MISMATCH', message: 'The verified number does not match the number you entered.' } };
      }
      return { ok: true, method: 'firebase' };
    } catch (err) {
      console.warn('[PHONE_PROOF_FIREBASE_ERR]', err.code || err.message);
      return { ok: false, status: 401, body: { code: 'VERIFICATION_EXPIRED', message: 'Your verification has expired. Please verify your number again.' } };
    }
  }
  if (registrationToken) {
    const verifiedPhone = verifyRegistrationToken(registrationToken);
    if (!verifiedPhone) {
      return { ok: false, status: 401, body: { code: 'VERIFICATION_EXPIRED', message: 'Your verification has expired. Please verify your number again.' } };
    }
    if (verifiedPhone !== phone) {
      return { ok: false, status: 401, body: { code: 'PHONE_MISMATCH', message: 'The verified number does not match the number you entered.' } };
    }
    return { ok: true, method: 'registrationToken' };
  }
  if (otp !== undefined && otp !== null && otp !== '') {
    const result = await consumeOtp(phone, purpose, otp);
    return result.ok ? { ok: true, method: 'otp' } : result;
  }
  return { ok: false, status: 400, body: { code: 'PHONE_VERIFICATION_REQUIRED', message: 'Please verify your mobile number with the OTP first.' } };
};

/** Verifies a Google sign-in token (Firebase Google ID token or native Google ID token). */
const verifyGoogleToken = async (idToken) => {
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    const provider = decoded.firebase && decoded.firebase.sign_in_provider;
    if (provider !== 'google.com') {
      const err = new Error('Not a Google sign-in token');
      err.code = 'NOT_GOOGLE';
      throw err;
    }
    const identities = (decoded.firebase && decoded.firebase.identities) || {};
    const googleSub = Array.isArray(identities['google.com']) ? identities['google.com'][0] : null;
    return {
      ids: [googleSub, decoded.uid].filter(Boolean),
      googleId: googleSub || decoded.uid,
      email: decoded.email ? String(decoded.email).toLowerCase() : null,
      emailVerified: decoded.email_verified === true,
      name: decoded.name || null,
      picture: decoded.picture || null
    };
  } catch (firebaseErr) {
    if (firebaseErr.code === 'NOT_GOOGLE') throw firebaseErr;
    // Native Google Sign-In returns a Google OAuth ID token, not a Firebase token
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: [
        '785490473159-8u6m41d2u27icc02719pbdluouukru3t.apps.googleusercontent.com', // Web Client ID
        '785490473159-fv6irlncd2qtjhbj0neceo8sovot2gtr.apps.googleusercontent.com'  // Android Client ID
      ]
    });
    const payload = ticket.getPayload();
    return {
      ids: [payload.sub],
      googleId: payload.sub,
      email: payload.email ? String(payload.email).toLowerCase() : null,
      emailVerified: payload.email_verified === true,
      name: payload.name || null,
      picture: payload.picture || null
    };
  }
};

const cleanName = (name) => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 60) : '');
const cleanEmailInput = (email) => {
  if (typeof email !== 'string' || !email.trim()) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined; // undefined = invalid
};

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

// @desc    Register a new user (phone must be verified)
// @route   POST /api/users/register
const registerUser = async (req, res) => {
  const { phone, password, hostelBlock, roomNumber, otp, firebaseToken, registrationToken, email, referralCode } = req.body;

  try {
    const cleanPhone = normalizePhone(phone);
    if (!isValidMobile(cleanPhone)) {
      return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
    }
    const name = cleanName(req.body.name);
    if (name.length < 2) {
      return res.status(400).json({ code: 'INVALID_NAME', message: 'Please enter your name (at least 2 letters).' });
    }
    const cleanEmail = cleanEmailInput(email);
    if (cleanEmail === undefined) {
      return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Please enter a valid email address, or leave it blank.' });
    }

    const User = getUserModel();

    // Cheap checks first so a mistake never burns the user's OTP
    if (await User.findOne({ where: { phone: cleanPhone } })) {
      return res.status(409).json({ code: 'PHONE_TAKEN', message: 'This number already has a Zenvy account. Please log in instead.' });
    }
    if (cleanEmail && await User.findOne({ where: { email: cleanEmail } })) {
      return res.status(409).json({ code: 'EMAIL_TAKEN', message: 'This email is already linked to another Zenvy account. Use a different one or leave it blank.' });
    }
    const cleanReferral = typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';
    if (cleanReferral && !(await User.findOne({ where: { referralCode: cleanReferral } }))) {
      return res.status(400).json({ code: 'INVALID_REFERRAL', message: "That referral code doesn't exist. Check it or leave it blank." });
    }

    // ── Phone verification (Firebase token, registration token, or SMS OTP) ──
    const proof = await verifyPhoneProof({ phone: cleanPhone, firebaseToken, registrationToken, otp, purpose: 'auth' });
    if (!proof.ok) return res.status(proof.status).json(proof.body);

    // C4: { acceptTerms: true, termsVersion } is recorded on the new account. Older app builds that do not
    // send it still register; they are asked once after sign-in (termsUpdateRequired).
    const consent = await legalSettings.consentFromBody(req.body);

    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();

    let createdUser;
    await sequelize.transaction(async (t) => {
      const userExists = await User.findOne({ where: { phone: cleanPhone }, transaction: t, lock: true });
      if (userExists) {
        const err = new Error('PHONE_TAKEN');
        err.code = 'PHONE_TAKEN';
        throw err;
      }

      const referrer = cleanReferral
        ? await User.findOne({ where: { referralCode: cleanReferral }, transaction: t, lock: true })
        : null;

      const user = await User.create({
        ...consent,
        name,
        phone: cleanPhone,
        email: cleanEmail || null,
        password: typeof password === 'string' && password.length >= 6 ? password : randomPassword(),
        hostelBlock: hostelBlock || null,
        roomNumber: roomNumber || null,
        zenPoints: referrer ? 50 : 0,
        referredBy: referrer ? referrer.referralCode : null
      }, { transaction: t });

      if (referrer) {
        referrer.zenPoints = (referrer.zenPoints || 0) + 50;
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        await referrer.save({ transaction: t });
      }

      createdUser = user;
    });

    // Don't overwrite an admin's session cookie when a live admin registers someone (DB role,
    // never the token's role claim).
    const skipCookie = await require('../middleware/authMiddleware').isLiveAdminRequest(req);

    console.log(`[REGISTER] New account for ${maskPhone(cleanPhone)} via ${proof.method}`);
    return sendSession(res, createdUser, 201, { skipCookie });
  } catch (error) {
    if (error.code === 'PHONE_TAKEN') {
      return res.status(409).json({ code: 'PHONE_TAKEN', message: 'This number already has a Zenvy account. Please log in instead.' });
    }
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ code: 'ALREADY_EXISTS', message: 'An account with these details already exists. Please log in instead.' });
    }
    console.error('[USER_REGISTER_ERROR]', error);
    res.status(500).json({ message: "We couldn't create your account right now. Please try again." });
  }
};

// @desc    Auth user & get token (password, or Firebase phone token)
// @route   POST /api/users/login
const authUser = async (req, res) => {
  const { phone, password, firebaseToken } = req.body;
  try {
    const User = getUserModel();
    const cleanPhone = normalizePhone(phone);
    const user = cleanPhone ? await User.findOne({ where: { phone: cleanPhone } }) : null;

    if (firebaseToken) {
      if (!isValidMobile(cleanPhone)) {
        return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
      }
      const proof = await verifyPhoneProof({ phone: cleanPhone, firebaseToken });
      if (!proof.ok) return res.status(proof.status).json(proof.body);

      if (!user) {
        // Verified number without an account: let the app collect the name, no second OTP.
        return res.json({
          isNewUser: true,
          phone: cleanPhone,
          registrationToken: signRegistrationToken(cleanPhone),
          message: 'Number verified! Tell us your name to create your Zenvy account.'
        });
      }
      return sendSession(res, user);
    }

    if (!password) {
      return res.status(400).json({ message: 'Please enter your password, or log in with OTP.' });
    }
    if (!user) {
      return res.status(401).json({ code: 'ACCOUNT_NOT_FOUND', message: 'No Zenvy account uses this number. Create one to get started.' });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }
    return sendSession(res, user);
  } catch (error) {
    console.error('[AUTH_ERROR]', error);
    res.status(500).json({ message: 'Login failed due to a server error. Please try again.' });
  }
};

// @desc    Save FCM Token for this device
// @route   POST /api/users/fcm-token
const saveFcmToken = async (req, res) => {
  const { cleanFcmToken, cleanAppVersion, cleanPlatform } = require('../utils/fcmToken');
  const fcmToken = cleanFcmToken((req.body || {}).fcmToken);
  const appVersion = cleanAppVersion((req.body || {}).appVersion);
  const platform = cleanPlatform((req.body || {}).platform);
  const userId = req.user.id;

  if (!fcmToken) {
    return res.status(400).json({ message: 'A valid fcmToken is required' });
  }

  try {
    const User = getUserModel();
    const user = await User.findByPk(userId);
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });

    // One entry per device token (a user can have several phones); newest first, max 5.
    // Older builds stored plain token strings: keep them (as objects) instead of dropping other devices.
    const existing = (Array.isArray(user.fcmTokens) ? user.fcmTokens : [])
      .map(t => (typeof t === 'string' ? { token: t } : t))
      .filter(t => t && t.token && t.token !== fcmToken);
    user.fcmTokens = [
      { token: fcmToken, appVersion: appVersion || null, platform: platform || null, updatedAt: new Date().toISOString() },
      ...existing
    ].slice(0, 5);
    await user.save();

    // A device belongs to whoever is signed in on it now: detach it from every other account
    try {
      const { Op } = require('sequelize');
      const others = await User.findAll({ where: { id: { [Op.ne]: userId }, fcmTokens: { [Op.like]: require('../utils/fcmToken').tokenLikePattern(fcmToken) } } });
      for (const other of others) {
        const list = Array.isArray(other.fcmTokens) ? other.fcmTokens : [];
        const filtered = list.filter(t => t && (typeof t === 'string' ? t : t.token) !== fcmToken);
        if (filtered.length !== list.length) {
          other.fcmTokens = filtered;
          await other.save();
        }
      }
    } catch (e) {
      console.warn('[FCM_DEDUPE]', e.message);
    }

    res.json({ message: 'FCM Token saved' });
  } catch (error) {
    console.error('[FCM_ERROR]', error);
    res.status(500).json({ message: 'Failed to save token' });
  }
};

// @desc    Remove this device's FCM token (call on logout)
// @route   DELETE /api/users/fcm-token   (also POST /api/users/fcm-token/remove)
const removeFcmToken = async (req, res) => {
  try {
    const { fcmToken, appVersion } = req.body || {};
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.json({ message: 'ok', removed: 0 });
    const list = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
    let filtered;
    if (fcmToken) filtered = list.filter(t => t && (typeof t === 'string' ? t : t.token) !== fcmToken);
    else if (appVersion) filtered = list.filter(t => t && t.appVersion !== appVersion);
    else return res.status(400).json({ message: 'fcmToken is required' });
    user.fcmTokens = filtered;
    await user.save();
    res.json({ message: 'FCM Token removed', removed: list.length - filtered.length });
  } catch (error) {
    console.error('[FCM_REMOVE_ERROR]', error);
    res.status(500).json({ message: 'Failed to remove token' });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
const getUserProfile = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });
    await ensureFriendCode(user);
    res.json({ ...sanitizeUser(user), ...(await legalStatus(user)) });
  } catch (error) {
    console.error('[PROFILE_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
const updateUserProfile = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });

    // Cheap field checks first, so nothing (an OTP for a phone change included) is used up on a bad form.
    const PROFILE_LIMITS = { about: [160, 'Your bio'], address: [200, 'Your address'], city: [60, 'City'],
      hostelBlock: [60, 'Hostel block'], roomNumber: [20, 'Room number'], statusText: [140, 'Your status'] };
    for (const [field, [max, label]] of Object.entries(PROFILE_LIMITS)) {
      const v = req.body[field];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string') return res.status(400).json({ code: 'INVALID_FIELD', field, message: `${label} must be text.` });
      if (v.trim().length > max) return res.status(400).json({ code: 'FIELD_TOO_LONG', field, max, message: `${label} can be at most ${max} characters.` });
    }
    const DIET_OPTIONS = ['None', 'Veg', 'Eggetarian', 'Non-Veg'];
    if (req.body.dietaryPreference !== undefined) {
      const diet = DIET_OPTIONS.find((d) => d.toLowerCase() === String(req.body.dietaryPreference || '').trim().toLowerCase());
      if (!diet) return res.status(400).json({ code: 'INVALID_DIET', field: 'dietaryPreference', message: 'Pick None, Veg, Eggetarian or Non-Veg.' });
      user.dietaryPreference = diet;
    }

    if (req.body.name !== undefined) {
      const name = cleanName(req.body.name);
      if (name.length < 2) return res.status(400).json({ code: 'INVALID_NAME', message: 'Please enter your name (at least 2 letters).' });
      user.name = name;
    }

    // Phone is the login identity: changing it requires proof of owning the NEW number
    if (req.body.phone && typeof req.body.phone === 'string') {
      const cleanPhone = normalizePhone(req.body.phone);
      if (cleanPhone && cleanPhone !== user.phone) {
        if (!isValidMobile(cleanPhone)) {
          return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
        }
        const existing = await User.findOne({ where: { phone: cleanPhone } });
        if (existing && existing.id !== user.id) {
          return res.status(409).json({ code: 'PHONE_TAKEN', message: 'This phone number is already registered to another user.' });
        }
        const proof = await verifyPhoneProof({
          phone: cleanPhone,
          firebaseToken: req.body.firebaseToken,
          otp: req.body.otp,
          purpose: 'change_phone'
        });
        if (!proof.ok) {
          if (proof.body.code === 'PHONE_VERIFICATION_REQUIRED') {
            proof.body.message = 'Verify your new number with the OTP we send to it before saving.';
          }
          return res.status(proof.status).json(proof.body);
        }
        user.phone = cleanPhone;
      }
    }

    if (req.body.email !== undefined) {
      const cleanEmail = cleanEmailInput(req.body.email);
      if (cleanEmail === undefined) {
        return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Please enter a valid email address, or leave it blank.' });
      }
      if (cleanEmail !== (user.email || null)) {
        if (cleanEmail) {
          const existing = await User.findOne({ where: { email: cleanEmail } });
          if (existing && existing.id !== user.id) {
            return res.status(409).json({ code: 'EMAIL_TAKEN', message: 'This email address is already registered to another user.' });
          }
        }
        user.email = cleanEmail;
      }
    }
    // Free-text fields are bounded (a 10 MB JSON body used to land in the row as is).
    const trimmed = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : (v === null ? null : undefined));
    if (req.body.statusText !== undefined) user.statusText = trimmed(req.body.statusText);
    if (req.body.statusEmoji !== undefined) user.statusEmoji = trimmed(req.body.statusEmoji, 16);
    if (req.body.about !== undefined) user.about = trimmed(req.body.about);
    if (req.body.hostelBlock !== undefined) user.hostelBlock = trimmed(req.body.hostelBlock);
    if (req.body.roomNumber !== undefined) user.roomNumber = trimmed(req.body.roomNumber);
    if (req.body.address !== undefined) user.address = trimmed(req.body.address);
    if (req.body.city !== undefined) user.city = trimmed(req.body.city);
    if (req.body.profileImage !== undefined) {
      // Only a media URL / hosted https image; inline base64 is moved to the media table.
      const { storeImageRef, sendImageError } = require('../utils/imageStore');
      const img = await storeImageRef(req.body.profileImage, { req, ownerId: user.id, purpose: 'avatar', maxBytes: 2 * 1024 * 1024 });
      if (!img.ok) return sendImageError(res, img);
      user.profileImage = img.value;
    }
    if (req.body.gender !== undefined) user.gender = trimmed(req.body.gender, 40);
    if (req.body.genderPreference !== undefined) user.genderPreference = trimmed(req.body.genderPreference, 40);

    await user.save();
    // protect() caches name / phone / email / hostel for 60 s: drop it so the next request (an
    // order, a wish, a friend request) uses the new details at once.
    require('../middleware/authMiddleware').clearCachedUser(user.id);
    // The session token is NOT re-issued here: the app keeps its SecureStore token.
    res.json(sanitizeUser(user));
  } catch (error) {
    console.error('[UPDATE_PROFILE_ERROR]', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ message: 'These details are already used by another account.' });
    }
    res.status(500).json({ message: "We couldn't save your profile right now. Please try again." });
  }
};

// @desc    Reset password after verifying the phone (Firebase token or SMS OTP)
// @route   POST /api/users/reset-password
const resetPassword = async (req, res) => {
  const { phone, firebaseToken, otp, newPassword } = req.body;

  if (!phone || (!firebaseToken && !otp) || !newPassword) {
    return res.status(400).json({ message: 'Phone, verification code and new password are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const cleanPhone = normalizePhone(phone);
    if (!isValidMobile(cleanPhone)) {
      return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
    }
    const User = getUserModel();
    const user = await User.findOne({ where: { phone: cleanPhone } });
    if (!user) {
      return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Account not found with this phone number.' });
    }

    const proof = await verifyPhoneProof({ phone: cleanPhone, firebaseToken, otp, purpose: 'reset_password' });
    if (!proof.ok) return res.status(proof.status).json(proof.body);

    user.password = newPassword; // hashed by the model's beforeUpdate hook (also bumps tokenVersion)
    await user.save();
    // Every session signed before the reset (including a stolen token) is now revoked.
    require('../middleware/authMiddleware').clearCachedUser(user.id);
    // ...and so is every live socket opened with one of those tokens.
    require('../utils/realtime').disconnectRevokedSockets(user.id, user.tokenVersion);

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('[RESET_PASSWORD_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const findUserByGoogle = async (User, google) => {
  const { Op } = require('sequelize');
  return User.findOne({ where: { googleId: { [Op.in]: google.ids } } });
};

// @desc    Google sign-in (existing linked accounts)
// @route   POST /api/users/google-login
const googleLogin = async (req, res) => {
  const { firebaseToken } = req.body;
  if (!firebaseToken) return res.status(400).json({ message: 'Google token required' });

  let google;
  try {
    google = await verifyGoogleToken(firebaseToken);
  } catch (error) {
    console.warn('[GOOGLE_LOGIN_VERIFY_ERR]', error.code || error.message);
    return res.status(401).json({ message: 'Google sign-in could not be verified. Please try again.' });
  }

  try {
    const User = getUserModel();
    const user = await findUserByGoogle(User, google);
    // Older Google sign-ups were given a placeholder number: they must verify a real one once.
    if (user && isValidMobile(user.phone)) return sendSession(res, user);

    // No account linked to this Google identity yet. Every Zenvy account needs a
    // verified mobile number (riders call it), so finish via POST /api/users/google-complete.
    return res.json({
      needsPhone: true,
      isNewUser: true,
      name: google.name || '',
      email: google.email || '',
      message: 'Almost there! Verify your mobile number to finish signing in with Google.'
    });
  } catch (error) {
    console.error('[GOOGLE_LOGIN_ERROR]', error);
    res.status(500).json({ message: 'Google sign-in failed due to a server error. Please try again.' });
  }
};

// @desc    Finish Google sign-in: verify phone, then link to the existing phone
//          account or create a new account
// @route   POST /api/users/google-complete
const googleComplete = async (req, res) => {
  const { googleToken, phone, firebaseToken, registrationToken, otp, password } = req.body || {};
  if (!googleToken) return res.status(400).json({ message: 'Google token required' });

  let google;
  try {
    google = await verifyGoogleToken(googleToken);
  } catch (error) {
    console.warn('[GOOGLE_COMPLETE_VERIFY_ERR]', error.code || error.message);
    return res.status(401).json({ message: 'Google sign-in could not be verified. Please try again.' });
  }

  try {
    const cleanPhone = normalizePhone(phone);
    if (!isValidMobile(cleanPhone)) {
      return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
    }

    const User = getUserModel();
    const linked = await findUserByGoogle(User, google);
    const phoneUser = await User.findOne({ where: { phone: cleanPhone } });

    const linkedHasRealPhone = linked && isValidMobile(linked.phone);
    if (linked && !linkedHasRealPhone && phoneUser && phoneUser.id !== linked.id) {
      return res.status(409).json({ code: 'PHONE_TAKEN', message: 'This number already has a Zenvy account. Log in with it using OTP or password.' });
    }
    if (linkedHasRealPhone && linked.phone !== cleanPhone) {
      return res.status(409).json({ code: 'GOOGLE_ALREADY_LINKED', message: 'This Google account is already linked to a different mobile number.' });
    }
    if (phoneUser && phoneUser.googleId && !google.ids.includes(phoneUser.googleId)) {
      return res.status(409).json({ code: 'PHONE_LINKED_TO_OTHER_GOOGLE', message: 'This number is already linked to a different Google account.' });
    }
    const name = cleanName(req.body.name) || cleanName(google.name);
    if (!phoneUser && !linked && name.length < 2) {
      return res.status(400).json({ code: 'INVALID_NAME', message: 'Please enter your name (at least 2 letters).' });
    }

    const proof = await verifyPhoneProof({ phone: cleanPhone, firebaseToken, registrationToken, otp, purpose: 'auth' });
    if (!proof.ok) return res.status(proof.status).json(proof.body);

    const emailFree = google.email && google.emailVerified
      ? !(await User.findOne({ where: { email: google.email } }))
      : false;

    // C4: the finish screen shows the Terms box; a tick is recorded whether this links or creates.
    const consent = await legalSettings.consentFromBody(req.body);

    if (linked && !linkedHasRealPhone) {
      // Replace the old placeholder number with the verified one
      linked.phone = cleanPhone;
      Object.assign(linked, consent);
      await linked.save();
      return sendSession(res, linked);
    }

    if (phoneUser) {
      phoneUser.googleId = google.googleId;
      if (!phoneUser.email && emailFree) phoneUser.email = google.email;
      Object.assign(phoneUser, consent);
      await phoneUser.save();
      return sendSession(res, phoneUser);
    }

    const user = await User.create({
      ...consent,
      name,
      phone: cleanPhone,
      email: emailFree ? google.email : null,
      googleId: google.googleId,
      profileImage: google.picture || null,
      password: typeof password === 'string' && password.length >= 6 ? password : randomPassword(),
      role: 'student'
    });
    console.log(`[GOOGLE_COMPLETE] New account for ${maskPhone(cleanPhone)}`);
    return sendSession(res, user, 201);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ code: 'ALREADY_EXISTS', message: 'An account with these details already exists. Please log in instead.' });
    }
    console.error('[GOOGLE_COMPLETE_ERROR]', error);
    res.status(500).json({ message: 'Google sign-in failed due to a server error. Please try again.' });
  }
};

// @desc    Send a real SMS OTP (Fast2SMS)
// @route   POST /api/users/send-otp
const otpSendInFlight = new Set();
const sendOtp = async (req, res) => {
  let releaseOtpLock = () => {};
  try {
    const { phone } = req.body || {};
    const cleanPhone = normalizePhone(phone);
    if (!isValidMobile(cleanPhone)) {
      return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
    }
    const purpose = normalizePurpose(req.body.purpose);
    if (!purpose) {
      return res.status(400).json({ message: 'Invalid OTP purpose' });
    }
    if (!otpSecret()) {
      console.error('[SEND_OTP] Neither OTP_SECRET nor JWT_SECRET is configured');
      return res.status(500).json({ message: 'Server configuration error. Please try again later.' });
    }

    const User = getUserModel();
    if ((purpose === 'reset_password' || purpose === 'delete_account') && !(await User.findOne({ where: { phone: cleanPhone } }))) {
      return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'No Zenvy account uses this number.' });
    }
    if (purpose === 'change_phone' && await User.findOne({ where: { phone: cleanPhone } })) {
      return res.status(409).json({ code: 'PHONE_TAKEN', message: 'This number is already linked to another Zenvy account.' });
    }

    // One send at a time per phone: the cooldown / daily-cap checks below are read-then-create,
    // so a parallel burst could otherwise send many SMS to one number (SMS bombing, credit drain).
    if (otpSendInFlight.has(cleanPhone)) {
      res.set('Retry-After', String(Math.round(OTP_RESEND_COOLDOWN_MS / 1000)));
      return res.status(429).json({ code: 'OTP_COOLDOWN', retryAfter: Math.round(OTP_RESEND_COOLDOWN_MS / 1000), message: 'A code is already on its way. Please wait a moment.' });
    }
    otpSendInFlight.add(cleanPhone);
    releaseOtpLock = () => otpSendInFlight.delete(cleanPhone);

    const OtpCode = await getOtpModel();
    const { Op } = require('sequelize');
    const now = Date.now();
    const code = String(crypto.randomInt(100000, 1000000));

    // Cooldown + daily cap + create, for this phone one at a time across processes too (A2): on
    // Postgres under pg_advisory_xact_lock('otp:' + phone), committed before the SMS goes out, so
    // a parallel send on another process sees this row and gets the cooldown. SQLite / lock error:
    // the same statements without the lock (the in-process guard above).
    const reserveOtpSend = async (t) => {
      const tx = t ? { transaction: t } : {};
      // Per-phone resend cooldown
      const last = await OtpCode.findOne({ where: { phone: cleanPhone }, order: [['createdAt', 'DESC']], ...tx });
      if (last && now - new Date(last.createdAt).getTime() < OTP_RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - new Date(last.createdAt).getTime())) / 1000);
        return { refuse: { status: 429, retryAfter, body: { code: 'OTP_COOLDOWN', retryAfter, message: `Please wait ${retryAfter}s before requesting another code.` } } };
      }

      // Daily cap per phone (rolling 24h)
      const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const sentToday = await OtpCode.findAll({
        where: { phone: cleanPhone, createdAt: { [Op.gt]: dayAgo } },
        attributes: ['createdAt'],
        order: [['createdAt', 'ASC']],
        ...tx,
      });
      if (sentToday.length >= OTP_DAILY_CAP) {
        const oldest = new Date(sentToday[0].createdAt).getTime();
        const retryAfter = Math.max(60, Math.ceil((oldest + 24 * 60 * 60 * 1000 - now) / 1000));
        return { refuse: { status: 429, retryAfter, body: { code: 'OTP_DAILY_LIMIT', retryAfter, message: "You've requested too many codes today. Please try again later or log in with your password." } } };
      }

      if (!process.env.FAST2SMS_API_KEY) {
        console.error('[SEND_OTP] FAST2SMS_API_KEY is not configured');
        return { refuse: { status: 502, body: { code: 'SMS_UNAVAILABLE', message: "We couldn't send the SMS right now. Please try again in a minute or log in with your password." } } };
      }

      const record = await OtpCode.create({
        phone: cleanPhone,
        purpose,
        codeHash: hashOtp(cleanPhone, purpose, code),
        expiresAt: new Date(now + OTP_TTL_MS),
        ip: (req.ip || '').slice(0, 64) || null
      }, tx);
      return { record };
    };
    const reserved = await pgLock.withAdvisoryXactLock(OtpCode.sequelize, `otp:${cleanPhone}`, reserveOtpSend);
    if (reserved.refuse) {
      if (reserved.refuse.retryAfter !== undefined) res.set('Retry-After', String(reserved.refuse.retryAfter));
      return res.status(reserved.refuse.status).json(reserved.refuse.body);
    }
    const { record } = reserved;

    // Global daily SMS budget (C1-6, shared across processes): a flood of numbers past the per-phone
    // limits trips this circuit breaker instead of draining the SMS credit.
    const smsBudget = require('../utils/smsBudget');
    const budget = await smsBudget.reserve({ io: req.app && typeof req.app.get === 'function' ? req.app.get('io') : null });
    if (!budget.ok) {
      await record.destroy().catch(() => {});
      res.set('Retry-After', '3600');
      return res.status(503).json({ code: 'SMS_BUDGET', message: "We can't send SMS codes right now. Please log in with your password, or try again later." });
    }

    const sms = await sendSmsOtp(cleanPhone, code);
    if (!sms.ok) {
      await smsBudget.refund(budget.day);
      await record.destroy().catch(() => {});
      console.error(`[SEND_OTP] SMS provider failed for ${maskPhone(cleanPhone)}:`, sms.reason);
      return res.status(502).json({ code: 'SMS_UNAVAILABLE', message: "We couldn't send the SMS right now. Please try again in a minute or log in with your password." });
    }

    // The newest code supersedes older live codes for the same purpose
    await OtpCode.update(
      { consumedAt: new Date() },
      { where: { phone: cleanPhone, purpose, consumedAt: null, id: { [Op.ne]: record.id } } }
    ).catch(() => {});
    // Housekeeping: drop rows older than 2 days (fire and forget)
    OtpCode.destroy({ where: { createdAt: { [Op.lt]: new Date(now - 48 * 60 * 60 * 1000) } } }).catch(() => {});

    console.log(`[SEND_OTP] Code sent to ${maskPhone(cleanPhone)} (${purpose})`);
    res.json({
      success: true,
      message: `We've sent a 6-digit code to +91 ${cleanPhone}`,
      expiresIn: Math.round(OTP_TTL_MS / 1000),
      resendAfter: Math.round(OTP_RESEND_COOLDOWN_MS / 1000)
    });
  } catch (error) {
    console.error('[SEND_OTP_ERROR]', error.message);
    res.status(500).json({ message: "We couldn't send the code right now. Please try again." });
  } finally {
    releaseOtpLock();
  }
};

// @desc    Verify SMS OTP & log in (or hand back a registration token for new numbers)
// @route   POST /api/users/verify-otp
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body || {};
    const cleanPhone = normalizePhone(phone);
    if (!isValidMobile(cleanPhone)) {
      return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a valid 10-digit mobile number.' });
    }

    const result = await consumeOtp(cleanPhone, 'auth', otp);
    if (!result.ok) return res.status(result.status).json(result.body);

    const User = getUserModel();
    const user = await User.findOne({ where: { phone: cleanPhone } });
    if (!user) {
      return res.json({
        isNewUser: true,
        phone: cleanPhone,
        registrationToken: signRegistrationToken(cleanPhone),
        message: 'Number verified! Tell us your name to create your Zenvy account.'
      });
    }
    return sendSession(res, user);
  } catch (error) {
    console.error('[VERIFY_OTP_ERROR]', error.message);
    res.status(500).json({ message: "We couldn't verify the code right now. Please try again." });
  }
};

// @desc    Logout user & clear cookie (optionally unregisters this device's push token)
// @route   POST /api/users/logout
const logoutUser = async (req, res) => {
  // Best effort: if the caller is authenticated and sends its push token, detach it
  try {
    const { fcmToken } = req.body || {};
    let raw = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) raw = req.headers.authorization.split(' ')[1];
    else if (req.cookies?.token) raw = req.cookies.token;
    if (raw && process.env.JWT_SECRET) {
      const decoded = jwt.verify(raw.replace(/['"]+/g, '').trim(), process.env.JWT_SECRET);
      const User = getUserModel();
      const user = decoded && decoded.id ? await User.findByPk(decoded.id) : null;
      // Admin logout ends every admin session of this account (admin-7): bump tokenVersion only
      // when the presented token is still current, so a stale token cannot sign others out.
      if (user && String(user.role || '').toLowerCase() === 'admin'
        && (Number(decoded.tv) || 0) === (Number(user.tokenVersion) || 0)) {
        await User.increment('tokenVersion', { by: 1, where: { id: user.id } });
        require('../middleware/authMiddleware').clearCachedUser(user.id);
        require('../utils/realtime').disconnectRevokedSockets(user.id, null); // admin-room sockets too
      }
      if (user && fcmToken) {
        const list = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
        const filtered = list.filter(t => t && (typeof t === 'string' ? t : t.token) !== fcmToken);
        if (filtered.length !== list.length) {
          user.fcmTokens = filtered;
          await user.save();
        }
      }
    }
  } catch (e) {
    // Expired/invalid token: nothing to detach
  }

  res.cookie('token', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    expires: new Date(0)
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

module.exports = {
  registerUser,
  authUser,
  saveFcmToken,
  removeFcmToken,
  getUserProfile,
  updateUserProfile,
  resetPassword,
  googleLogin,
  googleComplete,
  logoutUser,
  sendOtp,
  verifyOtp,
  sanitizeUser,
  verifyPhoneProof
};
