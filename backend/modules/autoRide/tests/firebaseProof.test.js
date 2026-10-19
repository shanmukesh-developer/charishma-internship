// Driver sign-up with Firebase phone auth (free) instead of a Fast2SMS code: the app sends the Firebase
// ID token as `firebaseToken`, verified with Firebase Admin (mocked here: no network). The phone number
// in the token must equal the number being registered. The OTP path keeps working alongside it.
const path = require('path');
const fbAuthPath = require.resolve('firebase-admin/auth', { paths: [path.join(__dirname, '..', '..', '..')] });
const verified = [];
require.cache[fbAuthPath] = {
  id: fbAuthPath, filename: fbAuthPath, loaded: true,
  exports: {
    getAuth: () => ({
      verifyIdToken: async (tok) => {
        verified.push(tok);
        const m = /^fake-phone:(\+?\d+)$/.exec(String(tok));
        if (m) return { uid: `u-${m[1]}`, phone_number: m[1], firebase: { sign_in_provider: 'phone' } };
        if (tok === 'fake-no-phone') return { uid: 'u-email', email: 'x@test.local', firebase: { sign_in_provider: 'password' } };
        const e = new Error('Firebase ID token has expired.'); e.code = 'auth/id-token-expired'; throw e;
      },
    }),
  },
};

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const H = require('./helpers');

const { api } = H;
const REG = '/api/auto-ride/driver/auth/register';

before(async () => {
  await H.setup({ label: 'ar-firebase-proof' });
  await H.setFlag(true);
});
after(H.teardown);

test('register accepts a Firebase phone ID token for the same number (+91 form)', async () => {
  const phone = H.nextPhone();
  const r = await api('POST', REG, null, { name: 'Suresh Babu', phone, password: 'Driver123', firebaseToken: `fake-phone:+91${phone}` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.ok(verified.includes(`fake-phone:+91${phone}`), 'verified through Firebase Admin');
  const login = await api('POST', '/api/auto-ride/driver/auth/login', null, { phone, password: 'Driver123' });
  assert.equal(login.status, 200, 'password login unchanged');
});

test('a token for another number is refused with PHONE_MISMATCH and creates nothing', async () => {
  const phone = H.nextPhone();
  const r = await api('POST', REG, null, { name: 'Ramesh K', phone, password: 'Driver123', firebaseToken: `fake-phone:+91${H.nextPhone()}` });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'PHONE_MISMATCH');
  assert.equal(await H.ctx.M('AutoDriver').count({ where: { phone } }), 0);
});

test('expired / invalid / non-phone tokens are refused (401) and never 500', async () => {
  const phone = H.nextPhone();
  const bad = await api('POST', REG, null, { name: 'Ramesh K', phone, password: 'Driver123', firebaseToken: 'garbage' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'VERIFICATION_EXPIRED');
  const noPhone = await api('POST', REG, null, { name: 'Ramesh K', phone, password: 'Driver123', firebaseToken: 'fake-no-phone' });
  assert.equal(noPhone.status, 401);
  assert.equal(noPhone.body.code, 'PHONE_MISMATCH');
  const obj = await api('POST', REG, null, { name: 'Ramesh K', phone, password: 'Driver123', firebaseToken: { x: 1 } });
  assert.equal(obj.status, 401);
  const empty = await api('POST', REG, null, {});
  assert.equal(empty.status, 400);
  assert.equal(await H.ctx.M('AutoDriver').count({ where: { phone } }), 0);
});

test('the Fast2SMS OTP path still works next to Firebase', async () => {
  const phone = H.nextPhone();
  const hash = crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${phone}:auth:482913`).digest('hex');
  await H.ctx.M('OtpCode').create({ phone, purpose: 'auth', codeHash: hash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  const r = await api('POST', REG, null, { name: 'Venkat Rao', phone, password: 'Driver123', otp: '482913' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test('account deletion accepts a Firebase token for the account\'s own number only', async () => {
  const { driver: d, token } = await H.mkDriver();
  const DEL = '/api/auto-ride/driver/account/delete';
  const wrong = await api('POST', DEL, token, { confirm: 'DELETE', firebaseToken: `fake-phone:+91${H.nextPhone()}` });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'PHONE_MISMATCH');
  const ok = await api('POST', DEL, token, { confirm: 'DELETE', firebaseToken: `fake-phone:+91${d.phone}` });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
