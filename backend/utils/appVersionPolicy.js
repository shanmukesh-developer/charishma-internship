/**
 * C3 force-update: per-app version policy (GlobalConfig key APP_VERSION_POLICY).
 *
 *   { blockUnversionedClients: false,
 *     apps: { customer: { minSupportedVersion, latestVersion, minSupportedBuild, storeUrl, message, softPromptEnabled }, … } }
 *
 * The apps send X-App-Name / X-App-Version / X-App-Build on every API call (and appName / appVersion /
 * appBuild in the socket handshake). A request from a version below minSupportedVersion (or a build below
 * minSupportedBuild) gets 426 { code: 'UPGRADE_REQUIRED', storeUrl, message } — except a small allow-list
 * (health, config, logout, account deletion) so a blocked user can still sign out and delete the account.
 *
 * Never blocked: requests WITHOUT X-App-Name (web admin, web customer, tests, old installed builds that
 * predate this header). Old native builds can be refused later with the separate admin switch
 * blockUnversionedClients (default false), which only matches requests that look like a native app.
 *
 * Empty policy (the default) = nothing is ever blocked. Fails open: a policy that cannot be read blocks nobody.
 */
const POLICY_KEY = 'APP_VERSION_POLICY';
const APPS = ['customer', 'rider', 'restaurant', 'vendor', 'autodriver', 'pgowner'];
// Header values the apps may send for the same app.
const APP_ALIASES = { delivery: 'rider', 'delivery-boy': 'rider', autodriver: 'autodriver', 'auto-driver': 'autodriver', driver: 'autodriver', 'pg-owner': 'pgowner', pg_owner: 'pgowner' };
const PACKAGES = {
  customer: 'com.srm.hostelbites',
  rider: 'com.srm.hostelbitesdelivery',
  restaurant: 'com.anonymous.restaurantmobile',
  vendor: 'com.srm.zenvyvendor',
  autodriver: 'com.srm.zenvyautodriver',
  pgowner: 'com.srm.zenvypgowner',
};
const APP_LABELS = { customer: 'Zenvy', rider: 'Zenvy Rider', restaurant: 'Zenvy Restaurant', vendor: 'Zenvy Vendor', autodriver: 'Zenvy Auto Driver', pgowner: 'ZCS PG Partner' };
const playUrl = (pkg) => `https://play.google.com/store/apps/details?id=${pkg}`;
const DEFAULT_MESSAGE = 'This version of the app is no longer supported. Please update to keep using Zenvy.';
const MAX_MESSAGE = 300;
const MAX_URL = 500;
const MAX_BUILD = 2100000000; // Play Store versionCode ceiling

// ─── Versions ────────────────────────────────────────────────────────────────
/** "1.2.3" / "v1.2" / "1.2.3-beta.1+45" -> [1, 2, 3] (prerelease / build metadata ignored); junk -> null. */
const parseVersion = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const m = /^\s*v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:[-+][0-9A-Za-z.+-]*)?\s*$/.exec(v.slice(0, 64));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
};
/** -1 / 0 / 1, numeric per part (1.0.10 > 1.0.9). null when either side is not a version. */
const compareVersions = (a, b) => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
};
/** What admins may store: plain x.y.z. */
const isStrictSemver = (v) => typeof v === 'string' && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(v);
const parseBuild = (b) => {
  if (b === undefined || b === null || b === '') return null;
  const s = String(b).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_BUILD ? n : null;
};
const normalizeApp = (name) => {
  if (typeof name !== 'string') return null;
  const k = name.trim().toLowerCase().slice(0, 32);
  if (APPS.includes(k)) return k;
  return APP_ALIASES[k] || null;
};

// ─── Policy shape ────────────────────────────────────────────────────────────
const defaultAppPolicy = (app) => ({
  minSupportedVersion: '',
  latestVersion: '',
  minSupportedBuild: null,
  storeUrl: playUrl(PACKAGES[app]),
  message: '',
  softPromptEnabled: false,
});
const defaultPolicy = () => ({
  blockUnversionedClients: false,
  apps: Object.fromEntries(APPS.map((a) => [a, defaultAppPolicy(a)])),
});

const isStoreUrl = (u) => {
  if (typeof u !== 'string' || !u || u.length > MAX_URL) return false;
  if (/\s/.test(u)) return false;
  if (/^market:\/\/details\?id=[A-Za-z0-9_.]+$/.test(u)) return true;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !!x.hostname && !x.username && !x.password;
  } catch { return false; }
};

/** Lenient read of whatever is stored (a bad field falls back to its default, never throws). */
const parsePolicy = (raw) => {
  const out = defaultPolicy();
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  out.blockUnversionedClients = v.blockUnversionedClients === true;
  const apps = v.apps && typeof v.apps === 'object' ? v.apps : {};
  for (const app of APPS) {
    const a = apps[app];
    if (!a || typeof a !== 'object') continue;
    const p = out.apps[app];
    if (isStrictSemver(a.minSupportedVersion)) p.minSupportedVersion = a.minSupportedVersion;
    if (isStrictSemver(a.latestVersion)) p.latestVersion = a.latestVersion;
    p.minSupportedBuild = parseBuild(a.minSupportedBuild);
    if (isStoreUrl(a.storeUrl)) p.storeUrl = a.storeUrl;
    if (typeof a.message === 'string') p.message = a.message.slice(0, MAX_MESSAGE);
    p.softPromptEnabled = a.softPromptEnabled === true;
  }
  return out;
};

/**
 * Strict validation of an admin update (partial: only the apps / fields sent change).
 * Returns { policy } (the merged result) or { error }.
 */
const validateUpdate = (current, body) => {
  const base = parsePolicy(current);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send a JSON object.' };
  const next = JSON.parse(JSON.stringify(base));
  if (body.blockUnversionedClients !== undefined) {
    if (typeof body.blockUnversionedClients !== 'boolean') return { error: 'blockUnversionedClients must be true or false.' };
    next.blockUnversionedClients = body.blockUnversionedClients;
  }
  if (body.apps !== undefined) {
    if (!body.apps || typeof body.apps !== 'object' || Array.isArray(body.apps)) return { error: 'apps must be an object keyed by app.' };
    for (const [key, a] of Object.entries(body.apps)) {
      if (!APPS.includes(key)) return { error: `Unknown app "${String(key).slice(0, 32)}". Use one of: ${APPS.join(', ')}.` };
      if (!a || typeof a !== 'object' || Array.isArray(a)) return { error: `${key}: send an object.` };
      const p = next.apps[key];
      for (const f of ['minSupportedVersion', 'latestVersion']) {
        if (a[f] === undefined) continue;
        const val = a[f] === null ? '' : a[f];
        if (typeof val !== 'string') return { error: `${key}.${f} must be a version like 1.0.6, or empty.` };
        const t = val.trim();
        if (t && !isStrictSemver(t)) return { error: `${key}.${f} "${t.slice(0, 20)}" is not a version like 1.0.6 (three whole numbers).` };
        p[f] = t;
      }
      if (a.minSupportedBuild !== undefined) {
        if (a.minSupportedBuild === null || a.minSupportedBuild === '') p.minSupportedBuild = null;
        else {
          const b = parseBuild(a.minSupportedBuild);
          if (b === null || (typeof a.minSupportedBuild !== 'number' && typeof a.minSupportedBuild !== 'string')) {
            return { error: `${key}.minSupportedBuild must be a whole number from 1 (Android versionCode), or empty.` };
          }
          p.minSupportedBuild = b;
        }
      }
      if (a.storeUrl !== undefined) {
        const u = typeof a.storeUrl === 'string' ? a.storeUrl.trim() : a.storeUrl;
        if (u === '' || u === null) p.storeUrl = playUrl(PACKAGES[key]);
        else if (!isStoreUrl(u)) return { error: `${key}.storeUrl must be an https:// link (or market://details?id=…).` };
        else p.storeUrl = u;
      }
      if (a.message !== undefined) {
        if (a.message !== null && typeof a.message !== 'string') return { error: `${key}.message must be text.` };
        const m = (a.message || '').trim();
        if (m.length > MAX_MESSAGE) return { error: `${key}.message is too long (max ${MAX_MESSAGE} characters).` };
        p.message = m;
      }
      if (a.softPromptEnabled !== undefined) {
        if (typeof a.softPromptEnabled !== 'boolean') return { error: `${key}.softPromptEnabled must be true or false.` };
        p.softPromptEnabled = a.softPromptEnabled;
      }
      if (p.minSupportedVersion && p.latestVersion && compareVersions(p.minSupportedVersion, p.latestVersion) > 0) {
        return { error: `${key}: the minimum supported version (${p.minSupportedVersion}) cannot be newer than the latest version (${p.latestVersion}).` };
      }
    }
  }
  return { policy: next };
};

// ─── Decisions ───────────────────────────────────────────────────────────────
/**
 * { status: 'ok' | 'soft' | 'blocked', reason? } for one client. Unknown / unparseable versions are never
 * blocked by version (fail open); a known build below minSupportedBuild is.
 */
const evaluate = (policy, app, version, build) => {
  const p = policy && policy.apps ? policy.apps[app] : null;
  if (!p) return { status: 'ok' };
  const v = parseVersion(version);
  const b = parseBuild(build);
  if (p.minSupportedVersion && v && compareVersions(version, p.minSupportedVersion) < 0) return { status: 'blocked', reason: 'version' };
  if (p.minSupportedBuild && b !== null && b < p.minSupportedBuild) return { status: 'blocked', reason: 'build' };
  if (p.latestVersion && v && compareVersions(version, p.latestVersion) < 0) return { status: 'soft' };
  return { status: 'ok' };
};

/** Public per-app shape (GET /api/config/app-version). */
const publicAppPolicy = (policy, app) => {
  const p = (policy && policy.apps && policy.apps[app]) || defaultAppPolicy(app);
  return {
    app,
    appName: APP_LABELS[app],
    minSupportedVersion: p.minSupportedVersion || null,
    latestVersion: p.latestVersion || null,
    minSupportedBuild: p.minSupportedBuild || null,
    storeUrl: p.storeUrl,
    message: p.message || DEFAULT_MESSAGE,
    softPromptEnabled: !!p.softPromptEnabled,
  };
};

const upgradeBody = (policy, app) => {
  const p = publicAppPolicy(policy, app);
  return {
    success: false,
    code: 'UPGRADE_REQUIRED',
    app,
    appName: p.appName,
    minSupportedVersion: p.minSupportedVersion,
    latestVersion: p.latestVersion,
    storeUrl: p.storeUrl,
    message: p.message,
  };
};

// ─── Allow-list (still answered for a blocked version) ───────────────────────
const ALLOW_EXACT = new Set([
  '/api/health', '/api/ping',
  '/api/users/logout',
  '/api/users/fcm-token', '/api/users/fcm-token/remove',
  '/api/delivery/fcm-token', '/api/delivery/fcm-token/remove',
  // ZCS PG Partner: sign-out (push token removal) and the account deletion request.
  '/api/pg-owner/fcm-token/remove', '/api/pg-owner/account/deletion-request',
]);
// /api/config = GET /api/config, /api/config/endpoints, /api/config/app-version.
// /api/users/account = deletion-check + delete (self-service account deletion).
const ALLOW_PREFIX = ['/api/config', '/api/users/account'];
const normPath = (url) => {
  const p = String(url || '').split('?')[0].split('#')[0].toLowerCase().replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
};
const isAllowListed = (req) => {
  const p = normPath(req.originalUrl || req.url);
  if (ALLOW_EXACT.has(p)) return true;
  if (ALLOW_PREFIX.some((pre) => p === pre || p.startsWith(`${pre}/`))) return true;
  // The SMS code that confirms an account deletion.
  if ((p === '/api/users/send-otp' || p === '/api/users/send-email-otp') && req.body && typeof req.body === 'object' && req.body.purpose === 'delete_account') return true;
  return false;
};

/** A request with no X-App-Name that still looks like an installed native app (old build). */
const looksLikeNativeApp = (req) => {
  if (req.get('Origin')) return false; // a browser
  const ua = String(req.get('User-Agent') || '');
  return /okhttp|Dalvik|CFNetwork|Darwin\/|Expo|ReactNative|React-Native/i.test(ua);
};

// ─── Cached read ─────────────────────────────────────────────────────────────
const CACHE_MS = 30 * 1000;
let cache = null; // { at, policy }
let loading = null;
const clearCacheLocal = () => { cache = null; };
// Through the cache bus (utils/cacheBus): with 2+ instances every instance drops its copy at once.
const clearCache = require('./cacheBus').wrap('appVersionPolicy.clear', clearCacheLocal, { resync: clearCacheLocal });

const readFromDb = async () => {
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const GlobalConfig = getGlobalConfigModel();
  if (!GlobalConfig) return { policy: defaultPolicy(), row: null };
  const row = await GlobalConfig.findOne({ where: { key: POLICY_KEY } });
  return { policy: parsePolicy(row ? row.value : null), row };
};

/** Cached policy (30 s, cleared on every admin write). A failed read serves the last good policy, or none. */
const getPolicy = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.policy;
  if (!loading) {
    loading = readFromDb()
      .then(({ policy }) => { cache = { at: Date.now(), policy }; return policy; })
      .catch((err) => {
        console.warn('[APP_VERSION_POLICY_READ_WARN]', err.message);
        const fallback = cache ? cache.policy : defaultPolicy();
        cache = { at: Date.now() - CACHE_MS + 5000, policy: fallback }; // retry in ~5 s
        return fallback;
      })
      .finally(() => { loading = null; });
  }
  return loading;
};

const hasAnyRule = (policy) => APPS.some((a) => {
  const p = policy.apps[a];
  return p && (p.minSupportedVersion || p.minSupportedBuild);
});

// ─── Express middleware ──────────────────────────────────────────────────────
const clientFromHeaders = (req) => ({
  rawName: req.get('X-App-Name'),
  version: req.get('X-App-Version'),
  build: req.get('X-App-Build'),
});

const gate = async (req, res, next) => {
  try {
    if (req.method === 'OPTIONS') return next();
    const { rawName, version, build } = clientFromHeaders(req);
    if (!rawName) {
      // Old builds / web / tests: never blocked unless the admin turned the switch on.
      if (!looksLikeNativeApp(req) || isAllowListed(req)) return next();
      const policy = await getPolicy();
      if (!policy.blockUnversionedClients) return next();
      res.set('Cache-Control', 'no-store');
      return res.status(426).json({
        success: false,
        code: 'UPGRADE_REQUIRED',
        app: null,
        storeUrl: null,
        message: 'This version of the Zenvy app is no longer supported. Please update it from the Play Store.',
      });
    }
    const app = normalizeApp(rawName);
    if (!app) return next();
    req.appClient = { app, version: version ? String(version).slice(0, 32) : null, build: parseBuild(build) };
    if (isAllowListed(req)) return next();
    const policy = await getPolicy();
    if (!hasAnyRule(policy)) return next();
    const d = evaluate(policy, app, version, build);
    if (d.status !== 'blocked') return next();
    res.set('Cache-Control', 'no-store');
    return res.status(426).json(upgradeBody(policy, app));
  } catch (err) {
    console.warn('[APP_VERSION_GATE_WARN]', err.message);
    return next(); // fail open
  }
};

// ─── socket.io middleware ────────────────────────────────────────────────────
const socketGate = (socket, next) => {
  try {
    const hs = socket.handshake || {};
    const a = hs.auth && typeof hs.auth === 'object' ? hs.auth : {};
    const q = hs.query && typeof hs.query === 'object' ? hs.query : {};
    const h = hs.headers || {};
    const rawName = a.appName || q.appName || h['x-app-name'];
    if (!rawName) return next();
    const app = normalizeApp(String(rawName));
    if (!app) return next();
    const version = a.appVersion || q.appVersion || h['x-app-version'];
    const build = a.appBuild || q.appBuild || h['x-app-build'];
    Promise.resolve(getPolicy()).then((policy) => {
      if (!hasAnyRule(policy) || evaluate(policy, app, version, build).status !== 'blocked') return next();
      const err = new Error('UPGRADE_REQUIRED');
      err.data = upgradeBody(policy, app);
      next(err);
    }, () => next());
  } catch {
    next();
  }
};

module.exports = {
  POLICY_KEY, APPS, PACKAGES, APP_LABELS, DEFAULT_MESSAGE,
  parseVersion, compareVersions, isStrictSemver, parseBuild, normalizeApp,
  defaultPolicy, parsePolicy, validateUpdate, evaluate, publicAppPolicy, upgradeBody,
  isAllowListed, looksLikeNativeApp, getPolicy, clearCache, readFromDb, hasAnyRule,
  gate, socketGate,
};
