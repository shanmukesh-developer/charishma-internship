// S1 against the REAL server.js (child process via tests/s0/boot_server.js: fresh temp SQLite, Redis unset,
// Firebase blanked): CSP frame-ancestors 'none', /uploads no longer served, App Check wired and failing open
// without Firebase credentials even in enforce mode, 2FA routes mounted, AdminTwoFactors table created.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const B = path.join(__dirname, '..', '..');
const PORT = 23000 + (process.pid % 8000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `s1-srv-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
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
    env: { ...process.env, S0_SQLITE: file, PORT: String(PORT), S0_CTRL_PORT: String(CTRL), REDIS_URL: '', REDIS_ENABLED: '', APP_CHECK_MODE: 'enforce', ADMIN_2FA_REQUIRED: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d; if (logs.length > 200000) logs = logs.slice(-100000); });
  child.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/chat/status`);
      if (r.status === 200 && await evalIn("const U = require(B + '/models/User').getUserModel(); if (!U) throw new Error('no db'); return await U.count();") !== undefined) return;
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

test("CSP: frame-ancestors 'none' on API / legal pages; /auth-helper keeps its own list", async () => {
  for (const p of ['/legal/privacy', '/api/chat/status']) {
    const r = await fetch(BASE + p);
    await r.arrayBuffer();
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /frame-ancestors 'none'/, p);
  }
  const h = await fetch(`${BASE}/auth-helper`);
  await h.arrayBuffer();
  const csp = h.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'self' https:\/\/hostelbites-admin-iyoy\.onrender\.com/);
  assert.match(csp, /localhost/, 'non-production keeps local framing');
  assert.strictEqual(require(path.join(B, 'utils/env')).isProduction(), false);
});

test('/uploads is not served any more', async () => {
  const dir = path.join(B, 'uploads');
  const any = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => !f.startsWith('.')) : null;
  const r = await fetch(`${BASE}/uploads/${any || 'x.png'}`);
  await r.arrayBuffer();
  assert.strictEqual(r.status, 404);
});

test('App Check enforce without Firebase credentials fails OPEN on the real server (logged + counted)', async () => {
  const r = await fetch(`${BASE}/api/users/send-otp`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Firebase-AppCheck': 'some-token' }, body: JSON.stringify({ phone: '1' }) });
  const b = await r.json();
  assert.notStrictEqual(b.code, 'APP_CHECK_REQUIRED');
  const st = await evalIn("return require(B + '/utils/appCheck').stats();");
  assert.strictEqual(st.mode, 'enforce');
  assert.ok(st.totals.unavailable >= 1, JSON.stringify(st));
  assert.match(logs, /\[APP_CHECK\] mode=enforce/);
});

test('2FA routes are mounted and the AdminTwoFactors table exists', async () => {
  let r = await fetch(`${BASE}/api/users/login/mfa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual((await r.json()).code, 'MFA_TOKEN_INVALID');
  r = await fetch(`${BASE}/api/admin/2fa/status`);
  assert.strictEqual(r.status, 401);
  await r.arrayBuffer();
  const n = await evalIn("const { getAdminTwoFactorModel } = require(B + '/models/AdminTwoFactor'); const M = await getAdminTwoFactorModel(); return await M.count();");
  assert.strictEqual(n, 0);
  const cols = await evalIn("const s = require(B + '/models/User').getUserModel().sequelize; const [rows] = await s.query(\"PRAGMA table_info('AutoDrivers')\"); return rows.map((c) => c.name);");
  assert.ok(cols.includes('statusBeforeSuspension'), 'additive column on AutoDrivers');
});
