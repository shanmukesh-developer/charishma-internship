/**
 * C8 receipt / tax display settings (GlobalConfig key RECEIPT_SETTINGS), edited on admin Config → Receipts.
 *
 *   { platformGstin: '', taxDisplayMode: 'inclusive' | 'breakdown', gstRatePercent: null | number,
 *     footerNote: '', hideStoresWithoutFssai: false }
 *
 * Nothing is invented. Today the order bill has taxes = 0 with every price inclusive of tax
 * (utils/orderPricing.js), so receipts say "Prices inclusive of applicable taxes" and show no GST lines.
 * 'breakdown' only shows the GST contained in the amount already charged, at the rate the owner (on their
 * CA's advice) enters here; it never changes what anyone pays. It can only be switched on once a platform
 * GSTIN and a rate are both set, and it falls back to 'inclusive' whenever either is missing.
 * hideStoresWithoutFssai (default off): stores with no FSSAI licence number are left out of customer
 * listings and cannot take new orders.
 */
const KEY = 'RECEIPT_SETTINGS';
const DEFAULTS = Object.freeze({
  platformGstin: '',
  taxDisplayMode: 'inclusive',
  gstRatePercent: null,
  footerNote: '',
  hideStoresWithoutFssai: false,
});
const MODES = ['inclusive', 'breakdown'];
const FOOTER_MAX = 300;
const INCLUSIVE_NOTE = 'Prices inclusive of applicable taxes';
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const clone = (o) => JSON.parse(JSON.stringify(o));
const defaults = () => clone(DEFAULTS);
const gstinRe = () => require('./storeCompliance').GSTIN_RE;

const validRate = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 28 && Math.round(n * 100) === n * 100;

/** Stored value (any shape) -> full settings object. Bad fields fall back to defaults. */
const parse = (raw) => {
  const out = defaults();
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.platformGstin === 'string' && gstinRe().test(v.platformGstin.trim().toUpperCase())) out.platformGstin = v.platformGstin.trim().toUpperCase();
  if (validRate(Number(v.gstRatePercent)) && v.gstRatePercent !== null && v.gstRatePercent !== '') out.gstRatePercent = Number(v.gstRatePercent);
  if (typeof v.footerNote === 'string') out.footerNote = v.footerNote.trim().slice(0, FOOTER_MAX);
  if (v.hideStoresWithoutFssai === true) out.hideStoresWithoutFssai = true;
  if (MODES.includes(v.taxDisplayMode)) out.taxDisplayMode = v.taxDisplayMode;
  if (out.taxDisplayMode === 'breakdown' && !breakdownAllowed(out)) out.taxDisplayMode = 'inclusive';
  return out;
};

/** 'breakdown' needs both a platform GSTIN and a rate. */
const breakdownAllowed = (s) => !!(s && s.platformGstin && validRate(s.gstRatePercent));
/** The mode receipts actually use. */
const effectiveMode = (s) => (s && s.taxDisplayMode === 'breakdown' && breakdownAllowed(s) ? 'breakdown' : 'inclusive');

/** Partial update -> { settings } or { error }. */
const validateUpdate = (before, body) => {
  const next = clone(before);
  const b = body && typeof body === 'object' ? body : {};
  const known = new Set([...Object.keys(DEFAULTS), 'ifUpdatedAt']);
  const unknown = Object.keys(b).filter((k) => !known.has(k));
  if (unknown.length) return { error: `Unknown field: ${unknown[0]}.` };
  if (b.platformGstin !== undefined) {
    const v = b.platformGstin === null ? '' : b.platformGstin;
    if (typeof v !== 'string') return { error: 'Platform GSTIN must be text.' };
    const t = v.trim().toUpperCase().replace(/\s/g, '');
    if (t && !gstinRe().test(t)) return { error: 'Platform GSTIN must be 15 characters in the GST format (for example 37ABCDE1234F1Z5).' };
    next.platformGstin = t;
  }
  if (b.gstRatePercent !== undefined) {
    if (b.gstRatePercent === null || b.gstRatePercent === '') next.gstRatePercent = null;
    else {
      const n = Number(b.gstRatePercent);
      if (!validRate(n)) return { error: 'GST rate must be a percentage above 0 and at most 28, with up to 2 decimals.' };
      next.gstRatePercent = n;
    }
  }
  if (b.footerNote !== undefined) {
    const v = b.footerNote === null ? '' : b.footerNote;
    if (typeof v !== 'string') return { error: 'Footer note must be text.' };
    const t = v.trim();
    if (t.length > FOOTER_MAX) return { error: `Footer note must be at most ${FOOTER_MAX} characters.` };
    if (CTRL_RE.test(t) || /[<>]/.test(t)) return { error: 'Footer note contains characters that are not allowed.' };
    next.footerNote = t;
  }
  if (b.hideStoresWithoutFssai !== undefined) {
    if (typeof b.hideStoresWithoutFssai !== 'boolean') return { error: 'Hide stores without FSSAI must be true or false.' };
    next.hideStoresWithoutFssai = b.hideStoresWithoutFssai;
  }
  if (b.taxDisplayMode !== undefined) {
    if (!MODES.includes(b.taxDisplayMode)) return { error: "Tax display must be 'inclusive' or 'breakdown'." };
    next.taxDisplayMode = b.taxDisplayMode;
  }
  if (next.taxDisplayMode === 'breakdown' && !breakdownAllowed(next)) {
    return { error: 'GST breakdown needs both the platform GSTIN and the GST rate. Set them first (on your CA\'s advice), or keep "inclusive".' };
  }
  return { settings: next };
};

const diff = (before, after) => {
  const changes = {};
  for (const k of Object.keys(DEFAULTS)) if (before[k] !== after[k]) changes[k] = [before[k], after[k]];
  return changes;
};

// ─── Cached read (same pattern as utils/legalSettings) ─────────────────────
const CACHE_MS = 30 * 1000;
let cache = null;
let loading = null;
const clearCacheLocal = () => { cache = null; };
const clearCache = require('./cacheBus').wrap('receiptSettings.clear', clearCacheLocal, { resync: clearCacheLocal });

const readFromDb = async () => {
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const GlobalConfig = getGlobalConfigModel();
  if (!GlobalConfig) return { settings: defaults(), row: null };
  const row = await GlobalConfig.findOne({ where: { key: KEY } });
  return { settings: parse(row ? row.value : null), row };
};

/** Cached settings (30 s, cleared on every admin write). A failed read serves the last good copy, or defaults. */
const getSettings = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.settings;
  if (!loading) {
    loading = readFromDb()
      .then(({ settings }) => { cache = { at: Date.now(), settings }; return settings; })
      .catch((err) => {
        console.warn('[RECEIPT_SETTINGS_READ_WARN]', err.message);
        const fallback = cache ? cache.settings : defaults();
        cache = { at: Date.now() - CACHE_MS + 5000, settings: fallback };
        return fallback;
      })
      .finally(() => { loading = null; });
  }
  return loading;
};

/** True when listings must leave out stores without an FSSAI number (never throws; default false). */
const hideStoresWithoutFssai = async () => {
  try { return !!(await getSettings()).hideStoresWithoutFssai; } catch { return false; }
};

/** Sequelize where-fragment for customer listings ({} when the setting is off). */
const listingWhere = async () => {
  // The owner's tester accounts (utils/testView) see their test stores, which carry no licence numbers.
  if (require('./testView').isTester()) return {};
  if (!(await hideStoresWithoutFssai())) return {};
  const { Op } = require('sequelize');
  return { fssaiLicenseNumber: { [Op.ne]: null } };
};

module.exports = {
  KEY, DEFAULTS, MODES, INCLUSIVE_NOTE, defaults, parse, validateUpdate, diff, breakdownAllowed, effectiveMode,
  getSettings, readFromDb, clearCache, hideStoresWithoutFssai, listingWhere, validRate,
};
