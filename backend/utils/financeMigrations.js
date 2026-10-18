// C6 startup migration (additive, idempotent, every dialect; never changes money):
//   1. named indexes for the rider cash ledger + Order.payoutId / riderPayoutId;
//   2. RIDER_CASH_LEDGER_START, set once (COD orders delivered after it must have a cash row);
//   3. one-time commission snapshot of every not-yet-settled order that has none, from its store's
//      CURRENT rate (count logged and stored in GlobalConfig C6_COMMISSION_BACKFILL). Write-once per order,
//      so later boots find nothing to do and a rate change never touches an order again.
// Never throws (logs instead), like the C5 wallet ledger migration.
const riderCash = require('./riderCash');
const { backfillCommissionSnapshots } = require('./commission');

const BACKFILL_KEY = 'C6_COMMISSION_BACKFILL';

const runFinanceMigrations = async (sequelize) => {
  const out = { indexes: null, ledgerStart: null, commission: null };
  try {
    if (!sequelize || !sequelize.models.RiderCashEntry) return out;
    out.indexes = await riderCash.ensureRiderCashIndexes(sequelize);
    const start = await riderCash.ensureLedgerStart(sequelize);
    out.ledgerStart = start ? start.toISOString() : null;
    out.commission = await backfillCommissionSnapshots(sequelize);
    if (out.commission.updated > 0) {
      console.log(`✅ [C6_COMMISSION_BACKFILL] Commission snapshot taken (current store rate) for ${out.commission.updated} unsettled order(s)${out.commission.skippedNoStore ? `; ${out.commission.skippedNoStore} without a store skipped` : ''}.`);
      const GC = sequelize.models.GlobalConfig;
      if (GC) {
        const [row, created] = await GC.findOrCreate({ where: { key: BACKFILL_KEY }, defaults: { key: BACKFILL_KEY, value: { at: new Date().toISOString(), updated: out.commission.updated }, description: 'C6 one-time commission snapshot of unsettled orders (current rate). Informational.' } });
        if (!created) {
          let v = row.value;
          if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
          const runs = Array.isArray(v && v.runs) ? v.runs : (v && v.at ? [{ at: v.at, updated: v.updated }] : []);
          runs.push({ at: new Date().toISOString(), updated: out.commission.updated });
          await GC.update({ value: { ...(v && typeof v === 'object' ? v : {}), runs: runs.slice(-20) } }, { where: { key: BACKFILL_KEY } });
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [FINANCE_MIGRATION_WARN]', err.message);
    out.error = err.message;
  }
  return out;
};

module.exports = { runFinanceMigrations, BACKFILL_KEY };
