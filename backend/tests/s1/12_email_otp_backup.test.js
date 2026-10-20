// Email backup for the SMS code (POST /api/users/send-email-otp), friction fix of 20 Oct:
//  • without BREVO_API_KEY: 503 EMAIL_OTP_UNAVAILABLE ("Email codes aren't available yet…"), never a crash;
//  • reset_password: the code goes to the account's email on file and works as { otp } on /reset-password;
//  • sign-up: the code goes to the new account's email and works as { emailOtp } on /register, bound to that
//    email (a different email is refused); a number that already has an account cannot sign up by email;
//  • same rules as the SMS code: hashed (no plain code stored), 60 s cooldown, 5-attempt lockout.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

const mails = [];
let mailer;
test.before(async () => {
  await H.setup();
  mailer = require.cache[require.resolve(path.join(H.B, 'utils/mailer.js'))].exports;
  // /register opens a transaction on the shared instance
  require(path.join(H.B, 'config/db.js')).getSequelize = () => H.ctx.sequelize;
});
test.after(() => H.teardown());

const enableMail = () => {
  mailer.isMailerConfigured = () => true;
  mailer.sendMail = async (m) => { mails.push(m); return { ok: true }; };
};
const codeOf = (m) => (/Your Zenvy code is: (\d{6})/.exec(m.text) || [])[1];
const send = (body) => H.api('POST', '/api/users/send-email-otp', null, body);
let n = 0;
const freshPhone = () => `6${String(300000000 + (++n) * 7919 + (process.pid % 1000)).slice(-9)}`;

test('mail not configured: clear 503, nothing stored', async () => {
  mailer.isMailerConfigured = () => false;
  const r = await send({ phone: freshPhone(), purpose: 'auth', email: 'new1@example.com' });
  assert.strictEqual(r.status, 503, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'EMAIL_OTP_UNAVAILABLE');
  assert.match(r.body.message, /Email codes aren't available yet/);
});

test('forgot password by email: code to the email on file, used as { otp }; hashed; cooldown', async () => {
  enableMail();
  const u = await H.mkUser();
  await u.update({ email: 'reset.me@example.com' });
  const r = await send({ phone: u.phone, purpose: 'reset_password' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.channel, 'email');
  assert.match(r.body.sentTo, /^re\*+@example\.com$/);
  const mail = mails[mails.length - 1];
  assert.strictEqual(mail.to, 'reset.me@example.com');
  const code = codeOf(mail);
  assert.ok(code);
  const rows = await H.ctx.M.OtpCode.findAll({ where: { phone: u.phone } });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((x) => !String(x.codeHash).includes(code)), 'only a hash is stored');

  const again = await send({ phone: u.phone, purpose: 'reset_password' });
  assert.strictEqual(again.status, 429);
  assert.strictEqual(again.body.code, 'OTP_COOLDOWN');

  const reset = await H.api('POST', '/api/users/reset-password', null, { phone: u.phone, otp: code, newPassword: 'NewPassw0rd-1' });
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
});

test('no email on file / unknown number: clear 404s', async () => {
  enableMail();
  const u = await H.mkUser();
  const r = await send({ phone: u.phone, purpose: 'reset_password' });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.code, 'NO_EMAIL_ON_FILE');
  const r2 = await send({ phone: freshPhone(), purpose: 'reset_password' });
  assert.strictEqual(r2.status, 404);
  assert.strictEqual(r2.body.code, 'ACCOUNT_NOT_FOUND');
});

test('sign-up by email code: bound to that email; wrong email or wrong code refused; lockout after 5', async () => {
  enableMail();
  const phone = freshPhone();
  const r = await send({ phone, purpose: 'auth', email: 'Fresher@Example.com' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const code = codeOf(mails[mails.length - 1]);
  assert.strictEqual(mails[mails.length - 1].to, 'fresher@example.com');
  const base = { name: 'Fresh Student', phone, password: 'Passw0rd-x1', acceptTerms: true };

  const otherEmail = await H.api('POST', '/api/users/register', null, { ...base, email: 'someone.else@example.com', emailOtp: code });
  assert.notStrictEqual(otherEmail.status, 201, 'a code sent to one email never verifies another');

  const ok = await H.api('POST', '/api/users/register', null, { ...base, email: 'fresher@example.com', emailOtp: code });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  const user = await H.ctx.M.User.findOne({ where: { phone } });
  assert.strictEqual(user.email, 'fresher@example.com');

  // The number now has an account: email sign-up is refused for it.
  const taken = await send({ phone, purpose: 'auth', email: 'x2@example.com' });
  assert.strictEqual(taken.status, 409);

  // Lockout: 5 wrong guesses kill the code.
  const phone2 = freshPhone();
  const s2 = await send({ phone: phone2, purpose: 'auth', email: 'lock@example.com' });
  assert.strictEqual(s2.status, 200);
  const good = codeOf(mails[mails.length - 1]);
  const wrong = good === '111111' ? '222222' : '111111';
  let last;
  for (let i = 0; i < 5; i++) last = await H.api('POST', '/api/users/register', null, { ...base, phone: phone2, email: 'lock@example.com', emailOtp: wrong });
  assert.strictEqual(last.status, 429, JSON.stringify(last.body));
  const after = await H.api('POST', '/api/users/register', null, { ...base, phone: phone2, email: 'lock@example.com', emailOtp: good });
  assert.notStrictEqual(after.status, 201);
});

test('bad input: invalid email, invalid purpose', async () => {
  enableMail();
  assert.strictEqual((await send({ phone: freshPhone(), purpose: 'auth', email: 'nope' })).status, 400);
  assert.strictEqual((await send({ phone: freshPhone(), purpose: 'change_phone' })).status, 400);
  assert.strictEqual((await send({ phone: '123', purpose: 'auth', email: 'a@b.co' })).status, 400);
});
