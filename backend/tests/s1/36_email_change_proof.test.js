// Bug hunt 6 Nov 2026 (M1): an account email (where password-reset / account-deletion codes go) is saved only with
// proof of the NEW address: POST /api/users/profile/email-code emails a code to it (hashed, bound to that address,
// shared per-number cooldown / daily cap / 5-attempt lockout), PUT /api/users/profile { email, emailOtp } saves it,
// and the previous address is told. A first email works the same way; removing the email needs no code.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

const mails = [];
let mailer;
test.before(async () => {
  await H.setup();
  mailer = require.cache[require.resolve(path.join(H.B, 'utils/mailer.js'))].exports;
});
test.after(() => H.teardown());

const enableMail = () => {
  mailer.isMailerConfigured = () => true;
  mailer.sendMail = async (m) => { mails.push(m); return { ok: true }; };
};
const codeOf = (m) => (/Your ZenWe code is: (\d{6})/.exec(m.text) || [])[1];
const askCode = (u, email) => H.api('POST', '/api/users/profile/email-code', u.token, { email });
const save = (u, body) => H.api('PUT', '/api/users/profile', u.token, body);
const waitFor = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('changing the email without the code is refused; nothing saved', async () => {
  enableMail();
  const u = await H.mkUser();
  await u.update({ email: 'owner.first@example.com' });
  const r = await save(u, { email: 'attacker@example.com' });
  assert.deepStrictEqual([r.status, r.body.code], [400, 'EMAIL_VERIFICATION_REQUIRED'], JSON.stringify(r.body));
  assert.strictEqual((await H.ctx.M.User.findByPk(u.id)).email, 'owner.first@example.com');
  // the app always sends the current email back with other edits: no code needed for that
  const same = await save(u, { name: 'Owner Same Email', email: 'Owner.First@example.com' });
  assert.strictEqual(same.status, 200, JSON.stringify(same.body));
  assert.strictEqual(same.body.email, 'owner.first@example.com');
});

test('code to the new address, bound to it; right code saves and the old address is told', async () => {
  enableMail();
  const u = await H.mkUser();
  await u.update({ email: 'old.address@example.com' });
  const before = mails.length;
  const sent = await askCode(u, 'New.Address@Example.com');
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
  assert.strictEqual(sent.body.channel, 'email');
  assert.match(sent.body.sentTo, /^ne\*+@example\.com$/);
  const mail = mails[mails.length - 1];
  assert.strictEqual(mail.to, 'new.address@example.com');
  assert.strictEqual(mails.length, before + 1, 'only the new address gets the code');
  const code = codeOf(mail);
  assert.ok(code);
  const rows = await H.ctx.M.OtpCode.findAll({ where: { phone: u.phone, purpose: 'change_email' } });
  assert.strictEqual(rows.length, 1);
  assert.ok(!String(rows[0].codeHash).includes(code), 'only a hash is stored');

  // the code works only for the address it was sent to
  const other = await save(u, { email: 'someone.else@example.com', emailOtp: code });
  assert.strictEqual(other.status, 400, JSON.stringify(other.body));
  assert.strictEqual((await H.ctx.M.User.findByPk(u.id)).email, 'old.address@example.com');
  const wrong = await save(u, { email: 'new.address@example.com', emailOtp: code === '111111' ? '222222' : '111111' });
  assert.deepStrictEqual([wrong.status, wrong.body.code], [400, 'OTP_INVALID']);
  const ok = await save(u, { email: 'new.address@example.com', emailOtp: code });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.email, 'new.address@example.com');
  assert.strictEqual((await H.ctx.M.User.findByPk(u.id)).email, 'new.address@example.com');
  await waitFor(() => mails.some((m) => m.to === 'old.address@example.com'));
  const notice = mails.find((m) => m.to === 'old.address@example.com');
  assert.ok(notice, 'old address notified');
  assert.match(notice.subject, /email address was changed/);
  assert.match(notice.text, /changed to ne\*+@example\.com/);
  // single use
  const again = await save(u, { email: 'new.address@example.com', emailOtp: code });
  assert.strictEqual(again.status, 200, 'unchanged email needs nothing');
});

test('first email is added the same way (no notice: there was no old address)', async () => {
  enableMail();
  const u = await H.mkUser();
  const noCode = await save(u, { email: 'first.mail@example.com' });
  assert.strictEqual(noCode.body.code, 'EMAIL_VERIFICATION_REQUIRED');
  const before = mails.length;
  assert.strictEqual((await askCode(u, 'first.mail@example.com')).status, 200);
  const code = codeOf(mails[mails.length - 1]);
  const ok = await save(u, { email: 'first.mail@example.com', emailOtp: code });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(mails.length, before + 1, 'just the code, no change notice');
});

test('removing the email needs no code; the old address is told', async () => {
  enableMail();
  const u = await H.mkUser();
  await u.update({ email: 'going.away@example.com' });
  const r = await save(u, { email: '' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual((await H.ctx.M.User.findByPk(u.id)).email, null);
  await waitFor(() => mails.some((m) => m.to === 'going.away@example.com'));
  assert.match(mails.find((m) => m.to === 'going.away@example.com').text, /was just removed/);
});

test('guards: bad / same / taken email, mail off, cooldown, 5 wrong codes lock the code', async () => {
  enableMail();
  const u = await H.mkUser();
  await u.update({ email: 'guard.me@example.com' });
  const taken = await H.mkUser();
  await taken.update({ email: 'taken.one@example.com' });
  assert.strictEqual((await askCode(u, 'not-an-email')).body.code, 'INVALID_EMAIL');
  assert.strictEqual((await askCode(u, 'GUARD.me@example.com')).body.code, 'EMAIL_UNCHANGED');
  assert.strictEqual((await askCode(u, 'taken.one@example.com')).status, 409);
  assert.strictEqual((await save(u, { email: 'taken.one@example.com', emailOtp: '123456' })).status, 409);
  assert.strictEqual((await H.api('POST', '/api/users/profile/email-code', null, { email: 'x@example.com' })).status, 401);
  mailer.isMailerConfigured = () => false;
  const off = await askCode(u, 'fresh.one@example.com');
  assert.deepStrictEqual([off.status, off.body.code], [503, 'EMAIL_OTP_UNAVAILABLE']);
  enableMail();
  assert.strictEqual((await askCode(u, 'fresh.one@example.com')).status, 200);
  const cool = await askCode(u, 'fresh.one@example.com');
  assert.deepStrictEqual([cool.status, cool.body.code], [429, 'OTP_COOLDOWN']);
  const code = codeOf(mails[mails.length - 1]);
  const bad = code === '111111' ? '222222' : '111111';
  let last;
  for (let i = 0; i < 5; i++) last = await save(u, { email: 'fresh.one@example.com', emailOtp: bad });
  assert.strictEqual(last.body.code, 'OTP_LOCKED');
  const late = await save(u, { email: 'fresh.one@example.com', emailOtp: code });
  assert.notStrictEqual(late.status, 200, 'a locked code never works');
  assert.strictEqual((await H.ctx.M.User.findByPk(u.id)).email, 'guard.me@example.com');
});

test('the email code is not an SMS purpose and does not reset a password', async () => {
  enableMail();
  const sms = await H.api('POST', '/api/users/send-otp', null, { phone: (await H.mkUser()).phone, purpose: 'change_email' });
  assert.strictEqual(sms.status, 400);
  const u = await H.mkUser();
  assert.strictEqual((await askCode(u, 'reset.try@example.com')).status, 200);
  const code = codeOf(mails[mails.length - 1]);
  const reset = await H.api('POST', '/api/users/reset-password', null, { phone: u.phone, otp: code, newPassword: 'NewPassw0rd-9' });
  assert.notStrictEqual(reset.status, 200);
});
