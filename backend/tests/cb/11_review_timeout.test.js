// PF-03 / PF-26 (partner-flow test, 6 Nov 2026): a booking whose payment proof the stall never checks used to sit in
// PAYMENT_REVIEW forever: no job touched it, the student's cancel answered 409 and nobody was reminded. Now
// (modules/campusBooking/jobs.js, LIMITS.review*): the stall is reminded at 5 and 10 min, the student may cancel from
// 10 min (and is told so), admins are alerted at 15 min, the stall gets a last call at 25 min and the system cancels
// it at 30 min, telling both sides that the stall returns any money it received (ZCS never holds it).
// PF-26: no push to the student about their own proof; no "booking cancelled" push to a stall that was never told
// about the booking (student cancels before sending proof).
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const push = T.r('utils/push');
const notify = T.r('modules/campusBooking/services/notify');
const { runCampusBookingJobs, _resetReviewReminders } = T.r('modules/campusBooking/jobs');
const tok = (tag) => `${tag}000001:APA91b${'y'.repeat(120)}`;
const sent = [];
const MIN = 60000;

test.before(async () => {
  await T.setup();
  push._setMessaging(() => ({
    sendEachForMulticast: async (m) => {
      sent.push({ tokens: [...m.tokens], data: m.data || {}, title: m.notification ? m.notification.title : null, body: m.notification ? m.notification.body : null });
      return { successCount: m.tokens.length, failureCount: 0, responses: m.tokens.map(() => ({ success: true })) };
    },
  }));
});
test.after(async () => { push._setMessaging(null); await T.teardown(); });

const settle = async () => { await notify.idle(); await push._flushCleanups(); await new Promise((r) => setTimeout(r, 80)); };
const to = (t) => sent.filter((x) => x.tokens.includes(t));

/** A booking with proof sent `minAgo` minutes ago; stall, student and an admin with device tokens. */
const inReview = async (minAgo, tag) => {
  const s = await T.mkStall();
  await s.store.update({ fcmTokens: [{ token: tok(`stall${tag}`), app: 'campusstall' }] }, { hooks: false });
  const u = await T.mkUser({ fcmTokens: [tok(`stu${tag}`)] });
  const id = (await T.book(u, s)).body.booking.id;
  const p = await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: `RVW${tag}11122233`, imageUrl: await T.uploadProof(u) });
  assert.strictEqual(p.body.booking.status, 'PAYMENT_REVIEW');
  await T.ctx.M('CampusBooking').update({ proofSubmittedAt: new Date(Date.now() - minAgo * MIN) }, { where: { id } });
  await settle();
  sent.length = 0;
  return { s, u, id };
};

test('the stall is reminded, the student may cancel from 10 min, admins alerted, then cancelled at 30 min', async () => {
  _resetReviewReminders();
  await T.mkUser({ role: 'admin', fcmTokens: [tok('admin1')] });
  const { u, id } = await inReview(0, 'A');
  const t0 = Date.now();
  const at = async (min) => { await runCampusBookingJobs({ now: new Date(t0 + min * MIN) }); await settle(); };
  await at(4);
  assert.strictEqual(sent.length, 0, 'nothing before 5 min');
  await at(5);
  assert.deepStrictEqual(to(tok('stallA')).map((x) => x.title), ['Payment still to review']);
  assert.strictEqual(to(tok('stuA')).length, 0);
  sent.length = 0;
  await at(7);
  assert.strictEqual(sent.length, 0, 'no repeat inside a stage');
  // Not yet 10 min of review: the student's cancel is refused with when it opens.
  const early = await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, u.token, {});
  assert.strictEqual(early.status, 409);
  assert.strictEqual(early.body.code, 'REVIEW_IN_PROGRESS');
  assert.match(early.body.message, /you can cancel the booking then/);
  const view = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token)).body.booking;
  assert.strictEqual(view.canCancel, false);
  assert.ok(view.canCancelFrom && view.reviewDeadline);
  await at(10);
  assert.deepStrictEqual(to(tok('stallA')).map((x) => x.title), ['Payment still to review']);
  assert.deepStrictEqual(to(tok('stuA')).map((x) => x.title), ['Payment still being checked']);
  sent.length = 0;
  await at(15);
  assert.ok(to(tok('admin1')).some((x) => x.title === 'Campus stall payment not checked'));
  sent.length = 0;
  await at(25);
  assert.deepStrictEqual(to(tok('stallA')).map((x) => x.title), ['Booking about to be cancelled']);
  sent.length = 0;
  await at(30);
  const row = await T.ctx.M('CampusBooking').findByPk(id);
  assert.strictEqual(row.status, 'CANCELLED');
  assert.strictEqual(row.cancelledBy, 'system');
  assert.strictEqual(row.cancelCode, 'REVIEW_TIMEOUT');
  const stu = to(tok('stuA'));
  assert.strictEqual(stu.length, 1);
  assert.match(stu[0].body, /returns the amount/);
  const st = to(tok('stallA'));
  assert.strictEqual(st.length, 1);
  assert.match(st[0].body, /return it to the student/);
});

test('the student cancels a review the stall has not answered for 10+ min; the stall is told to return the money', async () => {
  const { s, u, id } = await inReview(11, 'B');
  const view = (await T.cb('GET', `/api/campus-booking/bookings/${id}`, u.token)).body.booking;
  assert.strictEqual(view.canCancel, true);
  const c = await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, u.token, {});
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  assert.strictEqual(c.body.booking.status, 'CANCELLED');
  assert.strictEqual(c.body.booking.cancellation.by, 'student');
  await settle();
  const st = to(tok('stallB'));
  assert.strictEqual(st.length, 1);
  assert.match(st[0].body, /return it to the student/);
  assert.strictEqual(to(tok('stuB')).length, 0, 'no push to the student about their own cancel');
  // The stall can no longer confirm it.
  const late = await T.cb('POST', `/api/campus-booking/vendor/bookings/${id}/confirm-payment`, s.store.token, {});
  assert.strictEqual(late.status, 409);
});

test('PF-26: a student cancel before any proof sends the stall nothing', async () => {
  const s = await T.mkStall();
  await s.store.update({ fcmTokens: [{ token: tok('stallC'), app: 'campusstall' }] }, { hooks: false });
  const u = await T.mkUser({ fcmTokens: [tok('stuC')] });
  const id = (await T.book(u, s)).body.booking.id;
  await settle();
  sent.length = 0;
  const c = await T.cb('POST', `/api/campus-booking/bookings/${id}/cancel`, u.token, {});
  assert.strictEqual(c.status, 200);
  await settle();
  assert.strictEqual(to(tok('stallC')).length, 0);
});

test('a stall that confirms in time is never reminded again or cancelled', async () => {
  _resetReviewReminders();
  const { s, id } = await inReview(6, 'D');
  await runCampusBookingJobs({ now: new Date() });
  await settle();
  assert.strictEqual(to(tok('stallD')).length, 1);
  const ok = await T.cb('POST', `/api/campus-booking/vendor/bookings/${id}/confirm-payment`, s.store.token, {});
  assert.strictEqual(ok.body.booking.status, 'ACCEPTED');
  sent.length = 0;
  await runCampusBookingJobs({ now: new Date(Date.now() + 40 * MIN) });
  await settle();
  assert.strictEqual(to(tok('stallD')).length, 0);
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'ACCEPTED');
});
