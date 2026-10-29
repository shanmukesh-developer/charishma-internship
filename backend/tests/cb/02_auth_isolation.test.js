// Auth isolation: a student sees and changes only their own bookings; a stall only its own stall's bookings;
// account types cannot use each other's routes; admin routes are admin-only; the stall never gets the pickup code.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const V = '/api/campus-booking/vendor';
let s1; let s2; let alice; let bob; let id;

test.before(async () => {
  await T.setup();
  s1 = await T.mkStall();
  s2 = await T.mkStall();
  alice = await T.mkUser();
  bob = await T.mkUser();
  id = (await T.book(alice, s1)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, alice.token, { upiRef: 'ISO111222333', imageUrl: await T.uploadProof(alice) });
});
test.after(async () => { await T.teardown(); });

test('another student cannot read, pay or cancel the booking (404, nothing changes)', async () => {
  assert.strictEqual((await T.cb('GET', `/api/campus-booking/bookings/${id}`, bob.token)).status, 404);
  assert.strictEqual((await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, bob.token, { upiRef: 'BOB111222333', imageUrl: await T.uploadProof(bob) })).status, 404);
  assert.strictEqual((await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, bob.token, {})).status, 404);
  const list = await T.cb('GET', '/api/campus-booking/bookings', bob.token);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.bookings.length, 0);
  const home = await T.cb('GET', '/api/campus-booking/home', bob.token);
  assert.strictEqual(home.body.active.length, 0);
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'PAYMENT_REVIEW');
});

test('another stall cannot see or act on it; its lists stay empty', async () => {
  for (const [m, u, b] of [
    ['GET', `${V}/bookings/${id}`],
    ['POST', `${V}/bookings/${id}/confirm-payment`, {}],
    ['POST', `${V}/bookings/${id}/reject-payment`, { code: 'NOT_RECEIVED' }],
    ['POST', `${V}/bookings/${id}/cancel`, { code: 'CLOSING' }],
  ]) {
    const r = await T.cb(m, u, s2.store.token, b);
    assert.strictEqual(r.status, 404, `${m} ${u}`);
  }
  for (const tab of ['pending', 'accepted', 'history']) {
    const r = await T.cb('GET', `${V}/bookings?tab=${tab}`, s2.store.token);
    assert.strictEqual(r.body.bookings.length, 0, tab);
  }
  const own = await T.cb('GET', `${V}/bookings?tab=pending`, s1.store.token);
  assert.strictEqual(own.body.bookings.length, 1);
  assert.strictEqual(own.body.counts.pending, 1);
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'PAYMENT_REVIEW');
});

test('account types: stall token on student routes, student token on stall routes, non-admins on admin routes', async () => {
  assert.strictEqual((await T.cb('GET', '/api/campus-booking/home', s1.store.token)).status, 403);
  assert.strictEqual((await T.book({ token: s1.store.token }, s1)).status, 403);
  assert.strictEqual((await T.cb('GET', `${V}/summary`, alice.token)).status, 403);
  assert.strictEqual((await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, alice.token, {})).status, 403);
  assert.strictEqual((await T.cb('GET', '/api/admin/campus-booking/bookings', alice.token)).status, 403);
  assert.strictEqual((await T.cb('GET', '/api/admin/campus-booking/bookings', s1.store.token)).status, 403);
  assert.strictEqual((await T.cb('PUT', `/api/admin/campus-booking/stores/${s1.store.id}`, s1.store.token, { enabled: false })).status, 403);
  assert.strictEqual((await T.cb('GET', '/api/campus-booking/home')).status, 401);
  const admin = await T.mkUser({ role: 'admin' });
  const a = await T.cb('GET', '/api/admin/campus-booking/bookings', admin.token);
  assert.strictEqual(a.status, 200);
  assert.ok(a.body.bookings.some((b) => b.id === id));
});

test('the stall and the admin never receive the pickup code; the student only after acceptance', async () => {
  const before = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, alice.token)).body.booking;
  assert.strictEqual(before.pickupCode, null);
  const c = await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s1.store.token, {});
  const row = await T.ctx.M('CampusBooking').findByPk(id);
  const bodies = [
    c.body,
    (await T.cb('GET', `${V}/bookings/${id}`, s1.store.token)).body,
    (await T.cb('GET', `${V}/bookings?tab=accepted`, s1.store.token)).body,
    (await T.cb('GET', `${V}/earnings?range=all`, s1.store.token)).body,
    (await T.cb('GET', `/api/admin/campus-booking/bookings/${id}`, (await T.mkUser({ role: 'admin' })).token)).body,
  ];
  for (const b of bodies) {
    const text = JSON.stringify(b);
    assert.ok(!text.includes('"pickupCode"'), 'no pickupCode key');
    assert.ok(!text.includes(`"${row.pickupCode}"`), 'the code value never appears');
  }
  const after = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, alice.token)).body.booking;
  assert.strictEqual(after.pickupCode, row.pickupCode);
  // The stall sees the student's first name only, never the phone.
  const vb = bodies[1].booking;
  assert.deepStrictEqual(Object.keys(vb.customer), ['firstName']);
  assert.ok(!JSON.stringify(vb).includes(alice.phone));
});

test('public store reads never carry the stall UPI ID / QR (private fields)', async () => {
  const { STORE_PRIVATE_FIELDS, stripStoreSecrets } = T.r('utils/publicFields');
  for (const f of ['campusUpiId', 'campusUpiName', 'campusUpiQrUrl']) assert.ok(STORE_PRIVATE_FIELDS.includes(f), f);
  const json = stripStoreSecrets(s1.store.toJSON());
  assert.strictEqual(json.campusUpiId, undefined);
  // Stall cards (signed-in students) carry no UPI either; only the student's own booking does.
  const list = await T.cb('GET', '/api/campus-booking/stalls', bob.token);
  assert.ok(list.body.stalls.length >= 2);
  assert.ok(!JSON.stringify(list.body).includes('@okaxis'));
  const detail = await T.cb('GET', `/api/campus-booking/stalls/${s1.store.id}`, bob.token);
  assert.ok(!JSON.stringify(detail.body).includes('@okaxis'));
});

test('rate limit: at most 12 new bookings an hour per student (429 after)', async () => {
  T.r('modules/campusBooking/services/util').resetLimits();
  const s = await T.mkStall();
  const u = await T.mkUser();
  for (let i = 0; i < 12; i++) {
    const b = await T.book(u, s);
    assert.strictEqual(b.status, 201, `booking ${i + 1}`);
    await T.cb('POST', `/api/campus-booking/bookings/${b.body.booking.id}/cancel`, u.token, {});
  }
  const over = await T.book(u, s);
  assert.strictEqual(over.status, 429);
  assert.strictEqual(over.body.code, 'RATE_LIMITED');
  assert.ok(over.body.retryAfter > 0);
});
