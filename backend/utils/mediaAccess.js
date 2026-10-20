// S0 media privacy: which media purposes are private, and read-time signing of private media URLs for
// the people allowed to see them.
//
// Private media (CampusMedia.isPrivate) is served only to its owner, an admin (Bearer token) or through a
// short-lived signed link (?exp=&sig=, modules/campus/controllers/mediaController). The apps render
// URLs straight into <Image>, so every API / socket payload that carries a private media URL to an
// authorised viewer must carry a signed one: signMediaFields() does that.
//
//   signMediaFields(req, rows, fields, { purposes })  (async, one DB query per call)
//     For each row and field holding a campus media URL:
//       - media row missing / public       -> value unchanged (legacy public rows keep their stable URL)
//       - private and purpose in `purposes` -> signed absolute URL (valid 60-90 min, stable for 30 min so
//                                              image caches keep working)
//       - private, any other purpose        -> null (never re-share someone's ID card through a chat)
//
// Rows uploaded before S0 stay public (no data migration); new chat / bill / basket / delivery-proof
// uploads are private.
const { Op } = require('sequelize');

const PRIVATE_PURPOSES = new Set([
  'id_card', 'connect', 'liveness_selfie',
  'rental_doc', 'rental_licence', 'rental_report', 'rental_condition',
  'auto_driver_doc',
  // S0: chat photos (conversation participants), order bills / item photos / delivery proof (order
  // customer, assigned rider, store, admin).
  'chat', 'bill', 'basket', 'delivery_proof',
]);

const CHAT_PURPOSES = new Set(['chat']);
const ORDER_PURPOSES = new Set(['bill', 'basket', 'delivery_proof']);

const MEDIA_ID_IN = /\/api\/campus\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i;
const mediaIdIn = (v) => {
  if (typeof v !== 'string' || v.length > 2600) return null;
  const m = MEDIA_ID_IN.exec(v.trim());
  return m ? m[1].toLowerCase() : null;
};

const BUCKET_S = 30 * 60;
const MIN_TTL_S = 60 * 60;
/** Absolute (or relative without a base) signed URL for media `id`. exp is bucketed (60-90 min ahead). */
const signedUrlForId = (req, id, now = Date.now()) => {
  const mc = require('../modules/campus/controllers/mediaController');
  const exp = (Math.floor((Math.floor(now / 1000) + MIN_TTL_S) / BUCKET_S) + 1) * BUCKET_S;
  const base = require('./imageStore').publicBase(req);
  return `${base}/api/campus/media/${id}?exp=${exp}&sig=${mc.sigFor(id, exp)}`;
};

const mediaModel = () => {
  try {
    const { getCampusMediaModel } = require('../modules/campus/models/CampusMedia');
    return getCampusMediaModel && getCampusMediaModel();
  } catch { return null; }
};

/** Map id -> { id, ownerId, purpose, isPrivate } for the given ids (missing ids are absent). */
const loadMediaMeta = async (ids) => {
  const out = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  const Media = mediaModel();
  if (!list.length || !Media) return out;
  const rows = await Media.findAll({ where: { id: { [Op.in]: list } }, attributes: ['id', 'ownerId', 'purpose', 'isPrivate'], raw: true });
  for (const r of rows) out.set(String(r.id).toLowerCase(), r);
  return out;
};

/**
 * Rewrites media URL fields in place (rows are plain objects) and returns the rows.
 * purposes: Set of private purposes this viewer may see in this context.
 */
const signMediaFields = async (req, rows, fields, { purposes } = {}) => {
  const list = (Array.isArray(rows) ? rows : [rows]).filter((r) => r && typeof r === 'object');
  const ids = [];
  for (const r of list) for (const f of fields) { const id = mediaIdIn(r[f]); if (id) ids.push(id); }
  if (!ids.length) return rows;
  let meta;
  try { meta = await loadMediaMeta(ids); } catch (err) {
    // Fail closed for private media: without the rows we cannot tell, so drop media links this time.
    console.warn('[MEDIA_SIGN_WARN]', err.message);
    for (const r of list) for (const f of fields) if (mediaIdIn(r[f])) r[f] = null;
    return rows;
  }
  for (const r of list) {
    for (const f of fields) {
      const id = mediaIdIn(r[f]);
      if (!id) continue;
      const m = meta.get(id);
      if (!m || !m.isPrivate) continue;
      r[f] = purposes && purposes.has(m.purpose) ? signedUrlForId(req, id) : null;
    }
  }
  return rows;
};

/**
 * Write-time check: a client may attach a PRIVATE media row only when it is their own upload (or they are
 * an admin). Returns true when `value` is acceptable. Non-media values and public rows are always fine.
 */
const mayAttach = async (value, ownerId, { isAdmin = false } = {}) => {
  const id = mediaIdIn(value);
  if (!id || isAdmin) return true;
  const Media = mediaModel();
  if (!Media) return true;
  const row = await Media.findByPk(id, { attributes: ['id', 'ownerId', 'isPrivate', 'purpose'], raw: true });
  if (row && row.purpose === 'service_doc') return false; // booking PDFs are never attachable as a photo
  if (!row || !row.isPrivate) return true;
  return !!ownerId && String(row.ownerId) === String(ownerId);
};

module.exports = { PRIVATE_PURPOSES, CHAT_PURPOSES, ORDER_PURPOSES, mediaIdIn, signedUrlForId, signMediaFields, loadMediaMeta, mayAttach };
