// Pushes for the ZCS PG Partner app: FCM to PgOwner.fcmTokens + an in-app Notification row with
// userId = owner id (GET /api/pg-owner/notifications), so nothing is lost when pushes are unavailable
// (no google-services.json yet, permission off). Never throws.
// Every owner notification also sends the live `pg:changed` event to the owner's open app (room pgowner_<id>, PF-07):
// ids, type and status only, so the Requests / Complaints lists refetch at once instead of on the 30 s timer.
const { getModel } = require('../index');

/** Live nudge to one owner's open app. data: { type, bookingId?, complaintId?, hostelId?, status? } (ids only). */
const liveToOwner = (ownerId, data = {}) => {
  try {
    const pick = {};
    for (const k of ['type', 'bookingId', 'complaintId', 'hostelId', 'status']) if (data[k] !== undefined && data[k] !== null) pick[k] = String(data[k]);
    require('../../../utils/realtime').toPgOwner(ownerId, 'pg:changed', pick);
  } catch { /* live update only */ }
};

/** Push + inbox row to one owner. */
const toOwner = async (ownerId, title, body, data = {}) => {
  try {
    const Owner = getModel('PgOwner');
    if (!Owner || !ownerId || !title) return false;
    const o = await Owner.findByPk(ownerId, { attributes: ['id', 'fcmTokens', 'status'] });
    if (!o || o.status === 'SUSPENDED') return false;
    liveToOwner(o.id, data);
    const tokens = Array.isArray(o.fcmTokens) ? o.fcmTokens.filter((t) => typeof t === 'string') : [];
    const { sendPushToTokens } = require('../../../utils/push');
    await sendPushToTokens(tokens, title, body, { screen: 'pg_owner', ...data }, { recipients: [String(o.id)] });
    return true;
  } catch (err) {
    console.warn('[PG_OWNER_PUSH_WARN]', err.message);
    return false;
  }
};

/** Push to the owner of a listing (no-op when the listing has no owner account). */
const toListingOwners = async (hostelId, title, body, data = {}) => {
  try {
    const Link = getModel('PgOwnerListing');
    if (!Link || !hostelId) return 0;
    const links = await Link.findAll({ where: { hostelId: String(hostelId) }, attributes: ['ownerId'] });
    let sent = 0;
    for (const l of links) if (await toOwner(l.ownerId, title, body, data)) sent++;
    return sent;
  } catch (err) {
    console.warn('[PG_OWNER_PUSH_WARN]', err.message);
    return 0;
  }
};

/** Live nudge (no push) to every owner of a listing: an admin / owner change they did not cause by push. */
const liveToListingOwners = async (hostelId, data = {}) => {
  try {
    const Link = getModel('PgOwnerListing');
    if (!Link || !hostelId) return 0;
    const links = await Link.findAll({ where: { hostelId: String(hostelId) }, attributes: ['ownerId'] });
    for (const l of links) liveToOwner(l.ownerId, { hostelId, ...data });
    return links.length;
  } catch (err) {
    console.warn('[PG_OWNER_LIVE_WARN]', err.message);
    return 0;
  }
};

/**
 * A student withdrew a request (PF-08): push + inbox row to each owner of the listing who was pushed about that request
 * (their inbox has its PG_OWNER_BOOKING row); every owner gets the live event either way. A request sent again within
 * the "notify once" window (routes/pgRoutes pgNotifyFirst) never pushed the owner, so its cancel does not either:
 * book -> cancel loops must not ring the owner each time. Returns the number of owners pushed.
 */
const toListingOwnersAboutCancel = async (hostelId, bookingId, title, body, data = {}) => {
  try {
    const Link = getModel('PgOwnerListing');
    if (!Link || !hostelId || !bookingId) return 0;
    const links = await Link.findAll({ where: { hostelId: String(hostelId) }, attributes: ['ownerId'] });
    if (!links.length) return 0;
    const { Op } = require('sequelize');
    const { getNotificationModel } = require('../../../models/Notification');
    const N = getNotificationModel();
    let sent = 0;
    for (const l of links) {
      const told = N ? await N.count({ where: { userId: String(l.ownerId), type: 'PG_OWNER_BOOKING', data: { [Op.like]: `%${String(bookingId)}%` } } }) : 0;
      if (told) { if (await toOwner(l.ownerId, title, body, data)) sent++; } else liveToOwner(l.ownerId, { hostelId, ...data });
    }
    return sent;
  } catch (err) {
    console.warn('[PG_OWNER_PUSH_WARN]', err.message);
    return 0;
  }
};

/** Push + in-app notification to a student (customer notification path). */
const toStudent = async (userId, title, body, data = {}) => {
  try {
    const { getUserModel } = require('../../../models/User');
    const u = await getUserModel().findByPk(userId, { attributes: ['id', 'fcmTokens'] });
    if (!u) return false;
    const { sendPushToTokens } = require('../../../utils/push');
    await sendPushToTokens(u.fcmTokens, title, body, data, { recipients: [String(u.id)] });
    return true;
  } catch (err) {
    console.warn('[PG_TENANT_PUSH_WARN]', err.message);
    return false;
  }
};

const admin = (type, action, id) => {
  try { require('../../../utils/realtime').notifyAdmin(type, action, id); } catch { /* best effort */ }
};

module.exports = { toOwner, toListingOwners, toListingOwnersAboutCancel, liveToOwner, liveToListingOwners, toStudent, admin };
