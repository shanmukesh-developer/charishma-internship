// Human order ID shown everywhere an order is named (owner, 6 Nov 2026): "ZEN-123", one running count across the
// whole server (backend utils/orderNumbers). Orders the server has not numbered yet (only for a moment after a
// deploy) fall back to the old short reference "#AB12CD" (last 6 characters of the id).

type OrderLike = {
  orderCode?: string | null;
  orderNumber?: number | string | null;
  id?: string | null;
  _id?: string | null;
} | null | undefined;

/** Old short reference: last 6 characters of the id, upper case ("" when there is no id). */
export const shortOrderId = (id: unknown): string => String(id || '').replace(/-/g, '').slice(-6).toUpperCase();

/** "ZEN-123" from orderCode / orderNumber, else "#AB12CD" from the id, else "". */
export const orderCode = (order: OrderLike, fallbackId?: string | null): string => {
  if (order && order.orderCode) return String(order.orderCode);
  const n = order ? Number(order.orderNumber) : NaN;
  if (Number.isInteger(n) && n > 0) return `ZEN-${n}`;
  const id = (order && (order.id || order._id)) || fallbackId;
  const s = shortOrderId(id);
  return s ? `#${s}` : '';
};
