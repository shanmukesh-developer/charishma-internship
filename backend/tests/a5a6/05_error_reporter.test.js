// A6.5 error reporter (utils/errorReporter.js): off by default, rate-limited + deduplicated + redacted when on.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const B = path.join(__dirname, '..', '..');
const rep = require(path.join(B, 'utils/errorReporter.js'));

let posts = [];
const mockFetch = async (url, opts) => { posts.push({ url, body: JSON.parse(opts.body), signal: opts.signal }); return { ok: true, status: 200 }; };

test.beforeEach(() => {
  rep._reset();
  rep._setFetch(mockFetch);
  posts = [];
  delete process.env.ERROR_WEBHOOK_URL; delete process.env.ERROR_REPORT_MAX_PER_MIN; delete process.env.ERROR_REPORT_DEDUPE_MS;
});
test.after(() => { rep._setFetch(null); rep._reset(); });

test('off by default: nothing is sent, counters still work', async () => {
  assert.strictEqual(rep.isEnabled(), false);
  assert.strictEqual(await rep.report('route', new Error('x')), false);
  rep.countServerError(); rep.countUnhandledRejection();
  assert.strictEqual(posts.length, 0);
  const s = rep.stats();
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.serverErrors, 1);
  assert.strictEqual(s.unhandledRejections, 1);
  assert.strictEqual(s.reported, 0);
  // a non-http value is not a webhook
  process.env.ERROR_WEBHOOK_URL = 'javascript:alert(1)';
  assert.strictEqual(rep.isEnabled(), false);
});

test('on: redacted payload with reqId / route / instance; Slack / Discord text fields', async () => {
  process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.test/abc';
  const err = new Error('payment failed for 9876543210 / a.b@example.com token=sekret123456');
  assert.strictEqual(await rep.report('route', err, { reqId: 'req-abcdef12', method: 'POST', route: '/api/orders', status: 500 }), true);
  assert.strictEqual(posts.length, 1);
  const p = posts[0];
  assert.strictEqual(p.url, 'https://hooks.example.test/abc');
  assert.ok(p.signal, 'bounded by a timeout signal');
  const raw = JSON.stringify(p.body);
  for (const s of ['9876543210', 'a.b@example.com', 'sekret123456']) assert.ok(!raw.includes(s), `${s} leaked`);
  assert.strictEqual(p.body.kind, 'route');
  assert.strictEqual(p.body.reqId, 'req-abcdef12');
  assert.strictEqual(p.body.route, '/api/orders');
  assert.strictEqual(p.body.status, 500);
  assert.ok('instance' in p.body && p.body.service === 'zenvy-backend');
  assert.match(p.body.text, /^\[route\] /);
  assert.strictEqual(rep.stats().reported, 1);
});

test('on: rate-limited per minute and deduplicated', async () => {
  process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.test/abc';
  process.env.ERROR_REPORT_MAX_PER_MIN = '3';
  const results = [];
  for (let i = 0; i < 10; i++) results.push(await rep.report('route', new Error(`distinct error ${i}`)));
  assert.deepStrictEqual(results.filter(Boolean).length, 3);
  assert.strictEqual(posts.length, 3);
  assert.strictEqual(rep.stats().dropped, 7);

  rep._reset(); posts = [];
  for (let i = 0; i < 5; i++) await rep.report('unhandledRejection', new Error('same thing again'));
  assert.strictEqual(posts.length, 1, 'same error once per dedupe window');
  assert.strictEqual(rep.stats().dropped, 4);
});

test('on: a failing webhook resolves false, never throws', async () => {
  process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.test/abc';
  rep._setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const o = console.warn; console.warn = () => {};
  try {
    assert.strictEqual(await rep.report('route', new Error('x')), false);
    rep._setFetch(async () => ({ ok: false, status: 500 }));
    assert.strictEqual(await rep.report('route', new Error('y')), false);
  } finally { console.warn = o; }
  assert.strictEqual(rep.stats().reportFailures, 2);
});
