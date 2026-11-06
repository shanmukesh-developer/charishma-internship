/**
 * Human order IDs (owner, 6 Nov 2026): every customer order gets "ZEN-<n>", one running count across the whole
 * server. The very first order ever is ZEN-1, the next ZEN-2, and so on.
 *
 *   Tables      Orders (food / grocery / stall deliveries), MegaBaskets (old shopping lists) and CampusBookings
 *               (In-Campus Booking pickups) each have an INTEGER "orderNumber" column, all numbered from the SAME
 *               counter, so a number is never used twice anywhere on the server.
 *   Counter     Postgres: the SEQUENCE "zen_order_number_seq" (nextval never blocks another checkout; a rolled
 *               back checkout leaves a gap, never a duplicate). SQLite (dev / tests): the ReceiptCounters row
 *               'ZEN/ORDER', incremented in the creating transaction.
 *   Assigned    by the models' beforeCreate / beforeBulkCreate hooks (installNumbering), so every create path gets
 *               one and a client can never choose it (any value sent is overwritten). Never changed afterwards:
 *               update hooks drop any attempt to change it.
 *   Backfill    runOrderNumberMigrations (every boot): rows without a number get one, oldest first (createdAt,
 *               across all three tables), drawn from the same counter. One cheap EXISTS check when there is
 *               nothing to do. Idempotent, safe on a fresh database, never touches updatedAt.
 *   Payloads    the models' VIRTUAL "orderCode" ('ZEN-' + orderNumber, null when there is no number yet) is in
 *               every toJSON; finds that list attributes and select "id" get orderNumber + orderCode added
 *               (installFindHook). Hand-built payloads use fields(o); message texts use label(o).
 */
const { Transaction, QueryTypes } = require('sequelize');

const PREFIX = 'ZEN-';
const SEQ = 'zen_order_number_seq';
const COUNTER_SERIES = 'ZEN/ORDER';
const ADVISORY_KEY = 707201126; // pg_advisory_xact_lock key for the backfill (one booting instance at a time)
const NUMBERED = [
  { model: 'Order', table: 'Orders', index: 'orders_order_number_unique' },
  { model: 'MegaBasket', table: 'MegaBaskets', index: 'mega_baskets_order_number_unique' },
  { model: 'CampusBooking', table: 'CampusBookings', index: 'campus_bookings_order_number_unique' },
];
const NUMBERED_MODELS = new Set(NUMBERED.map((n) => n.model));

/** 'ZEN-123' for a positive whole number, else null. */
const codeOf = (n) => {
  const v = Number(n);
  return Number.isInteger(v) && v > 0 ? `${PREFIX}${v}` : null;
};
/** The old short reference (last 6 of the UUID), kept for rows that have no number yet. */
const shortRef = (id) => String(id || '').replace(/-/g, '').slice(-6).toUpperCase();
/** { orderNumber, orderCode } for a hand-built payload. */
const fields = (o) => {
  const n = o ? Number(o.orderNumber) : NaN;
  const orderNumber = Number.isInteger(n) && n > 0 ? n : null;
  return { orderNumber, orderCode: codeOf(orderNumber) };
};
/** Text for messages: 'ZEN-123', or '#AB12CD' (old short id) when the row has no number yet. */
const label = (o) => {
  if (!o) return '';
  const c = (o.orderCode && String(o.orderCode)) || codeOf(o.orderNumber);
  if (c) return c;
  const id = o.id || o._id;
  return id ? `#${shortRef(id)}` : '';
};
/** 'ZEN-123' / 'zen 123' / '#123' / '123' -> 123, else null (admin search). */
const parseCode = (q) => {
  const m = /^\s*(?:zen\s*[-#]?\s*|#\s*)?(\d{1,9})\s*$/i.exec(String(q || ''));
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 2147483647 ? n : null;
};

const isPg = (sequelize) => sequelize.getDialect() === 'postgres';

// Postgres: numbers are handed out only once the sequence exists (made by runOrderNumberMigrations after the
// columns). A process that never ran the migration checks once a minute; until then rows stay unnumbered and
// the next boot's backfill numbers them.
const pgReady = new WeakMap();
const sequenceReady = async (sequelize) => {
  const st = pgReady.get(sequelize);
  if (st && (st.ok || Date.now() - st.at < 60000)) return st.ok;
  let ok = false;
  try {
    const rows = await sequelize.query(`SELECT to_regclass('${SEQ}') IS NOT NULL AS "ok"`, { type: QueryTypes.SELECT });
    ok = !!(rows && rows[0] && rows[0].ok);
  } catch { ok = false; }
  pgReady.set(sequelize, { ok, at: Date.now() });
  return ok;
};

const presentTables = (sequelize) => NUMBERED.filter((n) => sequelize.models[n.model]);

/** Highest number used in any numbered table (0 when none). */
const maxUsed = async (sequelize, transaction) => {
  const tables = presentTables(sequelize);
  if (!tables.length) return 0;
  const sql = `SELECT MAX("m") AS "m" FROM (${tables.map((n) => `SELECT MAX("orderNumber") AS "m" FROM "${n.table}"`).join(' UNION ALL ')}) AS "x"`;
  const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, transaction });
  return Number(rows && rows[0] && rows[0].m) || 0;
};

const sqliteCounter = async (sequelize, count, t) => {
  if (!sequelize.models.ReceiptCounter) return [];
  const now = new Date();
  const start = await maxUsed(sequelize, t); // a brand-new counter row starts after any number already used
  await sequelize.query('INSERT OR IGNORE INTO "ReceiptCounters" ("series", "lastNumber", "createdAt", "updatedAt") VALUES (:s, :start, :now, :now)',
    { replacements: { s: COUNTER_SERIES, start, now }, transaction: t });
  await sequelize.query('UPDATE "ReceiptCounters" SET "lastNumber" = "lastNumber" + :k, "updatedAt" = :now WHERE "series" = :s',
    { replacements: { s: COUNTER_SERIES, k: count, now }, transaction: t });
  const rows = await sequelize.query('SELECT "lastNumber" FROM "ReceiptCounters" WHERE "series" = :s', { replacements: { s: COUNTER_SERIES }, type: QueryTypes.SELECT, transaction: t });
  const last = Number(rows && rows[0] && rows[0].lastNumber) || 0;
  if (last < count) return [];
  return Array.from({ length: count }, (_, i) => last - count + 1 + i);
};

/**
 * `count` fresh numbers, ascending, never handed out before (gaps possible, duplicates never). [] when
 * numbering is not available yet (the boot backfill numbers those rows later). Never aborts `transaction`.
 */
const nextNumbers = async (sequelize, count, transaction) => {
  if (!sequelize || !(count > 0)) return [];
  if (isPg(sequelize)) {
    if (!(await sequenceReady(sequelize))) return [];
    const draw = (t) => sequelize.query(`SELECT nextval('${SEQ}') AS "v" FROM generate_series(1, :k)`,
      { replacements: { k: count }, type: QueryTypes.SELECT, transaction: t });
    try {
      // Inside the caller's transaction a savepoint keeps a failure from aborting the checkout.
      const rows = transaction ? await sequelize.transaction({ transaction }, (sp) => draw(sp)) : await draw(undefined);
      return rows.map((r) => Number(r.v)).sort((a, b) => a - b);
    } catch (err) {
      console.warn('⚠️ [ORDER_NUMBER_WARN] nextval failed:', err.message);
      pgReady.delete(sequelize);
      return [];
    }
  }
  try {
    if (transaction) return await sqliteCounter(sequelize, count, transaction);
    return await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, (t) => sqliteCounter(sequelize, count, t));
  } catch (err) {
    console.warn('⚠️ [ORDER_NUMBER_WARN] counter failed:', err.message);
    return [];
  }
};

const NUMBERED_MARK = Symbol('zenOrderNumbered');
const assign = async (Model, instances, options) => {
  const list = instances.filter((i) => i && !i[NUMBERED_MARK]);
  if (!list.length) return;
  for (const inst of list) {
    inst[NUMBERED_MARK] = true;
    delete inst.dataValues.orderNumber; // a client never chooses the number
  }
  const nums = await nextNumbers(Model.sequelize, list.length, options && options.transaction);
  list.forEach((inst, i) => { if (nums[i]) inst.setDataValue('orderNumber', nums[i]); });
};

/** Universal find hook (once per sequelize): selects orderNumber + orderCode wherever a numbered row's id is. */
const installedFindHook = new WeakSet();
const addCode = (model, opts) => {
  if (!model || !NUMBERED_MODELS.has(model.name) || !opts || opts.group) return;
  const a = opts.attributes;
  if (!Array.isArray(a) || !a.includes('id') || a.includes('orderCode')) return;
  opts.attributes = a.concat(a.includes('orderNumber') ? ['orderCode'] : ['orderNumber', 'orderCode']);
};
const walkIncludes = (includes) => {
  if (!Array.isArray(includes)) return;
  for (const inc of includes) {
    if (!inc || typeof inc !== 'object') continue;
    addCode(inc.model, inc);
    walkIncludes(inc.include);
  }
};
const installFindHook = (sequelize) => {
  if (!sequelize || installedFindHook.has(sequelize)) return;
  installedFindHook.add(sequelize);
  sequelize.addHook('beforeFindAfterExpandIncludeAll', function zenOrderCodeFind(options) {
    try {
      addCode(this, options);
      walkIncludes(options && options.include);
    } catch { /* never block a read */ }
  });
};

/**
 * Installs numbering on a model (Order, MegaBasket, CampusBooking). The model must define
 * `orderNumber` (INTEGER, nullable) and `orderCode` (VIRTUAL(STRING, ['orderNumber'])) — see attributes().
 */
const installNumbering = (Model) => {
  if (!Model) return Model;
  Model.addHook('beforeCreate', 'zenOrderNumber', (inst, options) => assign(Model, [inst], options));
  Model.addHook('beforeBulkCreate', 'zenOrderNumber', (instances, options) => assign(Model, instances || [], options));
  // Never changed once set (and never set by an update: only the create hooks and the backfill assign it).
  Model.addHook('beforeUpdate', 'zenOrderNumberLock', (inst) => {
    if (inst.changed('orderNumber')) inst.setDataValue('orderNumber', inst.previous('orderNumber'));
  });
  Model.addHook('beforeBulkUpdate', 'zenOrderNumberLock', (options) => {
    if (options && options.attributes && Object.prototype.hasOwnProperty.call(options.attributes, 'orderNumber')) delete options.attributes.orderNumber;
    if (options && Array.isArray(options.fields)) options.fields = options.fields.filter((f) => f !== 'orderNumber');
  });
  installFindHook(Model.sequelize);
  return Model;
};

/** Column definitions for a numbered model. */
const attributes = (DataTypes) => ({
  // Human order ID number (utils/orderNumbers): one running count across Orders, MegaBaskets and CampusBookings.
  // Assigned at creation, never changed. Null only until the boot backfill numbers an older row.
  orderNumber: { type: DataTypes.INTEGER, allowNull: true },
  orderCode: {
    type: DataTypes.VIRTUAL(DataTypes.STRING, ['orderNumber']),
    get() { return codeOf(this.getDataValue('orderNumber')); },
    set() { /* derived */ },
  },
});

/** Numbers every unnumbered row, oldest first across all numbered tables. Returns how many rows it numbered. */
const backfill = async (sequelize) => {
  const tables = presentTables(sequelize);
  if (!tables.length) return 0;
  const pending = await sequelize.query(
    `SELECT ${tables.map((n) => `EXISTS (SELECT 1 FROM "${n.table}" WHERE "orderNumber" IS NULL)`).join(' OR ')} AS "p"`,
    { type: QueryTypes.SELECT },
  );
  const p = pending && pending[0] ? pending[0].p : false;
  if (!(p === true || p === 1 || p === '1' || p === 't')) return 0;

  if (isPg(sequelize)) {
    return sequelize.transaction(async (t) => {
      await sequelize.query(`SELECT pg_advisory_xact_lock(${ADVISORY_KEY})`, { transaction: t });
      const union = tables.map((n, i) => `SELECT ${i} AS "t", "id"::text AS "id", "createdAt"::timestamptz AS "createdAt" FROM "${n.table}" WHERE "orderNumber" IS NULL`).join(' UNION ALL ');
      const updates = tables.map((n, i) => `"u${i}" AS (UPDATE "${n.table}" AS "x" SET "orderNumber" = "pairs"."n" FROM "pairs" WHERE "pairs"."t" = ${i} AND "x"."id"::text = "pairs"."id" AND "x"."orderNumber" IS NULL RETURNING 1)`).join(',\n');
      // Numbers come from the sequence itself (so a checkout running meanwhile can never get the same one),
      // sorted and matched to the rows in createdAt order.
      const sql = `WITH "todo" AS (SELECT "t", "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "t", "id") AS "rn" FROM (${union}) AS "u"),
"nums" AS (SELECT "v", ROW_NUMBER() OVER (ORDER BY "v") AS "rn" FROM (SELECT nextval('${SEQ}') AS "v" FROM generate_series(1, (SELECT COUNT(*) FROM "todo"))) AS "g"),
"pairs" AS (SELECT "todo"."t", "todo"."id", "nums"."v" AS "n" FROM "todo" JOIN "nums" ON "nums"."rn" = "todo"."rn"),
${updates}
SELECT ${tables.map((_, i) => `(SELECT COUNT(*) FROM "u${i}")`).join(' + ')} AS "c"`;
      const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, transaction: t });
      return Number(rows && rows[0] && rows[0].c) || 0;
    });
  }

  // SQLite (dev / tests): same order, numbers from the counter row.
  return sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
    const union = tables.map((n, i) => `SELECT ${i} AS "t", "id", "createdAt" FROM "${n.table}" WHERE "orderNumber" IS NULL`).join(' UNION ALL ');
    const rows = await sequelize.query(`SELECT "t", "id" FROM (${union}) AS "u" ORDER BY "createdAt", "t", "id"`, { type: QueryTypes.SELECT, transaction: t });
    if (!rows.length) return 0;
    const nums = await sqliteCounter(sequelize, rows.length, t);
    if (nums.length !== rows.length) return 0;
    for (let i = 0; i < rows.length; i++) {
      await sequelize.query(`UPDATE "${tables[rows[i].t].table}" SET "orderNumber" = :n WHERE "id" = :id AND "orderNumber" IS NULL`,
        { replacements: { n: nums[i], id: rows[i].id }, transaction: t });
    }
    return rows.length;
  });
};

/** Postgres: moves the sequence past the highest number in use (restored / copied data). No-op when it already is. */
const catchUpSequence = async (sequelize) => {
  const rows = await sequelize.query(`SELECT "last_value", "is_called" FROM "${SEQ}"`, { type: QueryTypes.SELECT });
  const r = rows && rows[0];
  const issued = r ? (r.is_called ? Number(r.last_value) : Number(r.last_value) - 1) : 0;
  const max = await maxUsed(sequelize);
  if (max > issued) await sequelize.query(`SELECT setval('${SEQ}', GREATEST(:m, (SELECT "last_value" FROM "${SEQ}")), true)`, { replacements: { m: max } });
};

/**
 * Boot migration (every dialect, every boot; additive, idempotent, never throws): columns, sequence / counter,
 * per-table unique indexes, then the backfill. On a fresh database or when every row is numbered it costs a
 * handful of tiny statements. { recheckAfterMs }: runs the backfill once more later (a rolling deploy's old
 * instance may still create unnumbered orders while this one boots).
 */
const runOrderNumberMigrations = async (sequelize, { recheckAfterMs = 0 } = {}) => {
  const out = { ok: false, numbered: 0 };
  if (!sequelize) return out;
  const tables = presentTables(sequelize);
  if (!tables.length) return out;
  const pg = isPg(sequelize);
  try {
    for (const n of tables) {
      try {
        await sequelize.query(pg
          ? `ALTER TABLE "${n.table}" ADD COLUMN IF NOT EXISTS "orderNumber" INTEGER;`
          : `ALTER TABLE "${n.table}" ADD COLUMN "orderNumber" INTEGER;`);
      } catch { /* SQLite: already there */ }
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "${n.index}" ON "${n.table}" ("orderNumber") WHERE "orderNumber" IS NOT NULL;`);
    }
    if (pg) {
      await sequelize.query(`CREATE SEQUENCE IF NOT EXISTS "${SEQ}" AS BIGINT START WITH 1 MINVALUE 1;`);
      await catchUpSequence(sequelize);
      pgReady.set(sequelize, { ok: true, at: Date.now() });
    }
    out.numbered = await backfill(sequelize);
    out.ok = true;
    if (out.numbered) console.log(`✅ [ORDER_NUMBERS] Numbered ${out.numbered} order(s) without a ZEN number.`);
  } catch (err) {
    out.error = err.message;
    console.warn('⚠️ [ORDER_NUMBER_MIGRATION_WARN]', err.message);
  }
  if (recheckAfterMs > 0) {
    const timer = setTimeout(() => {
      backfill(sequelize)
        .then((n) => { if (n) console.log(`✅ [ORDER_NUMBERS] Numbered ${n} late order(s).`); })
        .catch((err) => console.warn('⚠️ [ORDER_NUMBER_RECHECK_WARN]', err.message));
    }, recheckAfterMs);
    if (timer.unref) timer.unref();
  }
  return out;
};

module.exports = {
  PREFIX, SEQ, COUNTER_SERIES, NUMBERED,
  codeOf, shortRef, fields, label, parseCode,
  attributes, installNumbering, installFindHook, nextNumbers, backfill, runOrderNumberMigrations,
};
