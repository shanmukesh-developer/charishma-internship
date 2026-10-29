// Payment proof: a screenshot (own private upload, purpose campus_payment, max 5 MB) AND a UPI reference (owner,
// 29 Oct: the stall checks both). A reference / screenshot cannot be reused for another booking. The stall gets a
// signed link.
// Also: stall + admin settings (UPI ID format, the switch needs a UPI ID).
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const V = '/api/campus-booking/vendor';

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

test('no proof at all: 400 PROOF_REQUIRED; bad ref format: 400', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  for (const body of [{}, { upiRef: '' }, { imageUrl: '', upiRef: '   ' }]) {
    const r = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, body);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'PROOF_REQUIRED');
  }
  const bad = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: '12-3' });
  assert.strictEqual(bad.body.code, 'INVALID_REF');
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'PAYMENT_PENDING');
});

test('screenshot without the reference, or the reference without the screenshot: refused', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  const onlyShot = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: await T.uploadProof(u) });
  assert.deepStrictEqual([onlyShot.status, onlyShot.body.code, onlyShot.body.field], [400, 'PROOF_REQUIRED', 'ref']);
  const onlyRef = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: '412345678901' });
  assert.deepStrictEqual([onlyRef.status, onlyRef.body.code, onlyRef.body.field], [400, 'PROOF_REQUIRED', 'shot']);
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'PAYMENT_PENDING');
});

test('screenshot is stored private; the stall sees a signed link, lists carry none', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  const url = await T.uploadProof(u);
  assert.match(url, /^\/api\/campus\/media\/[0-9a-f-]{36}$/);
  const media = await T.ctx.M('CampusMedia').findByPk(url.split('/').pop());
  assert.strictEqual(media.isPrivate, true);
  assert.strictEqual(media.purpose, 'campus_payment');
  const r = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: url, upiRef: 'PRV111222333' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.proof.hasImage, true);
  assert.strictEqual(r.body.booking.proof.ref, 'PRV111222333');
  const v = (await T.cb('GET', `${V}/bookings/${id}`, s.store.token)).body.booking;
  assert.match(v.proof.imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}\?exp=\d+&sig=/);
  const list = (await T.cb('GET', `${V}/bookings?tab=pending`, s.store.token)).body.bookings;
  assert.strictEqual(list.find((b) => b.id === id).proof.imageUrl, null);
  assert.strictEqual(list.find((b) => b.id === id).proof.hasImage, true);
  // The signed link really serves the image; the bare URL does not (private).
  const base = v.proof.imageUrl.replace(/^https?:\/\/[^/]+/, '');
  const okRes = await T.cb('GET', base);
  assert.strictEqual(okRes.status, 200);
  assert.strictEqual((await T.cb('GET', url)).status, 404);
});

test('both screenshot and reference: accepted', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  const r = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: await T.uploadProof(u), upiRef: '5123 4567 8901' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.booking.proof.ref, '512345678901');
  assert.strictEqual(r.body.booking.proof.hasImage, true);
});

test("someone else's upload, a public upload or an outside URL is refused", async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const other = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  const theirs = await T.uploadProof(other);
  const r1 = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: theirs });
  assert.strictEqual(r1.status, 400);
  assert.strictEqual(r1.body.code, 'INVALID_MEDIA');
  const publicOne = await T.uploadProof(u, { purpose: 'post' });
  assert.strictEqual((await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: publicOne })).body.code, 'INVALID_MEDIA');
  assert.strictEqual((await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { imageUrl: 'https://example.com/pay.png' })).body.code, 'INVALID_MEDIA');
});

test('a UPI reference or screenshot already used on another booking is refused', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const a = (await T.book(u, s)).body.booking.id;
  const b = (await T.book(u, s)).body.booking.id;
  const shot = await T.uploadProof(u);
  await T.cb('POST', `/api/campus-booking/bookings/${a}/proof`, u.token, { upiRef: 'DUP111222333', imageUrl: shot });
  const dupRef = await T.cb('POST', `/api/campus-booking/bookings/${b}/proof`, u.token, { upiRef: 'dup111222333', imageUrl: await T.uploadProof(u) });
  assert.strictEqual(dupRef.status, 409);
  assert.strictEqual(dupRef.body.code, 'REF_ALREADY_USED');
  const dupShot = await T.cb('POST', `/api/campus-booking/bookings/${b}/proof`, u.token, { imageUrl: shot, upiRef: 'NEW111222333' });
  assert.strictEqual(dupShot.body.code, 'SCREENSHOT_ALREADY_USED');
});

test('at most 5 proof submissions per booking', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  for (let i = 0; i < 5; i++) {
    const p = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: `LIM11122233${i}`, imageUrl: await T.uploadProof(u) });
    assert.strictEqual(p.status, 200, JSON.stringify(p.body));
    await T.cb('POST', `${V}/bookings/${id}/reject-payment`, s.store.token, { code: 'NOT_RECEIVED' });
  }
  const sixth = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'LIM111222339', imageUrl: await T.uploadProof(u) });
  assert.strictEqual(sixth.status, 409);
  assert.strictEqual(sixth.body.code, 'PROOF_LIMIT');
  const seen = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token)).body.booking;
  assert.strictEqual(seen.canSubmitProof, false);
  assert.strictEqual(seen.canCancel, true);
});

test('stall settings: UPI format, prep 2-90, QR upload; the on / off switch is admin only', async () => {
  const s = await T.mkStall({ enabled: false, upi: null });
  const bad = await T.cb('PUT', `${V}/settings`, s.store.token, { upiId: 'not-a-upi' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.code, 'INVALID_UPI');
  assert.strictEqual((await T.cb('PUT', `${V}/settings`, s.store.token, { prepMinutes: 200 })).body.code, 'INVALID_PREP');
  const ok = await T.cb('PUT', `${V}/settings`, s.store.token, { upiId: ' MyStall@OKAXIS ', upiName: 'My Stall', prepMinutes: 8, qrUrl: T.PNG_1PX, enabled: true });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.settings.upiId, 'mystall@okaxis');
  assert.strictEqual(ok.body.settings.prepMinutes, 8);
  assert.match(ok.body.settings.qrUrl, /\/api\/campus\/media\//);
  assert.strictEqual(ok.body.settings.enabled, false, 'the stall cannot switch itself on');

  const admin = await T.mkUser({ role: 'admin' });
  const noUpi = await T.mkStall({ enabled: false, upi: null });
  const refused = await T.cb('PUT', `/api/admin/campus-booking/stores/${noUpi.store.id}`, admin.token, { enabled: true });
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.body.code, 'UPI_REQUIRED');
  const on = await T.cb('PUT', `/api/admin/campus-booking/stores/${s.store.id}`, admin.token, { enabled: true });
  assert.strictEqual(on.status, 200);
  assert.strictEqual(on.body.store.takingBookings, true);
  // While on, the UPI ID cannot be removed (by the stall or the admin).
  assert.strictEqual((await T.cb('PUT', `${V}/settings`, s.store.token, { upiId: '' })).body.code, 'UPI_REQUIRED');
  assert.strictEqual((await T.cb('PUT', `/api/admin/campus-booking/stores/${s.store.id}`, admin.token, { upiId: null })).body.code, 'UPI_REQUIRED');
  const notStall = await T.mkStall({ enabled: false, store: { vendorType: 'GROCERY' } });
  assert.strictEqual((await T.cb('PUT', `/api/admin/campus-booking/stores/${notStall.store.id}`, admin.token, { enabled: true })).body.code, 'NOT_A_STALL');
  const log = await T.ctx.M('VerificationLog').findOne({ where: { targetId: String(s.store.id), action: 'CAMPUS_BOOKING_STORE_UPDATE' } });
  assert.ok(log, 'admin change audited');
  // The booking snapshots the stall payee at booking time.
  const u = await T.mkUser();
  const b = (await T.book(u, s)).body.booking;
  assert.strictEqual(b.payee.upiId, 'mystall@okaxis');
  assert.strictEqual(b.payee.name, 'My Stall');
  assert.match(b.payee.qrUrl, /\/api\/campus\/media\//);
});
