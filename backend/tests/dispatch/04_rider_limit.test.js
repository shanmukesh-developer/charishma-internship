// One limit for everything a rider carries (utils/riderLoad, owner 28 Oct: "there is no limit of taking or
// accepting order"): food orders, shopping lists and service pickups count together against
// RIDER_MAX_ACTIVE_JOBS (3). Before, lists had no cap and none of the three counted the others.
// Shopping lists can no longer be claimed (removed 28 Oct 2026), but a list a rider still holds keeps counting.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('./helpers');

const { H } = D;
before(async () => { await D.setup(); });
after(D.teardown);
beforeEach(() => D.reset());

// A list the rider took before shopping lists were removed (rows stay in the database).
const heldList = (cust, rider) => H.ctx.M('MegaBasket').create({ userId: cust.id, deliveryPartnerId: rider.id, status: 'PartnerAssigned', estimatedTotal: 40, deliveryAddress: 'Ganga, Room 412', paymentMethod: 'COD' });

test('orders, held shopping lists and pickups share one limit of 3 jobs per rider', async () => {
  const prev = process.env.DELIVERY_SLOTS;
  process.env.DELIVERY_SLOTS = 'off';
  try {
    const rider = await D.mkRider();
    const cust = await D.mkCustomer();
    // Two shopping lists still held from before their removal.
    await heldList(cust, rider);
    await heldList(cust, rider);
    // A pickup: the third job, allowed.
    const { item } = await D.mkServiceItem('TAILORING', { name: 'Shirt Alteration', price: 120 });
    const book = async () => (await D.api('POST', '/api/services/book', cust.token, {
      serviceType: 'TAILORING', title: 'Shirt Alteration', pickupSlot: 'Tomorrow, 10 AM', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210',
      specifications: { catalogueItemId: item.id, category: 'tailoring', quantity: 1 },
    })).body.booking.id;
    const s1 = await book();
    const s2 = await book();
    await D.quiet();
    assert.equal((await D.api('POST', `/api/services/${s1}/claim`, rider.token)).status, 200);
    // Full (2 lists + 1 pickup): a fourth job is refused with MAX_ACTIVE.
    const morePickup = await D.api('POST', `/api/services/${s2}/claim`, rider.token);
    assert.equal(morePickup.status, 409, JSON.stringify(morePickup.body));
    assert.equal(morePickup.body.code, 'MAX_ACTIVE');
    assert.match(morePickup.body.message, /2 shopping lists, 1 pickup \(3 at a time\)/);
    const load = await H.r('utils/riderLoad').activeJobs(rider.user ? rider.user.id : rider.id);
    assert.deepEqual(load, { orders: 0, baskets: 2, services: 1, total: 3 });
    // Another rider still takes it.
    const other = await D.mkRider();
    assert.equal((await D.api('POST', `/api/services/${s2}/claim`, other.token)).status, 200);
  } finally {
    if (prev === undefined) delete process.env.DELIVERY_SLOTS; else process.env.DELIVERY_SLOTS = prev;
  }
});
