// Revenue (owner, 6 Nov 2026): what ZenWe collected, what it keeps and what it owes each store, for an IST day /
// week (Mon-Sun) / month, plus the settlement cycle per store and "Settle all". Integer paise everywhere.
//
// WHICH ORDERS COUNT
//   status = 'Delivered' only, placed in the period by the time it was delivered (deliveredAt, IST; older rows
//   without deliveredAt fall back to updatedAt, the same rule as payout statements). Every other status
//   (Pending ... OutForDelivery, Cancelled) is excluded: a cancelled order's wallet money was refunded in full
//   (ORDER_REFUND) and cash was never taken. Owner-only test orders (isTestData, or a test store) are excluded and
//   counted separately.
//   Partial refunds: the app has no partial-refund flow for delivered orders. If a wallet ORDER_REFUND row ever
//   points at a delivered order, it is shown as "Refunds on delivered orders", taken off what was collected and
//   off what ZenWe keeps (ZenWe funds refunds; the store's share is not reduced).
//
// PER ORDER (paise; the bill parts come from the server-computed Order.priceBreakdown saved at checkout)
//   collected    = finalPrice: what the customer paid (items + delivery + platform fee + packaging + taxes
//                  - every discount). Channel: 'cod' (cash taken by a ZenWe rider), 'wallet' (ZenWe wallet),
//                  'stall' (fulfilment VENDOR: the stall took the cash itself, it never reaches ZenWe), 'other'
//                  (UPI / Card on orders from before COD + Wallet only).
//   commission   = the snapshot fixed when the order was placed (Order.commissionAmountPaise, utils/commission).
//                  Orders settled before the snapshot existed have none: their commission uses the store's rate AS
//                  IT IS NOW and the order is marked commissionEstimated ("rate at report time").
//   store share  = item subtotal - commission (Order.storeNetPaise) = what belongs to the store.
//                  Buy-at-store orders (storePaidByRider): the rider paid the shop at the counter (approved bill,
//                  else the item subtotal), the shop is never on a ZenWe statement and no commission is taken,
//                  so store share = what was paid at the counter and commission = 0.
//   rider pay    = utils/riderEarnings.earningPaise (delivery fee, or ₹30 when the fee is 0; stall orders 0).
//                  This is the rule riders are paid by, not a record of money sent. Tips are not ZenWe money
//                  (customer -> rider wallet) and are not in any number here.
//   ZenWe keeps  = commission + delivery fee + platform fee + packaging fee + taxes
//                  - discounts (coupons, member perks, shared-ride discounts: all ZenWe-funded)
//                  - rider pay - refunds on delivered orders.
//                  Packaging fee: store statements have never included it (docs/C6_FINANCE.md), so today it stays
//                  with ZenWe; it is shown on its own line so the owner can see it.
//   owed to the store via statements = store share - cash the stall collected itself (0 for buy-at-store). A stall
//                  holding the customers' cash can be negative: it owes ZenWe.
//   settled      = on a PAID statement (Order.payoutSettled); on statement = on a PENDING statement; pending =
//                  owed - settled.
//
// RECONCILIATION (must be exactly 0): collected - refunds = store share + ZenWe keeps + rider pay.
//   Per order: finalPrice is compared with its parts (store share + commission + fees - discounts). Any order
//   where they differ (e.g. a Mega Basket bill approved after the commission snapshot, a clamped total, an old row
//   without a saved bill) is listed with its difference; nothing is forced to balance.
const crypto = require('crypto');
const { Op, Transaction } = require('sequelize');
const { toPaise, earningPaise } = require('./riderEarnings');
const { computeCommission } = require('./commission');
const { IST_OFFSET_MS, istShift } = require('./istTime');
const { storePurchasePaise } = require('./riderCash');
const payouts = require('./payouts');

const { PayoutError } = payouts;
const SETTLEMENT_CYCLES = ['daily', 'weekly', 'monthly'];
const DEFAULT_CYCLE = 'weekly';
const PERIODS = ['day', 'week', 'month'];
const DAY_MS = 24 * 60 * 60 * 1000;
const MONEY_TX = { type: Transaction.TYPES.IMMEDIATE };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_MISMATCHES = 200;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const normalizeCycle = (v) => {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return SETTLEMENT_CYCLES.includes(s) ? s : null;
};
const cycleOf = (store) => normalizeCycle(store && store.settlementCycle) || DEFAULT_CYCLE;
const truthy = (v) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

// ── IST calendar helpers (UTC+05:30, no DST) ─────────────────────────────────────────────────────
// A calendar date is handled as its UTC-midnight timestamp ("civil ms"); the real instant of IST midnight on
// that date is civil - 5h30m.
const civilOf = (ymd) => {
  const m = YMD_RE.exec(String(ymd || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
};
const ymdOfCivil = (civil) => new Date(civil).toISOString().slice(0, 10);
const istYmdOf = (d) => istShift(d).toISOString().slice(0, 10);
const instantOfCivil = (civil) => new Date(civil - IST_OFFSET_MS);
const dayLabel = (civil) => { const d = new Date(civil); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const shortLabel = (civil) => { const d = new Date(civil); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/**
 * The IST period containing `date` ('YYYY-MM-DD', default today in IST). Half-open [start, endExclusive).
 * Weeks run Monday 00:00 to Sunday 23:59:59.999 IST.
 */
const periodBounds = (period, date = null, now = new Date()) => {
  const p = String(period || 'day').toLowerCase();
  if (!PERIODS.includes(p)) throw new PayoutError(400, 'INVALID_INPUT', 'period must be day, week or month.');
  const civil = date ? civilOf(date) : civilOf(istYmdOf(now));
  if (civil === null) throw new PayoutError(400, 'INVALID_INPUT', 'date must be a real date like 2026-11-06.');
  const d = new Date(civil);
  let startCivil;
  let endCivil;
  let label;
  if (p === 'day') {
    startCivil = civil;
    endCivil = civil + DAY_MS;
    label = dayLabel(civil);
  } else if (p === 'week') {
    startCivil = civil - ((d.getUTCDay() + 6) % 7) * DAY_MS;
    endCivil = startCivil + 7 * DAY_MS;
    const last = new Date(endCivil - DAY_MS);
    label = `${shortLabel(startCivil)} – ${shortLabel(endCivil - DAY_MS)} ${last.getUTCFullYear()}`;
  } else {
    startCivil = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    endCivil = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    label = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const prevCivil = p === 'month' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) : startCivil - (p === 'week' ? 7 : 1) * DAY_MS;
  const todayCivil = civilOf(istYmdOf(now));
  return {
    period: p,
    label,
    startDate: ymdOfCivil(startCivil),
    endDate: ymdOfCivil(endCivil - DAY_MS),
    start: instantOfCivil(startCivil),
    endExclusive: instantOfCivil(endCivil),
    end: new Date(instantOfCivil(endCivil).getTime() - 1),
    prevDate: ymdOfCivil(prevCivil),
    nextDate: ymdOfCivil(endCivil),
    isCurrent: todayCivil >= startCivil && todayCivil < endCivil,
    isFuture: startCivil > todayCivil,
    days: Math.round((endCivil - startCivil) / DAY_MS),
    startCivil,
    endCivil,
  };
};

/**
 * The last moment a "Settle all" for this cycle covers (inclusive), in IST:
 *   daily   -> yesterday 23:59:59.999
 *   weekly  -> last Sunday 23:59:59.999 (the most recent complete Mon-Sun week)
 *   monthly -> the last day of the previous month, 23:59:59.999
 * Orders delivered up to then and not on any statement yet go on the new statements.
 */
const settlementCutoff = (cycle, now = new Date()) => {
  const c = normalizeCycle(cycle);
  if (!c) throw new PayoutError(400, 'INVALID_INPUT', `cycle must be one of: ${SETTLEMENT_CYCLES.join(', ')}.`);
  const today = civilOf(istYmdOf(now));
  const t = new Date(today);
  let endCivil; // exclusive
  if (c === 'daily') endCivil = today;
  else if (c === 'weekly') endCivil = today - ((t.getUTCDay() + 6) % 7) * DAY_MS;
  else endCivil = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
  const cutoff = new Date(instantOfCivil(endCivil).getTime() - 1);
  return { cycle: c, cutoff, coversThrough: ymdOfCivil(endCivil - DAY_MS), label: `Orders delivered up to ${dayLabel(endCivil - DAY_MS)}, 11:59 pm IST` };
};

// ── per-order money ──────────────────────────────────────────────────────────────────────────────
const parseJson = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

const DISCOUNT_GROUPS = { coupon: 'coupon', perk_delivery: 'perks', perk_order: 'perks', batch: 'sharedRide' };

/** The bill parts of one order (paise), from the saved server bill; older rows fall back to the columns. */
const billParts = (o) => {
  const pb = parseJson(o.priceBreakdown);
  const discounts = { coupon: 0, perks: 0, sharedRide: 0, other: 0 };
  let hasBill = false;
  if (pb && typeof pb === 'object' && Array.isArray(pb.discounts)) {
    hasBill = true;
    for (const d of pb.discounts) {
      const a = toPaise(d && d.amount);
      if (a <= 0) continue;
      discounts[DISCOUNT_GROUPS[String(d.type || '')] || 'other'] += a;
    }
  } else {
    // Before the saved bill: shared-ride and perk discounts lived in their own columns.
    discounts.sharedRide += Math.max(0, toPaise(o.batchDiscount));
    discounts.perks += Math.max(0, toPaise(o.gateDiscount));
  }
  const platform = pb && pb.platformFee !== undefined && pb.platformFee !== null ? toPaise(pb.platformFee) : toPaise(o.platformFee);
  return {
    hasBill,
    deliveryFeePaise: Math.max(0, toPaise(o.deliveryFee)),
    platformFeePaise: Math.max(0, platform),
    packagingFeePaise: pb ? Math.max(0, toPaise(pb.packagingFee)) : 0,
    taxesPaise: pb ? Math.max(0, toPaise(pb.taxes)) : 0,
    discounts,
    discountPaise: discounts.coupon + discounts.perks + discounts.sharedRide + discounts.other,
  };
};

const channelOf = (o) => {
  if (String(o.fulfilment || '').toUpperCase() === 'VENDOR') return 'stall';
  const pm = String(o.paymentMethod || '').toUpperCase();
  if (pm === 'COD') return 'cod';
  if (pm === 'WALLET') return 'wallet';
  return 'other';
};

/**
 * Every money figure of one delivered order (paise). `store` = its Restaurant row (current rate, only used when the
 * order has no commission snapshot); `refundPaise` = wallet ORDER_REFUND credited for it (normally 0).
 */
const orderMoney = (o, store, refundPaise = 0) => {
  const bill = billParts(o);
  const collected = Math.max(0, toPaise(o.finalPrice));
  const channel = channelOf(o);
  const buyAtStore = truthy(o.storePaidByRider);
  let commission;
  let storeShare;
  let commissionEstimated = false;
  let storeMissing = false;
  if (buyAtStore) {
    commission = 0;
    storeShare = storePurchasePaise(o);
  } else if (o.commissionAmountPaise !== null && o.commissionAmountPaise !== undefined) {
    commission = Number(o.commissionAmountPaise) || 0;
    storeShare = Number(o.storeNetPaise) || 0;
  } else {
    commissionEstimated = true;
    if (store) {
      const c = computeCommission({ subtotal: o.totalPrice, rate: store.commissionRate, type: store.commissionType });
      commission = c.commissionAmountPaise;
      storeShare = c.storeNetPaise;
    } else {
      storeMissing = true;
      commission = 0;
      storeShare = Math.max(0, toPaise(o.totalPrice));
    }
  }
  const riderPay = o.deliveryPartnerId && channel !== 'stall' ? earningPaise(o) : 0;
  const refund = Math.max(0, Number(refundPaise) || 0);
  const stallCash = channel === 'stall' ? collected : 0;
  const keeps = commission + bill.deliveryFeePaise + bill.platformFeePaise + bill.packagingFeePaise + bill.taxesPaise - bill.discountPaise - riderPay - refund;
  // What the bill's parts add up to; must equal what the customer paid.
  const expected = storeShare + commission + bill.deliveryFeePaise + bill.platformFeePaise + bill.packagingFeePaise + bill.taxesPaise - bill.discountPaise;
  let settlement = 'unsettled';
  if (buyAtStore) settlement = 'counter';
  else if (truthy(o.payoutSettled)) settlement = 'settled';
  else if (o.payoutId) settlement = 'on_statement';
  return {
    collected, channel, buyAtStore, commission, storeShare, itemsPaise: storeShare + commission, commissionEstimated, storeMissing,
    riderPay, refund, stallCash, keeps,
    counterPaid: buyAtStore ? storeShare : 0,
    owed: buyAtStore ? 0 : storeShare - stallCash,
    settlement,
    differencePaise: collected - expected,
    hasBill: bill.hasBill,
    ...bill,
  };
};

// Delivered in [from, toExclusive) (older rows without deliveredAt: updatedAt).
const deliveredWithin = (from, toExclusive) => ({
  [Op.or]: [
    { deliveredAt: { [Op.gte]: from, [Op.lt]: toExclusive } },
    { deliveredAt: null, updatedAt: { [Op.gte]: from, [Op.lt]: toExclusive } },
  ],
});

const ORDER_ATTRS = [
  'id', 'restaurantId', 'deliveryPartnerId', 'status', 'paymentMethod', 'fulfilment', 'totalPrice', 'deliveryFee', 'platformFee',
  'batchDiscount', 'gateDiscount', 'finalPrice', 'priceBreakdown', 'commissionRate', 'commissionType', 'commissionAmountPaise',
  'storeNetPaise', 'commissionSource', 'storePaidByRider', 'billAmount', 'isBillApproved', 'payoutId', 'payoutSettled',
  'riderPayoutSettled', 'deliveredAt', 'updatedAt', 'isTestData',
];
const orderAttrs = (Order) => ORDER_ATTRS.filter((a) => Order.rawAttributes[a]).concat(Order.rawAttributes.orderCode ? ['orderCode'] : []);
const orderLabel = (o) => o.orderCode || `#${String(o.id).slice(-6)}`;

const refundsFor = async (sequelize, orderIds) => {
  const out = new Map();
  const WT = sequelize.models.WalletTransaction;
  if (!WT || !orderIds.length) return out;
  for (let i = 0; i < orderIds.length; i += 500) {
    const rows = await WT.findAll({
      where: { type: 'ORDER_REFUND', refType: 'ORDER', refId: { [Op.in]: orderIds.slice(i, i + 500).map(String) } },
      attributes: ['refId', 'amountPaise'], raw: true,
    });
    for (const r of rows) out.set(String(r.refId), (out.get(String(r.refId)) || 0) + Math.max(0, Number(r.amountPaise) || 0));
  }
  return out;
};

const zeroTotals = () => ({
  orders: 0,
  collectedPaise: 0,
  byChannel: { cod: 0, wallet: 0, stall: 0, other: 0 },
  ordersByChannel: { cod: 0, wallet: 0, stall: 0, other: 0 },
  refundsPaise: 0,
  itemsPaise: 0,
  commissionPaise: 0,
  deliveryFeesPaise: 0,
  platformFeesPaise: 0,
  packagingFeesPaise: 0,
  taxesPaise: 0,
  discounts: { coupon: 0, perks: 0, sharedRide: 0, other: 0 },
  discountsPaise: 0,
  riderPayPaise: 0,
  keepsPaise: 0,
  storeSharePaise: 0,
  counterPaidPaise: 0,
  stallCashPaise: 0,
  owedPaise: 0,
  settledPaise: 0,
  onStatementPaise: 0,
  pendingPaise: 0,
  commissionEstimatedOrders: 0,
  differencePaise: 0,
});

const addTo = (t, m) => {
  t.orders++;
  t.collectedPaise += m.collected;
  t.byChannel[m.channel] += m.collected;
  t.ordersByChannel[m.channel]++;
  t.refundsPaise += m.refund;
  t.itemsPaise += m.itemsPaise;
  t.commissionPaise += m.commission;
  t.deliveryFeesPaise += m.deliveryFeePaise;
  t.platformFeesPaise += m.platformFeePaise;
  t.packagingFeesPaise += m.packagingFeePaise;
  t.taxesPaise += m.taxesPaise;
  for (const k of Object.keys(t.discounts)) t.discounts[k] += m.discounts[k];
  t.discountsPaise += m.discountPaise;
  t.riderPayPaise += m.riderPay;
  t.keepsPaise += m.keeps;
  t.storeSharePaise += m.storeShare;
  t.counterPaidPaise += m.counterPaid;
  t.stallCashPaise += m.stallCash;
  t.owedPaise += m.owed;
  if (m.settlement === 'settled') t.settledPaise += m.owed;
  if (m.settlement === 'on_statement') t.onStatementPaise += m.owed;
  t.pendingPaise = t.owedPaise - t.settledPaise;
  if (m.commissionEstimated) t.commissionEstimatedOrders++;
  t.differencePaise += m.differencePaise;
};

/**
 * The Revenue report for one IST period (and optionally one store). Read-only.
 * Returns { period, totals, keepsLines, reconciliation, stores, series, excluded, notes }.
 */
const buildRevenueReport = async ({ sequelize, period = 'day', date = null, storeId = null, now = new Date() }) => {
  const b = periodBounds(period, date, now);
  if (storeId && !UUID_RE.test(String(storeId))) throw new PayoutError(400, 'INVALID_INPUT', 'storeId is not valid.');
  // The series: the days of the week / month; for a single day, the 14 days ending on it.
  const seriesStartCivil = b.period === 'day' ? b.startCivil - 13 * DAY_MS : b.startCivil;
  const queryFrom = instantOfCivil(seriesStartCivil);
  const Order = sequelize.models.Order;
  const Restaurant = sequelize.models.Restaurant;
  const rows = await Order.findAll({
    where: { status: 'Delivered', ...(storeId ? { restaurantId: String(storeId) } : {}), ...deliveredWithin(queryFrom, b.endExclusive) },
    attributes: orderAttrs(Order),
    order: [['deliveredAt', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  const storeIds = [...new Set(rows.map((o) => String(o.restaurantId)).filter(Boolean).concat(storeId ? [String(storeId)] : []))];
  const storeRows = storeIds.length ? await Restaurant.findAll({
    where: { id: { [Op.in]: storeIds } },
    attributes: ['id', 'name', 'vendorType', 'commissionRate', 'commissionType', 'payoutUpiId', 'isTestData', 'isActive', ...(Restaurant.rawAttributes.settlementCycle ? ['settlementCycle'] : [])],
    raw: true,
  }) : [];
  const storeMap = new Map(storeRows.map((s) => [String(s.id), s]));
  const refunds = await refundsFor(sequelize, rows.map((o) => o.id));

  const totals = zeroTotals();
  const byStore = new Map();
  const seriesMap = new Map();
  for (let c = seriesStartCivil; c < b.endCivil; c += DAY_MS) seriesMap.set(ymdOfCivil(c), { date: ymdOfCivil(c), label: shortLabel(c), orders: 0, collectedPaise: 0, keepsPaise: 0, owedPaise: 0, commissionPaise: 0 });
  const mismatches = [];
  const excluded = { testOrders: 0 };
  const estimatedOrders = [];

  for (const o of rows) {
    const store = storeMap.get(String(o.restaurantId)) || null;
    if (truthy(o.isTestData) || (store && truthy(store.isTestData))) { excluded.testOrders++; continue; }
    const at = o.deliveredAt || o.updatedAt;
    const m = orderMoney(o, store, refunds.get(String(o.id)) || 0);
    const day = seriesMap.get(istYmdOf(at));
    if (day) {
      day.orders++;
      day.collectedPaise += m.collected;
      day.keepsPaise += m.keeps;
      day.owedPaise += m.owed;
      day.commissionPaise += m.commission;
    }
    const t = new Date(at).getTime();
    if (t < b.start.getTime() || t >= b.endExclusive.getTime()) continue; // series-only (days before a single-day period)
    addTo(totals, m);
    const k = String(o.restaurantId);
    if (!byStore.has(k)) byStore.set(k, { ...zeroTotals(), rates: new Set() });
    const s = byStore.get(k);
    addTo(s, m);
    if (!m.buyAtStore && !m.commissionEstimated && o.commissionRate !== null && o.commissionRate !== undefined) {
      s.rates.add(`${String(o.commissionType || 'percentage') === 'flat' ? 'flat' : 'percentage'}:${Number(o.commissionRate)}`);
    }
    if (m.commissionEstimated && estimatedOrders.length < MAX_MISMATCHES) estimatedOrders.push({ orderId: String(o.id), orderCode: orderLabel(o) });
    if (m.differencePaise !== 0 && mismatches.length < MAX_MISMATCHES) {
      mismatches.push({
        orderId: String(o.id), orderCode: orderLabel(o), storeId: k, storeName: store ? store.name : null, differencePaise: m.differencePaise,
        collectedPaise: m.collected,
        reason: !m.hasBill ? 'Order from before the saved bill: its parts cannot all be read.'
          : truthy(o.isBillApproved) && Number(o.billAmount) > 0 ? 'Mega Basket bill approved after the order: the total changed but the commission was fixed on the estimate.'
            : 'The total does not match its parts.',
      });
    }
  }

  // Reconciliation: collected - refunds = store share + ZenWe keeps + rider pay (exactly).
  const rhs = totals.storeSharePaise + totals.keepsPaise + totals.riderPayPaise;
  const lhs = totals.collectedPaise - totals.refundsPaise;
  const reconciliation = {
    ok: lhs === rhs && totals.differencePaise === 0,
    collectedLessRefundsPaise: lhs,
    storeSharePlusKeepsPlusRiderPaise: rhs,
    differencePaise: lhs - rhs,
    mismatchedOrders: mismatches.length,
    mismatches,
    rule: 'Collected − refunds = store share + ZenWe keeps + rider pay, checked order by order.',
  };

  const stores = [...byStore.entries()].map(([id, s]) => {
    const st = storeMap.get(id) || null;
    const { rates, ...sums } = s;
    return {
      storeId: id,
      name: st ? st.name : 'Deleted store',
      kind: st ? payouts.storeKind(st) : 'restaurant',
      vendorType: st ? st.vendorType : null,
      isActive: st ? !!st.isActive : false,
      settlementCycle: cycleOf(st),
      payoutUpiId: st ? st.payoutUpiId || null : null,
      currentCommission: st ? { rate: Number(st.commissionRate) || 0, type: String(st.commissionType || '') === 'flat' ? 'flat' : 'percentage' } : null,
      ratesAtOrderTime: [...rates].map((r) => { const [type, rate] = r.split(':'); return { type, rate: Number(rate) }; }),
      effectiveCommissionPct: sums.itemsPaise > 0 ? Math.round((sums.commissionPaise / sums.itemsPaise) * 10000) / 100 : 0,
      ...sums,
    };
  }).sort((a, b2) => b2.owedPaise - a.owedPaise || a.name.localeCompare(b2.name));

  const keepsLines = [
    { key: 'commission', label: 'Commission from stores', paise: totals.commissionPaise, sign: 1 },
    { key: 'deliveryFees', label: 'Delivery fees charged', paise: totals.deliveryFeesPaise, sign: 1 },
    { key: 'platformFees', label: 'Platform fees', paise: totals.platformFeesPaise, sign: 1 },
    { key: 'packagingFees', label: 'Packaging fees (not passed to stores today)', paise: totals.packagingFeesPaise, sign: 1 },
    ...(totals.taxesPaise ? [{ key: 'taxes', label: 'Taxes on bills', paise: totals.taxesPaise, sign: 1 }] : []),
    { key: 'discountCoupon', label: 'Coupons (ZenWe pays)', paise: -totals.discounts.coupon, sign: -1 },
    { key: 'discountPerks', label: 'Member perks (ZenWe pays)', paise: -totals.discounts.perks, sign: -1 },
    { key: 'discountSharedRide', label: 'Shared-ride discounts (ZenWe pays)', paise: -totals.discounts.sharedRide, sign: -1 },
    ...(totals.discounts.other ? [{ key: 'discountOther', label: 'Other discounts (ZenWe pays)', paise: -totals.discounts.other, sign: -1 }] : []),
    { key: 'riderPay', label: 'Rider pay (delivery fee, or ₹30 when 0)', paise: -totals.riderPayPaise, sign: -1 },
    ...(totals.refundsPaise ? [{ key: 'refunds', label: 'Refunds on delivered orders', paise: -totals.refundsPaise, sign: -1 }] : []),
  ];

  let riderCashHeldNowPaise = null;
  try {
    riderCashHeldNowPaise = Number(await sequelize.models.DeliveryPartner.sum('cashHeldPaise')) || 0;
  } catch { riderCashHeldNowPaise = null; }

  const { startCivil, endCivil, ...periodOut } = b; // eslint-disable-line no-unused-vars
  return {
    period: periodOut,
    storeId: storeId ? String(storeId) : null,
    totals: { ...totals, zenweReceivedPaise: totals.byChannel.cod + totals.byChannel.wallet + totals.byChannel.other },
    keepsLines,
    reconciliation,
    stores,
    series: [...seriesMap.values()],
    excluded,
    commissionEstimated: { orders: totals.commissionEstimatedOrders, sample: estimatedOrders },
    context: { riderCashHeldNowPaise },
    tracked: {
      riderPay: 'rule', // earnings rule, not a record of transfers
      tips: 'excluded',
      gatewayFees: 'none', // COD + Wallet only, no online gateway
    },
    generatedAt: new Date().toISOString(),
  };
};

// ── Settle all ───────────────────────────────────────────────────────────────────────────────────
const storesInCycle = async (sequelize, cycle) => {
  const Restaurant = sequelize.models.Restaurant;
  const where = cycle === DEFAULT_CYCLE ? { [Op.or]: [{ settlementCycle: cycle }, { settlementCycle: null }] } : { settlementCycle: cycle };
  return Restaurant.findAll({ where, attributes: ['id', 'name', 'vendorType', 'payoutUpiId', 'isTestData', 'settlementCycle'], order: [['name', 'ASC']], raw: true });
};

/** Hash of exactly what a Settle all would create (shown to the admin, compared on confirm). */
const planHash = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.storeId, r.orderCount, r.netPaise, r.orderIdsHash]))).digest('hex').slice(0, 16);
const idsHash = (ids) => crypto.createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16);

/** What "Settle all" for `cycle` would create now: one statement per store with unsettled delivered orders up to the cutoff. Writes nothing (except the one-time commission snapshot of old orders, as statements always did). */
const settlePreview = async ({ sequelize, cycle, now = new Date() }) => {
  const cut = settlementCutoff(cycle, now);
  const stores = await storesInCycle(sequelize, cut.cycle);
  const rows = [];
  let testStoresSkipped = 0;
  for (const st of stores) {
    if (truthy(st.isTestData)) { testStoresSkipped++; continue; }
    const s = await payouts.buildStatement({ sequelize, partnerType: payouts.storeKind(st), partnerId: st.id, to: cut.cutoff });
    if (!s.orderCount) continue;
    rows.push({
      storeId: String(st.id), name: st.name, kind: payouts.storeKind(st), payoutUpiId: st.payoutUpiId || null,
      orderCount: s.orderCount, grossPaise: s.grossPaise, commissionPaise: s.commissionPaise, adjustmentsPaise: s.adjustmentsPaise, netPaise: s.netPaise,
      direction: s.netPaise > 0 ? 'zenwe_pays_store' : s.netPaise < 0 ? 'store_pays_zenwe' : 'nothing',
      firstDeliveredAt: s.periodStart, orderIdsHash: idsHash(s.orderIds),
    });
  }
  const pending = await sequelize.models.Payout.findAll({
    where: { status: 'PENDING', partnerType: { [Op.in]: ['restaurant', 'vendor'] }, partnerId: { [Op.in]: stores.map((s) => String(s.id)) } },
    order: [['createdAt', 'DESC']], limit: 500,
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return {
    cycle: cut.cycle,
    cutoff: cut.cutoff.toISOString(),
    coversThrough: cut.coversThrough,
    cutoffLabel: cut.label,
    storesInCycle: stores.length,
    testStoresSkipped,
    stores: rows,
    totals: {
      stores: rows.length,
      orders: sum('orderCount'),
      grossPaise: sum('grossPaise'),
      commissionPaise: sum('commissionPaise'),
      adjustmentsPaise: sum('adjustmentsPaise'),
      netPaise: sum('netPaise'),
      zenwePaysPaise: rows.filter((r) => r.netPaise > 0).reduce((a, r) => a + r.netPaise, 0),
      storesPayZenwePaise: rows.filter((r) => r.netPaise < 0).reduce((a, r) => a - r.netPaise, 0),
    },
    planHash: planHash(rows),
    pendingStatements: pending.map((p) => payouts.payoutJson(p)),
  };
};

/**
 * Creates ONE PENDING statement per store in the confirmed plan (expected = [{ storeId, orderCount, netPaise }] from
 * the preview). Per store, in its own money transaction: the store row is locked (FOR UPDATE on Postgres; SQLite
 * IMMEDIATE transactions are serialised), then payouts.createStatement claims the orders (Order.payoutId NULL ->
 * statement, conditional, count checked). A second run or a parallel click finds no unclaimed orders for that store
 * and creates nothing ('alreadySettled'). If a store's numbers moved since the preview it is not settled
 * ('changed'). Nothing is paid: statements are PENDING until an admin marks each paid with its UTR.
 */
const settleAll = async ({ sequelize, cycle, cutoff = null, expected = [], adminId = null, now = new Date() }) => {
  const cut = settlementCutoff(cycle, now);
  if (cutoff !== null && cutoff !== undefined && cutoff !== '') {
    const given = new Date(String(cutoff));
    if (Number.isNaN(given.getTime()) || given.getTime() !== cut.cutoff.getTime()) {
      throw new PayoutError(409, 'CUTOFF_CHANGED', `The settlement cutoff is now ${cut.label}. Refresh the preview and confirm again.`, { cutoff: cut.cutoff.toISOString() });
    }
  }
  if (!Array.isArray(expected) || !expected.length) throw new PayoutError(400, 'INVALID_INPUT', 'Nothing to settle: preview first and confirm the stores shown.');
  if (expected.length > 500) throw new PayoutError(400, 'INVALID_INPUT', 'At most 500 stores at once.');
  const seen = new Set();
  const plan = expected.map((e) => {
    const storeId = String((e && e.storeId) || '');
    const orderCount = Number(e && e.orderCount);
    const netPaise = Number(e && e.netPaise);
    if (!UUID_RE.test(storeId) || seen.has(storeId) || !Number.isSafeInteger(orderCount) || orderCount <= 0 || !Number.isSafeInteger(netPaise)) {
      throw new PayoutError(400, 'INVALID_INPUT', 'Each store needs storeId, orderCount (> 0) and netPaise (whole paise) from the preview, once.');
    }
    seen.add(storeId);
    return { storeId, orderCount, netPaise };
  });
  const Restaurant = sequelize.models.Restaurant;
  const out = { cycle: cut.cycle, cutoff: cut.cutoff.toISOString(), created: [], alreadySettled: [], changed: [], skipped: [], failed: [] };
  for (const p of plan) {
    const st = await Restaurant.findByPk(p.storeId, { attributes: ['id', 'name', 'vendorType', 'isTestData', 'settlementCycle'], raw: true });
    if (!st) { out.skipped.push({ storeId: p.storeId, reason: 'Store not found.' }); continue; }
    if (cycleOf(st) !== cut.cycle) { out.skipped.push({ storeId: p.storeId, name: st.name, reason: `This store is now settled ${cycleOf(st)}.` }); continue; }
    if (truthy(st.isTestData)) { out.skipped.push({ storeId: p.storeId, name: st.name, reason: 'Test store: never settled.' }); continue; }
    try {
      const payout = await sequelize.transaction(MONEY_TX, async (t) => {
        await Restaurant.findByPk(p.storeId, { attributes: ['id'], transaction: t, lock: t.LOCK.UPDATE });
        return payouts.createStatement({
          sequelize, partnerType: payouts.storeKind(st), partnerId: p.storeId, to: cut.cutoff,
          expectedOrders: p.orderCount, expectedNetPaise: p.netPaise, adminId,
          notes: `Settle all (${cut.cycle}): ${cut.label}.`, transaction: t,
        });
      });
      out.created.push(payouts.payoutJson(payout));
    } catch (err) {
      if (payouts.isPayoutError(err) && err.code === 'NOTHING_TO_PAY') out.alreadySettled.push({ storeId: p.storeId, name: st.name });
      else if (payouts.isPayoutError(err) && err.code === 'PAYOUT_CHANGED') {
        // A parallel run claimed these orders first, or new orders arrived: if nothing is left it was settled.
        const again = await payouts.buildStatement({ sequelize, partnerType: payouts.storeKind(st), partnerId: p.storeId, to: cut.cutoff });
        if (again.orderCount === 0) out.alreadySettled.push({ storeId: p.storeId, name: st.name });
        else out.changed.push({ storeId: p.storeId, name: st.name, message: err.message, currentOrders: again.orderCount, currentNetPaise: again.netPaise });
      } else if (payouts.isPayoutError(err)) out.failed.push({ storeId: p.storeId, name: st.name, code: err.code, message: err.message });
      else throw err;
    }
  }
  return out;
};

/** Marks several PENDING statements paid, one reference each (payouts.markPaid: idempotent for the same UTR). */
const markAllPaid = async ({ sequelize, items, adminId = null }) => {
  if (!Array.isArray(items) || !items.length) throw new PayoutError(400, 'INVALID_INPUT', 'Send at least one statement with its payment reference.');
  if (items.length > 500) throw new PayoutError(400, 'INVALID_INPUT', 'At most 500 statements at once.');
  const ids = new Set();
  for (const it of items) {
    const id = String((it && it.payoutId) || '');
    if (!UUID_RE.test(id) || ids.has(id)) throw new PayoutError(400, 'INVALID_INPUT', 'Each statement once, with its payoutId.');
    ids.add(id);
  }
  const out = { paid: [], alreadyPaid: [], failed: [] };
  for (const it of items) {
    try {
      const r = await payouts.markPaid({ sequelize, payoutId: it.payoutId, utr: it.utr, method: it.method || 'upi', notes: it.notes || null, adminId });
      (r.alreadyPaid ? out.alreadyPaid : out.paid).push({ ...payouts.payoutJson(r.payout), settledOrders: r.settledOrders || 0 });
    } catch (err) {
      if (!payouts.isPayoutError(err)) throw err;
      out.failed.push({ payoutId: String(it.payoutId), code: err.code, message: err.message });
    }
  }
  return out;
};

module.exports = {
  SETTLEMENT_CYCLES, DEFAULT_CYCLE, PERIODS, normalizeCycle, cycleOf,
  periodBounds, settlementCutoff, orderMoney, billParts, buildRevenueReport, settlePreview, settleAll, markAllPaid,
};
