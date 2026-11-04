/**
 * Campus Events switches and settings (GlobalConfig rows, cached 30 s, DEFAULT OFF):
 *   CAMPUS_EVENTS_ENABLED             browse / register / teams / organizer submit. Missing row = OFF.
 *                                     Outside production CAMPUS_EVENTS_DEV_ENABLE=1 turns it on while no
 *                                     row exists (never in production).
 *   CAMPUS_EVENTS_WALLET_ENABLED      Zenvy Wallet as a payment mode. Missing row = OFF.
 *   CAMPUS_EVENTS_ONLINE_PAY_ENABLED  Razorpay online payments (also env CAMPUS_EVENTS_ONLINE_PAY_ENABLED=1);
 *                                     only effective when RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET are set.
 *   CAMPUS_EVENTS_SETTINGS            { holdMinutes, paymentMinutes, ... } merged over defaults, range-checked.
 * While OFF: own registrations / tickets / cancel, check-in, organizer drafts and every admin endpoint keep
 * working; browse, register, teams and organizer submit -> 403 FEATURE_OFF.
 */
const { fail } = require('./util');
const { isProduction } = require('../../../utils/env');
const { DEFAULT_SETTINGS } = require('../enums');

const FLAG_KEY = 'CAMPUS_EVENTS_ENABLED';
const WALLET_KEY = 'CAMPUS_EVENTS_WALLET_ENABLED';
const ONLINE_KEY = 'CAMPUS_EVENTS_ONLINE_PAY_ENABLED';
const SETTINGS_KEY = 'CAMPUS_EVENTS_SETTINGS';
const TTL_MS = 30 * 1000;
const cache = new Map();
// B1: a switch / settings write on one instance clears the cached value on every instance (utils/cacheBus).
const cacheBus = require('../../../utils/cacheBus');
cacheBus.register('flags.campusEvents', (key) => { if (key) cache.delete(key); else cache.clear(); }, { resync: () => cache.clear() });

const GC = () => require('../../../models/GlobalConfig').getGlobalConfigModel();
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1' || (v && typeof v === 'object' && v.enabled === true);

const readRow = async (key) => {
  const GlobalConfig = GC();
  if (!GlobalConfig) return undefined;
  const row = await GlobalConfig.findOne({ where: { key } });
  return row ? row.value : undefined;
};

const cached = async (key, compute, fresh) => {
  const c = cache.get(key);
  if (!fresh && c && Date.now() - c.at < TTL_MS) return c.value;
  let value;
  try {
    value = await compute();
  } catch (err) {
    console.warn('[CAMPUS_EVENTS_FLAG_WARN]', err.message);
    value = c ? c.value : undefined;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
};

const devEnabled = () => !isProduction() && String(process.env.CAMPUS_EVENTS_DEV_ENABLE || '') === '1';

const readFlag = async ({ fresh = false } = {}) => !!(await cached(FLAG_KEY, async () => {
  const v = await readRow(FLAG_KEY);
  if (v === undefined) return devEnabled();
  return truthy(v);
}, fresh));
const readWalletFlag = async ({ fresh = false } = {}) => !!(await cached(WALLET_KEY, async () => truthy(await readRow(WALLET_KEY)), fresh));
const readOnlineFlag = async ({ fresh = false } = {}) => {
  if (String(process.env.CAMPUS_EVENTS_ONLINE_PAY_ENABLED || '') === '1' || String(process.env.CAMPUS_EVENTS_ONLINE_PAY_ENABLED || '').toLowerCase() === 'true') return true;
  return !!(await cached(ONLINE_KEY, async () => truthy(await readRow(ONLINE_KEY)), fresh));
};

const writeRow = async (key, value, description) => {
  const GlobalConfig = GC();
  const row = await GlobalConfig.findOne({ where: { key } });
  if (row) await row.update({ value });
  else await GlobalConfig.create({ key, value, description });
  cache.delete(key);
  cacheBus.broadcast('flags.campusEvents', key); // B1: other instances re-read it too
  try { require('../../../utils/realtime').publish('config', 'updated', key, { scope: 'global' }); } catch { /* cache just expires */ }
};

const writeFlag = async (on) => { await writeRow(FLAG_KEY, !!on, 'ZenWe Campus Events (Others > Campus Events): browse, register, teams, organizer submit'); return readFlag({ fresh: true }); };
const writeWalletFlag = async (on) => { await writeRow(WALLET_KEY, !!on, 'ZenWe Campus Events: allow ZenWe Wallet payments'); return readWalletFlag({ fresh: true }); };
const writeOnlineFlag = async (on) => { await writeRow(ONLINE_KEY, !!on, 'ZenWe Campus Events: allow Razorpay online payments (needs RAZORPAY_* env)'); return readOnlineFlag({ fresh: true }); };

const RANGES = {
  holdMinutes: [1, 30], paymentMinutes: [5, 60], waitlistOfferMinutes: [10, 1440], maxUnpaidVenueReservations: [1, 20],
  defaultUserCancelUntilHours: [0, 720], defaultRefundPct: [0, 100], inviteExpiryHours: [1, 336], joinLinkDays: [1, 30],
  announcementsPerDay: [1, 50], retentionDays: [30, 3650], maxPrice: [0, 100000], maxCapacity: [1, 100000], entryOpensBeforeMin: [0, 1440],
};

const clampInt = (v, [min, max], dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

const normaliseSettings = (raw) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, range] of Object.entries(RANGES)) out[k] = clampInt(s[k], range, DEFAULT_SETTINGS[k]);
  return out;
};

const readSettings = async ({ fresh = false } = {}) => normaliseSettings(await cached(SETTINGS_KEY, () => readRow(SETTINGS_KEY), fresh));

const writeSettings = async (patch) => {
  const next = { ...(await readSettings({ fresh: true })) };
  for (const [k, [min, max]] of Object.entries(RANGES)) {
    if (!patch || patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw fail(400, 'INVALID_INPUT', `${k} must be a whole number between ${min} and ${max}.`, { field: k });
    next[k] = n;
  }
  await writeRow(SETTINGS_KEY, next, 'ZenWe Campus Events settings (holds, payments, waitlist, limits, retention)');
  return readSettings({ fresh: true });
};

const clearCache = () => cache.clear();

/** Customer gate: signed-in Zenvy user; feature on unless opts.allowWhenOff. */
const requireOn = (opts = {}) => async (req, res, next) => {
  try {
    if (!req.user || !req.user.id || ['auto_driver', 'rider', 'restaurant'].includes(String(req.user.role || '').toLowerCase())) {
      throw fail(401, 'NOT_AUTHORISED', 'Sign in with your ZenWe student account.');
    }
    if (!opts.allowWhenOff && !(await readFlag())) {
      throw fail(403, 'FEATURE_OFF', 'Campus Events is not open yet. Please check back soon.');
    }
    return next();
  } catch (err) {
    return require('./util').sendError(res, err, 'CAMPUS_EVENTS_GATE');
  }
};

const assertOn = async () => {
  if (!(await readFlag())) throw fail(403, 'FEATURE_OFF', 'Campus Events is not open yet. Your event stays saved as a draft.');
};

module.exports = {
  FLAG_KEY, WALLET_KEY, ONLINE_KEY, SETTINGS_KEY, readFlag, readWalletFlag, readOnlineFlag, writeFlag, writeWalletFlag, writeOnlineFlag,
  readSettings, writeSettings, normaliseSettings, clearCache, requireOn, assertOn, devEnabled,
};
