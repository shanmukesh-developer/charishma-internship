// Single-runner guard for scheduled / background jobs.
//
//   runExclusive(name, fn, { timeoutMs, quietWhenIdle })
//
// Render zero-downtime deploys run the OLD and NEW process side by side for a while, and we will run
// 2+ instances later. A job that writes data or sends notifications must therefore run on exactly one
// process per tick:
//  - In-process guard: if the previous run of `name` in THIS process is still going, this tick is
//    skipped (no overlapping runs of the same job in one process).
//  - Postgres: a transaction is opened on its own pooled connection and
//    `pg_try_advisory_xact_lock(<64-bit key of name>)` is taken. If another process holds it, this
//    tick is skipped (debug log). Otherwise fn() runs (with its own queries; the lock transaction is
//    NOT passed to it) while the transaction stays open, and the transaction is rolled back (which
//    releases the lock and returns the connection to the pool) when fn settles, throws or times out.
//    The lock transaction does no writes, so rollback == commit. Transaction-scoped locks also work
//    behind PgBouncer in transaction mode (session locks would not).
//    The pool sets idle_in_transaction_session_timeout = 30 s on every connection, which would kill
//    the idle lock connection under a job that runs longer than 30 s; the lock transaction raises it
//    for itself only (SET LOCAL) to timeoutMs + 60 s, so a wedged process still loses the lock.
//  - SQLite (local dev / tests, one process): in-process guard only. No transaction is opened (a
//    SQLite write transaction held open would make the job's own writes fail with SQLITE_BUSY).
//
// Timeout: after timeoutMs the DB lock is released (another process may take the next tick) and a
// warning is logged; the in-process guard stays until fn really settles, exactly like the old
// `xRunning` flags, so this process never runs two copies of the same job.
//
// Logs: real runs are logged at info level with duration + result counts ("[JOB] name ok 12 ms {...}").
// Jobs that tick every few seconds/minutes pass quietWhenIdle: their runs that changed nothing are
// logged at debug level only. Skipped ticks are debug level. Debug lines print with JOBS_DEBUG=1.
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const LOCK_IDLE_MARGIN_MS = 60 * 1000;
const inFlight = new Map(); // job name -> true while a run of it is in progress in this process

const debugEnabled = () => /^(1|true|yes|debug)$/i.test(String(process.env.JOBS_DEBUG || ''));
const debug = (...args) => { if (debugEnabled()) console.debug(...args); };

// Same 64-bit signed key for a name in every process and every deploy ('zenvy.job:' namespace).
const lockKey = (name) => crypto.createHash('sha1').update(`zenvy.job:${name}`).digest().readBigInt64BE(0).toString();

const defaultDb = () => {
  try { return require('../config/db').getSequelize(); } catch { return null; }
};

// A run "did nothing" when its result is empty / zero everywhere (used only to pick the log level).
const isIdle = (v) => {
  if (v === undefined || v === null || v === false || v === 0 || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v).every(isIdle);
  return false;
};

const summarize = (v) => {
  if (v === undefined) return '';
  let s;
  try { s = typeof v === 'object' ? JSON.stringify(v) : String(v); } catch { s = String(v); }
  return s.length > 300 ? `${s.slice(0, 297)}...` : s;
};

const TIMED_OUT = Symbol('timed out');

/**
 * Run fn() on exactly one process (Postgres) / once at a time in this process (SQLite).
 * Resolves (never rejects) to:
 *   { ran: false, skipped: 'running' | 'locked' }       this tick was skipped
 *   { ran: false, error }                                the lock could not be taken (DB error)
 *   { ran: true, ms, result }                            fn resolved
 *   { ran: true, ms, error }                             fn threw (logged)
 *   { ran: true, ms, timedOut: true }                    fn still running after timeoutMs (lock released)
 * opts.sequelize overrides the app's Sequelize instance (tests).
 */
const runExclusive = async (name, fn, opts = {}) => {
  const timeoutMs = Math.max(1, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  if (inFlight.has(name)) {
    debug(`[JOB] ${name} skipped: the previous run in this process is still running`);
    return { ran: false, skipped: 'running' };
  }
  inFlight.set(name, true); // set before any await: two calls in the same tick cannot both pass
  let keepGuard = false;
  let release = async () => {};

  try {
    const db = opts.sequelize !== undefined ? opts.sequelize : defaultDb();
    const isPg = !!db && typeof db.getDialect === 'function' && db.getDialect() === 'postgres';
    // The cross-process lock only matters with more than one instance. On one instance it cost every run
    // a pooled connection held for the whole run (plus 4 round trips) while the job's own queries waited for
    // a second one: with ~9 runs a minute that starved user requests when the pool was busy.
    let multi = false;
    try { multi = require('./redis').isMultiInstance(); } catch { multi = false; }
    const useLock = isPg && (opts.sequelize !== undefined || multi || String(process.env.JOBS_LOCK || '').toLowerCase() === 'always');

    if (useLock) {
      let t;
      try {
        t = await db.transaction();
        let released = false;
        release = async () => {
          if (released) return;
          released = true;
          try { await t.rollback(); } catch (err) { console.warn(`[JOB] ${name}: releasing the lock failed: ${err.message}`); }
        };
        const idleMs = Math.floor(timeoutMs + LOCK_IDLE_MARGIN_MS);
        await db.query(`SET LOCAL idle_in_transaction_session_timeout = ${idleMs}`, { transaction: t });
        const [rows] = await db.query('SELECT pg_try_advisory_xact_lock(CAST(:k AS bigint)) AS got', {
          replacements: { k: lockKey(name) },
          transaction: t,
        });
        const got = !!(rows && rows[0] && (rows[0].got === true || rows[0].got === 't'));
        if (!got) {
          await release();
          debug(`[JOB] ${name} skipped: another process holds the lock`);
          return { ran: false, skipped: 'locked' };
        }
      } catch (err) {
        await release();
        // Fail OPEN: the lock itself erroring (not "held by another process") must never stop the
        // job platform-wide. Run with the in-process guard only, i.e. today's single-process behaviour.
        // Set JOBS_LOCK_FAIL_CLOSED=true to skip instead once the lock is proven on this database.
        if (String(process.env.JOBS_LOCK_FAIL_CLOSED || '').toLowerCase() === 'true') {
          console.warn(`[JOB] ${name} skipped: could not take the lock: ${err.message}`);
          return { ran: false, error: err.message };
        }
        console.warn(`[JOB] ${name}: could not take the lock (${err.message}); running without it (single-process mode)`);
        release = async () => {};
      }
    }

    const started = Date.now();
    const work = Promise.resolve().then(fn);
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      if (timer.unref) timer.unref();
    });
    const outcome = await Promise.race([
      work.then((result) => ({ result }), (error) => ({ error: error || new Error('job failed') })),
      timeout,
    ]);
    clearTimeout(timer);
    await release();
    const ms = Date.now() - started;

    if (outcome === TIMED_OUT) {
      keepGuard = true;
      console.warn(`[JOB] ${name} still running after ${ms} ms: lock released; this process starts it again only after that run ends`);
      work.then(
        () => console.warn(`[JOB] ${name} timed-out run finished after ${Date.now() - started} ms`),
        (err) => console.warn(`[JOB] ${name} timed-out run failed after ${Date.now() - started} ms: ${err && err.message}`),
      ).finally(() => inFlight.delete(name));
      return { ran: true, ms, timedOut: true };
    }
    if ('error' in outcome) {
      const msg = outcome.error && outcome.error.message ? outcome.error.message : String(outcome.error);
      console.error(`[JOB] ${name} failed after ${ms} ms: ${msg}`);
      return { ran: true, ms, error: msg };
    }
    const line = `[JOB] ${name} ok ${ms} ms ${summarize(outcome.result)}`.trimEnd();
    if (opts.quietWhenIdle && isIdle(outcome.result)) debug(line);
    else console.log(line);
    return { ran: true, ms, result: outcome.result };
  } finally {
    await release();
    if (!keepGuard) inFlight.delete(name);
  }
};

const isRunning = (name) => inFlight.has(name);
/** Names of the jobs with a run in progress in this process (incl. timed-out runs still going). */
const runningJobs = () => Array.from(inFlight.keys());

/**
 * Wait until no job run is in progress in this process, at most timeoutMs (graceful shutdown).
 * Resolves { idle: true } or { idle: false, stillRunning: [names] }. Never rejects.
 */
const waitForIdle = async (timeoutMs = 0) => {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (inFlight.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(50, Math.max(1, deadline - Date.now()))));
  }
  return inFlight.size ? { idle: false, stillRunning: runningJobs() } : { idle: true, stillRunning: [] };
};

module.exports = { runExclusive, isRunning, runningJobs, waitForIdle, lockKey, isIdle, DEFAULT_TIMEOUT_MS };
