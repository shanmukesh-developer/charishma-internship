// A5.1 body size limits (utils/bodyLimits.js + middleware/errorMiddleware.js), on a small express app
// with the same parser + error handler wiring as server.js. Real-server checks are in 06_server.test.js.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const B = path.join(__dirname, '..', '..');
const express = require(path.join(B, 'node_modules/express'));

const freshBodyLimits = () => {
  delete require.cache[require.resolve(path.join(B, 'utils/bodyLimits.js'))];
  return require(path.join(B, 'utils/bodyLimits.js'));
};

const startApp = async () => {
  const { bodyParsers } = freshBodyLimits();
  const { errorHandler } = require(path.join(B, 'middleware/errorMiddleware.js'));
  const app = express();
  app.use(bodyParsers());
  app.all(/.*/, (req, res) => res.json({ ok: true, bytes: JSON.stringify(req.body || {}).length }));
  app.use(errorHandler);
  const server = await require('../listenFree').listenFree(app);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

const big = (bytes) => 'a'.repeat(bytes);
const post = (base, p, body, method = 'POST', type = 'application/json') => fetch(`${base}${p}`, { method, headers: { 'content-type': type }, body });
const quiet = async (fn) => {
  const o = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

test('tierFor: only the listed upload / admin routes get a raised limit', () => {
  const { tierFor } = freshBodyLimits();
  const uuid = '0b3c2f8e-1d2a-4c5b-9e8f-7a6b5c4d3e2f';
  assert.strictEqual(tierFor('POST', '/api/users/login'), 'global');
  assert.strictEqual(tierFor('POST', '/api/orders'), 'global');
  assert.strictEqual(tierFor('GET', '/api/campus/media'), 'global');
  assert.strictEqual(tierFor('POST', '/api/campus/media'), 'upload');
  assert.strictEqual(tierFor('POST', '/api/upload'), 'upload');
  assert.strictEqual(tierFor('POST', '/api/upload/'), 'upload');
  assert.strictEqual(tierFor('POST', '/api/services/book'), 'upload');
  assert.strictEqual(tierFor('PUT', '/api/users/profile'), 'upload');
  assert.strictEqual(tierFor('POST', '/api/users/profile'), 'global');
  assert.strictEqual(tierFor('PUT', `/api/orders/${uuid}/upload-bill-proof`), 'upload');
  assert.strictEqual(tierFor('POST', `/api/pg/${uuid}/reviews`), 'upload');
  assert.strictEqual(tierFor('POST', '/api/admin/menu-items/bulk'), 'admin');
  assert.strictEqual(tierFor('PUT', '/api/admin/legal-settings'), 'admin');
  assert.strictEqual(tierFor('GET', '/api/admin/orders'), 'global');
  assert.strictEqual(tierFor('PUT', `/api/pg/${uuid}/photos`), 'admin');
  assert.strictEqual(tierFor('POST', `/api/pg/${uuid}/book`), 'global');
  assert.strictEqual(tierFor('POST', '/api/administrator'), 'global');
});

test('global 256 KB: oversized JSON -> 413 PAYLOAD_TOO_LARGE; normal bodies pass', async () => {
  delete process.env.BODY_LIMIT; delete process.env.UPLOAD_BODY_LIMIT; delete process.env.ADMIN_BODY_LIMIT;
  const { server, base } = await startApp();
  try {
    const ok = await post(base, '/api/users/login', JSON.stringify({ note: big(200 * 1024) }));
    assert.strictEqual(ok.status, 200);
    const tooBig = await quiet(() => post(base, '/api/users/login', JSON.stringify({ note: big(300 * 1024) })));
    assert.strictEqual(tooBig.status, 413);
    const j = await tooBig.json();
    assert.strictEqual(j.code, 'PAYLOAD_TOO_LARGE');
    assert.strictEqual(j.success, false);
    // urlencoded too
    const form = await quiet(() => post(base, '/api/users/login', `note=${big(300 * 1024)}`, 'POST', 'application/x-www-form-urlencoded'));
    assert.strictEqual(form.status, 413);
    assert.strictEqual((await form.json()).code, 'PAYLOAD_TOO_LARGE');
  } finally { server.close(); }
});

test('upload and admin routes still accept their larger bodies (8 MB base64, 2 MB bulk import)', async () => {
  const { server, base } = await startApp();
  try {
    const img = `data:image/jpeg;base64,${Buffer.alloc(6 * 1024 * 1024, 7).toString('base64')}`; // 6 MB photo = ~8 MB JSON
    for (const [m, p] of [['POST', '/api/services/book'], ['POST', '/api/campus/media'], ['POST', '/api/upload'], ['PUT', '/api/users/profile']]) {
      const r = await post(base, p, JSON.stringify({ image: img, attachmentUrl: img.slice(0, 10) }), m);
      assert.strictEqual(r.status, 200, `${m} ${p}`);
    }
    const rows = Array.from({ length: 300 }, (_, i) => ({ name: `Item ${i}`, price: 99, description: big(6000) }));
    const bulk = await post(base, '/api/admin/menu-items/bulk', JSON.stringify({ restaurantId: 'x', items: rows }));
    assert.strictEqual(bulk.status, 200);
    // still bounded: > 10 MB is refused even on upload routes
    const huge = await quiet(() => post(base, '/api/campus/media', JSON.stringify({ image: big(11 * 1024 * 1024) })));
    assert.strictEqual(huge.status, 413);
    assert.strictEqual((await huge.json()).code, 'PAYLOAD_TOO_LARGE');
  } finally { server.close(); }
});

test('limits are env-tunable (BODY_LIMIT / UPLOAD_BODY_LIMIT)', async () => {
  process.env.BODY_LIMIT = '10kb';
  process.env.UPLOAD_BODY_LIMIT = '1mb';
  const { server, base } = await startApp();
  try {
    assert.strictEqual((await quiet(() => post(base, '/api/orders', JSON.stringify({ n: big(20 * 1024) })))).status, 413);
    assert.strictEqual((await post(base, '/api/campus/media', JSON.stringify({ n: big(500 * 1024) }))).status, 200);
    assert.strictEqual((await quiet(() => post(base, '/api/campus/media', JSON.stringify({ n: big(2 * 1024 * 1024) })))).status, 413);
  } finally {
    server.close();
    delete process.env.BODY_LIMIT; delete process.env.UPLOAD_BODY_LIMIT;
  }
});
