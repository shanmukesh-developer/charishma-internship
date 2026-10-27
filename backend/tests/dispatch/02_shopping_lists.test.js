// Shopping lists (Mega Basket) reach the riders: a new list is announced once to every on-duty rider (live
// 'rider_job' + push on delivery-alerts-v3); a slot list only when its rider window opens (45 min before the
// slot, released by the 'orders.slotDispatch' job, exactly once). The customer hears every step that needs them
// (rider took it, bill to approve, on the way, delivered) and the rider hears the approval / a cancel.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('./helpers');

const { H, IST, setNow } = D;
before(async () => { await D.setup(); });
after(D.teardown);
beforeEach(() => D.reset());
afterEach(() => setNow(null));

const list = (extra = {}) => ({ items: [{ name: 'Bread', quantity: 1, priceEstimated: 40 }, { name: 'Milk', quantity: 2, priceEstimated: 30 }], deliveryAddress: 'Ganga, Room 412', paymentMethod: 'COD', ...extra });

test('a new list rings on-duty riders once and is in their pool', async () => {
  setNow(IST('2026-10-28T11:00:00'));
  const rider = await D.mkRider();
  const off = await D.mkRider({ online: false });
  const cust = await D.mkCustomer();
  const mb = await D.api('POST', '/api/mega-basket', cust.token, list({ deliverySlot: '2026-10-28|S1' })); // 12:30 slot: window open at 11:45
  assert.equal(mb.status, 201, JSON.stringify(mb.body));
  await D.settle(700);
  // 11:00 is before the window: held back.
  assert.equal(D.jobEvents().length, 0, 'slot list held until its window');
  assert.equal(D.pushesTo(rider.pushToken).length, 0);
  const released0 = await H.r('controllers/megaBasketController').releaseDueSlotBaskets();
  assert.equal(released0.released, 0);

  setNow(IST('2026-10-28T11:45:00'));
  const viaJob = await H.r('jobs/index').runJob('orders.slotDispatch');
  assert.ok(viaJob && !viaJob.error, JSON.stringify(viaJob));
  await D.settle(700);
  assert.equal(D.jobEvents((e) => e.room === 'riders_online' && e.p.kind === 'basket' && e.p.id === mb.body.id && e.p.action === 'new').length, 1);
  const rang = D.pushesTo(rider.pushToken);
  assert.equal(rang.length, 1, JSON.stringify(D.fcm));
  assert.equal(rang[0].channel, 'delivery-alerts-v3');
  assert.equal(rang[0].data.kind, 'basket');
  assert.match(rang[0].body, /2 items to buy and deliver/);
  assert.equal(D.pushesTo(off.pushToken).length, 0);
  // Never twice.
  assert.equal((await H.r('controllers/megaBasketController').releaseDueSlotBaskets()).released, 0);

  const pool = await D.api('GET', '/api/mega-basket/rider/pending', rider.token);
  assert.ok(pool.body.some((b) => b.id === mb.body.id));
});

test('lists without a slot (slots off) ring at once', async () => {
  const before = process.env.DELIVERY_SLOTS;
  process.env.DELIVERY_SLOTS = 'off';
  try {
    const rider = await D.mkRider();
    const cust = await D.mkCustomer();
    const mb = await D.api('POST', '/api/mega-basket', cust.token, list());
    assert.equal(mb.status, 201, JSON.stringify(mb.body));
    await D.settle(700);
    assert.equal(D.pushesTo(rider.pushToken).length, 1, JSON.stringify(D.fcm));
    const row = await H.ctx.M('MegaBasket').findByPk(mb.body.id);
    assert.ok(row.slotDispatchedAt, 'marked as announced');
  } finally {
    process.env.DELIVERY_SLOTS = before;
  }
});

test('claim -> bill -> approve -> deliver: the customer and the rider each hear their step', async () => {
  const before = process.env.DELIVERY_SLOTS;
  process.env.DELIVERY_SLOTS = 'off';
  try {
    const rider = await D.mkRider();
    const cust = await D.mkCustomer();
    const mb = await D.api('POST', '/api/mega-basket', cust.token, list());
    const id = mb.body.id;
    await D.quiet();

    assert.equal((await D.api('POST', `/api/mega-basket/${id}/claim`, rider.token)).status, 200);
    await D.settle(700);
    assert.equal(D.jobEvents((e) => e.room === 'riders_online' && e.p.id === id && e.p.action === 'gone').length, 1);
    assert.equal(D.pushesTo(cust.pushToken).at(-1).title, 'A rider took your shopping list');

    const items = (await H.ctx.M('MegaBasketItem').findAll({ where: { basketId: id } }));
    for (const it of items) assert.equal((await D.api('PUT', `/api/mega-basket/${id}/item-status`, rider.token, { itemId: it.id, status: 'Purchased', priceActual: 35 })).status, 200);
    D.reset();
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
    const pin = (await H.ctx.M('MegaBasket').findByPk(id)).deliveryPin;
    assert.equal((await D.api('POST', `/api/mega-basket/${id}/complete-delivery`, rider.token, { deliveryPin: pin })).status, 200);
    await D.settle(700);
    assert.equal(D.pushesTo(cust.pushToken).at(-1).title, 'Shopping delivered');
  } finally {
    process.env.DELIVERY_SLOTS = before;
  }
});

test('customer cancels after a rider claimed: the rider is pushed', async () => {
  const before = process.env.DELIVERY_SLOTS;
  process.env.DELIVERY_SLOTS = 'off';
  try {
    const rider = await D.mkRider();
    const cust = await D.mkCustomer();
    const id = (await D.api('POST', '/api/mega-basket', cust.token, list())).body.id;
    assert.equal((await D.api('POST', `/api/mega-basket/${id}/claim`, rider.token)).status, 200);
    await D.quiet();
    assert.equal((await D.api('PUT', `/api/mega-basket/${id}/cancel`, cust.token)).status, 200);
    await D.settle(700);
    const got = D.pushesTo(rider.pushToken);
    assert.equal(got.length, 1, JSON.stringify(D.fcm));
    assert.equal(got[0].title, 'Shopping list cancelled');
  } finally {
    process.env.DELIVERY_SLOTS = before;
  }
});
