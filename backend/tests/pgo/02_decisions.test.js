// Accept / reject / move-out change the booking status, keep the room's free beds in sync and notify the
// student through the customer notification path (push + in-app Notification row). The owner hears about
// new requests too.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let pg; let room; let room2; let owner;

test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  pg = await H.mkPg(admin);
  room = await H.mkRoom(admin, pg.id, { totalBeds: 2, availableBeds: 2 });
  room2 = await H.mkRoom(admin, pg.id, { totalBeds: 3, availableBeds: 1, sharingType: 3, hasAC: false, pricePerBed: 6000 });
  owner = await H.readyOwner(admin, [pg.id]);
});
test.after(H.teardown);

test('a new request carries stay length + note and notifies the owner', async () => {
  const student = await H.mkUser({ name: 'Ravi Kumar' });
  const res = await H.book(student, room.id, { durationMonths: 6, note: 'Need a bed near the window' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const list = await H.api('GET', '/api/pg-owner/bookings', owner.token);
  const b = list.body.bookings.find((x) => x.id === res.body.booking.id);
  assert.ok(b, 'owner sees the request');
  assert.strictEqual(b.durationMonths, 6);
  assert.strictEqual(b.note, 'Need a bed near the window');
  assert.strictEqual(b.student.firstName, 'Ravi');
  assert.strictEqual(b.room.roomNumber, room.roomNumber);
  const inbox = await H.notificationsFor(owner.id);
  assert.ok(inbox.some((n) => n.type === 'PG_OWNER_BOOKING'), 'owner inbox row');
  const ownerInbox = await H.api('GET', '/api/pg-owner/notifications', owner.token);
  assert.ok(ownerInbox.body.unread >= 1);
});

test('a note with a phone number and a bad stay length are refused', async () => {
  const student = await H.mkUser();
  const phoneNote = await H.book(student, room.id, { note: 'Call me on 98765 43210' });
  assert.strictEqual(phoneNote.status, 400, JSON.stringify(phoneNote.body));
  const bad = await H.book(student, room.id, { durationMonths: 40 });
  assert.strictEqual(bad.status, 400);
});

test('accept confirms, takes a bed and notifies the student', async () => {
  const student = await H.mkUser();
  const req = await H.book(student, room.id, { durationMonths: 3 });
  const before = (await H.ctx.M('PGRoom').findByPk(room.id)).availableBeds;
  H.push.calls.length = 0;
  const r = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/accept`, owner.token, {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.status, 'Confirmed');
  const row = await H.ctx.M('PGBooking').findByPk(req.body.booking.id);
  assert.strictEqual(row.status, 'Confirmed');
  assert.strictEqual(row.decidedBy, `pg_owner:${owner.id}`);
  assert.strictEqual((await H.ctx.M('PGRoom').findByPk(room.id)).availableBeds, before - 1);
  const call = H.push.calls.find((c) => c.data.type === 'PG_BOOKING_STATUS');
  assert.ok(call, 'push sent');
  assert.deepStrictEqual(call.recipients, [student.id]);
  assert.strictEqual(call.data.status, 'Confirmed');
  const inbox = await H.notificationsFor(student.id);
  assert.ok(inbox.some((n) => n.type === 'PG_BOOKING_STATUS' && /confirmed/i.test(n.title)), 'student in-app notification');
  // Accepting twice is harmless; rejecting an accepted request is refused.
  assert.strictEqual((await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/accept`, owner.token, {})).status, 200);
  const rej = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/reject`, owner.token, { reason: 'Changed my mind' });
  assert.strictEqual(rej.status, 409, JSON.stringify(rej.body));
  // The student's own list shows it confirmed.
  const mine = await H.api('GET', '/api/pg/bookings/mine', student.token);
  assert.strictEqual(mine.body[0].status, 'Confirmed');
});

test('accept into another room of the same PG', async () => {
  const student = await H.mkUser();
  const req = await H.book(student, room.id);
  const r = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/accept`, owner.token, { roomId: room2.id });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.room.id, room2.id);
  assert.strictEqual((await H.ctx.M('PGRoom').findByPk(room2.id)).availableBeds, 0);
});

test('accept with no free bed left is refused and changes nothing', async () => {
  const student = await H.mkUser();
  await H.ctx.M('PGRoom').update({ availableBeds: 1 }, { where: { id: room.id } });
  const req = await H.book(student, room.id);
  assert.strictEqual(req.status, 201, JSON.stringify(req.body));
  await H.ctx.M('PGRoom').update({ availableBeds: 0 }, { where: { id: room.id } });
  const r = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/accept`, owner.token, {});
  assert.strictEqual(r.status, 400, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'NO_BEDS');
  assert.strictEqual((await H.ctx.M('PGBooking').findByPk(req.body.booking.id)).status, 'Pending');
  await H.ctx.M('PGRoom').update({ availableBeds: 2 }, { where: { id: room.id } });
});

test('reject needs a reason, stores it and notifies the student; they can ask again', async () => {
  const student = await H.mkUser();
  const req = await H.book(student, room.id);
  const noReason = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/reject`, owner.token, {});
  assert.strictEqual(noReason.status, 400);
  const withPhone = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/reject`, owner.token, { reason: 'Call 9876543210' });
  assert.strictEqual(withPhone.status, 400, 'no phone numbers in the reason');
  const beds = (await H.ctx.M('PGRoom').findByPk(room.id)).availableBeds;
  H.push.calls.length = 0;
  const r = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/reject`, owner.token, { reason: 'Full for that month' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const row = await H.ctx.M('PGBooking').findByPk(req.body.booking.id);
  assert.strictEqual(row.status, 'Rejected');
  assert.strictEqual(row.decisionReason, 'Full for that month');
  assert.strictEqual((await H.ctx.M('PGRoom').findByPk(room.id)).availableBeds, beds, 'a rejected request holds no bed');
  const call = H.push.calls.find((c) => c.data.type === 'PG_BOOKING_STATUS');
  assert.ok(call && call.data.status === 'Rejected' && /Full for that month/.test(call.body), JSON.stringify(H.push.calls));
  assert.ok((await H.notificationsFor(student.id)).some((n) => n.type === 'PG_BOOKING_STATUS'));
  // Final: cannot accept it later, and the student may send a new request.
  assert.strictEqual((await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/accept`, owner.token, {})).status, 400);
  const again = await H.book(student, room.id);
  assert.strictEqual(again.status, 201, JSON.stringify(again.body));
  assert.ok((await H.auditRows('PG_OWNER_BOOKING_REJECTED')).length >= 1);
});

test('move-out frees the bed and the tenant leaves the tenants list', async () => {
  const student = await H.mkUser();
  const req = await H.book(student, room.id);
  await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/accept`, owner.token, {});
  const beds = (await H.ctx.M('PGRoom').findByPk(room.id)).availableBeds;
  const t1 = await H.api('GET', '/api/pg-owner/tenants', owner.token);
  assert.ok(t1.body.tenants.some((t) => t.id === req.body.booking.id));
  const r = await H.api('POST', `/api/pg-owner/bookings/${req.body.booking.id}/move-out`, owner.token, {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual((await H.ctx.M('PGRoom').findByPk(room.id)).availableBeds, beds + 1);
  const t2 = await H.api('GET', '/api/pg-owner/tenants', owner.token);
  assert.ok(!t2.body.tenants.some((t) => t.id === req.body.booking.id));
  assert.ok(t2.body.past.some((t) => t.id === req.body.booking.id));
  // Pending requests cannot be "moved out".
  const pending = await H.book(await H.mkUser(), room.id);
  assert.strictEqual((await H.api('POST', `/api/pg-owner/bookings/${pending.body.booking.id}/move-out`, owner.token, {})).status, 409);
});

test('book -> cancel -> book again tells the owner once; the 11th request in a day is refused', async () => {
  const student = await H.mkUser({ name: 'Loop Tester' });
  const ownerRows = async () => (await H.notificationsFor(owner.id)).filter((n) => n.type === 'PG_OWNER_BOOKING').length;
  const before = await ownerRows();
  let made = 0;
  for (let i = 0; i < 3; i++) {
    const b = await H.book(student, room.id, {});
    assert.strictEqual(b.status, 201, JSON.stringify(b.body));
    made += 1;
    const c = await H.api('PUT', `/api/pg/bookings/${b.body.booking.id}/cancel`, student.token, {});
    assert.ok(c.status < 300, JSON.stringify(c.body));
  }
  assert.strictEqual(await ownerRows(), before + 1, 'one owner notification for three rounds');
  while (made < 10) {
    const b = await H.book(student, room.id, {});
    assert.strictEqual(b.status, 201, JSON.stringify(b.body));
    made += 1;
    await H.api('PUT', `/api/pg/bookings/${b.body.booking.id}/cancel`, student.token, {});
  }
  const over = await H.book(student, room.id, {});
  assert.strictEqual(over.status, 429, JSON.stringify(over.body));
  assert.strictEqual(over.body.code, 'BOOKING_LIMIT');
});

test('an owner decision reaches the student live (pg:changed, ids and status only)', async () => {
  const realtime = H.r('utils/realtime');
  const seen = [];
  const noop = { emit() {}, socketsJoin() {}, socketsLeave() {}, fetchSockets: async () => [] };
  realtime.init({ to: (room) => ({ ...noop, emit: (ev, p) => seen.push({ room, ev, p }) }), in: () => noop, emit() {}, of: () => ({ to: () => noop, in: () => noop, fetchSockets: async () => [] }), fetchSockets: async () => [], sockets: { adapter: { rooms: new Map() }, sockets: new Map() } });
  try {
    const student = await H.mkUser({ name: 'Live Student' });
    const b = await H.book(student, room.id, {});
    assert.strictEqual(b.status, 201, JSON.stringify(b.body));
    const r = await H.api('POST', `/api/pg-owner/bookings/${b.body.booking.id}/accept`, owner.token, {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const ev = seen.find((e) => e.room === `user_${student.id}` && e.ev === 'pg:changed');
    assert.ok(ev, JSON.stringify(seen.map((e) => e.ev)));
    assert.strictEqual(ev.p.bookingId, String(b.body.booking.id));
    assert.strictEqual(ev.p.status, 'Confirmed');
  } finally {
    realtime.init({ to: () => ({ emit: () => {} }), emit: () => {}, in: () => ({ socketsJoin() {}, socketsLeave() {}, fetchSockets: async () => [] }), fetchSockets: async () => [], of: () => ({ fetchSockets: async () => [], in: () => ({ fetchSockets: async () => [] }) }), sockets: { adapter: { rooms: new Map() }, sockets: new Map() } });
  }
});

test('PF-08: a student cancelling a request tells the owner (push + inbox row), not for an owner-only test PG', async () => {
  const student = await H.mkUser({ name: 'Meena Rao' });
  const res = await H.book(student, room.id, {});
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const titles = async () => (await H.notificationsFor(owner.id)).filter((n) => n.type === 'PG_OWNER_BOOKING_CANCELLED');
  const before = (await titles()).length;
  const c = await H.api('PUT', `/api/pg/bookings/${res.body.booking.id}/cancel`, student.token, {});
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  for (let i = 0; i < 40 && (await titles()).length === before; i++) await new Promise((r) => setTimeout(r, 50));
  const rows = await titles();
  assert.strictEqual(rows.length, before + 1, 'one owner notice');
  assert.match(rows[rows.length - 1].body, /^Meena cancelled their request for room /);
  assert.doesNotMatch(rows[rows.length - 1].body, /Rao/, 'first name only');
  // Sent again and withdrawn again within the "notify once" window: the owner was not pushed about the new request,
  // so its cancel is not pushed either (no book -> cancel ringing loop).
  const again = await H.book(student, room.id, {});
  assert.strictEqual(again.status, 201, JSON.stringify(again.body));
  assert.strictEqual((await H.api('PUT', `/api/pg/bookings/${again.body.booking.id}/cancel`, student.token, {})).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual((await titles()).length, before + 1);
});
