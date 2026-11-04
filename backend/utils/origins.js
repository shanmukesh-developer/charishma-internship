// Browser origins allowed to call the API (express cors + socket.io), moved out of server.js unchanged.
//
// Exact matches only: anyone can create a *.onrender.com service with 'zenvy' in its name, so there is no
// substring / wildcard matching. Extra origins come from env:
//   ALLOWED_ORIGINS  comma list (e.g. https://admin.zenvy.in,https://zenvy.in)   — as before
//   PUBLIC_WEB_URL   its origin is allowed automatically when set (future admin.<domain>)
//   PUBLIC_API_URL   its origin is allowed automatically when set (same-origin pages such as /legal)
// With none of them set the list is exactly the old one.
const { envBase, originOf } = require('./publicUrl');

const BUILT_IN_PRODUCTION_ORIGINS = Object.freeze([
  'https://hostelbites-admin-iyoy.onrender.com',
  'https://hostelbites-backend-jwmt.onrender.com',
  'https://hostelbites-customer.onrender.com',
]);

const LOCAL_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
]);

const parseList = (raw) => String(raw || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);

/** Production origins (also used for the CSP frame-ancestors of the auth helper page). */
const productionOrigins = (env = process.env) => {
  const extra = [originOf(envBase('PUBLIC_WEB_URL', env)), originOf(envBase('PUBLIC_API_URL', env))].filter(Boolean);
  const out = [...BUILT_IN_PRODUCTION_ORIGINS, ...parseList(env.ALLOWED_ORIGINS)];
  for (const o of extra) if (!out.includes(o)) out.push(o);
  return out;
};

// S1: localhost / 127.0.0.1 / *.localhost browser origins are accepted only outside production (NODE_ENV /
// RENDER, as utils/env.isProduction), or in production with ALLOW_LOCAL_ORIGINS=1 (temporary local admin
// debugging against the live API). Native apps send no Origin and are unaffected.
const isProductionEnv = (env) => env.NODE_ENV === 'production' || env.RENDER === 'true';
const localOriginsAllowed = (env = process.env) => !isProductionEnv(env) || String(env.ALLOW_LOCAL_ORIGINS || '') === '1';

const allowedOrigins = (env = process.env) => [...productionOrigins(env), ...(localOriginsAllowed(env) ? LOCAL_ORIGINS : [])];

/** Returns isAllowedOrigin(origin) bound to the list built from `env` (built once). */
const makeOriginChecker = (env = process.env, { log = console } = {}) => {
  const list = allowedOrigins(env);
  const local = localOriginsAllowed(env);
  return (origin) => {
    if (!origin) return true;
    if (list.includes(origin)) return true;
    // Strict match for local dev / mobile schemes to prevent domain spoofing
    if (local && /^https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/.test(origin)) return true;
    if (origin.startsWith('capacitor://') || origin.startsWith('exp://')) return true;
    if (/\.onrender\.com$/.test(origin) && log) {
      log.warn(`[CORS] Refused ${origin}. Add it to ALLOWED_ORIGINS if it is a real ZENV app.`);
    }
    return false;
  };
};

module.exports = { BUILT_IN_PRODUCTION_ORIGINS, LOCAL_ORIGINS, parseList, productionOrigins, allowedOrigins, makeOriginChecker, localOriginsAllowed };
