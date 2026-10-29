// Session checks (middleware/authMiddleware protect): only a bad / expired token is "not signed in" (401). A database
// failure while looking the account up is 503 (the apps retry), because every app drops its session on a 401.
// Deleted accounts are 401 ACCOUNT_DELETED (all devices sign out); suspended ones 403 ACCOUNT_SUSPENDED.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const B = path.join(__dirname, '..', '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'infra-auth-session-test-secret';
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const userModel = require(path.join(B, 'models/User'));
const { protect, clearCachedUser } = require(path.join(B, 'middleware/authMiddleware'));

const run = (token) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this; },
  };
  protect({ headers: { authorization: `Bearer ${token}` } }, res, () => resolve({ status: 'next' }));
});
const sign = (claims) => jwt.sign({ role: 'student', tv: 0, ...claims }, process.env.JWT_SECRET);

const withUsers = async (findByPk, fn) => {
  const orig = userModel.getUserModel;
  userModel.getUserModel = () => ({ findByPk });
  try { await fn(); } finally { userModel.getUserModel = orig; }
};

test('a database failure while checking a session is 503 (try again), never 401 (which signs the app out)', async () => {
  await withUsers(async () => { throw new Error('Connection terminated unexpectedly'); }, async () => {
    const r = await run(sign({ id: 'infra-db-error' }));
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.code, 'AUTH_UNAVAILABLE');
    assert.strictEqual(r.headers['Retry-After'], '2');
  });
});

test('a bad or expired token is still 401', async () => {
  assert.strictEqual((await run('not-a-jwt')).status, 401);
  assert.strictEqual((await run(sign({ id: 'infra-expired', exp: Math.floor(Date.now() / 1000) - 10 }))).status, 401);
  assert.strictEqual((await run(jwt.sign({ id: 'x', role: 'student' }, 'some-other-secret'))).status, 401);
});

test('deleted accounts: 401 ACCOUNT_DELETED; suspended accounts: 403 ACCOUNT_SUSPENDED', async () => {
  const rows = {
    'infra-deleted': { id: 'infra-deleted', role: 'deleted', isActive: false, tokenVersion: 1 },
    'infra-suspended': { id: 'infra-suspended', role: 'student', isActive: false, tokenVersion: 0 },
  };
  try {
    await withUsers(async (id) => rows[id] || null, async () => {
      let r = await run(sign({ id: 'infra-deleted' }));
      assert.deepStrictEqual([r.status, r.body.code], [401, 'ACCOUNT_DELETED']);
      r = await run(sign({ id: 'infra-suspended' }));
      assert.deepStrictEqual([r.status, r.body.code], [403, 'ACCOUNT_SUSPENDED']);
    });
  } finally {
    clearCachedUser('infra-deleted');
    clearCachedUser('infra-suspended');
  }
});
