// Cache-Control for a CDN (Cloudflare) in front of the API. Everything here is OFF unless EDGE_CACHE=1, so
// the headers stay exactly as before until the owner puts Cloudflare in front and opts in.
//
//   EDGE_CACHE=1                 turn on the CDN-friendly headers below
//   EDGE_CACHE_GROUPS=a,b        utils/responseCache groups a CDN may share between users
//                                (default: catalog,campus,challenges,megaBasketFees,serviceability,vault —
//                                 public data only; 'config' is never shared: admins bypass its cache)
//   EDGE_CACHE_SMAXAGE=15        seconds a CDN may serve a shared copy without asking (1..300)
//   EDGE_CACHE_SWR=60            seconds a CDN may serve a stale copy while it refreshes (0..3600)
//
// With EDGE_CACHE=1:
//   • responseCache hits / misses of those groups: `public, max-age=0, s-maxage=S, stale-while-revalidate=W`
//     (browsers / apps still revalidate every time with the ETag; only the CDN keeps a copy for S seconds).
//     Writes still clear the server cache at once; the CDN copy can be up to S seconds old — keep S small.
//   • every other /api response that set no Cache-Control itself gets `private, no-store` when the request
//     carries a credential (Authorization header / token cookie, + Vary: Authorization) and `no-store`
//     otherwise, so nothing user-specific can ever be stored by a shared cache.
//   • media (/api/campus/media/<id>) keeps its own headers: public photos `public, max-age=31536000,
//     immutable`, private ones `private, ...` (already CDN-correct).
// Without EDGE_CACHE: responseCache sends `no-cache` (unchanged) and nothing else is added.

const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
const DEFAULT_GROUPS = Object.freeze(['catalog', 'campus', 'challenges', 'megaBasketFees', 'serviceability', 'vault']);
// Groups whose responses can differ for an admin (cacheGet bypass): never shared by a CDN.
const NEVER_SHARED = new Set(['config']);

const clampInt = (raw, def, min, max) => {
  const n = Number(String(raw === undefined || raw === null ? '' : raw).trim());
  if (String(raw === undefined || raw === null ? '' : raw).trim() === '' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const settings = (env = process.env) => {
  const enabled = truthy(env.EDGE_CACHE);
  const list = String(env.EDGE_CACHE_GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    enabled,
    groups: new Set((list.length ? list : DEFAULT_GROUPS).filter((g) => !NEVER_SHARED.has(g))),
    sMaxAge: clampInt(env.EDGE_CACHE_SMAXAGE, 15, 1, 300),
    swr: clampInt(env.EDGE_CACHE_SWR, 60, 0, 3600),
  };
};

let cached = null;
const current = () => cached || (cached = settings());
/** Tests: re-read the environment. */
const reload = (env = process.env) => { cached = settings(env); return cached; };

/**
 * Cache-Control for a responseCache entry of `group`. `bypassable` = the route has a per-caller bypass
 * (never shared). Default (EDGE_CACHE off): 'no-cache', exactly as before.
 */
const forCachedGroup = (group, { bypassable = false } = {}, s = current()) => {
  if (!s.enabled || bypassable || !s.groups.has(group)) return 'no-cache';
  return `public, max-age=0, s-maxage=${s.sMaxAge}${s.swr ? `, stale-while-revalidate=${s.swr}` : ''}`;
};

const hasCredential = (req) => !!((req.headers && req.headers.authorization) || /(?:^|;\s*)token=/.test(String((req.headers && req.headers.cookie) || '')));

/** Header for an /api response that set none itself (EDGE_CACHE on only). */
const defaultFor = (req) => (hasCredential(req) ? 'private, no-store' : 'no-store');

/**
 * Middleware: fills in Cache-Control on /api responses that did not set one. Returns null (install
 * nothing) while EDGE_CACHE is off.
 */
const apiDefaultsMiddleware = (s = current()) => {
  if (!s.enabled) return null;
  return (req, res, next) => {
    if (!String(req.originalUrl || req.url || '').startsWith('/api')) return next();
    const origWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithCacheDefaults(...args) {
      try {
        if (!res.getHeader('Cache-Control')) {
          res.setHeader('Cache-Control', defaultFor(req));
          if (hasCredential(req)) res.vary('Authorization');
        }
      } catch { /* headers already sent */ }
      return origWriteHead.apply(this, args);
    };
    next();
  };
};

module.exports = { DEFAULT_GROUPS, settings, current, reload, forCachedGroup, defaultFor, hasCredential, apiDefaultsMiddleware };
