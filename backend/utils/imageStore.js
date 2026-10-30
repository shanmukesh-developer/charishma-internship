// One validator for every image a client can attach to a row (profile photos, store / menu
// photos, delivery proof, bills, posts, chat photos, ID cards ...).
//
// Accepted inputs:
//   • a campus media path or URL ( /api/campus/media/<uuid>, absolute or relative )
//   • an http(s) URL (hosted image) up to 2048 chars
//   • a data:image/...;base64 URL or raw base64: the bytes are sniffed (JPEG / PNG / WEBP / GIF
//     only) and stored in the CampusMedia table; the row then only holds the short media URL.
// Anything else (data:text/html, SVG, huge strings, non-strings) is rejected.
//
// Old rows that still hold data: URLs keep working everywhere (readers are unchanged); new
// writes never store base64 in a TEXT column again.
const crypto = require('crypto');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MEDIA_REL_RE = new RegExp(`^/api/campus/media/(${UUID})$`, 'i');
const MEDIA_ABS_RE = new RegExp(`^https?://[^/\\s]+/api/campus/media/(${UUID})(?:\\?[^\\s]*)?$`, 'i');
const HTTP_URL_RE = /^https?:\/\/[^\s"'<>]{3,2040}$/i;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const PURPOSES = new Set(['id_card', 'chat', 'lost_found', 'avatar', 'post', 'other', 'delivery_proof', 'bill', 'store', 'menu', 'service', 'pg', 'birthday', 'wall', 'vault', 'basket',
  // Zenvy Auto-Ride driver documents / photos (always stored private; modules/autoRide/services/media.js).
  'auto_driver_doc',
  // Zenvy Campus Events posters / gallery (public; modules/campusEvents/services/media.js).
  'event_poster',
  // In-Campus Booking payment screenshots (always private; modules/campusBooking).
  'campus_payment']);

// utils/publicUrl: PUBLIC_API_URL, else the request's host; no request (socket handlers, jobs): Render's own
// public URL, else a relative path.
const publicBase = (req) => require('./publicUrl').apiBase(req, { renderFallback: true });

const sniffImage = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const head6 = buf.toString('ascii', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  return null;
};

/** media id when `v` points at a campus media row (relative or absolute), else null. */
const mediaIdOf = (v) => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = MEDIA_REL_RE.exec(s) || MEDIA_ABS_RE.exec(s);
  return m ? m[1].toLowerCase() : null;
};

const isDataUrl = (v) => typeof v === 'string' && /^\s*data:/i.test(v);

/** Decodes a data URL or bare base64 string. Returns Buffer | 'too_large' | null. */
const decodeBase64Image = (raw, maxBytes = DEFAULT_MAX_BYTES) => {
  if (typeof raw !== 'string' || !raw) return null;
  let b64 = raw.trim();
  const m = b64.match(/^data:([a-z0-9.+/-]*)(;[a-z0-9=._-]+)*;base64,(.*)$/is);
  if (m) b64 = m[3];
  else if (/^data:/i.test(b64)) return null; // non-base64 data URL (e.g. svg+xml utf8)
  b64 = b64.replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/=_-]+$/.test(b64)) return null;
  if (Math.floor(b64.length * 3 / 4) > maxBytes + 4) return 'too_large';
  const buf = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buf.length > maxBytes ? 'too_large' : buf;
};

/** Stores image bytes in CampusMedia (deduped per owner+purpose) and returns the row id. */
const saveImageBytes = async (buf, { ownerId, purpose = 'other', isPrivate = false } = {}) => {
  const mime = sniffImage(buf);
  if (!mime) {
    const err = new Error('Only JPEG, PNG, WEBP or GIF photos are allowed.');
    err.status = 415; err.code = 'UNSUPPORTED_TYPE';
    throw err;
  }
  const { getCampusMediaModel } = require('../modules/campus/models/CampusMedia');
  const Media = getCampusMediaModel && getCampusMediaModel();
  if (!Media) {
    const err = new Error('Uploads are starting up. Please try again in a moment.');
    err.status = 503; err.code = 'MEDIA_UNAVAILABLE';
    throw err;
  }
  const owner = ownerId && new RegExp(`^${UUID}$`, 'i').test(String(ownerId)) ? String(ownerId) : '00000000-0000-0000-0000-000000000000';
  const p = PURPOSES.has(purpose) ? purpose : 'other';
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  // S0: chat photos, bills, basket photos and delivery proof are always private (utils/mediaAccess). A
  // public row saved before S0 for the same bytes is not reused for a private reference.
  const priv = !!isPrivate || require('./mediaAccess').PRIVATE_PURPOSES.has(p);
  let row = await Media.findOne({ where: { ownerId: owner, sha256, purpose: p, ...(priv ? { isPrivate: true } : {}) }, attributes: ['id'] });
  // utils/mediaStorage: bytes in this row ('db', default) or in R2 ('s3'); same row, same URL either way.
  if (!row) row = await require('./mediaStorage').createMediaRow(Media, { ownerId: owner, purpose: p.slice(0, 20), mime, size: buf.length, sha256, isPrivate: priv }, buf);
  return { id: row.id, mime, size: buf.length };
};

// Photo links that are sure to break, or are not the photo itself (31 Oct 2026: a product photo pasted from
// Google Flow stopped showing when its signed link expired). Temporary links carry their expiry in the query
// (S3, Google Cloud, CloudFront, Azure, Facebook / Instagram / WhatsApp CDNs); Google Images only serves small
// previews. Returns { code, message } for such a link, else null.
const TEMP_LINK_KEYS = ['x-amz-expires', 'x-amz-signature', 'x-goog-expires', 'x-goog-signature', 'expires', 'signature', 'key-pair-id'];
const imageLinkProblem = (url) => {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const keys = new Set([...u.searchParams.keys()].map((k) => k.toLowerCase()));
  const temporary = /(^|\.)flow-content\.google$/.test(host)
    || TEMP_LINK_KEYS.some((k) => keys.has(k))
    || (keys.has('se') && keys.has('sig'))
    || (keys.has('oe') && keys.has('oh'));
  if (temporary) return { code: 'IMAGE_LINK_TEMPORARY', message: 'That photo link is temporary: it expires and the photo stops showing. Save the photo and upload it instead.' };
  if (/^encrypted-tbn\d*\.gstatic\.com$/.test(host)) return { code: 'IMAGE_LINK_PREVIEW', message: 'That link is a small Google Images preview, not the photo itself. Upload your own photo instead.' };
  return null;
};

/**
 * Validates a client image reference and returns what to store in the row.
 *   { ok: true, value: string|null }   value null = the field was cleared ('' / null)
 *   { ok: false, status, code, message }
 * Options: req (for the absolute URL base), ownerId, purpose, isPrivate, maxBytes,
 *          allowExternal (default true: http(s) URLs to other hosts are accepted),
 *          keep (the value(s) already on the row: an unchanged link is kept as it is, so editing a
 *          price never fails over an old photo link that imageLinkProblem would refuse today).
 */
const storeImageRef = async (value, opts = {}) => {
  const { req = null, ownerId = null, purpose = 'other', isPrivate = false, maxBytes = DEFAULT_MAX_BYTES, allowExternal = true, keep = null } = opts;
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, status: 400, code: 'BAD_IMAGE', message: 'Send the photo as an uploaded image URL.' };
  const v = value.trim();
  if (!v) return { ok: true, value: null };
  const mid = mediaIdOf(v);
  if (mid) {
    // S0: someone else's PRIVATE upload (ID card, chat photo, bill ...) can never be attached: the row it
    // lands on would hand out signed links to it. Admins may re-attach anything.
    const owner = ownerId || (req && req.user && req.user.id);
    const isAdmin = !!(req && req.user && String(req.user.role || '').toLowerCase() === 'admin');
    let allowed = true;
    try { allowed = await require('./mediaAccess').mayAttach(v, owner, { isAdmin }); } catch { allowed = false; }
    if (!allowed) return { ok: false, status: 400, code: 'BAD_IMAGE', message: 'Upload the photo first, then attach it.' };
    return { ok: true, value: `${publicBase(req)}/api/campus/media/${mid}` };
  }
  if (HTTP_URL_RE.test(v)) {
    if (!allowExternal) return { ok: false, status: 400, code: 'BAD_IMAGE', message: 'Upload the photo first, then attach it.' };
    const kept = (Array.isArray(keep) ? keep : [keep]).some((k) => typeof k === 'string' && k.trim() === v);
    const problem = kept ? null : imageLinkProblem(v);
    if (problem) return { ok: false, status: 400, ...problem };
    return { ok: true, value: v };
  }
  // Inline base64: move the bytes to the media table.
  const buf = decodeBase64Image(v, maxBytes);
  if (buf === 'too_large') return { ok: false, status: 413, code: 'FILE_TOO_LARGE', message: `That photo is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. Please pick a smaller one.` };
  if (!buf || !buf.length) return { ok: false, status: 400, code: 'BAD_IMAGE', message: 'That photo could not be read. Please pick another one.' };
  try {
    const saved = await saveImageBytes(buf, { ownerId: ownerId || (req && req.user && req.user.id), purpose, isPrivate });
    return { ok: true, value: `${publicBase(req)}/api/campus/media/${saved.id}` };
  } catch (err) {
    return { ok: false, status: err.status || 500, code: err.code || 'MEDIA_SAVE_FAILED', message: err.status ? err.message : 'Could not save that photo. Please try again.' };
  }
};

/** Same as storeImageRef for an array of images (max `maxItems`). */
const storeImageList = async (list, opts = {}) => {
  const { maxItems = 10 } = opts;
  if (list === null || list === undefined) return { ok: true, value: [] };
  if (!Array.isArray(list)) return { ok: false, status: 400, code: 'BAD_IMAGE', message: 'Images must be a list.' };
  if (list.length > maxItems) return { ok: false, status: 400, code: 'TOO_MANY_IMAGES', message: `At most ${maxItems} photos.` };
  const out = [];
  for (const item of list) {
    const r = await storeImageRef(item, opts);
    if (!r.ok) return r;
    if (r.value) out.push(r.value);
  }
  return { ok: true, value: out };
};

/** Sends a storeImageRef failure as JSON. */
const sendImageError = (res, r) => res.status(r.status || 400).json({ code: r.code, message: r.message });

/** For read paths: hides inline base64 (legacy rows) from list payloads. */
const stripDataUrl = (v) => (isDataUrl(v) ? null : v);

module.exports = {
  storeImageRef,
  storeImageList,
  saveImageBytes,
  decodeBase64Image,
  sendImageError,
  sniffImage,
  mediaIdOf,
  imageLinkProblem,
  isDataUrl,
  stripDataUrl,
  publicBase,
  MEDIA_REL_RE,
};

/**
 * Sequelize attribute list entries that read image columns but return NULL for legacy inline
 * base64 values (so list endpoints never ship megabytes). Usage:
 *   attributes: { include: dataUrlSafeColumns('Order', ['proofImage']), exclude: [...] }
 * Pair with `exclude` of the same columns to avoid selecting them twice.
 */
const dataUrlSafeColumns = (tableAlias, columns) => {
  const { literal } = require('sequelize');
  return columns.map((c) => [literal(`CASE WHEN "${tableAlias}"."${c}" LIKE 'data:%' THEN NULL ELSE "${tableAlias}"."${c}" END`), c]);
};
module.exports.dataUrlSafeColumns = dataUrlSafeColumns;
