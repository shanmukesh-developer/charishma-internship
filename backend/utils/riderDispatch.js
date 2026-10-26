// Shared "who should hear about a new order" logic for rider pushes.
// A rider counts as live only when their last GPS fix is recent: a rider who killed the app hours
// ago keeps isOnline=true until the disconnect grace job runs, and must not take a push slot from
// riders who are really on duty.
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { sendPushToTokens } = require('./push');
const { getCoordsForAddress, getHaversineDistance } = require('./distance');

// What the rider earns for an order (rupees): the one C6 rule in utils/riderEarnings (stored delivery fee,
// ₹30 when it is 0; stall orders earn nothing). Kept under this name for the existing callers.
const { BASE_DELIVERY_FEE, earningRupees: riderPayout } = require('./riderEarnings');

// Orders one rider may hold at once (same env as the claim check in deliveryPartnerController).
const MAX_ACTIVE_ORDERS = Math.max(1, parseInt(process.env.RIDER_MAX_ACTIVE_ORDERS, 10) || 3);
const RIDER_FRESH_MS = Math.max(2, Number(process.env.RIDER_FRESH_MINUTES) || 10) * 60 * 1000;

const riderFixAgeMs = (rider) => {
  const loc = rider && rider.liveLocation;
  const ts = loc && loc.ts ? Date.parse(loc.ts) : NaN;
  return Number.isFinite(ts) ? Date.now() - ts : Infinity;
};

const isRiderFresh = (rider) => riderFixAgeMs(rider) <= RIDER_FRESH_MS;

// Online + approved riders, nearest fresh fix first; riders with stale or no position go last.
const rankOnlineRiders = async (restaurant, { excludeRiderId = null } = {}) => {
  const riders = await getDeliveryPartnerModel().findAll({ where: { isOnline: true, isApproved: true } });
  const restCoords = getCoordsForAddress(restaurant ? restaurant.location : '');
  return riders
    .filter((r) => !excludeRiderId || String(r.id) !== String(excludeRiderId))
    .map((rider) => {
      const loc = rider.liveLocation || {};
      const lat = loc.lat != null ? Number(loc.lat) : NaN;
      const lng = loc.lng != null ? Number(loc.lng) : (loc.lon != null ? Number(loc.lon) : NaN);
      const fresh = isRiderFresh(rider);
      const dist = fresh && Number.isFinite(lat) && Number.isFinite(lng)
        ? getHaversineDistance(restCoords.lat, restCoords.lon, lat, lng)
        : Infinity;
      return { rider, dist, fresh };
    })
    .sort((a, b) => (a.fresh === b.fresh ? a.dist - b.dist : a.fresh ? -1 : 1));
};

const tokensOf = (rider) => (Array.isArray(rider.fcmTokens) ? rider.fcmTokens : [])
  .map((t) => (typeof t === 'string' ? t : t && t.token))
  .filter(Boolean);

// Rider app Android channel (delivery-boy-app/src/services/notifications.ts ALERT_CHANNEL). Every push to a
// rider names it explicitly: the old 'delivery-alerts-v2' channel is deleted by the rider app, and relying on
// the manifest's default-channel fallback breaks the moment that default changes.
const RIDER_NEW_ORDER_CHANNEL = 'delivery-alerts-v3';
const RIDER_PUSH_ANDROID = Object.freeze({ priority: 'high', notification: { sound: 'alert', channelId: RIDER_NEW_ORDER_CHANNEL } });

// Push NEW_ORDER to the `limit` best-placed riders. Never throws.
const pushNearestRiders = async ({ restaurant, orderId, title, body, limit = 5, excludeRiderId = null, data = {} }) => {
  try {
    // Delivery slots: a slot order is not offered to riders hours early. Held back until DISPATCH_WINDOW_MIN
    // before the slot start, when the 'orders.slotDispatch' job pushes it (utils/deliverySlots).
    if (orderId) {
      const slotOrder = await require('../models/Order').getOrderModel().findByPk(orderId, { attributes: ['id', 'slotStart'] });
      if (slotOrder && !require('./deliverySlots').isDispatchDue(slotOrder)) return 0;
    }
    let ranked = await rankOnlineRiders(restaurant, { excludeRiderId });
    // A rider already carrying the maximum orders cannot claim this one: do not ring them, and do not let
    // them take one of the `limit` push slots from riders who can.
    if (ranked.length) {
      try {
        const { Op, fn, col } = require('sequelize');
        const rows = await require('../models/Order').getOrderModel().findAll({
          attributes: ['deliveryPartnerId', [fn('COUNT', col('id')), 'n']],
          where: { deliveryPartnerId: { [Op.in]: ranked.map(({ rider }) => rider.id) }, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
          group: ['deliveryPartnerId'],
          raw: true,
        });
        const full = new Set(rows.filter((r) => Number(r.n) >= MAX_ACTIVE_ORDERS).map((r) => String(r.deliveryPartnerId)));
        if (full.size) ranked = ranked.filter(({ rider }) => !full.has(String(rider.id)));
      } catch (countErr) {
        console.warn('[RIDER_DISPATCH_COUNT_WARN]', countErr.message);
      }
    }
    const tokens = ranked.slice(0, limit).flatMap(({ rider }) => tokensOf(rider));
    if (tokens.length === 0) return 0;
    // Rider app v3 channel (bundled 'alert' sound; the app deletes the old v2 channel).
    await sendPushToTokens(tokens, title, body, { orderId: String(orderId), type: 'NEW_ORDER', ...data }, {
      persist: false,
      android: RIDER_PUSH_ANDROID,
    });
    return tokens.length;
  } catch (err) {
    console.error('[RIDER_DISPATCH_PUSH_ERROR]', err.message);
    return 0;
  }
};

// A rider may hold several orders. currentOrderId must point at one they still carry (the oldest),
// or be null when they carry none: the presence job (server.js) never sets a rider offline while
// currentOrderId is set, so clearing it while other orders are still on the bike is a bug.
// Call after any order leaves a rider (delivered, cancelled, released). Never throws.
const refreshRiderCurrentOrder = async (riderId) => {
  if (!riderId) return null;
  try {
    const { Op } = require('sequelize');
    const { getOrderModel } = require('../models/Order');
    const next = await getOrderModel().findOne({
      where: { deliveryPartnerId: riderId, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
      attributes: ['id'],
      order: [['createdAt', 'ASC']],
    });
    const currentOrderId = next ? next.id : null;
    await getDeliveryPartnerModel().update({ currentOrderId }, { where: { id: riderId } });
    return currentOrderId;
  } catch (err) {
    console.warn('[RIDER_CURRENT_ORDER_WARN]', err.message);
    return null;
  }
};

module.exports = { RIDER_PUSH_ANDROID,
  RIDER_NEW_ORDER_CHANNEL, BASE_DELIVERY_FEE, riderPayout, RIDER_FRESH_MS, isRiderFresh, riderFixAgeMs, rankOnlineRiders, pushNearestRiders, refreshRiderCurrentOrder };
