// A5.3 FCM push queue (utils/push.js + utils/pushQueue.js) with a mocked firebase messaging client:
// concurrency cap, <=500 tokens per multicast, invalid-token cleanup on User / DeliveryPartner rows,
// metrics counters. In-memory SQLite, no network.
process.env.PUSH_CONCURRENCY = '3';
delete process.env.PUSH_BATCH_SIZE;
delete process.env.PUSH_STALE_CLEANUP;
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const B = path.join(__dirname, '..', '..');
// Never load the real firebase credentials in a test.
const fbPath = require.resolve(path.join(B, 'config/firebase.js'));
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { apps: [], getApps: () => [] } };
const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const { createLimiter } = require(path.join(B, 'utils/pushQueue.js'));
const push = require(path.join(B, 'utils/push.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (i, tag = 'ok') => `${tag}${String(i).padStart(6, '0')}:APA91b${'x'.repeat(120)}`;
const quiet = async (fn) => {
  const o = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

let inFlight = 0;
let peak = 0;
let calls = [];
const mockMessaging = () => ({
  sendEachForMulticast: async (message) => {
    calls.push(message.tokens.length);
    inFlight++; peak = Math.max(peak, inFlight);
    await sleep(15);
    inFlight--;
    const responses = message.tokens.map((t) => (t.startsWith('dead')
      ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
      : (t.startsWith('bad') ? { success: false, error: { code: 'messaging/invalid-argument' } } : { success: true })));
    const failureCount = responses.filter((r) => !r.success).length;
    return { successCount: responses.length - failureCount, failureCount, responses };
  },
  send: async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(10); inFlight--; return 'projects/x/messages/1'; },
});

let sequelize = null;
test.before(async () => {
  sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  require(path.join(B, 'models/User.js')).initUserModel(sequelize);
  require(path.join(B, 'models/DeliveryPartner.js')).initDeliveryPartnerModel(sequelize);
  await sequelize.sync();
  push._setMessaging(mockMessaging);
});
test.after(async () => { push._setMessaging(null); await sequelize.close(); });

test('limiter: never more than N at once, FIFO, QUEUE_FULL beyond maxQueue', async () => {
  const q = createLimiter(2, { maxQueue: 3 });
  let active = 0; let max = 0; const order = [];
  const job = (i) => async () => { active++; max = Math.max(max, active); await sleep(10); active--; order.push(i); return i; };
  const ps = [0, 1, 2, 3, 4].map((i) => q.run(job(i)));
  const full = await q.run(job(99)).then(() => 'ran', (e) => e.code);
  assert.strictEqual(full, 'QUEUE_FULL');
  assert.deepStrictEqual(await Promise.all(ps), [0, 1, 2, 3, 4]);
  assert.strictEqual(max, 2);
  assert.deepStrictEqual(order.slice(0, 2).sort(), [0, 1]);
  await q.idle();
  assert.deepStrictEqual(q.stats().active, 0);
});

test('burst: 20 sends x 1200 tokens -> batches <= 500, at most PUSH_CONCURRENCY in flight, counters', async () => {
  push._resetPushStats();
  calls = []; peak = 0;
  const tokens = Array.from({ length: 1200 }, (_, i) => tok(i));
  const results = await quiet(() => Promise.all(Array.from({ length: 20 }, () => push.sendPushToTokens(tokens, 'Hi', 'Body', { type: 'test' }, { persist: false }))));
  assert.ok(calls.length === 60, `60 batches, got ${calls.length}`);
  assert.ok(calls.every((n) => n <= 500), 'FCM max 500 tokens per multicast');
  assert.deepStrictEqual(calls.slice(0, 3).sort((a, b) => b - a), [500, 500, 200]);
  assert.ok(peak <= 3, `peak in flight ${peak}`);
  assert.ok(peak >= 2, 'actually concurrent');
  results.forEach((r) => assert.deepStrictEqual(r, { successCount: 1200, failureCount: 0, staleTokens: [] }));
  const st = push.pushStats();
  assert.strictEqual(st.calls, 20);
  assert.strictEqual(st.batches, 60);
  assert.strictEqual(st.queued, 60);
  assert.strictEqual(st.sent, 24000);
  assert.strictEqual(st.failed, 0);
  assert.strictEqual(st.concurrency, 3);
  assert.strictEqual(st.active + st.pending, 0);
  // duplicates in one call are sent once
  calls = [];
  await quiet(() => push.sendPushToTokens([tok(1), tok(1), { token: tok(1) }], 't', 'b', {}, { persist: false }));
  assert.deepStrictEqual(calls, [1]);
});

test('topic sends share the same queue', async () => {
  push._resetPushStats();
  peak = 0;
  await quiet(() => Promise.all(Array.from({ length: 12 }, () => push.sendPushToTopic('all', 't', 'b'))));
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.strictEqual(push.pushStats().topics, 12);
});

test('unregistered tokens are removed from User / DeliveryPartner rows; other errors are kept', async () => {
  const User = require(path.join(B, 'models/User.js')).getUserModel();
  const DP = require(path.join(B, 'models/DeliveryPartner.js')).getDeliveryPartnerModel();
  const dead1 = tok(1, 'dead'); const dead2 = tok(2, 'dead'); const bad = tok(3, 'bad'); const live = tok(4);
  const u = await User.create({ name: 'A', phone: '9000000001', email: 'a1@example.com', password: 'Password#123', fcmTokens: [dead1, live, bad] });
  const r = await DP.create({ name: 'R', phone: '9000000002', password: 'Password#123', fcmTokens: [dead2] });
  push._resetPushStats();
  const res = await quiet(async () => {
    const out = await push.sendPushToTokens([dead1, dead2, bad, live], 't', 'b', {}, { persist: false });
    await push._flushCleanups();
    return out;
  });
  assert.deepStrictEqual(res.staleTokens.sort(), [dead1, dead2].sort());
  assert.strictEqual(res.failureCount, 3);
  await u.reload();
  assert.deepStrictEqual(u.fcmTokens, [live, bad]);
  await r.reload();
  assert.deepStrictEqual(r.fcmTokens, []);
  const st = push.pushStats();
  assert.strictEqual(st.staleFound, 2);
  assert.strictEqual(st.staleRemoved, 2);
  assert.strictEqual(st.failed, 3);
  assert.strictEqual(st.sent, 1);
});

test('PUSH_STALE_CLEANUP=0 keeps tokens', async () => {
  const User = require(path.join(B, 'models/User.js')).getUserModel();
  const dead = tok(9, 'dead');
  const u = await User.create({ name: 'B', phone: '9000000003', email: 'b1@example.com', password: 'Password#123', fcmTokens: [dead] });
  process.env.PUSH_STALE_CLEANUP = '0';
  try {
    await quiet(async () => { await push.sendPushToTokens([dead], 't', 'b', {}, { persist: false }); await push._flushCleanups(); });
    await u.reload();
    assert.deepStrictEqual(u.fcmTokens, [dead]);
  } finally { delete process.env.PUSH_STALE_CLEANUP; }
});

test('a failing batch is counted, does not throw, and does not block the queue', async () => {
  push._resetPushStats();
  push._setMessaging(() => ({ sendEachForMulticast: async () => { const e = new Error('boom'); e.code = 'messaging/invalid-argument'; throw e; } }));
  try {
    const out = await quiet(() => push.sendPushToTokens([tok(1), tok(2)], 't', 'b', {}, { persist: false }));
    assert.strictEqual(out.successCount, 0);
    const st = push.pushStats();
    assert.strictEqual(st.batchErrors, 1);
    assert.strictEqual(st.failed, 2);
    assert.strictEqual(st.active + st.pending, 0);
  } finally { push._setMessaging(mockMessaging); }
});

test('perf snapshot + [PERF] line include push / redis / error counters', async () => {
  const perf = require(path.join(B, 'utils/perfMetrics.js'));
  const snap = perf.snapshot();
  assert.ok(snap.push && typeof snap.push.sent === 'number' && typeof snap.push.concurrency === 'number');
  assert.ok(snap.errors && typeof snap.errors.serverErrors === 'number');
  // a [PERF] line needs traffic in the window: record one fake request through the middleware
  const mw = perf.middleware();
  const EventEmitter = require('events');
  const res = new EventEmitter();
  res.setHeader = () => {}; res.writeHead = () => {}; res.statusCode = 200; res.headersSent = false;
  await new Promise((r) => mw({ method: 'GET', originalUrl: '/api/x', headers: {} }, res, r));
  res.emit('finish');
  const line = perf.logLine();
  assert.match(line, / push=q\d+\/s\d+\/f\d+/);
  assert.match(line, / redis=(off|ok|down)/);
  assert.match(line, / err5xx=\d+ unhandled=\d+/);
});
