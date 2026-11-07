// PF-01 / PF-12 / PF-17 (partner-flow test, 6 Nov 2026): a rider who claims an order and disappears must not hold it
// forever. Before: the only release rule needed readyAt, so a buy-at-store order (starts Accepted, never "ready") or a
// kitchen that never pressed Ready kept the rider attached for good, the customer's cancel answered
// CANCEL_WINDOW_CLOSED and the "no rider" cancel skipped it. Now (orderController.releaseStalledRiderClaims):
//  - past the pickup deadline (claim / food due + RIDER_PICKUP_TIMEOUT_MIN) with the rider's app quiet
//    (utils/riderSeen) -> released at once (RIDER_INACTIVE);
//  - rider still active -> one reminder + admin alert, released RIDER_CLAIM_HARD_EXTRA_MIN later (PICKUP_TIMEOUT);
//  - every release: rider event + ONE push with the real reason (PF-12), customer + store + admins told, the "no rider"
//    clock restarts (no cancel on the next run), and a buy-at-store order is cancellable again.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const MIN = 60 * 1000;
const ago = (min) => new Date(Date.now() - min * MIN);
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin', fcmTokens: ['admin-device-token'] });
});
after(H.teardown);
beforeEach(() => { H.ctx.pushes.length = 0; H.ctx.emitted.length = 0; H.r('utils/riderSeen')._reset(); });

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
// The harness' socket stand-in (the one the routes use).
const fakeIo = () => ({ to: (room) => ({ emit: (ev, p) => H.ctx.emitted.push({ room, ev, p }) }), emit: (ev, p) => H.ctx.emitted.push({ room: '*', ev, p }) });
const inRooms = (e, room) => (Array.isArray(e.room) ? e.room.includes(room) : e.room === room);

/** Customer order claimed by a rider through the real claim route, then everything moved `minAgo` back. */
const claimedOrder = async ({ riderBuys, method = 'COD', wallet = 0, minAgo = 180, riderQuietMin = 180, estDuration = null } = {}) => {
  const { item, store } = await H.mkStore({ price: 100, riderBuys });
  await store.update({ fcmTokens: [{ token: `store-${store.id}`, app: 'restaurant' }] });
  const u = await H.mkUser({ wallet, fcmTokens: [`cust-${Date.now()}-${Math.random()}`] });
  const rider = await H.mkRider();
  await rider.update({ fcmTokens: [{ token: `rider-${rider.id}` }] });
  const order = await H.placeOrder({ item, user: u, method });
  if (!riderBuys) await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: new Date(), estDuration }, { where: { id: order.id } });
  const c = await H.api('PUT', `/api/delivery/accept/${order.id}`, rider.token);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  await settle(); // the heartbeat write from the claim request (fire-and-forget) lands first
  const row = await H.ctx.M('Order').findByPk(order.id);
  assert.ok(row.riderClaimedAt, 'the claim stamps riderClaimedAt');
  await H.ctx.M('Order').update({ createdAt: ago(minAgo + 2), acceptedAt: ago(minAgo + 1), riderClaimedAt: ago(minAgo), updatedAt: ago(minAgo) }, { where: { id: order.id }, silent: true });
  await H.ctx.M('DeliveryPartner').update({ lastSeenAt: ago(riderQuietMin), liveLocation: { lat: 16.46, lng: 80.5, ts: ago(riderQuietMin).toISOString() } }, { where: { id: rider.id } });
  H.ctx.pushes.length = 0; H.ctx.emitted.length = 0;
  return { order: await H.ctx.M('Order').findByPk(order.id), u, rider, store };
};
const pushesTo = (token) => H.ctx.pushes.filter((p) => (p.tokens || []).some((t) => (typeof t === 'string' ? t : t && t.token) === token));

test('buy-at-store order, rider gone quiet 3 h: released (RIDER_INACTIVE), everyone told, customer can cancel again', async () => {
  const { order, u, rider } = await claimedOrder({ riderBuys: true }); // buy-at-store shops take COD only
  assert.equal(order.status, 'Accepted');
  assert.equal(order.readyAt, null);
  // Before the job: the customer cannot cancel while the rider is on it... unless the rider is stalled (see next test).
  const n = await H.r('controllers/orderController').releaseStalledRiderClaims(fakeIo());
  assert.equal(n, 1);
  const row = await H.ctx.M('Order').findByPk(order.id);
  assert.equal(row.deliveryPartnerId, null);
  assert.equal(row.status, 'Accepted');
  assert.ok(row.riderReleasedAt, 'riderReleasedAt stamped');
  assert.equal((await H.ctx.M('DeliveryPartner').findByPk(rider.id)).currentOrderId, null, 'rider no longer busy with it');
  // Rider: live event + exactly one push, with the real reason (PF-12: no "support gave it to another rider").
  assert.ok(H.ctx.emitted.some((e) => e.room === `rider_${rider.id}` && e.ev === 'orderReleased' && e.p.reason === 'RIDER_INACTIVE'));
  const riderPushes = pushesTo(`rider-${rider.id}`);
  assert.equal(riderPushes.length, 1, JSON.stringify(riderPushes));
  assert.equal(riderPushes[0].data.type, 'ORDER_RELEASED');
  assert.equal(riderPushes[0].data.reason, 'RIDER_INACTIVE');
  assert.doesNotMatch(riderPushes[0].body, /another rider\b.*support|ZenWe support/);
  // Customer: statusUpdated in the order room AND their own room, plus a push.
  assert.ok(H.ctx.emitted.some((e) => e.ev === 'statusUpdated' && inRooms(e, String(order.id)) && inRooms(e, `user_${u.id}`) && e.p.riderAssigned === false));
  assert.ok(pushesTo(u.fcmTokens[0]).some((p) => p.title === 'Finding you a new rider'));
  // Admins: one summary push. Riders: the order is back in the pool.
  assert.ok(pushesTo('admin-device-token').some((p) => p.title === '⏱️ Rider did not pick up'));
  assert.ok(H.ctx.emitted.some((e) => e.ev === 'delivery_request'), 'back in the live rider pool');
  // The "no rider" cancel does not fire on the next run: the clock restarted at the release.
  const cancelled = await H.r('controllers/orderController').autoCancelStalePendingOrders(fakeIo());
  assert.equal(cancelled, 0);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Accepted');
  // The buy-at-store rule applies again: no rider on it -> the customer may cancel.
  const g = await H.api('GET', `/api/orders/${order.id}`, u.token);
  assert.equal(g.body.canCancel, true);
  const c = await H.api('PUT', `/api/orders/${order.id}/cancel`, u.token, {});
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'Cancelled');
  // A second job run is a no-op.
  assert.equal(await H.r('controllers/orderController').releaseStalledRiderClaims(fakeIo()), 0);
});

test('buy-at-store order with a stalled, quiet rider: the customer cancel releases the rider and succeeds at once', async () => {
  const { order, u, rider } = await claimedOrder({ riderBuys: true });
  const c = await H.api('PUT', `/api/orders/${order.id}/cancel`, u.token, {});
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const row = await H.ctx.M('Order').findByPk(order.id);
  assert.equal(row.status, 'Cancelled');
  assert.equal(row.deliveryPartnerId, null);
  assert.ok(H.ctx.emitted.some((e) => e.room === `rider_${rider.id}` && e.ev === 'orderReleased'));
  // The customer is cancelling: no "finding you a new rider" push.
  assert.ok(!pushesTo(u.fcmTokens[0]).some((p) => p.title === 'Finding you a new rider'));
});

test('buy-at-store order, rider active and within the pickup window: not released, cancel still refused', async () => {
  const { order, u, rider } = await claimedOrder({ riderBuys: true, minAgo: 10, riderQuietMin: 0 });
  assert.equal(await H.r('controllers/orderController').releaseStalledRiderClaims(fakeIo()), 0);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).deliveryPartnerId, rider.id);
  const c = await H.api('PUT', `/api/orders/${order.id}/cancel`, u.token, {});
  assert.equal(c.status, 400);
  assert.equal(c.body.code, 'CANCEL_WINDOW_CLOSED');
  assert.equal(pushesTo(`rider-${rider.id}`).length, 0);
});

test('login store never marked Ready, rider still active: one reminder + admin alert, then released after the hard limit', async () => {
  // Claimed 25 min ago (deadline = claim + 20 min passed), rider active 1 min ago.
  const { order, rider, store } = await claimedOrder({ riderBuys: false, minAgo: 25, riderQuietMin: 1 });
  const C = H.r('controllers/orderController');
  assert.equal(await C.releaseStalledRiderClaims(fakeIo()), 0);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).deliveryPartnerId, rider.id, 'an active rider keeps it for now');
  const reminders = pushesTo(`rider-${rider.id}`);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].data.type, 'PICKUP_REMINDER');
  assert.ok(pushesTo('admin-device-token').some((p) => p.title === 'Rider has not picked up'));
  // The next run does not repeat the reminder.
  H.ctx.pushes.length = 0;
  assert.equal(await C.releaseStalledRiderClaims(fakeIo()), 0);
  assert.equal(pushesTo(`rider-${rider.id}`).length, 0);
  // 45 min after the claim (deadline + 20 min hard limit) with the rider still active: released, PICKUP_TIMEOUT.
  await H.ctx.M('Order').update({ riderClaimedAt: ago(45), acceptedAt: ago(46), createdAt: ago(47), updatedAt: ago(45) }, { where: { id: order.id }, silent: true });
  await H.ctx.M('DeliveryPartner').update({ lastSeenAt: new Date() }, { where: { id: rider.id } });
  assert.equal(await C.releaseStalledRiderClaims(fakeIo()), 1);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).deliveryPartnerId, null);
  const released = pushesTo(`rider-${rider.id}`);
  assert.equal(released.length, 1, 'exactly one push to the rider (PF-12)');
  assert.equal(released[0].data.reason, 'PICKUP_TIMEOUT');
  assert.match(released[0].body, /did not pick up/);
  // The store (partner login) is told the rider changed.
  assert.ok(pushesTo(`store-${store.id}`).some((p) => p.title === 'Rider changed'));
});

test('long prep time: the pickup deadline counts from when the food is due, not from the claim', async () => {
  // Accepted 61 min ago with a 60-minute prep estimate, claimed 59 min ago: food due 1 min ago -> deadline in 19 min.
  const { order, rider } = await claimedOrder({ riderBuys: false, minAgo: 59, riderQuietMin: 180, estDuration: 60 });
  await H.ctx.M('Order').update({ acceptedAt: ago(61) }, { where: { id: order.id }, silent: true });
  assert.equal(await H.r('controllers/orderController').releaseStalledRiderClaims(fakeIo()), 0);
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).deliveryPartnerId, rider.id);
});

test('ready at the counter for 20+ min (rule 1): released with ONE rider push carrying the real reason (PF-12)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const rider = await H.mkRider();
  await rider.update({ fcmTokens: [{ token: `rider-${rider.id}` }] });
  const order = await H.placeOrder({ item, user: u });
  const c = await H.readyAndClaim(order.id, rider);
  assert.equal(c.status, 200);
  await settle();
  await H.ctx.M('Order').update({ readyAt: ago(30), updatedAt: ago(25) }, { where: { id: order.id }, silent: true });
  H.ctx.pushes.length = 0; H.ctx.emitted.length = 0;
  assert.equal(await H.r('controllers/orderController').releaseStalledRiderClaims(fakeIo()), 1);
  await settle(); // releaseOrderRider's old-rider push is fire-and-forget: give it the chance to (wrongly) arrive
  const riderPushes = pushesTo(`rider-${rider.id}`);
  assert.equal(riderPushes.length, 1, JSON.stringify(riderPushes.map((p) => p.title)));
  assert.equal(riderPushes[0].title, 'Order released');
  assert.equal(riderPushes[0].data.reason, 'PICKUP_TIMEOUT');
  assert.equal((await H.ctx.M('Order').findByPk(order.id)).status, 'ReadyForPickup');
});

test('stalledClaimVerdict: unit cases', () => {
  const { stalledClaimVerdict } = H.r('controllers/orderController');
  const base = { id: 'x', status: 'Accepted', deliveryPartnerId: 'r', readyAt: null, fulfilment: 'ZENVY', createdAt: ago(60), acceptedAt: ago(60), riderClaimedAt: ago(30), estDuration: null };
  const active = { isOnline: true, lastSeenAt: new Date(), liveLocation: {} };
  const quiet = { isOnline: true, lastSeenAt: ago(15), liveLocation: { ts: ago(15).toISOString() } };
  assert.deepEqual(stalledClaimVerdict(base, active), { action: 'nudge' });
  assert.deepEqual(stalledClaimVerdict(base, quiet), { action: 'release', reason: 'RIDER_INACTIVE' });
  assert.deepEqual(stalledClaimVerdict(base, { ...active, isOnline: false }), { action: 'release', reason: 'RIDER_INACTIVE' });
  assert.deepEqual(stalledClaimVerdict(base, null), { action: 'release', reason: 'RIDER_INACTIVE' });
  // A fresh GPS fix counts as a sign of life even when lastSeenAt is old.
  assert.deepEqual(stalledClaimVerdict(base, { isOnline: true, lastSeenAt: ago(60), liveLocation: { ts: new Date().toISOString() } }), { action: 'nudge' });
  assert.deepEqual(stalledClaimVerdict({ ...base, riderClaimedAt: ago(41) }, active), { action: 'release', reason: 'PICKUP_TIMEOUT' });
  assert.deepEqual(stalledClaimVerdict({ ...base, riderClaimedAt: ago(5) }, quiet), { action: null });
  assert.deepEqual(stalledClaimVerdict({ ...base, status: 'Picking' }, quiet), { action: null });
  assert.deepEqual(stalledClaimVerdict({ ...base, readyAt: ago(30) }, quiet), { action: null }, 'rule 1 handles ready orders');
  assert.deepEqual(stalledClaimVerdict({ ...base, fulfilment: 'VENDOR' }, quiet), { action: null });
});

test('PF-17: the "about to be cancelled" escalation is timed on the same clock as the no-rider cancel', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const order = await H.placeOrder({ item, user: u });
  // Accepted 20 min ago with a 60-minute prep: the "no rider" clock has not even started (food due in 40 min).
  await H.ctx.M('Order').update({ status: 'Accepted', acceptedAt: ago(20), createdAt: ago(21), estDuration: 60 }, { where: { id: order.id }, silent: true });
  const rider = await H.mkRider();
  await rider.update({ fcmTokens: [{ token: `rider-${rider.id}` }], liveLocation: { lat: 16.46, lng: 80.5, ts: new Date().toISOString() } });
  H.ctx.pushes.length = 0;
  await H.r('controllers/orderController').escalateUnclaimedOrders(fakeIo());
  assert.ok(!H.ctx.pushes.some((p) => /about to be cancelled|still waiting|pick it up\?/i.test(p.title)), JSON.stringify(H.ctx.pushes.map((p) => p.title)));
  // 19 min past the food-due time: the last round (with the admin alert) is due.
  await H.ctx.M('Order').update({ acceptedAt: ago(79), createdAt: ago(80) }, { where: { id: order.id }, silent: true });
  await H.r('controllers/orderController').escalateUnclaimedOrders(fakeIo());
  await settle(400); // the admin alert of that round is fire-and-forget
  assert.ok(H.ctx.pushes.some((p) => p.title === '⏰ Order about to be cancelled'), JSON.stringify(H.ctx.pushes.map((p) => p.title)));
  assert.ok(pushesTo('admin-device-token').some((p) => p.title === 'No rider for an order'));
});
