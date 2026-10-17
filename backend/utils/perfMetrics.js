// Lightweight server-side performance metrics (P1).
//
// • middleware()               per request: total time, DB time, DB query count, pool wait (AsyncLocalStorage).
//                              Adds `Server-Timing: app;dur=…, db;dur=…;desc="N queries"` to every response.
// • instrumentSequelize(db)    beforeQuery/afterQuery hooks + timed pool acquire. Also the dev-only
//                              artificial latency (DEV_DB_LATENCY_MS) used to reproduce a far-away DB.
// • snapshot()                 JSON for GET /api/admin/metrics/perf (admin only).
// • startLogger()              one `[PERF] …` line every 60 s when there was traffic (PERF_LOG=0 disables).
//
// Overhead: one AsyncLocalStorage.run + a few hrtime reads per request, two per query. Per-route
// samples live in fixed rings (RING samples), percentiles are only computed when read.

const { AsyncLocalStorage } = require('async_hooks');
const { monitorEventLoopDelay, performance } = require('perf_hooks');

const als = new AsyncLocalStorage();
const RING = 512;
const MAX_ROUTES = 300;
const LOG_EVERY_MS = 60 * 1000;
const startedAt = Date.now();

const nowMs = () => performance.now();

// ── per-route stats ───────────────────────────────────────────────────────────
const newRoute = () => ({
  count: 0, s5xx: 0, s4xx: 0, sumMs: 0, sumDbMs: 0, sumQueries: 0, sumPoolWaitMs: 0, maxMs: 0,
  ring: new Float64Array(RING), dbRing: new Float64Array(RING), qRing: new Uint16Array(RING), n: 0,
  win: { count: 0, sumMs: 0 },
});
const routes = new Map();
const totals = { count: 0, sumMs: 0, sumDbMs: 0, sumQueries: 0, ring: new Float64Array(RING * 4), n: 0 };
const window = { count: 0, sumMs: 0, sumDbMs: 0, sumQueries: 0, s5xx: 0, ring: new Float64Array(RING * 4), n: 0, poolWaitMax: 0, poolWaitingMax: 0 };
const background = { queries: 0, dbMs: 0 }; // queries outside any HTTP request (jobs, sockets, startup)

const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM_SEG = /^\d+$/;
const HEXISH_SEG = /^[0-9a-f]{16,}$/i;
// Route template when Express matched one (/api/users/restaurants/:id), else the path with id-like
// segments collapsed, so the map never grows with ids.
const routeKey = (req) => {
  if (req.route && req.route.path && typeof req.route.path === 'string') {
    return `${req.method} ${(req.baseUrl || '') + req.route.path}`;
  }
  const p = String(req.originalUrl || req.url || '').split('?')[0];
  const segs = p.split('/').slice(0, 6).map((s) => (UUID_SEG.test(s) || NUM_SEG.test(s) || HEXISH_SEG.test(s) ? ':id' : (s.length > 40 ? ':x' : s)));
  return `${req.method} ${segs.join('/')}${req.route ? '' : ' (unmatched)'}`;
};

const recordRoute = (key, ms, ctx, status) => {
  let r = routes.get(key);
  if (!r) {
    if (routes.size >= MAX_ROUTES) key = 'OTHER';
    r = routes.get(key);
    if (!r) { r = newRoute(); routes.set(key, r); }
  }
  r.count++;
  if (status >= 500) r.s5xx++; else if (status >= 400) r.s4xx++;
  r.sumMs += ms; r.sumDbMs += ctx.dbMs; r.sumQueries += ctx.queries; r.sumPoolWaitMs += ctx.poolWaitMs;
  if (ms > r.maxMs) r.maxMs = ms;
  const i = r.n++ % RING;
  r.ring[i] = ms; r.dbRing[i] = ctx.dbMs; r.qRing[i] = Math.min(65535, ctx.queries);
  r.win.count++; r.win.sumMs += ms;

  totals.count++; totals.sumMs += ms; totals.sumDbMs += ctx.dbMs; totals.sumQueries += ctx.queries;
  totals.ring[totals.n++ % totals.ring.length] = ms;
  window.count++; window.sumMs += ms; window.sumDbMs += ctx.dbMs; window.sumQueries += ctx.queries;
  if (status >= 500) window.s5xx++;
  window.ring[window.n++ % window.ring.length] = ms;
  if (ctx.poolWaitMs > window.poolWaitMax) window.poolWaitMax = ctx.poolWaitMs;
};

const pct = (arr, len, p) => {
  if (!len) return 0;
  const a = Array.from(arr.subarray ? arr.subarray(0, len) : arr.slice(0, len)).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))];
};
const r1 = (n) => Math.round(n * 10) / 10;

// ── middleware ────────────────────────────────────────────────────────────────
const middleware = () => (req, res, next) => {
  const ctx = { t0: nowMs(), dbMs: 0, queries: 0, poolWaitMs: 0 };
  req._perf = ctx;
  // Server-Timing must be set before the head goes out: patch this response's writeHead once.
  const origWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(...args) {
    res.writeHead = origWriteHead;
    try {
      if (!res.headersSent) {
        const app = nowMs() - ctx.t0;
        res.setHeader('Server-Timing', `app;dur=${r1(app)}, db;dur=${r1(ctx.dbMs)};desc="${ctx.queries} queries"`);
      }
    } catch { /* never break a response for a header */ }
    return origWriteHead.apply(this, args);
  };
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { recordRoute(routeKey(req), nowMs() - ctx.t0, ctx, res.statusCode || 0); } catch { /* metrics never break requests */ }
  };
  res.once('finish', finish);
  res.once('close', finish);
  als.run(ctx, next);
};

// ── Sequelize instrumentation ─────────────────────────────────────────────────
const isProd = () => process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

// Dev-only artificial round-trip latency per query (reproduces a far-away DB on a local SQLite/Postgres).
// Refused in production. Set from env DEV_DB_LATENCY_MS at boot, or later with setDevDbLatencyMs(ms).
let devLatency = 0;
const setDevDbLatencyMs = (raw) => {
  const n = Math.max(0, Math.min(5000, Number(raw) || 0));
  if (n > 0 && isProd()) {
    console.error('[PERF] DEV_DB_LATENCY_MS is ignored in production.');
    devLatency = 0;
    return 0;
  }
  if (n > 0 && n !== devLatency) console.warn(`[PERF] DEV ONLY: adding ${n} ms artificial latency to every DB query.`);
  devLatency = n;
  return n;
};
setDevDbLatencyMs(process.env.DEV_DB_LATENCY_MS);

// Simple FIFO semaphore. With the dev latency on SQLite (no real pool) it plays the Postgres pool
// (DB_POOL_MAX slots, each held for the query's simulated round trip), so pool saturation reproduces.
const makeSemaphore = (max) => {
  let free = max;
  const q = [];
  return {
    acquire: () => (free > 0 ? (free--, Promise.resolve()) : new Promise((r) => q.push(r))),
    release: () => { const n = q.shift(); if (n) n(); else free++; },
    stats: () => ({ size: max, max, available: free, using: max - free, waiting: q.length }),
  };
};
let devPool = null;
let isSqlite = false;

const instrumentSequelize = (sequelize) => {
  if (!sequelize || sequelize.__perfInstrumented) return sequelize;
  sequelize.__perfInstrumented = true;
  isSqlite = sequelize.getDialect() === 'sqlite';
  if (isSqlite && !devPool) {
    const max = (() => { try { return require('../config/dbSettings').getPoolConfig().max; } catch { return 20; } })();
    devPool = makeSemaphore(max);
  }

  sequelize.addHook('beforeQuery', async (options, query) => {
    if (devLatency > 0) {
      if (isSqlite && devPool) {
        const w0 = nowMs();
        await devPool.acquire();
        query.__perfSlot = true;
        const ctx = als.getStore();
        const waited = nowMs() - w0;
        if (ctx) ctx.poolWaitMs += waited;
        if (waited > window.poolWaitMax) window.poolWaitMax = waited;
        const st = devPool.stats();
        if (st.waiting > window.poolWaitingMax) window.poolWaitingMax = st.waiting;
      }
      query.__perfT0 = nowMs();
      await new Promise((r) => setTimeout(r, devLatency)); // holds the connection like a network round trip
      return;
    }
    query.__perfT0 = nowMs();
  });
  sequelize.addHook('afterQuery', (options, query) => {
    if (!query) return;
    if (query.__perfSlot) { query.__perfSlot = false; devPool.release(); }
    const t0 = query.__perfT0;
    if (t0 === undefined) return;
    const ms = nowMs() - t0;
    const ctx = als.getStore();
    if (ctx) { ctx.dbMs += ms; ctx.queries++; } else { background.queries++; background.dbMs += ms; }
  });

  // Real pool (Postgres): time the acquire per request and track the waiting queue.
  const cm = sequelize.connectionManager;
  if (!isSqlite && cm && typeof cm.getConnection === 'function') {
    const origGet = cm.getConnection.bind(cm);
    cm.getConnection = async (options) => {
      const t0 = nowMs();
      const p0 = cm.pool;
      const waitingNow = p0 && typeof p0.waiting === 'number' ? p0.waiting : 0;
      if (waitingNow > window.poolWaitingMax) window.poolWaitingMax = waitingNow;
      const conn = await origGet(options);
      const waited = nowMs() - t0;
      const ctx = als.getStore();
      if (ctx) ctx.poolWaitMs += waited;
      if (waited > window.poolWaitMax) window.poolWaitMax = waited;
      return conn;
    };
  }
  return sequelize;
};

const poolStats = () => {
  if (isSqlite) return devPool && devLatency > 0 ? { ...devPool.stats(), simulated: true } : null;
  try {
    const db = require('../config/db').getSequelize();
    const p = db && db.connectionManager && db.connectionManager.pool;
    if (!p || !('size' in p) || db.getDialect() === 'sqlite') return null;
    return { size: p.size, available: p.available, using: p.using, waiting: p.waiting, max: p.maxSize };
  } catch { return null; }
};

// ── event loop + CPU ──────────────────────────────────────────────────────────
let eld = null;
try { eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable(); } catch { eld = null; }
let lastCpu = process.cpuUsage();
let lastCpuAt = nowMs();
let lastElu = performance.eventLoopUtilization ? performance.eventLoopUtilization() : null;
const loopStats = (reset) => {
  const out = {};
  if (eld) {
    out.lagMeanMs = r1(eld.mean / 1e6);
    out.lagP50Ms = r1(eld.percentile(50) / 1e6);
    out.lagP99Ms = r1(eld.percentile(99) / 1e6);
    out.lagMaxMs = r1(eld.max / 1e6);
    if (reset) eld.reset();
  }
  const cpu = process.cpuUsage(lastCpu);
  const wall = nowMs() - lastCpuAt;
  out.cpuMs = r1((cpu.user + cpu.system) / 1000);
  out.cpuPct = wall > 0 ? r1(((cpu.user + cpu.system) / 1000 / wall) * 100) : 0;
  out.wallMs = Math.round(wall);
  if (lastElu && performance.eventLoopUtilization) {
    const e = performance.eventLoopUtilization(lastElu);
    out.eventLoopUtilization = Math.round(e.utilization * 1000) / 1000;
    if (reset) lastElu = performance.eventLoopUtilization();
  }
  if (reset) { lastCpu = process.cpuUsage(); lastCpuAt = nowMs(); }
  return out;
};

const routeSummary = (key, r) => {
  const len = Math.min(r.n, RING);
  return {
    route: key,
    count: r.count,
    s4xx: r.s4xx,
    s5xx: r.s5xx,
    avgMs: r1(r.sumMs / Math.max(1, r.count)),
    p50Ms: r1(pct(r.ring, len, 50)),
    p95Ms: r1(pct(r.ring, len, 95)),
    maxMs: r1(r.maxMs),
    dbAvgMs: r1(r.sumDbMs / Math.max(1, r.count)),
    dbP95Ms: r1(pct(r.dbRing, len, 95)),
    queriesAvg: r1(r.sumQueries / Math.max(1, r.count)),
    poolWaitAvgMs: r1(r.sumPoolWaitMs / Math.max(1, r.count)),
  };
};

// GET /api/admin/metrics/perf. Loop/CPU figures are since the previous [PERF] line (or start).
const snapshot = () => {
  const list = Array.from(routes.entries()).map(([k, r]) => routeSummary(k, r)).sort((a, b) => b.count - a.count);
  const tl = Math.min(totals.n, totals.ring.length);
  let cache = null;
  try { cache = require('./responseCache').stats(); } catch { cache = null; }
  // B1: which instance answered, and the Redis layer's health (never the URL / password).
  let instanceId = null;
  let redisInfo = null;
  try {
    const redis = require('./redis');
    instanceId = redis.INSTANCE_ID;
    redisInfo = {
      ...redis.status(),
      socketAdapter: require('./socketCluster').isClustered(),
      cacheBus: require('./cacheBus').status(),
      rateLimits: require('./sharedRateLimit').status(),
    };
  } catch { redisInfo = null; }
  return {
    since: new Date(startedAt).toISOString(),
    uptimeS: Math.round(process.uptime()),
    pid: process.pid,
    instanceId,
    redis: redisInfo,
    totals: {
      requests: totals.count,
      avgMs: r1(totals.sumMs / Math.max(1, totals.count)),
      p50Ms: r1(pct(totals.ring, tl, 50)),
      p95Ms: r1(pct(totals.ring, tl, 95)),
      dbAvgMs: r1(totals.sumDbMs / Math.max(1, totals.count)),
      queriesPerRequest: r1(totals.sumQueries / Math.max(1, totals.count)),
    },
    window: { requests: window.count, poolWaitMaxMs: r1(window.poolWaitMax), poolWaitingMax: window.poolWaitingMax },
    background,
    eventLoop: loopStats(false),
    pool: poolStats(),
    memory: (() => { const m = process.memoryUsage(); return { rssMb: Math.round(m.rss / 1048576), heapUsedMb: Math.round(m.heapUsed / 1048576) }; })(),
    responseCache: cache,
    devDbLatencyMs: devLatency,
    routes: list,
  };
};

const resetRoutes = () => { routes.clear(); };

// One line per minute (only after traffic): rps, latency, DB, CPU, event loop, pool, slowest routes.
let logTimer = null;
const logLine = () => {
  const loop = loopStats(true);
  const w = window;
  if (!w.count) return null;
  const len = Math.min(w.n, w.ring.length);
  const secs = Math.max(1, loop.wallMs / 1000);
  const top = Array.from(routes.entries())
    .filter(([, r]) => r.win.count > 0)
    .sort((a, b) => b[1].win.sumMs - a[1].win.sumMs)
    .slice(0, 3)
    .map(([k, r]) => `${k.replace(/^GET /, '')}=${r.win.count}x${Math.round(r.win.sumMs / r.win.count)}ms`);
  const p = poolStats();
  const line = `[PERF] ${Math.round(secs)}s req=${w.count} rps=${r1(w.count / secs)} p50=${Math.round(pct(w.ring, len, 50))}ms p95=${Math.round(pct(w.ring, len, 95))}ms`
    + ` db=${Math.round(w.sumDbMs / w.count)}ms/req q=${r1(w.sumQueries / w.count)}/req 5xx=${w.s5xx}`
    + ` cpu=${loop.cpuPct}% cpu/req=${r1(loop.cpuMs / w.count)}ms elu=${loop.eventLoopUtilization ?? 'n/a'} lag_p99=${loop.lagP99Ms ?? 'n/a'}ms lag_max=${loop.lagMaxMs ?? 'n/a'}ms`
    + (p ? ` pool=${p.using}/${p.max || p.size} waiting_max=${w.poolWaitingMax} wait_max=${Math.round(w.poolWaitMax)}ms` : '')
    + ` bgq=${background.queries} top=${top.join(',')}`;
  for (const r of routes.values()) r.win = { count: 0, sumMs: 0 };
  window.count = 0; window.sumMs = 0; window.sumDbMs = 0; window.sumQueries = 0; window.s5xx = 0; window.n = 0;
  window.poolWaitMax = 0; window.poolWaitingMax = 0;
  background.queries = 0; background.dbMs = 0;
  return line;
};
const startLogger = () => {
  if (logTimer || process.env.PERF_LOG === '0') return;
  const every = Math.max(5000, Number(process.env.PERF_LOG_MS) || LOG_EVERY_MS);
  logTimer = setInterval(() => {
    try { const l = logLine(); if (l) console.log(l); } catch { /* never crash on a log */ }
  }, every);
  if (logTimer.unref) logTimer.unref();
};
const stopLogger = () => { if (logTimer) clearInterval(logTimer); logTimer = null; };

// Infra switch-over view for GET /api/admin/metrics/perf: instance, Redis, DB host kind + a fresh measured
// round trip (one SELECT 1, 2 s cap), media storage driver, public URL settings. No secrets.
const infraSnapshot = async () => {
  const out = { instanceId: null, redis: 'off', db: null, mediaStorage: null, publicUrls: null, edgeCache: null, trustCloudflare: false };
  try {
    const redis = require('./redis');
    out.instanceId = redis.INSTANCE_ID;
    out.redis = redis.isConfigured() ? (redis.isReady() ? 'ok' : 'down') : 'off';
  } catch { /* optional */ }
  try {
    const dbSettings = require('../config/dbSettings');
    const sequelize = require('../config/db').getSequelize();
    let roundTripMs = null;
    let error = null;
    if (sequelize) {
      const t0 = process.hrtime.bigint();
      let timer = null;
      try {
        await Promise.race([
          sequelize.query('SELECT 1'),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after 2000 ms')), 2000); }),
        ]);
        roundTripMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
      } catch (e) { error = String(e.message || e).slice(0, 120); } finally { if (timer) clearTimeout(timer); }
    }
    let cachedPingMs = null;
    try { cachedPingMs = (await require('./lifecycle').getDbStatus()).latencyMs; } catch { /* optional */ }
    out.db = {
      dialect: sequelize ? sequelize.getDialect() : null,
      hostType: dbSettings.dbHostType(),
      pooler: dbSettings.dbPoolerMode(),
      ssl: dbSettings.sslMode(),
      roundTripMs,
      cachedPingMs,
      ...(error ? { error } : {}),
    };
  } catch { /* optional */ }
  try { out.mediaStorage = require('./mediaStorage').status(); } catch { /* optional */ }
  try {
    const pu = require('./publicUrl');
    out.publicUrls = { apiBaseUrl: pu.envBase('PUBLIC_API_URL') || null, webUrl: pu.webBase() || null, advertised: !!pu.advertisedEndpoints().apiBaseUrl };
  } catch { /* optional */ }
  try { const ch = require('./cacheHeaders').current(); out.edgeCache = ch.enabled ? { sMaxAge: ch.sMaxAge, swr: ch.swr, groups: Array.from(ch.groups) } : null; } catch { /* optional */ }
  out.trustCloudflare = ['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_CLOUDFLARE || '').trim().toLowerCase());
  return out;
};

module.exports = { middleware, instrumentSequelize, setDevDbLatencyMs, snapshot, infraSnapshot, startLogger, stopLogger, logLine, resetRoutes, poolStats, routeKey, _als: als };
