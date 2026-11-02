// S0 item 8: a campus-only spot (ProximityRoom.campusId set) needs a VERIFIED membership of that campus,
// over REST (list / history / post) and the /campus socket (proximity:join / proximity:message).
// A self-set (pending) campus no longer counts; spots for every campus stay open to every student.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const H = require('./helpers');

let verified; let pending; let outsider; let spot; let openSpot;
test.before(async () => {
  await H.setup();
  verified = await H.mkUser({ name: 'Spot Verified' });
  pending = await H.mkUser({ name: 'Spot Pending', verified: false }); // claims the same campus, unverified
  outsider = await H.mkUser({ name: 'Spot Outsider', campus: H.ctx.campus2 });
  const PR = H.ctx.M.ProximityRoom;
  spot = await PR.create({ name: 'S0 Library', slug: `s0-library-${process.pid}`, campusId: H.ctx.campus.id, isActive: true });
  openSpot = await PR.create({ name: 'S0 Everywhere', slug: `s0-everywhere-${process.pid}`, campusId: null, isActive: true });
});
test.after(() => H.teardown());

test('REST: only verified members of the campus see / read / post in its spot', async () => {
  const list = async (u) => (await H.api('GET', '/api/campus/proximity/rooms', u.token)).body.rooms.map((x) => x.slug);
  assert.ok((await list(verified)).includes(spot.slug));
  assert.ok(!(await list(pending)).includes(spot.slug), 'self-set campus must not unlock the spot');
  assert.ok(!(await list(outsider)).includes(spot.slug));
  for (const u of [verified, pending, outsider]) assert.ok((await list(u)).includes(openSpot.slug), 'open spot listed for everyone');

  let r = await H.api('POST', `/api/campus/proximity/rooms/${spot.slug}/messages`, verified.token, { text: 'hello library' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  for (const u of [pending, outsider]) {
    r = await H.api('GET', `/api/campus/proximity/rooms/${spot.slug}/messages`, u.token);
    assert.strictEqual(r.status, 404);
    r = await H.api('POST', `/api/campus/proximity/rooms/${spot.slug}/messages`, u.token, { text: 'sneaking in' });
    assert.strictEqual(r.status, 404);
  }
  r = await H.api('POST', `/api/campus/proximity/rooms/${openSpot.slug}/messages`, pending.token, { text: 'open spot ok' });
  assert.strictEqual(r.status, 201);
});

test('socket: proximity:join refused without a verified membership; a revoked verification stops posting', async () => {
  const { Server } = require(path.join(H.B, 'node_modules/socket.io'));
  const ioc = require(path.join(H.B, 'node_modules/socket.io-client'));
  const srv = http.createServer();
  const io = new Server(srv);
  H.r('modules/campus/campusSocket').initCampusSocket(io);
  await require('../listenFree').listenFree(srv);
  const url = `http://127.0.0.1:${srv.address().port}/campus`;
  const sv = ioc(url, { auth: { token: verified.token }, transports: ['websocket'] });
  const sp = ioc(url, { auth: { token: pending.token }, transports: ['websocket'] });
  try {
    await Promise.all([sv, sp].map((s) => new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); })));
    const ack = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
    let a = await ack(sp, 'proximity:join', { roomSlug: spot.slug });
    assert.strictEqual(a.error, 'Room not found');
    a = await ack(sp, 'proximity:join', { roomSlug: openSpot.slug });
    assert.strictEqual(a.status, 'joined');
    a = await ack(sv, 'proximity:join', { roomSlug: spot.slug });
    assert.strictEqual(a.status, 'joined');
    a = await ack(sv, 'proximity:message', { roomSlug: spot.slug, text: 'live hello' });
    assert.ok(!a.error, JSON.stringify(a));
    // verification revoked after joining: the next post is refused
    await H.ctx.M.CampusProfile.update({ verificationStatus: 'pending' }, { where: { userId: verified.id } });
    a = await ack(sv, 'proximity:message', { roomSlug: spot.slug, text: 'still here?' });
    assert.strictEqual(a.error, 'Room not found');
  } finally {
    sv.close(); sp.close();
    io.close();
    await new Promise((res) => srv.close(() => res()));
  }
});
