// One place that knows the public addresses of this deployment (future-ready infra, NEXT_STEPS item 5).
//
//   PUBLIC_API_URL     https://api.<domain>     absolute links to this API (media URLs, avatars, signed links,
//                                                 legal canonical link) and the address the apps may move to
//                                                 (GET /api/config/endpoints). Unset = today's behaviour: the
//                                                 request's own host (behind Render: trust proxy) or, with no
//                                                 request (jobs / sockets), RENDER_EXTERNAL_URL where the old
//                                                 code used it.
//   PUBLIC_SOCKET_URL  https://api.<domain>     socket.io address advertised to the apps (default PUBLIC_API_URL).
//   PUBLIC_WEB_URL     https://admin.<domain>   the web (admin / legal) site. Only advertised and allowed as a
//                                                 CORS origin; nothing changes while unset.
//   FRONTEND_URL       tracking links in WhatsApp messages (unchanged default https://zenvy.app).
//
// Values must be absolute http(s) origins (a path is tolerated, trailing slashes are removed). A malformed
// value (no scheme, spaces) is ignored with one warning, so a typo never produces broken links.
const warned = new Set();
const warnOnce = (key, msg) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
};

/** Cleaned absolute base from env `key`, or '' when unset / invalid. */
const envBase = (key, env = process.env) => {
  const raw = String(env[key] || '').trim();
  if (!raw) return '';
  const v = raw.replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(v)) {
    warnOnce(`${key}:${raw}`, `[PUBLIC_URL] ${key} is not an absolute http(s) URL and is ignored: "${raw.slice(0, 80)}"`);
    return '';
  }
  return v;
};

/** Origin (scheme://host[:port]) of an absolute URL, '' when it is not one. */
const originOf = (url) => {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
};

const fromRequest = (req) => {
  if (!req || typeof req.get !== 'function') return '';
  const host = req.get('host');
  if (!host) return '';
  return `${req.protocol}://${host}`;
};

/**
 * Absolute base of this API for building links.
 *   PUBLIC_API_URL → the request's host → (renderFallback) RENDER_EXTERNAL_URL → ''.
 * renderFallback: true reproduces utils/imageStore's old behaviour (jobs / sockets without a request
 * got Render's URL); false reproduces modules/campus/campusHelpers' (relative paths without a request).
 */
const apiBase = (req, { renderFallback = false, env = process.env } = {}) => {
  const pub = envBase('PUBLIC_API_URL', env);
  if (pub) return pub;
  const viaReq = fromRequest(req);
  if (viaReq) return viaReq;
  if (renderFallback && !(req && typeof req.get === 'function')) return String(env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return '';
};

/** `${apiBase}${path}` for a server path like /api/campus/media/<id>. */
const apiUrl = (req, path, opts) => `${apiBase(req, opts)}${path}`;

/** Address this process pings for keep-alive: Render's own URL (never via a CDN), else localhost. */
const selfUrl = (port, env = process.env) => env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

/** Web (admin / legal) site, '' when PUBLIC_WEB_URL is unset. */
const webBase = (env = process.env) => envBase('PUBLIC_WEB_URL', env);

/** Base of customer tracking links (WhatsApp messages): FRONTEND_URL, default https://zenvy.app (unchanged). */
const trackingBase = (env = process.env) => String(env.FRONTEND_URL || 'https://zenvy.app');

/** `${trackingBase}/orders/<id>`. */
const orderTrackingUrl = (orderId, env = process.env) => `${trackingBase(env)}/orders/${orderId || ''}`;

/**
 * What GET /api/config/endpoints (and /api/config) advertise to the apps. Every field is null while
 * PUBLIC_API_URL is unset, so the apps keep their built-in address. Only https addresses are advertised
 * (the apps refuse anything else anyway).
 */
const advertisedEndpoints = (env = process.env) => {
  const api = envBase('PUBLIC_API_URL', env);
  const httpsOnly = (v) => (v && /^https:\/\//i.test(v) ? v : null);
  const apiBaseUrl = httpsOnly(api);
  if (!apiBaseUrl) return { apiBaseUrl: null, socketUrl: null, webUrl: null };
  return {
    apiBaseUrl,
    socketUrl: httpsOnly(envBase('PUBLIC_SOCKET_URL', env)) || apiBaseUrl,
    webUrl: httpsOnly(webBase(env)),
  };
};

module.exports = {
  envBase,
  originOf,
  apiBase,
  apiUrl,
  selfUrl,
  webBase,
  trackingBase,
  orderTrackingUrl,
  advertisedEndpoints,
};
