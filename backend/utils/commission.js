// C6: commission snapshot per order. Computed ONCE from the store's rate at the moment the order is
// created (createOrder) and stored on the order (commissionRate, commissionType, commissionAmountPaise,
// storeNetPaise, commissionSource). Settlement, statements and the finance report read the snapshot and
// never recompute it, so changing a store's rate only affects orders placed after the change.
//
// Base: the item subtotal (Order.totalPrice) — the same base the store payout list always used. The
// delivery fee is the rider's, coupon / perk discounts are Zenvy-funded, and the packaging fee has never
// been part of the store payout (unchanged here; see docs/C6_FINANCE.md).
//   percentage: round_half_up(subtotal * rate / 100)
//   flat:       min(rate rupees, subtotal)
// Orders that existed before C6 and were not settled yet are snapshotted once at startup with the
// store's CURRENT rate (commissionSource 'backfill'); settled orders keep no snapshot.
const { Op } = require('sequelize');
const { toPaise } = require('./riderEarnings');

const clampRate = (rate) => {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** { commissionRate, commissionType, grossPaise, commissionAmountPaise, storeNetPaise } for one order. */
const computeCommission = ({ subtotal, rate, type }) => {
  const grossPaise = Math.max(0, toPaise(subtotal));
  const commissionRate = clampRate(rate);
  const commissionType = String(type || '').toLowerCase() === 'flat' ? 'flat' : 'percentage';
  let commissionAmountPaise;
  if (commissionType === 'flat') commissionAmountPaise = Math.min(toPaise(commissionRate), grossPaise);
  else commissionAmountPaise = Math.min(grossPaise, Math.floor((grossPaise * commissionRate) / 100 + 0.5));
  return { commissionRate, commissionType, grossPaise, commissionAmountPaise, storeNetPaise: grossPaise - commissionAmountPaise };
};

/** The Order columns to store at creation (source 'order'). */
const snapshotFields = (store, subtotal, source = 'order') => {
  const c = computeCommission({ subtotal, rate: store ? store.commissionRate : 0, type: store ? store.commissionType : null });
  return {
    commissionRate: c.commissionRate,
    commissionType: c.commissionType,
    commissionAmountPaise: c.commissionAmountPaise,
    storeNetPaise: c.storeNetPaise,
    commissionSource: source,
  };
};

const hasSnapshot = (order) => order && order.commissionAmountPaise !== null && order.commissionAmountPaise !== undefined;

/**
 * One-time backfill: every not-yet-settled, not-cancelled order without a snapshot gets one from its
 * store's CURRENT rate. Write-once (each UPDATE is conditional on the snapshot still being NULL), so it
 * is safe to run on every boot and from two processes; a re-run finds nothing. Orders whose store no
 * longer exists are left alone (they cannot be paid out). Returns { updated, skippedNoStore }.
 * opts.restaurantId: only that store's orders (statement generation calls this first).
 */
const backfillCommissionSnapshots = async (sequelize, { restaurantId = null, batch = 500, transaction = null } = {}) => {
  const out = { updated: 0, skippedNoStore: 0 };
  const Order = sequelize.models.Order;
  const Restaurant = sequelize.models.Restaurant;
  if (!Order || !Restaurant || !Order.rawAttributes.commissionAmountPaise) return out;
  const tx = transaction ? { transaction } : {};
  const where = {
    commissionAmountPaise: null,
    status: { [Op.ne]: 'Cancelled' },
    [Op.or]: [{ payoutSettled: false }, { payoutSettled: null }],
    ...(restaurantId ? { restaurantId } : {}),
  };
  const storeCache = new Map();
  let lastId = null;
  for (;;) {
    const rows = await Order.findAll({
      where: lastId ? { ...where, id: { [Op.gt]: lastId } } : where,
      attributes: ['id', 'restaurantId', 'totalPrice'],
      order: [['id', 'ASC']],
      limit: batch,
      raw: true,
      ...tx,
    });
    if (!rows.length) break;
    for (const o of rows) {
      const sid = o.restaurantId ? String(o.restaurantId) : null;
      if (sid && !storeCache.has(sid)) {
        storeCache.set(sid, await Restaurant.findByPk(sid, { attributes: ['id', 'commissionRate', 'commissionType'], raw: true, ...tx }));
      }
      const store = sid ? storeCache.get(sid) : null;
      if (!store) { out.skippedNoStore++; continue; }
      const [n] = await Order.update(snapshotFields(store, o.totalPrice, 'backfill'), { where: { id: o.id, commissionAmountPaise: null }, hooks: false, ...tx });
      out.updated += n;
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < batch) break;
  }
  return out;
};

module.exports = { computeCommission, snapshotFields, hasSnapshot, backfillCommissionSnapshots };
