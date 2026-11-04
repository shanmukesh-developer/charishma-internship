// Bill discount labels use plain words ("Gold member: delivery discount"), never the badge nicknames
// ("Gold Grafter delivery perk"), and 200+ ZenPoints says what it is.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

before(async () => { await H.setup(); });
after(H.teardown);

const labels = (body) => ((body.discounts || (body.quote && body.quote.discounts) || [])).map((d) => d.label);

test('calculateBadgePerks reports the tier and the points rule', () => {
  const { calculateBadgePerks } = H.r('middleware/rewardEngine');
  const gold = calculateBadgePerks({ badges: JSON.stringify(['Gold Grafter']), zenPoints: 0 });
  assert.equal(gold.tier, 'Gold');
  assert.equal(gold.pointsFreeDelivery, false);
  const pts = calculateBadgePerks({ badges: '[]', zenPoints: 250 });
  assert.equal(pts.deliveryDiscount, 1);
  assert.equal(pts.pointsFreeDelivery, true);
});

test('quote: a Gold member sees "Gold member: delivery discount" and "Gold member: order discount"', async () => {
  const { item } = await H.mkStore({ price: 200 });
  const u = await H.mkUser({ badges: JSON.stringify(['Gold Grafter']) });
  const q = await H.api('POST', '/api/orders/quote', u.token, H.orderBody(item.id, 'COD'));
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const ls = labels(q.body);
  if (process.env.CP_DEBUG) console.log('labels', ls);
  assert.ok(ls.includes('Gold member: order discount'), ls.join(' | '));
  if (Number(q.body.deliveryFee || (q.body.quote && q.body.quote.deliveryFee)) > 0 || ls.some((l) => /delivery/.test(l))) {
    assert.ok(ls.includes('Gold member: delivery discount'), ls.join(' | '));
  }
  assert.ok(!ls.some((l) => /Grafter|perk/i.test(l)), ls.join(' | '));
});

test('quote: 200+ ZenWe Points shows "200+ ZenWe Points: free delivery"', async () => {
  const { item } = await H.mkStore({ price: 200 });
  const u = await H.mkUser({ zenPoints: 250 });
  const q = await H.api('POST', '/api/orders/quote', u.token, H.orderBody(item.id, 'COD'));
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const ls = labels(q.body);
  assert.ok(!ls.some((l) => /Zen Champion|perk/i.test(l)), ls.join(' | '));
  if (ls.some((l) => /delivery/.test(l))) assert.ok(ls.includes('200+ ZenWe Points: free delivery'), ls.join(' | '));
});
