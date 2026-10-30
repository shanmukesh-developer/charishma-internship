// Co-Ride notifications (project-wide hunt, 30 Oct 2026): join requests, approvals, declines, host cancellations and a
// co-rider leaving used to notify nobody. Each now pushes the other side (push + inbox row) with a CORIDE_* type the
// app routes (data.path or data.poolId); approvals stop 30 minutes after departure.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const M = (n) => H.ctx.M(n);
before(H.setup);
after(H.teardown);
beforeEach(() => { H.pushes.length = 0; });

// Pushes are sent without blocking the reply: give them a moment to land.
const settle = () => new Promise((r) => setTimeout(r, 150));
const pushFor = (user, type) => H.pushes.find((p) => p.data && p.data.type === type && p.recipients.map(String).includes(String(user.id)));

test('request, approve, decline: the host and the passenger are each told', async () => {
  const host = await H.mkUser();
  const asker = await H.mkUser();
  const declined = await H.mkUser();
  const ride = await H.mkRide(host.id, { departureTime: new Date(Date.now() + 2 * 3600 * 1000), availableSeats: 2 });

  let r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, asker.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const ask = pushFor(host, 'CORIDE_JOIN_REQUEST');
  assert.ok(ask, 'host told about the request');
  assert.equal(ask.data.path, '/coride/my-rides');
  assert.match(ask.body, /asked to join your ride/);

  const req1 = await M('PoolRequest').findOne({ where: { poolId: ride.id, passengerId: asker.id } });
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/requests/${req1.id}/approve`, host.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const ok = pushFor(asker, 'CORIDE_REQUEST_APPROVED');
  assert.ok(ok, 'passenger told they are in');
  assert.equal(ok.data.poolId, String(ride.id));

  await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, declined.token);
  const req2 = await M('PoolRequest').findOne({ where: { poolId: ride.id, passengerId: declined.id } });
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/requests/${req2.id}/reject`, host.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const no = pushFor(declined, 'CORIDE_REQUEST_DECLINED');
  assert.ok(no, 'passenger told they were declined');
  assert.equal(no.data.path, '/coride/find');
});

test('host cancels: every passenger with a request is told; a co-rider leaving tells the host', async () => {
  const host = await H.mkUser();
  const a = await H.mkUser();
  const b = await H.mkUser();
  const ride = await H.mkRide(host.id, { departureTime: new Date(Date.now() + 3 * 3600 * 1000), availableSeats: 3 });
  await M('PoolRequest').create({ poolId: ride.id, passengerId: a.id, status: 'Approved' });
  await M('PoolRequest').create({ poolId: ride.id, passengerId: b.id, status: 'Pending' });

  const other = await H.mkRide(host.id, { departureTime: new Date(Date.now() + 3 * 3600 * 1000), availableSeats: 2 });
  const leaver = await H.mkUser({ name: 'Priya Sharma' });
  await H.api('POST', `/api/bikepool/posts/${other.id}/join`, leaver.token);
  const lr = await M('PoolRequest').findOne({ where: { poolId: other.id, passengerId: leaver.id } });
  await H.api('POST', `/api/bikepool/posts/${other.id}/requests/${lr.id}/approve`, host.token);
  H.pushes.length = 0;

  let r = await H.api('POST', `/api/bikepool/posts/${other.id}/cancel`, leaver.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const left = pushFor(host, 'CORIDE_PASSENGER_LEFT');
  assert.ok(left, 'host told a co-rider left');
  assert.match(left.body, /^Priya left your ride/);

  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/cancel`, host.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const cancelled = H.pushes.find((p) => p.data.type === 'CORIDE_RIDE_CANCELLED');
  assert.ok(cancelled, 'passengers told the ride is off');
  assert.deepEqual(cancelled.recipients.map(String).sort(), [String(a.id), String(b.id)].sort());
});

test('a ride that left over 30 minutes ago takes no more approvals', async () => {
  const host = await H.mkUser();
  const late = await H.mkUser();
  const ride = await H.mkRide(host.id, { departureTime: new Date(Date.now() - 45 * 60 * 1000), availableSeats: 2 });
  const req = await M('PoolRequest').create({ poolId: ride.id, passengerId: late.id, status: 'Pending' });
  const r = await H.api('POST', `/api/bikepool/posts/${ride.id}/requests/${req.id}/approve`, host.token);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.message, /already left/);
  assert.equal((await req.reload()).status, 'Pending');
});
