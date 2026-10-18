/**
 * C7 rentals safety: admin-tunable settings (GlobalConfig RENTALS_SAFETY_SETTINGS, cached 30 s, re-read on
 * every instance through utils/cacheBus), the per-booking terms for each mode (RENT / BORROW) and the
 * insurance / liability disclaimer shown on the listing detail and the booking review.
 *
 *   { conditionPhotosRequired: true,   // pickup + return photos and odometer before the PIN step
 *     otherChargesCap: 5000,           // INR, and never more than 2 x the deposit (when there is one)
 *     chargesResponseHours: 48,        // renter / borrower accepts or disputes extra charges within this
 *     disclaimer: '' }                 // optional override of the default disclaimer text
 *
 * The default disclaimer is built from the legal settings (business name) so it matches /legal/terms.
 * Every read fails soft to the defaults.
 */
const E = require('../enums');

const KEY = 'RENTALS_SAFETY_SETTINGS';
const TTL_MS = 30 * 1000;
const DEFAULTS = Object.freeze({
  conditionPhotosRequired: true,
  otherChargesCap: E.LIMITS.DEFAULT_OTHER_CHARGES_CAP,
  chargesResponseHours: E.LIMITS.DEFAULT_CHARGES_RESPONSE_HOURS,
  disclaimer: '',
});
const BOUNDS = { otherChargesCap: [0, 50000], chargesResponseHours: [1, 168] };
const DISCLAIMER_MAX = 1000;

let cache = { at: 0, value: { ...DEFAULTS } };
const cacheBus = require('../../../utils/cacheBus');
const forget = () => { cache = { at: 0, value: cache.value }; };
cacheBus.register('rentals.safety', forget, { resync: forget });

const clean = (s) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim(); // eslint-disable-line no-control-regex

/** Stored value (any shape) -> full settings. Bad fields fall back to the defaults. */
const parse = (raw) => {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  const out = { ...DEFAULTS };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.conditionPhotosRequired === 'boolean') out.conditionPhotosRequired = v.conditionPhotosRequired;
  for (const k of ['otherChargesCap', 'chargesResponseHours']) {
    const n = Number(v[k]);
    if (Number.isFinite(n) && n >= BOUNDS[k][0] && n <= BOUNDS[k][1]) out[k] = k === 'chargesResponseHours' ? Math.round(n) : Math.round(n * 100) / 100;
  }
  if (typeof v.disclaimer === 'string') out.disclaimer = clean(v.disclaimer).slice(0, DISCLAIMER_MAX);
  return out;
};

const GC = () => {
  const { getGlobalConfigModel } = require('../../../models/GlobalConfig');
  return getGlobalConfigModel();
};

const readSettings = async ({ fresh = false } = {}) => {
  if (!fresh && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = { ...DEFAULTS };
  try {
    const G = GC();
    const row = G ? await G.findOne({ where: { key: KEY } }) : null;
    if (row) value = parse(row.value);
  } catch (err) {
    console.warn('[RENTALS_SAFETY_WARN]', err.message);
    value = cache.value || { ...DEFAULTS };
  }
  cache = { at: Date.now(), value };
  return value;
};

/**
 * Validates a partial update from the admin page and stores the merged settings.
 * Throws a RentalsError (400) on a bad field. Returns the new settings.
 */
const writeSettings = async (patch) => {
  const { fail } = require('./util');
  const p = patch && typeof patch === 'object' ? patch : {};
  const cur = await readSettings({ fresh: true });
  const next = { ...cur };
  if (p.conditionPhotosRequired !== undefined) {
    if (typeof p.conditionPhotosRequired !== 'boolean') throw fail(400, 'INVALID_INPUT', 'conditionPhotosRequired must be true or false.', { field: 'conditionPhotosRequired' });
    next.conditionPhotosRequired = p.conditionPhotosRequired;
  }
  for (const k of ['otherChargesCap', 'chargesResponseHours']) {
    if (p[k] === undefined) continue;
    const n = Number(p[k]);
    const [min, max] = BOUNDS[k];
    if (!Number.isFinite(n) || n < min || n > max || (k === 'chargesResponseHours' && !Number.isInteger(n))) {
      throw fail(400, 'INVALID_INPUT', `${k === 'otherChargesCap' ? 'Other charges cap' : 'Response window (hours)'} must be ${k === 'chargesResponseHours' ? 'a whole number' : 'a number'} between ${min} and ${max}.`, { field: k });
    }
    next[k] = k === 'chargesResponseHours' ? n : Math.round(n * 100) / 100;
  }
  if (p.disclaimer !== undefined) {
    if (p.disclaimer !== null && typeof p.disclaimer !== 'string') throw fail(400, 'INVALID_INPUT', 'Disclaimer must be text.', { field: 'disclaimer' });
    next.disclaimer = clean(p.disclaimer).slice(0, DISCLAIMER_MAX);
  }
  const G = GC();
  const row = await G.findOne({ where: { key: KEY } });
  if (row) await row.update({ value: next });
  else await G.create({ key: KEY, value: next, description: 'Rentals safety: condition photos, extra-charges cap, response window, disclaimer (C7)' });
  cache = { at: Date.now(), value: next };
  cacheBus.broadcast('rentals.safety');
  return next;
};

/** Highest "other charges" an owner / lender may claim on one trip: setting, and at most 2 x deposit. */
const otherChargesCapFor = (settings, deposit) => {
  const cap = Number(settings && settings.otherChargesCap);
  const base = Number.isFinite(cap) ? cap : DEFAULTS.otherChargesCap;
  const d = Number(deposit) || 0;
  return d > 0 ? Math.min(base, Math.round(2 * d * 100) / 100) : base;
};

const businessName = async () => {
  try {
    const s = await require('../../../utils/legalSettings').getSettings();
    return (s && s.businessName) || 'Zenvy';
  } catch {
    return 'Zenvy';
  }
};

const defaultDisclaimer = (biz) => `${biz} is not an insurer and does not provide any insurance for this trip. Whether the vehicle's insurance covers you as a driver depends on that policy, so check before you ride. The agreement is between the two students: ${biz} is not a party to it, never holds the money and cannot force either side to pay.`;

/** The terms the renter / borrower accepts for one booking (version E.TERMS_VERSION). */
const termsFor = (mode, { biz = 'Zenvy', hours = DEFAULTS.chargesResponseHours } = {}) => {
  const common = [
    `Pay any ${mode === E.RENTAL_MODES.RENT ? 'rent' : 'cost share'} and the refundable deposit in cash, directly to the ${mode === E.RENTAL_MODES.RENT ? 'owner' : 'lender'}. ${biz} never holds the money.`,
    'Photos of the vehicle and the odometer reading are recorded at pickup and at return. Check them before you ride.',
    `Any extra charges must be explained in the app. You can accept or dispute them within ${hours} hours; disputes are reviewed by the ${biz} team.`,
  ];
  if (mode === E.RENTAL_MODES.RENT) {
    return [
      'This is a commercial (rental number plate) vehicle that its owner rents out.',
      "The owner is responsible for the vehicle's rental permit, valid insurance and roadworthiness.",
      'You must hold a valid driving licence for this vehicle class, carry it while driving and follow traffic rules (helmet on two-wheelers, no drink driving).',
      'You are responsible for traffic fines (challans), tolls, parking and any damage you cause during the booking period.',
      ...common,
    ];
  }
  return [
    "This is the lender's personal (private number plate) vehicle, lent to you between students on a non-commercial basis. It is not a commercial rental.",
    'You (the borrower) are responsible for any damage, fuel, traffic fines (challans), tolls and parking during the booking period.',
    'No commercial use: do not use the vehicle for paid rides, deliveries, or lend it on to anyone else.',
    'You must hold a valid driving licence for this vehicle class, carry it while driving and follow traffic rules (helmet on two-wheelers, no drink driving).',
    ...common,
  ];
};

/** Everything the apps show around a booking for `mode` (listing detail, booking review, booking screen). */
const safetyInfo = async (mode) => {
  const [settings, biz] = await Promise.all([readSettings(), businessName()]);
  const m = mode === E.RENTAL_MODES.RENT ? E.RENTAL_MODES.RENT : E.RENTAL_MODES.BORROW;
  return {
    rentalMode: m,
    termsVersion: E.TERMS_VERSION,
    terms: termsFor(m, { biz, hours: settings.chargesResponseHours }),
    disclaimer: settings.disclaimer || defaultDisclaimer(biz),
    conditionPhotosRequired: settings.conditionPhotosRequired,
    chargesResponseHours: settings.chargesResponseHours,
    otherChargesCap: settings.otherChargesCap,
  };
};

const resetCache = () => { cache = { at: 0, value: { ...DEFAULTS } }; };

module.exports = {
  KEY, DEFAULTS, parse, readSettings, writeSettings, otherChargesCapFor, termsFor, defaultDisclaimer, safetyInfo, businessName, resetCache,
};
