/* global AbortSignal */
// A6: error-tracking hook (off by default, no new dependency).
//
// ERROR_WEBHOOK_URL set (https://… — Slack / Discord / any collector that accepts a JSON POST) turns it on.
// Every 5xx route error, unhandled promise rejection and uncaught exception is POSTed there, redacted
// (utils/logger.redact: no emails, phones, tokens, OTPs, passwords), with the request id and instance id.
//   ERROR_REPORT_MAX_PER_MIN  default 10   reports per minute per process (the rest are counted as dropped)
//   ERROR_REPORT_DEDUPE_MS    default 60000 the same error (tag + message) is sent once per window
//   ERROR_REPORT_TIMEOUT_MS   default 5000 per POST; failures are logged once per minute, never thrown
// Counters (always on, even without a webhook) feed the [PERF] line and GET /api/admin/metrics/perf.

const counters = {
  serverErrors: 0, // 5xx answered by the global error handler
  unhandledRejections: 0,
  uncaughtExceptions: 0,
  reported: 0,
  dropped: 0, // rate-limited or deduplicated
  reportFailures: 0,
};

const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.min(max, n) : def;
};
const webhookUrl = () => {
  const u = String(process.env.ERROR_WEBHOOK_URL || '').trim();
  return /^https?:\/\/\S+$/i.test(u) ? u : null;
};
const isEnabled = () => !!webhookUrl();

let windowStart = 0;
let sentInWindow = 0;
const recent = new Map(); // fingerprint -> last sent at
let lastFailureLogAt = 0;
let fetchImpl = null; // tests

const allow = (fingerprint, now) => {
  const dedupeMs = num(process.env.ERROR_REPORT_DEDUPE_MS, 60000, 0, 24 * 3600 * 1000);
  const last = recent.get(fingerprint);
  if (dedupeMs > 0 && last && now - last < dedupeMs) return false;
  if (now - windowStart >= 60000) { windowStart = now; sentInWindow = 0; }
  if (sentInWindow >= num(process.env.ERROR_REPORT_MAX_PER_MIN, 10, 0, 1000)) return false;
  sentInWindow++;
  recent.set(fingerprint, now);
  if (recent.size > 500) recent.delete(recent.keys().next().value);
  return true;
};

/**
 * Report an error (fire-and-forget). Returns a promise that resolves to true when it was sent,
 * false when off / limited / failed. Never rejects.
 *   kind: 'route' | 'unhandledRejection' | 'uncaughtException' | any short tag
 */
const report = (kind, err, extra = {}) => {
  try {
    const url = webhookUrl();
    if (!url) return Promise.resolve(false);
    const { redact, currentRequestId } = require('./logger');
    const message = redact(err && err.message ? err.message : String(err)).slice(0, 500);
    const now = Date.now();
    if (!allow(`${kind}|${message}`, now)) { counters.dropped++; return Promise.resolve(false); }
    let instance = null;
    try { instance = require('./redis').INSTANCE_ID; } catch { instance = null; }
    const payload = {
      service: 'zenvy-backend',
      kind,
      message,
      stack: err && err.stack ? redact(String(err.stack)).slice(0, 3000) : null,
      reqId: extra.reqId || currentRequestId() || null,
      method: extra.method || null,
      route: extra.route ? redact(String(extra.route)).slice(0, 200) : null,
      status: extra.status || null,
      instance,
      env: process.env.RENDER === 'true' ? 'render' : (process.env.NODE_ENV || 'development'),
      at: new Date(now).toISOString(),
    };
    // Slack / Discord style collectors show `text` / `content`; others read the full object.
    payload.text = `[${payload.kind}] ${payload.message}${payload.route ? ` (${payload.method || ''} ${payload.route})` : ''}${payload.reqId ? ` reqId=${payload.reqId}` : ''}`;
    payload.content = payload.text.slice(0, 1900);
    const f = fetchImpl || ((...a) => fetch(...a));
    return Promise.resolve()
      .then(() => f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(num(process.env.ERROR_REPORT_TIMEOUT_MS, 5000, 100, 30000)),
      }))
      .then((res) => {
        if (res && res.ok === false) throw new Error(`webhook answered ${res.status}`);
        counters.reported++;
        return true;
      })
      .catch((e) => {
        counters.reportFailures++;
        if (Date.now() - lastFailureLogAt > 60000) {
          lastFailureLogAt = Date.now();
          console.warn('[ERROR_REPORTER] could not deliver an error report:', (e && e.name === 'TimeoutError') ? 'timeout' : (e && e.message));
        }
        return false;
      });
  } catch {
    return Promise.resolve(false);
  }
};

const countServerError = () => { counters.serverErrors++; };
const countUnhandledRejection = () => { counters.unhandledRejections++; };
const countUncaughtException = () => { counters.uncaughtExceptions++; };

const stats = () => ({ enabled: isEnabled(), ...counters });

const _reset = () => {
  for (const k of Object.keys(counters)) counters[k] = 0;
  windowStart = 0; sentInWindow = 0; recent.clear(); lastFailureLogAt = 0;
};
const _setFetch = (f) => { fetchImpl = f; };

module.exports = { report, isEnabled, stats, countServerError, countUnhandledRejection, countUncaughtException, _reset, _setFetch };
