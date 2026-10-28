// Short-lived in-memory cache for hot PUBLIC GET endpoints (no per-user data).
//
// • cacheGet(group, { ttlMs }) → route middleware. On a miss the handler runs as usual; its 200
//   res.json body is serialised ONCE, hashed into a weak ETag and gzipped once, then kept for ttlMs.
//   Hits (and every later request) are served from those bytes: no DB, no JSON.stringify, no gzip.
// • Every response carries `Cache-Control: no-cache` + ETag, so clients revalidate and get a 304
//   (empty body) when nothing changed.
// • invalidate(group) drops a group at once. Store / product / config / vault / campus writes call it
//   (adminController.clearRestaurantsCache, utils/realtime.publish, vault claim). The TTL is only the
//   backstop for writes that do not announce themselves (open/closed by the clock, rating roll-ups).
//
// • Concurrent misses for the same key are coalesced (P1): the first request runs the handler, the
//   others wait for its entry (up to COALESCE_WAIT_MS) instead of all hitting the database at once
//   after an expiry / invalidation. A non-200 / non-JSON leader lets the waiters run the handler.
// • The gzip of a new entry runs on the libuv threadpool (zlib.gzip), not on the event loop.
// • Stale-while-revalidate (28 Oct live load test): an entry past its TTL but still of the current
//   generation is served at once ('STALE') for up to STALE_MS more, and that same request then runs the
//   handler in the background to rebuild it (one refresh per key at a time). Before this, the first
//   student after every 30 s expiry waited 0.2-2.6 s for the rebuild (database ~180 ms per query) and
//   everyone arriving meanwhile queued behind it. Invalidations still bump the generation, so a store /
//   product / config write is never hidden behind a stale copy: only the clock-driven TTL is softened.
//
// Only use on handlers that never read req.user / cookies / Authorization: the key is the URL alone
// (or the `key(req)` function, which must also depend on public request data only).

const crypto = require('crypto');
const zlib = require('zlib');
const { URLSearchParams } = require('url');

const MAX_ENTRIES = 1000;
const GZIP_MIN_BYTES = 1024;
// How long past its TTL an entry may still be served while it is being rebuilt (RESPONSE_CACHE_STALE_MS, 0 = off).
const STALE_MS = (() => {
  const n = Number(process.env.RESPONSE_CACHE_STALE_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5 * 60 * 1000;
})();
const REFRESH_TIMEOUT_MS = 30 * 1000;

const store = new Map(); // key -> { body, gz, etag, at, ttl, gen }
const generations = new Map(); // group -> number (bumped by invalidate)

const genOf = (group) => generations.get(group) || 0;

const invalidateLocal = (...groups) => {
  for (const group of groups) {
    generations.set(group, genOf(group) + 1);
    const prefix = `${group}|`;
    for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
  }
};

const invalidateAllLocal = () => {
  for (const key of store.keys()) {
    const group = key.slice(0, key.indexOf('|'));
    generations.set(group, genOf(group) + 1);
  }
  store.clear();
};

// B1: with REDIS_URL set the other instances drop the same groups (utils/cacheBus); without it these
// are exactly the local clears.
// resync (Redis came back: invalidations may have been missed): every group, stored or in flight.
const resyncLocal = () => {
  invalidateAllLocal();
  for (const group of generations.keys()) generations.set(group, genOf(group) + 1);
};
const cacheBus = require('./cacheBus');
const invalidate = cacheBus.wrap('responseCache.invalidate', invalidateLocal, { resync: resyncLocal });
const invalidateAll = cacheBus.wrap('responseCache.invalidateAll', invalidateAllLocal);

// Path + query with parameters sorted, so ?a=1&b=2 and ?b=2&a=1 share an entry.
const canonicalUrl = (req) => {
  const url = req.originalUrl || req.url || '';
  const q = url.indexOf('?');
  const path = (q === -1 ? url : url.slice(0, q)).replace(/\/+$/, '') || '/';
  if (q === -1) return path;
  const params = new URLSearchParams(url.slice(q + 1));
  params.sort();
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

const buildBody = (payload) => {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json === undefined ? 'null' : json, 'utf8');
  const hash = crypto.createHash('sha1').update(body).digest('base64').slice(0, 27);
  const etag = `W/"${body.length.toString(16)}-${hash}"`;
  return { body, etag };
};

// gzip off the event loop (threadpool). Resolves null when compression fails (plain body is served).
const gzipAsync = (body) => new Promise((resolve) => {
  if (body.length < GZIP_MIN_BYTES) return resolve(null);
  try {
    zlib.gzip(body, { level: 6 }, (err, out) => resolve(err ? null : out));
  } catch { resolve(null); }
});

const put = (key, entry) => {
  if (store.has(key)) store.delete(key);
  else if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // oldest first
  store.set(key, entry);
};

const acceptsGzip = (req) => /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));

// cc: Cache-Control from utils/cacheHeaders ('no-cache' unless EDGE_CACHE=1 and the group may be shared by a CDN).
const sendEntry = (req, res, entry, status, cc = 'no-cache') => {
  res.status(200);
  res.set('Cache-Control', cc);
  res.set('ETag', entry.etag);
  res.set('X-Cache', status);
  res.vary('Accept-Encoding');
  if (req.fresh) {
    res.status(304);
    return res.end();
  }
  res.set('Content-Type', 'application/json; charset=utf-8');
  // Pre-compressed bytes: the compression middleware skips responses that already have a
  // Content-Encoding, so the gzip work happened once when the entry was built.
  if (entry.gz && acceptsGzip(req)) {
    res.set('Content-Encoding', 'gzip');
    res.set('Content-Length', String(entry.gz.length));
    return res.end(req.method === 'HEAD' ? undefined : entry.gz);
  }
  res.set('Content-Length', String(entry.body.length));
  return res.end(req.method === 'HEAD' ? undefined : entry.body);
};

// Requests that must always see the database (e.g. an admin editor that reads, edits and writes
// the whole document back): they skip the cache entirely and get Cache-Control: no-store.
// Only checked when the request carries a credential, so anonymous traffic pays nothing.
const hasCredential = (req) => !!((req.headers && req.headers.authorization) || /(?:^|;\s*)token=/.test(String((req.headers && req.headers.cookie) || '')));
// Resolved lazily once (authMiddleware is loaded after this module in some boot orders).
let authMiddlewareMod = null;
const authMiddleware = () => authMiddlewareMod || (authMiddlewareMod = require('../middleware/authMiddleware'));
const liveAdminBypass = async (req) => {
  if (!hasCredential(req)) return false;
  try {
    return await authMiddleware().isLiveAdminRequest(req);
  } catch {
    return false;
  }
};

const cacheGet = (group, { ttlMs = 30 * 1000, key, bypass } = {}) => (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (typeof bypass === 'function' && hasCredential(req)) {
    return Promise.resolve(bypass(req)).then((skip) => {
      if (!skip) return serve(group, ttlMs, key, req, res, next, true);
      res.set('Cache-Control', 'no-store');
      res.set('X-Cache', 'BYPASS');
      return next();
    }, () => serve(group, ttlMs, key, req, res, next, true));
  }
  return serve(group, ttlMs, key, req, res, next, typeof bypass === 'function');
};

// key -> { gen, waiters: [fn(entry|null)] } for the request currently building that entry.
const inflight = new Map();
const COALESCE_WAIT_MS = 5000;
const MAX_WAITERS = 2000;

const cacheHeaders = require('./cacheHeaders');

// bypassable: the route has a per-caller bypass, so a CDN must never share its responses.
const serve = (group, ttlMs, key, req, res, next, bypassable = false) => {
  const cc = cacheHeaders.forCachedGroup(group, { bypassable });
  const cacheKey = `${group}|${key ? key(req) : canonicalUrl(req)}`;
  const gen = genOf(group);
  const hit = store.get(cacheKey);
  const age = hit ? Date.now() - hit.at : 0;
  if (hit && hit.gen === gen && age < hit.ttl) return sendEntry(req, res, hit, 'HIT', cc);
  if (hit && hit.gen === gen && age < hit.ttl + STALE_MS) {
    sendEntry(req, res, hit, 'STALE', cc);
    if (!refreshing.has(cacheKey) && !inflight.has(cacheKey)) refreshInBackground(cacheKey, group, gen, ttlMs, req, res, next);
    return undefined;
  }
  if (hit) store.delete(cacheKey);

  // Another request is already building this entry (same generation): wait for it.
  const flight = inflight.get(cacheKey);
  if (flight && flight.gen === gen && flight.waiters.length < MAX_WAITERS) {
    return new Promise((resolve) => {
      let settled = false;
      const waiter = (entry) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (entry) {
            if (!res.headersSent) sendEntry(req, res, entry, 'HIT', cc);
          } else {
            next(); // the leader's response was not cacheable: run the handler for this request
          }
        } finally { resolve(); }
      };
      const timer = setTimeout(() => {
        const i = flight.waiters.indexOf(waiter);
        if (i !== -1) flight.waiters.splice(i, 1);
        waiter(null);
      }, COALESCE_WAIT_MS);
      if (timer.unref) timer.unref();
      flight.waiters.push(waiter);
    });
  }

  const mine = { gen, waiters: [] };
  inflight.set(cacheKey, mine);
  let released = false;
  const release = (entry) => {
    if (released) return;
    released = true;
    if (inflight.get(cacheKey) === mine) inflight.delete(cacheKey);
    const ws = mine.waiters;
    mine.waiters = [];
    for (const w of ws) { try { w(entry); } catch { /* one waiter never breaks the others */ } }
  };
  // A handler that answers without res.json (error handler, res.send, 304 from elsewhere) or a client
  // that goes away still releases the waiters.
  res.once('finish', () => release(null));
  res.once('close', () => release(null));

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    res.json = originalJson;
    const code = res.statusCode || 200;
    if (code !== 200) { release(null); return originalJson(payload); }
    let built;
    try {
      built = buildBody(payload);
    } catch {
      release(null);
      return originalJson(payload);
    }
    gzipAsync(built.body).then((gz) => {
      const entry = { body: built.body, gz, etag: built.etag, at: Date.now(), ttl: ttlMs, gen };
      // A write that landed while this response was being built bumped the generation: serve this
      // response, but do not keep it.
      if (genOf(group) === gen) put(cacheKey, entry);
      try {
        if (!res.headersSent) sendEntry(req, res, entry, 'MISS', cc);
      } finally { release(entry); }
    });
    return res;
  };
  next();
};

// Keys being rebuilt in the background (cacheKey -> timer that frees the key if the handler never answers).
const refreshing = new Map();

// The client already has the stale copy (res is finished). The handler runs once more on this request with
// every response method turned into a no-op, except res.json, which captures the fresh body into the cache.
const refreshInBackground = (cacheKey, group, gen, ttlMs, req, res, next) => {
  const timer = setTimeout(() => refreshing.delete(cacheKey), REFRESH_TIMEOUT_MS);
  if (timer.unref) timer.unref();
  refreshing.set(cacheKey, timer);
  const done = () => {
    if (refreshing.get(cacheKey) === timer) { clearTimeout(timer); refreshing.delete(cacheKey); }
  };
  let code = 200;
  const noop = () => res;
  for (const m of ['set', 'header', 'setHeader', 'removeHeader', 'append', 'vary', 'type', 'contentType', 'location', 'links', 'cookie', 'clearCookie', 'attachment', 'writeHead', 'write', 'redirect', 'render', 'sendFile', 'download', 'sendStatus', 'end']) {
    try { res[m] = noop; } catch { /* read-only on some objects: ignore */ }
  }
  res.status = (c) => { code = Number(c) || code; return res; };
  res.send = () => { done(); return res; };
  res.json = (payload) => {
    if (code !== 200) { done(); return res; }
    let built;
    try { built = buildBody(payload); } catch { done(); return res; }
    gzipAsync(built.body).then((gz) => {
      if (genOf(group) === gen) put(cacheKey, { body: built.body, gz, etag: built.etag, at: Date.now(), ttl: ttlMs, gen });
      done();
    });
    return res;
  };
  setImmediate(() => {
    try { next(); } catch { done(); }
  });
};

const stats = () => ({ entries: store.size, inflight: inflight.size, refreshing: refreshing.size, groups: Object.fromEntries(generations) });

module.exports = { cacheGet, invalidate, invalidateAll, canonicalUrl, stats, liveAdminBypass };
