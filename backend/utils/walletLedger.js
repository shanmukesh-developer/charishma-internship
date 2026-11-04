// C5 wallet ledger. Every change of User.walletBalance / DeliveryPartner.walletBalance goes through
// applyWalletChange, INSIDE the caller's transaction:
//   1. (idempotencyKey) an existing row for (owner, key) -> nothing changes, that row is returned.
//   2. one conditional UPDATE of the FLOAT balance, computed in integer paise (floor(x*100 + 0.5),
//      the same rounding in SQL and JS), refusing to go below zero unless allowNegative.
//   3. the new balance is read back and ONE WalletTransactions row is inserted (amountPaise signed,
//      balanceAfterPaise). An owner whose balance predates the ledger first gets its OPENING_BALANCE row
//      (= balance before this change), so the history of every owner always sums to the balance.
// Any failure throws and the caller's transaction rolls the balance and the row back together.
//
// Also here: the one-time opening-balance backfill + indexes (runWalletLedgerMigrations, at startup),
// the reconciliation scan (reconcile; daily job 'wallet.reconcile', admin endpoint), and the labels
// the customer / rider / admin history endpoints show.
const { Op, QueryTypes, Transaction } = require('sequelize');

const OWNER_TYPES = ['user', 'rider'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_FOR = { user: 'User', rider: 'DeliveryPartner' };
const TABLE_FOR = { user: 'Users', rider: 'DeliveryPartners' };

const TYPES = Object.freeze({
  ORDER_PAYMENT: 'ORDER_PAYMENT',
  ORDER_REFUND: 'ORDER_REFUND',
  BILL_DIFFERENCE: 'BILL_DIFFERENCE',
  ADMIN_CREDIT: 'ADMIN_CREDIT',
  ADMIN_DEBIT: 'ADMIN_DEBIT',
  TIP_SENT: 'TIP_SENT',
  TIP_RECEIVED: 'TIP_RECEIVED',
  TIP_PAYOUT: 'TIP_PAYOUT',
  GIFT_SENT: 'GIFT_SENT',
  GIFT_RECEIVED: 'GIFT_RECEIVED',
  AUTORIDE_PAYMENT: 'AUTORIDE_PAYMENT',
  AUTORIDE_REFUND: 'AUTORIDE_REFUND',
  EVENT_PAYMENT: 'EVENT_PAYMENT',
  EVENT_REFUND: 'EVENT_REFUND',
  OPENING_BALANCE: 'OPENING_BALANCE',
  CORRECTION: 'CORRECTION',
});

class WalletLedgerError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'WalletLedgerError';
    this.code = code;
    Object.assign(this, extra);
  }
}
const isInsufficient = (err) => !!err && err.name === 'WalletLedgerError' && err.code === 'INSUFFICIENT_BALANCE';

/** Rupees (number / numeric string) -> integer paise, round half up: floor(x*100 + 0.5). */
const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n * 100 + 0.5);
};
const toRupees = (paise) => Math.round(Number(paise) || 0) / 100;

// The same floor(x*100 + 0.5) in SQL (SQLite has no FLOOR before 3.35, CAST truncates toward zero).
const paiseSql = (dialect, col = '"walletBalance"') => {
  const v = `(COALESCE(${col}, 0) * 100 + 0.5)`;
  if (dialect === 'postgres') return `FLOOR(${v})`;
  return `(CAST(${v} AS INTEGER) - (CASE WHEN ${v} < CAST(${v} AS INTEGER) THEN 1 ELSE 0 END))`;
};

const clean = (v, max) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, max));

const ledgerModel = (sequelize) => {
  const M = sequelize && sequelize.models && sequelize.models.WalletTransaction;
  if (!M) throw new WalletLedgerError('LEDGER_NOT_READY', 'Wallet history is not set up on this database.');
  return M;
};

/**
 * Applies one wallet change inside transaction `t` and records it. Returns
 *   { applied: true, duplicate: false, row, balancePaise, balance }   or, for a repeated idempotencyKey,
 *   { applied: false, duplicate: true, row, balancePaise, balance }   (nothing changed).
 * Throws WalletLedgerError: INVALID_INPUT, REASON_REQUIRED, OWNER_NOT_FOUND, INSUFFICIENT_BALANCE.
 */
const applyWalletChange = async ({
  t, ownerType, ownerId, amountPaise, type, ref = null, actor = null, reason = null, idempotencyKey = null, allowNegative = false,
} = {}) => {
  if (!t || !t.sequelize) throw new WalletLedgerError('INVALID_INPUT', 'applyWalletChange must run inside a transaction.');
  if (!OWNER_TYPES.includes(ownerType)) throw new WalletLedgerError('INVALID_INPUT', `Unknown wallet owner type: ${ownerType}`);
  if (!ownerId) throw new WalletLedgerError('INVALID_INPUT', 'ownerId is required.');
  if (!Number.isSafeInteger(amountPaise) || amountPaise === 0) throw new WalletLedgerError('INVALID_INPUT', `amountPaise must be a non-zero integer (got ${amountPaise}).`);
  if (!TYPES[type]) throw new WalletLedgerError('INVALID_INPUT', `Unknown wallet transaction type: ${type}`);
  const actorType = clean(actor && actor.type, 16) || 'system';
  const why = reason === null || reason === undefined ? null : String(reason).trim().slice(0, 500);
  if (actorType === 'admin' && (!why || why.length < 5)) throw new WalletLedgerError('REASON_REQUIRED', 'A reason (at least 5 characters) is required for admin wallet changes.');

  const sequelize = t.sequelize;
  const WT = ledgerModel(sequelize);
  const Owner = sequelize.models[MODEL_FOR[ownerType]];
  if (!Owner) throw new WalletLedgerError('LEDGER_NOT_READY', `${MODEL_FOR[ownerType]} model is not set up.`);
  const oid = String(ownerId);
  const key = clean(idempotencyKey, 160);

  if (key) {
    const prior = await WT.findOne({ where: { ownerType, ownerId: oid, idempotencyKey: key }, transaction: t });
    if (prior) {
      const owner = await Owner.findByPk(oid, { attributes: ['walletBalance'], transaction: t, raw: true });
      const balancePaise = owner ? toPaise(owner.walletBalance) : prior.balanceAfterPaise;
      return { applied: false, duplicate: true, row: prior, balancePaise, balance: toRupees(balancePaise) };
    }
  }

  const P = paiseSql(sequelize.getDialect());
  const guard = amountPaise < 0 && !allowNegative ? [sequelize.literal(`(${P} + (${amountPaise})) >= 0`)] : [];
  const [n] = await Owner.update(
    { walletBalance: sequelize.literal(`(${P} + (${amountPaise})) / 100.0`) },
    { where: { [Op.and]: [{ id: oid }, ...guard] }, transaction: t },
  );
  if (!n) {
    const exists = await Owner.findByPk(oid, { attributes: ['id', 'walletBalance'], transaction: t, raw: true });
    if (!exists) throw new WalletLedgerError('OWNER_NOT_FOUND', 'Wallet owner not found.');
    throw new WalletLedgerError('INSUFFICIENT_BALANCE', 'Not enough wallet balance.', { balancePaise: toPaise(exists.walletBalance), neededPaise: -amountPaise });
  }
  const fresh = await Owner.findByPk(oid, { attributes: ['walletBalance'], transaction: t, raw: true });
  const balancePaise = toPaise(fresh && fresh.walletBalance);
  const now = Date.now();

  // First ledger row for this owner: record what the balance was before (after - change), so the
  // history sums to the balance. Checked after the UPDATE: the owner row is ours now, so a parallel
  // first change has either committed (we see its rows) or waits for us.
  const hasRows = await WT.findOne({ where: { ownerType, ownerId: oid }, attributes: ['id'], transaction: t });
  if (!hasRows) {
    const openingPaise = balancePaise - amountPaise;
    if (openingPaise !== 0) {
      await WT.bulkCreate([{
        ownerType, ownerId: oid, amountPaise: openingPaise, balanceAfterPaise: openingPaise, type: TYPES.OPENING_BALANCE,
        actorType: 'system', reason: 'Balance before wallet history started', idempotencyKey: 'opening-balance', createdAt: new Date(now - 1),
      }], { transaction: t, ignoreDuplicates: true });
    }
  }

  const row = await WT.create({
    ownerType,
    ownerId: oid,
    amountPaise,
    balanceAfterPaise: balancePaise,
    type,
    refType: clean(ref && ref.type, 32),
    refId: clean(ref && ref.id, 64),
    actorType,
    actorId: clean(actor && actor.id, 64),
    reason: why,
    idempotencyKey: key,
    createdAt: new Date(now),
  }, { transaction: t });
  return { applied: true, duplicate: false, row, balancePaise, balance: toRupees(balancePaise) };
};

// ── Startup migration: indexes + one-time opening balances ───────────────────────────────────────
const INDEX_SQL = [
  ['wallet_tx_owner_created', 'CREATE INDEX IF NOT EXISTS "wallet_tx_owner_created" ON "WalletTransactions" ("ownerType", "ownerId", "createdAt" DESC);'],
  ['wallet_tx_owner_idem_unique', 'CREATE UNIQUE INDEX IF NOT EXISTS "wallet_tx_owner_idem_unique" ON "WalletTransactions" ("ownerType", "ownerId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;'],
  ['wallet_tx_ref', 'CREATE INDEX IF NOT EXISTS "wallet_tx_ref" ON "WalletTransactions" ("refType", "refId");'],
];

const ensureWalletLedgerIndexes = async (sequelize) => {
  const out = { created: 0, errors: [] };
  for (const [name, sql] of INDEX_SQL) {
    try { await sequelize.query(sql); out.created++; } catch (err) { out.errors.push(`${name}: ${err.message}`); console.warn(`⚠️ [WALLET_LEDGER_MIGRATION_WARN] ${name}:`, err.message); }
  }
  return out;
};

const moneyTx = (sequelize, fn) => sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, fn);

/**
 * One OPENING_BALANCE row for every user / rider with a non-zero balance and no ledger rows. Idempotent:
 * an owner with any row is skipped, each insert runs under the owner's row lock (so it serialises with
 * applyWalletChange) and the unique (owner, 'opening-balance') key makes a second insert impossible.
 * Never changes a balance.
 */
const backfillOpeningBalances = async (sequelize, { batch = 500 } = {}) => {
  const WT = ledgerModel(sequelize);
  const out = { user: 0, rider: 0, skipped: 0 };
  const dialect = sequelize.getDialect();
  for (const ownerType of OWNER_TYPES) {
    const Owner = sequelize.models[MODEL_FOR[ownerType]];
    if (!Owner) continue;
    const table = TABLE_FOR[ownerType];
    const idCol = dialect === 'postgres' ? 'CAST(o."id" AS VARCHAR)' : 'o."id"';
    let lastId = null;
    for (;;) {
      const rows = await sequelize.query(
        `SELECT o."id" AS id FROM "${table}" o
          WHERE ${paiseSql(dialect, 'o."walletBalance"')} <> 0
            AND NOT EXISTS (SELECT 1 FROM "WalletTransactions" w WHERE w."ownerType" = :ownerType AND w."ownerId" = ${idCol})
            ${lastId ? `AND ${idCol} > :lastId` : ''}
          ORDER BY ${idCol} LIMIT ${Number(batch) | 0}`,
        { replacements: { ownerType, lastId }, type: QueryTypes.SELECT },
      );
      if (!rows.length) break;
      for (const { id } of rows) {
        const oid = String(id);
        const inserted = await moneyTx(sequelize, async (t) => {
          const owner = await Owner.findByPk(oid, { attributes: ['id', 'walletBalance'], transaction: t, lock: t.LOCK.UPDATE });
          if (!owner) return false;
          const paise = toPaise(owner.walletBalance);
          if (paise === 0) return false;
          const any = await WT.findOne({ where: { ownerType, ownerId: oid }, attributes: ['id'], transaction: t });
          if (any) return false;
          const created = await WT.bulkCreate([{
            ownerType, ownerId: oid, amountPaise: paise, balanceAfterPaise: paise, type: TYPES.OPENING_BALANCE,
            actorType: 'system', reason: 'Balance before wallet history started', idempotencyKey: 'opening-balance', createdAt: new Date(),
          }], { transaction: t, ignoreDuplicates: true });
          return created.length > 0;
        });
        if (inserted) out[ownerType]++; else out.skipped++;
      }
      lastId = String(rows[rows.length - 1].id);
      if (rows.length < batch) break;
    }
  }
  return out;
};

/** Startup: indexes, then the one-time opening balances. Never throws (logs instead). */
const runWalletLedgerMigrations = async (sequelize) => {
  const out = { indexes: null, opening: null };
  try {
    if (!sequelize || !sequelize.models.WalletTransaction) return out;
    out.indexes = await ensureWalletLedgerIndexes(sequelize);
    out.opening = await backfillOpeningBalances(sequelize);
    if (out.opening.user || out.opening.rider) console.log(`✅ [WALLET_LEDGER] Opening balances recorded: ${out.opening.user} customer(s), ${out.opening.rider} rider(s).`);
  } catch (err) {
    console.warn('⚠️ [WALLET_LEDGER_MIGRATION_WARN]', err.message);
    out.error = err.message;
  }
  return out;
};

// ── Reconciliation (read-only: reports, never fixes) ─────────────────────────────────────────────
const reconcileState = { lastRunAt: null, durationMs: null, ownersChecked: 0, mismatches: 0, withoutHistory: 0, runs: 0, alertsSent: 0, error: null };

/**
 * For every owner with ledger rows: SUM(amountPaise) vs the balance. Owners with a non-zero balance and
 * no rows at all are reported as withoutHistory (balance changed outside the ledger). Returns
 * { ownersChecked, mismatchCount, withoutHistoryCount, mismatches[≤limit], withoutHistory[≤limit] }.
 */
const reconcile = async ({ sequelize, limit = 100 } = {}) => {
  const seq = sequelize || require('../config/db').getSequelize();
  ledgerModel(seq);
  const dialect = seq.getDialect();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  const started = Date.now();
  const mismatches = [];
  const withoutHistory = [];
  let ownersChecked = 0;
  let mismatchCount = 0;
  let withoutHistoryCount = 0;
  for (const ownerType of OWNER_TYPES) {
    const Owner = seq.models[MODEL_FOR[ownerType]];
    if (!Owner) continue;
    const sums = await seq.query(
      'SELECT "ownerId" AS "ownerId", SUM("amountPaise") AS "sum", COUNT(*) AS "n" FROM "WalletTransactions" WHERE "ownerType" = :ownerType GROUP BY "ownerId"',
      { replacements: { ownerType }, type: QueryTypes.SELECT },
    );
    ownersChecked += sums.length;
    for (let i = 0; i < sums.length; i += 500) {
      const chunk = sums.slice(i, i + 500);
      // Only well-formed ids go into the IN list (Postgres rejects a malformed uuid); others count as missing.
      const ids = chunk.map((s) => String(s.ownerId)).filter((id) => UUID_RE.test(id));
      const owners = ids.length ? await Owner.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'phone', 'walletBalance'], raw: true }) : [];
      const byId = new Map(owners.map((o) => [String(o.id), o]));
      for (const s of chunk) {
        const o = byId.get(String(s.ownerId));
        const ledgerPaise = Number(s.sum) || 0;
        const balancePaise = o ? toPaise(o.walletBalance) : 0;
        if (ledgerPaise !== balancePaise) {
          mismatchCount++;
          if (mismatches.length < cap) {
            mismatches.push({ ownerType, ownerId: String(s.ownerId), name: o ? o.name : null, phone: o ? o.phone : null, ownerMissing: !o, balancePaise, ledgerPaise, differencePaise: balancePaise - ledgerPaise, rows: Number(s.n) || 0 });
          }
        }
      }
    }
    const table = TABLE_FOR[ownerType];
    const idCol = dialect === 'postgres' ? 'CAST(o."id" AS VARCHAR)' : 'o."id"';
    const noHist = await seq.query(
      `SELECT o."id" AS id, o."name" AS name, o."phone" AS phone, o."walletBalance" AS "walletBalance" FROM "${table}" o
        WHERE ${paiseSql(dialect, 'o."walletBalance"')} <> 0
          AND NOT EXISTS (SELECT 1 FROM "WalletTransactions" w WHERE w."ownerType" = :ownerType AND w."ownerId" = ${idCol})`,
      { replacements: { ownerType }, type: QueryTypes.SELECT },
    );
    withoutHistoryCount += noHist.length;
    for (const o of noHist.slice(0, Math.max(0, cap - withoutHistory.length))) {
      withoutHistory.push({ ownerType, ownerId: String(o.id), name: o.name, phone: o.phone, balancePaise: toPaise(o.walletBalance), ledgerPaise: 0, differencePaise: toPaise(o.walletBalance), rows: 0 });
    }
  }
  const durationMs = Date.now() - started;
  Object.assign(reconcileState, { lastRunAt: new Date().toISOString(), durationMs, ownersChecked, mismatches: mismatchCount, withoutHistory: withoutHistoryCount, runs: reconcileState.runs + 1, error: null });
  return { checkedAt: reconcileState.lastRunAt, durationMs, ownersChecked, mismatchCount, withoutHistoryCount, mismatches, withoutHistory };
};

/** Daily job body: reconcile, alert the admins when anything is off. Never fixes anything. */
const runReconcileJob = async ({ io = null } = {}) => {
  try {
    const r = await reconcile({ limit: 20 });
    const bad = r.mismatchCount + r.withoutHistoryCount;
    if (bad > 0) {
      console.warn(`⚠️ [WALLET_RECONCILE] ${r.mismatchCount} wallet(s) differ from their history, ${r.withoutHistoryCount} have a balance without history. Nothing was changed. See Admin -> Users -> Wallet check.`);
      await require('./adminAlert').pushAdmins(
        'Wallet check: mismatch found',
        `${bad} wallet${bad === 1 ? '' : 's'} do not match their history. Nothing was changed. Open Admin -> Users -> Wallet check.`,
        { type: 'WALLET_RECONCILE', mismatches: String(r.mismatchCount), withoutHistory: String(r.withoutHistoryCount) },
        { io },
      );
      reconcileState.alertsSent++;
    }
    return { ownersChecked: r.ownersChecked, mismatches: r.mismatchCount, withoutHistory: r.withoutHistoryCount };
  } catch (err) {
    reconcileState.error = err.message;
    console.warn('[WALLET_RECONCILE] Error:', err.message);
    return { error: err.message };
  }
};

const reconcileStatus = () => ({ ...reconcileState });

// ── Labels / serialisation for the history screens ───────────────────────────────────────────────
const LABELS = {
  ORDER_PAYMENT: 'Order payment',
  ORDER_REFUND: 'Order refund',
  ADMIN_CREDIT: 'Added by ZENV support',
  ADMIN_DEBIT: 'Deducted by ZENV support',
  TIP_SENT: 'Tip to your rider',
  TIP_RECEIVED: 'Tip from a customer',
  TIP_PAYOUT: 'Tips paid out',
  GIFT_SENT: 'Gift sent',
  GIFT_RECEIVED: 'Gift received',
  AUTORIDE_PAYMENT: 'Auto ride',
  AUTORIDE_REFUND: 'Auto ride refund',
  EVENT_PAYMENT: 'Event registration',
  EVENT_REFUND: 'Event refund',
  OPENING_BALANCE: 'Opening balance',
  CORRECTION: 'Correction',
};
const labelFor = (type, amountPaise) => {
  if (type === TYPES.BILL_DIFFERENCE) return amountPaise < 0 ? 'Final bill: extra charged' : 'Final bill: difference returned';
  return LABELS[type] || 'Wallet change';
};

const REF_LINKS = {
  // Same order reference as the app (last 6 characters), so a refund can be matched to its order.
  ORDER: (id) => ({ label: `Order #${String(id).slice(-6).toUpperCase()}`, link: `/tracking/${id}` }),
  AUTO_BOOKING: (id) => ({ label: 'Auto booking', link: `/auto-ride/booking/${id}` }),
  AUTO_PRIVATE_REQUEST: () => ({ label: 'Private auto request', link: null }),
  EVENT_REGISTRATION: (id) => ({ label: 'Event registration', link: `/campus-events/registration/${id}` }),
};

/** Public shape for customers / riders (no idempotency keys, no admin ids). */
const toPublic = (row) => {
  const r = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
  const refFn = r.refType && REF_LINKS[r.refType];
  const ref = r.refType ? { type: r.refType, id: r.refId, ...(refFn ? refFn(r.refId) : { label: null, link: null }) } : null;
  return {
    id: r.id,
    type: r.type,
    label: labelFor(r.type, r.amountPaise),
    amountPaise: r.amountPaise,
    amount: toRupees(r.amountPaise),
    direction: r.amountPaise >= 0 ? 'credit' : 'debit',
    balanceAfterPaise: r.balanceAfterPaise,
    balanceAfter: toRupees(r.balanceAfterPaise),
    // Admin reasons are shown to the owner (they explain the change); system rows have none.
    note: r.actorType === 'admin' ? r.reason : null,
    ref,
    createdAt: r.createdAt,
  };
};
const toAdmin = (row) => {
  const r = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
  return { ...toPublic(r), ownerType: r.ownerType, ownerId: r.ownerId, actorType: r.actorType, actorId: r.actorId, reason: r.reason, idempotencyKey: r.idempotencyKey };
};

/** Newest first, offset pages. Returns { rows, page, limit, hasMore }. */
const listFor = async ({ ownerType, ownerId, page = 1, limit = 20, sequelize = null } = {}) => {
  const seq = sequelize || require('../config/db').getSequelize();
  const WT = ledgerModel(seq);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pg = Math.min(Math.max(parseInt(page, 10) || 1, 1), 10000);
  const rows = await WT.findAll({
    where: { ownerType, ownerId: String(ownerId) },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: lim + 1,
    offset: (pg - 1) * lim,
  });
  return { rows: rows.slice(0, lim), page: pg, limit: lim, hasMore: rows.length > lim };
};

module.exports = {
  TYPES, OWNER_TYPES, WalletLedgerError, isInsufficient, toPaise, toRupees, paiseSql,
  applyWalletChange, ensureWalletLedgerIndexes, backfillOpeningBalances, runWalletLedgerMigrations,
  reconcile, runReconcileJob, reconcileStatus, labelFor, toPublic, toAdmin, listFor,
};
