// A5: request body size limits.
//
// Every JSON / urlencoded body is capped at BODY_LIMIT (default 256 KB). Only the routes below, which
// still accept an inline base64 photo (data URL) in a JSON body, or admin bulk writes, get a bigger cap.
// The bigger caps default to 10 MB, exactly today's global limit, so no existing app flow can break:
//   UPLOAD_BODY_LIMIT  default '10mb'  single-photo JSON routes (largest real client: POST /api/services/book
//                                      sends up to 6 MB raw = ~8 MB base64 from customer-mobile)
//   ADMIN_BODY_LIMIT   default '10mb'  every non-GET under /api/admin (CSV menu import POST
//                                      /api/admin/menu-items/bulk ~300 rows/call, store / menu / vault / brand
//                                      images) and the admin PG listing writes (up to 12 photos per listing)
// Multipart uploads (multer: /api/upload, /api/campus/media, /api/auto-ride/driver/media) are not parsed
// here and keep their own file-size limits (they also get the longer UPLOAD_REQUEST_TIMEOUT_MS, see
// middleware/securityMiddleware.js requestTimeout). tests/a5a6/07_upload_paths.test.js lists every route
// that accepts an inline photo: a new one must be added here AND there.
// A body over its cap is answered 413 { code: 'PAYLOAD_TOO_LARGE' } by middleware/errorMiddleware.js.

const express = require('express');

const env = (name, fallback) => {
  const v = String(process.env[name] || '').trim();
  return v || fallback;
};

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const SEG = '[^/]+';

// [methods, path regex, tier, why]. Paths are the full app path (req.path), no trailing slash.
const RAISED_ROUTES = [
  ['POST', '/api/upload', 'upload', 'JSON { image: base64 } fallback of the photo upload (multipart is separate)'],
  ['POST', '/api/campus/media', 'upload', 'customer-mobile web / multipart-fallback sends { image: dataUrl }'],
  ['POST', '/api/auto-ride/driver/media', 'upload', 'documented JSON { image: base64 } variant of the driver photo upload'],
  ['PUT', '/api/users/profile', 'upload', 'profileImage may still be a legacy / pasted data URL (2 MB photo)'],
  ['PUT', '/api/delivery/profile', 'upload', 'rider photoUrl may be a data URL (2 MB photo)'],
  ['PUT', `/api/orders/${SEG}/upload-item-photo`, 'upload', 'Mega Basket item photo as data URL'],
  ['PUT', `/api/orders/${SEG}/upload-bill-proof`, 'upload', 'bill proof photo as data URL'],
  ['PUT', `/api/mega-basket/${SEG}/item-status`, 'upload', 'photoProofUrl may be a data URL'],
  ['POST', '/api/services/book', 'upload', 'customer-mobile sends attachmentUrl as a data URL up to 6 MB raw (~8 MB base64)'],
  ['POST', '/api/birthdays', 'upload', 'candidate photo may be a data URL'],
  ['POST', '/api/community', 'upload', 'post imageUrl may be a data URL'],
  ['POST', `/api/wall/events/${SEG}/submit`, 'upload', 'wall submission image (up to 4 MB) as data URL'],
  ['POST', `/api/pg/${UUID}/reviews`, 'upload', 'review photo (up to 5 MB) as data URL'],
  ['POST', '/api/campus/lost-found', 'upload', 'lost & found photo (up to 3 MB) as data URL'],
  ['POST', '/api/campus/verify/upload-id', 'upload', 'student ID card photo as data URL'],
  ['POST', '/api/restaurants', 'upload', 'admin create store: imageUrl may be a data URL'],
  ['POST', '/api/restaurant', 'upload', 'same router mounted at /api/restaurant'],
  ['POST', '/api/restaurants/menu', 'upload', 'partner app add item: imageUrl may be a data URL'],
  ['POST', '/api/restaurant/menu', 'upload', 'same router mounted at /api/restaurant'],
  ['PUT', `/api/restaurants/menu/${SEG}`, 'upload', 'partner app edit item: imageUrl may be a data URL'],
  ['PUT', `/api/restaurant/menu/${SEG}`, 'upload', 'same router mounted at /api/restaurant'],
  ['POST|PUT|PATCH|DELETE', '/api/admin(?:/.*)?', 'admin', 'admin dashboard: CSV menu import (/menu-items/bulk), bulk updates, store / menu / vault / brand images'],
  ['POST', '/api/pg', 'admin', 'admin PG create: up to 12 photos'],
  ['PUT', `/api/pg/${UUID}`, 'admin', 'admin PG update: up to 12 photos'],
  ['PUT', `/api/pg/${UUID}/photos`, 'admin', 'admin PG photo gallery'],
  // PG promotions (routes/pgRoutes.js preparePromotion): imageUrl goes through storeImageRef (5 MB), so a
  // pasted / legacy data URL must parse instead of answering 413 at the 256 KB global cap.
  ['POST', '/api/pg/admin/promotions', 'admin', 'admin PG promotion create: imageUrl may be a data URL (5 MB)'],
  ['PUT', `/api/pg/admin/promotions/${UUID}`, 'admin', 'admin PG promotion update: imageUrl may be a data URL (5 MB)'],
].map(([methods, path, tier, why]) => ({ methods: new Set(methods.split('|')), re: new RegExp(`^${path}$`), path, tier, why }));

const limits = () => ({
  global: env('BODY_LIMIT', '256kb'),
  upload: env('UPLOAD_BODY_LIMIT', '10mb'),
  admin: env('ADMIN_BODY_LIMIT', '10mb'),
});

/** Which tier ('global' | 'upload' | 'admin') a request's body is parsed with. */
const tierFor = (method, path) => {
  const p = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  const m = String(method || '').toUpperCase();
  for (const r of RAISED_ROUTES) if (r.methods.has(m) && r.re.test(p)) return r.tier;
  return 'global';
};

/**
 * One middleware replacing app.use(express.json()) + app.use(express.urlencoded()): picks the parser
 * for the route's tier. Parsers are built once (limits read from env at boot).
 */
const bodyParsers = () => {
  const l = limits();
  const parsers = {};
  for (const [tier, limit] of Object.entries(l)) {
    parsers[tier] = { json: express.json({ limit }), form: express.urlencoded({ limit, extended: true }) };
  }
  return (req, res, next) => {
    const p = parsers[tierFor(req.method, req.path)] || parsers.global;
    p.json(req, res, (err) => (err ? next(err) : p.form(req, res, next)));
  };
};

module.exports = { bodyParsers, tierFor, limits, RAISED_ROUTES };
