// Splash ads against the REAL server.js (child process via tests/s0/boot_server.js: fresh temp SQLite, Redis
// unset, Firebase blanked): the startup sync creates the SplashAds table with its one-active-ad-per-style
// index, GET /api/ads/splash is public and answers { ads: [] }, the admin routes are mounted and protected.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const B = path.join(__dirname, '..', '..');
const PORT = 31000 + (process.pid % 8000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `ads-srv-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
let child = null;
let logs = '';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const evalIn = async (code) => {
  const r = await fetch(`http://127.0.0.1:${CTRL}/eval`, { method: 'POST', body: code });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.out;
};

test.before(async () => {
  child = spawn(process.execPath, [path.join(B, 'tests', 's0', 'boot_server.js')], {
    env: { ...process.env, S0_SQLITE: file, PORT: String(PORT), S0_CTRL_PORT: String(CTRL), REDIS_URL: '', REDIS_ENABLED: '', ADMIN_2FA_REQUIRED: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d; if (logs.length > 200000) logs = logs.slice(-100000); });
  child.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/chat/status`);
      if (r.status === 200 && await evalIn("const M = require(B + '/models/SplashAd').getSplashAdModel(); if (!M) throw new Error('no db'); return await M.count();") !== undefined) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`server did not start:\n${logs.slice(-3000)}`);
});

test.after(async () => {
  if (child) {
    child.kill('SIGKILL');
    await new Promise((res) => { if (child.exitCode !== null) res(); else child.once('exit', res); });
  }
  await sleep(200);
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
});

test('startup sync created SplashAds with the partial unique style index', async () => {
  const out = await evalIn(`
    const qi = require(B + '/config/db').getSequelize().getQueryInterface();
    const cols = Object.keys(await qi.describeTable('SplashAds'));
    const idx = (await qi.showIndex('SplashAds')).map((i) => ({ name: i.name, unique: !!i.unique }));
    return { cols, idx };
  `);
  for (const c of ['id', 'restaurantId', 'style', 'offerText', 'headline', 'subline', 'bannerText', 'imageUrl', 'colorA', 'colorB', 'startsAt', 'endsAt', 'isActive', 'priority', 'createdBy', 'createdAt', 'updatedAt']) {
    assert.ok(out.cols.includes(c), `column ${c}`);
  }
  assert.ok(out.idx.some((i) => i.name === 'splash_ads_active_style' && i.unique), JSON.stringify(out.idx));
});

test('GET /api/ads/splash is public and mounted: { ads: [] }; admin routes need an admin', async () => {
  const r = await fetch(`${BASE}/api/ads/splash`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { ads: [] });
  const a = await fetch(`${BASE}/api/admin/splash-ads`);
  await a.arrayBuffer();
  assert.strictEqual(a.status, 401);
});
