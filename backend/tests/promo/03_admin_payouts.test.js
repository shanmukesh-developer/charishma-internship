// Admin side: only admins manage promoters; codes are customisable (4-16 A-Z 0-9, unique ignoring case) or
// automatic; Rs 100 per full 200 verified downloads; payouts reduce what is due and can never exceed it; every
// write is audited; /p/<CODE> redirects to the Play link and counts clicks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const addVerified = async (promoterId, n, source = 'link') => {
  const now = new Date();
  await H.ctx.M('PromoAttribution').bulkCreate(Array.from({ length: n }, () => ({ promoterId, source, verifiedAt: now, signedUpAt: now })));
};

test('admin-only: students and signed-out callers cannot list, create, edit or pay', async () => {
  const p = await H.mkPromoter();
  const student = await H.mkUser('student');
  const calls = [
    ['GET', '/api/admin/promoters'],
    ['POST', '/api/admin/promoters', { name: 'Hacker' }],
    ['PATCH', `/api/admin/promoters/${p.id}`, { active: false }],
    ['POST', `/api/admin/promoters/${p.id}/payouts`, { amount: 100 }],
    ['GET', `/api/admin/promoters/${p.id}/payouts`],
  ];
  for (const [m, url, body] of calls) {
    assert.equal((await H.api(m, url, { token: student.token, body })).status, 403, `${m} ${url} as student`);
    assert.equal((await H.api(m, url, { body })).status, 401, `${m} ${url} signed out`);
  }
  assert.equal((await H.stats(p.id)).active, true);
  assert.equal(await H.ctx.M('Promoter').count({ where: { name: 'Hacker' } }), 0);
});

test('create: custom codes are upper-cased and unique ignoring case; automatic codes; validation', async () => {
  const token = await H.adminToken();
  const c = await H.api('POST', '/api/admin/promoters', { token, body: { name: 'Sri Foodie', code: 'srmfoodie', phone: '+91 98765 43210', upiId: 'sri@okaxis' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.code, 'SRMFOODIE');
  assert.equal(c.body.phone, '9876543210');
  assert.equal(c.body.link, 'https://play.google.com/store/apps/details?id=com.srm.hostelbites&referrer=utm_source%3Dpromo%26utm_campaign%3DSRMFOODIE');
  assert.match(c.body.shortLink, /\/p\/SRMFOODIE$/);
  assert.deepEqual([c.body.verified, c.body.earned, c.body.paid, c.body.due, c.body.clicks], [0, 0, 0, 0, 0]);
  const dup = await H.api('POST', '/api/admin/promoters', { token, body: { name: 'Copy Cat', code: 'SrmFoodie' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'CODE_TAKEN');
  for (const code of ['AB1', 'TOOLONGCODE123456', 'RAVI-10', 'RA VI']) {
    assert.equal((await H.api('POST', '/api/admin/promoters', { token, body: { name: 'Bad Code', code } })).status, 400, code);
  }
  assert.equal((await H.api('POST', '/api/admin/promoters', { token, body: { name: 'x' } })).status, 400);
  assert.equal((await H.api('POST', '/api/admin/promoters', { token, body: { name: 'Bad Upi', upiId: 'not-a-upi' } })).status, 400);
  assert.equal((await H.api('POST', '/api/admin/promoters', { token, body: { name: 'Bad Phone', phone: '12345' } })).status, 400);
  const auto = await H.api('POST', '/api/admin/promoters', { token, body: { name: 'Auto Code' } });
  assert.equal(auto.status, 201);
  assert.match(auto.body.code, /^[A-Z0-9]{6}$/);
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'PROMOTER_CREATE' } });
  assert.ok(logs.some((l) => l.targetId === c.body.id), 'creation is audited');
});

test('earnings: Rs 100 per full 200 verified downloads (199 = 0, 200 = 100, 399 = 100, 400 = 200), link + code together', async () => {
  for (const [n, rupees] of [[199, 0], [200, 100], [399, 100], [400, 200]]) {
    const p = await H.mkPromoter();
    await addVerified(p.id, Math.floor(n / 2), 'link');
    await addVerified(p.id, n - Math.floor(n / 2), 'code');
    const s = await H.stats(p.id);
    assert.equal(s.verified, n);
    assert.equal(s.earned, rupees, `${n} verified`);
    assert.equal(s.payableCount, Math.floor(n / 200) * 200);
    assert.equal(s.due, rupees);
  }
  // Installs without a new account never count.
  const p = await H.mkPromoter();
  await H.ctx.M('PromoAttribution').bulkCreate(Array.from({ length: 250 }, () => ({ promoterId: p.id })));
  await addVerified(p.id, 199);
  const s = await H.stats(p.id);
  assert.equal(s.installs, 449);
  assert.equal(s.earned, 0);
});

test('payouts reduce what is due, never exceed it, and are audited', async () => {
  const token = await H.adminToken();
  const p = await H.mkPromoter();
  await addVerified(p.id, 400);
  const pay = (body) => H.api('POST', `/api/admin/promoters/${p.id}/payouts`, { token, body });
  const first = await pay({ amount: 150, note: 'UPI ref 1234', paidAt: '2026-11-05' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.deepEqual([first.body.promoter.earned, first.body.promoter.paid, first.body.promoter.due], [200, 150, 50]);
  assert.equal(first.body.payout.note, 'UPI ref 1234');
  const over = await pay({ amount: 100 });
  assert.equal(over.status, 400);
  assert.equal(over.body.code, 'OVER_DUE');
  assert.equal((await pay({ amount: 0 })).status, 400);
  assert.equal((await pay({ amount: 12.5 })).status, 400);
  assert.equal((await pay({ amount: 10, paidAt: 'not a date' })).status, 400);
  const rest = await pay({});
  assert.equal(rest.status, 201);
  assert.equal(rest.body.payout.amount, 50, 'no amount = everything due');
  assert.equal(rest.body.promoter.due, 0);
  const none = await pay({});
  assert.equal(none.status, 400);
  assert.equal(none.body.code, 'NOTHING_DUE');
  // Two clicks at once never pay twice.
  await addVerified(p.id, 200);
  const twin = await Promise.all([pay({}), pay({})]);
  assert.deepEqual(twin.map((x) => x.status).sort(), [201, 400]);
  const s = await H.stats(p.id);
  assert.deepEqual([s.earned, s.paid, s.due], [300, 300, 0]);
  const list = await H.api('GET', `/api/admin/promoters/${p.id}/payouts`, { token });
  assert.equal(list.body.payouts.length, 3);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'PROMOTER_PAYOUT', targetId: p.id } }), 3);
});

test('deactivate / edit is audited; the code never changes', async () => {
  const token = await H.adminToken();
  const p = await H.mkPromoter();
  const e = await H.api('PATCH', `/api/admin/promoters/${p.id}`, { token, body: { name: 'Ravi K', upiId: 'ravi@ybl', code: 'CHANGED1' } });
  assert.equal(e.status, 200);
  assert.equal(e.body.name, 'Ravi K');
  assert.equal(e.body.code, p.code);
  const off = await H.api('PATCH', `/api/admin/promoters/${p.id}`, { token, body: { active: false } });
  assert.equal(off.body.active, false);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'PROMOTER_DEACTIVATE', targetId: p.id } }), 1);
  assert.equal((await H.api('PATCH', '/api/admin/promoters/00000000-0000-4000-8000-000000000000', { token, body: { active: true } })).status, 404);
});

test('/p/<CODE> redirects to the Play link with the referrer and counts clicks; unknown codes go to the plain listing', async () => {
  const p = await H.mkPromoter();
  const r1 = await H.api('GET', `/p/${p.code.toLowerCase()}`);
  assert.equal(r1.status, 302);
  assert.equal(r1.headers.get('location'), p.link);
  await H.api('GET', `/p/${p.code}`);
  assert.equal((await H.stats(p.id)).clicks, 2);
  const u = await H.api('GET', '/p/NOSUCH1');
  assert.equal(u.status, 302);
  assert.equal(u.headers.get('location'), 'https://play.google.com/store/apps/details?id=com.srm.hostelbites');
});
