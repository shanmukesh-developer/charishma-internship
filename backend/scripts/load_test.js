#!/usr/bin/env node
// Read-only load test: simulates N customers browsing PUBLIC endpoints (no sign-in, no writes).
//
//   node scripts/load_test.js [baseUrl] [--users=50] [--duration=30] [--think=500]
//
//   baseUrl     default http://localhost:8080 (never defaults to production)
//   --users     concurrent simulated customers (default 50)
//   --duration  seconds to run (default 30)
//   --think     ms each user waits between requests (default 500; 0 = flat out)
//
// Each simulated user loops: health → restaurant listing → one store page → catalogue stores →
// catalogue items → local stalls → serviceability. Prints throughput, latency percentiles and
// status counts per endpoint. Uses autocannon when it is installed (single-URL mode is not a
// realistic browse, so the fetch runner below is always used for the flow; autocannon is only
// used with --autocannon for a raw /api/health hammer).
//
// Production is refused unless you pass --i-know-this-is-production (read-only endpoints, but a load
// test still costs the real server). Campus Wi-Fi note: in production all simulated users share
// this machine's IP, so the signed-out per-IP limit (RATE_LIMIT_IP_MAX) applies to the whole run.

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return args.includes(`--${name}`) ? true : def;
};
const baseArg = args.find((a) => !a.startsWith('--'));
const BASE = String(baseArg || 'http://localhost:8080').replace(/\/+$/, '');
const USERS = Math.max(1, Math.min(2000, parseInt(flag('users', 50), 10) || 50));
const DURATION_S = Math.max(5, Math.min(3600, parseInt(flag('duration', 30), 10) || 30));
const THINK_MS = Math.max(0, parseInt(flag('think', 500), 10) || 0);
const TIMEOUT_MS = 15000;

if (/onrender\.com|hostelbites-backend/i.test(BASE) && !flag('i-know-this-is-production', false)) {
  console.error(`Refusing to load-test what looks like production (${BASE}).`);
  console.error('Run against a local / staging server, or add --i-know-this-is-production.');
  process.exit(2);
}
if (typeof fetch !== 'function') {
  console.error('This script needs Node 18+ (global fetch).');
  process.exit(2);
}

const stats = new Map(); // name -> { ok, fail, statuses: {}, times: [] }
const record = (name, status, ms, ok) => {
  if (!stats.has(name)) stats.set(name, { ok: 0, fail: 0, statuses: {}, times: [] });
  const s = stats.get(name);
  if (ok) s.ok++; else s.fail++;
  s.statuses[status] = (s.statuses[status] || 0) + 1;
  s.times.push(ms);
};

const get = async (name, path) => {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'zenvy-load-test' } });
    const body = await res.text();
    record(name, res.status, performance.now() - t0, res.ok);
    if (!res.ok) return null;
    try { return JSON.parse(body); } catch { return null; }
  } catch (err) {
    record(name, err.name === 'AbortError' ? 'timeout' : 'error', performance.now() - t0, false);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => (Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

const userLoop = async (deadline) => {
  // Stagger start so all users do not fire at the same millisecond.
  await sleep(Math.random() * Math.min(2000, THINK_MS * 4 + 200));
  while (Date.now() < deadline) {
    await get('health', '/api/health');
    const restaurants = await get('restaurants', '/api/users/restaurants');
    const store = pick(restaurants);
    if (store && store.id) await get('restaurant_detail', `/api/users/restaurants/${store.id}`);
    if (THINK_MS) await sleep(THINK_MS);
    const stores = await get('catalogue_stores', '/api/catalogue/stores');
    const cat = pick(stores);
    await get('catalogue_items', cat && cat.id ? `/api/catalogue/items?storeId=${cat.id}&limit=50` : '/api/catalogue/items?limit=50');
    if (THINK_MS) await sleep(THINK_MS);
    await get('local_vendors', '/api/restaurants/local-vendors');
    await get('serviceability', '/api/orders/serviceability');
    if (THINK_MS) await sleep(THINK_MS);
  }
};

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

const runAutocannon = async () => {
  let autocannon;
  try { autocannon = require('autocannon'); } catch {
    console.error('autocannon is not installed (npm i -D autocannon). Running the fetch flow instead.');
    return false;
  }
  console.log(`autocannon: ${USERS} connections, ${DURATION_S}s → ${BASE}/api/health`);
  const result = await autocannon({ url: `${BASE}/api/health`, connections: USERS, duration: DURATION_S });
  console.log(autocannon.printResult(result));
  return true;
};

(async () => {
  if (flag('autocannon', false) && await runAutocannon()) return;

  console.log(`ZENV load test → ${BASE}`);
  console.log(`${USERS} simulated users, ${DURATION_S}s, think time ${THINK_MS} ms (read-only public endpoints)\n`);
  const started = Date.now();
  const deadline = started + DURATION_S * 1000;
  const ticker = setInterval(() => {
    let total = 0;
    for (const s of stats.values()) total += s.ok + s.fail;
    process.stdout.write(`\r  ${Math.round((Date.now() - started) / 1000)}s  requests: ${total}   `);
  }, 1000);
  await Promise.all(Array.from({ length: USERS }, () => userLoop(deadline)));
  clearInterval(ticker);
  const elapsed = (Date.now() - started) / 1000;

  console.log('\n');
  const rows = [];
  let total = 0;
  let failed = 0;
  for (const [name, s] of stats) {
    const sorted = s.times.slice().sort((a, b) => a - b);
    total += s.ok + s.fail;
    failed += s.fail;
    rows.push({
      endpoint: name,
      requests: s.ok + s.fail,
      'req/s': ((s.ok + s.fail) / elapsed).toFixed(1),
      failed: s.fail,
      p50_ms: Math.round(pct(sorted, 50)),
      p95_ms: Math.round(pct(sorted, 95)),
      p99_ms: Math.round(pct(sorted, 99)),
      max_ms: Math.round(sorted[sorted.length - 1] || 0),
      statuses: Object.entries(s.statuses).map(([k, v]) => `${k}:${v}`).join(' '),
    });
  }
  console.table(rows);
  console.log(`Total ${total} requests in ${elapsed.toFixed(1)}s = ${(total / elapsed).toFixed(1)} req/s, ${failed} failed (${total ? ((failed / total) * 100).toFixed(2) : 0}%).`);
  if (rows.some((r) => / 429:/.test(` ${r.statuses}`))) {
    console.log('Note: 429 = rate limited. Signed-out traffic from one IP shares RATE_LIMIT_IP_MAX.');
  }
  process.exit(failed && failed === total ? 1 : 0);
})();
