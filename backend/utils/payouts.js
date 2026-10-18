// C6 payout statements (models/Payout). One flow for stores (restaurant | vendor) and riders:
//   preview  -> what a statement for (partner, period) would contain, nothing written;
//   create   -> the same, recomputed in one transaction, compared with what the admin saw (409 if it
//               changed), saved as PENDING and its orders claimed (Order.payoutId / riderPayoutId);
//   markPaid -> UTR / reference required; PENDING -> PAID, the old flags (payoutSettled /
//               riderPayoutSettled) are set on its orders for compatibility, a rider's tips leave the
//               wallet through the C5 ledger (TIP_PAYOUT) — all in one transaction;
//   cancel   -> PENDING -> CANCELLED, its orders are released for a new statement.
//
// Store statement (per order, from the C6 commission snapshot, never recomputed):
//   gross = item subtotal (storeNetPaise + commissionAmountPaise), commission = commissionAmountPaise,
//   adjustments = - the cash a stall collected itself (fulfilment VENDOR: the customer paid the stall),
//   net = gross - commission + adjustments  (negative = the stall owes Zenvy the commission).
//   Buy-at-store orders (storePaidByRider) are never on a store statement: the rider paid the shop.
// Rider statement: gross = Σ utils/riderEarnings.earningPaise(order), tips = the rider's wallet balance
//   (customer tips, C5), net = gross + tips. Cash the rider holds is NOT deducted: it is settled by
//   deposits (utils/riderCash); the net position view shows both side by side.
const { Op, Transaction } = require('sequelize');
const { earningPaise, toPaise } = require('./riderEarnings');
const { backfillCommissionSnapshots } = require('./commission');
const { isLocalVendorStore } = require('./vendorTypes');

const PARTNER_TYPES = ['restaurant', 'vendor', 'rider'];
const PAY_METHODS = ['bank', 'upi', 'cash', 'other'];
const STATUSES = ['PENDING', 'PAID', 'CANCELLED'];
const MAX_ORDERS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PayoutError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'PayoutError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}
const isPayoutError = (e) => !!e && e.name === 'PayoutError';
const toRupees = (paise) => Math.round(Number(paise) || 0) / 100;
const MONEY_TX = { type: Transaction.TYPES.IMMEDIATE };

const parseDate = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new PayoutError(400, 'INVALID_INPUT', `${field} must be a date.`);
  return d;
};

// Delivered in [from, to] (older rows without deliveredAt fall back to updatedAt).
const deliveredBetween = (from, to) => {
  const at = (cmp) => ({ [Op.or]: [{ deliveredAt: cmp }, { deliveredAt: null, updatedAt: cmp }] });
  const parts = [at({ [Op.lte]: to })];
  if (from) parts.push(at({ [Op.gte]: from }));
  return { [Op.and]: parts };
};

const storeKind = (store) => (isLocalVendorStore(store) ? 'vendor' : 'restaurant');

const STORE_ORDER_ATTRS = ['id', 'restaurantId', 'fulfilment', 'finalPrice', 'totalPrice', 'commissionAmountPaise', 'storeNetPaise', 'commissionRate', 'commissionType', 'deliveredAt', 'updatedAt', 'paymentMethod'];
const RIDER_ORDER_ATTRS = ['id', 'deliveryPartnerId', 'fulfilment', 'deliveryFee', 'finalPrice', 'paymentMethod', 'deliveredAt', 'updatedAt'];

/** One store order's statement line (paise). */
const storeLine = (o) => {
  const commission = Number(o.commissionAmountPaise) || 0;
  const gross = (Number(o.storeNetPaise) || 0) + commission;
  const stallCash = String(o.fulfilment || '').toUpperCase() === 'VENDOR' ? toPaise(o.finalPrice) : 0;
  return { gross, commission, adjustments: -stallCash, stallCash, net: gross - commission - stallCash };
};

const storeCandidatesWhere = (partnerId, from, to) => ({
  restaurantId: partnerId,
  status: 'Delivered',
  payoutId: null,
  [Op.and]: [
    { [Op.or]: [{ payoutSettled: false }, { payoutSettled: null }] },
    { [Op.or]: [{ storePaidByRider: null }, { storePaidByRider: false }] },
    deliveredBetween(from, to),
  ],
});
const riderCandidatesWhere = (partnerId, from, to) => ({
  deliveryPartnerId: partnerId,
  status: 'Delivered',
  riderPayoutId: null,
  [Op.and]: [{ riderPayoutSettled: { [Op.not]: true } }, deliveredBetween(from, to)],
});

const loadPartner = async (sequelize, partnerType, partnerId, tx) => {
  if (!PARTNER_TYPES.includes(partnerType)) throw new PayoutError(400, 'INVALID_INPUT', 'partnerType must be restaurant, vendor or rider.');
  if (!partnerId || !UUID_RE.test(String(partnerId))) throw new PayoutError(400, 'INVALID_INPUT', 'partnerId is required.');
  if (partnerType === 'rider') {
    const r = await sequelize.models.DeliveryPartner.findByPk(partnerId, { attributes: ['id', 'name', 'phone', 'walletBalance', 'cashHeldPaise'], raw: true, ...tx });
    if (!r) throw new PayoutError(404, 'NOT_FOUND', 'Rider not found.');
    return { id: String(r.id), name: r.name, phone: r.phone, walletBalance: r.walletBalance, cashHeldPaise: Number(r.cashHeldPaise) || 0 };
  }
  const s = await sequelize.models.Restaurant.findByPk(partnerId, { attributes: ['id', 'name', 'vendorType'], raw: true, ...tx });
  if (!s) throw new PayoutError(404, 'NOT_FOUND', 'Store not found.');
  const kind = storeKind(s);
  if (kind !== partnerType) throw new PayoutError(400, 'WRONG_PARTNER_TYPE', `${s.name} is a ${kind}, not a ${partnerType}.`, { actualType: kind });
  return { id: String(s.id), name: s.name, vendorType: s.vendorType };
};

/**
 * Statement contents for (partner, [from, to]). Writes nothing except the one-time commission snapshot
 * of that store's still-unsnapshotted orders. opts: orderIds (only these), includeTips (riders, default true),
 * tipsPaise (riders: at most this much of the tip balance), transaction.
 */
const buildStatement = async ({ sequelize, partnerType, partnerId, from = null, to = null, orderIds = null, includeTips = true, tipsPaise = null, transaction = null }) => {
  const tx = transaction ? { transaction } : {};
  const periodEnd = to || new Date();
  const partner = await loadPartner(sequelize, partnerType, partnerId, tx);
  const Order = sequelize.models.Order;
  const ids = Array.isArray(orderIds) ? orderIds.map(String).filter((x) => UUID_RE.test(x)) : null;
  const idFilter = ids ? { id: { [Op.in]: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] } } : {};
  let lines;
  const sums = { grossPaise: 0, commissionPaise: 0, adjustmentsPaise: 0, tipsPaise: 0 };
  const breakdown = {};
  if (partnerType === 'rider') {
    const orders = await Order.findAll({ where: { ...riderCandidatesWhere(partner.id, from, periodEnd), ...idFilter }, attributes: RIDER_ORDER_ATTRS, order: [['deliveredAt', 'ASC'], ['id', 'ASC']], raw: true, ...tx });
    lines = orders.map((o) => ({ id: String(o.id), deliveredAt: o.deliveredAt || o.updatedAt, earningPaise: earningPaise(o) }));
    sums.grossPaise = lines.reduce((s, l) => s + l.earningPaise, 0);
    const balancePaise = Math.max(0, toPaise(partner.walletBalance));
    if (includeTips) sums.tipsPaise = tipsPaise === null || tipsPaise === undefined ? balancePaise : Math.max(0, Math.min(balancePaise, Number(tipsPaise) || 0));
    breakdown.earningsPaise = sums.grossPaise;
    breakdown.tipsPaise = sums.tipsPaise;
    breakdown.cashHeldPaise = partner.cashHeldPaise; // shown, never deducted
    breakdown.rule = 'Per order: delivery fee, or ₹30 when the fee is 0. Tips from the rider wallet. Cash held is settled separately.';
  } else {
    await backfillCommissionSnapshots(sequelize, { restaurantId: partner.id, transaction });
    const orders = await Order.findAll({ where: { ...storeCandidatesWhere(partner.id, from, periodEnd), ...idFilter }, attributes: STORE_ORDER_ATTRS, order: [['deliveredAt', 'ASC'], ['id', 'ASC']], raw: true, ...tx });
    const unsnapshotted = orders.filter((o) => o.commissionAmountPaise === null || o.commissionAmountPaise === undefined);
    if (unsnapshotted.length) throw new PayoutError(409, 'NO_COMMISSION_SNAPSHOT', `${unsnapshotted.length} order(s) have no commission snapshot. Reload and try again.`);
    let stallCash = 0;
    lines = orders.map((o) => {
      const l = storeLine(o);
      sums.grossPaise += l.gross;
      sums.commissionPaise += l.commission;
      sums.adjustmentsPaise += l.adjustments;
      stallCash += l.stallCash;
      return { id: String(o.id), deliveredAt: o.deliveredAt || o.updatedAt, grossPaise: l.gross, commissionPaise: l.commission, commissionRate: o.commissionRate, commissionType: o.commissionType, adjustmentsPaise: l.adjustments, netPaise: l.net };
    });
    breakdown.stallCashCollectedPaise = stallCash;
    breakdown.rule = 'Item subtotal minus the commission fixed when each order was placed; minus cash the stall collected itself.';
  }
  if (lines.length > MAX_ORDERS) throw new PayoutError(400, 'TOO_MANY_ORDERS', `This period has ${lines.length} orders; a statement can hold ${MAX_ORDERS}. Choose a shorter period.`);
  const netPaise = sums.grossPaise - sums.commissionPaise + sums.adjustmentsPaise + sums.tipsPaise;
  const firstAt = lines.length ? new Date(Math.min(...lines.map((l) => new Date(l.deliveredAt).getTime()))) : null;
  return {
    partnerType,
    partnerId: partner.id,
    partnerName: partner.name,
    periodStart: from || firstAt,
    periodEnd,
    orderCount: lines.length,
    orderIds: lines.map((l) => l.id),
    lines,
    ...sums,
    netPaise,
    breakdown,
    ...(partnerType === 'rider' ? { cashHeldPaise: partner.cashHeldPaise } : {}),
  };
};

/** JSON for the API (paise + rupees). */
const statementJson = (s, { withLines = true } = {}) => ({
  partnerType: s.partnerType,
  partnerId: s.partnerId,
  partnerName: s.partnerName,
  periodStart: s.periodStart,
  periodEnd: s.periodEnd,
  orderCount: s.orderCount,
  grossPaise: s.grossPaise,
  commissionPaise: s.commissionPaise,
  adjustmentsPaise: s.adjustmentsPaise,
  tipsPaise: s.tipsPaise,
  netPaise: s.netPaise,
  gross: toRupees(s.grossPaise),
  commission: toRupees(s.commissionPaise),
  adjustments: toRupees(s.adjustmentsPaise),
  tips: toRupees(s.tipsPaise),
  net: toRupees(s.netPaise),
  breakdown: s.breakdown,
  ...(s.cashHeldPaise !== undefined ? { cashHeldPaise: s.cashHeldPaise, cashHeld: toRupees(s.cashHeldPaise) } : {}),
  ...(withLines ? { orders: s.lines } : {}),
});

const payoutJson = (p, { withOrderIds = false } = {}) => {
  const j = p && typeof p.toJSON === 'function' ? p.toJSON() : { ...p };
  let ids = j.orderIds;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
  let breakdown = j.breakdown;
  if (typeof breakdown === 'string') { try { breakdown = JSON.parse(breakdown); } catch { breakdown = null; } }
  const out = {
    id: j.id, partnerType: j.partnerType, partnerId: j.partnerId, partnerName: j.partnerName,
    periodStart: j.periodStart, periodEnd: j.periodEnd, orderCount: j.orderCount,
    grossPaise: j.grossPaise, commissionPaise: j.commissionPaise, adjustmentsPaise: j.adjustmentsPaise, tipsPaise: j.tipsPaise, netPaise: j.netPaise,
    gross: toRupees(j.grossPaise), commission: toRupees(j.commissionPaise), adjustments: toRupees(j.adjustmentsPaise), tips: toRupees(j.tipsPaise), net: toRupees(j.netPaise),
    breakdown, status: j.status, method: j.method, utr: j.utr, paidAt: j.paidAt, paidBy: j.paidBy, createdBy: j.createdBy,
    cancelledAt: j.cancelledAt, cancelledBy: j.cancelledBy, notes: j.notes, createdAt: j.createdAt, updatedAt: j.updatedAt,
  };
  if (withOrderIds) out.orderIds = Array.isArray(ids) ? ids : [];
  return out;
};

const inTx = (sequelize, transaction, fn) => (transaction ? fn(transaction) : sequelize.transaction(MONEY_TX, fn));

/**
 * Saves a PENDING statement and claims its orders, in one transaction. expectedOrders / expectedNetPaise
 * (what the admin's preview showed) must still match, else 409 PAYOUT_CHANGED.
 */
const createStatement = async ({ sequelize, partnerType, partnerId, from = null, to = null, orderIds = null, includeTips = true, tipsPaise = null, expectedOrders = null, expectedNetPaise = null, adminId = null, notes = null, transaction = null }) => {
  if (!to) to = new Date();
  return inTx(sequelize, transaction, async (t) => {
    const s = await buildStatement({ sequelize, partnerType, partnerId, from, to, orderIds, includeTips, tipsPaise, transaction: t });
    if (expectedOrders !== null && expectedOrders !== undefined && expectedOrders !== '' && Number(expectedOrders) !== s.orderCount) {
      throw new PayoutError(409, 'PAYOUT_CHANGED', `This payout now covers ${s.orderCount} order${s.orderCount === 1 ? '' : 's'}, not ${expectedOrders}. Refresh and check it before settling.`, { currentOrders: s.orderCount, statement: statementJson(s, { withLines: false }) });
    }
    if (expectedNetPaise !== null && expectedNetPaise !== undefined && expectedNetPaise !== '' && Number(expectedNetPaise) !== s.netPaise) {
      throw new PayoutError(409, 'PAYOUT_CHANGED', `This payout is now ₹${toRupees(s.netPaise)}, not ₹${toRupees(expectedNetPaise)}. Refresh and check it before saving.`, { statement: statementJson(s, { withLines: false }) });
    }
    if (s.orderCount === 0 && s.tipsPaise === 0) throw new PayoutError(400, 'NOTHING_TO_PAY', 'Nothing to pay for this partner and period.');
    const Payout = sequelize.models.Payout;
    const payout = await Payout.create({
      partnerType: s.partnerType, partnerId: s.partnerId, partnerName: s.partnerName,
      periodStart: s.periodStart, periodEnd: s.periodEnd, orderCount: s.orderCount, orderIds: s.orderIds,
      grossPaise: s.grossPaise, commissionPaise: s.commissionPaise, adjustmentsPaise: s.adjustmentsPaise, tipsPaise: s.tipsPaise, netPaise: s.netPaise,
      breakdown: s.breakdown, status: 'PENDING', createdBy: adminId ? String(adminId) : null,
      notes: notes ? String(notes).trim().slice(0, 1000) || null : null,
    }, { transaction: t });
    if (s.orderIds.length) {
      const Order = sequelize.models.Order;
      const col = partnerType === 'rider' ? 'riderPayoutId' : 'payoutId';
      let claimed = 0;
      for (let i = 0; i < s.orderIds.length; i += 500) {
        const chunk = s.orderIds.slice(i, i + 500);
        const [n] = await Order.update({ [col]: payout.id }, { where: { id: { [Op.in]: chunk }, [col]: null }, transaction: t, hooks: false });
        claimed += n;
      }
      if (claimed !== s.orderIds.length) throw new PayoutError(409, 'PAYOUT_CHANGED', 'Some of these orders were just put on another statement. Refresh and try again.');
    }
    return payout;
  });
};

const cleanUtr = (utr) => String(utr === undefined || utr === null ? '' : utr).trim().replace(/\s+/g, ' ').slice(0, 120);

/** PENDING -> PAID with a UTR / reference (required). Idempotent for the same UTR. */
const markPaid = async ({ sequelize, payoutId, utr, method = 'bank', paidAt = null, notes = null, adminId = null, transaction = null }) => {
  const ref = cleanUtr(utr);
  if (ref.length < 3) throw new PayoutError(400, 'UTR_REQUIRED', 'Enter the UTR / payment reference (at least 3 characters) to mark this payout paid.');
  const m = String(method || 'bank').toLowerCase();
  if (!PAY_METHODS.includes(m)) throw new PayoutError(400, 'INVALID_INPUT', `Method must be one of: ${PAY_METHODS.join(', ')}.`);
  const when = paidAt ? parseDate(paidAt, 'paidAt') : new Date();
  if (when.getTime() > Date.now() + 5 * 60 * 1000) throw new PayoutError(400, 'INVALID_INPUT', 'paidAt cannot be in the future.');
  if (!payoutId || !UUID_RE.test(String(payoutId))) throw new PayoutError(404, 'NOT_FOUND', 'Payout not found.');
  return inTx(sequelize, transaction, async (t) => {
    const Payout = sequelize.models.Payout;
    const p = await Payout.findByPk(payoutId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new PayoutError(404, 'NOT_FOUND', 'Payout not found.');
    if (p.status === 'PAID') {
      if (p.utr === ref) return { payout: p, alreadyPaid: true };
      throw new PayoutError(409, 'ALREADY_PAID', `This payout was already marked paid (UTR ${p.utr}).`);
    }
    if (p.status !== 'PENDING') throw new PayoutError(409, 'NOT_PENDING', 'This payout was cancelled.');
    const [n] = await Payout.update(
      { status: 'PAID', utr: ref, method: m, paidAt: when, paidBy: adminId ? String(adminId) : null, ...(notes ? { notes: String(notes).trim().slice(0, 1000) } : {}) },
      { where: { id: p.id, status: 'PENDING' }, transaction: t },
    );
    if (!n) throw new PayoutError(409, 'NOT_PENDING', 'This payout was just changed. Refresh.');
    const Order = sequelize.models.Order;
    let settled;
    if (p.partnerType === 'rider') {
      [settled] = await Order.update({ riderPayoutSettled: true }, { where: { riderPayoutId: p.id }, transaction: t, hooks: false });
      if (p.tipsPaise > 0) {
        const walletLedger = require('./walletLedger');
        try {
          await walletLedger.applyWalletChange({
            t, ownerType: 'rider', ownerId: p.partnerId, amountPaise: -p.tipsPaise, type: walletLedger.TYPES.TIP_PAYOUT,
            ref: null, actor: { type: 'admin', id: adminId ? String(adminId) : 'admin_default' },
            reason: `Tips paid out with payout ${String(p.id).slice(0, 8)} (UTR ${ref})`, idempotencyKey: `payout:${p.id}`,
          });
        } catch (err) {
          if (walletLedger.isInsufficient(err)) throw new PayoutError(409, 'TIPS_CHANGED', 'The rider\'s tip balance is now lower than this statement. Cancel it and generate a new one.');
          throw err;
        }
      }
    } else {
      [settled] = await Order.update({ payoutSettled: true }, { where: { payoutId: p.id }, transaction: t, hooks: false });
    }
    if (settled !== p.orderCount) throw new PayoutError(409, 'PAYOUT_CHANGED', `This statement lists ${p.orderCount} orders but ${settled} are attached to it. Nothing was marked paid.`);
    await p.reload({ transaction: t });
    return { payout: p, alreadyPaid: false, settledOrders: settled };
  });
};

/** PENDING -> CANCELLED; its orders can go on a new statement. */
const cancelStatement = async ({ sequelize, payoutId, reason, adminId = null }) => {
  const why = String(reason || '').trim();
  if (why.length < 5) throw new PayoutError(400, 'REASON_REQUIRED', 'Give a reason (at least 5 characters) to cancel a statement.');
  if (!payoutId || !UUID_RE.test(String(payoutId))) throw new PayoutError(404, 'NOT_FOUND', 'Payout not found.');
  return sequelize.transaction(MONEY_TX, async (t) => {
    const Payout = sequelize.models.Payout;
    const p = await Payout.findByPk(payoutId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new PayoutError(404, 'NOT_FOUND', 'Payout not found.');
    if (p.status !== 'PENDING') throw new PayoutError(409, 'NOT_PENDING', p.status === 'PAID' ? 'A paid payout cannot be cancelled.' : 'This payout is already cancelled.');
    const [n] = await Payout.update(
      { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: adminId ? String(adminId) : null, notes: `${p.notes ? `${p.notes}\n` : ''}Cancelled: ${why}`.slice(0, 1000) },
      { where: { id: p.id, status: 'PENDING' }, transaction: t },
    );
    if (!n) throw new PayoutError(409, 'NOT_PENDING', 'This payout was just changed. Refresh.');
    const col = p.partnerType === 'rider' ? 'riderPayoutId' : 'payoutId';
    const [released] = await sequelize.models.Order.update({ [col]: null }, { where: { [col]: p.id }, transaction: t, hooks: false });
    await p.reload({ transaction: t });
    return { payout: p, releasedOrders: released };
  });
};

/**
 * Partners with something to pay (orders not on any statement yet). partnerType: restaurant | vendor |
 * rider | 'store' (restaurant + vendor). Rider rows also carry tips and the cash they hold.
 */
const pendingPartners = async ({ sequelize, partnerType, to = null }) => {
  const upTo = to || new Date();
  const Order = sequelize.models.Order;
  if (partnerType === 'rider') {
    const orders = await Order.findAll({
      where: { deliveryPartnerId: { [Op.ne]: null }, status: 'Delivered', riderPayoutId: null, [Op.and]: [{ riderPayoutSettled: { [Op.not]: true } }, deliveredBetween(null, upTo)] },
      attributes: RIDER_ORDER_ATTRS, raw: true,
    });
    const by = new Map();
    for (const o of orders) {
      const k = String(o.deliveryPartnerId);
      const row = by.get(k) || { partnerId: k, orders: 0, grossPaise: 0, oldest: null };
      row.orders++;
      row.grossPaise += earningPaise(o);
      const at = o.deliveredAt || o.updatedAt;
      if (!row.oldest || new Date(at) < new Date(row.oldest)) row.oldest = at;
      by.set(k, row);
    }
    const riders = await sequelize.models.DeliveryPartner.findAll({
      where: { [Op.or]: [{ id: { [Op.in]: [...by.keys()] } }, { walletBalance: { [Op.gt]: 0 } }, { cashHeldPaise: { [Op.ne]: 0 } }] },
      attributes: ['id', 'name', 'phone', 'walletBalance', 'cashHeldPaise'], raw: true,
    });
    return riders.map((r) => {
      const row = by.get(String(r.id)) || { orders: 0, grossPaise: 0, oldest: null };
      const tipsPaise = Math.max(0, toPaise(r.walletBalance));
      const cashHeldPaise = Number(r.cashHeldPaise) || 0;
      const owedPaise = row.grossPaise + tipsPaise;
      return {
        partnerType: 'rider', partnerId: String(r.id), partnerName: r.name, phone: r.phone, orders: row.orders, oldestDeliveredAt: row.oldest,
        grossPaise: row.grossPaise, commissionPaise: 0, adjustmentsPaise: 0, tipsPaise, netPaise: owedPaise,
        cashHeldPaise, netPositionPaise: owedPaise - cashHeldPaise, asOf: upTo.toISOString(),
      };
    }).sort((a, b) => b.netPaise - a.netPaise);
  }
  await backfillCommissionSnapshots(sequelize);
  const orders = await Order.findAll({
    where: {
      status: 'Delivered', payoutId: null,
      [Op.and]: [
        { [Op.or]: [{ payoutSettled: false }, { payoutSettled: null }] },
        { [Op.or]: [{ storePaidByRider: null }, { storePaidByRider: false }] },
        { commissionAmountPaise: { [Op.ne]: null } },
        deliveredBetween(null, upTo),
      ],
    },
    attributes: STORE_ORDER_ATTRS, raw: true,
  });
  const by = new Map();
  for (const o of orders) {
    if (!o.restaurantId) continue;
    const k = String(o.restaurantId);
    const row = by.get(k) || { partnerId: k, orders: 0, grossPaise: 0, commissionPaise: 0, adjustmentsPaise: 0, netPaise: 0, oldest: null };
    const l = storeLine(o);
    row.orders++;
    row.grossPaise += l.gross;
    row.commissionPaise += l.commission;
    row.adjustmentsPaise += l.adjustments;
    row.netPaise += l.net;
    const at = o.deliveredAt || o.updatedAt;
    if (!row.oldest || new Date(at) < new Date(row.oldest)) row.oldest = at;
    by.set(k, row);
  }
  if (!by.size) return [];
  const stores = await sequelize.models.Restaurant.findAll({ where: { id: { [Op.in]: [...by.keys()] } }, attributes: ['id', 'name', 'vendorType'], raw: true });
  return stores
    .map((s) => ({ ...by.get(String(s.id)), partnerType: storeKind(s), partnerName: s.name, vendorType: s.vendorType, oldestDeliveredAt: by.get(String(s.id)).oldest, tipsPaise: 0, asOf: upTo.toISOString() }))
    .filter((r) => partnerType === 'store' || r.partnerType === partnerType)
    .map(({ oldest, ...r }) => r) // eslint-disable-line no-unused-vars
    .sort((a, b) => b.netPaise - a.netPaise);
};

/** Newest first. Returns { rows, page, limit, hasMore }. */
const listPayouts = async ({ sequelize, partnerType = null, partnerId = null, status = null, from = null, to = null, page = 1, limit = 50 }) => {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const pg = Math.min(Math.max(parseInt(page, 10) || 1, 1), 10000);
  const where = {};
  if (partnerType) {
    if (partnerType === 'store') where.partnerType = { [Op.in]: ['restaurant', 'vendor'] };
    else if (PARTNER_TYPES.includes(partnerType)) where.partnerType = partnerType;
    else throw new PayoutError(400, 'INVALID_INPUT', 'partnerType must be restaurant, vendor, rider or store.');
  }
  if (partnerId) where.partnerId = String(partnerId);
  if (status) {
    const st = String(status).toUpperCase();
    if (!STATUSES.includes(st)) throw new PayoutError(400, 'INVALID_INPUT', 'status must be PENDING, PAID or CANCELLED.');
    where.status = st;
  }
  const f = parseDate(from, 'from');
  const tt = parseDate(to, 'to');
  if (f || tt) where.createdAt = { ...(f ? { [Op.gte]: f } : {}), ...(tt ? { [Op.lte]: tt } : {}) };
  const rows = await sequelize.models.Payout.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: lim + 1, offset: (pg - 1) * lim });
  return { rows: rows.slice(0, lim), page: pg, limit: lim, hasMore: rows.length > lim };
};

module.exports = {
  PARTNER_TYPES, PAY_METHODS, STATUSES, MAX_ORDERS, PayoutError, isPayoutError, toRupees, parseDate,
  storeLine, buildStatement, statementJson, payoutJson, createStatement, markPaid, cancelStatement, pendingPartners, listPayouts, storeKind,
};
