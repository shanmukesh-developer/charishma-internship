// Small shared helpers for Campus Events: errors, text cleaning, numbers, codes, rate limits, audit.
// Same conventions as modules/autoRide/services/util.js.
const crypto = require('crypto');
const { FRIENDLY_SERVER_ERROR } = require('../../../utils/env');
const clock = require('./clock');

class CampusEventsError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}
const fail = (status, code, message, extra) => new CampusEventsError(status, code, message, extra);

const isUniqueError = (err) => !!err && (err.name === 'SequelizeUniqueConstraintError'
  || /UNIQUE constraint failed|duplicate key value/i.test(String((err && err.message) || (err && err.parent && err.parent.message) || '')));

/** Known errors -> { code, message, ...extra }; anything else -> friendly 500 (details logged). */
const sendError = (res, err, tag = 'CAMPUS_EVENTS') => {
  if (res.headersSent) return res;
  if (err instanceof CampusEventsError) {
    if (err.extra && err.extra.retryAfter) res.set('Retry-After', String(err.extra.retryAfter));
    return res.status(err.status).json({ code: err.code, message: err.message, ...(err.extra || {}) });
  }
  if (isUniqueError(err)) {
    return res.status(409).json({ code: 'CONFLICT', message: 'That changed just now. Please refresh and try again.' });
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
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const cleanText = (v, max, { multiline = false } = {}) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  let s = String(v).replace(CTRL_RE, '').replace(/[<>]/g, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const assertUuid = (v, what = 'item') => {
  if (!isUuid(String(v || ''))) throw fail(404, 'NOT_FOUND', `This ${what} was not found.`);
  return String(v);
};

const num = (v, { min = 0, max = Number.MAX_SAFE_INTEGER, int = false, field = 'value', label, decimals = 2 } = {}) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (typeof v === 'boolean' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw fail(400, 'INVALID_INPUT', `${label || field} must be ${int ? 'a whole number' : 'a number'} between ${min} and ${max}.`, { field });
  }
  if (int) return n;
  const f = 10 ** Math.max(0, Math.min(10, Number(decimals) || 0));
  return Math.round(n * f) / f;
};
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toPaise = (rupees) => Math.round(money(rupees) * 100);

const parseTime = (v, field) => {
  const d = v instanceof Date ? v : new Date(String(v || ''));
  if (!v || Number.isNaN(d.getTime())) throw fail(400, 'INVALID_INPUT', `${field} must be a date and time.`, { field });
  return d;
};
const optTime = (v, field) => (v === undefined || v === null || v === '' ? null : parseTime(v, field));
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const iso = (d) => (d ? new Date(d).toISOString() : null);
const ms = (d) => (d ? new Date(d).getTime() : null);

// Unambiguous alphabets. Registration code EV-XXXXXX; ticket code 10-char Crockford base32.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const randomFrom = (alphabet, n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
  return s;
};
const newRegCode = () => `EV-${randomFrom(CODE_ALPHABET, 6)}`;
const newTicketCode = () => randomFrom(CROCKFORD, 10);
/** Typed ticket codes: upper case, Crockford look-alikes folded (O->0, I/L->1), separators dropped. */
const normalizeTicketCode = (v) => String(v || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').slice(0, 12);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || !x.length) return false;
  return crypto.timingSafeEqual(x, y);
};

// ── In-memory rate limits (per account / key, sliding window). Resets on restart.
const sharedLimits = require('../../../utils/sharedRateLimit');
const buckets = new Map();
setInterval(() => {
  const t = Date.now();
  for (const [k, list] of buckets) if (!list.length || t - list[list.length - 1] > 24 * 60 * 60 * 1000) buckets.delete(k);
}, 30 * 60 * 1000).unref?.();

const RATE = {
  register: { max: Number(process.env.CAMPUS_EVENTS_REGISTER_PER_10MIN) || 30, windowMs: 10 * 60 * 1000, message: 'Too many registration attempts. Please wait a few minutes.' },
  invite: { max: 40, windowMs: 60 * 60 * 1000, message: 'Too many invitations. Please wait a while and try again.' },
  check_in: { max: Number(process.env.CAMPUS_EVENTS_CHECKIN_PER_MIN) || 120, windowMs: 60 * 1000, message: 'Too many scans in a minute. Please slow down.' },
  organizer_write: { max: 200, windowMs: 60 * 60 * 1000, message: 'Too many changes. Please slow down and try again in a while.' },
  apply: { max: 5, windowMs: 24 * 60 * 60 * 1000, message: 'Too many organizer applications today.' },
  join: { max: 30, windowMs: 10 * 60 * 1000, message: 'Too many join attempts. Please wait a few minutes.' },
  join_preview: { max: Number(process.env.CAMPUS_EVENTS_JOIN_PREVIEW_PER_10MIN) || 30, windowMs: 10 * 60 * 1000, message: 'Too many join links opened. Please wait a few minutes.' },
  user_search: { max: 120, windowMs: 10 * 60 * 1000, message: 'Too many searches. Please wait a minute.' },
};

/** Throws 429 when over the limit, otherwise records the hit. cfg overrides the named limit. */
const hit = (kind, id, cfg = RATE[kind]) => {
  if (!cfg) return;
  const key = `${kind}:${id}`;
  const t = Date.now();
  const list = (buckets.get(key) || []).filter((x) => t - x < cfg.windowMs);
  if (list.length >= cfg.max) {
    buckets.set(key, list);
    const retryAfter = Math.max(1, Math.ceil((cfg.windowMs - (t - list[0])) / 1000));
    throw fail(429, 'RATE_LIMITED', cfg.message, { retryAfter });
  }
  // B1: the same limit across every instance when REDIS_URL is set (utils/sharedRateLimit; no-op otherwise).
  const sharedRetry = sharedLimits.gate('events', key, cfg.max, cfg.windowMs, t);
  if (sharedRetry !== null) {
    buckets.set(key, list);
    throw fail(429, 'RATE_LIMITED', cfg.message, { retryAfter: sharedRetry });
  }
  list.push(t);
  buckets.set(key, list);
};
const resetLimits = () => { buckets.clear(); sharedLimits.resetGate('events:'); };

/** Admin audit mirror in VerificationLog (the admin panel's shared audit table). Never throws. */
const adminAudit = async (req, targetId, action, details) => {
  try {
    const { getVerificationLogModel } = require('../../../models/VerificationLog');
    const VerificationLog = getVerificationLogModel();
    if (!VerificationLog) return;
    await VerificationLog.create({
      adminId: req && req.user && req.user.id ? String(req.user.id) : 'admin',
      targetId: targetId ? String(targetId) : 'global',
      action,
      details: JSON.stringify(details || {}).slice(0, 8000),
      timestamp: clock.now(),
    });
  } catch (err) {
    console.warn('[CAMPUS_EVENTS_AUDIT_WARN]', err.message);
  }
};

const pageOpts = (query, dflt = 50, maxLimit = 200) => {
  const q = query || {};
  const limit = num(q.limit, { min: 1, max: maxLimit, int: true, field: 'limit' }) || dflt;
  const page = num(q.page, { min: 1, max: 100000, int: true, field: 'page' }) || 1;
  return { page, limit, offset: (page - 1) * limit, fetch: limit + 1 };
};
const paginate = (rows, p) => {
  const hasMore = rows.length > p.limit;
  return { rows: hasMore ? rows.slice(0, p.limit) : rows, pagination: { page: p.page, limit: p.limit, hasMore } };
};

const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };

/** Admin-only contact masks: last 4 digits of a phone, first letter + domain of an e-mail. */
const maskPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 4 ? `******${d.slice(-4)}` : null;
};
const maskEmail = (e) => {
  const s = String(e || '').trim();
  const at = s.indexOf('@');
  if (at < 1) return null;
  return `${s[0]}***${s.slice(at)}`;
};

/**
 * Canonical form for "did this field really change?" checks: empty string / null / undefined / [] are all
 * "empty"; dates compare by instant; nested objects ignore key order and empty / false members (so
 * { adultOnly: false, years: [] } equals {}); numbers compare by value.
 */
const canon = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) { const a = v.map((x) => canon(x)); return a.length ? a : null; }
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const c = canon(v[k]);
      if (c === null || c === false) continue;
      out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
};
/** Dates may arrive as ISO strings on one side (pendingChanges JSON): compare instants when both parse. */
const sameValue = (a, b) => {
  const ta = a instanceof Date ? a.getTime() : null;
  const tb = b instanceof Date ? b.getTime() : null;
  if (ta !== null || tb !== null) {
    const x = ta !== null ? ta : (a ? new Date(a).getTime() : null);
    const y = tb !== null ? tb : (b ? new Date(b).getTime() : null);
    return (x === null || Number.isNaN(x) ? null : x) === (y === null || Number.isNaN(y) ? null : y);
  }
  return JSON.stringify(canon(jsonish(a))) === JSON.stringify(canon(jsonish(b)));
};
// A JSON column can read back as its text (SQLite defaults): compare the parsed value.
const jsonish = (v) => {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v;
  try { return JSON.parse(v); } catch { return v; }
};

module.exports = {
  maskPhone, maskEmail, canon, sameValue,
  CampusEventsError, fail, sendError, handler, isUniqueError, cleanText, isUuid, assertUuid, num, money, toPaise, parseTime, optTime,
  bool, iso, ms, newRegCode, newTicketCode, normalizeTicketCode, sha256, safeEqual, hit, resetLimits, RATE, adminAudit, pageOpts,
  paginate, noStore, UUID_RE,
};
