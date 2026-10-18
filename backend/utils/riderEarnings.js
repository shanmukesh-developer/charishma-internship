// C6: the ONE rule for what a rider earns per delivered order. Used by the rider app API (today / week /
// history / order payloads / delivered reply), the admin rider payout list, rider payout statements and
// DeliveryPartner.totalEarnings.
//
// Rule (unchanged from what the rider app has always shown, utils/riderDispatch.riderPayout):
//   earning = the order's stored delivery fee when it is > 0, otherwise the base fee ₹30.
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

/** What the rider earns for this order, in paise. */
const earningPaise = (order) => {
  if (!order || isStallOrder(order)) return 0;
  const fee = toPaise(order.deliveryFee);
  return fee > 0 ? fee : BASE_DELIVERY_FEE_PAISE;
};

/** Same, in rupees (the rider app and older code read rupees). */
const earningRupees = (order) => Math.round(earningPaise(order)) / 100;

/** Sum over many orders, in paise. */
const sumEarningsPaise = (orders) => (orders || []).reduce((s, o) => s + earningPaise(o), 0);

/**
 * The same rule as a SQL expression (per row, paise) for aggregates: SUM(<this>).
 * floor(x*100 + 0.5) like toPaise; SQLite has no FLOOR before 3.35 (CAST truncates toward zero).
 */
const earningPaiseSql = (dialect, feeCol = '"deliveryFee"', fulfilmentCol = '"fulfilment"') => {
  const v = `(COALESCE(${feeCol}, 0) * 100 + 0.5)`;
  const paise = dialect === 'postgres' ? `FLOOR(${v})` : `(CAST(${v} AS INTEGER) - (CASE WHEN ${v} < CAST(${v} AS INTEGER) THEN 1 ELSE 0 END))`;
  return `(CASE WHEN UPPER(COALESCE(${fulfilmentCol}, '')) = 'VENDOR' THEN 0 WHEN ${paise} > 0 THEN ${paise} ELSE ${BASE_DELIVERY_FEE_PAISE} END)`;
};

module.exports = { BASE_DELIVERY_FEE, BASE_DELIVERY_FEE_PAISE, toPaise, earningPaise, earningRupees, sumEarningsPaise, earningPaiseSql, isStallOrder };
