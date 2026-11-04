// S1: Firebase App Check (Play Integrity on Android) for the abuse-prone endpoints: OTP sends, sign-in /
// sign-up, order placement, wallet-spending calls, campus event registration and Auto-Ride holds.
//
// The app sends its App Check token in the `X-Firebase-AppCheck` header; firebase-admin verifies it
// (getAppCheck().verifyToken). Mode (env APP_CHECK_MODE):
//   off      (default)  nothing is read or verified.
//   monitor             every protected call is verified and counted (valid / invalid / missing), never blocked.
//   enforce             a protected call without a valid token gets 401 APP_CHECK_REQUIRED.
//                       APP_CHECK_ENFORCE_GROUPS (comma list of otp,auth,order,wallet,events,autoride,partner;
//                       default: all) limits enforcement to some groups; the others stay in monitor.
// Fail OPEN: when the provider is unavailable (no Firebase credentials, JWKS fetch / network error, a
// timeout of APP_CHECK_TIMEOUT_MS, default 3000) the call goes through and is counted as `unavailable`.
// Never protected: /api/admin/*, health, /legal, webhooks, sockets. The admin web sign-in
// (X-Zenvy-Client: admin-web on /api/users/login) is exempt; the controller then only signs in admin
// accounts for that client (see userController.authUser), so the exemption is useless for customer logins.
// Counters: GET /api/admin/metrics/perf -> appCheck.
const { isProduction } = require('./env');

const HEADER = 'x-firebase-appcheck';
const GROUPS = ['otp', 'auth', 'order', 'wallet', 'events', 'autoride', 'partner'];
const UUIDISH = '[^/]+';

// [method, regex on the full path (no query, no trailing slash), group]
const PROTECTED = [
  ['POST', /^\/api\/users\/send-(?:email-)?otp$/, 'otp'], // SMS code and its email backup
  // Rider / driver account-deletion codes come from the partner apps, which send no App Check token: 'partner' group
  // (never enforced), not 'otp' (31 Oct 2026: enforcing 'otp' would have blocked partners deleting their accounts).
  ['POST', /^\/api\/(delivery|auto-ride\/driver)\/account\/delete-otp$/, 'partner'],
  ['POST', /^\/api\/users\/(login|register|verify-otp|google-login|google-complete|reset-password)$/, 'auth'],
  ['POST', /^\/api\/delivery\/(login|register)$/, 'partner'],
  ['POST', /^\/api\/restaurants?\/login$/, 'partner'],
  ['POST', /^\/api\/auto-ride\/driver\/auth\/(login|register)$/, 'partner'],
  ['POST', /^\/api\/orders$/, 'order'],
  ['POST', /^\/api\/mega-basket$/, 'order'],
  ['POST', new RegExp(`^/api/mega-basket/${UUIDISH}/pay$`), 'wallet'],
  ['POST', /^\/api\/services\/book$/, 'order'],
  ['POST', new RegExp(`^/api/pg/${UUIDISH}/book$`), 'order'],
  ['POST', /^\/api\/rentals\/bookings$/, 'order'],
  ['POST', /^\/api\/features\/gift$/, 'wallet'],
  ['POST', new RegExp(`^/api/vault/claim/${UUIDISH}$`), 'wallet'],
  ['POST', /^\/api\/rewards\/use-spin$/, 'wallet'],
  ['POST', new RegExp(`^/api/campus-events/(?!organizer/|check-in/|webhooks/)${UUIDISH}/(register|teams)$`), 'events'],
  ['POST', new RegExp(`^/api/campus-events/(?!organizer/|check-in/|webhooks/)${UUIDISH}/slots/${UUIDISH}/(hold|book)$`), 'events'],
  ['POST', new RegExp(`^/api/campus-events/registrations/${UUIDISH}/(confirm|accept-offer|pay/razorpay-order)$`), 'events'],
  ['POST', new RegExp(`^/api/auto-ride/trips/${UUIDISH}/(holds|private-requests)$`), 'autoride'],
  ['POST', new RegExp(`^/api/auto-ride/bookings/${UUIDISH}/confirm$`), 'autoride'],
];

const NEVER = /^\/(api\/admin(\/|$)|api\/health|livez|readyz|healthz|legal(\/|$)|api\/campus-events\/webhooks\/|api\/.*webhook)/;

/** The group of a protected call, or null. */
const groupFor = (method, path) => {
  const p = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (NEVER.test(p)) return null;
  const m = String(method || '').toUpperCase();
  for (const [meth, re, g] of PROTECTED) if (meth === m && re.test(p)) return g;
  return null;
};

const readMode = (env = process.env) => {
  const m = String(env.APP_CHECK_MODE || 'off').trim().toLowerCase();
  return ['off', 'monitor', 'enforce'].includes(m) ? m : 'off';
};
// Enforced when APP_CHECK_ENFORCE_GROUPS is empty: every group except 'partner'. The partner apps (Restaurant, Vendor,
// Campus Stall, Rider, Auto Driver) send no App Check token, so enforcing 'partner' would stop every partner sign-in;
// list it explicitly once those apps send one. Note: the Auto Driver app asks for its sign-up code on the customer
// 'otp' path without a token, so enforcing 'otp' also stops new driver sign-ups until that app sends one.
const DEFAULT_ENFORCED = GROUPS.filter((g) => g !== 'partner');
const enforcedGroups = (env = process.env) => {
  const raw = String(env.APP_CHECK_ENFORCE_GROUPS || '').split(',').map((s) => s.trim().toLowerCase()).filter((g) => GROUPS.includes(g));
  return new Set(raw.length ? raw : DEFAULT_ENFORCED);
};
const timeoutMs = (env = process.env) => Math.min(10000, Math.max(200, Number(env.APP_CHECK_TIMEOUT_MS) || 3000));

// ── counters ─────────────────────────────────────────────────────────────────────────────────────
const zero = () => ({ valid: 0, invalid: 0, missing: 0, unavailable: 0, blocked: 0, exempt: 0 });
let totals = zero();
let byGroup = {};
let lastUnavailable = null;
let since = new Date().toISOString();
const count = (group, kind) => {
  totals[kind]++;
  if (!byGroup[group]) byGroup[group] = zero();
  byGroup[group][kind]++;
};
const stats = () => ({
  mode: readMode(),
  enforcedGroups: readMode() === 'enforce' ? [...enforcedGroups()] : [],
  since,
  totals: { ...totals },
  byGroup: JSON.parse(JSON.stringify(byGroup)),
  lastUnavailable,
});
const resetStats = () => { totals = zero(); byGroup = {}; lastUnavailable = null; since = new Date().toISOString(); };

// ── verifier ─────────────────────────────────────────────────────────────────────────────────────
let verifierOverride = null;
/** Tests: fn(token) -> Promise<claims> (throw to reject); null restores firebase-admin. */
const _setVerifier = (fn) => { verifierOverride = fn; };

/** fn(token) or null when Firebase Admin is not initialised (provider unavailable). */
const loadVerifier = () => {
  if (verifierOverride) return verifierOverride;
  try {
    require('../config/firebase'); // initialises the default app when credentials exist
    const { getApps } = require('firebase-admin/app');
    if (!getApps().length) return null;
    const { getAppCheck } = require('firebase-admin/app-check');
    const ac = getAppCheck();
    return (token) => ac.verifyToken(token);
  } catch {
    return null;
  }
};

// Codes that mean "this token is bad" (everything else = provider trouble -> fail open).
const INVALID_CODES = ['invalid-argument', 'app-check-token-expired', 'unauthenticated', 'permission-denied'];
const isInvalidTokenError = (err) => {
  const code = String((err && (err.code || (err.errorInfo && err.errorInfo.code))) || '').replace(/^app-check\//, '');
  return INVALID_CODES.includes(code);
};

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error('App Check verification timed out'), { code: 'timeout' })), ms);
  if (t.unref) t.unref();
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** { status: 'valid'|'invalid'|'missing'|'unavailable', appId?, reason? } */
const verifyRequestToken = async (req) => {
  const raw = req.headers && req.headers[HEADER];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) return { status: 'missing' };
  if (token.length > 4096) return { status: 'invalid', reason: 'too_long' };
  const verify = loadVerifier();
  if (!verify) return { status: 'unavailable', reason: 'not_configured' };
  try {
    const res = await withTimeout(Promise.resolve().then(() => verify(token)), timeoutMs());
    return { status: 'valid', appId: res && res.appId ? String(res.appId) : null };
  } catch (err) {
    if (isInvalidTokenError(err)) return { status: 'invalid', reason: String(err.code || 'invalid') };
    return { status: 'unavailable', reason: String((err && (err.code || err.message)) || 'error').slice(0, 120) };
  }
};

let lastWarnAt = 0;
const warn = (msg) => {
  // at most one line per 30 s (a provider outage must not flood the log)
  if (Date.now() - lastWarnAt < 30 * 1000) return;
  lastWarnAt = Date.now();
  console.warn(msg);
};

const isAdminWebLogin = (req) => String((req.headers && req.headers['x-zenvy-client']) || '').toLowerCase() === 'admin-web'
  && /^\/api\/users\/login$/.test(String(req.path || '').replace(/\/+$/, ''));

/** Express middleware (mounted once, before the routers). */
const middleware = () => async (req, res, next) => {
  const mode = readMode();
  if (mode === 'off') return next();
  const group = groupFor(req.method, req.path);
  if (!group) return next();
  if (isAdminWebLogin(req)) { count(group, 'exempt'); return next(); }
  let r;
  try { r = await verifyRequestToken(req); } catch (err) { r = { status: 'unavailable', reason: err.message }; }
  count(group, r.status);
  req.appCheck = r;
  if (r.status === 'unavailable') {
    lastUnavailable = { at: new Date().toISOString(), reason: r.reason || null };
    warn(`[APP_CHECK] provider unavailable (${r.reason}); allowing ${req.method} ${req.path} (fail open)`);
    return next();
  }
  if (r.status === 'valid') return next();
  if (mode === 'enforce' && enforcedGroups().has(group)) {
    count(group, 'blocked');
    return res.status(401).json({ code: 'APP_CHECK_REQUIRED', message: 'Please update ZenWe from the Play Store and try again.' });
  }
  if (r.status === 'invalid') warn(`[APP_CHECK] invalid token on ${req.method} ${req.path} (${r.reason}); ${mode} mode, allowed`);
  return next();
};

const logStatus = () => {
  const mode = readMode();
  if (mode === 'off') return;
  console.log(`[APP_CHECK] mode=${mode}${mode === 'enforce' ? ` groups=${[...enforcedGroups()].join(',')}` : ''}${isProduction() ? '' : ' (non-production)'}`);
};

module.exports = { HEADER, GROUPS, PROTECTED, groupFor, readMode, enforcedGroups, middleware, verifyRequestToken, stats, resetStats, _setVerifier, isInvalidTokenError, logStatus };
