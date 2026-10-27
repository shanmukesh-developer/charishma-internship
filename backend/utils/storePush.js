// Push notifications to a store's partner apps (Zenvy Restaurant / Zenvy Vendor) while the app is
// closed. Free: uses the existing firebase-admin setup (utils/push.js). Tokens live on
// Restaurant.fcmTokens as [{ token, app, at }], registered by POST /api/restaurants/fcm-token.
// Never put customer names / phones / addresses in these notifications (lock-screen visible).
const { getRestaurantModel } = require('../models/Restaurant');
const { sendPushToTokens } = require('./push');

const MAX_TOKENS_PER_STORE = 10;

const tokenOf = (t) => (typeof t === 'string' ? t : t && t.token) || null;

// restaurantOrId: Restaurant row or id. Returns the FCM result or null. Never throws.
// opts.tag: Android notification tag. A later push with the same tag replaces the earlier one in the tray
// (and rings again), so an order's reminders never stack up.
const pushToStore = async (restaurantOrId, title, body, data = {}, opts = {}) => {
  try {
    const Restaurant = getRestaurantModel();
    if (!Restaurant || !restaurantOrId) return null;
    const id = typeof restaurantOrId === 'object' ? restaurantOrId.id : restaurantOrId;
    // Always re-read the tokens (the row passed in may be older than the last registration).
    const store = await Restaurant.findByPk(id, { attributes: ['id', 'fcmTokens'] });
    // Which of the store's devices: opts.apps (e.g. ['campusstall'] for In-Campus Booking) or, by default, every
    // device except ZCS Campus Stall phones (delivery-order alerts belong to ZCS Vendor / ZCS Restaurant).
    const wanted = Array.isArray(opts && opts.apps) && opts.apps.length ? new Set(opts.apps.map(String)) : null;
    const appOf = (t) => (t && typeof t === 'object' && t.app ? String(t.app) : null);
    const tokens = store ? (store.fcmTokens || [])
      .filter((t) => (wanted ? wanted.has(appOf(t)) : appOf(t) !== 'campusstall'))
      .map(tokenOf).filter(Boolean) : [];
    if (!tokens.length) return null;
    const result = await sendPushToTokens(tokens, title, body, { ...data, restaurantId: id }, {
      persist: false, // not a customer notification: nothing to save in the in-app list
      android: { priority: 'high', notification: { sound: 'alert', channelId: 'delivery-alerts-v2', ...(opts && typeof opts.tag === 'string' && opts.tag ? { tag: opts.tag.slice(0, 64) } : {}) } },
    });
    const stale = (result && result.staleTokens) || [];
    if (stale.length) {
      const fresh = await Restaurant.findByPk(id, { attributes: ['id', 'fcmTokens'] });
      if (fresh) {
        fresh.fcmTokens = (fresh.fcmTokens || []).filter((t) => !stale.includes(tokenOf(t)));
        fresh.changed('fcmTokens', true);
        await fresh.save({ fields: ['fcmTokens'], hooks: false });
      }
    }
    return result || null;
  } catch (err) {
    console.warn('[STORE_PUSH_WARN]', err.message);
    return null;
  }
};

// Add (or with remove=true, drop) a device token for a store. Keeps the newest MAX_TOKENS_PER_STORE.
// A token moves to this store if another store had it (one phone, one signed-in store).
const registerStoreToken = async (restaurantId, token, { app = null, remove = false } = {}) => {
  const Restaurant = getRestaurantModel();
  const store = await Restaurant.findByPk(restaurantId);
  if (!store) return null;
  let list = (store.fcmTokens || []).filter((t) => tokenOf(t) && tokenOf(t) !== token);
  if (!remove) {
    list.push({ token, app: app || null, at: new Date().toISOString() });
    list = list.slice(-MAX_TOKENS_PER_STORE);
  }
  store.fcmTokens = list;
  store.changed('fcmTokens', true);
  await store.save({ fields: ['fcmTokens'], hooks: false });
  if (!remove) {
    try {
      const { Op } = require('sequelize');
      const others = await Restaurant.findAll({
        where: { id: { [Op.ne]: store.id }, fcmTokens: { [Op.like]: require('./fcmToken').tokenLikePattern(token) } },
        attributes: ['id', 'fcmTokens'],
      });
      for (const other of others) {
        const before = other.fcmTokens || [];
        const after = before.filter((t) => tokenOf(t) !== token);
        if (after.length === before.length) continue;
        other.fcmTokens = after;
        other.changed('fcmTokens', true);
        await other.save({ fields: ['fcmTokens'], hooks: false });
      }
    } catch (err) {
      console.warn('[STORE_TOKEN_DEDUPE_WARN]', err.message);
    }
  }
  return list.length;
};

module.exports = { pushToStore, registerStoreToken, MAX_TOKENS_PER_STORE };
