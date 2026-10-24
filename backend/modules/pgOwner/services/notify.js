// Pushes for the ZCS PG Partner app: FCM to PgOwner.fcmTokens + an in-app Notification row with
// userId = owner id (GET /api/pg-owner/notifications), so nothing is lost when pushes are unavailable
// (no google-services.json yet, permission off). Never throws.
const { getModel } = require('../index');

/** Push + inbox row to one owner. */
const toOwner = async (ownerId, title, body, data = {}) => {
  try {
    const Owner = getModel('PgOwner');
    if (!Owner || !ownerId || !title) return false;
    const o = await Owner.findByPk(ownerId, { attributes: ['id', 'fcmTokens', 'status'] });
    if (!o || o.status === 'SUSPENDED') return false;
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

module.exports = { toOwner, toListingOwners, toStudent, admin };
