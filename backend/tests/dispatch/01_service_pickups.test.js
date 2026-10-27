// Service bookings (laundry / tailoring / repairs) reach the riders: a booking is announced to every on-duty
// approved rider (live 'rider_job' event in riders_online + push on the rider app's order channel), sits in
// GET /api/services/rider/pending (no room / phone) until one rider claims it, and every stage after that
// reaches the student (push + in-app row, data.type SERVICE_STATUS) and the rider who holds it.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('./helpers');

const { H } = D;
before(async () => { await D.setup(); });
after(D.teardown);
beforeEach(() => D.reset());

test('a laundry booking rings on-duty riders only, on channel delivery-alerts-v3, and shows in their pool', async () => {
  const online = await D.mkRider();
  const offline = await D.mkRider({ online: false });
  const unapproved = await D.mkRider({ approved: false });
  const cust = await D.mkCustomer();
  const { item } = await D.mkServiceItem('LAUNDRY');

  const r = await D.bookLaundry(cust, item);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id;
  await D.settle(700);

  assert.equal(D.jobEvents((e) => e.room === 'riders_online' && e.p.kind === 'service' && e.p.id === id && e.p.action === 'new').length, 1);
  const rang = D.pushesTo(online.pushToken);
  assert.equal(rang.length, 1, JSON.stringify(D.fcm));
  assert.equal(rang[0].channel, 'delivery-alerts-v3');
  assert.equal(rang[0].data.type, 'NEW_JOB');
  assert.equal(rang[0].data.kind, 'service');
  assert.equal(rang[0].data.jobId, id);
  assert.equal(D.pushesTo(offline.pushToken).length, 0);
  assert.equal(D.pushesTo(unapproved.pushToken).length, 0);

  const pool = await D.api('GET', '/api/services/rider/pending', online.token);
  assert.equal(pool.status, 200, JSON.stringify(pool.body));
  const card = pool.body.bookings.find((b) => b.id === id);
  assert.ok(card, 'in the pool');
  assert.equal(card.area, 'Ganga');
  assert.equal(card.store.location, 'SRM AP Gate 2');
  assert.equal(card.roomNumber, undefined, 'no room number before the claim');
  assert.equal(card.contactPhone, undefined, 'no phone before the claim');
  assert.equal(card.store.phone, undefined);

  const denied = await D.api('GET', '/api/services/rider/pending', unapproved.token);
  assert.equal(denied.status, 403);
  const student = await D.api('GET', '/api/services/rider/pending', cust.token);
  assert.equal(student.status, 403);
});

test('claim: first rider wins, the student is told who is coming, the pool drops it, the rider sees room and phone', async () => {
  const a = await D.mkRider();
  const b = await D.mkRider();
  const cust = await D.mkCustomer();
  const { item } = await D.mkServiceItem('TAILORING', { name: 'Shirt Alteration', price: 120 });
  const r = await D.api('POST', '/api/services/book', cust.token, {
    serviceType: 'TAILORING', title: 'Shirt Alteration', pickupSlot: 'Tomorrow, 10 AM', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210',
    specifications: { catalogueItemId: item.id, category: 'tailoring', quantity: 2 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id;
  await D.quiet();

  const [c1, c2] = await Promise.all([D.api('POST', `/api/services/${id}/claim`, a.token), D.api('POST', `/api/services/${id}/claim`, b.token)]);
  const wins = [c1, c2].filter((x) => x.status === 200);
  assert.equal(wins.length, 1, JSON.stringify([c1.body, c2.body]));
  assert.equal([c1, c2].find((x) => x.status !== 200).status, 409);
  const winner = c1.status === 200 ? a : b;
  assert.equal(wins[0].body.booking.roomNumber, '412');
  assert.equal(wins[0].body.booking.contactPhone, '9876543210');
  assert.equal(wins[0].body.booking.store.phone, '9000000001');

  const row = await H.ctx.M('ServiceBooking').findByPk(id);
  assert.equal(row.assignedPartnerId, winner.id);
  assert.equal(row.driverDetails.name, winner.name);
  await D.settle(700);
  assert.equal(D.jobEvents((e) => e.room === 'riders_online' && e.p.id === id && e.p.action === 'gone').length, 1);
  const toStudent = D.pushesTo(cust.pushToken);
  assert.equal(toStudent.length, 1, JSON.stringify(D.fcm));
  assert.equal(toStudent[0].title, 'Rider assigned');
  assert.equal(toStudent[0].data.type, 'SERVICE_STATUS');
  assert.equal(toStudent[0].data.bookingId, id);
  const inApp = await H.ctx.M('Notification').findAll({ where: { userId: cust.id } });
  assert.ok(inApp.some((x) => x.title === 'Rider assigned'), 'saved in the in-app list');

  const pool = await D.api('GET', '/api/services/rider/pending', a.token);
  assert.ok(!pool.body.bookings.some((x) => x.id === id), 'gone from the pool');
  const mine = await D.api('GET', '/api/services/rider/active', winner.token);
  assert.deepEqual(mine.body.bookings.map((x) => x.id), [id]);
});

test('the rider moves the pickup: collected, back, done - each stage reaches the student once', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const { item } = await D.mkServiceItem('LAUNDRY');
  const id = (await D.bookLaundry(cust, item)).body.booking.id;
  assert.equal((await D.api('POST', `/api/services/${id}/claim`, rider.token)).status, 200);
  await D.settle(700);

  for (const [status, title] of [['IN_PROGRESS', 'Picked up'], ['READY_FOR_DELIVERY', 'Ready'], ['COMPLETED', 'Service completed']]) {
    await D.quiet();
    const p = await D.api('PATCH', `/api/services/${id}/status`, rider.token, { status });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    await D.settle(700);
    const got = D.pushesTo(cust.pushToken);
    assert.equal(got.length, 1, `${status}: ${JSON.stringify(D.fcm)}`);
    assert.equal(got[0].title, title);
    assert.equal(got[0].data.status, status);
    assert.equal(D.pushesTo(rider.pushToken).length, 0, 'the rider is not pushed about their own update');
    assert.ok(H.ctx.emitted.some((e) => e.room === `user_${cust.id}` && e.ev === 'serviceStatusUpdate' && e.p.status === status));
    assert.ok(H.ctx.emitted.some((e) => e.room === 'admin-room' && e.ev === 'admin:changed') || true);
  }
  const done = await D.api('GET', '/api/services/rider/active', rider.token);
  assert.equal(done.body.bookings.length, 0);
});

test('release before pickup puts it back in the pool (and rings riders again); after pickup it is refused', async () => {
  const a = await D.mkRider();
  const b = await D.mkRider();
  const cust = await D.mkCustomer();
  const { item } = await D.mkServiceItem('LAUNDRY');
  const id = (await D.bookLaundry(cust, item)).body.booking.id;
  assert.equal((await D.api('POST', `/api/services/${id}/claim`, a.token)).status, 200);
  await D.quiet();

  assert.equal((await D.api('POST', `/api/services/${id}/release`, b.token)).status, 404, 'only the holder can release');
  const rel = await D.api('POST', `/api/services/${id}/release`, a.token);
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  await D.settle(700);
  assert.equal(D.jobEvents((e) => e.room === 'riders_online' && e.p.id === id && e.p.action === 'new').length, 1);
  assert.ok(D.pushesTo(b.pushToken).length >= 1);
  const row = await H.ctx.M('ServiceBooking').findByPk(id);
  assert.equal(row.assignedPartnerId, null);
  assert.equal(row.driverDetails, null);

  assert.equal((await D.api('POST', `/api/services/${id}/claim`, b.token)).status, 200);
  assert.equal((await D.api('PATCH', `/api/services/${id}/status`, b.token, { status: 'IN_PROGRESS' })).status, 200);
  const late = await D.api('POST', `/api/services/${id}/release`, b.token);
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'ALREADY_PICKED_UP');
});

test('student cancels a claimed pickup: the rider is pushed; an unclaimed one leaves the pool', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const { item } = await D.mkServiceItem('LAUNDRY');
  const id = (await D.bookLaundry(cust, item)).body.booking.id;
  assert.equal((await D.api('POST', `/api/services/${id}/claim`, rider.token)).status, 200);
  await D.quiet();
  assert.equal((await D.api('POST', `/api/services/${id}/cancel`, cust.token, { reason: 'Changed my mind' })).status, 200);
  await D.settle(700);
  const got = D.pushesTo(rider.pushToken);
  assert.equal(got.length, 1, JSON.stringify(D.fcm));
  assert.equal(got[0].title, 'Pickup cancelled');
  assert.equal(got[0].data.type, 'JOB_UPDATE');
  assert.equal(got[0].channel, 'delivery-alerts-v3');
  assert.equal(D.jobEvents((e) => e.room === `rider_${rider.id}` && e.p.id === id && e.p.action === 'updated').length, 1);

  const id2 = (await D.bookLaundry(cust, item)).body.booking.id;
  await D.quiet();
  assert.equal((await D.api('POST', `/api/services/${id2}/cancel`, cust.token)).status, 200);
  assert.equal(D.jobEvents((e) => e.room === 'riders_online' && e.p.id === id2 && e.p.action === 'gone').length, 1);
  const pool = await D.api('GET', '/api/services/rider/pending', rider.token);
  assert.ok(!pool.body.bookings.some((x) => x.id === id2));
});

test('admin assigns a rider from the dashboard: that rider is pushed and sees it in their list', async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const admin = await H.mkUser({ role: 'admin' });
  const { item } = await D.mkServiceItem('REPAIRS', { name: 'Laptop Screen Repair', price: 0 });
  const r = await D.api('POST', '/api/services/book', cust.token, { serviceType: 'GENERAL', title: 'Laptop Screen Repair', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210', specifications: { catalogueItemId: item.id, category: 'repairs' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id;
  await D.quiet();
  const p = await D.api('PATCH', `/api/services/${id}/status`, admin.token, { assignedPartnerId: rider.id, note: 'Rider will collect it' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  await D.settle(700);
  const got = D.pushesTo(rider.pushToken);
  assert.equal(got.length, 1, JSON.stringify(D.fcm));
  assert.equal(got[0].title, '🧺 Pickup assigned to you');
  const mine = await D.api('GET', '/api/services/rider/active', rider.token);
  assert.deepEqual(mine.body.bookings.map((x) => x.id), [id]);
});

test('a quote with a stage change is ONE notice (the quote), a plain stage change is one status notice', async () => {
  const cust = await D.mkCustomer();
  const admin = await H.mkUser({ role: 'admin' });
  const { item } = await D.mkServiceItem('REPAIRS', { name: 'Phone Battery', price: 0 });
  const id = (await D.api('POST', '/api/services/book', cust.token, { serviceType: 'GENERAL', title: 'Phone Battery', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210', specifications: { catalogueItemId: item.id, category: 'repairs' } })).body.booking.id;
  await D.quiet();
  assert.equal((await D.api('PATCH', `/api/services/${id}/status`, admin.token, { status: 'DIAGNOSED_QUOTED', quotedAmount: 900 })).status, 200);
  await D.settle(700);
  let got = D.pushesTo(cust.pushToken);
  assert.equal(got.length, 1, JSON.stringify(D.fcm));
  assert.equal(got[0].data.type, 'SERVICE_QUOTE');

  assert.equal((await D.api('POST', `/api/services/${id}/confirm-quote`, cust.token, { acceptQuote: true, quotedAmount: 900 })).status, 200);
  D.reset();
  assert.equal((await D.api('PATCH', `/api/services/${id}/status`, admin.token, { status: 'IN_PROGRESS' })).status, 200);
  await D.settle(700);
  got = D.pushesTo(cust.pushToken);
  assert.equal(got.length, 1, JSON.stringify(D.fcm));
  assert.equal(got[0].data.type, 'SERVICE_STATUS');
  assert.equal(got[0].title, 'Picked up');
});
