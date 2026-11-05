// Promoter code typed at sign-up ("Referral code (optional)"): valid codes credit the new account once, invalid
// ones never block sign-up, and the link and the typed code never both count.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const userIdOf = (body) => body._id || body.id;

test('valid typed code (any case) credits the new account via code', async () => {
  const p = await H.mkPromoter();
  const reg = await H.register(H.newPhone(), { installId: H.newDevice(), promoCode: ` ${p.code.toLowerCase()} ` });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.promo, 'code');
  const s = await H.stats(p.id);
  assert.deepEqual([s.viaLink, s.viaCode, s.verified], [0, 1, 1]);
});

test('invalid typed code: the account is still created, the answer says invalid, nobody is credited', async () => {
  const p = await H.mkPromoter();
  const phone = H.newPhone();
  const reg = await H.register(phone, { installId: H.newDevice(), promoCode: 'NOPE99' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.ok(reg.body.token);
  assert.equal(reg.body.promo, 'invalid');
  assert.ok(await H.ctx.M('User').findOne({ where: { phone } }));
  const junk = await H.register(H.newPhone(), { promoCode: 'x y z <script>' });
  assert.equal(junk.status, 201);
  assert.equal(junk.body.promo, 'invalid');
  assert.equal((await H.stats(p.id)).verified, 0);
});

test('a deactivated promoter code is invalid', async () => {
  const p = await H.mkPromoter();
  await H.api('PATCH', `/api/admin/promoters/${p.id}`, { token: await H.adminToken(), body: { active: false } });
  const reg = await H.register(H.newPhone(), { promoCode: p.code });
  assert.equal(reg.body.promo, 'invalid');
  assert.equal((await H.stats(p.id)).verified, 0);
});

test('link and typed code never both count: the link wins, the typed promoter gets nothing', async () => {
  const linkP = await H.mkPromoter();
  const codeP = await H.mkPromoter();
  const d = H.newDevice();
  await H.attribute(d, H.referrerFor(linkP.code));
  const reg = await H.register(H.newPhone(), { installId: d, promoCode: codeP.code });
  assert.equal(reg.body.promo, 'link');
  assert.equal((await H.stats(linkP.id)).verified, 1);
  assert.equal((await H.stats(codeP.id)).verified, 0);
  assert.equal(await H.ctx.M('PromoAttribution').count({ where: { userId: userIdOf(reg.body) } }), 1);
});

test('double credit prevented: a second new account on the same device, or the same number again, gets no code credit', async () => {
  const p = await H.mkPromoter();
  const d = H.newDevice();
  const phone = H.newPhone();
  assert.equal((await H.register(phone, { installId: d, promoCode: p.code })).body.promo, 'code');
  assert.equal((await H.register(H.newPhone(), { installId: d, promoCode: p.code })).body.promo, 'used');
  await H.ctx.M('User').destroy({ where: { phone } });
  assert.equal((await H.register(phone, { installId: H.newDevice(), promoCode: p.code })).body.promo, 'none');
  // A late link report from the device that already counted by code changes nothing.
  assert.equal((await H.attribute(d, H.referrerFor(p.code))).body.attributed, false);
  assert.equal((await H.stats(p.id)).verified, 1);
});

test('old app builds without a device id: a typed code still credits once per account', async () => {
  const p = await H.mkPromoter();
  assert.equal((await H.register(H.newPhone(), { promoCode: p.code })).body.promo, 'code');
  assert.equal((await H.register(H.newPhone(), { promoCode: p.code })).body.promo, 'code');
  assert.equal((await H.stats(p.id)).viaCode, 2);
});

test('a promoter code typed in the friend invite field counts as the promoter code; unknown invite codes still fail', async () => {
  const p = await H.mkPromoter();
  const reg = await H.register(H.newPhone(), { referralCode: p.code.toLowerCase(), installId: H.newDevice() });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.promo, 'code');
  assert.equal((await H.stats(p.id)).viaCode, 1);
  const bad = await H.register(H.newPhone(), { referralCode: 'ZV-NOTREAL' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_REFERRAL');
});

test('GET /api/promo/check/:code tells only whether a code is live', async () => {
  const p = await H.mkPromoter();
  const ok = await H.api('GET', `/api/promo/check/${p.code.toLowerCase()}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { valid: true });
  assert.deepEqual((await H.api('GET', '/api/promo/check/NOPE99')).body, { valid: false });
});
