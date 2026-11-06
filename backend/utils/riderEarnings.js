// C6: the ONE rule for what a rider earns per delivered order. Used by the rider app API (today / week /
// history / order payloads / delivered reply), the admin rider payout list, rider payout statements and
// DeliveryPartner.totalEarnings.
//
// Rule:
//   earning = the order's stored delivery fee.
//   A fee of ₹0 earns ₹0 (owner, 6 Nov 2026: a store with a ₹0 special delivery price must not cost ZenWe ₹30
//   per order). The old "₹30 when the fee is 0" fallback is kept ONLY for legacy orders saved before the
//   server-computed bill existed (Order.priceBreakdown is null), so old history and old statements do not change.
//   Callers must load 'priceBreakdown' with 'deliveryFee' (EARNING_ATTRS); a row without the key is read as legacy.
//   Stall orders (fulfilment 'VENDOR') have no Zenvy rider and earn nothing.
//   Tips are separate (rider wallet, C5 ledger) and are never part of the per-order earning.
//   Cash a rider collects for COD orders is separate too (rider cash ledger, utils/riderCash): it is
//   never netted off earnings.
//
// Why this rule: it is the number every rider saw per order and in "Earned today", it is what
// DeliveryPartner.totalEarnings accumulated, and it is the higher of the two old views. The old admin
// payout list summed the raw deliveryFee, which paid ₹0 for an order whose fee was 0 (delivery_fee set
// to 0) while the rider app showed ₹30. For every order with a fee > 0 both old views already agreed.
//
// deliveryFee is the GROSS fee stored at order creation (before batch / perk / coupon delivery
// discounts, which Zenvy funds), so a discount never reduces the rider's earning.
const BASE_DELIVERY_FEE = 30;
const BASE_DELIVERY_FEE_PAISE = BASE_DELIVERY_FEE * 100;

/** Rupees -> integer paise, round half up (same as utils/walletLedger.toPaise). */
const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n * 100 + 0.5);
};

const isStallOrder = (order) => String((order && order.fulfilment) || '').toUpperCase() === 'VENDOR';

/** The Order columns earningPaise reads (add them to every query whose rows are passed in). */
const EARNING_ATTRS = ['deliveryFee', 'fulfilment', 'priceBreakdown'];

/** True for an order saved before the server bill (Order.priceBreakdown) existed. */
const isLegacyOrder = (order) => order.priceBreakdown === null || order.priceBreakdown === undefined || order.priceBreakdown === '';

/** What the rider earns for this order, in paise. */
const earningPaise = (order) => {
  if (!order || isStallOrder(order)) return 0;
  const fee = toPaise(order.deliveryFee);
  if (fee > 0) return fee;
  return isLegacyOrder(order) ? BASE_DELIVERY_FEE_PAISE : 0;
};

/** Same, in rupees (the rider app and older code read rupees). */
const earningRupees = (order) => Math.round(earningPaise(order)) / 100;

/** Sum over many orders, in paise. */
const sumEarningsPaise = (orders) => (orders || []).reduce((s, o) => s + earningPaise(o), 0);

/**
 * The same rule as a SQL expression (per row, paise) for aggregates: SUM(<this>).
 * floor(x*100 + 0.5) like toPaise; SQLite has no FLOOR before 3.35 (CAST truncates toward zero).
 */
const earningPaiseSql = (dialect, feeCol = '"deliveryFee"', fulfilmentCol = '"fulfilment"', billCol = '"priceBreakdown"') => {
  const v = `(COALESCE(${feeCol}, 0) * 100 + 0.5)`;
  const paise = dialect === 'postgres' ? `FLOOR(${v})` : `(CAST(${v} AS INTEGER) - (CASE WHEN ${v} < CAST(${v} AS INTEGER) THEN 1 ELSE 0 END))`;
  return `(CASE WHEN UPPER(COALESCE(${fulfilmentCol}, '')) = 'VENDOR' THEN 0 WHEN ${paise} > 0 THEN ${paise} WHEN ${billCol} IS NULL THEN ${BASE_DELIVERY_FEE_PAISE} ELSE 0 END)`;
};

module.exports = { BASE_DELIVERY_FEE, BASE_DELIVERY_FEE_PAISE, EARNING_ATTRS, isLegacyOrder, toPaise, earningPaise, earningRupees, sumEarningsPaise, earningPaiseSql, isStallOrder };
