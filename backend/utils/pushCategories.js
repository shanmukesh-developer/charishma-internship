// Customer push categories (polish hunt C-M14). The app sends { pushPrefs: { orders, offers, campus,
// reminders } } with its device token (POST /api/users/fcm-token); the categories switched off are kept on
// the User row as `pushMutes` (",offers,campus,"). utils/push.sendPushToTokens drops the device tokens of
// recipients who muted the push's category. The in-app notification list still records it.
// A push whose category cannot be told (account, wallet, support replies, safety) is never muted.
const CATEGORIES = ['orders', 'offers', 'campus', 'reminders'];

const TYPE_CATEGORY = {
  ORDER_UPDATE: 'orders', ORDER: 'orders', ORDER_CANCELLED: 'orders', ORDER_RELEASED: 'orders', DELIVERY: 'orders',
  GATE_ARRIVAL: 'orders', PICKUP: 'orders', order_update: 'orders', order: 'orders',
  campaign: 'offers', promo: 'offers', offer: 'offers',
  streak_nudge: 'reminders', abandoned_cart: 'reminders', reminder: 'reminders',
  BIRTHDAY_ALERT: 'campus', WALL_EVENT_ENDED: 'campus', WALL_WINNER_REWARD: 'campus',
};
// Personal or account pushes that a category switch never mutes (Friends has its own chat settings).
const NEVER_MUTED = new Set(['chat_message', 'incoming_call', 'CAMPUS_VERIFICATION', 'RIDER_SOS', 'MOD_OUTCOME', 'APPEAL_DECIDED']);
// Admin broadcast categories (Notifications page) that are offers; announcements stay unmutable.
const OFFER_BROADCASTS = new Set(['offer', 'offers', 'promo', 'promotion', 'deal', 'deals', 'discount']);

/** Category of a push from an explicit category option, or its data payload; null = never muted. */
const categoryOf = (data = {}, explicit) => {
  const d = data || {};
  if (NEVER_MUTED.has(d.type)) return null;
  if (explicit && CATEGORIES.includes(explicit)) return explicit;
  if (d.type === 'global_broadcast') return OFFER_BROADCASTS.has(String(d.category || '').toLowerCase()) ? 'offers' : null;
  if (typeof d.pushCategory === 'string' && CATEGORIES.includes(d.pushCategory)) return d.pushCategory;
  return TYPE_CATEGORY[d.type] || null;
};

/** ",offers,campus," from { orders: true, offers: false, campus: false, ... }; null = keep what is stored. */
const mutesFromPrefs = (prefs) => {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null;
  const off = CATEGORIES.filter((c) => prefs[c] === false);
  return off.length ? `,${off.join(',')},` : '';
};

module.exports = { CATEGORIES, categoryOf, mutesFromPrefs };
