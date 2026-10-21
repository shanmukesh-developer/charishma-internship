// Small shared helpers for the campus module: push, public URLs, avatars, legacy DM decryption.
const crypto = require('crypto');
const { Op } = require('sequelize');

// ── Public URLs ─────────────────────────────────────────────────────────────
// Absolute origin of this API (Render sits behind a proxy; app has trust proxy = 1).
// utils/publicUrl: PUBLIC_API_URL, else the request's host, else '' (relative paths without a request).
const publicBase = (req) => require('../../utils/publicUrl').apiBase(req, { renderFallback: false });

const MEDIA_PATH_RE = /^\/api\/campus\/media\/[0-9a-f-]{36}$/i;

/** Turns a stored relative campus media path into an absolute URL; anything else is returned as is. */
const absolutize = (req, url) => {
  if (typeof url !== 'string' || !url) return url || null;
  if (url.startsWith('/api/')) return publicBase(req) + url;
  return url;
};

/**
 * Accepts a client-supplied image reference: a campus media path (/api/campus/media/<id>),
 * an https/http URL, or (legacy) a data:image URL up to maxDataUrlChars. Returns the cleaned
 * value or null when it is not acceptable.
 */
const cleanImageRef = (value, { maxDataUrlChars = 7 * 1024 * 1024 } = {}) => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (MEDIA_PATH_RE.test(v)) return v;
  // Absolute form of our own media path, or any other hosted image.
  if (/^https?:\/\/[^\s"'<>]{3,2000}$/i.test(v) && v.length <= 2048) return v;
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(v) && v.length <= maxDataUrlChars) return v;
  return null;
};

// Avatar for a user: data: URLs are not sent inline any more (they made chat lists megabytes);
// they are served by GET /api/campus/avatar/:userId instead.
const avatarUrlFor = (req, user) => {
  if (!user) return null;
  const img = user.profileImage;
  if (!img || typeof img !== 'string') return null;
  if (img.startsWith('data:')) {
    const v = crypto.createHash('sha1').update(img.slice(-64) + String(img.length)).digest('hex').slice(0, 10);
    // S0: signed (s=) so the avatar endpoint is not an anonymous lookup by user id.
    const s = require('./controllers/mediaController').avatarSig(user.id, v);
    return `${publicBase(req)}/api/campus/avatar/${user.id}?v=${v}&s=${s}`;
  }
  return absolutize(req, img);
};

/** S0: re-signs a stored /api/campus/avatar/<id>?v= link (e.g. community posts written before S0). */
const AVATAR_LINK_RE = /^(.*\/api\/campus\/avatar\/([0-9a-f-]{36}))\?v=([0-9a-f]{1,32})(?:&s=[0-9a-f]*)?$/i;
const resignAvatarUrl = (url) => {
  if (typeof url !== 'string') return url;
  const m = AVATAR_LINK_RE.exec(url);
  if (!m) return url;
  return `${m[1]}?v=${m[3]}&s=${require('./controllers/mediaController').avatarSig(m[2], m[3])}`;
};

// ── Legacy friend-DM encryption ─────────────────────────────────────────────
// /api/friends/message stores 'iv_hex:cipher_hex'. Campus screens must show the real text.
const ENC_RE = /^[0-9a-f]{32}:[0-9a-f]+$/i;
const readableText = (text) => {
  if (typeof text !== 'string' || !ENC_RE.test(text)) return text;
  try {
    const { decryptText } = require('../../utils/crypto');
    const out = decryptText(text);
    if (typeof out === 'string' && out.startsWith('[Decryption Failed')) return 'Message unavailable';
    return out;
  } catch {
    return 'Message unavailable';
  }
};

// ── Blocks ──────────────────────────────────────────────────────────────────
/** True when either user has blocked the other (Friendship.status = 'blocked'). */
const isBlockedBetween = async (a, b) => {
  if (!a || !b) return false;
  try {
    const { getFriendshipModel } = require('../../models/Friendship');
    const Friendship = getFriendshipModel();
    if (!Friendship) return false;
    const row = await Friendship.findOne({
      where: {
        status: 'blocked',
        [Op.or]: [{ requesterId: a, recipientId: b }, { requesterId: b, recipientId: a }],
      },
      attributes: ['id'],
    });
    return !!row;
  } catch (err) {
    // Fail closed: a database error must never read as "not blocked" (callers refuse on throw).
    console.warn('[CAMPUS_BLOCK_CHECK_WARN]', err.message);
    throw err;
  }
};

/** Set of user ids that are blocked with `userId` in either direction. */
const blockedIdsFor = async (userId) => {
  const out = new Set();
  try {
    const { getFriendshipModel } = require('../../models/Friendship');
    const Friendship = getFriendshipModel();
    if (!Friendship) return out;
    const rows = await Friendship.findAll({
      where: { status: 'blocked', [Op.or]: [{ requesterId: userId }, { recipientId: userId }] },
      attributes: ['requesterId', 'recipientId'],
    });
    rows.forEach((r) => out.add(r.requesterId === userId ? r.recipientId : r.requesterId));
  } catch (err) {
    // Fail closed (see isBlockedBetween): an empty set would show blocked people.
    console.warn('[CAMPUS_BLOCK_LIST_WARN]', err.message);
    throw err;
  }
  return out;
};

// ── Campus scope ────────────────────────────────────────────────────────────
/** { campusId, verified } of a user's campus profile (campusId null when none). */
const campusScopeFor = async (userId) => {
  const { getCampusProfileModel } = require('./models/CampusProfile');
  const CampusProfile = getCampusProfileModel && getCampusProfileModel();
  if (!CampusProfile || !userId) return { campusId: null, verified: false };
  const p = await CampusProfile.findOne({ where: { userId }, attributes: ['campusId', 'verificationStatus'] });
  return { campusId: p && p.campusId ? String(p.campusId) : null, verified: !!(p && p.verificationStatus === 'verified') };
};

/**
 * Sequelize condition "this user-id column belongs to a VERIFIED student of campusId", as a sub-select
 * (boards without their own campusId column: lost & found, ride pools).
 */
const sameCampusUsers = (campusId) => {
  const { getCampusProfileModel } = require('./models/CampusProfile');
  const CampusProfile = getCampusProfileModel();
  const sequelize = CampusProfile.sequelize;
  const tn = CampusProfile.getTableName();
  const table = typeof tn === 'string' ? tn : tn.tableName;
  const q = (id) => sequelize.getQueryInterface().quoteIdentifier(id);
  return {
    [Op.in]: sequelize.literal(`(SELECT ${q('userId')} FROM ${q(table)} WHERE ${q('campusId')} = ${sequelize.escape(String(campusId))} AND ${q('verificationStatus')} = 'verified')`),
  };
};

// ── Push ────────────────────────────────────────────────────────────────────
const tokensOf = (user) => {
  let list = user && user.fcmTokens;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = [list]; }
  }
  return Array.isArray(list) ? list.map((t) => (typeof t === 'string' ? t : t && t.token)).filter(Boolean) : [];
};

/**
 * Push to a set of users. Never throws.
 * opts.persist=false keeps it out of the in-app notification list (chat bubbles, calls).
 */
const pushToUsers = async (userIds, title, body, data = {}, opts = {}) => {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))].slice(0, 500);
    if (!ids.length) return;
    const { getUserModel } = require('../../models/User');
    const { sendPushToTokens } = require('../../utils/push');
    const User = getUserModel();
    if (!User) return;
    const users = await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'fcmTokens'] });
    const tokens = [];
    users.forEach((u) => tokens.push(...tokensOf(u)));
    await sendPushToTokens(tokens, title, body, data, {
      recipients: users.map((u) => u.id),
      // opts.category: the app's push switch this belongs to (utils/pushCategories); none = never muted.
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.persist === false ? { persist: false } : {}),
    });
  } catch (err) {
    console.warn('[CAMPUS_PUSH_WARN]', err.message);
  }
};

module.exports = {
  publicBase,
  absolutize,
  cleanImageRef,
  avatarUrlFor,
  resignAvatarUrl,
  readableText,
  isBlockedBetween,
  blockedIdsFor,
  campusScopeFor,
  sameCampusUsers,
  pushToUsers,
  MEDIA_PATH_RE,
};
