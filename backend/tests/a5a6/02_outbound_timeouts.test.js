// A5.2 outbound timeouts: a local server that accepts connections and never answers. Every client
// gives up within its bound, resolves (never throws / crashes) and does not retry.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');

const B = path.join(__dirname, '..', '..');
let slow = null;
let base = null;
let hits = 0;
const quiet = async (fn) => {
  const o = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

test.before(async () => {
  slow = http.createServer((req) => { hits++; req.resume(); /* never respond */ });
  await require('../listenFree').listenFree(slow);
  base = `http://127.0.0.1:${slow.address().port}`;
});
test.after(async () => {
  slow.closeAllConnections && slow.closeAllConnections();
  await new Promise((res) => slow.close(res));
});

const timed = async (fn) => { const t0 = Date.now(); const out = await fn(); return { out, ms: Date.now() - t0 }; };

test('WhatsApp webhook: WHATSAPP_TIMEOUT_MS bound, one attempt, returns { success:false, error:"timeout" }', async () => {
  process.env.WHATSAPP_PROVIDER = 'WEBHOOK';
  process.env.WHATSAPP_WEBHOOK_URL = `${base}/wa`;
  process.env.WHATSAPP_TIMEOUT_MS = '1000';
  delete require.cache[require.resolve(path.join(B, 'utils/whatsappUtil.js'))];
  const wa = require(path.join(B, 'utils/whatsappUtil.js'));
  hits = 0;
  const { out, ms } = await quiet(() => timed(() => wa.sendWhatsAppMessage('+910000000000', 'hi', 'TEST')));
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.error, 'timeout');
  assert.ok(ms < 4000, `took ${ms} ms`);
  assert.strictEqual(hits, 1, 'no retries');
});

test('axios safety net: a call without its own timeout gives up at OUTBOUND_TIMEOUT_MS', async () => {
  const axios = require(path.join(B, 'node_modules/axios'));
  const inst = axios.create();
  process.env.OUTBOUND_TIMEOUT_MS = '1000';
  const { applyAxiosDefaultTimeout } = require(path.join(B, 'utils/outbound.js'));
  assert.strictEqual(applyAxiosDefaultTimeout(inst), 1000);
  const { out, ms } = await timed(() => inst.get(`${base}/x`).then(() => 'ok', (e) => e.code));
  assert.strictEqual(out, 'ECONNABORTED');
  assert.ok(ms < 4000, `took ${ms} ms`);
  // an explicit timeout is never overridden
  const inst2 = axios.create({ timeout: 1234 });
  assert.strictEqual(applyAxiosDefaultTimeout(inst2), 1234);
});

test('Brevo mailer: MAIL_TIMEOUT_MS bound -> { ok:false, reason:"timeout" }', async () => {
  process.env.BREVO_API_KEY = 'test-key-not-real';
  process.env.MAIL_FROM = 'ZENV <noreply@example.com>';
  process.env.MAIL_TIMEOUT_MS = '1000';
  const origFetch = global.fetch;
  // Hanging transport that honours the abort signal (no network).
  global.fetch = (url, opts) => new Promise((_, rej) => {
    opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  });
  try {
    delete require.cache[require.resolve(path.join(B, 'utils/mailer.js'))];
    const mailer = require(path.join(B, 'utils/mailer.js'));
    const { out, ms } = await quiet(() => timed(() => mailer.sendMail({ to: 'someone@example.com', subject: 's', text: 't' })));
    assert.deepStrictEqual(out, { ok: false, reason: 'timeout' });
    assert.ok(ms < 4000, `took ${ms} ms`);
  } finally {
    global.fetch = origFetch;
    delete process.env.BREVO_API_KEY; delete process.env.MAIL_FROM; delete process.env.MAIL_TIMEOUT_MS;
  }
});

test('R2 client (s3Lite): request timeout rejects with TimeoutError', async () => {
  const { S3Lite } = require(path.join(B, 'utils/s3Lite.js'));
  const c = new S3Lite({ endpoint: base, region: 'auto', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret', timeoutMs: 800 });
  hits = 0;
  const { out, ms } = await timed(() => c.request('GET', 'bucket', 'key').then(() => 'ok', (e) => e.name));
  assert.strictEqual(out, 'TimeoutError');
  assert.ok(ms < 4000, `took ${ms} ms`);
  assert.strictEqual(hits, 1);
});

test('error webhook: ERROR_REPORT_TIMEOUT_MS bound, resolves false, never throws', async () => {
  process.env.ERROR_WEBHOOK_URL = `${base}/hook`;
  process.env.ERROR_REPORT_TIMEOUT_MS = '500';
  const rep = require(path.join(B, 'utils/errorReporter.js'));
  rep._reset();
  try {
    const { out, ms } = await quiet(() => timed(() => rep.report('route', new Error('slow webhook'))));
    assert.strictEqual(out, false);
    assert.ok(ms < 3000, `took ${ms} ms`);
    assert.strictEqual(rep.stats().reportFailures, 1);
  } finally {
    delete process.env.ERROR_WEBHOOK_URL; delete process.env.ERROR_REPORT_TIMEOUT_MS;
    rep._reset();
  }
});
