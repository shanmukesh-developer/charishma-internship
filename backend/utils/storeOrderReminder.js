// Waiting-order reminder pushes for the store / vendor apps (closed-app alert reliability).
//
// Why: the partner apps ring a new order again and again from their own foreground service. Android can
// stop that service (battery savers on Vivo / Xiaomi / Oppo, the Android 15 dataSync limit on older
// builds), and then one FCM push sound was all the store heard before the order auto-cancelled after
// STORE_ACCEPT_TIMEOUT_MIN. This re-sends the new-order push while the order is still Pending, so the
// phone rings again on the loud "New orders" channel even when the app was killed.
//
// - Runs inside the 'orders.autoCancel' job tick (every 2 minutes, single runner), so no new schedule.
// - PF-04 (6 Nov 2026): reminders follow a schedule over the WHOLE accept window, not just its first minutes (two
//   reminders by minute ~3 left a 60-minute window silent for 57 minutes): minutes 1.5, 5, 10, 15, 20, then every
//   10 minutes, and a last call 5 minutes before the cancel (reminderOffsetsMin). Never in the last minute before
//   the auto-cancel, at most one per tick, at least REMINDER_GAP_MS apart.
// - STORE_ORDER_REMINDER_MAX caps the count per order (default: the whole schedule; 0 turns them off; at most 20).
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
const KEEP_MS = 4 * 60 * 60 * 1000; // longer than the longest accept window (120 min) + slot lead
const MAX_REMINDERS = 20;

/**
 * Minutes after the accept clock started (deliverySlots.acceptAnchorMs) at which the store is reminded, for an accept
 * window of `timeoutMin` minutes. 60 -> [1.5, 5, 10, 15, 20, 30, 40, 50, 55]; 7 -> [1.5, 5].
 */
const reminderOffsetsMin = (timeoutMin) => {
  const lastAllowed = timeoutMin - LAST_MINUTE_MS / 60000; // strictly before the last minute
  const out = [FIRST_AFTER_MS / 60000, 5, 10, 15, 20];
  for (let m = 30; m < lastAllowed; m += 10) out.push(m);
  const finalCall = timeoutMin - 5;
  if (finalCall > out[out.length - 1] + 2) out.push(finalCall);
  return [...new Set(out)].filter((m) => m < lastAllowed).sort((a, b) => a - b);
};

const sent = new Map(); // orderId -> { count, at }

const reminderOn = (env = process.env) => !['0', 'false', 'off', 'no'].includes(String(env.STORE_ORDER_REMINDER_PUSH || '').trim().toLowerCase());
const reminderMax = (env = process.env) => {
  const n = parseInt(env.STORE_ORDER_REMINDER_MAX, 10);
  return Number.isFinite(n) ? Math.min(MAX_REMINDERS, Math.max(0, n)) : MAX_REMINDERS;
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
    const offsetsMs = reminderOffsetsMin(storeAcceptTimeoutMinutes()).map((m) => m * 60 * 1000);
    // Delivery slots: a slot order's accept clock starts an hour before its slot (utils/deliverySlots
    // acceptAnchorMs), so a night order for tomorrow is reminded when the kitchen has to act, not at night.
    const slots = require('./deliverySlots');
    const beforeSlotMs = slots.STORE_ACCEPT_BEFORE_SLOT_MIN * 60 * 1000;
    const rows = (await Order.findAll({
      where: {
        status: 'Pending',
        deliveryPartnerId: null,
        restaurantId: { [Op.ne]: null },
        createdAt: { [Op.lte]: new Date(now - FIRST_AFTER_MS) },
        [Op.or]: [
          { createdAt: { [Op.gt]: new Date(now - timeoutMs + LAST_MINUTE_MS) } },
          { slotStart: { [Op.gt]: new Date(now - timeoutMs + LAST_MINUTE_MS + beforeSlotMs) } },
        ],
      },
      attributes: ['id', 'restaurantId', 'items', 'finalPrice', 'paymentMethod', 'createdAt', 'slotStart', 'deliverySlot'],
      order: [['createdAt', 'ASC']],
      limit: 100,
    })).filter((o) => {
      const anchor = slots.acceptAnchorMs(o);
      return now - anchor >= FIRST_AFTER_MS && anchor + timeoutMs - now > LAST_MINUTE_MS;
    });
    const send = push || require('./storePush').pushToStore;
    let count = 0;
    for (const o of rows) {
      const id = String(o.id);
      const s = sent.get(id) || { count: 0, at: 0 };
      // How many schedule points this order has reached; one reminder per tick covers any it is behind on.
      const age = now - slots.acceptAnchorMs(o);
      const due = Math.min(max, offsetsMs.filter((t) => age >= t).length);
      if (due <= s.count || now - s.at < REMINDER_GAP_MS) continue;
      const leftMin = Math.max(1, Math.ceil((slots.acceptAnchorMs(o) + timeoutMs - now) / 60000));
      const n = itemCount(o.items);
      const slotText = o.slotStart ? ` For ${o.deliverySlot}.` : '';
      const body = `${n} item${n === 1 ? '' : 's'} · ₹${rupees(o.finalPrice)}${o.paymentMethod === 'COD' ? ' (cash)' : ''}.${slotText} Accept it in the next ${leftMin} min or it will be cancelled.`;
      // Accepted (or cancelled) while this loop was sending the earlier reminders: no "still waiting" for it.
      const stillPending = await Order.count({ where: { id: o.id, status: 'Pending', deliveryPartnerId: null } });
      if (!stillPending) continue;
      sent.set(id, { count: due, at: now });
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

module.exports = { remindPendingStoreOrders, reminderOn, reminderMax, reminderOffsetsMin, _resetReminders };
