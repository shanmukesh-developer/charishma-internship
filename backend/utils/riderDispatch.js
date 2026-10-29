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
const MAX_ACTIVE_ORDERS = Math.max(1, parseInt(process.env.RIDER_MAX_ACTIVE_ORDERS, 10) || 3); // exported for older callers
const RIDER_FRESH_MS = Math.max(2, Number(process.env.RIDER_FRESH_MINUTES) || 10) * 60 * 1000;
// Most riders one new order rings (fresh nearest first, then riders with no recent position).
const MAX_PUSH_RIDERS = Math.max(5, parseInt(process.env.RIDER_MAX_PUSH, 10) || 20);

const riderFixAgeMs = (rider) => {
  const loc = rider && rider.liveLocation;
  const ts = loc && loc.ts ? Date.parse(loc.ts) : NaN;
  return Number.isFinite(ts) ? Date.now() - ts : Infinity;
};

const isRiderFresh = (rider) => riderFixAgeMs(rider) <= RIDER_FRESH_MS;

// Online + approved riders, nearest fresh fix first; riders with stale or no position go last.
const rankOnlineRiders = async (restaurant, { excludeRiderId = null } = {}) => {
  const riders = await getDeliveryPartnerModel().findAll({ where: { isOnline: true, isApproved: true } });
  // The store's saved map point when it has one; the address text only as a fallback (text that does not parse
  // put every store at one fallback point, so "nearest riders" was effectively arbitrary).
  const lat0 = restaurant ? Number(restaurant.lat) : NaN;
  const lon0 = restaurant ? Number(restaurant.lon) : NaN;
  const restCoords = Number.isFinite(lat0) && Number.isFinite(lon0) && !(lat0 === 0 && lon0 === 0)
    ? { lat: lat0, lon: lon0 }
    : getCoordsForAddress(restaurant ? restaurant.location : '');
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
// ttl: a pool offer older than 15 minutes is taken or cancelled; FCM would otherwise deliver it for 4 weeks.
const RIDER_PUSH_ANDROID = Object.freeze({ priority: 'high', ttl: 15 * 60 * 1000, notification: { sound: 'alert', channelId: RIDER_NEW_ORDER_CHANNEL } });

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
    // A rider already carrying the maximum jobs (orders + shopping lists + pickups, utils/riderLoad) cannot
    // claim this one: do not ring them, and do not let them take a push slot from riders who can.
    if (ranked.length) {
      try {
        const full = await require('./riderLoad').fullRiderIds(ranked.map(({ rider }) => rider.id));
        if (full.size) ranked = ranked.filter(({ rider }) => !full.has(String(rider.id)));
      } catch (countErr) {
        console.warn('[RIDER_DISPATCH_COUNT_WARN]', countErr.message);
      }
    }
    // The `limit` nearest riders with a fresh GPS fix, plus every on-duty rider whose position is unknown
    // or stale (location off, app backgrounded): they used to sort last and fall outside the `limit`, so
    // they were never rung at all. Capped so a big fleet is never rung all at once.
    const fresh = ranked.filter((x) => x.fresh).slice(0, limit);
    const stale = ranked.filter((x) => !x.fresh);
    const chosen = [...fresh, ...stale].slice(0, Math.max(limit, MAX_PUSH_RIDERS));
    const tokens = chosen.flatMap(({ rider }) => tokensOf(rider));
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

/**
 * One push to the rider who has (had) an order: a cancellation or a hand-over reaches them with the app closed too
 * (the socket events alone were lost whenever the rider's connection was down). `short` = the rider app's #ABC123.
 */
const shortRef = (orderId) => String(orderId || '').replace(/-/g, '').slice(-6).toUpperCase();
const pushAssignedRider = async (riderId, title, body, data = {}) => {
  if (!riderId) return null;
  try {
    const rider = await getDeliveryPartnerModel().findByPk(riderId, { attributes: ['id', 'fcmTokens'] });
    const tokens = rider ? tokensOf(rider) : [];
    if (!tokens.length) return null;
    return await sendPushToTokens(tokens, title, body, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), { persist: false, android: RIDER_PUSH_ANDROID });
  } catch (err) {
    console.warn('[RIDER_ASSIGNED_PUSH_WARN]', err && err.message);
    return null;
  }
};

module.exports = { RIDER_PUSH_ANDROID, pushAssignedRider, shortRef,
  RIDER_NEW_ORDER_CHANNEL, BASE_DELIVERY_FEE, riderPayout, RIDER_FRESH_MS, isRiderFresh, riderFixAgeMs, rankOnlineRiders, pushNearestRiders, refreshRiderCurrentOrder };
