// GET /api/rewards/coupons/history: the Deals "Used" and "Expired" tabs. Only the signed-in user's coupons, only
// the last 90 days, used ones never listed as expired, and unused live coupons stay out (they are /coupons).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const DAY = 86400000;
let n = 0;
const mk = (userId, extra) => H.ctx.M('Coupon').create({ code: `HIST${Date.now()}${++n}`, type: 'DISCOUNT', value: 30, userId, ...extra });

test('history lists used and expired coupons, newest first, and nothing else', async () => {
  const u = await H.mkUser();
  const other = await H.mkUser();
  const now = Date.now();
  const live = await mk(u.id, { expiryDate: new Date(now + 3 * DAY) });
  const used = await mk(u.id, { isUsed: true, expiryDate: new Date(now + 3 * DAY) });
  const expiredNew = await mk(u.id, { expiryDate: new Date(now - 1 * DAY) });
  const expiredOld = await mk(u.id, { expiryDate: new Date(now - 5 * DAY), type: 'FREEDEL', value: 0 });
  const tooOld = await mk(u.id, { expiryDate: new Date(now - 120 * DAY) });
  await mk(other.id, { isUsed: true });

  const r = await H.api('GET', '/api/rewards/coupons/history', u.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.used.map((c) => c.id), [used.id]);
  assert.equal(r.body.used[0].status, 'used');
  assert.ok(r.body.used[0].usedAt);
  assert.equal(r.body.used[0].label, '₹30 off');
  assert.deepEqual(r.body.expired.map((c) => c.id), [expiredNew.id, expiredOld.id]);
  assert.equal(r.body.expired[1].label, 'Free delivery');
  const all = [...r.body.used, ...r.body.expired].map((c) => c.id);
  assert.ok(!all.includes(live.id) && !all.includes(tooOld.id));
});

test('history needs sign-in', async () => {
  const r = await H.api('GET', '/api/rewards/coupons/history');
  assert.equal(r.status, 401);
});
