#!/usr/bin/env node
// Compares a database copy with its source (Supabase → Render Postgres move, docs/DB_MIGRATION_RUNBOOK.md).
// READ-ONLY on both sides: Postgres work runs inside `BEGIN TRANSACTION ... READ ONLY` (the server itself
// rejects any write) and every statement passes a guard that refuses anything but SELECT / SHOW / read-only
// PRAGMA; SQLite files are opened in read-only mode. Nothing is ever written.
//
//   node scripts/verify_db_copy.js --source=<url> --target=<url> [--tables=A,B] [--skip=A,B] [--json]
//   (or env SOURCE_DATABASE_URL / TARGET_DATABASE_URL)
// URLs: postgres://user:pass@host:port/db   or   sqlite:<path to file>   (SQLite is for local tests)
// SSL for Postgres follows DB_SSL (config/dbSettings.js: auto = SSL for hosts with a dot).
//
// Per table: row count, an order-independent checksum of (primary key, updatedAt) over every row, the column
// list. Then indexes (every source index must exist on the target) and sequences (target value >= source).
// Prints a PASS / FAIL table; exit code 0 = everything matches, 1 = a difference, 2 = could not run.
// Run it while the app is in maintenance (no writes), or counts of busy tables will differ by a few rows.
const path = require('path');
const crypto = require('crypto');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch { /* optional */ }

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const flag = (name) => args.includes(`--${name}`);

// ── Read-only guard ───────────────────────────────────────────────────────────────────────────────
const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|CLUSTER|LOCK|CALL|DO|SET|RESET|ATTACH|DETACH|REPLACE|COMMENT|SECURITY|REFRESH|NOTIFY|LISTEN|PREPARE|EXECUTE|DISCARD|IMPORT)\b/i;
const ALLOWED_START = /^(SELECT|WITH|SHOW|PRAGMA\s+(TABLE_INFO|INDEX_LIST)\s*\()/i;
const CONTROL = new Set(['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK']);
/** Throws unless sql is a single read-only statement. Quoted identifiers / strings are ignored for the word scan. */
const assertReadOnly = (sql) => {
  const s = String(sql).trim();
  if (CONTROL.has(s.toUpperCase())) return;
  const unquoted = s.replace(/"(?:[^"]|"")*"/g, '""').replace(/'(?:[^']|'')*'/g, "''");
  if (!ALLOWED_START.test(unquoted) || unquoted.replace(/;\s*$/, '').includes(';') || WRITE_WORDS.test(unquoted)) {
    throw new Error(`verify_db_copy refuses a non read-only statement: ${s.slice(0, 80)}`);
  }
};

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

// ── Adapters ───────────────────────────────────────────────────────────────────────────────────────
const openPg = async (url) => {
  const { Client } = require('pg');
  let host = '';
  let sslmode = '';
  let connectionString = url;
  try {
    // ?sslmode=… in the URL (handy for pg_dump) would override the ssl object below in node-postgres and
    // turn on strict certificate checks: read it, remove it, decide here.
    const u = new URL(url);
    host = u.hostname;
    sslmode = String(u.searchParams.get('sslmode') || '').toLowerCase();
    u.searchParams.delete('sslmode');
    connectionString = u.toString();
  } catch { /* ignore */ }
  let ssl = require('../config/dbSettings').getSslOptions(host);
  if (sslmode === 'disable') ssl = null;
  else if (sslmode && !ssl) ssl = { require: true, rejectUnauthorized: false };
  const client = new Client({ connectionString, ...(ssl ? { ssl } : {}), statement_timeout: 120000 });
  await client.connect();
  const run = async (sql, params = []) => { assertReadOnly(sql); return (await client.query(sql, params)).rows; };
  await run('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  return {
    kind: 'postgres',
    label: `${host.slice(0, 6)}…`,
    run,
    async tables() {
      return (await run("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")).map((r) => r.name);
    },
    async columns(t) {
      return (await run("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [t])).map((r) => r.name);
    },
    async primaryKey(t) {
      const rows = await run(`SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1) AND i.indisprimary ORDER BY a.attname`, [t]);
      return rows.map((r) => r.name);
    },
    async count(t) { return Number((await run(`SELECT COUNT(*)::bigint AS n FROM public.${q(t)}`))[0].n); },
    async page(t, cols, order, limit, offset) {
      return run(`SELECT ${cols.map(q).join(', ')} FROM public.${q(t)} ORDER BY ${order.map(q).join(', ')} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
    },
    async indexes() {
      return (await run("SELECT tablename AS t, indexname AS name FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname")).map((r) => `${r.t}.${r.name}`);
    },
    async sequences() {
      const rows = await run("SELECT sequencename AS name, COALESCE(last_value, 0)::bigint AS v FROM pg_sequences WHERE schemaname = 'public'");
      return new Map(rows.map((r) => [r.name, Number(r.v)]));
    },
    async close() { try { await client.query('ROLLBACK'); } catch { /* ignore */ } await client.end(); },
  };
};

const openSqlite = async (file) => {
  const sqlite3 = require('sqlite3');
  const db = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(path.resolve(file), sqlite3.OPEN_READONLY, (err) => (err ? reject(err) : resolve(d)));
  });
  const run = (sql, params = []) => {
    assertReadOnly(sql);
    return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
  };
  return {
    kind: 'sqlite',
    label: path.basename(file),
    run,
    async tables() {
      return (await run("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name);
    },
    async columns(t) { return (await run(`PRAGMA table_info(${q(t)})`)).map((r) => r.name); },
    async primaryKey(t) { return (await run(`PRAGMA table_info(${q(t)})`)).filter((r) => r.pk > 0).map((r) => r.name).sort(); },
    async count(t) { return Number((await run(`SELECT COUNT(*) AS n FROM ${q(t)}`))[0].n); },
    async page(t, cols, order, limit, offset) {
      return run(`SELECT ${cols.map(q).join(', ')} FROM ${q(t)} ORDER BY ${order.map(q).join(', ')} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
    },
    async indexes() {
      return (await run("SELECT tbl_name AS t, name FROM sqlite_master WHERE type = 'index' ORDER BY name")).map((r) => `${r.t}.${r.name}`);
    },
    async sequences() {
      const has = await run("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'");
      if (!has.length) return new Map();
      return new Map((await run('SELECT name, seq AS v FROM sqlite_sequence')).map((r) => [r.name, Number(r.v)]));
    },
    async close() { await new Promise((resolve) => db.close(() => resolve())); },
  };
};

const open = (url) => {
  const u = String(url || '').trim();
  if (/^sqlite:/i.test(u)) return openSqlite(u.replace(/^sqlite:(\/\/)?/i, ''));
  if (/^postgres(ql)?:\/\//i.test(u)) return openPg(u);
  throw new Error('URL must start with postgres:// (or postgresql://) or sqlite:');
};

// ── Checksums ──────────────────────────────────────────────────────────────────────────────────────
// Values normalised so the same data gives the same text on any engine / driver.
const norm = (v) => {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'bad-date' : v.toISOString();
  if (Buffer.isBuffer(v)) return `b:${crypto.createHash('sha1').update(v).digest('hex')}`;
  if (typeof v === 'string') {
    // SQLite keeps dates as text: '2026-10-18 10:15:00.000 +00:00'
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?( ?(Z|[+-]\d{2}:?\d{2}))?$/.test(v)) {
      const d = new Date(v.replace(' ', 'T').replace(/ ([+-])/, '$1'));
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return v;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Order-independent checksum: sum (mod 2^64) of the first 8 bytes of sha256(row) + row count. */
const tableChecksum = async (db, t, keyCols, orderCols, pageSize = 5000) => {
  let sum = 0n;
  let n = 0;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await db.page(t, keyCols, orderCols, pageSize, offset);
    for (const r of rows) {
      const text = keyCols.map((c) => norm(r[c])).join('\u0001');
      sum = (sum + crypto.createHash('sha256').update(text).digest().readBigUInt64BE(0)) & 0xffffffffffffffffn;
      n++;
    }
    if (rows.length < pageSize) break;
  }
  return { checksum: `${n}:${sum.toString(16).padStart(16, '0')}`, rows: n };
};

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────
const pad = (s, n) => (String(s).length >= n ? String(s).slice(0, n) : String(s) + ' '.repeat(n - String(s).length));

const verify = async ({ source, target, tables: onlyTables = null, skip = [], out = console.log, json = false } = {}) => {
  if (!source || !target) throw new Error('Pass --source=<url> and --target=<url> (or SOURCE_DATABASE_URL / TARGET_DATABASE_URL).');
  if (String(source).trim() === String(target).trim()) throw new Error('source and target are the same database.');
  const src = await open(source);
  const dst = await open(target);
  const results = [];
  let ok = true;
  try {
    const srcTables = await src.tables();
    const dstTables = new Set(await dst.tables());
    const list = srcTables.filter((t) => (!onlyTables || onlyTables.includes(t)) && !skip.includes(t));
    for (const t of list) {
      const row = { table: t, srcRows: null, dstRows: null, checksum: '', result: 'PASS', note: '' };
      if (!dstTables.has(t)) {
        Object.assign(row, { result: 'FAIL', note: 'missing on target' });
        results.push(row); ok = false; continue;
      }
      const [sCols, dCols] = [await src.columns(t), await dst.columns(t)];
      const missingCols = sCols.filter((c) => !dCols.includes(c));
      const pk = await src.primaryKey(t);
      const keyCols = [...(pk.length ? pk : []), ...(sCols.includes('updatedAt') ? ['updatedAt'] : [])];
      row.srcRows = await src.count(t);
      row.dstRows = await dst.count(t);
      if (missingCols.length) { row.result = 'FAIL'; row.note = `columns missing on target: ${missingCols.join(', ')}`; }
      if (row.srcRows !== row.dstRows) { row.result = 'FAIL'; row.note = [row.note, 'row count differs'].filter(Boolean).join('; '); }
      if (pk.length) {
        const [a, b] = [await tableChecksum(src, t, keyCols, pk), await tableChecksum(dst, t, keyCols, pk)];
        row.checksum = a.checksum === b.checksum ? `match (${keyCols.join('+')})` : 'DIFFERENT';
        if (a.checksum !== b.checksum) { row.result = 'FAIL'; row.note = [row.note, 'pk/updatedAt checksum differs'].filter(Boolean).join('; '); }
      } else {
        row.checksum = 'n/a (no primary key)';
      }
      if (row.result !== 'PASS') ok = false;
      results.push(row);
    }
    const extra = [...dstTables].filter((t) => !srcTables.includes(t));

    const [si, di] = [await src.indexes(), new Set(await dst.indexes())];
    const missingIdx = si.filter((i) => !di.has(i) && (!onlyTables || onlyTables.includes(i.split('.')[0])) && !skip.includes(i.split('.')[0]));
    if (missingIdx.length) ok = false;

    const [ss, ds] = [await src.sequences(), await dst.sequences()];
    const seqProblems = [];
    for (const [name, v] of ss) {
      if (!ds.has(name)) seqProblems.push(`${name}: missing on target`);
      else if (ds.get(name) < v) seqProblems.push(`${name}: target ${ds.get(name)} < source ${v} (run setval)`);
    }
    if (seqProblems.length) ok = false;

    const report = { ok, source: src.label, target: dst.label, tables: results, extraTablesOnTarget: extra, missingIndexes: missingIdx, sequenceProblems: seqProblems, indexesChecked: si.length, sequencesChecked: ss.size };
    if (json) out(JSON.stringify(report, null, 2));
    else {
      out(`verify_db_copy: ${src.kind} ${src.label}  →  ${dst.kind} ${dst.label}   (read-only)`);
      out(`${pad('TABLE', 34)} ${pad('SOURCE', 10)} ${pad('TARGET', 10)} ${pad('CHECKSUM', 30)} RESULT`);
      for (const r of results) out(`${pad(r.table, 34)} ${pad(r.srcRows ?? '-', 10)} ${pad(r.dstRows ?? '-', 10)} ${pad(r.checksum, 30)} ${r.result}${r.note ? `  ${r.note}` : ''}`);
      out(`indexes: ${si.length} on source, ${missingIdx.length ? `MISSING on target: ${missingIdx.join(', ')}` : 'all present on target'}  ${missingIdx.length ? 'FAIL' : 'PASS'}`);
      out(`sequences: ${ss.size} on source, ${seqProblems.length ? seqProblems.join('; ') : 'target >= source for all'}  ${seqProblems.length ? 'FAIL' : 'PASS'}`);
      if (extra.length) out(`note: tables only on target (not a failure): ${extra.join(', ')}`);
      out(ok ? 'RESULT: PASS — the copy matches the source.' : 'RESULT: FAIL — do NOT switch DATABASE_URL yet.');
    }
    return report;
  } finally {
    await src.close().catch(() => {});
    await dst.close().catch(() => {});
  }
};

if (require.main === module) {
  const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);
  verify({
    source: opt('source', process.env.SOURCE_DATABASE_URL),
    target: opt('target', process.env.TARGET_DATABASE_URL),
    tables: list(opt('tables', '')),
    skip: list(opt('skip', '')) || [],
    json: flag('json'),
  }).then((r) => { process.exitCode = r.ok ? 0 : 1; }).catch((err) => {
    console.error('verify_db_copy could not run:', err.message);
    process.exitCode = 2;
  });
}

module.exports = { verify, assertReadOnly, norm, tableChecksum };
