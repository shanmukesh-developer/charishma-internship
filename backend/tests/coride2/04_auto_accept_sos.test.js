// autoAcceptKnown (riders who completed a ride with the host before are approved at once) and passenger
// SOS (POST /api/bikepool/posts/:id/sos): host / approved rider only, Critical ticket, admins pushed, rate limit.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const M = (n) => H.ctx.M(n);
before(H.setup);
after(H.teardown);

const post = (u, extra = {}) => H.api('POST', '/api/bikepool/posts', u.token, {
  creatorRole: 'rider', origin: 'SRM AP Main Gate', destination: 'Mangalagiri', departureTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  vehicleType: 'Car', availableSeats: 3, ...extra,
});
const completedTogether = async (hostId, passengerId) => {
  const past = await H.mkRide(hostId, { departureTime: new Date(Date.now() - 48 * 3600 * 1000), status: 'Completed' });
  await M('PoolRequest').create({ poolId: past.id, passengerId, status: 'Approved' });
};

test('autoAcceptKnown: a rider who completed a ride with the host is approved at once, a stranger waits', async () => {
  const host = await H.mkUser();
  const known = await H.mkUser();
  const knownReverse = await H.mkUser();
  const stranger = await H.mkUser();
  const cancelledOnly = await H.mkUser();
  await completedTogether(host.id, known.id);
  await completedTogether(knownReverse.id, host.id); // the host rode as a passenger with them
  const c = await H.mkRide(host.id, { departureTime: new Date(Date.now() - 24 * 3600 * 1000), status: 'Cancelled' });
  await M('PoolRequest').create({ poolId: c.id, passengerId: cancelledOnly.id, status: 'Approved' });

  const created = await post(host, { autoAcceptKnown: true });
  assert.equal(created.status, 201);
  assert.equal(created.body.autoAcceptKnown, true);
  const ride = created.body;

  let r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, known.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.autoAccepted, 'known');
  assert.equal(r.body.pool.availableSeats, 2);
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, knownReverse.token);
  assert.equal(r.body.autoAccepted, 'known');
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, stranger.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.message, 'Request sent to host for approval.');
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, cancelledOnly.token);
  assert.equal(r.body.message, 'Request sent to host for approval.');
  const status = async (u) => (await M('PoolRequest').findOne({ where: { poolId: ride.id, passengerId: u.id } })).status;
  assert.equal(await status(known), 'Approved');
  assert.equal(await status(knownReverse), 'Approved');
  assert.equal(await status(stranger), 'Pending');
  assert.equal(await status(cancelledOnly), 'Pending');
  assert.equal((await M('BikePool').findByPk(ride.id)).availableSeats, 1);

  // Without the flag, even a known rider waits for approval.
  const plain = (await post(host)).body;
  r = await H.api('POST', `/api/bikepool/posts/${plain.id}/join`, known.token);
  assert.equal(r.body.message, 'Request sent to host for approval.');
});

test('a template ride carries autoAcceptKnown through to joins', async () => {
  const host = await H.mkUser();
  const known = await H.mkUser();
  await completedTogether(host.id, known.id);
  const T = H.r('services/coRideTemplates');
  const { istYmd, istShift } = H.r('utils/istTime');
  const dep = new Date(Date.now() + 90 * 60 * 1000);
  const t = (await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody({ days: [0, 1, 2, 3, 4, 5, 6], time: istShift(dep).toISOString().slice(11, 16), autoAcceptKnown: true }))).body.template;
  await T.publishDueTemplates({ now: new Date() });
  const ride = await M('BikePool').findOne({ where: { templateId: t.id } });
  assert.ok(ride, `published for ${istYmd(dep)}`);
  const r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, known.token);
  assert.equal(r.body.autoAccepted, 'known');
});

test('SOS: only the host or an approved rider; Critical ticket + admin push', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const host = await H.mkUser({ name: 'Host Person' });
  const rider = await H.mkUser({ name: 'Rider Person' });
  const pending = await H.mkUser();
  const stranger = await H.mkUser();
  const ride = (await post(host)).body;
  await M('PoolRequest').create({ poolId: ride.id, passengerId: rider.id, status: 'Approved' });
  await M('PoolRequest').create({ poolId: ride.id, passengerId: pending.id, status: 'Pending' });

  assert.equal((await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, null, {})).status, 401);
  let r = await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, stranger.token, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NOT_ON_RIDE');
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, pending.token, {});
  assert.equal(r.status, 403);
  assert.equal((await H.api('POST', '/api/bikepool/posts/00000000-0000-4000-8000-000000000000/sos', rider.token, {})).status, 404);
  assert.equal(await M('Ticket').count(), 0);

  H.pushes.length = 0;
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, rider.token, { lat: 16.4632, lon: 80.5064, note: 'Driver <b>not</b> stopping' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.emergencyNumber, '112');
  assert.equal(r.body.locationShared, true);
  const ticket = await M('Ticket').findByPk(r.body.ticketId);
  assert.equal(ticket.priority, 'Critical');
  assert.equal(ticket.status, 'Open');
  assert.equal(ticket.userId, rider.id);
  assert.match(ticket.subject, /Co-Ride SOS \(rider\)/);
  assert.match(ticket.description, /16\.4632,80\.5064/);
  assert.match(ticket.description, /Driver bnot\/b stopping/);
  assert.match(ticket.description, /Host Person/);
  await H.tick(100);
  const adminPush = H.pushes.find((x) => x.data.type === 'CORIDE_SOS');
  assert.ok(adminPush, 'admins pushed');
  assert.deepEqual(adminPush.recipients.map(String), [String(admin.id)]);
  assert.equal(adminPush.data.ticketId, String(ticket.id));

  // The host may also raise one; bad coordinates are ignored, never fail the SOS.
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, host.token, { lat: 'abc', lon: 999 });
  assert.equal(r.status, 201);
  assert.equal(r.body.locationShared, false);
  assert.match((await M('Ticket').findByPk(r.body.ticketId)).subject, /\(host\)/);
});

test('SOS is rate limited per user (5 per 10 minutes); strangers do not use up the limit', async () => {
  const host = await H.mkUser();
  const rider = await H.mkUser();
  const stranger = await H.mkUser();
  const ride = (await post(host)).body;
  await M('PoolRequest').create({ poolId: ride.id, passengerId: rider.id, status: 'Approved' });
  for (let i = 0; i < 8; i++) assert.equal((await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, stranger.token, {})).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, rider.token, {})).status, 201);
  const r = await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, rider.token, {});
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'SOS_RATE_LIMIT');
  // Another participant has their own allowance.
  assert.equal((await H.api('POST', `/api/bikepool/posts/${ride.id}/sos`, host.token, {})).status, 201);
  await H.tick(200); // let the fire-and-forget admin pushes finish before the database closes
});
