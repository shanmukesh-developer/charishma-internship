// Customer sign-in lockout (29 Oct 2026 audit): 5 wrong passwords lock the PASSWORD sign-in for 15 minutes, but
//  - the one-time-code sign-in (firebaseToken) is never locked by them (it checks no password), and
//  - replies that tested no password (unknown number, missing password) never count.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const login = (body) => H.api('POST', '/api/users/login', null, body);

test('5 wrong passwords lock the password sign-in, not the one-time-code sign-in', async () => {
  const u = await H.mkUser();
  for (let i = 0; i < 5; i++) {
    const r = await login({ phone: u.phone, password: `wrong-guess-${i}` });
    assert.equal(r.status, 401, JSON.stringify(r.body));
  }
  const locked = await login({ phone: u.phone, password: 'another-guess' });
  assert.equal(locked.status, 429, JSON.stringify(locked.body));
  // Firebase is stubbed in this harness, so the code itself is refused (401 VERIFICATION_EXPIRED): what matters is
  // that the request reaches the check instead of the 429 lock.
  const otp = await login({ phone: u.phone, firebaseToken: 'stub-token' });
  assert.notEqual(otp.status, 429, JSON.stringify(otp.body));
  assert.equal(otp.body.code, 'VERIFICATION_EXPIRED');
});

test('an unknown number or a missing password never counts towards the lock', async () => {
  const phone = '9123400017';
  for (let i = 0; i < 7; i++) {
    const r = await login({ phone, password: 'whatever-1' });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'ACCOUNT_NOT_FOUND');
  }
  const u = await H.mkUser();
  for (let i = 0; i < 7; i++) assert.equal((await login({ phone: u.phone })).status, 400);
  // still not locked: a wrong password is a plain 401
  assert.equal((await login({ phone: u.phone, password: 'wrong-once' })).status, 401);
});
