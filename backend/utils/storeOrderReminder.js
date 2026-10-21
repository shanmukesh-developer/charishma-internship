// Waiting-order reminder pushes for the store / vendor apps (closed-app alert reliability).
//
// Why: the partner apps ring a new order again and again from their own foreground service. Android can
// stop that service (battery savers on Vivo / Xiaomi / Oppo, the Android 15 dataSync limit on older
// builds), and then one FCM push sound was all the store heard before the order auto-cancelled after
// STORE_ACCEPT_TIMEOUT_MIN. This re-sends the new-order push while the order is still Pending, so the
// phone rings again on the loud "New orders" channel even when the app was killed.
//
// - Runs inside the 'orders.autoCancel' job tick (every 2 minutes, single runner), so no new schedule.
// - At most STORE_ORDER_REMINDER_MAX (default 2, 0..5) reminders per order, at least REMINDER_GAP_MS
//   apart, only after the order has waited FIRST_AFTER_MS, and never in the last minute before the
//   auto-cancel.
// - Same push type as the first one (NEW_ORDER, plus reminder '1'): an open app treats it as covered
//   in-app (no second sound on top of its own ring), older app builds behave exactly as for a new order.
// - Tagged `order-<id>` like the first push, so the tray shows one notification per order.
// - STORE_ORDER_REMINDER_PUSH=off turns it off. Memory only: a restart can send one extra reminder.
// Never throws.
const { Op } = require('sequelize');
const { getOrderModel } = require('../models/Order');
const { storeAcceptTimeoutMinutes } = require('./orderTimeouts');

const FIRST_AFTER_MS = 90 * 1000;
const REMINDER_GAP_MS = 100 * 1000;
const LAST_MINUTE_MS = 60 * 1000;
const KEEP_MS = 2 * 60 * 60 * 1000;

const sent = new Map(); // orderId -> { count, at }

const reminderOn = (env = process.env) => !['0', 'false', 'off', 'no'].includes(String(env.STORE_ORDER_REMINDER_PUSH || '').trim().toLowerCase());
const reminderMax = (env = process.env) => {
  const n = parseInt(env.STORE_ORDER_REMINDER_MAX, 10);
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 2;
};

const itemCount = (items) => {
  let list = items;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).reduce((s, i) => s + (Number(i && i.quantity) || 1), 0);
};
const rupees = (v) => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

/** Sends due reminders. Returns how many orders were reminded. */
const remindPendingStoreOrders = async ({ now = Date.now(), push = null } = {}) => {
  if (!reminderOn()) return 0;
  const max = reminderMax();
  if (max <= 0) return 0;
  try {
    for (const [id, s] of sent) if (now - s.at > KEEP_MS) sent.delete(id);
    const Order = getOrderModel();
    if (!Order) return 0;
    const timeoutMs = storeAcceptTimeoutMinutes() * 60 * 1000;
    const rows = await Order.findAll({
      where: {
        status: 'Pending',
        deliveryPartnerId: null,
        restaurantId: { [Op.ne]: null },
        createdAt: { [Op.gt]: new Date(now - timeoutMs + LAST_MINUTE_MS), [Op.lte]: new Date(now - FIRST_AFTER_MS) },
      },
      attributes: ['id', 'restaurantId', 'items', 'finalPrice', 'paymentMethod', 'createdAt'],
      order: [['createdAt', 'ASC']],
      limit: 100,
    });
    const send = push || require('./storePush').pushToStore;
    let count = 0;
    for (const o of rows) {
      const id = String(o.id);
      const s = sent.get(id) || { count: 0, at: 0 };
      if (s.count >= max || now - s.at < REMINDER_GAP_MS) continue;
      const leftMin = Math.max(1, Math.ceil((new Date(o.createdAt).getTime() + timeoutMs - now) / 60000));
      const n = itemCount(o.items);
      const body = `${n} item${n === 1 ? '' : 's'} · ₹${rupees(o.finalPrice)}${o.paymentMethod === 'COD' ? ' (cash)' : ''}. Accept it in the next ${leftMin} min or it will be cancelled.`;
      sent.set(id, { count: s.count + 1, at: now });
      try {
        await send(o.restaurantId, 'Order still waiting', body, { orderId: id, type: 'NEW_ORDER', reminder: '1' }, { tag: `order-${id}` });
        count++;
      } catch (err) {
        console.warn('[STORE_REMINDER_WARN]', err.message);
      }
    }
    return count;
  } catch (err) {
    console.warn('[STORE_REMINDER_WARN]', err.message);
    return 0;
  }
};

const _resetReminders = () => sent.clear();

module.exports = { remindPendingStoreOrders, reminderOn, reminderMax, _resetReminders };
