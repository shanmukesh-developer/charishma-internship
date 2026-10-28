// Sequelize pool + Postgres per-connection timeouts, read from the environment (A4).
//
//   DB_POOL_MAX              max connections per process          default 20   (same as before; lower after the load test)
//   DB_POOL_MIN              warm connections kept open            default 4    (28 Oct live load test: with 0, every
//                            burst opened new TLS connections to a database ~180 ms away and waited up to 2.4 s)
//   DB_POOL_ACQUIRE_MS       wait for a free connection, then fail default 10000 (was 60000)
//   DB_POOL_IDLE_MS          close an extra (above min) connection idle this long   default 600000 (was 30000:
//                            connections opened for a burst were dropped 30 s later and reopened on the next one)
//   DB_POOL_EVICT_MS         idle sweep interval                   default 10000 (unchanged)
//   DB_STATEMENT_TIMEOUT_MS  Postgres statement_timeout per conn   default 30000 (same as before); 0 = off
//
// statement_timeout and idle_in_transaction_session_timeout (fixed 30 s: utils/jobs.js relies on it and
// raises it for its lock transaction with SET LOCAL) are passed as node-postgres connection options,
// i.e. sent in the connection's startup packet: no session-level SET is ever issued, so nothing can leak
// to other clients behind a transaction-mode pooler (PgBouncer / Supavisor port 6543). This is the same
// mechanism the backend has always used (dialectOptions.statement_timeout = 30000), only the value moves.
// Work that legitimately runs longer raises the limit for itself only: SET LOCAL inside its own
// transaction (withStatementTimeout below), or its own connection (scripts/ensure_indexes.js).
const DEFAULTS = Object.freeze({
  poolMax: 20,
  poolMin: 4,
  acquireMs: 10000,
  idleMs: 10 * 60 * 1000,
  evictMs: 10000,
  statementTimeoutMs: 30000,
  idleInTransactionMs: 30000,
});

// Non-negative integer from env, else the default (garbage / negative values never break the pool).
const intEnv = (env, key, def, { min = 0 } = {}) => {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < min) return def;
  return Math.floor(n);
};

const getPoolConfig = (env = process.env) => {
  const max = intEnv(env, 'DB_POOL_MAX', DEFAULTS.poolMax, { min: 1 });
  const min = Math.min(intEnv(env, 'DB_POOL_MIN', DEFAULTS.poolMin), max);
  return {
    max,
    min,
    acquire: intEnv(env, 'DB_POOL_ACQUIRE_MS', DEFAULTS.acquireMs, { min: 1 }),
    idle: intEnv(env, 'DB_POOL_IDLE_MS', DEFAULTS.idleMs, { min: 1 }),
    evict: intEnv(env, 'DB_POOL_EVICT_MS', DEFAULTS.evictMs, { min: 1 }),
  };
};

/** Statement timeout in ms (0 = off). */
const getStatementTimeoutMs = (env = process.env) => intEnv(env, 'DB_STATEMENT_TIMEOUT_MS', DEFAULTS.statementTimeoutMs);

/** Postgres timeout connection options for Sequelize dialectOptions (merged with ssl by the caller). */
const getPgTimeoutOptions = (env = process.env) => {
  // keepAlive: TCP keep-alive on every connection, so the warm ones kept open (DB_POOL_MIN) are not
  // silently dropped by NAT / load balancers between the server and the database while idle.
  const opts = { idle_in_transaction_session_timeout: DEFAULTS.idleInTransactionMs, keepAlive: true, keepAliveInitialDelayMillis: 10000 };
  const st = getStatementTimeoutMs(env);
  if (st > 0) opts.statement_timeout = st; // 0 = not sent at all: the server / role default applies
  return opts;
};

/**
 * Run fn(t) inside a transaction whose statement_timeout is raised (or lowered) to ms for that
 * transaction only (SET LOCAL: transaction scoped, safe behind transaction-mode poolers). On any other
 * dialect fn(null) runs as is. Rethrows fn's error after rolling back.
 */
const withStatementTimeout = async (sequelize, ms, fn) => {
  if (!sequelize || typeof sequelize.getDialect !== 'function' || sequelize.getDialect() !== 'postgres') return fn(null);
  const value = Math.max(0, Math.floor(Number(ms) || 0));
  return sequelize.transaction(async (t) => {
    await sequelize.query(`SET LOCAL statement_timeout = ${value}`, { transaction: t });
    return fn(t);
  });
};

// ── SSL (DB_SSL) ─────────────────────────────────────────────────────────────────────────────────
//   auto     (default, unchanged) SSL without certificate check for every host with a dot (Supabase,
//            Render external URL, ...); no SSL for a host without a dot (Render internal URL dpg-xxxx-a,
//            which refuses SSL). This is exactly what config/db.js always did.
//   disable  never SSL (a local Postgres, or a private network that refuses SSL under another name)
//   require  always SSL, no certificate check
//   verify   always SSL with certificate check; DB_SSL_CA = the CA certificate PEM (literal, \n allowed)
// Unknown values fall back to auto.
const sslMode = (env = process.env) => {
  const m = String(env.DB_SSL || '').trim().toLowerCase();
  return ['auto', 'disable', 'require', 'verify'].includes(m) ? m : 'auto';
};

/** dialectOptions.ssl for a host (null = no SSL). isInternal: host has no dot (Render private network). */
const getSslOptions = (hostname, env = process.env) => {
  const mode = sslMode(env);
  const internal = !String(hostname || '').includes('.');
  if (mode === 'disable') return null;
  if (mode === 'verify') {
    const ca = String(env.DB_SSL_CA || '').replace(/\\n/g, '\n').trim();
    return ca ? { require: true, rejectUnauthorized: true, ca } : { require: true, rejectUnauthorized: true };
  }
  if (mode === 'require') return { require: true, rejectUnauthorized: false };
  return internal ? null : { require: true, rejectUnauthorized: false };
};

/**
 * Kind of database host, for health / metrics (never the URL or a secret):
 * 'supabase' | 'render' | 'local' | 'other' | 'sqlite' (no DATABASE_URL).
 */
const dbHostType = (dbUrl = process.env.DATABASE_URL) => {
  if (!dbUrl) return 'sqlite';
  let host = '';
  try { host = new URL(String(dbUrl)).hostname.toLowerCase(); } catch { return 'other'; }
  if (!host) return 'other';
  if (host.endsWith('.supabase.co') || host.endsWith('.supabase.com')) return 'supabase';
  if (/^dpg-[a-z0-9-]+$/.test(host) || host.endsWith('.render.com')) return 'render';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
  return 'other';
};

/** Supabase pooler mode from the port: 6543 = transaction pooler, 5432 = session / direct. */
const dbPoolerMode = (dbUrl = process.env.DATABASE_URL) => {
  try {
    const u = new URL(String(dbUrl || ''));
    if (!/pooler\.supabase\.com$/i.test(u.hostname)) return null;
    return u.port === '6543' ? 'transaction' : 'session';
  } catch { return null; }
};

/** One line for the boot log (no secrets). */
const describe = (env = process.env) => {
  const p = getPoolConfig(env);
  const st = getStatementTimeoutMs(env);
  return `pool max=${p.max} min=${p.min} acquire=${p.acquire}ms idle=${p.idle}ms evict=${p.evict}ms; statement_timeout=${st > 0 ? `${st}ms` : 'off'}; idle_in_transaction_session_timeout=${DEFAULTS.idleInTransactionMs}ms; ssl=${sslMode(env)}; host=${dbHostType(env.DATABASE_URL)}`;
};

module.exports = { DEFAULTS, intEnv, getPoolConfig, getStatementTimeoutMs, getPgTimeoutOptions, withStatementTimeout, describe, sslMode, getSslOptions, dbHostType, dbPoolerMode };
