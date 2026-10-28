// Shopping lists (Mega Basket) were removed (owner, 28 Oct 2026). No new list is created, announced to riders or
// claimable, and the rider pool is always empty. Lists that already exist stay in the database; a list a rider
// already holds still finishes (bill -> approve -> deliver, with every notice), a held list can still be cancelled,
// and a list nobody took is closed by the auto-cancel job.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('./helpers');

const { H, setNow } = D;
before(async () => { await D.setup(); });
after(D.teardown);
beforeEach(() => D.reset());
afterEach(() => setNow(null));

const list = (extra = {}) => ({ items: [{ name: 'Bread', quantity: 1, priceEstimated: 40 }, { name: 'Milk', quantity: 2, priceEstimated: 30 }], deliveryAddress: 'Ganga, Room 412', paymentMethod: 'COD', ...extra });

// A list as it was before the removal (rows stay in the database).
const seedList = async (cust, { rider = null, status = 'PaidEstimate' } = {}) => {
  const basket = await H.ctx.M('MegaBasket').create({
    userId: cust.id, deliveryPartnerId: rider ? rider.id : null, status, estimatedTotal: 100, shoppingFee: 30, deliveryFee: 20,
    deliveryAddress: 'Ganga, Room 412', paymentMethod: 'COD', deliveryPin: '4321',
  });
  await H.ctx.M('MegaBasketItem').create({ basketId: basket.id, name: 'Bread', quantity: 1, priceEstimated: 40 });
  await H.ctx.M('MegaBasketItem').create({ basketId: basket.id, name: 'Milk', quantity: 2, priceEstimated: 30 });
  return basket;
};

test('a new list is refused with 410 and nothing is created or announced', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const before = await H.ctx.M('MegaBasket').count();
  const mb = await D.api('POST', '/api/mega-basket', cust.token, list({ deliverySlot: '2026-10-28|S1' }));
  assert.equal(mb.status, 410, JSON.stringify(mb.body));
  assert.equal(mb.body.message, 'Shopping lists are no longer available.');
  await D.settle(500);
  assert.equal(await H.ctx.M('MegaBasket').count(), before);
  assert.equal(D.jobEvents().length, 0);
  assert.equal(D.pushesTo(rider.pushToken).length, 0);
  // The slot job no longer announces lists either.
  const viaJob = await H.r('jobs/index').runJob('orders.slotDispatch');
  assert.ok(viaJob && !viaJob.error && !viaJob.baskets, JSON.stringify(viaJob));
});

test('the rider pool is always empty and an old unclaimed list cannot be claimed', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const old = await seedList(cust);
  const pool = await D.api('GET', '/api/mega-basket/rider/pending', rider.token);
  assert.equal(pool.status, 200);
  assert.deepEqual(pool.body, []);
  const claim = await D.api('POST', `/api/mega-basket/${old.id}/claim`, rider.token);
  assert.equal(claim.status, 410, JSON.stringify(claim.body));
  const row = await H.ctx.M('MegaBasket').findByPk(old.id);
  assert.equal(row.deliveryPartnerId, null);
  assert.equal(row.status, 'PaidEstimate');
});

test('an unclaimed list left from before is closed by the auto-cancel job, its customer told', async () => {
  const cust = await D.mkCustomer();
  const old = await seedList(cust);
  const out = await H.r('controllers/megaBasketController').closeUnclaimedBaskets(null);
  assert.ok(out >= 1);
  assert.equal((await H.ctx.M('MegaBasket').findByPk(old.id)).status, 'Cancelled');
  const told = D.pushesTo(cust.pushToken);
  assert.equal(told.length, 1, JSON.stringify(D.fcm));
  assert.match(told[0].body, /no longer available/);
  // A held list is never touched.
  const rider = await D.mkRider();
  const held = await seedList(cust, { rider, status: 'PartnerAssigned' });
  await H.r('controllers/megaBasketController').closeUnclaimedBaskets(null);
  assert.equal((await H.ctx.M('MegaBasket').findByPk(held.id)).status, 'PartnerAssigned');
});

test('a list the rider already holds still finishes: bill -> approve -> deliver, each side hears its step', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const id = (await seedList(cust, { rider, status: 'PartnerAssigned' })).id;

  const mine = await D.api('GET', '/api/mega-basket/rider/active', rider.token);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.some((b) => b.id === id));

  assert.equal((await D.api('POST', `/api/mega-basket/${id}/start-shopping`, rider.token)).status, 200);
  const items = await H.ctx.M('MegaBasketItem').findAll({ where: { basketId: id } });
  for (const it of items) assert.equal((await D.api('PUT', `/api/mega-basket/${id}/item-status`, rider.token, { itemId: it.id, status: 'Purchased', priceActual: 35 })).status, 200);
  await D.quiet();
  assert.equal((await D.api('POST', `/api/mega-basket/${id}/submit-bill`, rider.token)).status, 200);
  await D.settle(700);
  const bill = D.pushesTo(cust.pushToken);
  assert.equal(bill.length, 1, JSON.stringify(D.fcm));
  assert.equal(bill[0].title, 'Approve your shopping bill');
  assert.match(bill[0].body, /₹105/);

  D.reset();
  assert.equal((await D.api('POST', `/api/mega-basket/${id}/approve`, cust.token, { actualTotal: 105 })).status, 200);
  await D.settle(700);
  const ok = D.pushesTo(rider.pushToken);
  assert.equal(ok.length, 1, JSON.stringify(D.fcm));
  assert.equal(ok[0].title, '✅ Bill approved');
  assert.equal(ok[0].channel, 'delivery-alerts-v3');
  assert.equal(D.jobEvents((e) => e.room === `rider_${rider.id}` && e.p.id === id && e.p.action === 'updated').length, 1);

  D.reset();
  assert.equal((await D.api('POST', `/api/mega-basket/${id}/start-delivery`, rider.token)).status, 200);
  await D.settle(700);
  assert.equal(D.pushesTo(cust.pushToken).at(-1).title, 'Your shopping is on the way');
  assert.equal((await D.api('POST', `/api/mega-basket/${id}/complete-delivery`, rider.token, { deliveryPin: '4321' })).status, 200);
  await D.settle(700);
  assert.equal(D.pushesTo(cust.pushToken).at(-1).title, 'Shopping delivered');
  assert.equal((await H.ctx.M('MegaBasket').findByPk(id)).status, 'Delivered');
});

test('customer cancels a list a rider holds: the rider is pushed', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const id = (await seedList(cust, { rider, status: 'PartnerAssigned' })).id;
  assert.equal((await D.api('PUT', `/api/mega-basket/${id}/cancel`, cust.token)).status, 200);
  await D.settle(700);
  const got = D.pushesTo(rider.pushToken);
  assert.equal(got.length, 1, JSON.stringify(D.fcm));
  assert.equal(got[0].title, 'Shopping list cancelled');
});
