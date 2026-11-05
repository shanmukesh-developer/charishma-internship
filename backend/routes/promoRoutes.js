// Promoter links and codes (owner, 5 Nov 2026). Rules: utils/promoAttribution. Mounted in server.js:
//   publicRouter  /api/promo        POST /attribute (app, first launch), GET /check/:code (sign-up field hint)
//   adminRouter   /api/admin/promoters   (before /api/admin) list / create / edit / deactivate / payouts
//   shortLink     GET /p/:code      302 to the Play link with the install referrer, counts a click
const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, admin } = require('../middleware/authMiddleware');
const { getPromoterModel, getPromoPayoutModel } = require('../models/Promoter');
const promo = require('../utils/promoAttribution');
const { apiBase } = require('../utils/publicUrl');
const { normalizePhone } = require('../utils/phoneUtils');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPI_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,32}$/;
const store = (name) => require('../utils/sharedRateLimit').expressStore(name);
const skip = (req) => require('../utils/loadtestBypass').skipRateLimit(req);

// One install reports once; a campus NAT shares an IP, so the per-IP budget is a flood guard only.
const attributeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Math.max(20, Number(process.env.PROMO_ATTRIBUTE_IP_MAX) || 600), skip, message: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, ...store('promo.attribute') });
const checkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Math.max(20, Number(process.env.PROMO_CHECK_IP_MAX) || 300), skip, message: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, ...store('promo.check') });
const clickLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, skip, standardHeaders: false, legacyHeaders: false, handler: (req, res) => res.redirect(302, `https://play.google.com/store/apps/details?id=${promo.PACKAGE_ID}`), ...store('promo.click') });

// ── Public ──────────────────────────────────────────────────────────────────────────────────────
const publicRouter = express.Router();
publicRouter.post('/attribute', attributeLimiter, async (req, res) => {
  try {
    const { referrer, deviceId } = req.body || {};
    const r = await promo.recordInstall({ referrer, deviceId });
    if (!r.ok) return res.status(r.status || 400).json({ code: 'INVALID_REQUEST', message: r.message });
    return res.json({ ok: true, attributed: r.attributed });
  } catch (e) {
    console.error('[PROMO_ATTRIBUTE_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not record this install right now.' });
  }
});
// Is this a live promoter code? Only { valid } (never who the promoter is).
publicRouter.get('/check/:code', checkLimiter, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ valid: !!(await promo.activePromoter(req.params.code)) });
  } catch (e) {
    console.error('[PROMO_CHECK_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not check the code right now.' });
  }
});

// ── Short link ──────────────────────────────────────────────────────────────────────────────────
const shortLink = [clickLimiter, async (req, res) => {
  const code = promo.normalizeCode(req.params.code);
  let target = `https://play.google.com/store/apps/details?id=${promo.PACKAGE_ID}`;
  try {
    const P = getPromoterModel();
    if (code && P) {
      const [n] = await P.update({ clickCount: P.sequelize.literal('"clickCount" + 1') }, { where: { code, active: true }, silent: true });
      if (n) target = promo.playUrl(code);
    }
  } catch (e) { console.warn('[PROMO_CLICK_ERR]', e && e.message); }
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, target);
}];

// ── Admin ───────────────────────────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(protect, admin, (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
adminRouter.param('id', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Promoter not found.' })));

const audit = async (req, targetId, action, details) => {
  try {
    const { getVerificationLogModel } = require('../models/VerificationLog');
    const Log = getVerificationLogModel();
    if (!Log) return;
    await Log.create({ adminId: String((req.user && req.user.id) || 'unknown'), targetId: String(targetId), action, details: JSON.stringify(details || {}).slice(0, 8000) });
  } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
};

const shape = (req, p, stats) => {
  const base = apiBase(req);
  return {
    id: p.id, code: p.code, name: p.name, phone: p.phone, upiId: p.upiId, active: p.active,
    clicks: p.clickCount || 0, createdAt: p.createdAt,
    link: promo.playUrl(p.code), shortLink: base ? `${base}/p/${p.code}` : `/p/${p.code}`,
    ...(stats || {}),
  };
};

// Validates the editable fields; returns { fields } or { error }.
const readFields = (body, { creating }) => {
  const f = {};
  if (creating || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 80) return { error: 'Enter the promoter\'s name (2-80 letters).' };
    f.name = name;
  }
  if (body.phone !== undefined) {
    const raw = String(body.phone || '').trim();
    const phone = raw ? normalizePhone(raw) : '';
    if (raw && !/^[6-9]\d{9}$/.test(phone)) return { error: 'Enter a valid 10-digit mobile number, or leave it blank.' };
    f.phone = phone || null;
  }
  if (body.upiId !== undefined) {
    const upi = String(body.upiId || '').trim();
    if (upi && !UPI_RE.test(upi)) return { error: 'Enter a valid UPI ID (like name@okaxis), or leave it blank.' };
    f.upiId = upi || null;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { error: 'active must be true or false.' };
    f.active = body.active;
  }
  return { fields: f };
};

adminRouter.get('/', async (req, res) => {
  try {
    const rows = await getPromoterModel().findAll({ order: [['createdAt', 'DESC']], limit: 1000 });
    const stats = await promo.statsFor(rows.map((r) => r.id));
    return res.json({ perBlock: promo.PER_BLOCK, blockPay: promo.BLOCK_PAY, promoters: rows.map((r) => shape(req, r, stats[r.id])) });
  } catch (e) {
    console.error('[PROMOTERS_LIST_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not load promoters.' });
  }
});

adminRouter.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { fields, error } = readFields(body, { creating: true });
    if (error) return res.status(400).json({ code: 'INVALID_PROMOTER', message: error });
    const P = getPromoterModel();
    const custom = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : '';
    if (custom && !promo.normalizeCode(custom)) return res.status(400).json({ code: 'INVALID_CODE', message: 'The code must be 4-16 letters or digits (A-Z, 0-9), no spaces.' });
    let row = null;
    for (let i = 0; i < (custom ? 1 : 8) && !row; i++) {
      const code = custom ? promo.normalizeCode(custom) : promo.randomCode(6);
      if (await P.findOne({ where: { code }, attributes: ['id'] })) {
        if (custom) return res.status(409).json({ code: 'CODE_TAKEN', message: `The code ${code} is already used by another promoter.` });
        continue;
      }
      try {
        row = await P.create({ ...fields, code, active: true, createdBy: req.user && req.user.id });
      } catch (e) {
        if (e.name !== 'SequelizeUniqueConstraintError') throw e;
        if (custom) return res.status(409).json({ code: 'CODE_TAKEN', message: `The code ${code} is already used by another promoter.` });
      }
    }
    if (!row) return res.status(500).json({ message: 'Could not pick a free code. Please try again.' });
    await audit(req, row.id, 'PROMOTER_CREATE', { code: row.code, name: row.name });
    const stats = await promo.statsFor([row.id]);
    return res.status(201).json(shape(req, row, stats[row.id]));
  } catch (e) {
    console.error('[PROMOTER_CREATE_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not create the promoter.' });
  }
});

// Edit name / phone / UPI, or deactivate ({ active: false }) / reactivate. The code never changes.
adminRouter.patch('/:id', async (req, res) => {
  try {
    const { fields, error } = readFields(req.body || {}, { creating: false });
    if (error) return res.status(400).json({ code: 'INVALID_PROMOTER', message: error });
    const row = await getPromoterModel().findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Promoter not found.' });
    if (!Object.keys(fields).length) return res.status(400).json({ message: 'Nothing to change.' });
    const before = { name: row.name, phone: row.phone, upiId: row.upiId, active: row.active };
    await row.update(fields);
    await audit(req, row.id, fields.active === false ? 'PROMOTER_DEACTIVATE' : 'PROMOTER_UPDATE', { code: row.code, before, after: fields });
    const stats = await promo.statsFor([row.id]);
    return res.json(shape(req, row, stats[row.id]));
  } catch (e) {
    console.error('[PROMOTER_UPDATE_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not update the promoter.' });
  }
});

adminRouter.get('/:id/payouts', async (req, res) => {
  try {
    const rows = await getPromoPayoutModel().findAll({ where: { promoterId: req.params.id }, order: [['paidAt', 'DESC']], limit: 500 });
    return res.json({ payouts: rows });
  } catch (e) {
    console.error('[PROMOTER_PAYOUTS_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not load payouts.' });
  }
});

// Mark paid: { amount? (whole rupees, default = everything due), paidAt? (date), note? }. Never more than due.
// Two clicks on "Mark paid" at once must not pay twice: one payout per promoter at a time (per instance).
const payoutLocks = new Map();
adminRouter.post('/:id/payouts', async (req, res) => {
  const prev = payoutLocks.get(req.params.id) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const chain = prev.then(() => mine);
  payoutLocks.set(req.params.id, chain);
  await prev;
  try {
    const row = await getPromoterModel().findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Promoter not found.' });
    const body = req.body || {};
    const stats = (await promo.statsFor([row.id]))[row.id];
    const amount = body.amount === undefined || body.amount === null || body.amount === '' ? stats.due : Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ code: stats.due ? 'INVALID_AMOUNT' : 'NOTHING_DUE', message: stats.due ? 'Enter the amount paid in whole rupees.' : 'Nothing is due to this promoter yet.' });
    }
    if (amount > stats.due) return res.status(400).json({ code: 'OVER_DUE', message: `Only Rs ${stats.due} is due to this promoter.` });
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) return res.status(400).json({ code: 'INVALID_DATE', message: 'Enter a valid payment date.' });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
    const payout = await getPromoPayoutModel().create({ promoterId: row.id, amount, paidAt, note: note || null, adminId: req.user && req.user.id });
    await audit(req, row.id, 'PROMOTER_PAYOUT', { code: row.code, amount, paidAt, note, payoutId: payout.id });
    const after = await promo.statsFor([row.id]);
    return res.status(201).json({ payout, promoter: shape(req, row, after[row.id]) });
  } catch (e) {
    console.error('[PROMOTER_PAYOUT_ERR]', e && e.message);
    return res.status(500).json({ message: 'Could not record the payout.' });
  } finally {
    release();
    if (payoutLocks.get(req.params.id) === chain) payoutLocks.delete(req.params.id);
  }
});

module.exports = { publicRouter, adminRouter, shortLink };
