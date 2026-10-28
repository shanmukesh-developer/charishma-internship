// Process lifecycle: readiness (cached database ping) and graceful shutdown.
//
// Health endpoints (wired in server.js, all public, never rate limited, no auth):
//   GET /livez       200 always, no database work: "the process is up and its event loop answers".
//   GET /readyz      200 only when the startup work is done (markDbReady), the cached database ping
//                    is healthy AND the process is not shutting down; 503 + small JSON otherwise.
//                    Render's healthCheckPath (render.yaml): a new instance gets traffic only once it
//                    is really ready, and an instance whose database is gone stops receiving traffic.
//   GET /api/health  unchanged shape for existing monitors / keep-alive; reads the cached ping.
//
// Database ping: one `SELECT 1` every DB_PING_INTERVAL_MS (5 s) with a DB_PING_TIMEOUT_MS (5 s) timeout,
// never one query per health request. Never two pings at once (a ping that timed out is still waited
// for before the next one starts, so a stuck pool holds at most one extra waiter). The ping counts as
// failed after DB_PING_FAILS_TO_UNREADY consecutive failures (default 6, ~30 s: a busy pool under load does
// not take the instance out of rotation) or when the last success is older than that many intervals.
//
// Graceful shutdown (SIGTERM / SIGINT, or requestShutdown() from tests / tools), bounded by
// SHUTDOWN_TIMEOUT_MS (default 25000; Render waits maxShutdownDelaySeconds before SIGKILL):
//   1. shuttingDown = true: /readyz answers 503; responses carry `Connection: close` so keep-alive
//      connections end after their current request.
//   2. HTTP: server.close() (no new connections); idle keep-alive connections are closed now and every
//      500 ms; in-flight requests finish normally.
//   3. Jobs: stopJobs() cancels every schedule and waits (bounded) for runs already in progress.
//   4. Sockets: 'server:draining' is emitted to every socket, then the engine connections are closed in
//      batches over SOCKET_DRAIN_MS (default 8000). Closing the TRANSPORT (not socket.disconnect(),
//      which clients treat as "io server disconnect" and do not retry) makes every client's built-in
//      reconnection run, so it reconnects to the new instance; batching spreads those reconnects.
//   5. When the HTTP server has closed (or the drain budget is spent: remaining connections are then
//      destroyed), the database ping stops, logs are flushed, sequelize.close() runs, and the process
//      exits with code 0. A hard-exit timer at SHUTDOWN_TIMEOUT_MS also exits 0 (logged): a signal
//      shutdown is never reported as a crash.
const { QueryTypes } = require('sequelize');

const num = (v, def, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};
const config = () => ({
  pingIntervalMs: num(process.env.DB_PING_INTERVAL_MS, 5000, 250),
  // 5 s / 6 fails (~30 s): the ping waits in the same pool as user requests, and under load a pool wait of
  // 2-3 s is normal. A 1 s timeout x 2 fails marked a busy-but-healthy instance not ready, Render pulled it
  // from rotation and restarted it, every socket dropped and reconnected at once: a restart loop under load.
  pingTimeoutMs: num(process.env.DB_PING_TIMEOUT_MS, 5000, 50),
  failsToUnready: num(process.env.DB_PING_FAILS_TO_UNREADY, 6, 1),
  shutdownTimeoutMs: num(process.env.SHUTDOWN_TIMEOUT_MS, 25000, 1000),
  socketDrainMs: num(process.env.SOCKET_DRAIN_MS, 8000, 0),
});

// ── State ─────────────────────────────────────────────────────────────────────────────────────────
let dbReady = false;
let shuttingDown = false;
let shutdownPromise = null;
let shutdownStartedAt = null;
let getDb = () => null;
let pingTimer = null;
let pingQueryPending = false;
let pingResult = null;
const ping = {
  ok: false,          // last ping result (after hysteresis)
  ran: false,         // at least one ping finished
  consecutiveFails: 0,
  lastOkAt: 0,
  lastAt: 0,
  latencyMs: null,
  error: null,
};

const withTimeout = (promise, ms, label) => {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
};

/** Run one database ping now (or join the one still running). Resolves (bounded by the timeout) to the state. */
const pingDb = () => {
  // While the previous query has not settled (even if it already timed out) no new query starts:
  // a stuck pool holds at most one ping waiter. Callers get the current ping's (bounded) result.
  if (pingQueryPending && pingResult) return pingResult;
  const cfg = config();
  const db = getDb();
  const started = Date.now();
  if (!db) {
    ping.ran = true;
    ping.ok = false;
    ping.lastAt = started;
    ping.error = 'database not initialised';
    return Promise.resolve(ping);
  }
  pingQueryPending = true;
  const query = Promise.resolve().then(() => db.query('SELECT 1 AS ok', { type: QueryTypes.SELECT, logging: false, raw: true }));
  query.then(() => { pingQueryPending = false; }, () => { pingQueryPending = false; });
  pingResult = withTimeout(query, cfg.pingTimeoutMs, 'database ping')
    .then(() => {
      ping.consecutiveFails = 0;
      ping.ok = true;
      ping.lastOkAt = Date.now();
      ping.latencyMs = ping.lastOkAt - started;
      ping.error = null;
    }, (err) => {
      ping.consecutiveFails++;
      ping.error = String((err && err.message) || err).slice(0, 200);
      if (ping.consecutiveFails >= cfg.failsToUnready || !ping.lastOkAt) {
        if (ping.ok) console.warn(`[READINESS] database ping failing (${ping.consecutiveFails}x): ${ping.error}`);
        ping.ok = false;
      }
    })
    .then(() => {
      ping.ran = true;
      ping.lastAt = Date.now();
      return ping;
    });
  return pingResult;
};

const dbHealthy = () => {
  if (!ping.ok) return false;
  const { pingIntervalMs, pingTimeoutMs, failsToUnready } = config();
  return Date.now() - ping.lastOkAt <= pingIntervalMs * Math.max(3, failsToUnready) + pingTimeoutMs;
};

/** Start the background ping loop. getSequelize: () => Sequelize | null (may be null until connectDB). */
const startDbPing = (getSequelize) => {
  if (typeof getSequelize === 'function') getDb = getSequelize;
  if (pingTimer) return;
  const { pingIntervalMs } = config();
  pingTimer = setInterval(() => { if (!shuttingDown) pingDb().catch(() => {}); }, pingIntervalMs);
  if (pingTimer.unref) pingTimer.unref();
};
const stopDbPing = () => {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
};

/** Startup finished (routes registered, migrations done): readiness may turn green. */
const markDbReady = () => {
  dbReady = true;
  pingDb().catch(() => {});
};

const isDbReady = () => dbReady;
const isShuttingDown = () => shuttingDown;
const isReady = () => dbReady && !shuttingDown && dbHealthy();

/** Cached database status for /api/health. Waits (bounded) only if no ping has finished yet. */
const getDbStatus = async () => {
  if (!ping.ran && getDb()) {
    try { await pingDb(); } catch { /* recorded */ }
  }
  return { ok: dbHealthy(), ran: ping.ran, error: ping.error, latencyMs: ping.latencyMs, lastOkAt: ping.lastOkAt };
};

const readinessReport = () => {
  const healthy = dbHealthy();
  let status = 'ready';
  if (shuttingDown) status = 'draining';
  else if (!dbReady) status = 'starting';
  else if (!healthy) status = 'db_unavailable';
  const report = {
    status,
    db: healthy ? 'ok' : (ping.ran ? 'error' : 'unknown'),
    uptime: Math.round(process.uptime()),
  };
  // B1: multi-instance mode (REDIS_URL set / INSTANCE_MODE=multi) says which instance answered.
  try {
    const redis = require('./redis');
    if (redis.isMultiInstance()) report.instance = redis.INSTANCE_ID;
  } catch { /* single instance */ }
  return report;
};

// ── Express handlers ──────────────────────────────────────────────────────────────────────────────
const noStore = (res) => res.set('Cache-Control', 'no-store');
const livezHandler = (req, res) => {
  noStore(res);
  res.status(200).json({ status: 'alive', uptime: Math.round(process.uptime()) });
};
const readyzHandler = (req, res) => {
  noStore(res);
  const report = readinessReport();
  if (report.status === 'ready') return res.status(200).json(report);
  res.set('Retry-After', shuttingDown ? '1' : '5');
  return res.status(503).json(report);
};
/** During shutdown every response asks the client to close its keep-alive connection. */
const connectionCloseWhileDraining = (req, res, next) => {
  if (shuttingDown && !res.headersSent) res.set('Connection', 'close');
  next();
};

// ── Graceful shutdown ─────────────────────────────────────────────────────────────────────────────
let deps = {
  server: null,
  io: null,
  stopJobs: null,
  flushLogs: null,
  closeDb: null,
  closeRedis: null,
  onDrainStart: null,
  exit: (code) => process.exit(code),
};

/** Wire the things shutdown must close. Call once from server.js (before installSignalHandlers). */
const configureShutdown = (opts = {}) => {
  deps = { ...deps, ...opts };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const engineClients = (io) => {
  const clients = io && io.engine && io.engine.clients;
  if (!clients) return [];
  if (clients instanceof Map) return Array.from(clients.values());
  return Object.keys(clients).map((k) => clients[k]);
};

// Emit 'server:draining', then close the engine connections in batches over drainMs. Connections that
// arrive during the drain (should be none: the listener is closed) are picked up by later batches.
const drainSockets = async (io, drainMs, deadline) => {
  if (!io || io.isNullIo || !io.engine) return { closed: 0 };
  const initial = engineClients(io).length;
  try {
    // Only THIS instance's sockets: with the Redis adapter a plain io.emit would reach every instance.
    const target = io.local && typeof io.local.emit === 'function' ? io.local : io;
    target.emit('server:draining', { reconnect: true, retryAfterMs: 1000, at: new Date().toISOString() });
  } catch (err) { console.warn('[SHUTDOWN] draining emit failed:', err.message); }
  if (!initial) return { closed: 0, initial };
  await sleep(Math.min(250, drainMs)); // let the draining event flush before the first close
  const STEP_MS = 250;
  const steps = Math.max(1, Math.floor(Math.max(0, drainMs - 250) / STEP_MS));
  const perStep = Math.max(1, Math.ceil(initial / steps));
  let closed = 0;
  for (let i = 0; i < steps && Date.now() < deadline; i++) {
    const batch = engineClients(io).filter((c) => c.readyState !== 'closed' && c.readyState !== 'closing').slice(0, perStep);
    for (const c of batch) {
      try { c.close(); closed++; } catch { /* already gone */ }
    }
    if (!engineClients(io).length) break;
    await sleep(STEP_MS);
  }
  // Whatever is left (late arrivals) closes now.
  for (const c of engineClients(io)) {
    if (c.readyState === 'closed' || c.readyState === 'closing') continue;
    try { c.close(); closed++; } catch { /* already gone */ }
  }
  return { closed, initial };
};

const closeHttp = (server, deadline) => new Promise((resolve) => {
  if (!server) return resolve({ closed: true });
  let done = false;
  let sweep = null;
  const finish = (r) => {
    if (done) return;
    done = true;
    if (sweep) clearInterval(sweep);
    resolve(r);
  };
  try {
    server.close(() => finish({ closed: true }));
  } catch (err) {
    finish({ closed: true, error: err.message });
    return;
  }
  const idle = () => { try { if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections(); } catch { /* ignore */ } };
  idle();
  sweep = setInterval(idle, 500);
  const left = Math.max(0, deadline - Date.now());
  setTimeout(() => {
    if (done) return;
    // Budget spent: destroy what is left so the database can still close cleanly before the hard exit.
    try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch { /* ignore */ }
    finish({ closed: false, forced: true });
  }, left);
});

const runShutdown = async (signal) => {
  const cfg = config();
  shutdownStartedAt = Date.now();
  const hardDeadline = shutdownStartedAt + cfg.shutdownTimeoutMs;
  const DB_CLOSE_RESERVE_MS = Math.min(3000, Math.floor(cfg.shutdownTimeoutMs / 5));
  const drainDeadline = hardDeadline - DB_CLOSE_RESERVE_MS;
  const t = () => `${Date.now() - shutdownStartedAt} ms`;

  const hard = setTimeout(() => {
    console.error(`💀 [SHUTDOWN] still not done after ${cfg.shutdownTimeoutMs} ms (SHUTDOWN_TIMEOUT_MS): exiting now (code 0)`);
    try { if (deps.flushLogs) deps.flushLogs(); } catch { /* ignore */ }
    deps.exit(0);
  }, cfg.shutdownTimeoutMs);
  if (hard.unref) hard.unref();

  console.log(`🛑 [SHUTDOWN] ${signal} received: draining (readyz 503, no new connections, jobs stopping, sockets closing over ${cfg.socketDrainMs} ms, hard exit at ${cfg.shutdownTimeoutMs} ms)`);
  try { if (deps.onDrainStart) deps.onDrainStart(); } catch (err) { console.warn('[SHUTDOWN] onDrainStart:', err.message); }

  const httpP = closeHttp(deps.server, drainDeadline).then((r) => {
    console.log(`✅ [SHUTDOWN] HTTP ${r.closed ? 'closed (in-flight requests finished)' : 'drain budget spent: remaining connections destroyed'} at ${t()}`);
    return r;
  });
  const jobsP = Promise.resolve()
    .then(() => (deps.stopJobs ? deps.stopJobs({ waitMs: Math.max(0, drainDeadline - Date.now()) }) : null))
    .then((r) => {
      const still = r && r.stillRunning && r.stillRunning.length ? ` (still running: ${r.stillRunning.join(', ')})` : '';
      console.log(`✅ [SHUTDOWN] jobs stopped at ${t()}${still}`);
      return r;
    }, (err) => { console.warn('[SHUTDOWN] stopping jobs failed:', err.message); });
  const socketsP = drainSockets(deps.io, Math.min(cfg.socketDrainMs, Math.max(0, drainDeadline - Date.now())), drainDeadline)
    .then((r) => {
      console.log(`✅ [SHUTDOWN] sockets drained at ${t()} (${r.closed || 0} connection(s) closed)`);
      return r;
    }, (err) => { console.warn('[SHUTDOWN] socket drain failed:', err.message); });

  await Promise.all([httpP, jobsP, socketsP]);

  stopDbPing();
  try { if (deps.flushLogs) deps.flushLogs(); } catch (err) { console.warn('[SHUTDOWN] log flush failed:', err.message); }
  if (deps.closeDb) {
    try {
      await withTimeout(Promise.resolve().then(() => deps.closeDb()), Math.max(500, hardDeadline - Date.now() - 200), 'sequelize.close');
      console.log(`✅ [SHUTDOWN] database closed at ${t()}`);
    } catch (err) { console.warn(`[SHUTDOWN] database close: ${err.message}`); }
  }
  if (deps.closeRedis) {
    try {
      await withTimeout(Promise.resolve().then(() => deps.closeRedis()), Math.max(300, Math.min(1500, hardDeadline - Date.now() - 100)), 'redis close');
      console.log(`✅ [SHUTDOWN] redis closed at ${t()}`);
    } catch (err) { console.warn(`[SHUTDOWN] redis close: ${err.message}`); }
  }
  clearTimeout(hard);
  console.log(`👋 [SHUTDOWN] done in ${t()}: exiting (code 0)`);
  deps.exit(0);
};

/** Start the graceful shutdown (idempotent). Resolves when shutdown finished (just before exit). */
const requestShutdown = (signal = 'manual') => {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = runShutdown(signal).catch((err) => {
    console.error('[SHUTDOWN] failed:', err && err.stack ? err.stack : err);
    deps.exit(0);
  });
  return shutdownPromise;
};

let signalsInstalled = false;
const installSignalHandlers = () => {
  if (signalsInstalled) return;
  signalsInstalled = true;
  let sigints = 0;
  process.on('SIGTERM', () => {
    if (shutdownPromise) { console.log('[SHUTDOWN] SIGTERM again: already draining'); return; }
    requestShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    sigints++;
    if (sigints > 1) { console.log('[SHUTDOWN] second SIGINT: exiting now'); deps.exit(0); return; }
    requestShutdown('SIGINT');
  });
};

const state = () => ({
  dbReady,
  shuttingDown,
  shutdownStartedAt,
  ping: { ...ping },
  ready: isReady(),
});

module.exports = {
  startDbPing,
  stopDbPing,
  pingDb,
  markDbReady,
  isDbReady,
  isShuttingDown,
  isReady,
  getDbStatus,
  readinessReport,
  livezHandler,
  readyzHandler,
  connectionCloseWhileDraining,
  configureShutdown,
  requestShutdown,
  installSignalHandlers,
  state,
};
