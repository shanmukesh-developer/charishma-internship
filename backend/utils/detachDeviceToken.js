/**
 * A handed-over phone (1 Nov 2026): when an account saves a device push token, the same token is removed from every
 * other account of the same app, so the previous account's notifications (a driver's private ride request with its
 * fare, a PG owner's new booking) stop ringing on that phone. The rider and store paths already did this
 * (deliveryPartnerController saveFcmToken, utils/storePush); the Auto Driver and PG Partner paths did not.
 *
 * Those tables are small (tens of rows), so the rows are read and filtered here instead of a LIKE on the column,
 * which a Postgres JSON column would refuse. Never throws.
 */
const { Op } = require('sequelize');

const tokenOf = (t) => (typeof t === 'string' ? t : t && t.token);

/** Model: the account model (e.g. AutoDriver, PgOwner); keepId: the account that keeps the token. -> rows changed. */
async function detachDeviceToken(Model, keepId, token, tag = 'PARTNER') {
  if (!Model || !keepId || !token) return 0;
  let changed = 0;
  try {
    const rows = await Model.findAll({ where: { id: { [Op.ne]: keepId } }, attributes: ['id', 'fcmTokens'] });
    for (const row of rows) {
      const list = Array.isArray(row.fcmTokens) ? row.fcmTokens : [];
      const next = list.filter((t) => tokenOf(t) !== token);
      if (next.length === list.length) continue;
      await row.update({ fcmTokens: next });
      changed += 1;
    }
  } catch (err) {
    console.warn(`[${tag}_FCM_DEDUPE_WARN]`, err && err.message);
  }
  return changed;
}

module.exports = { detachDeviceToken };
