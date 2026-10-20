// Photo uploads end to end (20 Oct 2026 "network error on photo upload" sweep):
//   - every route that still accepts an inline data-URL photo is on a raised body tier (else 413 at 256 KB)
//   - multipart uploads get the long request timeout (a 408 mid-upload looked like "No internet" on Android)
//   - against the REAL server.js (tests/s0/boot_server.js, temp SQLite): a 3 MB JSON data URL gets past the
//     256 KB cap on every raised route, multipart works, and too-big / wrong-type files answer quick JSON.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const B = path.join(__dirname, '..', '..');
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const { tierFor } = require(path.join(B, 'utils/bodyLimits.js'));

const UUID = '0b3c2f8e-1d2a-4c5b-9e8f-7a6b5c4d3e2f';

// Every HTTP route whose handler stores an inline base64 / data-URL photo (storeImageRef / storeImageList /
// decodeBase64Image / bufferFromBase64). Keep in sync with utils/bodyLimits.js RAISED_ROUTES.
const INLINE_PHOTO_ROUTES = [
  ['POST', '/api/upload'], // server.js JSON { image } fallback
  ['POST', '/api/campus/media'], // mediaController JSON { image } fallback
  ['POST', '/api/auto-ride/driver/media'], // driverProfile.uploadMedia JSON { image }
  ['PUT', '/api/users/profile'], // userController profileImage
  ['PUT', '/api/delivery/profile'], // deliveryPartnerController photoUrl
  ['PUT', `/api/orders/${UUID}/upload-item-photo`],
  ['PUT', `/api/orders/${UUID}/upload-bill-proof`],
  ['PUT', `/api/mega-basket/${UUID}/item-status`],
  ['POST', '/api/services/book'], // attachmentUrl + attachmentDocument (PDF)
  ['POST', '/api/birthdays'],
  ['POST', '/api/community'],
  ['POST', `/api/wall/events/${UUID}/submit`],
  ['POST', `/api/pg/${UUID}/reviews`],
  ['POST', '/api/campus/lost-found'],
  ['POST', '/api/campus/verify/upload-id'],
  ['POST', '/api/restaurants'],
  ['POST', '/api/restaurant'],
  ['POST', '/api/restaurants/menu'],
  ['PUT', `/api/restaurants/menu/${UUID}`],
  ['POST', '/api/restaurant/menu'],
  ['PUT', `/api/restaurant/menu/${UUID}`],
  ['POST', '/api/admin/restaurants'],
  ['PUT', `/api/admin/restaurants/${UUID}`],
  ['POST', '/api/admin/menu-items/bulk'],
  ['POST', '/api/pg'],
  ['PUT', `/api/pg/${UUID}`],
  ['PUT', `/api/pg/${UUID}/photos`],
  ['POST', '/api/pg/admin/promotions'], // added 20 Oct: preparePromotion -> storeImageRef (5 MB)
  ['PUT', `/api/pg/admin/promotions/${UUID}`],
];

test('every inline-photo route is on a raised body tier', () => {
  for (const [m, p] of INLINE_PHOTO_ROUTES) assert.notStrictEqual(tierFor(m, p), 'global', `${m} ${p} would answer 413 above 256 KB`);
  // the promotion reorder list stays on the small cap (ids only)
  assert.strictEqual(tierFor('PUT', '/api/pg/admin/promotions/order'), 'global');
  assert.strictEqual(tierFor('GET', '/api/pg/admin/promotions'), 'global');
});

test('request timeout: multipart uploads get the long timeout, JSON keeps 30 s', async () => {
  const sec = path.join(B, 'middleware/securityMiddleware.js');
  const { requestTimeoutMs, requestTimeout } = require(sec);
  delete process.env.REQUEST_TIMEOUT_MS; delete process.env.UPLOAD_REQUEST_TIMEOUT_MS;
  assert.strictEqual(requestTimeoutMs({ headers: { 'content-type': 'application/json' } }), 30000);
  assert.strictEqual(requestTimeoutMs({ headers: { 'content-type': 'multipart/form-data; boundary=x' } }), 120000);
  assert.strictEqual(requestTimeoutMs({ headers: {} }), 30000);

  process.env.REQUEST_TIMEOUT_MS = '150';
  process.env.UPLOAD_REQUEST_TIMEOUT_MS = '5000';
  const app = express();
  app.use(requestTimeout);
  app.post('/slow', (req, res) => { req.resume(); setTimeout(() => { if (!res.headersSent) res.json({ ok: true }); }, 600); });
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const warn = console.warn; console.warn = () => {};
  try {
    const json = await fetch(`${base}/slow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(json.status, 408);
    assert.strictEqual((await json.json()).code, 'REQUEST_TIMEOUT');
    const form = new FormData();
    form.append('image', new Blob([Buffer.alloc(1024, 1)], { type: 'image/jpeg' }), 'a.jpg');
    const multi = await fetch(`${base}/slow`, { method: 'POST', body: form });
    assert.strictEqual(multi.status, 200);
  } finally {
    console.warn = warn;
    server.close();
    delete process.env.REQUEST_TIMEOUT_MS; delete process.env.UPLOAD_REQUEST_TIMEOUT_MS;
  }
});

// ── Real server ──────────────────────────────────────────────────────────────
const PORT = 29000 + (process.pid % 3000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `a5a6-up-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
let child = null;
let logs = '';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const evalIn = async (code) => {
  const r = await fetch(`http://127.0.0.1:${CTRL}/eval`, { method: 'POST', body: code });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.out;
};

/** n bytes that sniff as a JPEG (FF D8 FF ...). The rest is random so every upload is a new row. */
const jpeg = (n) => {
  const b = crypto.randomBytes(n);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
  return b;
};
const dataUrl = (n) => `data:image/jpeg;base64,${jpeg(n).toString('base64')}`;
const multipart = (buf, type = 'image/jpeg', name = 'photo.jpg') => {
  const form = new FormData();
  form.append('image', new Blob([buf], { type }), name);
  return form;
};

let token = null;

test('real server: boot + a signed-in student', { timeout: 180000 }, async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 's0', 'boot_server.js')], {
    env: { ...process.env, S0_SQLITE: file, PORT: String(PORT), S0_CTRL_PORT: String(CTRL), REDIS_URL: '', REDIS_ENABLED: '', ERROR_WEBHOOK_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try {
      const r = await fetch(`${BASE}/api/chat/status`);
      if (r.status === 200 && await evalIn("const U = require(B + '/models/User').getUserModel(); if (!U) throw new Error('no db'); const M = require(B + '/modules/campus/models/CampusMedia').getCampusMediaModel(); if (!M) throw new Error('no media'); return await U.count();") !== undefined) up = true;
    } catch { /* not up yet */ }
    if (!up) await sleep(1000);
  }
  assert.ok(up, `server did not start:\n${logs.slice(-3000)}`);
  const id = await evalIn(`const U = require(B + '/models/User').getUserModel();
    const u = await U.create({ name: 'Upload Tester', phone: '8${String(100000000 + (process.pid % 899999999)).slice(-9)}', role: 'student', isActive: true, isVerified: true, password: 'x-test-only-upload-pw', friendCode: 'ZNV-UP${process.pid % 100000}' });
    return u.id;`);
  token = jwt.sign({ id, role: 'student', tv: 0 }, 's0-socket-test-secret');
});

test('real server: a 3 MB JSON data URL gets past the 256 KB cap on every raised route', { timeout: 180000 }, async () => {
  const body = JSON.stringify({ image: dataUrl(3 * 1024 * 1024), imageUrl: 'x', attachmentUrl: 'x' }); // ~4 MB JSON
  for (const [m, p] of INLINE_PHOTO_ROUTES) {
    const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'content-type': 'application/json' }, body });
    const j = await r.json().catch(() => null);
    assert.notStrictEqual(r.status, 413, `${m} ${p} -> 413 ${j && j.code}`);
    assert.ok(!j || j.code !== 'PAYLOAD_TOO_LARGE', `${m} ${p}`);
  }
  // control: a normal route still refuses it, quickly and as JSON
  const t0 = Date.now();
  const small = await fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.strictEqual(small.status, 413);
  assert.strictEqual((await small.json()).code, 'PAYLOAD_TOO_LARGE');
  assert.ok(Date.now() - t0 < 10000);
});

test('real server: /api/campus/media stores a 3 MB JSON data URL and a 3 MB multipart photo', { timeout: 120000 }, async () => {
  const auth = { authorization: `Bearer ${token}` };
  const j = await fetch(`${BASE}/api/campus/media`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ image: dataUrl(3 * 1024 * 1024), purpose: 'post' }) });
  const jb = await j.json();
  assert.strictEqual(j.status, 201, JSON.stringify(jb));
  assert.match(jb.url, /^\/api\/campus\/media\/[0-9a-f-]{36}$/);

  const m = await fetch(`${BASE}/api/campus/media`, { method: 'POST', headers: auth, body: multipart(jpeg(3 * 1024 * 1024)) });
  const mb = await m.json();
  assert.strictEqual(m.status, 201, JSON.stringify(mb));
  assert.match(mb.url, /^\/api\/campus\/media\//);
});

test('real server: too-big multipart files answer 413 FILE_TOO_LARGE JSON (never a reset)', { timeout: 120000 }, async () => {
  const auth = { authorization: `Bearer ${token}` };
  const big = await fetch(`${BASE}/api/campus/media`, { method: 'POST', headers: auth, body: multipart(jpeg(6 * 1024 * 1024)) });
  assert.strictEqual(big.status, 413);
  assert.strictEqual((await big.json()).code, 'FILE_TOO_LARGE');

  const up = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth, body: multipart(jpeg(3 * 1024 * 1024)) });
  assert.strictEqual(up.status, 413);
  assert.strictEqual((await up.json()).code, 'FILE_TOO_LARGE');

  const type = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth, body: multipart(Buffer.from('%PDF-1.4 not a photo'), 'application/pdf', 'a.pdf') });
  assert.strictEqual(type.status, 415);
  assert.strictEqual((await type.json()).code, 'UNSUPPORTED_TYPE');
});

test('real server: /api/upload multipart + JSON fallback both work for a normal photo', { timeout: 120000 }, async () => {
  const auth = { authorization: `Bearer ${token}` };
  const m = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth, body: multipart(jpeg(400 * 1024)) });
  const mb = await m.json();
  assert.strictEqual(m.status, 200, JSON.stringify(mb));
  assert.match(mb.imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}$/);
  const j = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ image: dataUrl(1024 * 1024) }) });
  const jb = await j.json();
  assert.strictEqual(j.status, 200, JSON.stringify(jb));
  assert.match(jb.imageUrl, /\/api\/campus\/media\//);
});

test.after(async () => {
  if (child) {
    child.kill('SIGKILL');
    await new Promise((res) => { if (child.exitCode !== null) res(); else child.once('exit', res); });
  }
  await sleep(200);
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
});
