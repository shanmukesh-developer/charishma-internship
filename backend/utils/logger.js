// A6: tiny in-house structured logging (no pino: one less dependency on the hot path).
//
// • Request id      every request gets one (perfMetrics.middleware reads X-Request-Id or makes one, keeps it
//                   in its AsyncLocalStorage context and echoes it as X-Request-Id). currentRequestId() reads
//                   it anywhere inside the request (controllers, Sequelize hooks, pushes started by it).
// • Access log      LOG_FORMAT=text (default: today's morgan line, unchanged except sensitive query values are
//                   masked) | json (one compact JSON line per request: reqId, method, route, status, ms, bytes,
//                   inst). ACCESS_LOG=all|errors|off still decides which requests are logged.
// • Error logs      logError(tag, err, extra): redacted message + stack, with reqId; JSON in json mode.
// • redact(text)    masks emails, Indian mobile numbers, JWTs / bearer tokens, FCM tokens, long secrets and
//                   key=value / "key":"value" pairs whose key looks like password / otp / token / secret / phone.
//
// Nothing here throws: logging must never break a request.

const crypto = require('crypto');

const logFormat = () => (String(process.env.LOG_FORMAT || 'text').trim().toLowerCase() === 'json' ? 'json' : 'text');
const accessLogMode = () => {
  const v = String(process.env.ACCESS_LOG || 'all').trim().toLowerCase();
  return v === 'off' || v === 'errors' ? v : 'all';
};

// ── request id ────────────────────────────────────────────────────────────────
// Accept a caller's id only when it is short and boring (no log injection, no PII smuggling).
const REQ_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const newRequestId = () => crypto.randomUUID();
const pickRequestId = (incoming) => {
  const v = Array.isArray(incoming) ? incoming[0] : incoming;
  return typeof v === 'string' && REQ_ID_RE.test(v.trim()) ? v.trim() : newRequestId();
};
const currentContext = () => {
  try { return require('./perfMetrics')._als.getStore() || null; } catch { return null; }
};
const currentRequestId = () => {
  const ctx = currentContext();
  return (ctx && ctx.reqId) || null;
};

const instanceId = () => {
  try { return require('./redis').INSTANCE_ID || null; } catch { return null; }
};

// ── redaction ─────────────────────────────────────────────────────────────────
// sig: the signature of a signed media / booking-document link (a bearer link for 60-90 minutes).
const SENSITIVE_KEY = '(?:password|passwd|pwd|otp|otpCode|pin|token|accessToken|refreshToken|idToken|fcmToken|pushToken|secret|apiKey|api_key|api-key|authorization|cookie|phone|phoneNumber|mobile|email|aadhaar|cardNumber|cvv|sig)';
const RULES = [
  // "key": "value"  /  'key': 'value'
  [new RegExp(`(["']${SENSITIVE_KEY}["']\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^,}\\s]+)`, 'gi'), '$1"[REDACTED]"'],
  // key=value (query strings, form bodies, log text)
  [new RegExp(`(\\b${SENSITIVE_KEY}=)([^&\\s"',;]+)`, 'gi'), '$1[REDACTED]'],
  // Authorization headers / bearer tokens
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[JWT]'],
  // Expo push tokens
  [/ExponentPushToken\[[^\]]+\]/g, '[PUSH_TOKEN]'],
  // FCM registration tokens (long, with a colon)
  [/\b[A-Za-z0-9_-]{10,}:[A-Za-z0-9_-]{60,}\b/g, '[PUSH_TOKEN]'],
  // emails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  // Indian mobile numbers: optional +91 / 91 / 0, then 10 digits starting 6-9 (not inside a longer number / id)
  [/(?<![\w-])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\w-])/g, '[PHONE]'],
  // very long opaque strings (API keys, signed URLs' signatures, base64 blobs)
  [/\b[A-Za-z0-9+/_-]{120,}={0,2}/g, '[LONG_VALUE]'],
];
const MAX_LOG_TEXT = 4000;
const redact = (input) => {
  if (input === null || input === undefined) return input;
  let s = typeof input === 'string' ? input : (() => { try { return JSON.stringify(input); } catch { return String(input); } })();
  if (s.length > MAX_LOG_TEXT * 4) s = s.slice(0, MAX_LOG_TEXT * 4);
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return s.length > MAX_LOG_TEXT ? `${s.slice(0, MAX_LOG_TEXT)}…[truncated]` : s;
};

/** URL path + query with every sensitive query value masked (never the raw phone / token / OTP). */
const redactUrl = (url) => {
  const s = String(url || '');
  const q = s.indexOf('?');
  if (q < 0) return redact(s);
  return redact(s.slice(0, q)) + '?' + redact(s.slice(q + 1));
};

// ── writers ───────────────────────────────────────────────────────────────────
const writeJson = (level, obj) => {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), level, ...obj });
    if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
  } catch { /* never throw from a log */ }
};

const errorParts = (err) => {
  if (err instanceof Error) return { message: redact(err.message || String(err)), stack: redact(err.stack || '') };
  return { message: redact(err), stack: null };
};

/**
 * Logs an error with the current request id. Text mode keeps the familiar "[TAG] …" shape.
 * extra: plain fields (method, route, status …); they are redacted too.
 */
const logError = (tag, err, extra = {}) => {
  try {
    const reqId = extra.reqId || currentRequestId();
    const { message, stack } = errorParts(err);
    const fields = {};
    for (const [k, v] of Object.entries(extra || {})) if (k !== 'reqId' && v !== undefined) fields[k] = typeof v === 'string' ? redact(v) : v;
    if (logFormat() === 'json') {
      writeJson('error', { msg: tag, reqId: reqId || undefined, inst: instanceId() || undefined, ...fields, err: message, stack: stack || undefined });
      return;
    }
    const ctxText = Object.values(fields).filter((v) => v !== undefined && v !== null && v !== '').join(' ');
    console.error(`${tag}${ctxText ? ` ${ctxText}` : ''}${reqId ? ` reqId=${reqId}` : ''}`, stack || message);
  } catch { /* never throw from a log */ }
};

const logWarn = (tag, message, extra = {}) => {
  try {
    const reqId = extra.reqId || currentRequestId();
    if (logFormat() === 'json') {
      const fields = {};
      for (const [k, v] of Object.entries(extra || {})) if (k !== 'reqId' && v !== undefined) fields[k] = typeof v === 'string' ? redact(v) : v;
      writeJson('warn', { msg: tag, reqId: reqId || undefined, ...fields, detail: redact(message) });
      return;
    }
    console.warn(tag, ...Object.entries(extra || {}).filter(([k]) => k !== 'reqId').map(([, v]) => (typeof v === 'string' ? redact(v) : v)), redact(message), reqId ? `reqId=${reqId}` : '');
  } catch { /* never throw from a log */ }
};

// ── access log ────────────────────────────────────────────────────────────────
/** One compact JSON object per finished request (LOG_FORMAT=json). Exported for tests. */
const accessRecord = (req, res, ms) => {
  let route = null;
  try { route = require('./perfMetrics').routeKey(req).replace(/^[A-Z]+ /, ''); } catch { route = null; }
  const len = Number(res.getHeader && res.getHeader('content-length'));
  return {
    msg: 'http',
    reqId: (req._perf && req._perf.reqId) || req.id || null,
    method: req.method,
    route: route ? redact(route) : null,
    status: res.statusCode,
    ms: Math.round(ms * 10) / 10,
    ...(Number.isFinite(len) ? { bytes: len } : {}),
    inst: instanceId(),
  };
};

/**
 * Express middleware for the per-request access line. Text mode = the existing morgan format, with the
 * URL's sensitive values masked. JSON mode = accessRecord(). ACCESS_LOG decides which requests are logged.
 */
const accessLogMiddleware = () => {
  const mode = accessLogMode();
  if (mode === 'off') return (req, res, next) => next();
  const skipFn = mode === 'errors' ? (req, res) => res.statusCode < 400 : () => false;
  if (logFormat() === 'json') {
    return (req, res, next) => {
      const t0 = process.hrtime.bigint();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          if (skipFn(req, res)) return;
          const rec = accessRecord(req, res, Number(process.hrtime.bigint() - t0) / 1e6);
          writeJson(res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info'), rec);
        } catch { /* never break a response for a log */ }
      };
      res.once('finish', finish);
      res.once('close', finish);
      next();
    };
  }
  const morgan = require('morgan');
  morgan.token('safe-url', (req) => redactUrl(req.originalUrl || req.url));
  return morgan(':method :safe-url :status :res[content-length] - :response-time ms', mode === 'errors' ? { skip: skipFn } : {});
};

module.exports = {
  logFormat,
  accessLogMode,
  pickRequestId,
  newRequestId,
  currentRequestId,
  currentContext,
  redact,
  redactUrl,
  logError,
  logWarn,
  accessRecord,
  accessLogMiddleware,
  REQ_ID_RE,
};
