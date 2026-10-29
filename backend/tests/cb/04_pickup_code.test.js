// Pickup code: 4 characters from an unambiguous alphabet (letters + digits), unique among a stall's open
// bookings, shown to the student once accepted, checked by the stall to hand over; wrong codes lock it.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const V = '/api/campus-booking/vendor';
const U = T.r('modules/campusBooking/services/util');

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

test('format: 4 chars, no 0 / O / 1 / I / L, always letters and digits', () => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const c = U.pickupCode();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
    assert.ok(/[A-Z]/.test(c) && /[0-9]/.test(c), c);
    seen.add(c);
  }
  assert.ok(seen.size > 2500, 'codes are random');
  assert.strictEqual(U.normalizePickupCode(' a3f-7 '), 'A3F7');
});

const readyBooking = async (s, u) => {
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: `PCK${Date.now()}${Math.floor(Math.random() * 1000)}`, imageUrl: await T.uploadProof(u) });
  await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  await T.cb('POST', `${V}/bookings/${id}/ready`, s.store.token, {});
  return id;
};

test('wrong code refused with tries left; lower case and spaces accepted; collected once', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = await readyBooking(s, u);
  const code = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token)).body.booking.pickupCode;
  const wrong = code === 'A3F7' ? 'B4G8' : 'A3F7';
  const w = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: wrong });
  assert.strictEqual(w.status, 400);
  assert.strictEqual(w.body.code, 'WRONG_CODE');
  assert.strictEqual(w.body.triesLeft, 5);
  assert.strictEqual((await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: 'AB' })).body.code, 'CODE_REQUIRED');
  const ok = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: ` ${code.slice(0, 2).toLowerCase()} ${code.slice(2)} ` });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.booking.status, 'COLLECTED');
  const again = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  assert.strictEqual(again.status, 409);
});

test('six wrong codes lock checking for 15 minutes (even the right code)', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = await readyBooking(s, u);
  const code = (await T.ctx.M('CampusBooking').findByPk(id)).pickupCode;
  const wrong = code === 'A3F7' ? 'B4G8' : 'A3F7';
  let last;
  for (let i = 0; i < 6; i++) last = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: wrong });
  assert.strictEqual(last.body.triesLeft, 0);
  const locked = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  assert.strictEqual(locked.status, 429);
  assert.strictEqual(locked.body.code, 'CODE_LOCKED');
  assert.strictEqual((await T.cb('GET', `${V}/bookings/${id}`, s.store.token)).body.booking.pickupLocked, true);
  // After the lock passes, the right code works.
  await T.ctx.M('CampusBooking').update({ pickupCodeLockedUntil: new Date(Date.now() - 1000) }, { where: { id } });
  const ok = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  assert.strictEqual(ok.body.booking.status, 'COLLECTED');
});

test('codes are unique among one stall\'s open bookings', async () => {
  const s = await T.mkStall();
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const u = await T.mkUser();
    const r = await T.book(u, s);
    assert.strictEqual(r.status, 201);
    codes.push((await T.ctx.M('CampusBooking').findByPk(r.body.booking.id)).pickupCode);
  }
  assert.strictEqual(new Set(codes).size, codes.length);
});
