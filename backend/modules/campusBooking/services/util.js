// In-Campus Booking helpers: errors, text cleaning, money, per-account rate limits.
const crypto = require('crypto');
const { FRIENDLY_SERVER_ERROR } = require('../../../utils/env');
const sharedLimits = require('../../../utils/sharedRateLimit');

class CampusBookingError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}
const fail = (status, code, message, extra) => new CampusBookingError(status, code, message, extra);

const sendError = (res, err, tag = 'CAMPUS_BOOKING') => {
  if (res.headersSent) return res;
  if (err instanceof CampusBookingError) {
    return res.status(err.status).json({ code: err.code, message: err.message, ...(err.extra || {}) });
  }
  console.error(`[${tag}_ERR]`, err && err.stack ? err.stack : err);
  return res.status(500).json({ code: 'SERVER_ERROR', message: FRIENDLY_SERVER_ERROR });
};

const handler = (fn, tag) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    sendError(res, err, tag);
  }
};

// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const cleanText = (v, max) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(CTRL_RE, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const rupees = (paise) => Math.round(Number(paise) || 0) / 100;

// UPI VPA: handle@bank (the same shape utils/storeCompliance accepts for payout UPI IDs).
const UPI_RE = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;
const normalizeUpiId = (v) => {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  return UPI_RE.test(s) && s.length <= 120 ? s : null;
};
// UPI transaction reference (UTR is 12 digits; some apps show longer alphanumeric ids).
const REF_RE = /^[A-Z0-9]{6,35}$/;
const normalizeRef = (v) => {
  const s = String(v || '').toUpperCase().replace(/[\s-]/g, '');
  return REF_RE.test(s) ? s : null;
};

// Unambiguous alphabet (no 0/O, 1/I/L): pickup codes and booking refs are read aloud at a counter.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (len) => {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
};
// A pickup code always mixes letters and digits ("A3F7"), so it never reads as a word or a number.
const pickupCode = () => {
  for (;;) {
    const c = randomCode(4);
    if (/[A-Z]/.test(c) && /[0-9]/.test(c)) return c;
  }
};
const normalizePickupCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

// ── Per-account sliding-window limits (shared across instances when REDIS_URL is set). ──
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of buckets) if (!list.length || now - list[list.length - 1] > 24 * 60 * 60 * 1000) buckets.delete(k);
}, 30 * 60 * 1000).unref?.();

const RATE = {
  book: { max: 12, windowMs: 60 * 60 * 1000, message: 'Too many bookings in a short time. Please wait a while and try again.' },
  proof: { max: 15, windowMs: 60 * 60 * 1000, message: 'Too many payment proofs sent. Please wait a while and try again.' },
  cancel: { max: 20, windowMs: 60 * 60 * 1000, message: 'Too many changes. Please wait a while and try again.' },
  vendor_action: { max: 300, windowMs: 60 * 60 * 1000, message: 'Too many updates in a short time. Please wait a minute.' },
  vendor_settings: { max: 30, windowMs: 60 * 60 * 1000, message: 'Too many changes. Please try again later.' },
  pickup_code: { max: 40, windowMs: 15 * 60 * 1000, message: 'Too many pickup code checks. Please wait a few minutes.' },
};

const hit = (kind, accountId) => {
  const cfg = RATE[kind];
  if (!cfg) return;
  const key = `${kind}:${accountId}`;
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < cfg.windowMs);
  if (list.length >= cfg.max) {
    buckets.set(key, list);
    throw fail(429, 'RATE_LIMITED', cfg.message, { retryAfter: Math.max(1, Math.ceil((cfg.windowMs - (now - list[0])) / 1000)) });
  }
  const sharedRetry = sharedLimits.gate('campusBooking', key, cfg.max, cfg.windowMs, now);
  if (sharedRetry !== null) {
    buckets.set(key, list);
    throw fail(429, 'RATE_LIMITED', cfg.message, { retryAfter: sharedRetry });
  }
  list.push(now);
  buckets.set(key, list);
};
const resetLimits = () => { buckets.clear(); sharedLimits.resetGate('campusBooking:'); };

module.exports = {
  CampusBookingError, fail, sendError, handler, cleanText, isUuid, toPaise, rupees,
  normalizeUpiId, normalizeRef, randomCode, pickupCode, normalizePickupCode, ALPHABET, hit, resetLimits,
};
