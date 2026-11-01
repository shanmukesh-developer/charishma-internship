// scripts/demo_pgs_remove_v1.js (owner, 1 Nov 2026: "remove all test data, only keep the entered data"): the PG
// listings an old seed invented go (rooms and promotions with them); one a student booked is hidden instead, its
// booking kept; a PG the owner entered is never touched; it runs once.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let ctx;
before(async () => {
  ctx = await H.setup();
  const s = ctx.sequelize;
  H.r('models/PGHostel').initPGHostelModel(s);
  H.r('models/PGRoom').initPGRoomModel(s);
  H.r('models/PGBooking').initPGBookingModel(s);
  H.r('models/PGReview').initPGReviewModel(s);
  H.r('models/PgPromotion').initPgPromotionModel(s);
  H.r('modules/pgOwner').initPgOwnerModels(s);
  await s.sync();
});
after(() => H.teardown());

test('the seeded demo PGs go (or hide when booked); the owner PG stays; once', async () => {
  const { runDemoPgRemoval } = H.r('scripts/demo_pgs_remove_v1');
  const M = (n) => ctx.sequelize.models[n];
  const admin = await H.mkUser({ role: 'admin' });
  const student = await H.mkUser();
  const mk = (name) => M('PGHostel').create({ ownerId: admin.id, name, address: 'Near SRM AP', distanceFromCollege: 1, baseRent: 7000, isActive: true });
  const demo = await mk('Zenvy Premium Boys Hostel');
  const demoRoom = await M('PGRoom').create({ hostelId: demo.id, roomNumber: 'PV-201', sharingType: 2, pricePerBed: 7500, totalBeds: 2, availableBeds: 1 });
  const now = new Date();
  await M('PgPromotion').create({ type: 'IMAGE', headline: 'Demo promo', hostelId: demo.id, startsAt: now, endsAt: new Date(now.getTime() + 86400000), mediaUrl: 'https://example.com/x.jpg' });
  assert.strictEqual(await M('PgPromotion').count({ where: { hostelId: demo.id } }), 1);
  const booked = await mk('Royal Heritage Boys Hostel');
  const bookedRoom = await M('PGRoom').create({ hostelId: booked.id, roomNumber: 'R1', sharingType: 2, pricePerBed: 6000, totalBeds: 2, availableBeds: 2 });
  await M('PGBooking').create({ userId: student.id, hostelId: booked.id, roomId: bookedRoom.id, checkInDate: '2026-11-10' });
  const real = await mk('Sai Ram Boys PG');

  const r = await runDemoPgRemoval();
  assert.deepStrictEqual([r.found, r.deleted, r.hidden, r.errors], [2, 1, 1, []], JSON.stringify(r));
  assert.strictEqual(await M('PGHostel').findByPk(demo.id), null, 'demo PG deleted');
  assert.strictEqual(await M('PGRoom').findByPk(demoRoom.id), null, 'its rooms too');
  assert.strictEqual(await M('PgPromotion').count({ where: { hostelId: demo.id } }), 0, 'and its promotions');
  assert.strictEqual((await M('PGHostel').findByPk(booked.id)).isActive, false, 'a booked demo PG is hidden');
  assert.strictEqual(await M('PGBooking').count({ where: { hostelId: booked.id } }), 1, 'the booking is kept');
  assert.strictEqual((await M('PGHostel').findByPk(real.id)).isActive, true, "the owner's PG is untouched");
  assert.deepStrictEqual(await runDemoPgRemoval(), { skipped: 'already done' });
});
