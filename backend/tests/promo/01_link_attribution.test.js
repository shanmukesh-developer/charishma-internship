// Play install link: the app reports its install referrer once; the promoter is credited only when a NEW account
// is then created on that device. Unknown / deactivated codes, repeat reports, reinstalls, existing accounts and a
// number that already counted never count.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const userIdOf = (body) => body._id || body.id;

test('valid link code: attributed on first launch, verified when a new account signs up on that device', async () => {
  const p = await H.mkPromoter();
  const device = H.newDevice();
  const a = await H.attribute(device, H.referrerFor(p.code.toLowerCase()));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.attributed, true);
  let s = await H.stats(p.id);
  assert.equal(s.installs, 1);
  assert.equal(s.verified, 0, 'an install alone is not a verified download');
  const reg = await H.register(H.newPhone(), { installId: device });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.promo, 'link');
  s = await H.stats(p.id);
  assert.deepEqual([s.viaLink, s.viaCode, s.verified], [1, 0, 1]);
  const row = await H.ctx.M('PromoAttribution').findOne({ where: { userId: userIdOf(reg.body) } });
  assert.ok(row, 'the attribution is linked to the new account');
  assert.notEqual(row.deviceHash, device, 'the raw device id is never stored');
  assert.equal(row.rawReferrer, H.referrerFor(p.code.toLowerCase()));
});

test('a URL-encoded referrer is read too', async () => {
  const p = await H.mkPromoter();
  const a = await H.attribute(H.newDevice(), encodeURIComponent(H.referrerFor(p.code)));
  assert.equal(a.body.attributed, true);
});

test('unknown code, organic installs and deactivated promoters are ignored', async () => {
  const p = await H.mkPromoter();
  const dUnknown = H.newDevice();
  const u = await H.attribute(dUnknown, H.referrerFor('NOSUCHCODE'));
  assert.equal(u.status, 200);
  assert.equal(u.body.attributed, false);
  assert.equal((await H.attribute(H.newDevice(), 'utm_source=google-play&utm_medium=organic')).body.attributed, false);
  const reg = await H.register(H.newPhone(), { installId: dUnknown });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.promo, 'none');
  const row = await H.ctx.M('PromoAttribution').findOne({ where: { referrerCode: 'NOSUCHCODE' } });
  assert.equal(row, null, 'an unknown code is never stored as a promoter code');

  const off = await H.api('PATCH', `/api/admin/promoters/${p.id}`, { token: await H.adminToken(), body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);
  const d = H.newDevice();
  assert.equal((await H.attribute(d, H.referrerFor(p.code))).body.attributed, false);
  assert.equal((await H.register(H.newPhone(), { installId: d })).body.promo, 'none');
  assert.equal((await H.stats(p.id)).verified, 0);
});

test('a link install whose promoter is deactivated before sign-up is not credited', async () => {
  const p = await H.mkPromoter();
  const d = H.newDevice();
  assert.equal((await H.attribute(d, H.referrerFor(p.code))).body.attributed, true);
  await H.api('PATCH', `/api/admin/promoters/${p.id}`, { token: await H.adminToken(), body: { active: false } });
  assert.equal((await H.register(H.newPhone(), { installId: d })).body.promo, 'none');
  assert.equal((await H.stats(p.id)).verified, 0);
});

test('same device twice counts once: repeat reports and a reinstall with a new account never count again', async () => {
  const p = await H.mkPromoter();
  const p2 = await H.mkPromoter();
  const d = H.newDevice();
  assert.equal((await H.attribute(d, H.referrerFor(p.code))).body.attributed, true);
  const again = await H.attribute(d, H.referrerFor(p2.code));
  assert.equal(again.body.attributed, false, 'the first report per device wins');
  const both = await Promise.all([H.attribute(d, H.referrerFor(p.code)), H.attribute(d, H.referrerFor(p.code))]);
  assert.ok(both.every((x) => x.status === 200 && x.body.attributed === false));
  assert.equal((await H.register(H.newPhone(), { installId: d })).body.promo, 'link');
  // Reinstall from the link on the same phone, new number: no second credit.
  assert.equal((await H.attribute(d, H.referrerFor(p.code))).body.attributed, false);
  const second = await H.register(H.newPhone(), { installId: d });
  assert.equal(second.status, 201);
  assert.equal(second.body.promo, 'used');
  assert.equal((await H.stats(p.id)).verified, 1);
  assert.equal((await H.stats(p2.id)).verified, 0);
  assert.equal(await H.ctx.M('PromoAttribution').count({ where: { deviceHash: H.r('utils/promoAttribution').deviceHashOf(d) } }), 1);
});

test('first reports racing on one device make one row', async () => {
  const p = await H.mkPromoter();
  const d = H.newDevice();
  const rs = await Promise.all([1, 2, 3, 4].map(() => H.attribute(d, H.referrerFor(p.code))));
  assert.ok(rs.every((x) => x.status === 200), rs.map((x) => x.status).join(','));
  assert.equal(rs.filter((x) => x.body.attributed).length, 1);
  assert.equal((await H.stats(p.id)).installs, 1);
});

test('an existing account signing in on a link device never counts', async () => {
  const p = await H.mkPromoter();
  const existing = await H.mkUser('student');
  const d = H.newDevice();
  await H.attribute(d, H.referrerFor(p.code));
  const login = await H.api('POST', '/api/users/login', { body: { phone: existing.phone, password: `x-test-only-${existing.phone}`, installId: d } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal((await H.stats(p.id)).verified, 0);
  // Registering the existing number again is refused and credits nothing.
  const dup = await H.register(existing.phone, { installId: d });
  assert.equal(dup.status, 409);
  assert.equal((await H.stats(p.id)).verified, 0);
});

test('one number counts once ever: an account deleted and created again elsewhere is not credited twice', async () => {
  const p = await H.mkPromoter();
  const phone = H.newPhone();
  const d1 = H.newDevice();
  await H.attribute(d1, H.referrerFor(p.code));
  const first = await H.register(phone, { installId: d1 });
  assert.equal(first.body.promo, 'link');
  await H.ctx.M('User').destroy({ where: { phone } });
  const d2 = H.newDevice();
  await H.attribute(d2, H.referrerFor(p.code));
  const second = await H.register(phone, { installId: d2 });
  assert.equal(second.status, 201);
  assert.equal(second.body.promo, 'none');
  assert.equal((await H.stats(p.id)).verified, 1);
});

test('referrer reported after the sign-up (offline first launch) still counts once', async () => {
  const p = await H.mkPromoter();
  const d = H.newDevice();
  const reg = await H.register(H.newPhone(), { installId: d });
  assert.equal(reg.body.promo, 'none');
  const late = await H.attribute(d, H.referrerFor(p.code));
  assert.equal(late.body.attributed, true);
  assert.equal((await H.stats(p.id)).viaLink, 1);
  assert.equal((await H.attribute(d, H.referrerFor(p.code))).body.attributed, false);
  assert.equal((await H.stats(p.id)).viaLink, 1);
});

test('attribute needs a plausible device id', async () => {
  assert.equal((await H.attribute('', 'x')).status, 400);
  assert.equal((await H.attribute('short', 'x')).status, 400);
  assert.equal((await H.attribute('bad id with spaces!', 'x')).status, 400);
  assert.equal((await H.api('POST', '/api/promo/attribute', { body: {} })).status, 400);
});
