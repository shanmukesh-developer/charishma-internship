// Owners only see and edit their own listings: another owner's PG, booking, rent row or complaint is a 404;
// customer / admin tokens never work on the owner routes and owner tokens never work as customer sessions.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let pgA; let pgB; let roomA; let roomB; let ownerA; let ownerB; let student; let bookingB;

test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  pgA = await H.mkPg(admin);
  pgB = await H.mkPg(admin);
  roomA = await H.mkRoom(admin, pgA.id);
  roomB = await H.mkRoom(admin, pgB.id);
  ownerA = await H.readyOwner(admin, [pgA.id]);
  ownerB = await H.readyOwner(admin, [pgB.id]);
  student = await H.mkUser();
  const b = await H.book(student, roomB.id);
  assert.strictEqual(b.status, 201, JSON.stringify(b.body));
  bookingB = b.body.booking;
});
test.after(H.teardown);

test('home lists only the owner\'s own listings', async () => {
  const a = await H.api('GET', '/api/pg-owner/home', ownerA.token);
  assert.strictEqual(a.status, 200, JSON.stringify(a.body));
  assert.deepStrictEqual(a.body.listings.map((l) => l.id), [pgA.id]);
  assert.strictEqual(a.body.counts.pendingRequests, 0, 'owner A must not count owner B\'s request');
  const b = await H.api('GET', '/api/pg-owner/home', ownerB.token);
  assert.deepStrictEqual(b.body.listings.map((l) => l.id), [pgB.id]);
  assert.strictEqual(b.body.counts.pendingRequests, 1);
});

test('another owner\'s listing is 404 for read and every write', async () => {
  const t = ownerA.token;
  const id = pgB.id;
  const calls = [
    ['GET', `/api/pg-owner/listings/${id}`],
    ['PUT', `/api/pg-owner/listings/${id}/availability`, { rooms: [{ id: roomB.id, availableBeds: 0 }] }],
    ['PUT', `/api/pg-owner/listings/${id}/mess`, { messTimetable: { meals: [{ label: 'Lunch' }] } }],
    ['PUT', `/api/pg-owner/listings/${id}/info`, { description: 'Hijacked' }],
    ['PUT', `/api/pg-owner/listings/${id}/house-rules`, { houseRules: [{ category: 'other', rules: ['No'] }] }],
    ['PUT', `/api/pg-owner/listings/${id}/photos`, { photos: [] }],
  ];
  for (const [m, url, body] of calls) {
    const r = await H.api(m, url, t, body);
    assert.strictEqual(r.status, 404, `${m} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  const room = await H.ctx.M('PGRoom').findByPk(roomB.id);
  assert.strictEqual(room.availableBeds, 2, 'availability of B unchanged');
  const pg = await H.ctx.M('PGHostel').findByPk(pgB.id);
  assert.notStrictEqual(pg.description, 'Hijacked');
});

test('another owner\'s booking cannot be seen, accepted, rejected or charged rent', async () => {
  const list = await H.api('GET', '/api/pg-owner/bookings?status=all', ownerA.token);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.bookings.length, 0);
  const asked = await H.api('GET', `/api/pg-owner/bookings?status=all&hostelId=${pgB.id}`, ownerA.token);
  assert.strictEqual(asked.body.bookings.length, 0, 'hostelId filter cannot widen the scope');
  for (const action of ['accept', 'reject']) {
    const r = await H.api('POST', `/api/pg-owner/bookings/${bookingB.id}/${action}`, ownerA.token, { reason: 'Not my PG' });
    assert.strictEqual(r.status, 404, `${action}: ${JSON.stringify(r.body)}`);
  }
  const b = await H.ctx.M('PGBooking').findByPk(bookingB.id);
  assert.strictEqual(b.status, 'Pending');
  const rent = await H.api('POST', '/api/pg-owner/rent', ownerA.token, { bookingId: bookingB.id, month: new Date().toISOString().slice(0, 7) });
  assert.strictEqual(rent.status, 404, JSON.stringify(rent.body));
});

test('owner B sees the request with the first name only (no phone, email or account id)', async () => {
  const list = await H.api('GET', '/api/pg-owner/bookings', ownerB.token);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.bookings.length, 1);
  const b = list.body.bookings[0];
  assert.strictEqual(b.student.firstName, H.r('utils/pgContent').firstNameOf(student.name));
  assert.ok(!b.student.firstName.includes(' '), 'first name only');
  const raw = JSON.stringify(list.body);
  assert.ok(!raw.includes(student.phone), 'student phone must never reach the owner');
  assert.ok(!raw.includes(student.id), 'student account id must never reach the owner');
  assert.ok(!('userId' in b));
});

test('token classes never mix', async () => {
  // Customer and admin tokens on the owner app routes.
  for (const t of [student.token, admin.token]) {
    const r = await H.api('GET', '/api/pg-owner/home', t);
    assert.strictEqual(r.status, 401, JSON.stringify(r.body));
  }
  // An owner token is not a customer session (protect refuses role pg_owner).
  const mine = await H.api('GET', '/api/pg/bookings/mine', ownerA.token);
  assert.strictEqual(mine.status, 401, JSON.stringify(mine.body));
  const adminRoute = await H.api('GET', '/api/admin/pg-owners', ownerA.token);
  assert.strictEqual(adminRoute.status, 401);
  // No token at all.
  assert.strictEqual((await H.api('GET', '/api/pg-owner/home')).status, 401);
});

test('admin cannot link one listing to two owners', async () => {
  const r = await H.api('POST', `/api/admin/pg-owners/${ownerA.id}/listings`, admin.token, { hostelIds: [pgB.id] });
  assert.strictEqual(r.status, 409, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'LISTING_TAKEN');
});

test('unlinking a listing removes the owner\'s access at once', async () => {
  const pgC = await H.mkPg(admin);
  const link = await H.api('POST', `/api/admin/pg-owners/${ownerA.id}/listings`, admin.token, { hostelIds: [pgC.id] });
  assert.strictEqual(link.status, 200, JSON.stringify(link.body));
  assert.strictEqual((await H.api('GET', `/api/pg-owner/listings/${pgC.id}`, ownerA.token)).status, 200);
  const un = await H.api('DELETE', `/api/admin/pg-owners/${ownerA.id}/listings/${pgC.id}`, admin.token);
  assert.strictEqual(un.status, 200, JSON.stringify(un.body));
  assert.strictEqual((await H.api('GET', `/api/pg-owner/listings/${pgC.id}`, ownerA.token)).status, 404);
  assert.ok((await H.auditRows('PG_OWNER_LISTINGS_LINKED')).length >= 1);
  assert.ok((await H.auditRows('PG_OWNER_LISTING_UNLINKED')).length >= 1);
});
