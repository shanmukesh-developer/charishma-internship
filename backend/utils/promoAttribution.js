// Promoter attribution rules (owner, 5 Nov 2026): Rs 100 for every 200 verified downloads, from a Play install
// link or a promoter code typed at sign-up. Models: models/Promoter. Routes: routes/promoRoutes.
//
// Link:   https://play.google.com/store/apps/details?id=com.srm.hostelbites&referrer=utm_source%3Dpromo%26utm_campaign%3D<CODE>
// Short:  https://<backend>/p/<CODE>  (302 to the link above, counts a click)
//
// A VERIFIED download = a device that installed from a promoter's link (or whose new account typed a promoter's
// code) AND on which a NEW customer account was then created with a verified phone number:
//   - one device counts once ever (deviceHash unique: the app sends Android's per-device id, which survives
//     reinstalls), one account counts once ever (userId unique), one phone number counts once ever (phoneHash);
//   - signing in to an existing account never counts (only the account-creation paths call creditNewAccount);
//   - link and typed code never both count: the link wins when both are present, and the row is credited once.
// Unknown / inactive codes are ignored (stored as an organic install, nothing credited). Never throws into the
// sign-up: creditNewAccount swallows its own errors.
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { Op } = require('sequelize');
const { getPromoterModel, getPromoAttributionModel, getPromoPayoutModel } = require('../models/Promoter');

const PACKAGE_ID = 'com.srm.hostelbites';
const PER_BLOCK = 200; // verified downloads
const BLOCK_PAY = 100; // rupees per full block
const LATE_LINK_MS = 3 * 24 * 60 * 60 * 1000; // referrer arriving after sign-up still counts within 3 days

const CODE_RE = /^[A-Z0-9]{4,16}$/;
const DEVICE_RE = /^[A-Za-z0-9._:-]{8,200}$/;
const AUTO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Upper-cased, trimmed code when it has the promoter shape (4-16 A-Z 0-9), else ''. */
const normalizeCode = (v) => {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return CODE_RE.test(c) ? c : '';
};
const randomCode = (len = 6) => Array.from(crypto.randomBytes(len), (b) => AUTO_ALPHABET[b % AUTO_ALPHABET.length]).join('');

const secret = () => process.env.PROMO_HASH_SECRET || process.env.JWT_SECRET || 'zenv-promo';
const hmac = (kind, v) => crypto.createHmac('sha256', secret()).update(`${kind}:${v}`).digest('hex');
const deviceHashOf = (deviceId) => {
  const d = typeof deviceId === 'string' ? deviceId.trim() : '';
  return DEVICE_RE.test(d) ? hmac('device', d) : null;
};
const phoneHashOf = (phone) => (phone ? hmac('phone', String(phone)) : null);

const playUrl = (code) => `https://play.google.com/store/apps/details?id=${PACKAGE_ID}&referrer=${encodeURIComponent(`utm_source=promo&utm_campaign=${code}`)}`;

/** utm_campaign of a Play install referrer ("utm_source=promo&utm_campaign=RAVI10", maybe URL-encoded once). */
const codeFromReferrer = (referrer) => {
  if (typeof referrer !== 'string' || !referrer) return '';
  let s = referrer.trim();
  if (!s.includes('=') && s.includes('%3D')) { try { s = decodeURIComponent(s); } catch { /* keep */ } }
  try {
    return normalizeCode(new URLSearchParams(s).get('utm_campaign') || '');
  } catch { return ''; }
};

const activePromoter = async (code) => {
  const c = normalizeCode(code);
  if (!c) return null;
  const P = getPromoterModel();
  return P ? P.findOne({ where: { code: c, active: true } }) : null;
};

const isUnique = (e) => e && e.name === 'SequelizeUniqueConstraintError';
const phoneAlreadyCredited = async (phoneHash) => {
  if (!phoneHash) return false;
  return !!(await getPromoAttributionModel().findOne({ where: { phoneHash, verifiedAt: { [Op.ne]: null } }, attributes: ['id'] }));
};

/**
 * POST /api/promo/attribute: the app's first-launch report of its Play install referrer.
 * Resolves { ok, status?, attributed, message? }. First report per device wins; later ones change nothing.
 */
const recordInstall = async ({ referrer, deviceId }) => {
  const deviceHash = deviceHashOf(deviceId);
  if (!deviceHash) return { ok: false, status: 400, message: 'deviceId is required.' };
  const raw = typeof referrer === 'string' ? referrer.slice(0, 300) : null;
  const promoter = await activePromoter(codeFromReferrer(raw));
  const A = getPromoAttributionModel();
  const now = new Date();
  let row = await A.findOne({ where: { deviceHash } });
  if (!row) {
    try {
      await A.create({ deviceHash, rawReferrer: raw, referrerCode: promoter ? promoter.code : null, promoterId: promoter ? promoter.id : null, attributedAt: now });
      return { ok: true, attributed: !!promoter };
    } catch (e) {
      if (!isUnique(e)) throw e;
      row = await A.findOne({ where: { deviceHash } }); // a parallel report (or sign-up) made the row first
      if (!row) return { ok: true, attributed: false };
    }
  }
  if (row.attributedAt) return { ok: true, attributed: false, already: true };
  // The account was created on this device before the referrer arrived (offline first launch): credit the link
  // if that sign-up was recent and nothing was credited for it yet.
  const late = promoter && row.userId && !row.promoterId && row.signedUpAt
    && (now - new Date(row.signedUpAt)) <= LATE_LINK_MS && !(await phoneAlreadyCredited(row.phoneHash));
  const patch = { attributedAt: now, rawReferrer: raw, referrerCode: promoter ? promoter.code : null };
  if (late) Object.assign(patch, { promoterId: promoter.id, source: 'link', verifiedAt: now });
  else if (promoter && !row.userId && !row.promoterId) patch.promoterId = promoter.id;
  const [n] = await A.update(patch, { where: { id: row.id, attributedAt: null, ...(late ? { promoterId: null } : {}) } });
  return { ok: true, attributed: !!(n && (late || patch.promoterId)) };
};

/**
 * Called right after a NEW customer account is created (register / Google finish). Never throws.
 * Resolves { promo: 'link' | 'code' | 'invalid' | 'none' | 'used' } ('invalid' = a typed code that is not a
 * live promoter code; 'used' = this device / number already had a new account credited or recorded).
 */
const creditNewAccount = async ({ userId, phone, installId, promoCode }) => {
  try {
    const A = getPromoAttributionModel();
    if (!A || !userId) return { promo: 'none' };
    const typed = typeof promoCode === 'string' && promoCode.trim() ? promoCode.trim() : '';
    const codePromoter = typed ? await activePromoter(typed) : null;
    const invalid = !!typed && !codePromoter;
    const deviceHash = deviceHashOf(installId);
    const phoneHash = phoneHashOf(phone);
    const phoneUsed = await phoneAlreadyCredited(phoneHash);
    const now = new Date();
    const base = { userId, phoneHash, signedUpAt: now };
    const row = deviceHash ? await A.findOne({ where: { deviceHash } }) : null;

    if (row && row.userId) return { promo: invalid ? 'invalid' : 'used' };
    if (row) {
      let patch = base;
      let promo = invalid ? 'invalid' : 'none';
      const linkLive = row.promoterId && !row.verifiedAt
        && await getPromoterModel().count({ where: { id: row.promoterId, active: true } });
      if (!phoneUsed && linkLive) { patch = { ...base, source: 'link', verifiedAt: now }; promo = 'link'; }
      else if (!phoneUsed && codePromoter) { patch = { ...base, promoterId: codePromoter.id, source: 'code', verifiedAt: now }; promo = 'code'; }
      else if (row.promoterId && !row.verifiedAt) patch = { ...base, promoterId: null }; // dead link: not credited
      const [n] = await A.update(patch, { where: { id: row.id, userId: null } });
      return n ? { promo } : { promo: 'used' };
    }
    const credit = !phoneUsed && codePromoter;
    try {
      await A.create({ ...base, deviceHash, ...(credit ? { promoterId: codePromoter.id, source: 'code', verifiedAt: now } : {}) });
    } catch (e) {
      if (isUnique(e)) return { promo: 'used' };
      throw e;
    }
    return { promo: credit ? 'code' : (invalid ? 'invalid' : 'none') };
  } catch (e) {
    console.warn('[PROMO_CREDIT_ERR]', e && e.message);
    return { promo: 'none' };
  }
};

const earnedFor = (verified) => Math.floor((Number(verified) || 0) / PER_BLOCK) * BLOCK_PAY;

/** Per-promoter numbers: { [promoterId]: { viaLink, viaCode, verified, payableCount, earned, paid, due, installs } }. */
const statsFor = async (promoterIds) => {
  const out = {};
  for (const id of promoterIds) out[id] = { installs: 0, viaLink: 0, viaCode: 0, verified: 0, payableCount: 0, earned: 0, paid: 0, due: 0 };
  if (!promoterIds.length) return out;
  const A = getPromoAttributionModel();
  const rows = await A.findAll({
    where: { promoterId: { [Op.in]: promoterIds } },
    attributes: ['promoterId', 'source', [A.sequelize.fn('COUNT', A.sequelize.col('id')), 'n'], [A.sequelize.fn('COUNT', A.sequelize.col('verifiedAt')), 'v']],
    group: ['promoterId', 'source'],
    raw: true,
  });
  for (const r of rows) {
    const s = out[r.promoterId];
    if (!s) continue;
    const v = Number(r.v) || 0;
    if (r.source !== 'code') s.installs += Number(r.n) || 0; // link installs reported by the app
    if (r.source === 'link') s.viaLink += v;
    else if (r.source === 'code') s.viaCode += v;
  }
  const P = getPromoPayoutModel();
  const paid = await P.findAll({ where: { promoterId: { [Op.in]: promoterIds } }, attributes: ['promoterId', [P.sequelize.fn('SUM', P.sequelize.col('amount')), 'sum']], group: ['promoterId'], raw: true });
  for (const r of paid) if (out[r.promoterId]) out[r.promoterId].paid = Number(r.sum) || 0;
  for (const s of Object.values(out)) {
    s.verified = s.viaLink + s.viaCode;
    s.payableCount = Math.floor(s.verified / PER_BLOCK) * PER_BLOCK;
    s.earned = earnedFor(s.verified);
    s.due = Math.max(0, s.earned - s.paid);
  }
  return out;
};

module.exports = {
  PACKAGE_ID, PER_BLOCK, BLOCK_PAY, CODE_RE,
  normalizeCode, randomCode, deviceHashOf, phoneHashOf, playUrl, codeFromReferrer, activePromoter,
  recordInstall, creditNewAccount, earnedFor, statsFor,
};
