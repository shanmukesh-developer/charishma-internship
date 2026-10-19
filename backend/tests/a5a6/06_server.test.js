// A5 + A6 against the REAL server.js (child process via tests/s0/boot_server.js: fresh temp SQLite,
// Redis unset, Firebase / push / mail / WhatsApp stubbed), with LOG_FORMAT=json:
//   - 413 PAYLOAD_TOO_LARGE on an oversized body to a normal route; an upload route still parses 3 MB
//   - X-Request-Id echoed (and = X-Trace-Id), JSON access line with reqId / route / status / ms / inst
//   - no phone / email / OTP from the request in the logs
//   - an unhandled rejection is logged + counted and the server keeps answering
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 23000 + (process.pid % 6000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `a5a6-srv-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
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
  child = spawn(process.execPath, [path.join(__dirname, '..', 's0', 'boot_server.js')], {
    env: { ...process.env, S0_SQLITE: file, PORT: String(PORT), S0_CTRL_PORT: String(CTRL), REDIS_URL: '', REDIS_ENABLED: '', LOG_FORMAT: 'json', ACCESS_LOG: 'all', ERROR_WEBHOOK_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d; });
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

const jsonLines = () => logs.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

test('oversized body to a normal route -> 413 PAYLOAD_TOO_LARGE (JSON), upload route still parses 3 MB', async () => {
  const r = await fetch(`${BASE}/api/users/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', pad: 'a'.repeat(400 * 1024) }) });
  assert.strictEqual(r.status, 413);
  const j = await r.json();
  assert.strictEqual(j.code, 'PAYLOAD_TOO_LARGE');
  // 3 MB JSON photo to POST /api/campus/media: parsed, then refused by auth (401), not 413
  const up = await fetch(`${BASE}/api/campus/media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: `data:image/jpeg;base64,${'A'.repeat(3 * 1024 * 1024)}` }) });
  assert.strictEqual(up.status, 401);
  // a normal small login body is untouched (400/401 from the controller, not 413)
  const small = await fetch(`${BASE}/api/users/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', password: 'x' }) });
  assert.notStrictEqual(small.status, 413);
});

test('request id in/out, JSON access line, no PII in logs', async () => {
  const r = await fetch(`${BASE}/api/chat/status?phone=9876543210&email=someone%40example.com&otp=482913`, { headers: { 'X-Request-Id': 'a5a6-req-000001' } });
  assert.strictEqual(r.headers.get('x-request-id'), 'a5a6-req-000001');
  assert.strictEqual(r.headers.get('x-trace-id'), 'a5a6-req-000001');
  const gen = await fetch(`${BASE}/api/chat/status`, { headers: { 'X-Request-Id': 'bad id with spaces' } });
  assert.match(gen.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  await sleep(200);
  const line = jsonLines().find((l) => l.msg === 'http' && l.reqId === 'a5a6-req-000001');
  assert.ok(line, `no JSON access line found:\n${logs.slice(-2000)}`);
  assert.strictEqual(line.method, 'GET');
  assert.strictEqual(line.route, '/api/chat/status');
  assert.strictEqual(line.status, 200);
  assert.strictEqual(typeof line.ms, 'number');
  assert.ok('inst' in line);
  const tooLarge = jsonLines().find((l) => l.msg === 'http' && l.status === 413);
  assert.ok(tooLarge && tooLarge.reqId, 'the 413 is logged with its request id');
  for (const s of ['9876543210', 'someone@example.com', 'someone%40example.com', '482913']) assert.ok(!logs.includes(s), `${s} leaked into logs`);
});

test('unhandled rejection: logged (redacted, JSON), counted, server keeps serving', async () => {
  await evalIn("Promise.reject(new Error('stray rejection for 9876543210')); return 1;");
  await sleep(300);
  const r = await fetch(`${BASE}/api/chat/status`);
  assert.strictEqual(r.status, 200);
  const stats = await evalIn("return require(B + '/utils/errorReporter').stats();");
  assert.strictEqual(stats.unhandledRejections, 1);
  assert.strictEqual(stats.enabled, false);
  const errLine = jsonLines().find((l) => l.level === 'error' && /Unhandled Promise Rejection/.test(l.msg || ''));
  assert.ok(errLine, 'JSON error line');
  assert.ok(String(errLine.err).includes('[PHONE]'));
  assert.ok(!logs.includes('9876543210'));
});
