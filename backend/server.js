require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const { connectDB, getSequelize: getDbInstance } = require('./config/db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const morgan = require('morgan');
const { isProduction: isProductionEnv } = require('./utils/env'); // single production check (RENDER / NODE_ENV)
// PROCESS_ROLE = all (default: API + sockets + jobs) | web (API + sockets) | worker (jobs + health only).
// Scheduled jobs live in jobs/index.js and run single-runner (utils/jobs.runExclusive).
const { getProcessRole, servesApi, createNullIo } = require('./utils/processRole');
const PROCESS_ROLE = getProcessRole();
// xss-clean removed due to Express 5 query getter incompatibility; custom safeXssMiddleware used instead.

// Secret hygiene: a JWT secret that was ever committed (or is short) lets anyone forge
// customer/admin/store tokens. Shout at boot so the owner rotates it in Render env.
(() => {
  const s = process.env.JWT_SECRET || '';
  const KNOWN_LEAKED = ['super_secret_zenvy_token_2026'];
  if (s && (KNOWN_LEAKED.includes(s) || s.length < 32)) {
    console.error('🚨 [SECURITY] JWT_SECRET is weak or was committed to git. Set a random value of 32+ bytes in Render env (this signs everyone out).');
  }
  if (isProductionEnv() && !process.env.OTP_SECRET) {
    console.warn('⚠️ [SECURITY] OTP_SECRET is not set; OTP hashes fall back to JWT_SECRET. Set a separate random OTP_SECRET in Render env.');
  }
})();

// ── Global Bulletproof Shield (Prevents any Node.js Crash in Dev, Restarts in Prod) ──────────────
process.on('uncaughtException', (err) => {
  console.error('🔥 [CRITICAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  const isProd = isProductionEnv();
  if (isProd) {
    console.error('🔥 Exiting process due to uncaught exception in production...');
    process.exit(1);
  }
});

// A stray rejected promise (e.g. a fire-and-forget push or socket handler) is logged, not fatal:
// exiting here dropped every live socket, the in-memory idempotency keys and in-flight orders
// for all students at once. Truly broken state still surfaces via uncaughtException above.
process.on('unhandledRejection', (reason) => {
  console.error('🔥 [CRITICAL] Unhandled Promise Rejection:', reason && reason.stack ? reason.stack : reason);
});

// ── Async Buffered Logger (Non-Blocking) ──────────────────────
const logFile = path.join(__dirname, 'socket_debug.txt');
let logBuffer = [];
let logFlushTimer = null;
const flushLogs = () => {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.join('');
  logBuffer = [];
  fs.appendFile(logFile, batch, () => { /* fire-and-forget */ });
};
// Shutdown: write whatever is buffered synchronously (the process exits right after).
const flushLogsSync = () => {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (logBuffer.length === 0) return;
  const batch = logBuffer.join('');
  logBuffer = [];
  try { fs.appendFileSync(logFile, batch); } catch { /* best effort */ }
};
const log = (msg) => {
  logBuffer.push(`[${new Date().toISOString()}] ${msg}\n`);
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(() => { logFlushTimer = null; flushLogs(); }, 2000);
  }
};

// Surge Pricing Engine (Zone-Aware) ────────────────────────
const SURGE_WINDOW_MS = 2 * 60 * 1000;
const SURGE_THRESHOLD = 4;
const SURGE_MULTIPLIER = 1.25;

let zoneOrders = {}; // { zoneName: [timestamps] }
let activeSurgeZones = new Set();

// B1: with Redis the order count and the surge flag are shared by every instance (utils/sharedState):
// one instance wins each ON / OFF transition, announces it to every socket (Redis adapter) and tells
// the other instances through the cache bus, so all of them price the same. Without Redis (or while it
// is down) the per-process logic below is used unchanged.
const surgeShared = require('./utils/sharedState');
const surgeBus = require('./utils/cacheBus');
const setSurgeLocal = (zone, on) => { if (on) activeSurgeZones.add(zone); else activeSurgeZones.delete(zone); };
surgeBus.register('surge.state', (zone, on) => {
  if (typeof zone !== 'string') return;
  setSurgeLocal(zone, !!on);
  if (on && !zoneOrders[zone]) zoneOrders[zone] = [];
});
const checkSurgeShared = async (io, zone, now) => {
  const count = await surgeShared.surgeRecord(zone, SURGE_WINDOW_MS, now);
  if (count === null) return false; // Redis not ready: caller runs the local logic
  if (count >= SURGE_THRESHOLD) {
    const won = await surgeShared.surgeClaimOn(zone, SURGE_WINDOW_MS);
    if (!activeSurgeZones.has(zone)) setSurgeLocal(zone, true);
    if (won) {
      surgeBus.broadcast('surge.state', zone, true);
      io.emit('surge_active', { zone, multiplier: SURGE_MULTIPLIER, orderCount: count });
      log(`[SURGE] Zone ${zone} ACTIVE — ${count} orders (all instances)`);
    }
  }
  return true;
};

function checkSurgeState(io, zone = 'Amaravathi_Central') {
  if (!zoneOrders[zone]) zoneOrders[zone] = [];
  
  const now = Date.now();
  if (require('./utils/redis').isReady()) {
    zoneOrders[zone].push(now);
    zoneOrders[zone] = zoneOrders[zone].filter(t => now - t < SURGE_WINDOW_MS);
    checkSurgeShared(io, zone, now).then((handled) => {
      if (!handled) checkSurgeLocal(io, zone, Date.now(), false);
    }).catch((err) => console.warn('[SURGE_SHARED_WARN]', err.message));
    return;
  }
  checkSurgeLocal(io, zone, now, true);
}

function checkSurgeLocal(io, zone, now, push) {
  if (!zoneOrders[zone]) zoneOrders[zone] = [];
  if (push) zoneOrders[zone].push(now); // Track incoming order for this zone
  
  // Clean up old timestamps for this zone
  zoneOrders[zone] = zoneOrders[zone].filter(t => now - t < SURGE_WINDOW_MS);
  
  const count = zoneOrders[zone].length;
  const isNowSurge = count >= SURGE_THRESHOLD;
  const wasSurge = activeSurgeZones.has(zone);

  if (!wasSurge && isNowSurge) {
    activeSurgeZones.add(zone);
    io.emit('surge_active', { zone, multiplier: SURGE_MULTIPLIER, orderCount: count });
    log(`[SURGE] Zone ${zone} ACTIVE — ${count} orders`);
  } else if (wasSurge && !isNowSurge) {
    activeSurgeZones.delete(zone);
    io.emit('surge_ended', { zone });
    log(`[SURGE] Zone ${zone} ENDED`);
  }
}

// Periodic cleanup and check for all zones
setInterval(() => {
  const now = Date.now();
  if (require('./utils/redis').isReady()) {
    // Shared: end a zone's surge once the order count across all instances dropped (one instance wins).
    Object.keys(zoneOrders).forEach((zone) => {
      zoneOrders[zone] = zoneOrders[zone].filter(t => now - t < SURGE_WINDOW_MS);
      (async () => {
        const count = await surgeShared.surgeCount(zone, SURGE_WINDOW_MS, now);
        if (count === null) return;
        if (count >= SURGE_THRESHOLD) {
          if (!activeSurgeZones.has(zone) && await surgeShared.surgeIsOn(zone)) setSurgeLocal(zone, true);
          return;
        }
        const wasOn = activeSurgeZones.has(zone);
        const ended = await surgeShared.surgeClaimOff(zone);
        if (ended === null) return;
        if (wasOn || ended) setSurgeLocal(zone, false);
        if (ended) {
          surgeBus.broadcast('surge.state', zone, false);
          if (typeof io !== 'undefined') io.emit('surge_ended', { zone });
          log(`[SURGE] Zone ${zone} ENDED (Timeout, all instances)`);
        }
      })().catch((err) => console.warn('[SURGE_SHARED_WARN]', err.message));
    });
    return;
  }
  Object.keys(zoneOrders).forEach(zone => {
    const oldCount = zoneOrders[zone].length;
    zoneOrders[zone] = zoneOrders[zone].filter(t => now - t < SURGE_WINDOW_MS);
    if (oldCount >= SURGE_THRESHOLD && zoneOrders[zone].length < SURGE_THRESHOLD) {
      activeSurgeZones.delete(zone);
      if (typeof io !== 'undefined') io.emit('surge_ended', { zone });
      log(`[SURGE] Zone ${zone} ENDED (Timeout)`);
    }
  });
}, 30000);

// Periodic cleanup and check for all zones

// Exact production origins (utils/origins.js). Add more (comma-separated) in the ALLOWED_ORIGINS env var on
// Render; PUBLIC_WEB_URL / PUBLIC_API_URL origins are added automatically when set. No substring / wildcard
// matching: anyone can create a *.onrender.com service with 'zenvy' in its name.
const originsCfg = require('./utils/origins');
const PRODUCTION_ORIGINS = originsCfg.productionOrigins();
// 🌐 Production-Resilient CORS Handler
const isAllowedOrigin = originsCfg.makeOriginChecker();

const app = express();

// ── Liveness / readiness (utils/lifecycle.js) ─────────────────────────────────────────────────────
// Registered before every other middleware: no CORS / helmet / logging / rate limit / auth / database
// gate. /livez = the process answers (no DB). /readyz = startup done AND cached DB ping healthy AND not
// shutting down (Render healthCheckPath, render.yaml). While draining, every response carries
// `Connection: close` so keep-alive connections end after their current request.
const lifecycle = require('./utils/lifecycle');
app.use(lifecycle.connectionCloseWhileDraining);
// B1: in multi-instance mode (REDIS_URL set / INSTANCE_MODE=multi) every response names the instance
// that answered (debugging behind Render's load balancer). Nothing is added in single-instance mode.
const redisLayer = require('./utils/redis');
if (redisLayer.isMultiInstance()) {
  app.use((req, res, next) => { res.setHeader('X-Instance', redisLayer.INSTANCE_ID); next(); });
}
app.get('/livez', lifecycle.livezHandler);
app.get('/readyz', lifecycle.readyzHandler);

// P1 perf metrics (utils/perfMetrics.js): per-route count / p50 / p95 / DB time / query count, a
// `Server-Timing: app;dur=…, db;dur=…` header on every response, GET /api/admin/metrics/perf (admin)
// and one `[PERF]` line per minute with traffic (PERF_LOG=0 disables). /livez and /readyz are not timed.
const perfMetrics = require('./utils/perfMetrics');
app.use(perfMetrics.middleware());

// Layer 0: CORS (Origin whitelist) - Handled at the very top to prevent rate-limiter preflight blockers
app.use(cors({
  origin: function(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      // 403 (not a 500 "server error") for a refused browser origin.
      const err = new Error('This origin is not allowed to call the Zenvy API.');
      err.status = 403;
      err.code = 'CORS_REFUSED';
      callback(err);
    }
  },
  credentials: true,
  exposedHeaders: ['X-Trace-Id'] // Allow clients to read trace IDs for error reporting
}));

// Enable trust proxy to correctly identify client IPs behind reverse proxies (like Render, Nginx, or Cloudflare)
// utils/clientIp.js: TRUST_PROXY (hop count, default 1 = unchanged); TRUST_CLOUDFLARE=1 makes req.ip the
// CF-Connecting-IP header, only for requests that really arrived from a Cloudflare edge address.
const clientIp = require('./utils/clientIp');
app.set('trust proxy', clientIp.trustProxySetting());
{
  const cfIp = clientIp.cloudflareIpMiddleware();
  if (cfIp) app.use(cfIp);
  // EDGE_CACHE=1 (utils/cacheHeaders.js): /api responses without their own Cache-Control get
  // `private, no-store` (signed in) / `no-store`, so a CDN never stores anything user-specific. Off = nothing.
  const edgeDefaults = require('./utils/cacheHeaders').apiDefaultsMiddleware();
  if (edgeDefaults) app.use(edgeDefaults);
}

const rateLimit = require('express-rate-limit');
// Rate limits skip only outside production (unless RATE_LIMIT_ENFORCE=1) or for a load-test request
// carrying X-Loadtest-Key === env LOADTEST_KEY (no bypass when that env is unset). Limits only.
const { skipRateLimit, logLoadtestStatus } = require('./utils/loadtestBypass');
logLoadtestStatus();
// B1: with REDIS_URL the counts are shared by every instance (falls back to memory if Redis fails).
const { expressStore: rateLimitStore } = require('./utils/sharedRateLimit');

// Who is calling, for rate limits: the signed-in account (JWT signature VERIFIED, so a forged id
// cannot dodge the limit) or, when signed out / invalid token, the client IP. Cached on req.
const rateLimitIdentity = (req) => {
  if (req._rlIdentity) return req._rlIdentity;
  let identity = null;
  try {
    const auth = req.headers.authorization || '';
    // cookie-parser runs after this limiter, so read the raw Cookie header when needed.
    const rawCookie = /(?:^|;\s*)token=([^;]+)/.exec(String(req.headers.cookie || ''));
    const cookieToken = (req.cookies && req.cookies.token) || (rawCookie ? decodeURIComponent(rawCookie[1]) : null);
    let token = auth.startsWith('Bearer ') && !auth.includes('cookie-managed') ? auth.slice(7) : cookieToken;
    if (token && process.env.JWT_SECRET) {
      token = String(token).replace(/['"]+/g, '').trim();
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.id) identity = { key: `user:${decoded.id}`, user: true };
    }
  } catch { /* expired / invalid token: treat as signed out */ }
  if (!identity) {
    const ip = rateLimit.ipKeyGenerator ? rateLimit.ipKeyGenerator(req.ip) : req.ip;
    identity = { key: `ip:${ip}`, user: false };
  }
  req._rlIdentity = identity;
  return identity;
};

// ── Global API Shield (per user, not per IP) ──────────────────────────────────────────────────
// A whole campus shares one Wi-Fi NAT IP, so a per-IP cap throttled everyone at once. Signed-in
// requests are limited per account; signed-out requests per IP with a much higher cap.
const RL_USER_MAX = Math.max(100, Number(process.env.RATE_LIMIT_USER_MAX) || 1500);   // per account / 15 min
const RL_IP_MAX = Math.max(1000, Number(process.env.RATE_LIMIT_IP_MAX) || 20000);     // per IP (signed out) / 15 min
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: (req) => (rateLimitIdentity(req).user ? RL_USER_MAX : RL_IP_MAX),
  keyGenerator: (req) => rateLimitIdentity(req).key,
  skip: (req) => skipRateLimit(req),
  message: { message: 'Too many requests, please slow down and try again in a few minutes.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
  // Every /api request passes here: per instance unless REDIS_SHARED_GLOBAL_LIMIT=1 (Redis ops budget).
  ...rateLimitStore('global', { hot: true }),
});

// ── Order Spam Shield (Per-User via verified JWT, IP only when signed out) ────────────────────
const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 order submissions per minute per signed-in user (IP only when signed out)
  keyGenerator: (req) => rateLimitIdentity(req).key,
  skip: (req) => skipRateLimit(req),
  message: { message: 'Too many orders in a minute. Please wait a moment and try again.', code: 'TOO_MANY_ORDERS' },
  standardHeaders: true,
  legacyHeaders: false,
  ...rateLimitStore('orders'),
});

// ── Auth Rate Limiter (Generous for shared campus IP) ─────────────────────────
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // 50 auth attempts per IP per 15 min — prevents brute force but allows shared WiFi retries
  skip: (req) => skipRateLimit(req),
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...rateLimitStore('auth'),
});

// Export auth limiter for routes to use
app.set('authRateLimiter', authRateLimiter);

// Apply the global rate limiting middleware to all requests starting with /api.
// Health / ping (monitors, keep-alive, load balancers) are never rate limited.
const HEALTH_PATHS = new Set(['/api/health', '/api/ping']);
app.use('/api/', (req, res, next) => (HEALTH_PATHS.has(req.originalUrl.split('?')[0].replace(/\/+$/, '')) ? next() : globalLimiter(req, res, next)));
app.post('/api/orders', orderRateLimiter);

// 📦 Serve compiled APK directly for download
app.get('/Zenvy_Customer_Standalone.apk', (req, res) => {
  res.download(path.join(__dirname, '..', 'Zenvy_Customer_Standalone.apk'));
});

const server = http.createServer(app);

// ── High-Concurrency Server Tuning ──────────────────────
server.maxConnections = 2000; // Allow 2000 simultaneous TCP connections
server.keepAliveTimeout = 65000; // Keep connections alive (must be > nginx/ALB timeout)
server.headersTimeout = 70000; // Must be > keepAliveTimeout

// PROCESS_ROLE=worker has no socket server: a stand-in drops every emit (warned once per event) until
// the Redis emitter lands (Phase 2). 'all' / 'web' get the real socket.io server as before.
// B1: socketCluster.socketOptions() returns these options unchanged in single-instance mode; in
// multi-instance mode it switches perMessageDeflate off (and SOCKET_TRANSPORTS=websocket can make the
// server websocket-only). socketCluster.setup() installs the Redis adapter when REDIS_URL is set.
const socketCluster = require('./utils/socketCluster');
const io = !servesApi(PROCESS_ROLE) ? createNullIo() : new Server(server, socketCluster.socketOptions({
  cors: { 
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  // ── Socket.io Tuning for 500+ Concurrent Connections ──
  connectTimeout: 45000,
  pingTimeout: 30000,    // Increased from 20s — prevents false disconnects on slow campus Wi-Fi
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB max message size
  perMessageDeflate: { threshold: 1024 }, // Compress messages > 1KB to save bandwidth
  transports: ['websocket', 'polling'], // Prefer WebSocket, fallback to polling
  allowUpgrades: true
}));
socketCluster.setup(io);
// Cross-instance cache invalidation (responseCache, restaurant list, auth cache, flags, friends caches).
require('./utils/cacheBus').start();

app.set('io', io);
// Realtime sync layer (data:changed to everyone, admin:changed to admin-room). See utils/realtime.js.
require('./utils/realtime').init(io);

// ── Startup readiness ──────────────────────
// The HTTP server listens immediately (Render needs an open port within seconds); the database
// connect/sync/migrations/imports run afterwards. Until they finish, /api/* answers 503 and new
// sockets are refused with connect_error data { code: 'SERVER_STARTING', retryAfter }. A middleware
// refusal is NOT retried by socket.io itself (socket.active becomes false): clients must call
// socket.connect() again after retryAfter seconds (the partner apps do).
let dbReady = false;
const STARTUP_RETRY_AFTER_SECONDS = 10;
// A socket that arrives during startup is HELD (up to STARTUP_SOCKET_WAIT_MS) until the database is
// ready instead of being refused at once: clients that do not re-call connect() after a middleware
// refusal (the admin dashboard, the customer app) used to stay offline after every redeploy.
const STARTUP_SOCKET_WAIT_MS = 25000;
const dbReadyWaiters = new Map(); // proceed -> refuse
const markDbReady = () => {
  dbReady = true;
  lifecycle.markDbReady(); // /readyz turns 200 once the first cached DB ping succeeds
  const waiting = Array.from(dbReadyWaiters.keys());
  dbReadyWaiters.clear();
  waiting.forEach((fn) => fn());
};
// A shutdown that starts while sockets are still held (deploy cancelled during startup) refuses them
// at once instead of letting them wait out STARTUP_SOCKET_WAIT_MS.
const refuseHeldSockets = () => {
  const refusers = Array.from(dbReadyWaiters.values());
  dbReadyWaiters.clear();
  refusers.forEach((fn) => fn());
};
io.use((socket, next) => {
  if (dbReady) return next();
  let done = false;
  const refuse = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    dbReadyWaiters.delete(proceed);
    const err = new Error('Server is starting, please retry in a moment');
    err.data = { code: 'SERVER_STARTING', retryAfter: STARTUP_RETRY_AFTER_SECONDS };
    next(err);
  };
  const proceed = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (socket.conn && socket.conn.readyState === 'closed') return; // the client gave up meanwhile
    next();
  };
  const timer = setTimeout(refuse, STARTUP_SOCKET_WAIT_MS);
  if (lifecycle.isShuttingDown()) return refuse();
  dbReadyWaiters.set(proceed, refuse);
});

// C3 force-update: a socket handshake whose auth/query names an app version below the minimum is refused
// with err.data.code = 'UPGRADE_REQUIRED'. No appName in the handshake (or no policy) = unchanged.
io.use(require('./utils/appVersionPolicy').socketGate);

// 🛡️ Socket.io JWT Authentication Middleware
const jwt = require('jsonwebtoken');
io.use((socket, next) => {
  try {
    let token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    // Check for token in cookies if not found in auth payload or headers
    if (!token && socket.handshake.headers.cookie) {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = cookieHeader.split(';').reduce((res, c) => {
        const parts = c.trim().split('=');
        if (parts.length >= 2) {
          try {
            res[parts[0]] = decodeURIComponent(parts[1]);
          } catch (e) {
            res[parts[0]] = parts[1];
          }
        }
        return res;
      }, {});
      token = cookies.token;
    }
    
    if (!token) {
      // Some public endpoints (like global announcements or open basket rooms) 
      // might try to connect without a token. We should allow anonymous sockets but mark them.
      socket.user = { id: 'anonymous', role: 'guest' };
      return next();
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[SOCKET_AUTH_FATAL] JWT_SECRET not configured. Rejecting all connections.');
      return next(new Error('Server configuration error'));
    }

    const decoded = jwt.verify(token, secret);
    // The JWT role is only a hint: load the live account so suspended / deleted accounts are
    // refused and a demoted admin loses admin rooms at once (tokens live 30 days).
    loadSocketAccount(decoded)
      .then((account) => {
        if (!account) return next(new Error('Authentication error: Account not found'));
        if (account.suspended) return next(new Error('Authentication error: Account suspended'));
        socket.user = { ...decoded, id: account.id, role: account.role };
        // B1: socket.data travels with fetchSockets() across instances (socket.user does not), so
        // session revocation (utils/realtime.disconnectRevokedSockets) can find remote sockets too.
        socket.data.user = { id: account.id, role: account.role, tv: Number(decoded.tv) || 0 };
        next();
      })
      .catch((err) => {
        console.warn('[SOCKET_AUTH_WARN] Account lookup failed:', err.message);
        next(new Error('Authentication error: Please retry'));
      });
  } catch (err) {
    console.warn('[SOCKET_AUTH_WARN] Connection rejected:', err.message);
    next(new Error('Authentication error: Invalid token'));
  }
});

// Resolve the account behind a socket JWT: { id, role, suspended } or null when it no longer exists.
async function loadSocketAccount(decoded) {
  const id = decoded && decoded.id;
  if (!id) return null;
  const tokenRole = String(decoded.role || '').toLowerCase();
  if (tokenRole === 'rider') {
    const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
    const p = await getDeliveryPartnerModel().findByPk(id, { attributes: ['id', 'tokenVersion'] });
    if (!p) return null;
    if ((Number(decoded.tv) || 0) !== (Number(p.tokenVersion) || 0)) return null; // password changed
    return { id: p.id, role: 'rider', suspended: false };
  }
  if (tokenRole === 'auto_driver') {
    // Zenvy Auto Driver app (modules/autoRide): own table, current tokenVersion, suspended refused.
    const AutoDriver = require('./modules/autoRide').getModel('AutoDriver');
    const d = AutoDriver ? await AutoDriver.findByPk(id, { attributes: ['id', 'tokenVersion', 'status'] }) : null;
    if (!d) return null;
    if ((Number(decoded.tv) || 0) !== (Number(d.tokenVersion) || 0)) return null; // password changed / signed out
    return { id: d.id, role: 'auto_driver', suspended: d.status === 'SUSPENDED' };
  }
  if (tokenRole === 'restaurant' || tokenRole === 'vendor') {
    const { getRestaurantModel } = require('./models/Restaurant');
    const r = await getRestaurantModel().findByPk(id, { attributes: ['id', 'tokenVersion'] });
    if (!r) return null;
    // A partner password reset bumps tokenVersion and signs every old session out (RB-12).
    if ((Number(decoded.tv) || 0) !== (Number(r.tokenVersion) || 0)) return null;
    return { id: r.id, role: 'restaurant', suspended: false };
  }
  const { getUserModel } = require('./models/User');
  const u = await getUserModel().findByPk(id, { attributes: ['id', 'role', 'isActive', 'tokenVersion'] });
  if (!u) return null;
  if ((Number(decoded.tv) || 0) !== (Number(u.tokenVersion) || 0)) return null; // password changed
  return { id: u.id, role: u.role || 'student', suspended: u.isActive === false };
}

// io is already attached to app via app.set('io', io) above

// ═══════════════════════════════════════════════════════════════════════════════
//  ZENVY FORTRESS — 10-Layer Security Middleware Stack
// ═══════════════════════════════════════════════════════════════════════════════
const {
  requestTracer,
  securityHeaders,
  injectionGuard,
  hppProtection,
  botGuard,
  requestTimeout,
  sensitiveDataMask,
  auditLogger
} = require('./middleware/securityMiddleware');

// Layer 0: Helmet (CSP, HSTS, XSS Protection headers). Built ONCE: constructing helmet (and
// validating its CSP directives) on every request cost CPU on each call.
const helmetMiddleware = helmet({
    crossOriginResourcePolicy: false, // Allows cross-origin image loading
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://apis.google.com", "https://www.google.com", "https://www.recaptcha.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https:", "wss:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        frameSrc: ["'self'", "https://www.google.com", "https://recaptcha.google.com", "https://*.firebaseapp.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["*"],
        upgradeInsecureRequests: [],
      },
    },
  });
app.use((req, res, next) => {
  if (req.path === '/auth-helper') {
    return next(); // Auth helper manages its own CSP for Firebase & reCAPTCHA
  }
  return helmetMiddleware(req, res, next);
});

// Layer 1: Request Trace ID (unique ID for every request — essential for incident response)
app.use(requestTracer);

// Layer 1b: Production error hygiene — raw error.message / stack / SQL never reach customers.
app.use(require('./utils/env').sanitizeErrorResponses);

// Layer 2: Enhanced Security Response Headers (HSTS, Permissions-Policy, Referrer-Policy)
app.use(securityHeaders);

// Layer 3: Bot / Vulnerability Scanner Guard
app.use(botGuard);

// Layer 4: Morgan Enterprise Logging (with trace ID)
// ACCESS_LOG=all (default, one line per request, unchanged) | errors (only status >= 400) | off.
// At hundreds of req/s the per-request line is a synchronous stdout write (pipes on Linux): set
// ACCESS_LOG=errors on Render; the [PERF] line (utils/perfMetrics) still summarises traffic per minute.
const ACCESS_LOG = String(process.env.ACCESS_LOG || 'all').trim().toLowerCase();
app.use(morgan(':method :url :status :res[content-length] - :response-time ms', ACCESS_LOG === 'off'
  ? { skip: () => true }
  : (ACCESS_LOG === 'errors' ? { skip: (req, res) => res.statusCode < 400 } : {})));

// Layer 6: Compression & Parsing
// gzip level 6 (default speed/ratio); bodies under 1 KB go out as is (gzip framing ~20 B + CPU buys
// nothing there). Cached public reads arrive pre-compressed (utils/responseCache) and are skipped.
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cookieParser());
// Zenvy Campus Events Razorpay webhook: the signature is over the RAW body, so this exact path is parsed
// with express.raw and handled here, before the global express.json (and the body sanitizers after it).
// 503 PAYMENT_NOT_CONFIGURED until RAZORPAY_* env vars are set (modules/campusEvents/controllers/payments.js).
app.post('/api/campus-events/webhooks/razorpay', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
  req.rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  return require('./modules/campusEvents/controllers/payments').razorpayWebhook(req, res);
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Layer 7: HTTP Parameter Pollution Prevention
app.use(hppProtection);

// Layer 8: SQL/NoSQL Injection + Path Traversal Guard
app.use(injectionGuard);

// Layer 9: Sensitive Data Masking (strips passwords from logs)
app.use(sensitiveDataMask);

// Layer 10: Security Audit Logger (auth attempts, admin actions)
app.use(auditLogger);

// Layer 11: Request Timeout (30s — prevents Slow-Loris attacks)
app.use(requestTimeout);

// Custom In-Place XSS Sanitizer to prevent TypeError on Express 5 read-only req.query/req.params properties
const sanitizeXSS = (data) => {
  if (typeof data === 'string') {
    return data
      .replace(/<script[^>]*>([\S\s]*?)<\/script>/gi, '')
      .replace(/<[^>]*>?/gm, '');
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeXSS);
  }
  if (typeof data === 'object' && data !== null) {
    const cleanObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        cleanObj[key] = sanitizeXSS(data[key]);
      }
    }
    return cleanObj;
  }
  return data;
};

app.use((req, res, next) => {
  if (req.body) {
    req.body = sanitizeXSS(req.body);
  }
  if (req.query) {
    for (const key in req.query) {
      if (Object.prototype.hasOwnProperty.call(req.query, key)) {
        req.query[key] = sanitizeXSS(req.query[key]);
      }
    }
  }
  if (req.params) {
    for (const key in req.params) {
      if (Object.prototype.hasOwnProperty.call(req.params, key)) {
        req.params[key] = sanitizeXSS(req.params[key]);
      }
    }
  }
  next();
});

// ── Response Caching for Static Data (Menu, Restaurants) ──────────────────────
app.use((req, res, next) => {
  // Cache GET requests for restaurant listings and menus (reduces DB load under 500+ users)
  if (req.method === 'GET' && (req.path.startsWith('/api/restaurants') || req.path.startsWith('/api/restaurant') || req.path.startsWith('/api/search'))) {
    // Revalidate every time: clients refetch on realtime `data:changed` events and must see fresh data.
    // The server keeps its own in-memory listing cache (cleared on every store/product write).
    res.set('Cache-Control', 'no-cache');
  }
  next();
});

app.get('/api/health', async (req, res) => {
  if (!dbReady) {
    res.set('Retry-After', String(STARTUP_RETRY_AFTER_SECONDS));
    return res.status(503).json({ status: 'starting', timestamp: new Date(), uptime: process.uptime() });
  }
  const instance = getDbInstance(); // resolved at boot (a require() per health call cost fs stats)
  let dbStatus = 'disconnected';
  
  let dbHost = 'unknown';
  if (instance) {
    try {
      // Cached ping (utils/lifecycle, refreshed every ~5 s): no database query per health request.
      const ping = await lifecycle.getDbStatus();
      if (!ping.ok) throw new Error(ping.error || 'database ping failing');
      dbStatus = 'connected';
      // Safely extract hostname if possible
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
         try {
           const url = new URL(dbUrl);
           dbHost = `${url.hostname.slice(0, 4)}***${url.hostname.slice(-4)}`;
         } catch { /* ignore */ }
      } else {
        dbHost = 'local-sqlite';
      }
    } catch (err) {
      dbStatus = 'error';
    }
  }

  const body = { 
    status: 'online', 
    nexus: dbStatus,
    dialect: instance ? instance.getDialect() : 'none',
    host: dbHost,
    timestamp: new Date(),
    uptime: process.uptime()
  };
  // B1 (additive, multi-instance mode only): which instance answered and whether Redis is reachable.
  if (redisLayer.isMultiInstance()) {
    body.instance = redisLayer.INSTANCE_ID;
    body.redis = redisLayer.isConfigured() ? (redisLayer.isReady() ? 'ok' : 'down') : 'off';
  }
  // Infra switch-over checks (docs/INFRA_SWITCHOVER.md), only with ?infra=1 so the default shape that
  // monitors rely on stays exactly the same. No secrets: the kind of DB host, the last cached DB ping
  // round trip (no extra query), where new uploads go.
  if (String(req.query.infra || '') === '1') try {
    const lastPing = await lifecycle.getDbStatus();
    body.infra = {
      instance: redisLayer.INSTANCE_ID,
      redis: redisLayer.isConfigured() ? (redisLayer.isReady() ? 'ok' : 'down') : 'off',
      dbType: require('./config/dbSettings').dbHostType(),
      dbMs: lastPing && Number.isFinite(lastPing.latencyMs) ? lastPing.latencyMs : null,
      media: require('./utils/mediaStorage').driverName(),
    };
  } catch { /* health never fails because of these extras */ }
  res.json(body);
});

// Own-domain move (utils/publicUrl.advertisedEndpoints): the apps ask where the API lives. Every field is
// null until PUBLIC_API_URL is set (the apps then keep their built-in address). Answers without the DB.
app.get('/api/config/endpoints', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(require('./utils/publicUrl').advertisedEndpoints());
});

app.get(['/api/ping', '/ping'], (req, res) => {
  res.json({ status: 'pong', timestamp: Date.now() });
});

// PROCESS_ROLE=worker answers only the health endpoints above (and '/'): no API, no sockets.
if (PROCESS_ROLE === 'worker') {
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path === '/') return next();
    res.status(404).json({ message: 'This process runs background jobs only (PROCESS_ROLE=worker).', code: 'WORKER_ONLY' });
  });
}
// Static uploads served once below after DB init

// Every other /api route waits for the database (health and ping above answer on their own).
app.use('/api', (req, res, next) => {
  if (dbReady) return next();
  res.set('Retry-After', String(STARTUP_RETRY_AFTER_SECONDS));
  res.status(503).json({ message: 'Server is starting, please retry in a moment', code: 'SERVER_STARTING', retryAfter: STARTUP_RETRY_AFTER_SECONDS });
});

// C3 force-update (utils/appVersionPolicy.js): an app that sends X-App-Name / X-App-Version below the admin's
// minimum supported version gets 426 UPGRADE_REQUIRED (health, config, logout and account deletion still
// answer). Requests without the header (web, admin, tests, older builds) pass. No policy set = no effect.
app.use('/api', require('./utils/appVersionPolicy').gate);

// Connect to PostgreSQL, then initialize routes. Runs AFTER the port is open (see startServer).
const initializeApp = async () => {
  try {
    await connectDB();
    try {
      await require('./config/sweepMigrations').runSweepMigrations(require('./config/db').getSequelize());
    } catch (e) { console.warn('[SWEEP_MIGRATION_WARN]', e.message); }
    // Wall contest / media and chat + Pulse retention jobs: scheduled with the others (jobs/index.js) below.

    app.get('/auth-helper', (req, res) => {
      res.removeHeader('X-Frame-Options');
      // Only Zenvy's own web apps (and local dev) may frame this page: it hands a Firebase phone
      // token to its parent window, which POST /api/users/login turns into a session.
      const frameAncestors = ["'self'", ...PRODUCTION_ORIGINS, 'http://localhost:*', 'http://127.0.0.1:*'].join(' ');
      res.setHeader("Content-Security-Policy", `default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline'; frame-ancestors ${frameAncestors};`);
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zenvy Secure Auth Gateway</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0A0A0B;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: rgba(26, 26, 28, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      padding: 32px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .logo-container {
      width: 64px;
      height: 64px;
      background: rgba(212, 175, 122, 0.1);
      border: 1px solid rgba(212, 175, 122, 0.3);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin: 0 auto 16px auto;
    }
    h1 {
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 2px;
      color: #FFFFFF;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 span {
      color: #D4AF7A;
    }
    p.subtitle {
      font-size: 12px;
      color: #9CA3AF;
      margin-bottom: 24px;
    }
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      border-top: 3px solid #D4AF7A;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .btn-google {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background-color: #FFFFFF;
      color: #000000;
      border: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
      margin-bottom: 16px;
    }
    .btn-google:hover {
      background-color: #E5E7EB;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
    }
    .divider-line {
      flex: 1;
      height: 1px;
      background-color: rgba(255, 255, 255, 0.1);
    }
    .divider-text {
      padding: 0 12px;
      font-size: 11px;
      font-weight: 700;
      color: #6B7280;
    }
    .input-group {
      text-align: left;
      margin-bottom: 20px;
    }
    .input-label {
      font-size: 10px;
      font-weight: 900;
      color: #D4AF7A;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 8px;
      display: block;
    }
    .input-wrapper {
      display: flex;
      gap: 8px;
    }
    .input-prefix {
      background-color: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
      padding: 14px;
      color: #9CA3AF;
      font-weight: 700;
      font-size: 14px;
    }
    input {
      flex: 1;
      background-color: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
      padding: 14px 16px;
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 700;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: rgba(212, 175, 122, 0.4);
    }
    .btn-submit {
      width: 100%;
      background-color: #D4AF7A;
      color: #000000;
      border: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(212, 175, 122, 0.2);
      transition: background 0.2s;
    }
    .btn-submit:hover {
      background-color: #F0D9A8;
    }
    .btn-back {
      width: 100%;
      background-color: rgba(255, 255, 255, 0.05);
      color: #FFFFFF;
      border: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 12px;
    }
    .btn-back:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    .error-container {
      margin-top: 16px;
      padding: 12px;
      background-color: rgba(239, 79, 95, 0.1);
      border: 1px solid rgba(239, 79, 95, 0.2);
      border-radius: 14px;
      color: #EF4F5F;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="card">
    <div>
      <div class="logo-container">
        ✨
      </div>
      <h1>ZENVY <span>SECURE</span></h1>
      <p id="subtitle" class="subtitle">Authenticating session...</p>
    </div>

    <!-- UI FOR CHOOSING / ERROR -->
    <div id="loading-state" class="hidden">
      <div class="spinner"></div>
      <p style="font-size: 12px; color: #9CA3AF;">Verifying session...</p>
    </div>

    <div id="auth-options">
      <!-- GOOGLE BUTTON -->
      <button id="google-login-btn" onclick="loginWithGoogle()" class="btn-google">
        <svg style="width:18px;height:18px" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.69c-.29 1.5-1.14 2.77-2.4 3.61v3h3.86c2.26-2.09 3.59-5.16 3.59-8.46z"/>
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A11.993 11.993 0 0 0 12 24z"/>
          <path fill="#FBBC05" d="M5.27 14.29a7.18 7.18 0 0 1 0-4.58V6.61H1.29a11.993 11.993 0 0 0 0 10.78l3.98-3.1z"/>
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.93 1.19 15.24 0 12 0 7.33 0 3.29 2.68 1.29 6.61l3.98 3.1c.95-2.85 3.6-4.96 6.73-4.96z"/>
        </svg>
        Continue with Google
      </button>

      <!-- MOCK BYPASS GATEWAY REMOVED FOR PRODUCTION -->
      
      <div class="divider">
        <div class="divider-line"></div>
        <span class="divider-text">OR</span>
        <div class="divider-line"></div>
      </div>

      <!-- PHONE INPUT -->
      <div class="input-group">
        <label class="input-label">Phone Number</label>
        <div class="input-wrapper">
          <span class="input-prefix">+91</span>
          <input id="phone-number" type="tel" placeholder="9876543210" />
        </div>
      </div>

      <div id="recaptcha-container" style="margin-top: 10px;"></div>

      <button id="send-otp-btn" onclick="sendOtp()" class="btn-submit">
        Send Verification SMS
      </button>
    </div>

    <!-- UI FOR ENTERING OTP -->
    <div id="otp-input-state" class="hidden">
      <div class="input-group">
        <label class="input-label" style="text-align: center;">Enter 6-Digit OTP</label>
        <input id="otp-code" type="number" inputmode="numeric" autocomplete="one-time-code" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" style="text-align: center; letter-spacing: 8px; font-size: 18px;" />
      </div>

      <button id="verify-otp-btn" onclick="verifyOtp()" class="btn-submit">
        Verify & Continue
      </button>
      
      <button id="back-btn" onclick="showOptions()" class="btn-back">
        ← Back
      </button>
    </div>

    <!-- ERROR BLOCK -->
    <div id="error-message" class="error-container hidden"></div>
  </div>

  <script type="module">
    window.onerror = function(message, source, lineno, colno, error) {
      console.error('[AUTH_HELPER_ERROR]', message, lineno);
      document.getElementById('error-message').innerText = "Something went wrong on our side. Please close this window and try again.";
      document.getElementById('error-message').classList.remove('hidden');
    };
    
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    const firebaseConfig = {
      apiKey: "AIzaSyASKW2EosQpJjkZMGILrURhoiP7vhjj8TY",
      authDomain: "hostelbites-c77a8.firebaseapp.com",
      projectId: "hostelbites-c77a8",
      storageBucket: "hostelbites-c77a8.appspot.com",
      messagingSenderId: "785490473159",
      appId: "1:785490473159:web:7e7b7b00cc9e2669000ee2"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    let confirmationResult = null;

    // Parse phone parameter from URL query if provided
    window.addEventListener('load', async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const queryPhone = urlParams.get('phone');
        if (queryPhone) {
          // Strip +91 if present for raw display in the input
          const cleanPhone = queryPhone.replace('+91', '').trim();
          const phoneInputEl = document.getElementById('phone-number');
          if (phoneInputEl) {
            phoneInputEl.value = cleanPhone;
          }
        }

        // Run redirect checks silently in the background
        // Only a Google redirect that completed in THIS page load counts as a sign-in.
        // Any other lingering Firebase session (e.g. an earlier phone-OTP session) is cleared,
        // never auto-posted, so the user can always choose / switch accounts.
        const result = await getRedirectResult(auth).catch(() => null);
        const isGoogleUser = (u) => !!u && (u.providerData || []).some(p => p && p.providerId === 'google.com');
        if (result && result.user && isGoogleUser(result.user)) {
          const token = await result.user.getIdToken();
          sendToApp({ type: 'GOOGLE_SUCCESS', token: token });
        }
        if (auth.currentUser) {
          await auth.signOut().catch(() => {});
        }
      } catch (err) {
        console.warn('Redirect verification error:', err);
      }
    });

    window.loginWithGoogle = () => {
      showLoading("Redirecting to Google...");
      signInWithRedirect(auth, provider);
    };

    window.sendOtp = async () => {
      const phoneInput = document.getElementById('phone-number').value.trim();
      if (!phoneInput || phoneInput.length < 10) {
        showError("Please enter a valid 10-digit phone number.");
        return;
      }
      
      showLoading("Initiating security check...");
      try {
        if (window.recaptchaVerifier) {
          try { window.recaptchaVerifier.clear(); } catch (e) {}
          window.recaptchaVerifier = null;
        }
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          'size': 'invisible',
          'callback': (response) => {}
        });
        
        const fullPhone = "+91" + phoneInput.slice(-10);
        const result = await signInWithPhoneNumber(auth, fullPhone, window.recaptchaVerifier);
        confirmationResult = result;
        
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('auth-options').classList.add('hidden');
        document.getElementById('otp-input-state').classList.remove('hidden');
        document.getElementById('subtitle').innerText = "Enter verification code sent to " + fullPhone;
        hideError();
      } catch (err) {
        console.error('sendOtp error:', err);
        if (window.recaptchaVerifier) {
          try { window.recaptchaVerifier.clear(); } catch (e) {}
          window.recaptchaVerifier = null;
        }
        showError(err.message);
        showOptions();
      }
    };

    window.verifyOtp = async () => {
      const code = document.getElementById('otp-code').value.trim();
      if (!code || code.length < 6) {
        showError("Please enter the 6-digit OTP code.");
        return;
      }
      
      showLoading("Verifying OTP code...");
      try {
        const result = await confirmationResult.confirm(code);
        const token = await result.user.getIdToken();
        const phone = document.getElementById('phone-number').value.trim().slice(-10);
        sendToApp({ type: 'OTP_SUCCESS', token: token, phone: phone });
        auth.signOut().catch(() => {});
      } catch (err) {
        showError(err.message || "Invalid OTP code.");
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('otp-input-state').classList.remove('hidden');
      }
    };

    window.showOptions = () => {
      document.getElementById('loading-state').classList.add('hidden');
      document.getElementById('otp-input-state').classList.add('hidden');
      document.getElementById('auth-options').classList.remove('hidden');
      document.getElementById('subtitle').innerText = "Choose sign-in method";
    };

    function showLoading(msg) {
      document.getElementById('auth-options').classList.add('hidden');
      document.getElementById('otp-input-state').classList.add('hidden');
      document.getElementById('loading-state').classList.remove('hidden');
      document.getElementById('loading-state').querySelector('p').innerText = msg;
    }

    function showError(msg) {
      const errBlock = document.getElementById('error-message');
      errBlock.innerText = msg;
      errBlock.classList.remove('hidden');
    }

    function hideError() {
      document.getElementById('error-message').classList.add('hidden');
    }

    function sendToApp(data) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      } else {
        // Embedded in a web page (iframe): hand the result to the parent window only. Never display tokens.
        // frame-ancestors (CSP above) already limits who can embed this page; also address the
        // message to the embedding page's own origin when the browser tells us what it is.
        try {
          if (window.parent && window.parent !== window) {
            var target = '*';
            try { if (document.referrer) target = new URL(document.referrer).origin; } catch (e) {}
            window.parent.postMessage(JSON.stringify(data), target);
          }
        } catch (e) {}
      }
    }

    document.getElementById('send-otp-btn')?.addEventListener('click', window.sendOtp);
    document.getElementById('verify-otp-btn')?.addEventListener('click', window.verifyOtp);
    document.getElementById('google-login-btn')?.addEventListener('click', window.loginWithGoogle);
    document.getElementById('back-btn')?.addEventListener('click', window.showOptions);
  </script>
</body>
</html>
      `);
    });

    // Routes
    app.use('/api/users', require('./routes/userRoutes'));
    // Self-service account deletion (Google Play requirement) + public legal pages for the Play listing
    app.use('/api/users/account', require('./routes/accountRoutes'));
    app.use('/legal', require('./routes/legalRoutes'));
    // C8: printable order receipt behind a signed, 15-minute link (opened from the apps / admin).
    app.get('/receipts/:token', require('./controllers/receiptController').renderReceiptPage);
    const ticketRoutes = require('./routes/ticketRoutes');
    const systemRoutes = require('./routes/systemRoutes');
    const appConfigRoutes = require('./routes/appConfigRoutes');
    app.use('/api/restaurants', require('./routes/restaurantRoutes'));
    app.use('/api/restaurant', require('./routes/restaurantRoutes'));
    app.use('/api/orders', require('./routes/orderRoutes'));
    app.use('/api/delivery', require('./routes/deliveryPartnerRoutes'));
    app.use('/api/search', require('./routes/searchRoutes'));
    app.use('/api/bikepool', require('./routes/bikePoolRoutes'));
    app.use('/api/pg', require('./routes/pgRoutes'));
    app.use('/api/mega-basket', require('./routes/megaBasketRoutes'));
    app.use('/api/wall', require('./routes/wallRoutes'));
    app.use('/api/services', require('./routes/serviceRoutes'));
    app.use('/api/catalogue', require('./routes/catalogueRoutes'));
    app.use('/api/notifications', require('./routes/notificationRoutes'));

    // 🚀 Auto-Seed: DEVELOPMENT ONLY — Never overwrite production data
    const isProduction = isProductionEnv();
    if (!isProduction) {
      const { unifiedSeed } = require('./scripts/unified_seed');
      const { getUserModel } = require('./models/User');
      const User = getUserModel();
      if (User) {
        const userCount = await User.count();
        const { getSequelize } = require('./config/db');
        const instance = getSequelize();
        const Restaurant = instance.models.Restaurant;
        const restCount = Restaurant ? await Restaurant.count() : 0;
        
        if (userCount === 0 || restCount === 0) {
          console.log(`🌱 [AUTO_SEED] Dev data missing (Users: ${userCount}, Rests: ${restCount}). Seeding...`);
          await unifiedSeed();
          console.log('✅ [AUTO_SEED] Development defaults initialized.');
        }
      }
    }
    // Production no longer auto-seeds invented restaurants/menus (scripts/seed_prod.js). Real
    // restaurants are onboarded from the admin dashboard; store products come from the catalogue import.

    // 🛒 Catalogue import (idempotent, ledger-keyed): the store products the app used to hardcode.
    // Runs in the background so the port opens immediately; already-imported keys are never touched.
    try {
      const { runCatalogueImport } = require('./scripts/catalogue_import');
      runCatalogueImport()
        .then((r) => console.log('🛒 [CATALOGUE_IMPORT]', JSON.stringify(r)))
        .catch((err) => console.warn('⚠️ [CATALOGUE_IMPORT] failed:', err.message));
    } catch (catErr) {
      console.warn('⚠️ [CATALOGUE_IMPORT] not started:', catErr.message);
    }

    // 🧹 Demo-data cleanup (idempotent): switches off the demo riders / students / PG listings that
    // older builds seeded into production. Runs in the background; never deletes anything.
    try {
      const { runDemoDataCleanup } = require('./scripts/demo_data_cleanup');
      runDemoDataCleanup()
        .then((r) => console.log('🧹 [DEMO_CLEANUP]', JSON.stringify(r)))
        .catch((err) => console.warn('⚠️ [DEMO_CLEANUP] failed:', err.message))
        // 🔐 Admins still on a published seed password (C1-1): reset from ADMIN_RESET_PASSWORD, or warn
        // (never changed without it, so the owner is never locked out). After the demo cleanup (which can
        // also write the demo admin row), single runner across processes.
        .then(() => require('./scripts/admin_seed_reset').startAdminSeedReset())
        .then((r) => { if (r && r.ran && r.result) console.log('🔐 [ADMIN_SEED_RESET]', JSON.stringify(r.result)); })
        .catch((err) => console.warn('⚠️ [ADMIN_SEED_RESET] failed:', err.message));
    } catch (cleanupErr) {
      console.warn('⚠️ [DEMO_CLEANUP] not started:', cleanupErr.message);
    }

    // 🍽️ Remove the template dishes a deleted bulk seed copied into every store (backed up first).
    try {
      const { runTemplateMenuCleanup } = require('./scripts/remove_template_menu_items');
      runTemplateMenuCleanup()
        .then((r) => console.log('🍽️ [TEMPLATE_MENU_CLEANUP]', JSON.stringify(r)))
        .catch((err) => console.warn('⚠️ [TEMPLATE_MENU_CLEANUP] failed:', err.message));
    } catch (menuErr) {
      console.warn('⚠️ [TEMPLATE_MENU_CLEANUP] not started:', menuErr.message);
    }

    // 🖼️ One-time item corrections (photos, descriptions, veg flag); each applied once, old values kept.
    try {
      const { runItemFixes } = require('./scripts/apply_item_fixes');
      runItemFixes()
        .then((r) => console.log('🖼️ [ITEM_FIXES]', JSON.stringify(r)))
        .catch((err) => console.warn('⚠️ [ITEM_FIXES] failed:', err.message));
    } catch (fixErr) {
      console.warn('⚠️ [ITEM_FIXES] not started:', fixErr.message);
    }

    // 🖼️ Broken app-relative '/assets/...' image URLs -> null (idempotent; absolute URLs untouched).
    try {
      const { runAssetUrlFix } = require('./scripts/normalize_asset_urls');
      runAssetUrlFix()
        .then((r) => console.log('🖼️ [ASSET_URL_FIX]', JSON.stringify(r)))
        .catch((err) => console.warn('⚠️ [ASSET_URL_FIX] failed:', err.message));
    } catch (assetErr) {
      console.warn('⚠️ [ASSET_URL_FIX] not started:', assetErr.message);
    }

    // 🖼️ Legacy base64 images -> CampusMedia short URLs: a one-shot background job a minute after boot
    // (single-runner, jobs/index.js 'media.base64Migration'); DISABLE_BASE64_MIGRATION=true switches it off.

    // 👤 Owner-configured admin bootstrap (idempotent). Creates the admin account from
    // ADMIN_PHONE + ADMIN_PASSWORD (Render env) only if that phone has no account yet.
    // Never overwrites an existing account's password; no default credentials exist.
    try {
      const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '').slice(-10);
      const adminPassword = process.env.ADMIN_PASSWORD || '';
      if (adminPhone.length === 10 && adminPassword.length >= 10) {
        const { getUserModel } = require('./models/User');
        const User = getUserModel();
        if (User && !(await User.findOne({ where: { phone: adminPhone } }))) {
          await User.create({ name: process.env.ADMIN_NAME || 'Zenvy Admin', phone: adminPhone, password: adminPassword, role: 'admin' });
          console.log('👤 [ADMIN_BOOTSTRAP] Admin account created from ADMIN_PHONE.');
        }
      } else if (process.env.ADMIN_PHONE || process.env.ADMIN_PASSWORD) {
        console.warn('⚠️ [ADMIN_BOOTSTRAP] ADMIN_PHONE must be 10 digits and ADMIN_PASSWORD at least 10 characters.');
      }
    } catch (adminErr) {
      console.warn('⚠️ [ADMIN_BOOTSTRAP] Failed:', adminErr.message);
    }

    // 🦾 Manual Seed Trigger — development only, and only with an explicit SEED_KEY.
    app.post('/api/seed', async (req, res) => {
      if (isProductionEnv()) {
        return res.status(404).json({ message: 'Not found' });
      }
      const { key } = req.body || {};
      const seedKey = process.env.SEED_KEY;
      
      if (!seedKey || seedKey === 'nexus_protocol_9' || seedKey === 'secret') {
        console.error('[SECURITY_ALERT] Attempted to seed with insecure or missing key.');
        return res.status(500).json({ error: 'Server key not configured for seeding' });
      }

      if (key === seedKey) {
        console.log('📥 [MANUAL_SEED] Triggered via API');
        const isProduction = isProductionEnv();
        if (isProduction) {
          const { getSequelize } = require('./config/db');
          const instance = getSequelize();
          const { seedProduction } = require('./scripts/seed_prod');
          await seedProduction(instance);
        } else {
          const { unifiedSeed: runSeed } = require('./scripts/unified_seed');
          await runSeed();
        }
        return res.json({ message: 'Seeding complete' });
      }
      res.status(403).json({ error: 'Access Denied' });
    });
    app.use('/api/blocks', require('./routes/blockRoutes'));
    app.use('/api/vault', require('./routes/vaultRoutes'));
    // Zenvy Rentals (student vehicle rentals). Admin routes mount before /api/admin.
    const rentalsRoutes = require('./modules/rentals/routes');
    app.use('/api/rentals', rentalsRoutes.router);
    app.use('/api/admin/rentals', rentalsRoutes.adminRouter);
    // Rentals expiry + reminders: jobs/index.js 'rentals.lifecycle' (every 2 min).
    // Zenvy Auto-Ride (shared autos seat booking + Zenvy Auto Driver app). Driver router first so
    // /api/auto-ride/driver/* never reaches the customer router; admin routes before /api/admin.
    // Off for customers / publishing until GlobalConfig AUTO_RIDE_ENABLED is true.
    const autoRideRoutes = require('./modules/autoRide/routes');
    app.use('/api/auto-ride/driver', autoRideRoutes.driverRouter);
    app.use('/api/auto-ride', autoRideRoutes.router);
    app.use('/api/admin/auto-ride', autoRideRoutes.adminRouter);
    // Auto-Ride holds / lifecycle: jobs/index.js 'autoRide.lifecycle' (every 30 s).
    // Zenvy Campus Events (Others > Campus Events). Organizer + check-in routers before the student router
    // (which owns /api/campus-events/:id); admin routes before /api/admin. Off for students until GlobalConfig
    // CAMPUS_EVENTS_ENABLED is true. Lifecycle: jobs/index.js 'campusEvents.lifecycle' (every 60 s).
    const campusEventsRoutes = require('./modules/campusEvents/routes');
    app.use('/api/campus-events/organizer', campusEventsRoutes.organizerRouter);
    app.use('/api/campus-events/check-in', campusEventsRoutes.checkInRouter);
    app.use('/api/campus-events', campusEventsRoutes.router);
    app.use('/api/admin/campus-events', campusEventsRoutes.adminRouter);
    app.use('/api/admin', require('./routes/adminRoutes'));
    app.use('/api/rewards', require('./routes/rewardRoutes'));
    app.use('/api/community', require('./routes/communityRoutes'));
    app.use('/api/birthdays', require('./routes/birthdayRoutes'));
    app.use('/api/tickets', ticketRoutes);
    app.use('/api/system', systemRoutes);
    app.use('/api/config', appConfigRoutes);
    app.use('/api/features', require('./routes/featureRoutes'));
    app.use('/api/chat', require('./routes/chatRoutes'));
    app.use('/api/friends', require('./routes/friendRoutes'));
    app.use('/api/rooms', require('./routes/roomRoutes'));
    app.use('/api/daily-content', require('./routes/dailyContent'));
    app.use('/api/campus', require('./modules/campus/campusRoutes'));

    // ── Scheduled / background jobs (jobs/index.js) ──────────────────────
    // Expiry cleanup + birthday announcements (hourly, once now), auto-cancel (2 min), stall stuck flags
    // (15 min), featured expiry (10 min), menu auto-restore (30 s), rentals (2 min), Wall (5 min / 03:00
    // IST), chat + Pulse retention (hourly :23), ephemeral purge (hourly), streak nudge (18:00 IST),
    // abandoned cart (10:00 IST), Friends tasks / Connect / Spaces, base64 migration (once). Same
    // schedules as before; each tick runs on exactly ONE process (Postgres advisory lock). Not started
    // when PROCESS_ROLE=web (only the per-process Spaces room sweep runs there).
    try {
      // Not when a shutdown began while startup was still running (it already stopped the jobs).
      if (!lifecycle.isShuttingDown()) require('./jobs').startJobs({ io, isDbReady: () => dbReady, role: PROCESS_ROLE });
    } catch (e) { console.error('[JOBS_INIT_ERR]', e); }
    

    // Serve uploaded files statically
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    app.use('/uploads', express.static(uploadsDir));

    // Persistent Base64 Image Storage (survives on Render)
    const storage = multer.memoryStorage();
    const upload = multer({ 
      storage, 
      limits: { fileSize: 2 * 1024 * 1024 }, // Enforce 2MB size limit server-side
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']; // bytes are sniffed again
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only JPEG, PNG, and WEBP image formats are allowed.'));
        }
      }
    });
    
    const { protect: protectUpload } = require('./middleware/authMiddleware');
    app.post('/api/upload', protectUpload, (req, res, next) => {
      upload.single('image')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ message: err.message });
        }
        next();
      });
    }, async (req, res) => {
      // Every upload is sniffed (JPEG / PNG / WEBP / GIF only) and stored in the CampusMedia table;
      // rows only ever get the short media URL. No inline data: URL is returned or stored any more.
      const { storeImageRef, saveImageBytes, publicBase: mediaBase } = require('./utils/imageStore');
      const { orderId } = req.body || {};
      const isProof = !!orderId;
      let imageUrl = null;
      try {
        if (req.file && req.file.buffer) {
          const saved = await saveImageBytes(req.file.buffer, { ownerId: req.user.id, purpose: isProof ? 'delivery_proof' : 'other' });
          imageUrl = `${mediaBase(req)}/api/campus/media/${saved.id}`;
        } else if (req.body && req.body.image !== undefined) {
          if (typeof req.body.image !== 'string' || !req.body.image.trim()) {
            return res.status(400).json({ message: 'No file uploaded' });
          }
          const raw = req.body.image.trim();
          // Bare base64 (older clients) or a data URL; existing hosted URLs are not "uploads".
          const r = await storeImageRef(/^data:/i.test(raw) ? raw : `data:image/jpeg;base64,${raw}`, {
            req, ownerId: req.user.id, purpose: isProof ? 'delivery_proof' : 'other', maxBytes: 2 * 1024 * 1024, allowExternal: false,
          });
          if (!r.ok) return res.status(r.status || 400).json({ code: r.code, message: r.message });
          imageUrl = r.value;
        } else {
          return res.status(400).json({ message: 'No file uploaded' });
        }
      } catch (mediaErr) {
        const status = mediaErr.status && mediaErr.status < 500 ? mediaErr.status : 503;
        if (status >= 500) console.error('[UPLOAD_MEDIA_ERROR]', mediaErr.message);
        return res.status(status).json({ code: mediaErr.code || 'UPLOAD_FAILED', message: status === 415 ? mediaErr.message : 'Could not save that photo. Please try again.' });
      }
      const mediaId = (imageUrl.match(/\/api\/campus\/media\/([0-9a-f-]{36})/i) || [])[1] || null;

      // Persist as delivery proof only for the order's assigned rider (or an admin)
      if (orderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orderId))) {
        try {
          const { getOrderModel } = require('./models/Order');
          const Order = getOrderModel();
          const order = await Order.findByPk(orderId, { attributes: ['id', 'deliveryPartnerId', 'status'] });
          const role = String(req.user?.role || '').toLowerCase();
          const mayAttachProof = order && (role === 'admin' || (order.deliveryPartnerId && order.deliveryPartnerId === req.user?.id));
          if (mayAttachProof && order.status !== 'Cancelled') {
            await Order.update({ proofImage: imageUrl, proofTimestamp: new Date() }, { where: { id: order.id } });
          } else if (order) {
            console.warn(`[UPLOAD_PROOF_DENIED] ${req.user?.id} is not the rider of order ${orderId}`);
          }
        } catch (err) {
          console.error('[UPLOAD_PERSIST_ERROR]', err);
        }
      }

      // S0: delivery proof is private media: the uploader gets a signed preview link to show it now.
      const previewUrl = isProof && mediaId ? require('./utils/mediaAccess').signedUrlForId(req, mediaId) : undefined;
      res.json({ imageUrl, mediaId, ...(previewUrl ? { previewUrl } : {}) });
    });

    // Basic Health Check
    app.get('/', (req, res) => {
      res.status(200).json({ status: 'success', message: 'Zenvy API (PostgreSQL) is running...', version: '2.0.1' });
    });

    // Unknown API routes get a JSON 404 (never an HTML error page), then the global error handler
    // (registered last so it also covers the upload route above). No stack traces in production.
    app.use('/api', (req, res) => res.status(404).json({ message: 'Not found', code: 'NOT_FOUND' }));
    const { errorHandler } = require('./middleware/errorMiddleware');
    app.use(errorHandler);

    // Socket.io
    const afterDarkMod = require('./utils/afterDark');
    // S0: shared-cart rooms are bounded (utils/cartRooms): LRU cap, 30 min snapshot TTL, per-socket caps.
    const cartRooms = require('./utils/cartRooms');
    const cartRegistry = cartRooms.createRegistry({ liveSize: (room) => (io.sockets.adapter.rooms.get(room) || { size: 0 }).size });
    const activeCartRooms = cartRegistry.members; // roomCode -> Set of userId
    const activeCallRooms = new Map(); // callRoom -> Map of socketId -> { userId, userName }
    const callHosts = new Map(); // callRoom -> socketId of the participant who started the call
    // B1: while Redis is up (REDIS_URL set) call rooms live in Redis instead (utils/afterDarkCalls).
    const afterDarkCalls = require('./utils/afterDarkCalls');
    const CART_ROOM_PATTERN = cartRooms.CODE_RE; // ZN- + 4-12 (new builds: 10; older builds: 8)
    // B1: shared-cart members + latest basket mirrored in Redis when REDIS_URL is set (utils/sharedState).
    const sharedState = require('./utils/redis').isConfigured() ? require('./utils/sharedState') : null;
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Per-process, socket-bound housekeeping (NOT single-runner jobs): they read THIS process's socket
    // rooms, so they run on every process that serves sockets and never on PROCESS_ROLE=worker (no
    // sockets there: every rider would look disconnected). Cross-instance presence needs the Redis
    // adapter (Phase 2).
    const socketsHere = servesApi(PROCESS_ROLE);

    // Forget expired shared-cart snapshots (30 min) and rooms nobody is in (S0: also never-snapshotted ones).
    if (socketsHere) setInterval(() => cartRegistry.sweep(), 5 * 60 * 1000).unref?.();

    // ── Rider presence: closing the app must not leave a rider "online" forever ──
    // When a rider's last socket drops, wait RIDER_OFFLINE_GRACE_MINUTES (default 30, long enough that a
    // rider who only backgrounded the app keeps getting pushes). If they
    // still have no socket, no fresh GPS and no active order, set isOnline=false and take them out
    // of the live dispatch pool. Reconnecting cancels the check.
    const RIDER_OFFLINE_GRACE_MS = Math.max(2, Number(process.env.RIDER_OFFLINE_GRACE_MINUTES) || 30) * 60 * 1000;
    const riderOfflineTimers = new Map();
    const cancelRiderOfflineCheck = (riderId) => {
      const t = riderOfflineTimers.get(riderId);
      if (t) { clearTimeout(t); riderOfflineTimers.delete(riderId); }
    };
    const scheduleRiderOfflineCheck = (riderId) => {
      cancelRiderOfflineCheck(riderId);
      const timer = setTimeout(async () => {
        riderOfflineTimers.delete(riderId);
        try {
          // B1: a rider may be connected to ANOTHER instance (Redis adapter). Not sure (Redis down /
          // timeout)? Check again later instead of taking an online rider out of dispatch.
          const presence = await socketCluster.roomPresence(io.of('/'), `rider_${riderId}`);
          if (presence.present) return; // reconnected
          if (!presence.certain) { scheduleRiderOfflineCheck(riderId); return; }
          const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
          const { riderFixAgeMs } = require('./utils/riderDispatch');
          const DeliveryPartner = getDeliveryPartnerModel();
          const partner = await DeliveryPartner.findByPk(riderId, { attributes: ['id', 'isOnline', 'liveLocation', 'currentOrderId'] });
          if (!partner || !partner.isOnline) return;
          if (partner.currentOrderId) return; // still carrying an order: leave their duty state alone
          if (riderFixAgeMs(partner) < RIDER_OFFLINE_GRACE_MS) { scheduleRiderOfflineCheck(riderId); return; }
          const [changed] = await DeliveryPartner.update({ isOnline: false }, { where: { id: riderId, isOnline: true } });
          if (changed > 0) {
            require('./utils/realtime').setRiderOnline(riderId, false);
            io.to('admin-room').emit('admin_rider_offline', { riderId, reason: 'no_connection', timestamp: new Date().toISOString() });
            console.log(`[RIDER_PRESENCE] Rider ${riderId} set offline after ${Math.round(RIDER_OFFLINE_GRACE_MS / 60000)} min without a connection`);
          }
        } catch (err) {
          console.warn('[RIDER_PRESENCE_WARN]', err.message);
        }
      }, RIDER_OFFLINE_GRACE_MS);
      timer.unref?.();
      riderOfflineTimers.set(riderId, timer);
    };

    // Sweep (also covers riders whose timer was lost in a restart / redeploy).
    if (socketsHere) setInterval(async () => {
      try {
        const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
        const { riderFixAgeMs } = require('./utils/riderDispatch');
        const online = await getDeliveryPartnerModel().findAll({ where: { isOnline: true }, attributes: ['id', 'liveLocation', 'currentOrderId'] });
        for (const p of online) {
          const live = io.sockets.adapter.rooms.get(`rider_${p.id}`);
          if ((live && live.size > 0) || p.currentOrderId || riderOfflineTimers.has(p.id)) continue;
          // B1: connected to another instance? (the timer re-checks across instances before acting)
          if (riderFixAgeMs(p) >= RIDER_OFFLINE_GRACE_MS) scheduleRiderOfflineCheck(p.id);
        }
      } catch (err) {
        console.warn('[RIDER_PRESENCE_SWEEP_WARN]', err.message);
      }
    }, RIDER_OFFLINE_GRACE_MS).unref?.();

    // Initialize Campus Buddy /campus Socket.IO namespace
    const { initCampusSocket } = require('./modules/campus/campusSocket');
    initCampusSocket(io);

    io.on('connection', (socket) => {
      console.log(`[SOCKET CONNECT] ${socket.id} (User: ${socket.user.id}, Role: ${socket.user.role})`);

      // Crash shield: socket.io runs listeners inside process.nextTick, so a sync TypeError from a
      // malformed payload (e.g. emit('rider_connected') with no data) would become an
      // uncaughtException and restart production. Every listener below is wrapped: a missing
      // payload becomes {}, sync throws and async rejections are logged and swallowed.
      const rawOn = socket.on.bind(socket);
      socket.on = (event, handler) => rawOn(event, (...args) => {
        if (args.length === 0 || args[0] === undefined || args[0] === null) args[0] = {};
        try {
          const result = handler(...args);
          if (result && typeof result.catch === 'function') {
            result.catch((err) => console.error(`[SOCKET_HANDLER_ERROR] ${event}:`, err && err.message ? err.message : err));
          }
        } catch (err) {
          console.error(`[SOCKET_HANDLER_ERROR] ${event}:`, err && err.message ? err.message : err);
        }
      });

      // ── Per-socket access helpers ──────────────────────────────
      const socketRole = () => String(socket.user?.role || '').toLowerCase();
      const isGuestSocket = () => !socket.user || socket.user.id === 'anonymous' || socketRole() === 'guest';
      const isAdminSocket = () => !isGuestSocket() && socketRole() === 'admin';

      // Order or Mega Basket id: owner, assigned rider or admin.
      const canAccessOrderOrBasket = async (id) => {
        if (isGuestSocket() || !UUID_PATTERN.test(String(id || ''))) return false;
        if (isAdminSocket()) return true;
        const { getOrderModel } = require('./models/Order');
        const order = await getOrderModel().findByPk(id, { attributes: ['id', 'userId', 'deliveryPartnerId'] });
        if (order) return order.userId === socket.user.id || order.deliveryPartnerId === socket.user.id;
        const { getMegaBasketModel } = require('./models/MegaBasket');
        const MegaBasket = getMegaBasketModel && getMegaBasketModel();
        const basket = MegaBasket ? await MegaBasket.findByPk(id, { attributes: ['id', 'userId', 'deliveryPartnerId'] }) : null;
        return !!basket && (basket.userId === socket.user.id || basket.deliveryPartnerId === socket.user.id);
      };

      // Friend / group conversation membership (Conversation.participants JSON array).
      const isConversationParticipant = async (conversationId) => {
        if (isGuestSocket() || !UUID_PATTERN.test(String(conversationId || ''))) return false;
        const { getConversationModel } = require('./models/Conversation');
        const convo = await getConversationModel().findByPk(conversationId);
        return !!convo && (convo.participants || []).includes(socket.user.id);
      };

      // After Dark rooms are keyed by an accepted Friendship id or a lounge Room id (utils/afterDarkAccess).
      const isFriendshipMember = async (groupId) => {
        if (isGuestSocket()) return false;
        try {
          const { getAfterDarkAccess } = require('./utils/afterDarkAccess');
          return !!(await getAfterDarkAccess(socket.user.id, groupId));
        } catch (err) {
          console.error('[AFTER_DARK_ACCESS_ERROR]', err.message);
          return false;
        }
      };

      // Personal rooms so targeted events never need a global broadcast.
      if (!isGuestSocket()) {
        if (socketRole() === 'rider') { socket.join(`rider_${socket.user.id}`); cancelRiderOfflineCheck(socket.user.id); }
        else if (socketRole() === 'auto_driver') socket.join(`autodriver_${socket.user.id}`);
        else if (socketRole() !== 'restaurant') socket.join(`user_${socket.user.id}`);
      }

      // Live dispatch pool: only an authenticated rider whose account is approved AND on duty joins
      // 'riders_online' (delivery_request / delivery_request_gone). PUT /delivery/online moves it after.
      if (!isGuestSocket() && socketRole() === 'rider') {
        (async () => {
          try {
            const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
            const partner = await getDeliveryPartnerModel().findByPk(socket.user.id, { attributes: ['id', 'isOnline', 'isApproved'] });
            if (partner && partner.isOnline && partner.isApproved && socket.connected) {
              socket.join(require('./utils/realtime').RIDERS_ONLINE_ROOM);
            }
          } catch (err) {
            console.warn('[RIDERS_ONLINE_JOIN_WARN]', err.message);
          }
        })();
      }

      socket.on('joinOrder', async (orderId) => {
        const room = String(orderId).trim();
        
        // 🛡️ Permission Check: Only the order creator, assigned rider, or admin can join the room
        try {
          const { getOrderModel } = require('./models/Order');
          const Order = getOrderModel();
          const order = await Order.findByPk(room);
          
          const isOwner = order && order.userId === socket.user.id;
          const isRider = order && order.deliveryPartnerId === socket.user.id;
          const isAdmin = socket.user.role === 'admin';

          if (isOwner || isRider || isAdmin) {
            await socket.join(room);
            log(`[JOIN] ${socket.id} (${socket.user.role}) -> ${room}`);
          } else {
            console.warn(`[SOCKET_AUTH_DENIED] User ${socket.user.id} tried to join room ${room}`);
          }
        } catch (err) {
          console.error('[JOIN_ORDER_ERROR]', err.message);
        }
      });

      socket.on('joinRestaurant', async (restaurantId, ack) => {
        const reply = (payload) => { if (typeof ack === 'function') { try { ack(payload); } catch { /* ignore */ } } };
        const rid = String(restaurantId || '').trim();
        const role = String(socket.user?.role || '').toLowerCase();
        if (rid && ((role === 'restaurant' && socket.user.id === rid) || role === 'admin')) {
          await socket.join(`restaurant_${rid}`);
          log(`[JOIN_RESTAURANT] ${socket.id} -> restaurant_${rid}`);
          reply({ ok: true, room: `restaurant_${rid}` });
        } else {
          console.warn(`[SOCKET_AUTH_DENIED] ${socket.user?.id} tried to join restaurant_${rid}`);
          reply({ ok: false, message: 'Not allowed to join this store.' });
        }
      });

      // 🛡️ joinRoom is allow-listed. Accepted rooms:
      //   • "ZN-XXXX"  shared-cart codes (guests allowed; only cart events flow there)
      //   • "admin_room" / "admin-room"  admins only (mapped to the real 'admin-room')
      //   • <uuid>  an Order or Mega Basket the caller owns / is the assigned rider of / admin
      // Anything else is refused. Optional ack: ack({ ok, room?, exists?, message? }).
      socket.on('joinRoom', async (roomName, ack) => {
        const reply = (payload) => { if (typeof ack === 'function') { try { ack(payload); } catch { /* ignore */ } } };
        const room = String(roomName || '').trim();
        try {
          if (CART_ROOM_PATTERN.test(room)) {
            // S0: per-socket cart-room cap, token bucket and join budget (guessing codes is rate limited).
            const mine = socket.__cartRooms || (socket.__cartRooms = new Set());
            if (!mine.has(room) && mine.size >= cartRooms.MAX_ROOMS_PER_SOCKET) {
              return reply({ ok: false, code: 'TOO_MANY_BASKETS', message: 'Leave another shared basket first.' });
            }
            if (!cartRooms.takeToken(socket)) return reply({ ok: false, code: 'RATE_LIMITED', message: 'Too fast. Please try again.' });
            if (!mine.has(room) && !cartRooms.joinAllowed(socket)) {
              return reply({ ok: false, code: 'RATE_LIMITED', message: 'Too many basket codes tried. Please wait a few minutes.' });
            }
            const userId = isGuestSocket() ? socket.id : socket.user.id;
            let existed = activeCartRooms.has(room) && activeCartRooms.get(room).size > 0;
            if (!cartRegistry.open(room)) return reply({ ok: false, code: 'BUSY', message: 'Shared baskets are busy right now. Please try again soon.' });
            activeCartRooms.get(room).add(userId);
            mine.add(room);
            socket.effectiveCartId = userId;
            // B1: members / latest basket of this room on EVERY instance (null without Redis).
            const shared = sharedState ? await sharedState.cartJoin(room, userId) : null;
            await socket.join(room);
            // Late joiners get the room's current basket straight away instead of an empty one.
            let snapshot = cartRegistry.snapshot(room);
            let members = activeCartRooms.get(room).size;
            if (shared) {
              existed = existed || shared.existed;
              members = Math.max(members, shared.members);
              if (shared.snapshot && (!snapshot || shared.snapshot.at > snapshot.at)) snapshot = shared.snapshot;
            }
            if (snapshot) socket.emit('cart_updated', cartRooms.sanitizeCart(snapshot.cart) || []);
            log(`[JOIN_ROOM] ${socket.id} -> ${room}`);
            return reply({ ok: true, room, exists: existed, members });
          }

          if (room === 'admin_room' || room === 'admin-room') {
            if (isAdminSocket()) {
              await socket.join('admin-room');
              return reply({ ok: true, room: 'admin-room' });
            }
            console.warn(`[SOCKET_DENIED] ${socket.user?.id} tried to join ${room}`);
            return reply({ ok: false, message: 'Not allowed' });
          }

          if (!isGuestSocket() && UUID_PATTERN.test(room)) {
            if (await canAccessOrderOrBasket(room)) {
              await socket.join(room);
              log(`[JOIN_ROOM] ${socket.id} (${socket.user.role}) -> ${room}`);
              return reply({ ok: true, room });
            }
          }
          console.warn(`[SOCKET_DENIED] ${socket.user?.id || 'anonymous'} tried to join room ${room.slice(0, 64)}`);
          return reply({ ok: false, message: 'Not allowed' });
        } catch (err) {
          console.error('[JOIN_ROOM_ERROR]', err.message);
          return reply({ ok: false, message: 'Could not join right now' });
        }
      });

      socket.on('joinConversation', async (conversationId) => {
        // 🛡️ Only participants of the conversation may join its live room
        if (isGuestSocket()) {
          console.warn(`[SOCKET_DENIED] Anonymous user attempted to join conversation: ${conversationId}`);
          return;
        }
        const id = String(conversationId || '').trim();
        if (!(await isConversationParticipant(id))) {
          console.warn(`[SOCKET_DENIED] ${socket.user.id} is not a participant of conversation ${id.slice(0, 64)}`);
          return;
        }
        const room = `conversation-${id}`;
        await socket.join(room);
        log(`[JOIN_CONVERSATION] ${socket.id} (User: ${socket.user?.id}) -> ${room}`);
      });

      socket.on('cart_change', (data) => {
        const room = String(data?.roomCode || '').trim();
        // 🛡️ Only shared-cart rooms, and only from sockets that joined them
        if (!CART_ROOM_PATTERN.test(room)) return;
        const members = activeCartRooms.get(room);
        const userId = socket.effectiveCartId || (isGuestSocket() ? socket.id : socket.user.id);
        if (!members || !members.has(userId) || !socket.rooms.has(room)) {
          console.warn(`[SOCKET_DENIED] User ${userId} not authorized to broadcast to room ${room}`);
          return;
        }
        // S0: token bucket + whitelisted, bounded items (<= 100 lines, <= 32 KB).
        if (!cartRooms.takeToken(socket)) return;
        const cart = cartRooms.sanitizeCart(data.cart);
        if (!cart) return;
        const snapAt = Date.now();
        cartRegistry.save(room, cart, snapAt);
        if (sharedState) sharedState.cartSaveSnapshot(room, cart, snapAt);
        socket.to(room).emit('cart_updated', cart);
        log(`[CART_SYNC] Room ${room} sync: ${cart.length} items`);
      });

      socket.on('joinAdmin', async () => {
        // 🛡️ Permission Check: Strictly Admin Only
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'admin') {
          await socket.join('admin-room');
          log(`[JOIN_ADMIN] ${socket.id}`);
        } else {
          console.warn(`[SOCKET_ADMIN_DENIED] Unauthorized joinAdmin attempt by ${socket.user?.id}`);
        }
      });
      socket.on('updateLocation', async (data) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider') {
          const room = String(data?.orderId || '').trim();
          if (!UUID_PATTERN.test(room)) return;
          try {
            const { getOrderModel } = require('./models/Order');
            const Order = getOrderModel();
            const order = await Order.findByPk(room);
            if (order && order.deliveryPartnerId === socket.user.id) {
              io.to(room).emit('checkpointUpdated', { orderId: room, currentCheckpoint: data.currentCheckpoint });
              log(`[CHECKPOINT] ${data.orderId} → ${data.currentCheckpoint}`);
            } else {
              console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} not assigned to order ${room} for location update`);
            }
          } catch (err) {
            console.error('[SOCKET_UPDATE_LOCATION_ERROR]', err.message);
          }
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized location update by ${socket.user?.id}`);
        }
      });
      
      // Legacy socket SOS (newer rider apps use POST /api/delivery/sos, which also pushes admins).
      // The admin payload is rebuilt from the rider's own row (same shape as the REST SOS): the raw
      // client object (any size, any keys, spoofable name / order id) is never relayed to admins.
      let lastLegacySosAt = 0;
      socket.on('sos_alert', async (data = {}) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data?.riderId === socket.user.id) {
          const nowMs = Date.now();
          if (nowMs - lastLegacySosAt < 5000) return; // a held / repeated button must not flood the admin room
          lastLegacySosAt = nowMs;
          try {
            const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
            const DP = getDeliveryPartnerModel();
            const partner = await DP.findByPk(socket.user.id, { attributes: ['id', 'name', 'phone', 'liveLocation', 'currentOrderId', 'isSosActive', 'sosAt', 'sosNote', 'sosLocation'] });
            if (!partner) return;
            // Coordinates only (no note: the legacy client has no note field). Same rules as the REST SOS.
            const { sosLocationOf } = require('./controllers/deliveryPartnerController');
            const now = new Date();
            const fresh = sosLocationOf({ lat: data.lat, lng: data.lng, latitude: data.latitude, longitude: data.longitude }, partner.liveLocation, now.getTime());
            const repeat = partner.isSosActive && partner.sosAt && now - new Date(partner.sosAt) < 30000;
            const prevLocation = typeof partner.sosLocation === 'string' ? (() => { try { return JSON.parse(partner.sosLocation); } catch { return null; } })() : partner.sosLocation;
            const location = repeat && (!fresh || (fresh.stale && prevLocation && !prevLocation.stale)) ? (prevLocation || fresh) : fresh;
            // A new SOS never carries the note of an older, resolved one; a repeat keeps the note of the first tap.
            const note = repeat && partner.sosNote ? String(partner.sosNote) : null;
            // Keep it on the rider row so an admin who opens the dashboard later still sees it.
            await DP.update({ isSosActive: true, sosAt: repeat ? partner.sosAt : now, sosLocation: location || null, sosNote: note }, { where: { id: partner.id } })
              .catch((e) => console.warn('[SOS_PERSIST_WARN]', e.message));
            const payload = {
              riderId: partner.id,
              riderName: partner.name,
              riderPhone: partner.phone || null,
              timestamp: (repeat ? new Date(partner.sosAt) : now).toISOString(),
              lat: location ? location.lat : undefined,
              lng: location ? location.lng : undefined,
              location,
              orderId: partner.currentOrderId || null,
              note: note || undefined,
            };
            log(`[CRITICAL SOS] (legacy socket) rider ${partner.id} at ${payload.timestamp}`);
            io.to('admin-room').emit('sos_received', payload);
          } catch (e) { console.warn('[SOS_LEGACY_WARN]', e.message); }
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized sos_alert attempt by user ${socket.user?.id}`);
        }
      });

      // Banner to every connected app. The dashboard waits for the ack ({ ok }) before it shows
      // success. Only { message (1-300 chars), type } is relayed, never the raw client payload.
      const BANNER_TYPES = ['info', 'warning', 'promo', 'emergency'];
      socket.on('admin_broadcast', async (data = {}, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          // 🛡️ Permission Check: Admin Only (role loaded from the live account at connect)
          if (!(socket.user && socket.user.role && socket.user.role.toLowerCase() === 'admin')) {
            console.warn(`[SOCKET_BROADCAST_DENIED] Unauthorized broadcast by ${socket.user?.id}`);
            return reply({ ok: false, code: 'FORBIDDEN', message: 'Only admins can send banners. Sign in again.' });
          }
          const message = typeof data?.message === 'string' ? data.message.replace(/[<>]/g, '').trim() : '';
          if (!message) return reply({ ok: false, code: 'INVALID_INPUT', message: 'Write the banner message first.' });
          if (message.length > 300) return reply({ ok: false, code: 'INVALID_INPUT', message: 'Banner messages can be at most 300 characters.' });
          const type = BANNER_TYPES.includes(data?.type) ? data.type : null;
          if (!type) return reply({ ok: false, code: 'INVALID_INPUT', message: `Banner type must be one of ${BANNER_TYPES.join(', ')}.` });
          const banner = { message, type, timestamp: new Date().toISOString() };
          log(`[MEGAPHONE] Admin broadcast by ${socket.user.id}: "${message}" (type: ${type})`);
          io.emit('global_announcement', banner);
          require('./utils/realtime').publish('announcement', 'created', null, { scope: 'broadcast' });
          try {
            const { getVerificationLogModel } = require('./models/VerificationLog');
            await getVerificationLogModel().create({ adminId: String(socket.user.id), targetId: 'global', action: 'ADMIN_BANNER_BROADCAST', details: JSON.stringify({ type, message }) });
          } catch (auditErr) {
            console.warn('[MEGAPHONE_AUDIT_WARN]', auditErr.message);
          }
          reply({ ok: true, sentAt: banner.timestamp });
        } catch (err) {
          console.error('[MEGAPHONE_ERROR]', err.message);
          reply({ ok: false, message: 'Could not send the banner. Please try again.' });
        }
      });

      socket.on('inventory_update', async (data = {}) => {
        // 🛡️ Admin, or the restaurant that owns the item. The item's real state is read from the
        // DB and only {itemId, restaurantId, isAvailable} is relayed (never the raw client payload).
        const role = socketRole();
        if (!['admin', 'restaurant'].includes(role) || isGuestSocket()) {
          console.warn(`[SOCKET_DENIED] Unauthorized inventory_update by ${socket.user?.id}`);
          return;
        }
        const itemId = String(data?.itemId || '').trim();
        if (!itemId || itemId.length > 64) return;
        const { getMenuItemModel } = require('./models/MenuItem');
        const item = await getMenuItemModel().findByPk(itemId, { attributes: ['id', 'restaurantId', 'isAvailable'] });
        if (!item || (role === 'restaurant' && String(item.restaurantId) !== String(socket.user.id))) {
          console.warn(`[SOCKET_DENIED] ${socket.user?.id} sent inventory_update for item it does not own`);
          return;
        }
        log(`[INVENTORY] Item ${item.id} is now ${item.isAvailable ? 'available' : 'SOLD OUT'}`);
        io.emit('inventory_updated', { itemId: item.id, restaurantId: item.restaurantId, isAvailable: !!item.isAvailable });
      });

      // Display name comes from the account, never from the client payload.
      const getDisplayName = async () => {
        if (socket.data.displayName) return socket.data.displayName;
        let name = null;
        try {
          if (!isGuestSocket()) {
            if (socketRole() === 'rider') {
              const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
              const p = await getDeliveryPartnerModel().findByPk(socket.user.id, { attributes: ['name'] });
              name = p?.name || null;
            } else if (socketRole() === 'restaurant') {
              const { getRestaurantModel } = require('./models/Restaurant');
              const r = await getRestaurantModel().findByPk(socket.user.id, { attributes: ['name'] });
              name = r?.name || null;
            } else {
              const { getUserModel } = require('./models/User');
              const u = await getUserModel().findByPk(socket.user.id, { attributes: ['name'] });
              name = u?.name || null;
            }
          }
        } catch (e) {
          console.warn('[SOCKET_NAME_LOOKUP_WARN]', e.message);
        }
        socket.data.displayName = name || (socketRole() === 'rider' ? 'Your rider' : socketRole() === 'admin' ? 'Zenvy Support' : 'Customer');
        return socket.data.displayName;
      };

      // Order chat typing indicators: only for sockets that joined the order room (joinOrder / joinRoom).
      socket.on('typing_start', async (data) => {
        const room = String(data?.orderId || '').trim();
        if (!room || !socket.rooms.has(room)) return;
        socket.to(room).emit('typing_start', { sender: await getDisplayName() });
      });

      socket.on('typing_end', async (data) => {
        const room = String(data?.orderId || '').trim();
        if (!room || !socket.rooms.has(room)) return;
        socket.to(room).emit('typing_end', { sender: await getDisplayName() });
      });

      socket.on('friend_typing_start', (data) => {
        const room = `conversation-${data?.conversationId}`;
        if (!socket.rooms.has(room)) return;
        socket.to(room).emit('friend_typing_start', { senderId: socket.user.id });
      });

      socket.on('friend_typing_end', (data) => {
        const room = `conversation-${data?.conversationId}`;
        if (!socket.rooms.has(room)) return;
        socket.to(room).emit('friend_typing_end', { senderId: socket.user.id });
      });

      // --- Zenvy After Dark Social Engine ---
      // Rooms are keyed by an accepted Friendship id; only the two friends may join, and only
      // during After Dark hours (utils/afterDark.js, IST). Guests are never allowed.
      const { isAfterDarkNow, afterDarkStatus } = afterDarkMod; // resolved once, not per socket connection
      const afterDarkClosed = () => {
        // C2: admin kill switch (cached GlobalConfig AFTER_DARK_ENABLED) closes it whatever the hour.
        if (!require('./utils/featureSwitches').peek('afterDark')) {
          socket.emit('after_dark_closed', { open: false, enabled: false, message: 'Zenvy After Dark is paused right now.' });
          return true;
        }
        if (isAfterDarkNow()) return false;
        const s = afterDarkStatus();
        socket.emit('after_dark_closed', { ...s, message: `Zenvy After Dark opens at ${s.opensAt} IST.` });
        return true;
      };

      socket.on('join_after_dark_group', async (data) => {
        if (afterDarkClosed()) return;
        const friendshipId = String(data?.groupId || '').trim();
        if (!(await isFriendshipMember(friendshipId))) {
          console.warn(`[SOCKET_DENIED] ${socket.user?.id} tried to join afterdark_${friendshipId.slice(0, 64)}`);
          return;
        }
        const groupId = `afterdark_${friendshipId}`;
        await socket.join(groupId);
        log(`[AFTER_DARK] User ${socket.user?.id} joined group ${groupId}`);
      });

      socket.on('leave_after_dark_group', async (data) => {
        const groupId = `afterdark_${data?.groupId}`;
        await socket.leave(groupId);
        log(`[AFTER_DARK] User ${socket.user?.id} left group ${groupId}`);
      });

      socket.on('send_after_dark_message', async (data) => {
        if (afterDarkClosed()) return;
        const groupId = String(data?.groupId || '').trim();
        const room = `afterdark_${groupId}`;
        if (!socket.rooms.has(room)) return; // must have passed join_after_dark_group
        let text = typeof data?.text === 'string' ? data.text.trim().slice(0, 2000) : '';
        if (!text) return;
        // S0 (P1-2): access can end after joining (unfriended, removed from the room, room closed).
        if (!(await isFriendshipMember(groupId))) {
          socket.leave(room);
          socket.emit('after_dark_error', { code: 'NOT_A_PARTICIPANT', message: 'You are not part of this chat any more.' });
          return;
        }
        // C2: slurs / threats refused, profanity masked.
        const afterDarkFilter = require('./utils/contentFilter').analyse(text);
        if (afterDarkFilter.action === 'block') {
          socket.emit('after_dark_error', { code: 'CONTENT_BLOCKED', message: require('./utils/contentFilter').BLOCK_MESSAGE });
          return;
        }
        text = afterDarkFilter.text;

        try {
          const senderName = await getDisplayName();
          const { getMessageModel } = require('./models/Message');
          const Message = getMessageModel();
          // S0: a quoted reply is rebuilt from the quoted message of THIS chat (never the client's object).
          let cleanReplyTo = null;
          const quotedId = data.replyTo && typeof data.replyTo === 'object' ? data.replyTo.id : null;
          if (typeof quotedId === 'string' && UUID_PATTERN.test(quotedId)) {
            const quoted = await Message.findOne({ where: { id: quotedId, conversationId: groupId } });
            if (quoted) {
              let qText = '';
              try { qText = String(require('./modules/campus/campusHelpers').readableText(quoted.text) || ''); } catch { qText = ''; }
              cleanReplyTo = {
                id: quoted.id,
                senderId: quoted.senderId,
                senderName: quoted.senderName || 'Friend',
                text: quoted.isDeletedForEveryone ? 'This message was deleted' : qText.slice(0, 200),
              };
            }
          }
          const newMsg = await Message.create({
            conversationId: groupId,
            senderId: socket.user.id,
            senderName,
            text,
            replyTo: cleanReplyTo ? JSON.stringify(cleanReplyTo) : null,
            reactions: '[]'
          });
          io.to(room).emit('receive_after_dark_message', newMsg);

          // Push the other friend
          try {
            const { getFriendshipModel } = require('./models/Friendship');
            const friendship = await getFriendshipModel().findByPk(groupId);
            if (friendship) {
              const receiverId = friendship.requesterId === socket.user.id ? friendship.recipientId : friendship.requesterId;
              const { getUserModel } = require('./models/User');
              const receiver = await getUserModel().findByPk(receiverId);
              if (receiver && receiver.fcmTokens && receiver.fcmTokens.length > 0) {
                const { sendPushToTokens } = require('./utils/push');
                await sendPushToTokens(
                  receiver.fcmTokens,
                  `New message from ${senderName}`,
                  text,
                  { type: 'chat_message', groupId, senderName }
                );
              }
            }
          } catch (pushErr) {
            console.error('[AFTER_DARK_PUSH_ERR]', pushErr);
          }
        } catch (err) {
          console.error('[AFTER_DARK_MSG_ERR]', err);
        }
      });

      socket.on('react_to_after_dark_message', async (data) => {
        const { messageId, emoji } = data || {};
        const groupId = String(data?.groupId || '').trim();
        const room = `afterdark_${groupId}`;
        if (!socket.rooms.has(room) || typeof emoji !== 'string' || emoji.length > 16) return;
        if (!UUID_PATTERN.test(String(messageId || ''))) return;
        // S0 (P1-2): re-check access (removed from the room / unfriended since joining).
        if (!(await isFriendshipMember(groupId))) { socket.leave(room); return; }
        try {
          const { getMessageModel } = require('./models/Message');
          const Message = getMessageModel();
          const msg = await Message.findByPk(messageId);
          if (msg && String(msg.conversationId) === groupId) {
            let currentReactions = [];
            try {
              currentReactions = msg.reactions ? JSON.parse(msg.reactions) : [];
            } catch(e) {
              console.warn('[SERVER_SOCKET] Failed to parse message reactions:', e.message);
            }
            if (!Array.isArray(currentReactions)) currentReactions = [];

            // One reaction per user
            currentReactions = currentReactions.filter(r => r.userId !== socket.user.id);
            currentReactions.push({
              emoji,
              userId: socket.user.id,
              userName: await getDisplayName()
            });

            msg.reactions = JSON.stringify(currentReactions);
            await msg.save();

            io.to(room).emit('receive_message_reaction', {
              messageId,
              reactions: currentReactions
            });
          }
        } catch(err) {
          console.error('[REACT_MSG_ERR]', err);
        }
      });

      // Call Signaling (Limit 20). Only the two friends of the After Dark room can join.
      socket.on('join_after_dark_call', async (data) => {
        if (afterDarkClosed()) return;
        const friendshipId = String(data?.groupId || '').trim();
        if (!(await isFriendshipMember(friendshipId))) {
          socket.emit('call_error', { message: 'You can only join calls with your friends or rooms you are in.' });
          return;
        }
        const callRoom = `afterdark_call_${friendshipId}`;
        const userName = await getDisplayName();

        // Initiator starting the call: ring the friend (socket + push)
        const ringFriend = () => {
          const groupRoom = `afterdark_${friendshipId}`;
          socket.to(groupRoom).emit('incoming_call_signal', {
            groupId: friendshipId,
            callerName: userName,
            mode: data.video ? 'video' : 'audio'
          });
          (async () => {
            try {
              const { getFriendshipModel } = require('./models/Friendship');
              const friendship = await getFriendshipModel().findByPk(friendshipId);
              if (friendship) {
                const receiverId = friendship.requesterId === socket.user.id ? friendship.recipientId : friendship.requesterId;
                const { getUserModel } = require('./models/User');
                const receiver = await getUserModel().findByPk(receiverId);
                if (receiver && receiver.fcmTokens && receiver.fcmTokens.length > 0) {
                  const { sendPushToTokens } = require('./utils/push');
                  await sendPushToTokens(
                    receiver.fcmTokens,
                    `📞 Incoming Zenvy Call`,
                    `${userName} is calling you...`,
                    {
                      type: 'call',
                      callerName: userName,
                      mode: data.video ? 'video' : 'audio',
                      groupId: friendshipId
                    },
                    {
                      android: {
                        priority: 'high',
                        ttl: 60000,
                        notification: {
                          sound: 'default',
                          channelId: 'incoming-calls',
                          priority: 'max',
                          visibility: 'public'
                        }
                      },
                      apns: {
                        payload: {
                          aps: {
                            sound: 'default',
                            badge: 1
                          }
                        }
                      }
                    }
                  );
                  console.log(`[CALL_PUSH] Sent call signaling push to receiverId ${receiverId}`);
                }
              }
            } catch (err) {
              console.error('[CALL_PUSH_ERR]', err);
            }
          })();
        };

        // B1: Redis-shared call state when REDIS_URL is set and Redis is up (utils/afterDarkCalls).
        if (afterDarkCalls.active()) {
          const handled = await afterDarkCalls.join(io, socket, callRoom, {
            userId: socket.user.id,
            socketId: socket.id,
            userName,
            mute: !!data.mute,
            video: !!data.video,
            isSpeaker: data.isSpeaker !== undefined ? !!data.isSpeaker : true,
            requestToSpeak: false,
          }, ringFriend);
          if (handled) { log(`[AFTER_DARK_CALL] User ${socket.user.id} joined call ${callRoom} (shared)`); return; }
        }

        if (!activeCallRooms.has(callRoom)) {
          activeCallRooms.set(callRoom, new Map());
        }
        const roomMap = activeCallRooms.get(callRoom);

        if (roomMap.size >= 20) {
          socket.emit('call_error', { message: 'This lounge is full (Max 20 participants).' });
          return;
        }

        socket.join(callRoom);
        if (roomMap.size === 0) callHosts.set(callRoom, socket.id);
        roomMap.set(socket.id, {
          userId: socket.user.id,
          socketId: socket.id,
          userName,
          mute: !!data.mute,
          video: !!data.video,
          isSpeaker: data.isSpeaker !== undefined ? !!data.isSpeaker : true,
          requestToSpeak: false,
          isHost: callHosts.get(callRoom) === socket.id
        });

        if (roomMap.size === 1) ringFriend();

        // Send list of all current participants
        const participants = Array.from(roomMap.values());
        io.to(callRoom).emit('call_participants_list', { participants });

        socket.to(callRoom).emit('user_joined_call', roomMap.get(socket.id));
        log(`[AFTER_DARK_CALL] User ${socket.user.id} joined call ${callRoom}`);
      });

      const leaveCallRoom = (callRoom) => {
        const roomMap = activeCallRooms.get(callRoom);
        if (!roomMap || !roomMap.has(socket.id)) return;
        const p = roomMap.get(socket.id);
        roomMap.delete(socket.id);
        if (roomMap.size === 0) {
          activeCallRooms.delete(callRoom);
          callHosts.delete(callRoom);
        } else if (callHosts.get(callRoom) === socket.id) {
          // Hand hosting to the longest-standing participant
          const nextHost = roomMap.keys().next().value;
          callHosts.set(callRoom, nextHost);
          const hp = roomMap.get(nextHost);
          if (hp) hp.isHost = true;
        }
        io.to(callRoom).emit('call_participants_list', { participants: Array.from(roomMap.values()) });
        socket.to(callRoom).emit('user_left_call', {
          userId: socket.user?.id || socket.id,
          socketId: socket.id,
          userName: p?.userName || 'Friend'
        });
        log(`[AFTER_DARK_CALL] User ${socket.user?.id} left call ${callRoom}`);
      };

      socket.on('leave_after_dark_call', async (data) => {
        const callRoom = `afterdark_call_${data?.groupId}`;
        socket.leave(callRoom);
        if (afterDarkCalls.active() && await afterDarkCalls.leave(io, socket, callRoom)) return;
        leaveCallRoom(callRoom);
      });

      socket.on('update_call_state', async (data) => {
        const callRoom = `afterdark_call_${data?.groupId}`;
        if (afterDarkCalls.active() && await afterDarkCalls.updateState(io, socket, callRoom, data)) return;
        const roomMap = activeCallRooms.get(callRoom);
        if (roomMap && roomMap.has(socket.id)) {
          const participant = roomMap.get(socket.id);
          if (data.mute !== undefined) participant.mute = !!data.mute;
          if (data.video !== undefined) participant.video = !!data.video;
          // Only the host can make someone (including themselves) a speaker; others may only step down.
          if (data.isSpeaker !== undefined && (callHosts.get(callRoom) === socket.id || data.isSpeaker === false)) {
            participant.isSpeaker = !!data.isSpeaker;
          }
          if (data.requestToSpeak !== undefined) participant.requestToSpeak = !!data.requestToSpeak;

          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });
        }
      });

      // Host-only moderation
      socket.on('approve_speaker', async (data) => {
        const callRoom = `afterdark_call_${data?.groupId}`;
        if (afterDarkCalls.active() && await afterDarkCalls.moderate(io, socket, callRoom, data.targetSocketId, 'approve', data.groupId)) return;
        const roomMap = activeCallRooms.get(callRoom);
        if (!roomMap || callHosts.get(callRoom) !== socket.id) return;
        if (roomMap.has(data.targetSocketId)) {
          const participant = roomMap.get(data.targetSocketId);
          participant.isSpeaker = true;
          participant.requestToSpeak = false;

          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });

          io.to(data.targetSocketId).emit('speaker_approved', { groupId: data.groupId });
        }
      });

      socket.on('mute_user', async (data) => {
        const callRoom = `afterdark_call_${data?.groupId}`;
        if (afterDarkCalls.active() && await afterDarkCalls.moderate(io, socket, callRoom, data.targetSocketId, 'mute', data.groupId)) return;
        const roomMap = activeCallRooms.get(callRoom);
        if (!roomMap || callHosts.get(callRoom) !== socket.id) return;
        if (roomMap.has(data.targetSocketId)) {
          const participant = roomMap.get(data.targetSocketId);
          participant.mute = true;

          const participants = Array.from(roomMap.values());
          io.to(callRoom).emit('call_participants_list', { participants });

          io.to(data.targetSocketId).emit('user_muted_by_host', { groupId: data.groupId });
        }
      });
      // --------------------------------------

      // Order chat: only the order's customer, its assigned rider (both must have joined the
      // order room via joinOrder / joinRoom) or an admin. Sender name and role come from the account.
      const orderRoleLabel = () => (socketRole() === 'rider' ? 'rider' : socketRole() === 'admin' ? 'admin' : 'customer');
      const canTalkInOrderRoom = (room) => !isGuestSocket() && !!room && (socket.rooms.has(room) || isAdminSocket());

      socket.on('sendMessage', async (data) => {
        const room = String(data?.orderId || '').trim();
        if (!canTalkInOrderRoom(room)) {
          console.warn(`[SOCKET_DENIED] ${socket.user?.id || 'anonymous'} tried to chat in order room ${room.slice(0, 64)}`);
          return;
        }
        const message = typeof data?.message === 'string' ? data.message.trim().slice(0, 1000) : '';
        if (!message) return;
        const chatData = {
          orderId: room,
          sender: await getDisplayName(),
          senderId: socket.user.id,
          senderRole: orderRoleLabel(),
          message,
          timestamp: new Date()
        };
        log(`[CHAT] ${chatData.senderRole} in room ${room}`);
        io.to(room).emit('receiveMessage', chatData);
        // Intercept for admin monitoring
        io.to('admin-room').emit('admin_intercept_chat', chatData);
      });

      socket.on('report_issue', async (data) => {
        const room = String(data?.orderId || '').trim();
        if (!canTalkInOrderRoom(room)) {
          console.warn(`[SOCKET_DENIED] ${socket.user?.id || 'anonymous'} tried to report an issue on ${room.slice(0, 64)}`);
          return;
        }
        const role = orderRoleLabel();
        const issue = {
          orderId: room,
          senderRole: role.charAt(0).toUpperCase() + role.slice(1),
          senderId: socket.user.id,
          senderName: await getDisplayName(),
          issueType: String(data?.issueType || 'Other').slice(0, 80),
          details: String(data?.details || '').slice(0, 1000),
          timestamp: new Date()
        };
        log(`[ISSUE] ${issue.senderRole} reported: ${issue.issueType} for order ${room}`);
        // Notify both parties in the room and the admin
        io.to(room).emit('issue_alert', issue);
        io.to('admin-room').emit('admin_issue_reported', issue);
      });

      // ── F6: Group Order Polls (shared-cart rooms only, members only) ────────────────────
      const inCartRoom = (room) => CART_ROOM_PATTERN.test(room) && socket.rooms.has(room);

      socket.on('poll_create', (data) => {
        const room = String(data?.roomCode || '').trim();
        if (!inCartRoom(room)) return;
        const options = Array.isArray(data.options)
          ? data.options.filter((o) => typeof o === 'string' && o.trim()).slice(0, 10).map((o) => o.trim().slice(0, 80))
          : [];
        if (options.length < 2) return;
        const poll = {
          id: `poll_${Date.now()}`,
          question: (typeof data.question === 'string' && data.question.trim().slice(0, 140)) || 'Where should we order from?',
          options,
          votes: {},
          createdBy: isGuestSocket() ? socket.id : socket.user.id,
          createdAt: new Date().toISOString()
        };
        io.to(room).emit('poll_started', poll);
        log(`[POLL] Created in room ${room}`);
      });

      socket.on('poll_vote', async (data) => {
        const room = String(data?.roomCode || '').trim();
        if (!inCartRoom(room)) return;
        io.to(room).emit('poll_vote_update', {
          pollId: data.pollId,
          optionIndex: Number(data.optionIndex) || 0,
          voterId: isGuestSocket() ? socket.id : socket.user.id,
          voterName: isGuestSocket() ? 'Guest' : await getDisplayName()
        });
      });

      socket.on('poll_end', (data) => {
        const room = String(data?.roomCode || '').trim();
        if (!inCartRoom(room)) return;
        io.to(room).emit('poll_ended', {
          pollId: data.pollId,
          winnerIndex: data.winnerIndex,
          winnerOption: typeof data.winnerOption === 'string' ? data.winnerOption.slice(0, 80) : data.winnerOption
        });
      });

      // ── Cross-Portal: Rider ↔ Admin ↔ Customer ────────────────
      // Rider-app fields relayed to the admin room are plain bounded strings (an object / huge value
      // would crash or flood every admin dashboard that renders it).
      const adminSafeText = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[<>]/g, '').slice(0, max) : undefined);

      // Rider came online: broadcast to admin dashboard
      socket.on('rider_connected', (data = {}) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data?.driverId === socket.user.id) {
          log(`[RIDER ONLINE] ${data.name} (${data.driverId})`);
          io.to('admin-room').emit('admin_rider_online', { riderId: data.driverId, name: adminSafeText(data.name, 60), timestamp: new Date().toISOString() });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_connected attempt by user ${socket.user?.id}`);
        }
      });

      // Rider went offline
      socket.on('rider_disconnected', (data = {}) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data?.driverId === socket.user.id) {
          log(`[RIDER OFFLINE] ${data.driverId}`);
          io.to('admin-room').emit('admin_rider_offline', { riderId: data.driverId, timestamp: new Date().toISOString() });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_disconnected attempt by user ${socket.user?.id}`);
        }
      });

      // Rider toggled online/offline status
      socket.on('rider_status_change', (data = {}) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data?.riderId === socket.user.id) {
          log(`[RIDER STATUS] ${data.name} → ${data.isOnline ? 'ONLINE' : 'OFFLINE'}`);
          io.to('admin-room').emit('admin_rider_status', { riderId: data.riderId, name: adminSafeText(data.name, 60), isOnline: data.isOnline === true });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_status_change attempt by user ${socket.user?.id}`);
        }
      });

      // Rider accepted → notify admin + join the broadcast room
      socket.on('rider_accepted', async (data = {}) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data?.riderId === socket.user.id) {
          const room = String(data.orderId || '').trim();
          // Only the rider actually assigned to the order may join its room (chat, GPS, status).
          if (!(await canAccessOrderOrBasket(room))) {
            console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} is not assigned to ${room.slice(0, 64)}`);
            return;
          }
          await socket.join(room);
          log(`[RIDER ACCEPTED] ${data.riderName} accepted order ${data.orderId}`);
          io.to('admin-room').emit('admin_order_accepted', { orderId: room, riderId: data.riderId, riderName: adminSafeText(data.riderName, 60) });
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_accepted attempt by user ${socket.user?.id}`);
        }
      });

      // Rider live GPS → admin map + customer tracking (already via updateLocation, this is admin stream)
      socket.on('rider_location_update', async (data) => {
        data = data || {};
        if (!data.activeOrderId && data.orderId) data.activeOrderId = data.orderId; // newer rider app field name
        if (!data.riderId && socket.user) data.riderId = socket.user.id;
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data.riderId === socket.user.id) {
          // Verify activeOrderId if provided
          if (data.activeOrderId) {
            try {
              const { getOrderModel } = require('./models/Order');
              const Order = getOrderModel();
              const order = await Order.findByPk(String(data.activeOrderId).trim(), { attributes: ['id', 'deliveryPartnerId', 'status'] });
              if (!order || order.deliveryPartnerId !== socket.user.id) {
                console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} tried to update location for unauthorized order ${data.activeOrderId}`);
                return;
              }
              // Delivered / cancelled: the customer's tracking room no longer gets the rider's position.
              if (['Delivered', 'Cancelled'].includes(order.status)) data.activeOrderId = null;
            } catch (err) {
              console.error('[SOCKET_RIDER_LOCATION_UPDATE_ERROR]', err.message);
              return;
            }
          }

          // Real GPS (when the rider app sends lat/lng): stored on the rider, at most every 10 s,
          // so dispatch can use real positions instead of a fixed fallback point.
          const lat = Number(data.lat ?? data.latitude);
          const lng = Number(data.lng ?? data.longitude);
          const hasFix = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
          if (hasFix && (!socket.data.lastGpsSaveAt || Date.now() - socket.data.lastGpsSaveAt > 10000)) {
            socket.data.lastGpsSaveAt = Date.now();
            try {
              const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');
              await getDeliveryPartnerModel().update(
                { liveLocation: { lat, lng, heading: Number(data.heading) || null, speed: Number(data.speed) || null, ts: new Date().toISOString() } },
                { where: { id: socket.user.id } }
              );
            } catch (gpsErr) {
              console.warn('[RIDER_GPS_SAVE_WARN]', gpsErr.message);
            }
          }

          // Broadcast checkpoint to admin dashboard room ONLY
          // Admin-room only, so the coordinates are visible to admins and nobody else.
          // Client fields are typed and bounded here: an object / huge string as riderName used to reach
          // every admin dashboard as-is (React cannot render an object: the dashboard crashed).
          const orderCount = Number(data.activeOrderCount);
          io.to('admin-room').emit('admin_rider_location', {
            riderId: data.riderId,
            riderName: adminSafeText(data.riderName, 60),
            currentCheckpoint: adminSafeText(data.currentCheckpoint, 80),
            activeOrderCount: Number.isFinite(orderCount) && orderCount >= 0 ? Math.min(Math.floor(orderCount), 50) : 0,
            isOnline: data.isOnline !== false,
            ...(hasFix ? { lat, lng, heading: Number(data.heading) || null, ts: Date.now() } : {}),
            timestamp: Date.now()
          });
          // Also emit to specific order room for customer tracking
          if (data.activeOrderId) {
              if (data.currentCheckpoint !== undefined && (typeof data.currentCheckpoint === 'number' || (typeof data.currentCheckpoint === 'string' && data.currentCheckpoint.length <= 80))) {
                io.to(String(data.activeOrderId)).emit('checkpointUpdated', { orderId: String(data.activeOrderId), currentCheckpoint: data.currentCheckpoint });
              }
              // Live map: the customer's order room gets the rider's real position (no PIN, no other orders).
              if (hasFix) {
                io.to(String(data.activeOrderId)).emit('riderLocation', {
                  orderId: String(data.activeOrderId), lat, lng,
                  heading: Number(data.heading) || null, speed: Number(data.speed) || null, ts: Date.now(),
                });
              }
          }
          log(`[GPS] Rider ${data.riderName} at ${data.currentCheckpoint}`);
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_location_update by user ${socket.user?.id}`);
        }
      });

      // Rider completed a delivery
      socket.on('rider_delivered', async (data = {}) => {
        if (socket.user && socket.user.role && socket.user.role.toLowerCase() === 'rider' && data?.riderId === socket.user.id) {
          try {
            const { getOrderModel } = require('./models/Order');
            const Order = getOrderModel();
            const order = await Order.findByPk(String(data.orderId).trim());
            if (order && order.deliveryPartnerId === socket.user.id) {
              log(`[DELIVERED] ${data.riderName} completed order ${data.orderId} (+₹${data.earnings})`);
              io.to('admin-room').emit('admin_delivery_complete', {
                orderId: order.id,
                riderId: data.riderId,
                riderName: adminSafeText(data.riderName, 60),
                earnings: Number.isFinite(Number(data.earnings)) ? Number(data.earnings) : undefined,
                timestamp: new Date().toISOString()
              });
            } else {
              console.warn(`[SOCKET_DENIED] Rider ${socket.user.id} not assigned to order ${data.orderId} for delivery completion`);
            }
          } catch (err) {
            console.error('[SOCKET_RIDER_DELIVERED_ERROR]', err.message);
          }
        } else {
          console.warn(`[SOCKET_DENIED] Unauthorized rider_delivered attempt by user ${socket.user?.id}`);
        }
      });

      socket.on('disconnect', () => {
        console.log(`[SOCKET DISCONNECT] ${socket.id}`);
        // A rider who closed the app must not stay "online" forever (dispatch pushes go to online
        // riders). After a grace period with no rider socket and no fresh GPS, mark them offline.
        if (!isGuestSocket() && socketRole() === 'rider') scheduleRiderOfflineCheck(socket.user.id);
        // Clean up from voice call rooms (hands hosting over when the host drops)
        for (const callRoom of Array.from(activeCallRooms.keys())) {
          if (activeCallRooms.get(callRoom)?.has(socket.id)) leaveCallRoom(callRoom);
        }
        // B1: shared (Redis) call rooms this socket joined.
        for (const callRoom of afterDarkCalls.roomsOf(socket)) {
          afterDarkCalls.leave(io, socket, callRoom).catch((err) => console.warn('[AFTER_DARK_CALL_LEAVE_WARN]', err.message));
        }
        // Forget this socket's shared-cart membership (a signed-in member stays listed while
        // another of their sockets is still in the room).
        const memberId = socket.effectiveCartId;
        if (memberId) {
          for (const [room, members] of activeCartRooms.entries()) {
            if (!members.has(memberId)) continue;
            const live = io.sockets.adapter.rooms.get(room) || new Set();
            const stillHere = Array.from(live).some((sid) => sid !== socket.id && io.sockets.sockets.get(sid)?.effectiveCartId === memberId);
            if (!stillHere) {
              members.delete(memberId);
              // B1: this instance no longer has the member in the room (another instance may; it
              // re-adds them on their next join).
              if (sharedState) sharedState.cartLeave(room, memberId);
            }
          }
        }
      });
    });

    // Everything is registered: open the gates for /api and sockets.
    markDbReady();
    console.log(`✅ [STARTUP] Database ready — API accepting requests (${Math.round(process.uptime())}s after boot)`);

    // A4: hot-path indexes (CREATE INDEX CONCURRENTLY on Postgres), a few seconds after ready, one
    // process only, never blocking startup or traffic. ENSURE_INDEXES=false disables it.
    try {
      require('./scripts/ensure_indexes').scheduleEnsureIndexes({ shouldStop: () => lifecycle.isShuttingDown() });
    } catch (idxErr) {
      console.warn('⚠️ [ENSURE_INDEXES] not started:', idxErr.message);
    }

    // Background, post-ready maintenance (never blocks requests).
    (async () => {
      // Auto-backfill missing friendCodes on startup (especially for Render PostgreSQL DB)
      try {
        const { getUserModel } = require('./models/User');
        const User = getUserModel();
        if (User) {
          const users = await User.findAll({ where: { friendCode: null } });
          if (users.length > 0) {
            console.log(`[BOOT] Backfilling friendCode for ${users.length} users...`);
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            for (const user of users) {
              let code = '';
              for (let i = 0; i < 5; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
              }
              user.friendCode = 'ZNV-' + code;
              await user.save();
            }
            console.log('[BOOT] Backfill completed.');
          }
        }
      } catch (err) {
        console.error('[BOOT_ERROR] FriendCode backfill failed:', err.message);
      }
    })();

  } catch (error) {
    console.error('❌ Server failed to start. CRITICAL ERROR:');
    console.error(error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
};

// Open the port first, then initialize the database. Guarded so nothing can start twice.
let serverStarted = false;
const PORT = process.env.PORT || 8080;
const startServer = () => {
  if (serverStarted) return;
  serverStarted = true;

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is in use. Process probably hasn't exited yet. Shutting down...`);
      process.exit(1);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server listening on port ${PORT} — initializing database in the background...`);
    // Cached database ping for /readyz and /api/health (one SELECT 1 every ~5 s, 1 s timeout).
    lifecycle.startDbPing(() => require('./config/db').getSequelize());
    perfMetrics.startLogger();

    // ── Self-Ping Keep-Alive (Prevents Render Free Tier Sleep) ──
    // Per process, no data written. KEEPALIVE=false switches it off (paid plans never sleep).
    if (isProductionEnv() && String(process.env.KEEPALIVE || '').trim().toLowerCase() !== 'false') {
      const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutes (Render sleeps at 15 min)
      // Render's own address (never PUBLIC_API_URL: the ping must reach this service, not a CDN).
      const selfUrl = require('./utils/publicUrl').selfUrl(PORT);
      setInterval(async () => {
        try {
          const https = require('https');
          const httpModule = require('http');
          const mod = selfUrl.startsWith('https') ? https : httpModule;
          mod.get(`${selfUrl}/api/health`, (res) => {
            console.log(`[KEEP_ALIVE] Ping OK (${res.statusCode})`);
          }).on('error', (err) => {
            console.warn('[KEEP_ALIVE] Ping failed:', err.message);
          });
        } catch (err) {
          console.warn('[KEEP_ALIVE] Error:', err.message);
        }
      }, KEEP_ALIVE_INTERVAL);
      console.log(`🏓 Keep-alive enabled: pinging every ${KEEP_ALIVE_INTERVAL / 60000} minutes`);
    }
  });

  // ── Graceful shutdown (utils/lifecycle.js) ──────────────────────────────────────────────────
  // SIGTERM / SIGINT: /readyz 503, no new connections (idle keep-alives closed, in-flight requests
  // finish), jobs stopped (in-flight runs awaited), 'server:draining' to every socket then transports
  // closed in batches (clients auto-reconnect to the new instance), logs flushed, sequelize.close(),
  // exit 0. Hard exit (also code 0) at SHUTDOWN_TIMEOUT_MS (default 25 s; Render maxShutdownDelaySeconds 45).
  lifecycle.configureShutdown({
    server,
    io,
    stopJobs: (opts) => require('./jobs').stopJobs(opts),
    flushLogs: flushLogsSync,
    closeDb: async () => {
      const instance = require('./config/db').getSequelize();
      if (instance) await instance.close();
    },
    onDrainStart: refuseHeldSockets,
    // B1: close the Redis connections last (only when REDIS_URL is set).
    ...(redisLayer.isConfigured() ? { closeRedis: () => redisLayer.close() } : {}),
  });
  lifecycle.installSignalHandlers();

  initializeApp();
};

startServer();

// Abandoned-cart nudge (10:00 IST), menu auto-restore (30 s), ephemeral purge (hourly) and the streak
// nudge (18:00 IST) are scheduled in jobs/index.js (started from initializeApp once the DB is ready).

module.exports = { 
  checkSurgeState, 
  isSurgeActive: (zone) => activeSurgeZones.has(zone), 
  SURGE_MULTIPLIER 
};
