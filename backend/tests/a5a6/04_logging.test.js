// A6.4 structured logs (utils/logger.js): request id pick / propagation through AsyncLocalStorage,
// JSON access-log shape, redaction (no phone / email / token / OTP / password in logs).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const EventEmitter = require('events');

const B = path.join(__dirname, '..', '..');
const logger = require(path.join(B, 'utils/logger.js'));
const perf = require(path.join(B, 'utils/perfMetrics.js'));

const capture = async (fn) => {
  const lines = [];
  const o = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  console.log = grab; console.warn = grab; console.error = grab;
  try { await fn(); } finally { Object.assign(console, o); }
  return lines;
};

const SECRETS = {
  phone: '9876543210',
  phone91: '+91 98765 43210',
  email: 'student.one@srmap.edu.in',
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyIsInJvbGUiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU',
  fcm: `dGVzdFRva2VuMTIz:APA91b${'Z'.repeat(140)}`,
  otp: '482913',
  password: 'Hunter2-Secret!',
};

test('redact masks phones, emails, JWTs, bearer / FCM tokens and sensitive key values', () => {
  const text = `login failed phone=${SECRETS.phone} for ${SECRETS.email} (alt ${SECRETS.phone91}) auth=Bearer ${SECRETS.jwt} `
    + `token ${SECRETS.fcm} body {"otp":"${SECRETS.otp}","password":"${SECRETS.password}","name":"Asha"} url /x?otp=${SECRETS.otp}&page=2`;
  const out = logger.redact(text);
  for (const [k, v] of Object.entries(SECRETS)) assert.ok(!out.includes(v), `${k} leaked: ${out}`);
  assert.ok(out.includes('Asha'), 'non-sensitive text kept');
  assert.ok(out.includes('page=2'));
  // ids, timestamps and amounts are not mistaken for phones
  const keep = 'order 0b3c2f8e-1d2a-4c5b-9e8f-7a6b5c4d3e2f at 1729339200000 total 1499 ms=12.5';
  assert.strictEqual(logger.redact(keep), keep);
  assert.strictEqual(logger.redactUrl(`/api/users/check?phone=${SECRETS.phone}&x=1`), '/api/users/check?phone=[REDACTED]&x=1');
  assert.strictEqual(logger.redactUrl('/api/restaurants?page=2'), '/api/restaurants?page=2');
});

test('request id: safe incoming X-Request-Id kept, unsafe / missing replaced with a UUID', () => {
  assert.strictEqual(logger.pickRequestId('abc-12345678'), 'abc-12345678');
  assert.strictEqual(logger.pickRequestId(['edge:1234567890ab']), 'edge:1234567890ab');
  for (const bad of [undefined, '', 'short', 'has space 12345678', `x${'a'.repeat(200)}`, 'inject\n{"level":"error"}']) {
    assert.match(logger.pickRequestId(bad), /^[0-9a-f-]{36}$/);
  }
});

const fakeReqRes = (headers = {}) => {
  const req = { method: 'GET', originalUrl: '/api/orders/0b3c2f8e-1d2a-4c5b-9e8f-7a6b5c4d3e2f?phone=9876543210', url: '/', headers };
  const res = new EventEmitter();
  const hdrs = {};
  res.setHeader = (k, v) => { hdrs[k.toLowerCase()] = v; };
  res.getHeader = (k) => hdrs[k.toLowerCase()];
  res.writeHead = () => {};
  res.statusCode = 200;
  res.headersSent = false;
  return { req, res, hdrs };
};

test('perf middleware assigns the id, echoes X-Request-Id and propagates it via AsyncLocalStorage', async () => {
  const mw = perf.middleware();
  const { req, res, hdrs } = fakeReqRes({ 'x-request-id': 'client-req-0001' });
  let seen = null; let seenLater = null;
  await new Promise((done) => mw(req, res, () => {
    seen = logger.currentRequestId();
    setTimeout(() => { seenLater = logger.currentRequestId(); done(); }, 5); // async continuation
  }));
  assert.strictEqual(seen, 'client-req-0001');
  assert.strictEqual(seenLater, 'client-req-0001');
  assert.strictEqual(hdrs['x-request-id'], 'client-req-0001');
  assert.strictEqual(req.id, 'client-req-0001');
  res.emit('finish');
  assert.strictEqual(logger.currentRequestId(), null, 'no id outside a request');

  // errors logged inside the request carry its id, redacted
  const lines = await capture(async () => {
    const { req: r2, res: s2 } = fakeReqRes({});
    await new Promise((done) => mw(r2, s2, () => { logger.logError('[TEST_ERR]', new Error(`bad otp=${SECRETS.otp} for ${SECRETS.email}`)); done(); }));
    s2.emit('finish');
  });
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /reqId=[0-9a-f-]{36}/);
  assert.ok(!lines[0].includes(SECRETS.otp) && !lines[0].includes(SECRETS.email));
});

test('LOG_FORMAT=json: one compact JSON access line (reqId, method, route, status, ms, inst), no PII', async () => {
  process.env.LOG_FORMAT = 'json';
  process.env.ACCESS_LOG = 'all';
  try {
    const access = logger.accessLogMiddleware();
    const mw = perf.middleware();
    const lines = await capture(async () => {
      const { req, res } = fakeReqRes({ 'x-request-id': 'json-req-00042' });
      res.statusCode = 404;
      await new Promise((done) => mw(req, res, () => access(req, res, done)));
      res.emit('finish');
    });
    assert.strictEqual(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.strictEqual(rec.msg, 'http');
    assert.strictEqual(rec.reqId, 'json-req-00042');
    assert.strictEqual(rec.method, 'GET');
    assert.strictEqual(rec.route, '/api/orders/:id (unmatched)');
    assert.strictEqual(rec.status, 404);
    assert.strictEqual(typeof rec.ms, 'number');
    assert.ok('inst' in rec);
    assert.strictEqual(rec.level, 'warn');
    assert.ok(rec.t && !Number.isNaN(Date.parse(rec.t)));
    assert.ok(!lines[0].includes(SECRETS.phone));

    // JSON error line
    const errLines = await capture(() => logger.logError('[UNHANDLED_ROUTE_ERROR]', new Error(`db failed for ${SECRETS.phone}`), { method: 'POST', reqId: 'r-123456789' }));
    const e = JSON.parse(errLines[0]);
    assert.strictEqual(e.level, 'error');
    assert.strictEqual(e.msg, '[UNHANDLED_ROUTE_ERROR]');
    assert.strictEqual(e.reqId, 'r-123456789');
    assert.strictEqual(e.method, 'POST');
    assert.ok(e.err.includes('[PHONE]') && !errLines[0].includes(SECRETS.phone));

    // ACCESS_LOG=errors skips 2xx
    process.env.ACCESS_LOG = 'errors';
    const access2 = logger.accessLogMiddleware();
    const quiet = await capture(async () => {
      const { req, res } = fakeReqRes({});
      await new Promise((done) => access2(req, res, done));
      res.emit('finish');
    });
    assert.strictEqual(quiet.length, 0);
  } finally {
    delete process.env.LOG_FORMAT; delete process.env.ACCESS_LOG;
  }
});

test('default text mode keeps the morgan line, with the URL\'s sensitive values masked', async () => {
  delete process.env.LOG_FORMAT;
  const access = logger.accessLogMiddleware();
  const http = require('http');
  const out = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const server = http.createServer((req, res) => access(req, res, () => res.end('ok')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.stdout.write = (chunk, ...rest) => { if (String(chunk).includes('/api/users/check')) { out.push(String(chunk)); return true; } return origWrite(chunk, ...rest); };
  try {
    await fetch(`http://127.0.0.1:${server.address().port}/api/users/check?phone=${SECRETS.phone}&email=${encodeURIComponent(SECRETS.email)}&page=1`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.stdout.write = origWrite;
    server.close();
  }
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /^GET \/api\/users\/check\?phone=\[REDACTED\]&email=\[REDACTED\]&page=1 200 \S+ - [\d.]+ ms/);
});
