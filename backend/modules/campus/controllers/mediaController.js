// Campus media: one upload endpoint for every campus image (ID cards, chat photos, lost & found,
// avatars, posts). Bytes are stored in the CampusMedia table and served from a short URL, so
// nothing large travels through JSON lists or the socket any more.
const crypto = require('crypto');
const multer = require('multer');
const { getCampusMediaModel } = require('../models/CampusMedia');
const { getUserModel } = require('../../../models/User');
const { publicBase } = require('../campusHelpers');

const MAX_BYTES = 5 * 1024 * 1024;
const PURPOSES = new Set(['id_card', 'chat', 'lost_found', 'avatar', 'post', 'other', 'connect', 'forum', 'task', 'liveness_selfie',
  // Rentals (modules/rentals): vehicle photos are public; RC / insurance / licences / report photos and
  // C7 pickup / return condition + extra-charge evidence photos are private.
  'rental_photo', 'rental_doc', 'rental_licence', 'rental_report', 'rental_condition',
  // Zenvy Auto-Ride driver documents (private; drivers upload via /api/auto-ride/driver/media).
  'auto_driver_doc',
  // Zenvy Campus Events posters / gallery (public: shown on event cards to every student).
  'event_poster',
  // S0: order bill / item photos / delivery proof (private, like the /api/upload proof path).
  'bill', 'basket', 'delivery_proof',
  // Customer polish: photos on a support ticket (private: the customer and support staff only).
  'support',
  // In-Campus Booking: the student's UPI payment screenshot (private: the student, that stall and admins).
  'campus_payment']);
// Served only to the owner, admins, or through a signed link (Connect photos are shown via signed URLs).
// S0: chat photos and order bills / basket photos / delivery proof are private too (utils/mediaAccess).
const { PRIVATE_PURPOSES } = require('../../../utils/mediaAccess');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-user upload budget (in memory; resets on restart, which is fine for abuse control).
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 60;
const uploadLog = new Map(); // userId -> timestamps[]
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of uploadLog) if (!list.length || now - list[list.length - 1] >= WINDOW_MS) uploadLog.delete(k);
}, 10 * 60 * 1000).unref?.();
const overBudget = (userId) => {
  const now = Date.now();
  const list = (uploadLog.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    uploadLog.set(userId, list);
    return true;
  }
  list.push(now);
  uploadLog.set(userId, list);
  return false;
};

/** Detects the real image type from the first bytes (never trust the client's MIME). */
const sniffImage = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const head6 = buf.toString('ascii', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  return null;
};

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 10 },
});

/** multipart field 'image' (optional). Turns multer errors into clear JSON. */
const parseUpload = (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().startsWith('multipart/form-data')) return next();
  multerUpload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ code: 'FILE_TOO_LARGE', message: 'That photo is larger than 5 MB. Please pick a smaller one.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ code: 'BAD_FIELD', message: "Send the photo in the form field named 'image'." });
    }
    console.warn('[CAMPUS_MEDIA_MULTER]', err.code || err.message);
    return res.status(400).json({ code: 'BAD_UPLOAD', message: 'Could not read that photo. Please try again.' });
  });
};

/** Reads base64 / data URL from a JSON body. */
const bufferFromBase64 = (raw) => {
  if (typeof raw !== 'string' || !raw) return null;
  let b64 = raw.trim();
  const m = b64.match(/^data:([a-z0-9.+/-]+);base64,(.*)$/is);
  if (m) b64 = m[2];
  b64 = b64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(b64)) return null;
  // Rough pre-check so a huge string is not decoded just to be rejected.
  if (Math.floor(b64.length * 3 / 4) > MAX_BYTES + 4) return 'too_large';
  return Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
};

// @desc    Upload one image
// @route   POST /api/campus/media   (multipart 'image' or JSON { image: base64|dataUrl, purpose })
const uploadMedia = async (req, res) => {
  try {
    const Media = getCampusMediaModel();
    if (!Media) return res.status(503).json({ message: 'Uploads are starting up. Please try again in a moment.' });

    let buf = null;
    if (req.file && req.file.buffer) buf = req.file.buffer;
    else if (req.body && (req.body.image || req.body.base64)) buf = bufferFromBase64(req.body.image || req.body.base64);

    if (buf === 'too_large') {
      return res.status(413).json({ code: 'FILE_TOO_LARGE', message: 'That photo is larger than 5 MB. Please pick a smaller one.' });
    }
    if (!buf || !buf.length) {
      return res.status(400).json({ code: 'NO_IMAGE', message: "No photo received. Send it as multipart field 'image' or JSON { image }." });
    }
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ code: 'FILE_TOO_LARGE', message: 'That photo is larger than 5 MB. Please pick a smaller one.' });
    }
    const mime = sniffImage(buf);
    if (!mime) {
      return res.status(415).json({ code: 'UNSUPPORTED_TYPE', message: 'Only JPEG, PNG, WEBP or GIF photos are allowed.' });
    }
    if (overBudget(String(req.user.id))) {
      return res.status(429).json({ code: 'TOO_MANY_UPLOADS', message: 'Too many uploads this hour. Please try again later.' });
    }

    const purposeRaw = String((req.body && req.body.purpose) || 'other').toLowerCase();
    const purpose = PURPOSES.has(purposeRaw) ? purposeRaw : 'other';
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    // Same user, same bytes, same purpose -> reuse (retries after a timeout do not duplicate).
    // (S0: a public row saved before a purpose became private is never reused for a private upload.)
    let row = await Media.findOne({ where: { ownerId: req.user.id, sha256, purpose, ...(PRIVATE_PURPOSES.has(purpose) ? { isPrivate: true } : {}) }, attributes: ['id', 'mime', 'size'] });
    if (!row) {
      // utils/mediaStorage: bytes in this row ('db', default) or in R2 ('s3'); the row and URL are the same.
      row = await require('../../../utils/mediaStorage').createMediaRow(Media, {
        ownerId: req.user.id,
        purpose,
        mime,
        size: buf.length,
        sha256,
        isPrivate: PRIVATE_PURPOSES.has(purpose),
      }, buf);
    }

    const path = `/api/campus/media/${row.id}`;
    res.status(201).json({
      id: row.id,
      url: path,
      absoluteUrl: publicBase(req) + path,
      // Same shape as the old /api/upload so existing callers keep working.
      imageUrl: publicBase(req) + path,
      mime: row.mime || mime,
      size: row.size || buf.length,
      purpose,
      isPrivate: PRIVATE_PURPOSES.has(purpose),
      // Private uploads (ID card, Connect, liveness) need a signed link to show in an <img> (1 h).
      ...(PRIVATE_PURPOSES.has(purpose) ? { previewUrl: signedMediaUrl(req, path) } : {}),
    });
  } catch (err) {
    console.error('[CAMPUS_MEDIA_UPLOAD_ERR]', err.message);
    res.status(500).json({ message: 'Could not save that photo. Please try again.' });
  }
};

const sendBytes = (req, res, { bytes, mime, etag, maxAge, isPrivate }) => {
  res.set({
    'Content-Type': mime,
    'Content-Length': String(bytes.length),
    'Cache-Control': isPrivate ? 'private, max-age=86400' : `public, max-age=${maxAge}, immutable`,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.status(200).end(bytes);
};

// ── Hot public photos in memory ─────────────────────────────────────────────
// Store covers and menu photos are fetched by every phone, and each fetch was a full row read (bytes
// included) from the database, often 1-3 s on the free plan. PUBLIC rows whose bytes live in the database
// are kept here (bounded LRU, MEDIA_CACHE_MB, default 32; 0 turns it off) for a short time, so repeat
// requests and 304 revalidations answer without the database. Private rows are never cached; the short
// TTL bounds how long a deleted public photo can still be served by an instance.
const HOT_TTL_MS = 10 * 60 * 1000;
const HOT_ITEM_MAX = 2 * 1024 * 1024;
const hotMaxBytes = () => {
  const mb = Number(process.env.MEDIA_CACHE_MB);
  return (Number.isFinite(mb) && mb >= 0 ? Math.min(mb, 256) : 32) * 1024 * 1024;
};
const hot = new Map(); // id -> { mime, bytes, at }
let hotBytes = 0;
const hotDrop = (id) => {
  const e = hot.get(id);
  if (e) { hotBytes -= e.bytes.length; hot.delete(id); }
};
const hotGet = (id) => {
  const e = hot.get(id);
  if (!e) return null;
  if (Date.now() - e.at > HOT_TTL_MS) { hotDrop(id); return null; }
  hot.delete(id); hot.set(id, e); // most recently used last
  return e;
};
const hotPut = (id, mime, bytes) => {
  const max = hotMaxBytes();
  if (!max || !bytes || !bytes.length || bytes.length > Math.min(HOT_ITEM_MAX, max)) return;
  hotDrop(id);
  hot.set(id, { mime, bytes, at: Date.now() });
  hotBytes += bytes.length;
  for (const k of hot.keys()) {
    if (hotBytes <= max) break;
    hotDrop(k);
  }
};
const hotStats = () => ({ entries: hot.size, bytes: hotBytes, maxBytes: hotMaxBytes() });
const hotClear = () => { hot.clear(); hotBytes = 0; };

// @desc    Serve an uploaded image (public by unguessable id; ID cards are owner/admin only)
// @route   GET /api/campus/media/:id
const serveMedia = async (req, res) => {
  try {
    const id = String(req.params.id || '').toLowerCase();
    if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Not found' });
    const etag = `"m-${id}"`;
    const cached = hotGet(id);
    if (cached) return sendBytes(req, res, { bytes: cached.bytes, mime: cached.mime, etag, maxAge: 31536000, isPrivate: false });
    const Media = getCampusMediaModel();
    // A revalidation (If-None-Match) only needs the access fields, not the photo bytes.
    const revalidate = req.headers['if-none-match'] === etag;
    const row = revalidate
      ? await Media.findByPk(id, { attributes: ['id', 'ownerId', 'isPrivate', 'purpose'] })
      : await Media.findByPk(id);
    if (!row) return res.status(404).json({ message: 'Not found' });
    // Booking PDFs (utils/serviceDocuments) are only served by GET /api/services/:id/document, as a download.
    if (row.purpose === 'service_doc') return res.status(404).json({ message: 'Not found' });

    if (row.isPrivate) {
      // ID cards: only the owner or an admin (Bearer token), or a short-lived signed link
      // (?exp=&sig=) handed out by authenticated endpoints so an <img> tag can load it.
      let allowed = verifySignature(id, req.query.exp, req.query.sig);
      if (!allowed) {
        const viewer = await viewerFrom(req);
        allowed = !!viewer && (String(viewer.id) === String(row.ownerId) || String(viewer.role || '').toLowerCase() === 'admin');
      }
      if (!allowed) return res.status(404).json({ message: 'Not found' });
    }
    if (revalidate) {
      res.set({ ETag: etag, 'Cache-Control': row.isPrivate ? 'private, max-age=86400' : 'public, max-age=31536000, immutable' });
      return res.status(304).end();
    }
    // Bytes in R2 (utils/mediaStorage, only rows written while MEDIA_STORAGE=s3): CDN / presigned redirect
    // or a stream with the same headers as below. Rows with their bytes in the database are unchanged.
    const storage = require('../../../utils/mediaStorage');
    if (storage.isExternal(row)) return serveExternal(req, res, storage, row, etag);
    const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes || []);
    if (!row.isPrivate) hotPut(id, row.mime, bytes);
    return sendBytes(req, res, { bytes, mime: row.mime, etag, maxAge: 31536000, isPrivate: row.isPrivate });
  } catch (err) {
    console.error('[CAMPUS_MEDIA_SERVE_ERR]', err.message);
    res.status(500).json({ message: 'Could not load that photo.' });
  }
};

const serveExternal = async (req, res, storage, row, etag) => {
  const plan = storage.deliveryPlan(row);
  if (plan.redirect) {
    res.set('Cache-Control', plan.cacheControl);
    res.set('Referrer-Policy', 'no-referrer');
    return res.redirect(302, plan.redirect);
  }
  let obj = null;
  try { obj = await storage.readExternal(row); } catch (err) {
    console.error('[CAMPUS_MEDIA_R2_ERR]', err.message);
    return res.status(502).json({ message: 'Could not load that photo.' });
  }
  if (!obj) return res.status(404).json({ message: 'Not found' });
  const size = Number(obj.size) || Number(row.size) || null;
  res.set({
    'Content-Type': row.mime,
    ...(size ? { 'Content-Length': String(size) } : {}),
    'Cache-Control': row.isPrivate ? 'private, max-age=86400' : 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.status(200);
  if (req.method === 'HEAD') { obj.stream.destroy(); return res.end(); }
  obj.stream.on('error', (err) => {
    console.error('[CAMPUS_MEDIA_R2_STREAM_ERR]', err.message);
    res.destroy(err);
  });
  return obj.stream.pipe(res);
};

// ── Signed links for private media ───────────────────────────────────────────
const SIGN_TTL_S = 60 * 60;
const signKey = () => crypto.createHash('sha256').update(`campus-media:${process.env.JWT_SECRET || ''}`).digest();
const sigFor = (id, exp) => crypto.createHmac('sha256', signKey()).update(`${id}.${exp}`).digest('hex').slice(0, 32);
// S0: avatar links (GET /api/campus/avatar/:userId?v=&s=) carry a signature over (userId, v) so the
// endpoint is no longer an open "photo of any user id" lookup. Links are issued by campusHelpers.avatarUrlFor
// only where the viewer is already shown that person (never for Connect-masked peers).
const avatarSig = (userId, v) => crypto.createHmac('sha256', signKey()).update(`avatar.${String(userId).toLowerCase()}.${String(v || '')}`).digest('hex').slice(0, 24);
const verifyAvatarSig = (userId, v, s) => {
  if (!process.env.JWT_SECRET || typeof s !== 'string' || s.length !== 24) return false;
  const want = Buffer.from(avatarSig(userId, typeof v === 'string' ? v : ''));
  const got = Buffer.from(s);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};
const verifySignature = (id, exp, sig) => {
  if (!process.env.JWT_SECRET || typeof exp !== 'string' || typeof sig !== 'string' || sig.length !== 32) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return false;
  const want = Buffer.from(sigFor(id, e));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

/**
 * For responses to authorised viewers: returns an absolute URL that works in an <img> for an hour.
 * Non-media URLs (https, legacy data:) are returned unchanged.
 */
const signedMediaUrl = (req, url) => {
  if (typeof url !== 'string') return url || null;
  const m = url.match(/\/api\/campus\/media\/([0-9a-f-]{36})(?:\?.*)?$/i);
  if (!m || !(url.startsWith('/api/') || url.startsWith(publicBase(req)))) return url;
  const exp = Math.floor(Date.now() / 1000) + SIGN_TTL_S;
  return `${publicBase(req)}/api/campus/media/${m[1]}?exp=${exp}&sig=${sigFor(m[1], exp)}`;
};

// Optional auth for private media: Authorization: Bearer <jwt>.
const viewerFrom = async (req) => {
  try {
    const jwt = require('jsonwebtoken');
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !process.env.JWT_SECRET) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = getUserModel();
    const user = await User.findByPk(decoded.id, { attributes: ['id', 'role', 'isActive', 'tokenVersion'] });
    // Live account only (never the token's role claim), and not a session revoked by a password change.
    if (user && user.isActive !== false && (Number(decoded.tv) || 0) === (Number(user.tokenVersion) || 0)) {
      // S1: admin media access only with a 2-step admin session when 2FA is on / required.
      const role = await require('../../../services/adminTwoFactor').effectiveRole(user.role, decoded, user.id);
      if (role !== user.role) user.setDataValue('role', role);
      return user;
    }
    return null;
  } catch {
    return null;
  }
};

// Hosts a stored https avatar may redirect to (Google / Firebase sign-in photos, our CDN).
const AVATAR_REDIRECT_HOSTS = ['googleusercontent.com', 'firebasestorage.googleapis.com', 'res.cloudinary.com', 'gravatar.com']
  .concat(String(process.env.AVATAR_REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

// @desc    A user's profile photo as an image (legacy data: URL avatars, decoded once and cached)
// @route   GET /api/campus/avatar/:userId
const serveAvatar = async (req, res) => {
  try {
    const userId = String(req.params.userId || '');
    if (!UUID_RE.test(userId)) return res.status(404).json({ message: 'Not found' });
    // S0: a signed link from an API response (avatarUrlFor) or a signed-in account; never anonymous by id.
    let allowed = verifyAvatarSig(userId, req.query.v, req.query.s);
    if (!allowed) allowed = !!(await viewerFrom(req));
    if (!allowed) return res.status(404).json({ message: 'No photo' });
    const User = getUserModel();
    const user = await User.findByPk(userId, { attributes: ['id', 'profileImage'] });
    const img = user && typeof user.profileImage === 'string' ? user.profileImage : '';
    if (!img) return res.status(404).json({ message: 'No photo' });
    // Redirect only to our own PUBLIC media rows or well-known photo hosts (never an open redirect, and
    // never a private row such as an ID card or Connect photo).
    const { mediaIdOf } = require('../../../utils/imageStore');
    const mid = mediaIdOf(img);
    if (mid) {
      const Media = getCampusMediaModel();
      const row = Media ? await Media.findByPk(mid, { attributes: ['id', 'isPrivate'] }) : null;
      if (!row || row.isPrivate) return res.status(404).json({ message: 'No photo' });
      res.set('Cache-Control', 'private, max-age=3600');
      return res.redirect(302, `/api/campus/media/${mid}`);
    }
    if (/^https:\/\//i.test(img)) {
      let host = '';
      try { host = new URL(img).hostname.toLowerCase(); } catch { host = ''; }
      if (AVATAR_REDIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
        res.set('Cache-Control', 'private, max-age=3600');
        return res.redirect(302, img);
      }
      return res.status(404).json({ message: 'No photo' });
    }
    const m = img.match(/^data:([a-z0-9.+/-]+);base64,(.*)$/is);
    if (!m) return res.status(404).json({ message: 'No photo' });
    const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    const mime = sniffImage(bytes);
    if (!mime) return res.status(404).json({ message: 'No photo' });
    const etag = `"a-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`;
    // ?v= changes whenever the photo changes, so a long cache is safe.
    return sendBytes(req, res, { bytes, mime, etag, maxAge: req.query.v ? 604800 : 300, isPrivate: true });
  } catch (err) {
    console.error('[CAMPUS_AVATAR_ERR]', err.message);
    res.status(500).json({ message: 'Could not load that photo.' });
  }
};

module.exports = { parseUpload, uploadMedia, serveMedia, serveAvatar, sniffImage, signedMediaUrl, sigFor, verifySignature, avatarSig, verifyAvatarSig, mediaHotCache: { stats: hotStats, clear: hotClear, drop: hotDrop } };
