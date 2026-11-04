// C6 rider cash ledger. The cash a rider is holding for Zenvy lives in DeliveryPartner.cashHeldPaise and
// every change of it goes through applyCashChange, INSIDE the caller's transaction (same pattern as the
// C5 wallet ledger, utils/walletLedger.js):
//   1. (idempotencyKey) an existing row for (rider, key) -> nothing changes, that row is returned.
//   2. one conditional UPDATE of cashHeldPaise (integer paise), refusing to go below zero unless allowNegative.
//   3. the new value is read back and ONE RiderCashEntries row is inserted (signed amount, balanceAfterPaise).
// Any failure throws and the caller's transaction rolls the delivery / deposit and the row back together.
//
//   COD_COLLECTED  +  a COD order the rider delivered (the order total the customer paid in cash). Written in
//                     the SAME transaction as the Delivered flip (rider app PIN confirm, or support marking it
//                     delivered), exactly once per order (key cod:<orderId> + unique (orderId, type)).
//   STORE_PURCHASE -  buy-at-store orders (Order.storePaidByRider): what the rider paid the shop at the counter
//                     (approved bill, else the item subtotal). Same transaction, key store-buy:<orderId>.
//   CASH_DEPOSITED -  the rider handed cash to Zenvy (admin records it: method cash | upi + reference).
//   ADJUSTMENT     +/- admin correction, reason required.
//
// This is NOT the rider wallet (customer tips, C5). Wallet credit is paid OUT to the rider; this cash is
// owed BY the rider to Zenvy. They are never netted automatically: payouts pay earnings + tips, cash is
// settled by deposits (the "net position" view only shows both side by side).
//
// Opening balances: none. The ledger starts at the C6 deploy (GlobalConfig RIDER_CASH_LEDGER_START, set
// once at startup); cash riders held before that is not known to the server. If a rider still holds older
// cash, the admin records it with an ADJUSTMENT (+, reason) before taking the deposit.
//
// Also here: the cash limit (GlobalConfig RIDER_CASH_LIMIT, rupees; default 0 = OFF, owner decision: riders
// are never blocked unless an admin sets a limit > 0) checked when a rider claims a COD order, the reconciliation scan (daily job 'riderCash.reconcile') and history labels.
const { Op, QueryTypes } = require('sequelize');
const { toPaise } = require('./riderEarnings');

const TYPES = Object.freeze({
  COD_COLLECTED: 'COD_COLLECTED',
  STORE_PURCHASE: 'STORE_PURCHASE',
  CASH_DEPOSITED: 'CASH_DEPOSITED',
  ADJUSTMENT: 'ADJUSTMENT',
});
const DEPOSIT_METHODS = ['cash', 'upi'];
const LIMIT_KEY = 'RIDER_CASH_LIMIT';
const START_KEY = 'RIDER_CASH_LEDGER_START';
// Owner decision (C6): almost every payment is cash, so riders are never blocked by default. 0 = OFF.
// An admin may set a limit > 0 later; then a rider at / over it cannot claim new COD orders.
const DEFAULT_LIMIT_RUPEES = 0;
const MAX_LIMIT_RUPEES = 100000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RiderCashError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'RiderCashError';
    this.code = code;
    Object.assign(this, extra);
  }
}
const isCashError = (err) => !!err && err.name === 'RiderCashError';

const toRupees = (paise) => Math.round(Number(paise) || 0) / 100;
const clean = (v, max) => (v === undefined || v === null || v === '' ? null : String(v).trim().slice(0, max) || null);

const modelOf = (sequelize, name) => {
  const M = sequelize && sequelize.models && sequelize.models[name];
  if (!M) throw new RiderCashError('LEDGER_NOT_READY', `${name} is not set up on this database.`);
  return M;
};

/**
 * Applies one cash change inside transaction `t` and records it. Returns
 *   { applied: true, duplicate: false, row, balancePaise }   or, for a repeated idempotencyKey,
 *   { applied: false, duplicate: true, row, balancePaise }   (nothing changed).
 * Throws RiderCashError: INVALID_INPUT, REASON_REQUIRED, REFERENCE_REQUIRED, RIDER_NOT_FOUND, NOT_ENOUGH_CASH.
 */
const applyCashChange = async ({
  t, riderId, amountPaise, type, orderId = null, method = null, reference = null, actor = null, reason = null,
  idempotencyKey = null, allowNegative = false,
} = {}) => {
  if (!t || !t.sequelize) throw new RiderCashError('INVALID_INPUT', 'applyCashChange must run inside a transaction.');
  if (!riderId) throw new RiderCashError('INVALID_INPUT', 'riderId is required.');
  if (!Number.isSafeInteger(amountPaise) || amountPaise === 0) throw new RiderCashError('INVALID_INPUT', `amountPaise must be a non-zero integer (got ${amountPaise}).`);
  if (!TYPES[type]) throw new RiderCashError('INVALID_INPUT', `Unknown cash entry type: ${type}`);
  const actorType = clean(actor && actor.type, 16) || 'system';
  const why = reason === null || reason === undefined ? null : String(reason).trim().slice(0, 500) || null;
  if (type === TYPES.ADJUSTMENT && (!why || why.length < 5)) throw new RiderCashError('REASON_REQUIRED', 'A reason (at least 5 characters) is required for a cash adjustment.');
  const m = method ? String(method).toLowerCase() : null;
  const ref = clean(reference, 120);
  if (type === TYPES.CASH_DEPOSITED) {
    if (amountPaise >= 0) throw new RiderCashError('INVALID_INPUT', 'A deposit reduces the cash held (negative amount).');
    if (!DEPOSIT_METHODS.includes(m)) throw new RiderCashError('INVALID_INPUT', 'Deposit method must be cash or upi.');
    if (!ref || ref.length < 3) throw new RiderCashError('REFERENCE_REQUIRED', m === 'upi' ? 'Enter the UPI reference (UTR) of the deposit.' : 'Enter a reference for the cash handover (receipt number or who received it).');
  }

  const sequelize = t.sequelize;
  const CE = modelOf(sequelize, 'RiderCashEntry');
  const Rider = modelOf(sequelize, 'DeliveryPartner');
  const rid = String(riderId);
  const key = clean(idempotencyKey, 160);

  if (key) {
    const prior = await CE.findOne({ where: { riderId: rid, idempotencyKey: key }, transaction: t });
    if (prior) {
      const r = await Rider.findByPk(rid, { attributes: ['cashHeldPaise'], transaction: t, raw: true });
      return { applied: false, duplicate: true, row: prior, balancePaise: r ? Number(r.cashHeldPaise) || 0 : prior.balanceAfterPaise };
    }
  }

  const cur = 'COALESCE("cashHeldPaise", 0)';
  const guard = amountPaise < 0 && !allowNegative ? [sequelize.literal(`(${cur} + (${amountPaise})) >= 0`)] : [];
  const [n] = await Rider.update(
    { cashHeldPaise: sequelize.literal(`${cur} + (${amountPaise})`) },
    { where: { [Op.and]: [{ id: rid }, ...guard] }, transaction: t, hooks: false },
  );
  if (!n) {
    const exists = await Rider.findByPk(rid, { attributes: ['id', 'cashHeldPaise'], transaction: t, raw: true });
    if (!exists) throw new RiderCashError('RIDER_NOT_FOUND', 'Rider not found.');
    const held = Number(exists.cashHeldPaise) || 0;
    throw new RiderCashError('NOT_ENOUGH_CASH', `This rider holds only ₹${toRupees(held)} on record. Record an adjustment first if they hold more.`, { balancePaise: held, neededPaise: -amountPaise });
  }
  const fresh = await Rider.findByPk(rid, { attributes: ['cashHeldPaise'], transaction: t, raw: true });
  const balancePaise = Number(fresh && fresh.cashHeldPaise) || 0;
  const row = await CE.create({
    riderId: rid,
    amountPaise,
    balanceAfterPaise: balancePaise,
    type,
    orderId: clean(orderId, 64),
    method: m,
    reference: ref,
    actorType,
    actorId: clean(actor && actor.id, 64),
    reason: why,
    idempotencyKey: key,
    createdAt: new Date(),
  }, { transaction: t });
  return { applied: true, duplicate: false, row, balancePaise };
};

// ── COD delivery ─────────────────────────────────────────────────────────────────────────────────
const ORDER_CASH_ATTRS = ['id', 'status', 'paymentMethod', 'deliveryPartnerId', 'fulfilment', 'finalPrice', 'totalPrice', 'billAmount', 'isBillApproved', 'storePaidByRider'];

/** A delivered order whose cash a Zenvy rider collected at the door (COD, rider, not a stall order, total > 0). */
const isCodCashOrder = (o) => !!o
  && String(o.paymentMethod || '').toUpperCase() === 'COD'
  && !!o.deliveryPartnerId
  && String(o.fulfilment || '').toUpperCase() !== 'VENDOR'
  && toPaise(o.finalPrice) > 0;

/** Cash paid at a buy-at-store counter: the approved bill, else the item subtotal. 0 for normal stores. */
const storePurchasePaise = (o) => {
  // raw rows: SQLite returns booleans as 1 / 0, Postgres as true / false.
  if (!o || !(o.storePaidByRider === true || o.storePaidByRider === 1 || o.storePaidByRider === '1')) return 0;
  const bill = Number(o.billAmount);
  return Math.max(0, toPaise(o.isBillApproved && bill > 0 ? bill : o.totalPrice));
};

/**
 * Records the cash of a just-delivered COD order, inside the transaction `t` that flipped it to Delivered.
 * Reads the order in `t` (the rider who delivered it is whoever holds it now). Idempotent per order.
 * Returns { recorded, codPaise, storePaise, balancePaise } (recorded false: not a COD cash order).
 */
const recordCodDelivery = async ({ t, orderId, actor = null }) => {
  const Order = modelOf(t.sequelize, 'Order');
  const o = await Order.findByPk(orderId, { attributes: ORDER_CASH_ATTRS, transaction: t, raw: true });
  if (!o || o.status !== 'Delivered' || !isCodCashOrder(o)) return { recorded: false, codPaise: 0, storePaise: 0 };
  const riderId = String(o.deliveryPartnerId);
  const codPaise = toPaise(o.finalPrice);
  const who = actor || { type: 'system' };
  let res = await applyCashChange({
    t, riderId, amountPaise: codPaise, type: TYPES.COD_COLLECTED, orderId: o.id, actor: who, idempotencyKey: `cod:${o.id}`,
  });
  const storePaise = storePurchasePaise(o);
  if (storePaise > 0) {
    // The rider paid the shop out of their own pocket: that part of the cash is theirs, not Zenvy's.
    res = await applyCashChange({
      t, riderId, amountPaise: -storePaise, type: TYPES.STORE_PURCHASE, orderId: o.id, actor: who, idempotencyKey: `store-buy:${o.id}`, allowNegative: true,
    });
  }
  return { recorded: true, codPaise, storePaise, balancePaise: res.balancePaise };
};

// ── Cash limit ───────────────────────────────────────────────────────────────────────────────────
/** RIDER_CASH_LIMIT in paise (0 = no limit). Missing / invalid -> the default (0 = off). */
const getCashLimitPaise = async (sequelize) => {
  try {
    const GC = sequelize && sequelize.models && sequelize.models.GlobalConfig;
    if (!GC) return DEFAULT_LIMIT_RUPEES * 100;
    const row = await GC.findOne({ where: { key: LIMIT_KEY }, attributes: ['value'], raw: true });
    let v = row ? row.value : null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* plain string */ } }
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0) return DEFAULT_LIMIT_RUPEES * 100;
    return Math.round(Math.min(n, MAX_LIMIT_RUPEES) * 100);
  } catch {
    return DEFAULT_LIMIT_RUPEES * 100;
  }
};

/** Whole rupees the rider must hand over to get back under the limit (0 when under it). */
const depositNeededPaise = (heldPaise, limitPaise) => {
  if (!(limitPaise > 0) || heldPaise < limitPaise) return 0;
  return Math.ceil((heldPaise - limitPaise + 1) / 100) * 100;
};

const cashStatus = (heldPaise, limitPaise) => {
  const held = Number(heldPaise) || 0;
  const overLimit = limitPaise > 0 && held >= limitPaise;
  const needed = depositNeededPaise(held, limitPaise);
  return {
    cashHeldPaise: held,
    cashHeld: toRupees(held),
    limitPaise,
    limit: toRupees(limitPaise),
    limitEnabled: limitPaise > 0,
    overLimit,
    depositNeededPaise: needed,
    depositNeeded: toRupees(needed),
    // Informational line the rider app always shows; the deposit message only when an admin set a limit and it is reached.
    info: `Cash with you: ₹${toRupees(held)}`,
    message: overLimit ? `Deposit ₹${toRupees(needed)} to keep taking COD orders.` : null,
  };
};

/**
 * Claim check (runs inside the claim path, under the rider row lock on Postgres). A rider holding cash >=
 * the limit may not claim a NEW COD order; prepaid (Wallet) orders and an order already theirs are fine.
 * Returns null (allowed) or { code: 'CASH_LIMIT', ... } for the 409 reply.
 */
const claimBlockedByCash = async ({ sequelize, riderId, orderId, transaction = null }) => {
  const tx = transaction ? { transaction } : {};
  const Order = sequelize.models.Order;
  const Rider = sequelize.models.DeliveryPartner;
  if (!Order || !Rider) return null;
  const limitPaise = await getCashLimitPaise(sequelize);
  if (!(limitPaise > 0)) return null; // default: OFF, never blocks
  const order = await Order.findByPk(orderId, { attributes: ['id', 'paymentMethod', 'deliveryPartnerId'], raw: true, ...tx });
  if (!order || String(order.paymentMethod || '').toUpperCase() !== 'COD') return null;
  if (order.deliveryPartnerId && String(order.deliveryPartnerId) === String(riderId)) return null; // retry of their own claim
  const rider = await Rider.findByPk(riderId, { attributes: ['cashHeldPaise'], raw: true, ...tx });
  const st = cashStatus(rider ? rider.cashHeldPaise : 0, limitPaise);
  if (!st.overLimit) return null;
  return {
    code: 'CASH_LIMIT',
    message: `You are holding ₹${st.cashHeld} in cash (limit ₹${st.limit}). Deposit ₹${st.depositNeeded} to keep taking COD orders. Prepaid orders are still open to you.`,
    cash: st,
  };
};

// ── History ──────────────────────────────────────────────────────────────────────────────────────
const LABELS = {
  COD_COLLECTED: 'Cash collected (COD)',
  STORE_PURCHASE: 'Paid at the shop',
  CASH_DEPOSITED: 'Deposited to ZENV',
  ADJUSTMENT: 'Adjusted by ZENV',
};

const toPublic = (row) => {
  const r = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: r.id,
    type: r.type,
    label: LABELS[r.type] || 'Cash change',
    amountPaise: r.amountPaise,
    amount: toRupees(r.amountPaise),
    balanceAfterPaise: r.balanceAfterPaise,
    balanceAfter: toRupees(r.balanceAfterPaise),
    orderId: r.orderId || null,
    method: r.method || null,
    reference: r.reference || null,
    note: r.actorType === 'admin' ? r.reason : null,
    createdAt: r.createdAt,
  };
};
const toAdmin = (row) => {
  const r = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
  return { ...toPublic(r), riderId: r.riderId, actorType: r.actorType, actorId: r.actorId, reason: r.reason, idempotencyKey: r.idempotencyKey };
};

/** Newest first, offset pages. Returns { rows, page, limit, hasMore }. opts.types: only these types. */
const listFor = async ({ sequelize, riderId, page = 1, limit = 20, types = null } = {}) => {
  const CE = modelOf(sequelize, 'RiderCashEntry');
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pg = Math.min(Math.max(parseInt(page, 10) || 1, 1), 10000);
  const where = { riderId: String(riderId), ...(types && types.length ? { type: { [Op.in]: types } } : {}) };
  const rows = await CE.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: lim + 1, offset: (pg - 1) * lim });
  return { rows: rows.slice(0, lim), page: pg, limit: lim, hasMore: rows.length > lim };
};

// ── Ledger start + reconciliation (read-only: reports, never fixes) ──────────────────────────────
const readStart = async (sequelize) => {
  const GC = sequelize.models.GlobalConfig;
  if (!GC) return null;
  const row = await GC.findOne({ where: { key: START_KEY }, attributes: ['value'], raw: true });
  let v = row ? row.value : null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* plain ISO string */ } }
  const iso = v && typeof v === 'object' ? v.at : v;
  const d = iso ? new Date(String(iso)) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Sets RIDER_CASH_LEDGER_START once (first boot with C6). Never moves it. Returns the start Date. */
const ensureLedgerStart = async (sequelize) => {
  const existing = await readStart(sequelize);
  if (existing) return existing;
  const GC = sequelize.models.GlobalConfig;
  if (!GC) return null;
  const at = new Date();
  await GC.findOrCreate({ where: { key: START_KEY }, defaults: { key: START_KEY, value: { at: at.toISOString() }, description: 'C6 rider cash ledger start (COD orders delivered after this have a cash row). Never change.' } });
  return (await readStart(sequelize)) || at;
};

const reconcileState = { lastRunAt: null, durationMs: null, ridersChecked: 0, mismatches: 0, withoutHistory: 0, ordersChecked: 0, missingRows: 0, duplicateRows: 0, wrongRows: 0, runs: 0, alertsSent: 0, error: null };

const COD_WHERE_SQL = `o."status" = 'Delivered' AND UPPER(CAST(o."paymentMethod" AS VARCHAR(16))) = 'COD' AND o."deliveryPartnerId" IS NOT NULL
  AND UPPER(COALESCE(o."fulfilment", '')) <> 'VENDOR' AND o."finalPrice" > 0`;

/**
 * 1. every rider: SUM(amountPaise) == cashHeldPaise (riders with a balance and no rows: withoutHistory);
 * 2. every COD order delivered by a rider since the ledger start has exactly ONE COD_COLLECTED row, for
 *    that rider, of the order total (missing / duplicate / wrong rider or amount);
 * 3. no COD_COLLECTED row points at an order that is not a delivered COD rider order.
 */
const reconcile = async ({ sequelize, limit = 100 } = {}) => {
  const seq = sequelize || require('../config/db').getSequelize();
  modelOf(seq, 'RiderCashEntry');
  const Rider = modelOf(seq, 'DeliveryPartner');
  const dialect = seq.getDialect();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  const started = Date.now();
  const out = { mismatches: [], withoutHistory: [], missingRows: [], duplicateRows: [], wrongRows: [] };
  const counts = { mismatches: 0, withoutHistory: 0, missingRows: 0, duplicateRows: 0, wrongRows: 0 };
  const push = (k, v) => { counts[k]++; if (out[k].length < cap) out[k].push(v); };

  // 1. balances
  const sums = await seq.query('SELECT "riderId" AS "riderId", SUM("amountPaise") AS "sum", COUNT(*) AS "n" FROM "RiderCashEntries" GROUP BY "riderId"', { type: QueryTypes.SELECT });
  for (let i = 0; i < sums.length; i += 500) {
    const chunk = sums.slice(i, i + 500);
    const ids = chunk.map((s) => String(s.riderId)).filter((id) => UUID_RE.test(id));
    const riders = ids.length ? await Rider.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'phone', 'cashHeldPaise'], raw: true }) : [];
    const byId = new Map(riders.map((r) => [String(r.id), r]));
    for (const s of chunk) {
      const r = byId.get(String(s.riderId));
      const ledgerPaise = Number(s.sum) || 0;
      const heldPaise = r ? Number(r.cashHeldPaise) || 0 : 0;
      if (ledgerPaise !== heldPaise) push('mismatches', { riderId: String(s.riderId), name: r ? r.name : null, phone: r ? r.phone : null, riderMissing: !r, heldPaise, ledgerPaise, differencePaise: heldPaise - ledgerPaise, rows: Number(s.n) || 0 });
    }
  }
  const idCol = dialect === 'postgres' ? 'CAST(d."id" AS VARCHAR)' : 'd."id"';
  const noHist = await seq.query(
    `SELECT d."id" AS id, d."name" AS name, d."phone" AS phone, d."cashHeldPaise" AS "cashHeldPaise" FROM "DeliveryPartners" d
      WHERE COALESCE(d."cashHeldPaise", 0) <> 0 AND NOT EXISTS (SELECT 1 FROM "RiderCashEntries" c WHERE c."riderId" = ${idCol})`,
    { type: QueryTypes.SELECT },
  );
  for (const d of noHist) push('withoutHistory', { riderId: String(d.id), name: d.name, phone: d.phone, heldPaise: Number(d.cashHeldPaise) || 0, ledgerPaise: 0, differencePaise: Number(d.cashHeldPaise) || 0, rows: 0 });

  // 2. delivered COD orders since the ledger start
  const start = await readStart(seq);
  let ordersChecked = 0;
  if (start) {
    // Raw replacements format a Date in the server's local zone; SQLite compares the stored UTC text,
    // so pass the start in exactly that text form (Postgres parses the ISO string as timestamptz).
    const startParam = dialect === 'postgres' ? start.toISOString() : `${start.toISOString().replace('T', ' ').replace('Z', '')} +00:00`;
    let lastId = null;
    for (;;) {
      const orders = await seq.query(
        `SELECT o."id" AS id, o."deliveryPartnerId" AS "riderId", o."finalPrice" AS "finalPrice", o."deliveredAt" AS "deliveredAt" FROM "Orders" o
          WHERE ${COD_WHERE_SQL} AND COALESCE(o."deliveredAt", o."updatedAt") >= :start ${lastId ? 'AND o."id" > :lastId' : ''}
          ORDER BY o."id" LIMIT 1000`,
        { replacements: { start: startParam, lastId }, type: QueryTypes.SELECT },
      );
      if (!orders.length) break;
      ordersChecked += orders.length;
      const ids = orders.map((o) => String(o.id));
      const rows = await seq.query(
        'SELECT "orderId" AS "orderId", "riderId" AS "riderId", "amountPaise" AS "amountPaise" FROM "RiderCashEntries" WHERE "type" = :type AND "orderId" IN (:ids)',
        { replacements: { type: TYPES.COD_COLLECTED, ids }, type: QueryTypes.SELECT },
      );
      const byOrder = new Map();
      for (const r of rows) { const k = String(r.orderId); byOrder.set(k, [...(byOrder.get(k) || []), r]); }
      for (const o of orders) {
        const got = byOrder.get(String(o.id)) || [];
        const expectPaise = toPaise(o.finalPrice);
        const base = { orderId: String(o.id), riderId: String(o.riderId), expectedPaise: expectPaise, deliveredAt: o.deliveredAt };
        if (got.length === 0) push('missingRows', base);
        else if (got.length > 1) push('duplicateRows', { ...base, rows: got.length });
        else if (String(got[0].riderId) !== String(o.riderId) || Number(got[0].amountPaise) !== expectPaise) push('wrongRows', { ...base, rowRiderId: String(got[0].riderId), rowPaise: Number(got[0].amountPaise) });
      }
      lastId = String(orders[orders.length - 1].id);
      if (orders.length < 1000) break;
    }
  }
  // 3. COD_COLLECTED rows for orders that are not delivered COD rider orders
  const orphans = await seq.query(
    `SELECT c."orderId" AS "orderId", c."riderId" AS "riderId", c."amountPaise" AS "amountPaise" FROM "RiderCashEntries" c
      WHERE c."type" = :type AND NOT EXISTS (SELECT 1 FROM "Orders" o WHERE ${dialect === 'postgres' ? 'CAST(o."id" AS VARCHAR)' : 'o."id"'} = c."orderId" AND ${COD_WHERE_SQL})`,
    { replacements: { type: TYPES.COD_COLLECTED }, type: QueryTypes.SELECT },
  );
  for (const r of orphans) push('wrongRows', { orderId: String(r.orderId), rowRiderId: String(r.riderId), rowPaise: Number(r.amountPaise), notACodDelivery: true });

  const durationMs = Date.now() - started;
  Object.assign(reconcileState, {
    lastRunAt: new Date().toISOString(), durationMs, ridersChecked: sums.length, ordersChecked,
    mismatches: counts.mismatches, withoutHistory: counts.withoutHistory, missingRows: counts.missingRows,
    duplicateRows: counts.duplicateRows, wrongRows: counts.wrongRows, runs: reconcileState.runs + 1, error: null,
  });
  const problems = counts.mismatches + counts.withoutHistory + counts.missingRows + counts.duplicateRows + counts.wrongRows;
  return {
    checkedAt: reconcileState.lastRunAt, durationMs, ledgerStart: start ? start.toISOString() : null,
    ridersChecked: sums.length, ordersChecked, problems, ok: problems === 0,
    counts, ...out,
  };
};

/** Daily job body: reconcile, alert the admins when anything is off. Never fixes anything. */
const runReconcileJob = async ({ io = null } = {}) => {
  try {
    const r = await reconcile({ limit: 20 });
    if (r.problems > 0) {
      const c = r.counts;
      console.warn(`⚠️ [RIDER_CASH_RECONCILE] ${c.mismatches} balance mismatch(es), ${c.withoutHistory} without history, ${c.missingRows} COD order(s) without a cash row, ${c.duplicateRows} with duplicates, ${c.wrongRows} wrong row(s). Nothing was changed. See Admin -> Finance -> Rider cash.`);
      await require('./adminAlert').pushAdmins(
        'Rider cash check: problem found',
        `${r.problems} rider cash problem${r.problems === 1 ? '' : 's'} (balances or COD orders without a cash row). Nothing was changed. Open Admin -> Finance -> Rider cash.`,
        { type: 'RIDER_CASH_RECONCILE', problems: String(r.problems), missingRows: String(c.missingRows) },
        { io },
      );
      reconcileState.alertsSent++;
    }
    return { ridersChecked: r.ridersChecked, ordersChecked: r.ordersChecked, problems: r.problems };
  } catch (err) {
    reconcileState.error = err.message;
    console.warn('[RIDER_CASH_RECONCILE] Error:', err.message);
    return { error: err.message };
  }
};

const reconcileStatus = () => ({ ...reconcileState });

// ── Startup: indexes + ledger start ──────────────────────────────────────────────────────────────
const INDEX_SQL = [
  ['rider_cash_rider_created', 'CREATE INDEX IF NOT EXISTS "rider_cash_rider_created" ON "RiderCashEntries" ("riderId", "createdAt" DESC);'],
  ['rider_cash_rider_idem_unique', 'CREATE UNIQUE INDEX IF NOT EXISTS "rider_cash_rider_idem_unique" ON "RiderCashEntries" ("riderId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;'],
  // Exactly one COD_COLLECTED / STORE_PURCHASE row per order, whoever writes it.
  ['rider_cash_order_type_unique', 'CREATE UNIQUE INDEX IF NOT EXISTS "rider_cash_order_type_unique" ON "RiderCashEntries" ("orderId", "type") WHERE "orderId" IS NOT NULL AND "type" IN (\'COD_COLLECTED\', \'STORE_PURCHASE\');'],
  ['orders_payout_id', 'CREATE INDEX IF NOT EXISTS "orders_payout_id" ON "Orders" ("payoutId");'],
  ['orders_rider_payout_id', 'CREATE INDEX IF NOT EXISTS "orders_rider_payout_id" ON "Orders" ("riderPayoutId");'],
];

const ensureRiderCashIndexes = async (sequelize) => {
  const out = { created: 0, errors: [] };
  for (const [name, sql] of INDEX_SQL) {
    try { await sequelize.query(sql); out.created++; } catch (err) { out.errors.push(`${name}: ${err.message}`); console.warn(`⚠️ [FINANCE_MIGRATION_WARN] ${name}:`, err.message); }
  }
  return out;
};

module.exports = {
  TYPES, DEPOSIT_METHODS, LIMIT_KEY, START_KEY, DEFAULT_LIMIT_RUPEES, MAX_LIMIT_RUPEES, RiderCashError, isCashError, toRupees,
  applyCashChange, isCodCashOrder, storePurchasePaise, recordCodDelivery,
  getCashLimitPaise, depositNeededPaise, cashStatus, claimBlockedByCash,
  toPublic, toAdmin, listFor, readStart, ensureLedgerStart, reconcile, runReconcileJob, reconcileStatus, ensureRiderCashIndexes,
};
