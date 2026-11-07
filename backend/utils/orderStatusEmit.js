// One place that tells everyone watching an order about a status change (6 Nov 2026, PF-06).
//
// `statusUpdated` goes to the order room AND the customer's own room (`user_<id>`, joined on every connect) in one
// emit, so a socket in both gets it once; plus 'admin-room', the store's room and the admin "something changed" nudge.
// Before this, only store-driven statuses (orderController.broadcastOrderStatus) reached the customer's own room:
// the rider claim / pickup / at-gate / delivered steps, the auto-cancels and the admin rider changes went to the
// order room only, so a customer screen that had not joined the order room (orders list before it loaded, phone
// woke up) stayed stale until a push or a manual refresh.
// Never throws.
const orderNumbers = require('./orderNumbers');

/**
 * @param io        socket.io server (no-op when missing)
 * @param order     the order row (id, userId, restaurantId, orderNumber) or plain object with those fields
 * @param payload   the statusUpdated payload ({ id, status, ... }); the human order ID is added when missing
 * @param opts      { restaurant = true, admin = true, notifyAdmin = true, extraRooms = [] }
 * @returns the payload that was sent (or null)
 */
const emitOrderStatus = (io, order, payload, opts = {}) => {
  if (!io || !order || !payload) return null;
  const { restaurant = true, admin = true, notifyAdmin = true, extraRooms = [] } = opts;
  try {
    const room = String(order.id);
    const p = payload.orderCode === undefined ? { ...orderNumbers.fields(order), ...payload } : payload;
    const rooms = [room];
    if (order.userId) rooms.push(`user_${order.userId}`);
    for (const r of extraRooms) if (r && !rooms.includes(String(r))) rooms.push(String(r));
    io.to(rooms).emit('statusUpdated', p);
    if (admin) io.to('admin-room').emit('statusUpdated', p);
    if (restaurant && order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', p);
    if (notifyAdmin) require('./realtime').notifyAdmin('order', 'updated', room);
    return p;
  } catch (err) {
    console.warn('[ORDER_STATUS_EMIT_WARN]', err.message);
    return null;
  }
};

module.exports = { emitOrderStatus };
