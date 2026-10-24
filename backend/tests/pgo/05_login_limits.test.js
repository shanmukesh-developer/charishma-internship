// Sign-in protection: 5 wrong passwords lock that number for 15 minutes (accountLockout, even with the right
// password afterwards), and the per-IP auth limiter answers 429 RATE_LIMITED once its budget is used up.
// Limits are switched on for this file only (RATE_LIMIT_ENFORCE=1, small PG_OWNER_AUTH_MAX) before the
// routers load; every node:test file runs in its own process.
process.env.RATE_LIMIT_ENFORCE = '1';
process.env.PG_OWNER_AUTH_MAX = '14';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let created;

test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  created = await H.adminCreateOwner(admin);
});
test.after(H.teardown);

const login = (phone, password) => H.api('POST', '/api/pg-owner/auth/login', null, { phone, password });

test('5 wrong passwords lock the number, even for the right password', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await login(created.phone, `wrong-${i}-pass1`);
    assert.strictEqual(r.status, 401, `attempt ${i + 1}: ${r.status}`);
    assert.strictEqual(r.body.code, 'INVALID_CREDENTIALS');
  }
  const locked = await login(created.phone, H.TEMP_PASSWORD);
  assert.strictEqual(locked.status, 429, JSON.stringify(locked.body));
  // Formatting tricks map to the same number (same lock).
  const tricked = await login(`+91 ${created.phone}`, H.TEMP_PASSWORD);
  assert.strictEqual(tricked.status, 429);
});

test('unknown numbers answer exactly like a wrong password', async () => {
  const r = await login(H.phone(), 'whatever123');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'INVALID_CREDENTIALS');
  assert.strictEqual(r.body.message, 'Wrong mobile number or password.');
});

test('the per-IP sign-in limiter answers 429 RATE_LIMITED', async () => {
  let limited = null;
  // 7 requests so far in this file; the budget is 14 per 15 minutes.
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await login(H.phone(), `guess-${i}-pass1`);
    if (r.status === 429) limited = r;
    else assert.strictEqual(r.status, 401);
  }
  assert.ok(limited, 'limiter must trigger');
  assert.strictEqual(limited.body.code, 'RATE_LIMITED');
});
