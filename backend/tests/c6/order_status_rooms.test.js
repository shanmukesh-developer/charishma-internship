// PF-05 / PF-06 / PF-22 / PF-35 (partner-flow test, 6 Nov 2026).
//  PF-06: every status change reaches the customer's own room (`user_<id>`) as well as the order room: before, only
//         store-driven statuses did; the rider claim / Picking / PickedUp / at-gate / Delivered, the auto-cancels and
//         the admin rider changes went to the order room only (utils/orderStatusEmit).
//  PF-05: rider GPS sent over HTTP (app in the background) is relayed to the customer's tracking room like the socket path.
//  PF-35: the losing rider of a claim race is told "another rider has already taken this order" (ALREADY_CLAIMED).
//  PF-22: a claim undone because the rider went over the job limit is put back in the live rider pool at once.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);
beforeEach(() => { H.ctx.pushes.length = 0; H.ctx.emitted.length = 0; });

const inRooms = (e, room) => (Array.isArray(e.room) ? e.room.includes(room) : e.room === room);
const statusTo = (room, status) => H.ctx.emitted.filter((e) => e.ev === 'statusUpdated' && inRooms(e, room) && (!status || e.p.status === status));
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

test('PF-06: claim, Picking, PickedUp, ArrivedAtGate and Delivered all reach the customer\'s own room (once per emit)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const rider = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  H.ctx.emitted.length = 0;
  const c = await H.readyAndClaim(order.id, rider);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const claim = statusTo(`user_${u.id}`).find((e) => e.p.riderAssigned === true);
  assert.ok(claim, 'rider claim reaches user room');
  assert.ok(inRooms(claim, String(order.id)), 'same emit covers the order room (no duplicate for a socket in both)');
  assert.ok(claim.p.orderCode !== undefined, 'human order id on the payload');
  for (const status of ['Picking', 'PickedUp']) {
    const r = await H.api('PUT', `/api/delivery/status/${order.id}`, rider.token, { status });
    assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.body)}`);
    assert.equal(statusTo(`user_${u.id}`, status).length, 1, `${status} reaches the user room once`);
    assert.equal(statusTo('admin-room', status).length, 1);
  }
  const gate = await H.api('PUT', `/api/delivery/arrive/${order.id}`, rider.token, {});
  assert.equal(gate.status, 200, JSON.stringify(gate.body));
  assert.equal(statusTo(`user_${u.id}`, 'ArrivedAtGate').length, 1);
  const pin = (await H.ctx.M('Order').findByPk(order.id)).deliveryPin;
  const d = await H.deliver(order.id, rider, pin);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(statusTo(`user_${u.id}`, 'Delivered').length, 1);
});

test('PF-06: the auto-cancel (store did not accept in time) reaches the customer\'s own room', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const order = await H.placeOrder({ item, user: u });
  await H.ctx.M('Order').update({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }, { where: { id: order.id }, silent: true });
  H.ctx.emitted.length = 0;
  const io = { to: (room) => ({ emit: (ev, p) => H.ctx.emitted.push({ room, ev, p }) }) };
  const n = await H.r('controllers/orderController').autoCancelStalePendingOrders(io);
  assert.ok(n >= 1);
  const e = statusTo(`user_${u.id}`, 'Cancelled').find((x) => x.p.id === order.id);
  assert.ok(e, 'auto-cancel reaches the user room');
  assert.equal(e.p.reason, 'STORE_TIMEOUT');
});

test('PF-06: rider emergency release and admin assign / remove reach the customer\'s own room', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const rider = await H.mkRider();
  const other = await H.mkRider();
  const admin = await H.mkUser({ role: 'admin' });
  const order = await H.placeOrder({ item, user: u });
  assert.equal((await H.readyAndClaim(order.id, rider)).status, 200);
  H.ctx.emitted.length = 0;
  const rel = await H.api('PUT', `/api/delivery/cancel/${order.id}`, rider.token, {});
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  assert.ok(statusTo(`user_${u.id}`).some((e) => e.p.riderAssigned === false), 'rider release');
  assert.ok((await H.ctx.M('Order').findByPk(order.id)).riderReleasedAt, 'riderReleasedAt stamped on a rider release');
  H.ctx.emitted.length = 0;
  const a = await H.api('PUT', `/api/admin/orders/${order.id}/rider`, admin.token, { riderId: other.id });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const assigned = statusTo(`user_${u.id}`).find((e) => e.p.riderAssigned === true);
  assert.ok(assigned, 'admin assign');
  assert.ok(inRooms(assigned, `rider_${other.id}`), 'the new rider is told in the same emit');
  assert.ok((await H.ctx.M('Order').findByPk(order.id)).riderClaimedAt, 'admin assign starts a claim clock');
  H.ctx.emitted.length = 0;
  const rm = await H.api('PUT', `/api/admin/orders/${order.id}/rider`, admin.token, { riderId: null });
  assert.equal(rm.status, 200, JSON.stringify(rm.body));
  assert.ok(statusTo(`user_${u.id}`).some((e) => e.p.riderAssigned === false), 'admin remove');
});

test('PF-05: GPS over HTTP from the assigned rider reaches the order room as riderLocation (and the admin map)', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const rider = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  assert.equal((await H.readyAndClaim(order.id, rider)).status, 200);
  H.ctx.emitted.length = 0;
  const r = await H.api('POST', '/api/delivery/location', rider.token, { lat: 16.4651, lng: 80.5072, heading: 90, speed: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, true);
  await settle();
  const loc = H.ctx.emitted.find((e) => e.ev === 'riderLocation' && e.room === String(order.id));
  assert.ok(loc, JSON.stringify(H.ctx.emitted.map((e) => e.ev)));
  assert.equal(loc.p.orderId, String(order.id));
  assert.equal(loc.p.lat, 16.4651);
  assert.equal(loc.p.lng, 80.5072);
  assert.ok(Number.isFinite(loc.p.ts));
  assert.ok(H.ctx.emitted.some((e) => e.ev === 'admin_rider_location' && e.room === 'admin-room' && e.p.riderId === rider.id && e.p.lat === 16.4651));
  // Same 10 s limit as the socket path: an immediate second fix is not saved or relayed.
  H.ctx.emitted.length = 0;
  const again = await H.api('POST', '/api/delivery/location', rider.token, { lat: 16.4652, lng: 80.5073 });
  assert.equal(again.body.saved, false);
  await settle();
  assert.ok(!H.ctx.emitted.some((e) => e.ev === 'riderLocation'));
  // A rider with no order: stored, nothing sent to any order room.
  const idle = await H.mkRider();
  H.ctx.emitted.length = 0;
  assert.equal((await H.api('POST', '/api/delivery/location', idle.token, { lat: 16.46, lng: 80.5 })).body.saved, true);
  await settle();
  assert.ok(!H.ctx.emitted.some((e) => e.ev === 'riderLocation'));
  // The heartbeat for the stalled-claim job was written.
  assert.ok((await H.ctx.M('DeliveryPartner').findByPk(idle.id)).lastSeenAt);
});

test('PF-35: the losing rider of a claim race gets ALREADY_CLAIMED with a clear message', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const r1 = await H.mkRider();
  const r2 = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  assert.equal((await H.readyAndClaim(order.id, r1)).status, 200);
  const lose = await H.api('PUT', `/api/delivery/accept/${order.id}`, r2.token);
  assert.equal(lose.status, 400);
  assert.equal(lose.body.code, 'ALREADY_CLAIMED');
  assert.equal(lose.body.message, 'Another rider has already taken this order.');
  // Not accepted yet: its own code.
  const pending = await H.placeOrder({ item, user: u });
  const early = await H.api('PUT', `/api/delivery/accept/${pending.id}`, r2.token);
  assert.equal(early.status, 400);
  assert.equal(early.body.code, 'NOT_ACCEPTED');
});

test('PF-22: a claim undone by the job limit goes straight back to the live rider pool', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const rider = await H.mkRider();
  const order = await H.placeOrder({ item, user: u });
  await H.ctx.M('Order').update({ status: 'ReadyForPickup', acceptedAt: new Date(), readyAt: new Date() }, { where: { id: order.id } });
  // Two parallel claims by the same rider both passed the first count: the re-count sees 4 jobs.
  const riderLoad = H.r('utils/riderLoad');
  const real = riderLoad.activeJobs;
  let calls = 0;
  riderLoad.activeJobs = async (...a) => (++calls === 1 ? { orders: 0, baskets: 0, services: 0, total: 0 } : { orders: 4, baskets: 0, services: 0, total: 4 });
  try {
    H.ctx.emitted.length = 0;
    const c = await H.api('PUT', `/api/delivery/accept/${order.id}`, rider.token);
    assert.equal(c.status, 409, JSON.stringify(c.body));
    assert.equal(c.body.code, 'MAX_ACTIVE');
    assert.match(c.body.message, /3 orders/);
  } finally {
    riderLoad.activeJobs = real;
  }
  const row = await H.ctx.M('Order').findByPk(order.id);
  assert.equal(row.deliveryPartnerId, null);
  assert.ok(H.ctx.emitted.some((e) => e.ev === 'delivery_request' && (e.p.orderId === order.id || e.p.id === order.id || JSON.stringify(e.p).includes(order.id))), JSON.stringify(H.ctx.emitted.map((e) => [e.room, e.ev])));
});
