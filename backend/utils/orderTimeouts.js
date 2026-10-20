// Order timeouts read from the environment at call time (so tests and a Render env change apply
// without a code change). Shared by controllers/orderController.js, utils/legalFacts.js and the
// customer order JSON (storeAcceptDeadline), so every place shows the same number.

// How long a store has to accept a new order before it is cancelled automatically (and a Wallet
// payment refunded). STORE_ACCEPT_TIMEOUT_MIN (default 7, at least 3, at most 60); the older
// PENDING_ORDER_TIMEOUT_MINUTES is still honoured when the new variable is not set.
const storeAcceptTimeoutMinutes = (env = process.env) => {
  const fresh = parseInt(env.STORE_ACCEPT_TIMEOUT_MIN, 10);
  const legacy = parseInt(env.PENDING_ORDER_TIMEOUT_MINUTES, 10);
  const raw = Number.isFinite(fresh) ? fresh : (Number.isFinite(legacy) ? legacy : 7);
  return Math.min(60, Math.max(3, raw));
};

module.exports = { storeAcceptTimeoutMinutes };
