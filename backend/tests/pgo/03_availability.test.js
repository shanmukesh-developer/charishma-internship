// The owner's free-bed counts are what the customer app shows: room type "Available N / Full" pills
// (GET /api/pg/:id roomTypes[].availableBeds), bedsAvailable, the list cards, and the owner's own
// total / occupied / vacant tiles.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let pg; let r1; let r2; let r3; let owner;

test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  pg = await H.mkPg(admin);
  // Two rooms of one type (2-sharing AC) and one of another (3-sharing).
  r1 = await H.mkRoom(admin, pg.id, { totalBeds: 2, availableBeds: 2 });
  r2 = await H.mkRoom(admin, pg.id, { totalBeds: 2, availableBeds: 2 });
  r3 = await H.mkRoom(admin, pg.id, { totalBeds: 3, availableBeds: 3, sharingType: 3, hasAC: false, pricePerBed: 6000 });
  owner = await H.readyOwner(admin, [pg.id]);
});
test.after(H.teardown);

const typeOf = (detail, roomId) => detail.roomTypes.find((t) => t.roomIds.includes(roomId));

test('availability updates flow to the customer detail and list', async () => {
  const before = await H.api('GET', `/api/pg/${pg.id}`);
  assert.strictEqual(typeOf(before.body, r1.id).availableBeds, 4);
  assert.strictEqual(before.body.bedsAvailable, 7);

  const save = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/availability`, owner.token, {
    rooms: [{ id: r1.id, availableBeds: 0 }, { id: r2.id, availableBeds: 1 }, { id: r3.id, availableBeds: 0 }],
  });
  assert.strictEqual(save.status, 200, JSON.stringify(save.body));
  assert.strictEqual(save.body.changed, 3);
  assert.deepStrictEqual(save.body.listing.beds, { rooms: 3, total: 7, vacant: 1, occupied: 6 });

  const after = await H.api('GET', `/api/pg/${pg.id}`);
  assert.strictEqual(typeOf(after.body, r1.id).availableBeds, 1, '2-sharing type: 0 + 1 free');
  assert.strictEqual(typeOf(after.body, r1.id).bookRoomId, r2.id, 'the room with a free bed is the one booked');
  assert.strictEqual(typeOf(after.body, r3.id).availableBeds, 0, '3-sharing type shows Full');
  assert.strictEqual(after.body.bedsAvailable, 1);

  const list = await H.api('GET', '/api/pg');
  assert.strictEqual(list.body.find((x) => x.id === pg.id).bedsAvailable, 1);

  const home = await H.api('GET', '/api/pg-owner/home', owner.token);
  assert.deepStrictEqual(home.body.totals, { rooms: 3, total: 7, vacant: 1, occupied: 6 });
  assert.deepStrictEqual(home.body.listings[0].beds, { rooms: 3, total: 7, vacant: 1, occupied: 6 });
  const audit = await H.auditRows('PG_OWNER_AVAILABILITY_UPDATED');
  assert.strictEqual(audit.length, 1);
  assert.strictEqual(audit[0].adminId, `pg_owner:${owner.id}`);
});

test('a full room type cannot be booked by students', async () => {
  const student = await H.mkUser();
  const r = await H.book(student, r3.id);
  assert.strictEqual(r.status, 400, JSON.stringify(r.body));
});

test('free beds outside 0..total, unknown rooms and other PGs\' rooms are refused', async () => {
  const other = await H.mkPg(admin);
  const foreign = await H.mkRoom(admin, other.id);
  const cases = [
    { rooms: [{ id: r1.id, availableBeds: 3 }] },
    { rooms: [{ id: r1.id, availableBeds: -1 }] },
    { rooms: [{ id: r1.id, availableBeds: 1.5 }] },
    { rooms: [{ id: foreign.id, availableBeds: 0 }] },
    { rooms: [{ id: r1.id, availableBeds: 1 }, { id: r1.id, availableBeds: 2 }] },
    { rooms: [] },
  ];
  for (const body of cases) {
    const r = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/availability`, owner.token, body);
    assert.ok(r.status === 400 || r.status === 404, `${JSON.stringify(body)} -> ${r.status}`);
  }
  assert.strictEqual((await H.ctx.M('PGRoom').findByPk(r1.id)).availableBeds, 0, 'nothing written by refused saves');
  assert.strictEqual((await H.ctx.M('PGRoom').findByPk(foreign.id)).availableBeds, 2);
});

test('owner detail groups rooms into the same room types students see', async () => {
  const d = await H.api('GET', `/api/pg-owner/listings/${pg.id}`, owner.token);
  assert.strictEqual(d.status, 200, JSON.stringify(d.body));
  assert.strictEqual(d.body.listing.rooms.length, 3);
  assert.strictEqual(d.body.listing.roomTypes.length, 2);
  const two = d.body.listing.roomTypes.find((t) => t.sharingType === 2);
  assert.strictEqual(two.totalBeds, 4);
  assert.strictEqual(two.availableBeds, 1);
  assert.strictEqual(two.roomCount, 2);
});
