// 29 Oct 2026 security pass: a referrer is paid ZCS Points for at most 10 friends (later referrals still count),
// and the public leaderboard shows first names only (no account id, no photo).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const apply = (user, code) => H.api('POST', '/api/features/referral/apply', user.token, { referralCode: code });

test('a referrer earns points for the first 10 friends only; the count keeps growing', async () => {
  const referrer = await H.mkUser({ referralCode: `RF${Date.now().toString(36).toUpperCase()}`, referralCount: 9, zenPoints: 0 });
  const friend1 = await H.mkUser();
  let r = await apply(friend1, referrer.referralCode);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await referrer.reload();
  assert.deepEqual([referrer.referralCount, referrer.zenPoints], [10, 50], 'the 10th friend still pays');
  const friend2 = await H.mkUser();
  r = await apply(friend2, referrer.referralCode);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await referrer.reload();
  assert.deepEqual([referrer.referralCount, referrer.zenPoints], [11, 50], 'the 11th friend counts, without points');
  await friend2.reload();
  assert.equal(friend2.zenPoints, 50, 'the new friend still gets their welcome points');
});

test('public leaderboard: first names only, no account ids or photos', async () => {
  await H.mkUser({ name: 'Ravi Kumar Reddy', completedOrders: 999 });
  const r = await H.api('GET', '/api/rewards/leaderboard');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body) && r.body.length > 0);
  for (const row of r.body) {
    assert.equal(row.id, undefined);
    assert.equal(row.profileImage, undefined);
    assert.ok(!String(row.name).includes(' '), `first name only: ${row.name}`);
  }
  assert.ok(r.body.some((row) => row.name === 'Ravi'));
});
