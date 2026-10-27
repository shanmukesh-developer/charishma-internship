// Status machine: PAYMENT_PENDING -> PAYMENT_REVIEW -> ACCEPTED -> PREPARING -> READY -> COLLECTED, plus
// REJECTED (student re-sends proof or cancels) and CANCELLED; refused transitions; concurrent taps; expiry job.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const E = T.r('modules/campusBooking/enums');
const V = '/api/campus-booking/vendor';

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

test('transition table: only the listed actor may make each move', () => {
  assert.ok(E.canTransition('PAYMENT_PENDING', 'PAYMENT_REVIEW', 'student'));
  assert.ok(!E.canTransition('PAYMENT_PENDING', 'PAYMENT_REVIEW', 'vendor'));
  assert.ok(E.canTransition('PAYMENT_REVIEW', 'ACCEPTED', 'vendor'));
  assert.ok(!E.canTransition('PAYMENT_REVIEW', 'ACCEPTED', 'student'));
  assert.ok(E.canTransition('PAYMENT_REVIEW', 'REJECTED', 'vendor'));
  assert.ok(E.canTransition('REJECTED', 'PAYMENT_REVIEW', 'student'));
  assert.ok(E.canTransition('ACCEPTED', 'PREPARING', 'vendor'));
  assert.ok(E.canTransition('ACCEPTED', 'READY', 'vendor'));
  assert.ok(E.canTransition('PREPARING', 'READY', 'vendor'));
  assert.ok(E.canTransition('READY', 'COLLECTED', 'vendor'));
  assert.ok(!E.canTransition('PREPARING', 'COLLECTED', 'vendor'));
  assert.ok(!E.canTransition('ACCEPTED', 'CANCELLED', 'student'));
  assert.ok(!E.canTransition('PAYMENT_REVIEW', 'CANCELLED', 'student'));
  assert.ok(E.canTransition('PAYMENT_PENDING', 'CANCELLED', 'system'));
  assert.ok(E.canTransition('REJECTED', 'CANCELLED', 'system'));
  assert.ok(!E.canTransition('ACCEPTED', 'CANCELLED', 'system'));
  for (const to of Object.keys(E.STATUS)) {
    for (const actor of ['student', 'vendor', 'system']) {
      assert.ok(!E.canTransition('COLLECTED', to, actor));
      assert.ok(!E.canTransition('CANCELLED', to, actor));
    }
  }
});

test('happy path: book, pay proof, confirm, preparing, ready, collect (timestamps + estimate)', async () => {
  const s = await T.mkStall({ prices: [20] });
  const u = await T.mkUser();
  const b = await T.book(u, s, [{ menuItemId: s.items[0].id, quantity: 2 }]);
  assert.strictEqual(b.status, 201, JSON.stringify(b.body));
  const id = b.body.booking.id;
  assert.strictEqual(b.body.booking.status, 'PAYMENT_PENDING');
  assert.match(b.body.booking.ref, /^CB[A-Z2-9]{4}$/);
  assert.strictEqual(b.body.booking.payee.upiId, 'chaiadda@okaxis');
  assert.match(b.body.booking.payee.upiLink, /^upi:\/\/pay\?pa=chaiadda%40okaxis&pn=.+&am=40\.00&cu=INR&tn=/);
  assert.ok(b.body.booking.paymentDeadline);

  const p = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: '412345678901' });
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  assert.strictEqual(p.body.booking.status, 'PAYMENT_REVIEW');

  const c = await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  assert.strictEqual(c.body.booking.status, 'ACCEPTED');
  assert.ok(c.body.booking.paymentVerifiedAt && c.body.booking.acceptedAt);
  const est = new Date(c.body.booking.estimatedReadyAt) - new Date(c.body.booking.acceptedAt);
  assert.strictEqual(Math.round(est / 60000), 10, 'default prep estimate 10 min');

  const pr = await T.cb('POST', `${V}/bookings/${id}/preparing`, s.store.token, {});
  assert.strictEqual(pr.body.booking.status, 'PREPARING');
  const rd = await T.cb('POST', `${V}/bookings/${id}/ready`, s.store.token, {});
  assert.strictEqual(rd.body.booking.status, 'READY');

  const mine = await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token);
  const code = mine.body.booking.pickupCode;
  assert.match(code, /^[A-Z2-9]{4}$/);
  const col = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  assert.strictEqual(col.status, 200, JSON.stringify(col.body));
  assert.strictEqual(col.body.booking.status, 'COLLECTED');
  const done = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token)).body.booking;
  assert.deepStrictEqual(done.timeline.map((x) => x.done), [true, true, true, true, true]);
});

test('ACCEPTED -> READY directly stamps preparingAt; stall prep setting drives the estimate', async () => {
  const s = await T.mkStall({ store: { campusPrepMinutes: 25 } });
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'T2026102700001' });
  const c = (await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {})).body.booking;
  assert.strictEqual(c.prepMinutes, 25);
  assert.strictEqual(Math.round((new Date(c.estimatedReadyAt) - new Date(c.acceptedAt)) / 60000), 25);
  const r = await T.cb('POST', `${V}/bookings/${id}/ready`, s.store.token, {});
  assert.strictEqual(r.body.booking.status, 'READY');
  assert.ok(r.body.booking.timeline.find((x) => x.key === 'PREPARING').at);
});

test('rejected payment: student re-sends proof (or cancels); reason shown', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'AAA111222333' });
  const rj = await T.cb('POST', `${V}/bookings/${id}/reject-payment`, s.store.token, { code: 'AMOUNT_MISMATCH' });
  assert.strictEqual(rj.body.booking.status, 'REJECTED');
  const seen = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token)).body.booking;
  assert.strictEqual(seen.rejection.code, 'AMOUNT_MISMATCH');
  assert.match(seen.rejection.reason, /amount/i);
  assert.strictEqual(seen.canSubmitProof, true);
  assert.strictEqual(seen.canCancel, true);
  assert.strictEqual(seen.pickupCode, null);
  const again = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'AAA111222334' });
  assert.strictEqual(again.body.booking.status, 'PAYMENT_REVIEW');
  assert.strictEqual(again.body.booking.proof.attempts, 2);
  assert.strictEqual(again.body.booking.rejection, null);
  const ok = await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  assert.strictEqual(ok.body.booking.status, 'ACCEPTED');

  const id2 = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id2}/proof`, u.token, { upiRef: 'BBB111222333' });
  await T.cb('POST', `${V}/bookings/${id2}/reject-payment`, s.store.token, { code: 'OTHER', note: 'Name on the payment does not match' });
  const cx = await T.cb('POST', `/api/campus-booking/bookings/${id2}/cancel`, u.token, {});
  assert.strictEqual(cx.body.booking.status, 'CANCELLED');
  assert.strictEqual(cx.body.booking.cancellation.by, 'student');
});

test('refused moves: collect before ready, double confirm, student cancel after review / accept, proof after accept', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  const early = await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  assert.strictEqual(early.status, 409);
  assert.strictEqual(early.body.code, 'BAD_TRANSITION');
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'CCC111222333' });
  const studentCancel = await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, u.token, {});
  assert.strictEqual(studentCancel.status, 409);
  await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  const twice = await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  assert.strictEqual(twice.status, 409);
  const collectEarly = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: 'ABC2' });
  assert.strictEqual(collectEarly.status, 409);
  const lateProof = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'CCC111222399' });
  assert.strictEqual(lateProof.status, 409);
  const lateCancel = await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, u.token, {});
  assert.strictEqual(lateCancel.status, 409);
  assert.match(lateCancel.body.message, /already accepted/i);
  // The stall can still cancel (with a reason), and the student is told to expect the money back.
  const noReason = await T.cb('POST', `${V}/bookings/${id}/cancel`, s.store.token, {});
  assert.strictEqual(noReason.status, 400);
  const vc = await T.cb('POST', `${V}/bookings/${id}/cancel`, s.store.token, { code: 'OUT_OF_STOCK' });
  assert.strictEqual(vc.body.booking.status, 'CANCELLED');
  assert.strictEqual(T.r('modules/campusBooking/services/notify').studentCopy({ ...vc.body.booking, cancelledBy: 'vendor', cancelReason: 'An item is out of stock' }, 'X').body.includes('returns the amount'), true);
});

test('two taps at once: exactly one confirm wins (version check)', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'DDD111222333' });
  const res = await Promise.all([
    T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {}),
    T.cb('POST', `${V}/bookings/${id}/reject-payment`, s.store.token, { code: 'NOT_RECEIVED' }),
    T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {}),
  ]);
  assert.strictEqual(res.filter((r) => r.status === 200).length, 1, JSON.stringify(res.map((r) => [r.status, r.body && r.body.code])));
  assert.ok(res.filter((r) => r.status === 409).length === 2);
  const row = await T.ctx.M('CampusBooking').findByPk(id);
  assert.strictEqual(row.version, 2);
});

test('lifecycle job: unpaid after 20 min and rejected after 2 h are cancelled by the system; others untouched', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const u2 = await T.mkUser();
  const unpaid = (await T.book(u, s)).body.booking.id;
  const rejected = (await T.book(u2, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${rejected}/proof`, u2.token, { upiRef: 'EEE111222333' });
  await T.cb('POST', `${V}/bookings/${rejected}/reject-payment`, s.store.token, { code: 'NOT_RECEIVED' });
  const review = (await T.book(u2, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${review}/proof`, u2.token, { upiRef: 'EEE111222334' });
  const { runCampusBookingJobs } = T.r('modules/campusBooking/jobs');
  const early = await runCampusBookingJobs({ now: new Date(Date.now() + 5 * 60000) });
  assert.ok(early.idle);
  const r = await runCampusBookingJobs({ now: new Date(Date.now() + 3 * 3600 * 1000) });
  assert.ok(r.expiredUnpaid >= 1 && r.expiredRejected >= 1, JSON.stringify(r));
  const M = T.ctx.M('CampusBooking');
  assert.strictEqual((await M.findByPk(unpaid)).status, 'CANCELLED');
  assert.strictEqual((await M.findByPk(unpaid)).cancelledBy, 'system');
  assert.strictEqual((await M.findByPk(rejected)).status, 'CANCELLED');
  assert.strictEqual((await M.findByPk(review)).status, 'PAYMENT_REVIEW', 'a payment under review is never auto-cancelled');
});

test('idempotent create: the same key returns the same booking; open-booking cap per student', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const a = await T.book(u, s, undefined, { 'Idempotency-Key': 'cb-key-1' });
  const b = await T.book(u, s, undefined, { 'Idempotency-Key': 'cb-key-1' });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(a.body.booking.id, b.body.booking.id);
  await T.book(u, s);
  await T.book(u, s);
  const fourth = await T.book(u, s);
  assert.strictEqual(fourth.status, 409);
  assert.strictEqual(fourth.body.code, 'TOO_MANY_OPEN');
});

test('realtime: student room, stall room and admin get ids-only nudges', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser();
  const before = T.ctx.emitted.length;
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'FFF111222333' });
  await new Promise((r) => setTimeout(r, 500));
  const evts = T.ctx.emitted.slice(before);
  const user = evts.filter((e) => e.room === `user_${u.id}` && e.ev === 'campusbooking:changed');
  const store = evts.filter((e) => e.room === `restaurant_${s.store.id}` && e.ev === 'campusbooking:changed');
  assert.ok(user.length >= 2 && store.length >= 2);
  assert.deepStrictEqual(Object.keys(user[user.length - 1].p).sort(), ['at', 'id', 'status']);
  assert.ok(evts.some((e) => e.room === 'admin-room' && e.ev === 'admin:changed'));
});
