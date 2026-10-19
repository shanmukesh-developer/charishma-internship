/**
 * C9: in-app account deletion for partners who sign up themselves (Google Play requirement).
 *
 *   Zenvy Rider        /api/delivery/account/*            (protect + rider: approved or not)
 *   Zenvy Auto Driver  /api/auto-ride/driver/account/*    (protectDriver)
 *
 *   GET  /deletion-check  -> { canDelete, blockers[], phoneMasked }
 *   POST /delete-otp      -> SMS code to the account's OWN number (purpose 'delete_partner_account')
 *   POST /delete          -> body { confirm: 'DELETE', password | otp, reason? }
 *
 * Re-authentication on top of the session: the account password (5 wrong -> 15 min lock on this endpoint)
 * or the SMS code. Blockers are checked before the code is consumed. What is deleted vs kept:
 * services/partnerAccountDeletion.js. Store accounts are closed by the Zenvy team (see /legal/delete-account).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { normalizePhone } = require('../utils/phoneUtils');
const { riderPrecheck, deleteRiderAccount, driverPrecheck, deleteAutoDriverAccount } = require('../services/partnerAccountDeletion');

const PASSWORD_MAX_FAILS = 5;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;
const passwordFails = new Map();
const OTP_PURPOSE = 'delete_partner_account';
const SUPPORT_EMAIL = 'projectshanmukh@gmail.com';

// The account's own connection (also right in test harnesses), else the app's.
const getSequelize = (acc) => (acc && acc.constructor && acc.constructor.sequelize) || require('../config/db').getSequelize();
const maskPhone = (p) => (/^\d{10}$/.test(String(p || '')) ? `******${String(p).slice(-4)}` : '');

const limiter = (name) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...require('../utils/sharedRateLimit').expressStore(name),
});

/** { ok } or { ok: false, status, body }. `checkPassword(pw)` resolves true / false. */
const verifyReauth = async ({ key, phone, body, checkPassword }) => {
  const { otp, password } = body || {};
  if (otp !== undefined && otp !== null && otp !== '') {
    const { verifyPhoneProof } = require('../controllers/userController');
    const r = await verifyPhoneProof({ phone: normalizePhone(String(phone || '')), otp, purpose: OTP_PURPOSE });
    return r.ok ? { ok: true } : r;
  }
  if (typeof password === 'string' && password.length > 0) {
    const entry = passwordFails.get(key);
    if (entry && entry.until > Date.now()) {
      return { ok: false, status: 429, body: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong passwords. Use the SMS code instead, or try again in 15 minutes.' } };
    }
    const match = await checkPassword(password.slice(0, 200)).catch(() => false);
    if (!match) {
      const fails = (entry && entry.until && entry.until <= Date.now() ? 0 : (entry ? entry.fails : 0)) + 1;
      passwordFails.set(key, { fails, until: fails >= PASSWORD_MAX_FAILS ? Date.now() + PASSWORD_LOCK_MS : 0 });
      if (passwordFails.size > 5000) passwordFails.delete(passwordFails.keys().next().value);
      return { ok: false, status: 401, body: { code: 'WRONG_PASSWORD', message: 'That password is not correct.' } };
    }
    passwordFails.delete(key);
    return { ok: true };
  }
  return { ok: false, status: 400, body: { code: 'REAUTH_REQUIRED', message: 'Please confirm with your password or the SMS code we send to your number.' } };
};

/** Sends the deletion code to the account's own number through the normal OTP sender (cooldown, caps, budget). */
const sendDeleteOtp = (req, res, phone) => {
  const { sendOtp } = require('../controllers/userController');
  const fakeReq = { body: { phone, purpose: OTP_PURPOSE }, ip: req.ip, app: req.app, headers: req.headers, partnerDeleteOtp: true };
  return sendOtp(fakeReq, res);
};

/**
 * Builds the three routes for one account kind.
 *   load(req)          -> model instance of the signed-in account, or null
 *   precheck(seq, acc) -> blockers[]
 *   remove({ sequelize, account, reason }) -> { ok, summary } | { ok:false, status, body }
 *   checkPassword(acc, pw) -> Promise<boolean>
 */
const buildRouter = ({ kind, guards, load, precheck, remove, checkPassword, label }) => {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const lim = limiter(`partnerAccount.${kind}`);

  const loadOr401 = async (req, res) => {
    const acc = await load(req);
    if (!acc) {
      res.status(401).json({ code: 'NOT_AUTHORISED', message: 'Please sign in again.' });
      return null;
    }
    return acc;
  };

  router.get('/deletion-check', ...guards, async (req, res) => {
    try {
      const acc = await loadOr401(req, res);
      if (!acc) return;
      const blockers = await precheck(getSequelize(acc), acc);
      res.json({ canDelete: blockers.length === 0, blockers, phoneMasked: maskPhone(acc.phone) });
    } catch (err) {
      console.error(`[${label}_DELETE_CHECK]`, err.message);
      res.status(500).json({ message: "We couldn't check your account right now. Please try again." });
    }
  });

  router.post('/delete-otp', lim, ...guards, async (req, res) => {
    try {
      const acc = await loadOr401(req, res);
      if (!acc) return;
      const blockers = await precheck(getSequelize(acc), acc);
      if (blockers.length) return res.status(409).json({ code: blockers[0].code, message: blockers[0].message, blockers });
      return sendDeleteOtp(req, res, acc.phone);
    } catch (err) {
      console.error(`[${label}_DELETE_OTP]`, err.message);
      res.status(500).json({ message: "We couldn't send the code right now. Please try again." });
    }
  });

  router.post('/delete', lim, ...guards, async (req, res) => {
    try {
      const body = req.body || {};
      if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
        return res.status(400).json({ code: 'CONFIRM_REQUIRED', message: 'Type DELETE to confirm.' });
      }
      const acc = await loadOr401(req, res);
      if (!acc) return;
      const sequelize = getSequelize(acc);
      // Blockers first: never burn the partner's SMS code when deletion would be refused anyway.
      const blockers = await precheck(sequelize, acc);
      if (blockers.length) return res.status(409).json({ code: blockers[0].code, message: blockers[0].message, blockers });

      const auth = await verifyReauth({ key: `${kind}:${acc.id}`, phone: acc.phone, body, checkPassword: (pw) => checkPassword(acc, pw) });
      if (!auth.ok) return res.status(auth.status).json(auth.body);

      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : null;
      const result = await remove({ sequelize, account: acc, reason });
      if (!result.ok) return res.status(result.status).json(result.body);
      res.cookie('token', '', { httpOnly: true, secure: true, sameSite: 'none', expires: new Date(0) });
      res.json({
        success: true,
        message: 'Your account has been deleted. Delivery, trip and payment records are kept without your personal details, as the law requires.',
      });
    } catch (err) {
      console.error(`[${label}_DELETE_ERROR]`, err.message);
      res.status(500).json({ message: `We couldn't delete your account right now. Please try again or email ${SUPPORT_EMAIL}.` });
    }
  });

  return router;
};

// ── Rider ─────────────────────────────────────────────────────────────────────────────────────
const riderRouter = (() => {
  const { protect, rider } = require('../middleware/authMiddleware');
  return buildRouter({
    kind: 'rider',
    label: 'RIDER_ACCOUNT',
    guards: [protect, rider],
    load: async (req) => {
      const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
      const p = req.user && req.user.id ? await getDeliveryPartnerModel().findByPk(req.user.id) : null;
      return p && !p.accountDeletedAt ? p : null;
    },
    precheck: (sequelize, p) => riderPrecheck(sequelize, p),
    remove: ({ sequelize, account, reason }) => deleteRiderAccount({ sequelize, partner: account, reason }),
    checkPassword: (p, pw) => p.comparePassword(pw),
  });
})();

// ── Auto-Ride driver (mounted inside the driver router, after protectDriver) ───────────────────
const driverRouter = buildRouter({
  kind: 'auto_driver',
  label: 'AUTO_DRIVER_ACCOUNT',
  guards: [],
  load: async (req) => req.driver || null,
  precheck: (sequelize, d) => driverPrecheck(sequelize, d),
  remove: ({ sequelize, account, reason }) => deleteAutoDriverAccount({ sequelize, driver: account, reason }),
  checkPassword: (d, pw) => bcrypt.compare(pw, d.password),
});

module.exports = { riderRouter, driverRouter, _resetPasswordFails: () => passwordFails.clear() };
