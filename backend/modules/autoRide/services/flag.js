/**
 * Auto-Ride kill switches and settings (GlobalConfig rows, cached 30 s, same pattern as Rentals but
 * DEFAULT OFF):
 *   AUTO_RIDE_ENABLED         customer booking + driver publish. Missing row = OFF. Outside production
 *                             AUTO_RIDE_DEV_ENABLE=1 turns it on while no row exists (never in production).
 *   AUTO_RIDE_WALLET_ENABLED  Zenvy Wallet as a payment method. Missing row = OFF (cash only).
 *   AUTO_RIDE_SETTINGS        { platformMaxCapacity (default 8), holdMinutes, ... } merged over defaults.
 * While OFF: admin endpoints and driver onboarding (auth, profile, documents, vehicles) still work;
 * customers can still see / cancel their own bookings; browse, holds, private requests and publish -> 403 FEATURE_OFF.
 */
const { fail } = require('./util');
const { isProduction } = require('../../../utils/env');
const { DEFAULT_SETTINGS, LIMITS } = require('../enums');

const FLAG_KEY = 'AUTO_RIDE_ENABLED';
const WALLET_KEY = 'AUTO_RIDE_WALLET_ENABLED';
const SETTINGS_KEY = 'AUTO_RIDE_SETTINGS';
const TTL_MS = 30 * 1000;
const cache = new Map(); // key -> { at, value }
// B1: a switch / settings write on one instance clears the cached value on every instance (utils/cacheBus).
const cacheBus = require('../../../utils/cacheBus');
cacheBus.register('flags.autoRide', (key) => { if (key) cache.delete(key); else cache.clear(); }, { resync: () => cache.clear() });

const GC = () => {
  const { getGlobalConfigModel } = require('../../../models/GlobalConfig');
  return getGlobalConfigModel();
};

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
    console.warn('[AUTORIDE_FLAG_WARN]', err.message);
    value = c ? c.value : undefined;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
};

const devEnabled = () => !isProduction() && String(process.env.AUTO_RIDE_DEV_ENABLE || '') === '1';

/** Is the customer / publish side on? Missing row = off (dev override only outside production). */
const readFlag = async ({ fresh = false } = {}) => !!(await cached(FLAG_KEY, async () => {
  const v = await readRow(FLAG_KEY);
  if (v === undefined) return devEnabled();
  return truthy(v);
}, fresh));

const readWalletFlag = async ({ fresh = false } = {}) => !!(await cached(WALLET_KEY, async () => truthy(await readRow(WALLET_KEY)), fresh));

const writeRow = async (key, value, description) => {
  const GlobalConfig = GC();
  const row = await GlobalConfig.findOne({ where: { key } });
  if (row) await row.update({ value });
  else await GlobalConfig.create({ key, value, description });
  cache.delete(key);
  cacheBus.broadcast('flags.autoRide', key); // B1: other instances re-read it too
  // GET /api/users/config (all GlobalConfig rows) is response-cached: show the new switch at once.
  try { require('../../../utils/realtime').publish('config', 'updated', key, { scope: 'global' }); } catch { /* cache just expires */ }
};

const writeFlag = async (enabled) => {
  await writeRow(FLAG_KEY, !!enabled, 'ZenWe Auto-Ride: shared autos seat booking (customers + driver publish)');
  return readFlag({ fresh: true });
};
const writeWalletFlag = async (enabled) => {
  await writeRow(WALLET_KEY, !!enabled, 'ZenWe Auto-Ride: allow ZenWe Wallet payments (off = cash only)');
  return readWalletFlag({ fresh: true });
};

const clampInt = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

/** Settings merged over defaults; every value range-checked (a bad row can never break booking). */
const normaliseSettings = (raw) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    platformMaxCapacity: clampInt(s.platformMaxCapacity, 1, LIMITS.ABSOLUTE_MAX_CAPACITY, d.platformMaxCapacity),
    holdMinutes: clampInt(s.holdMinutes, 1, 30, d.holdMinutes),
    privateRespondMinutes: clampInt(s.privateRespondMinutes, 2, 120, d.privateRespondMinutes),
    maxSeatsPerBooking: clampInt(s.maxSeatsPerBooking, 1, LIMITS.ABSOLUTE_MAX_CAPACITY, d.maxSeatsPerBooking),
    maxAdvanceDays: clampInt(s.maxAdvanceDays, 0, 30, d.maxAdvanceDays),
    reminderMinutes: clampInt(s.reminderMinutes, 0, 120, d.reminderMinutes),
    noShowGraceMinutes: clampInt(s.noShowGraceMinutes, 5, 240, d.noShowGraceMinutes),
    autoCompleteHours: clampInt(s.autoCompleteHours, 1, 48, d.autoCompleteHours),
    customerRefundBeforeConfirmPct: clampInt(s.customerRefundBeforeConfirmPct, 0, 100, d.customerRefundBeforeConfirmPct),
    customerRefundAfterConfirmPct: clampInt(s.customerRefundAfterConfirmPct, 0, 100, d.customerRefundAfterConfirmPct),
    chargeMaxHours: clampInt(s.chargeMaxHours, 1, 24, d.chargeMaxHours),
    arrivalWindowMinutes: clampInt(s.arrivalWindowMinutes, 5, 60, d.arrivalWindowMinutes),
  };
};

const readSettings = async ({ fresh = false } = {}) => normaliseSettings(await cached(SETTINGS_KEY, () => readRow(SETTINGS_KEY), fresh));

/** Partial update; unknown keys ignored, invalid values refused with 400. */
const writeSettings = async (patch) => {
  const current = await readSettings({ fresh: true });
  const next = { ...current };
  const ranges = {
    platformMaxCapacity: [1, LIMITS.ABSOLUTE_MAX_CAPACITY], holdMinutes: [1, 30], privateRespondMinutes: [2, 120],
    maxSeatsPerBooking: [1, LIMITS.ABSOLUTE_MAX_CAPACITY], maxAdvanceDays: [0, 30], reminderMinutes: [0, 120],
    noShowGraceMinutes: [5, 240], autoCompleteHours: [1, 48], customerRefundBeforeConfirmPct: [0, 100], customerRefundAfterConfirmPct: [0, 100],
    chargeMaxHours: [1, 24], arrivalWindowMinutes: [5, 60],
  };
  for (const [k, [min, max]] of Object.entries(ranges)) {
    if (patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw fail(400, 'INVALID_INPUT', `${k} must be a whole number between ${min} and ${max}.`, { field: k });
    next[k] = n;
  }
  if (next.maxSeatsPerBooking > next.platformMaxCapacity) {
    const field = patch.maxSeatsPerBooking !== undefined ? 'maxSeatsPerBooking' : 'platformMaxCapacity';
    throw fail(400, 'INVALID_INPUT', `Seats per booking (${next.maxSeatsPerBooking}) cannot be more than the platform max capacity (${next.platformMaxCapacity}).`, { field });
  }
  await writeRow(SETTINGS_KEY, next, 'ZenWe Auto-Ride settings (capacity cap, hold minutes, refund policy)');
  return readSettings({ fresh: true });
};

/**
 * The settings customers / drivers may see (read-only; everything is enforced server-side anyway).
 * Refund % apply to Zenvy Wallet payments cancelled by the passenger; cash is only paid at boarding.
 */
const publicSettings = async () => {
  const s = await readSettings();
  return {
    maxSeatsPerBooking: Math.min(s.maxSeatsPerBooking, s.platformMaxCapacity),
    holdMinutes: s.holdMinutes,
    refundBeforeDriverConfirmPct: s.customerRefundBeforeConfirmPct,
    refundAfterDriverConfirmPct: s.customerRefundAfterConfirmPct,
    maxAdvanceDays: s.maxAdvanceDays,
    platformMaxCapacity: s.platformMaxCapacity,
    privateRespondMinutes: s.privateRespondMinutes,
    arrivalWindowMinutes: s.arrivalWindowMinutes,
    walletEnabled: await readWalletFlag(),
  };
};

const clearCache = () => cache.clear();

/** Customer gate: feature on (unless opts.allowWhenOff). protect() has already loaded a live account. */
const requireCustomer = (opts = {}) => async (req, res, next) => {
  try {
    // S1: rider (delivery partner) and store tokens are not customer accounts either (same rule as Campus Events).
    if (!req.user || !req.user.id || ['auto_driver', 'rider', 'restaurant'].includes(String(req.user.role || '').toLowerCase())) {
      throw fail(401, 'NOT_AUTHORISED', 'Sign in with your ZenWe account.');
    }
    if (!opts.allowWhenOff && !(await readFlag())) {
      throw fail(403, 'FEATURE_OFF', 'ZenWe Auto-Ride is not open yet. Please check back soon.');
    }
    return next();
  } catch (err) {
    return require('./util').sendError(res, err, 'AUTORIDE_GATE');
  }
};

/** Driver gate for publish-type actions. */
const assertOn = async () => {
  if (!(await readFlag())) throw fail(403, 'FEATURE_OFF', 'ZenWe Auto-Ride is not open for bookings yet. Your trip stays saved as a draft.');
};

module.exports = {
  FLAG_KEY, WALLET_KEY, SETTINGS_KEY, readFlag, readWalletFlag, writeFlag, writeWalletFlag, readSettings, writeSettings,
  publicSettings, normaliseSettings, clearCache, requireCustomer, assertOn, devEnabled,
};
