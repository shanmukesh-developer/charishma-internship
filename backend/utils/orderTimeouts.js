// Order timeouts read from the environment at call time (so tests and a Render env change apply
// without a code change). Shared by controllers/orderController.js, utils/legalFacts.js and the
// customer order JSON (storeAcceptDeadline), so every place shows the same number.

// How long a store has to accept a new order before it is cancelled automatically (and a Wallet
// payment refunded). Owner, 5 Nov 2026: one hour (was 7 minutes). STORE_ACCEPT_TIMEOUT_MIN (default 60, at
// least 3, at most 120); the older PENDING_ORDER_TIMEOUT_MINUTES is still honoured when the new one is not set.
// Slot orders count it from when the store can first accept them (utils/deliverySlots acceptAnchorMs).
const storeAcceptTimeoutMinutes = (env = process.env) => {
  const fresh = parseInt(env.STORE_ACCEPT_TIMEOUT_MIN, 10);
  const legacy = parseInt(env.PENDING_ORDER_TIMEOUT_MINUTES, 10);
  const raw = Number.isFinite(fresh) ? fresh : (Number.isFinite(legacy) ? legacy : 60);
  return Math.min(120, Math.max(3, raw));
};

// When the store must have accepted a Pending order (ISO, server time): the accept clock start (placement, or for a
// slot order an hour before its slot: utils/deliverySlots acceptAnchorMs) + storeAcceptTimeoutMinutes. Null once the
// order is past Pending. Sent to the customer (order JSON) and to the store apps (order list + restaurant_newOrder),
// which keep ringing until it (PF-04).
const storeAcceptByIso = (o, env = process.env) => {
  if (!o || o.status !== 'Pending') return null;
  const t = require('./deliverySlots').acceptAnchorMs(o) + storeAcceptTimeoutMinutes(env) * 60 * 1000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

module.exports = { storeAcceptTimeoutMinutes, storeAcceptByIso };
