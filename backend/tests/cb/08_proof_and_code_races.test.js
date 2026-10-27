// Money / hand-off races between the student app and the ZCS Campus Stall app (27 Oct 2026 transaction audit):
//  - one UPI payment proof (reference or screenshot) sent for two bookings at the same moment: only one booking
//    takes it (the "already used" check could not see the other in-flight write; unique indexes now refuse it);
//  - wrong pickup codes sent in parallel are each counted (they used to share one count, so the pause never came);
//  - the stall's "today" summary and its earnings screen count money by the same day (payment confirmed).
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const V = '/api/campus-booking/vendor';

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

const ref = () => `RC${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 18);

test('the same UPI reference sent for two bookings at once: one PAYMENT_REVIEW, the other 409 REF_ALREADY_USED', async () => {
  const s = await T.mkStall({ prices: [30] });
  const u = await T.mkUser();
  for (let round = 0; round < 3; round++) {
    const b1 = (await T.book(u, s)).body.booking.id;
    const b2 = (await T.book(u, s)).body.booking.id;
    const r = ref();
    const out = await Promise.all([b1, b2].map((id) => T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: r })));
    assert.deepStrictEqual(out.map((x) => x.status).sort(), [200, 409], JSON.stringify(out.map((x) => x.body)));
    assert.strictEqual(out.find((x) => x.status === 409).body.code, 'REF_ALREADY_USED');
    const rows = await T.ctx.M('CampusBooking').findAll({ where: { id: [b1, b2] }, raw: true });
    assert.deepStrictEqual(rows.map((x) => x.status).sort(), ['PAYMENT_PENDING', 'PAYMENT_REVIEW']);
    assert.strictEqual(rows.filter((x) => x.proofRef === r.toUpperCase() || x.proofRef === r).length, 1);
    // The refused booking used no proof attempt and can still be paid with its own reference.
    const loser = rows.find((x) => x.status === 'PAYMENT_PENDING');
    assert.strictEqual(Number(loser.proofAttempts) || 0, 0);
    assert.strictEqual((await T.cb('POST', `/api/campus-booking/bookings/${loser.id}/proof`, u.token, { upiRef: ref() })).status, 200);
    for (const id of [b1, b2]) await T.cb('POST', `${V}/bookings/${id}/reject-payment`, s.store.token, { code: 'NOT_RECEIVED' });
    for (const id of [b1, b2]) await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, u.token, {});
  }
});

test('the same screenshot sent for two bookings at once: one PAYMENT_REVIEW, the other 409 SCREENSHOT_ALREADY_USED', async () => {
  const s = await T.mkStall({ prices: [30] });
  const u = await T.mkUser();
  const b1 = (await T.book(u, s)).body.booking.id;
  const b2 = (await T.book(u, s)).body.booking.id;
  const img = await T.uploadProof(u);
  const out = await Promise.all([b1, b2].map((id) => T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: img })));
  assert.deepStrictEqual(out.map((x) => x.status).sort(), [200, 409], JSON.stringify(out.map((x) => x.body)));
  assert.strictEqual(out.find((x) => x.status === 409).body.code, 'SCREENSHOT_ALREADY_USED');
});

test('a re-send after a rejection may keep its own reference (no clash with itself)', async () => {
  const s = await T.mkStall({ prices: [30] });
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  const r = ref();
  assert.strictEqual((await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: r })).status, 200);
  assert.strictEqual((await T.cb('POST', `${V}/bookings/${id}/reject-payment`, s.store.token, { code: 'UNCLEAR' })).status, 200);
  const again = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: r });
  assert.strictEqual(again.status, 200, JSON.stringify(again.body));
  assert.strictEqual(again.body.booking.status, 'PAYMENT_REVIEW');
});

test('8 wrong pickup codes in parallel: every one counts, checking pauses (429 CODE_LOCKED), the right code then waits', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: ref() });
  await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  await T.cb('POST', `${V}/bookings/${id}/ready`, s.store.token, {});
  const code = (await T.ctx.M('CampusBooking').findByPk(id)).pickupCode;
  const wrong = code === 'A3F7' ? 'B4G8' : 'A3F7';
  const out = await Promise.all(Array.from({ length: 8 }, () => T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: wrong })));
  const statuses = out.map((x) => x.status);
  assert.strictEqual(statuses.filter((x) => x === 400).length, 6, `exactly 6 attempts are checked: ${statuses}`);
  assert.strictEqual(statuses.filter((x) => x === 429).length, 2, `${statuses}`);
  const row = await T.ctx.M('CampusBooking').findByPk(id);
  assert.ok(row.pickupCodeLockedUntil && new Date(row.pickupCodeLockedUntil) > new Date(), 'paused for 15 minutes');
  const right = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  assert.strictEqual(right.status, 429, 'even the right code waits out the pause');
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'READY');
});

test('stall summary "today" counts money by the payment-confirmed day, like the earnings screen', async () => {
  const s = await T.mkStall({ prices: [50] });
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: ref() });
  assert.strictEqual((await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {})).status, 200);
  // Placed yesterday (IST), confirmed today.
  await T.ctx.sequelize.query('UPDATE "CampusBookings" SET "createdAt" = :t WHERE id = :id', {
    replacements: { t: new Date(Date.now() - 36 * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', ' +00:00'), id },
  });
  const earn = await T.cb('GET', `${V}/earnings?range=today`, s.store.token);
  const sum = await T.cb('GET', `${V}/summary`, s.store.token);
  assert.strictEqual(earn.status, 200);
  assert.strictEqual(sum.status, 200);
  assert.strictEqual(earn.body.total, 100);
  assert.strictEqual(sum.body.today.earnings, earn.body.total, JSON.stringify({ earn: earn.body.total, sum: sum.body.today }));
  assert.strictEqual(sum.body.today.commission, earn.body.commission);
  assert.strictEqual(sum.body.today.paidOrders, earn.body.orders);
});
