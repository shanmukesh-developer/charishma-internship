/**
 * Self-service account deletion (mounted at /api/users/account).
 *
 *   GET  /deletion-check  -> { canDelete, blockers[], walletBalance, phoneMasked }
 *   POST /delete          -> body { confirm: 'DELETE', otp | firebaseToken | password, reason? }
 *
 * Re-authentication is required on top of the session: a fresh SMS code (send-otp with
 * purpose "delete_account"), a Firebase phone-auth token signed in within the last 10 minutes,
 * or the account password. See services/accountDeletion.js for what is deleted vs anonymised.
 */
const express = require('express');
const { getAuth } = require('firebase-admin/auth');
const { protect } = require('../middleware/authMiddleware');
const { getUserModel } = require('../models/User');
const { verifyPhoneProof } = require('../controllers/userController');
const { normalizePhone } = require('../utils/phoneUtils');
const { deleteAccount, precheck } = require('../services/accountDeletion');

const router = express.Router();

const FIREBASE_MAX_AGE_S = 10 * 60;
const PASSWORD_MAX_FAILS = 5;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;
// Wrong-password counter per account for THIS endpoint (OTP attempts are capped by consumeOtp).
const passwordFails = new Map();

const getSequelize = () => require('../config/db').getSequelize();
const maskPhone = (p) => (p ? `******${String(p).slice(-4)}` : '');

const loadUser = async (req, res) => {
  const User = getUserModel();
  const user = req.user && req.user.id ? await User.findByPk(req.user.id) : null;
  if (!user || user.isActive === false) {
    res.status(401).json({ code: 'NOT_AUTHORISED', message: 'Please sign in again.' });
    return null;
  }
  return user;
};

router.get('/deletion-check', protect, async (req, res) => {
  try {
    const user = await loadUser(req, res);
    if (!user) return;
    const blockers = await precheck(getSequelize(), user);
    res.json({
      canDelete: blockers.length === 0,
      blockers,
      walletBalance: Number(user.walletBalance) || 0,
      zenPoints: Number(user.zenPoints) || 0,
      phoneMasked: maskPhone(user.phone),
    });
  } catch (err) {
    console.error('[ACCOUNT_DELETE_CHECK]', err.message);
    res.status(500).json({ message: "We couldn't check your account right now. Please try again." });
  }
});

const verifyReauth = async (user, body) => {
  const phone = normalizePhone(String(user.phone || ''));
  const { otp, firebaseToken, password } = body || {};

  if (firebaseToken) {
    try {
      const decoded = await getAuth().verifyIdToken(String(firebaseToken));
      if (!decoded.phone_number || normalizePhone(decoded.phone_number) !== phone) {
        return { ok: false, status: 401, body: { code: 'PHONE_MISMATCH', message: 'Please verify the mobile number on this account.' } };
      }
      const authAge = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
      if (!(authAge >= 0 && authAge <= FIREBASE_MAX_AGE_S)) {
        return { ok: false, status: 401, body: { code: 'VERIFICATION_EXPIRED', message: 'Your verification has expired. Please request a new code.' } };
      }
      return { ok: true };
    } catch {
      return { ok: false, status: 401, body: { code: 'VERIFICATION_EXPIRED', message: 'Your verification has expired. Please request a new code.' } };
    }
  }

  if (otp !== undefined && otp !== null && otp !== '') {
    const r = await verifyPhoneProof({ phone, otp, purpose: 'delete_account' });
    return r.ok ? { ok: true } : r;
  }

  if (typeof password === 'string' && password.length > 0) {
    const key = String(user.id);
    const entry = passwordFails.get(key);
    if (entry && entry.until > Date.now()) {
      return { ok: false, status: 429, body: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong passwords. Use the SMS code instead, or try again in 15 minutes.' } };
    }
    const match = await user.comparePassword(password.slice(0, 200)).catch(() => false);
    if (!match) {
      const fails = (entry && entry.until <= Date.now() ? 0 : (entry ? entry.fails : 0)) + 1;
      passwordFails.set(key, { fails, until: fails >= PASSWORD_MAX_FAILS ? Date.now() + PASSWORD_LOCK_MS : 0 });
      if (passwordFails.size > 5000) passwordFails.delete(passwordFails.keys().next().value);
      return { ok: false, status: 401, body: { code: 'WRONG_PASSWORD', message: 'That password is not correct.' } };
    }
    passwordFails.delete(key);
    return { ok: true };
  }

  return { ok: false, status: 400, body: { code: 'REAUTH_REQUIRED', message: 'Please confirm with the SMS code we send to your number.' } };
};

router.post('/delete', protect, async (req, res) => {
  try {
    const body = req.body || {};
    if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
      return res.status(400).json({ code: 'CONFIRM_REQUIRED', message: 'Type DELETE to confirm.' });
    }
    const user = await loadUser(req, res);
    if (!user) return;

    // Blockers first: never burn the user's SMS code when deletion would be refused anyway.
    const sequelize = getSequelize();
    const blockers = await precheck(sequelize, user);
    if (blockers.length) {
      return res.status(409).json({ code: blockers[0].code, message: blockers[0].message, blockers });
    }

    const auth = await verifyReauth(user, body);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : null;
    const result = await deleteAccount({ sequelize, user, reason });
    if (!result.ok) return res.status(result.status).json(result.body);

    res.cookie('token', '', { httpOnly: true, secure: true, sameSite: 'none', expires: new Date(0) });
    res.json({
      success: true,
      message: 'Your ZENV account has been deleted. Order and payment records are kept without your personal details, as the law requires.',
    });
  } catch (err) {
    console.error('[ACCOUNT_DELETE_ERROR]', err.message);
    res.status(500).json({ message: "We couldn't delete your account right now. Please try again or email projectshanmukh@gmail.com." });
  }
});

module.exports = router;
