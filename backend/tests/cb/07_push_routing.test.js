// Push routing between a stall's two partner apps: In-Campus Booking pushes reach only the stall's ZCS Campus Stall
// phones ("new booking / payment to review"); delivery-order pushes never reach a ZCS Campus Stall phone. The
// student gets a push for each step (bookingId in the data, never an orderId), and a stall token can be
// registered with app 'campusstall'. Uses a stubbed FCM client (no network).
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const push = T.r('utils/push');
const notify = T.r('modules/campusBooking/services/notify');
const tok = (tag) => `${tag}000001:APA91b${'x'.repeat(120)}`;
const sent = [];

test.before(async () => {
  await T.setup();
  push._setMessaging(() => ({
    sendEachForMulticast: async (m) => {
      sent.push({ tokens: [...m.tokens], data: m.data || {}, title: m.notification ? m.notification.title : null });
      return { successCount: m.tokens.length, failureCount: 0, responses: m.tokens.map(() => ({ success: true })) };
    },
  }));
});
test.after(async () => { push._setMessaging(null); await T.teardown(); });

const settle = async () => { await notify.idle(); await push._flushCleanups(); await new Promise((r) => setTimeout(r, 50)); };

test('booking pushes go to ZenWe Campus Stall devices only; delivery pushes skip them', async () => {
  const s = await T.mkStall();
  await s.store.update({ fcmTokens: [{ token: tok('vendor'), app: 'vendor' }, { token: tok('stall'), app: 'campusstall' }] }, { hooks: false });
  const u = await T.mkUser({ fcmTokens: [tok('student')] });
  sent.length = 0;
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'PSH111222333', imageUrl: await T.uploadProof(u) });
  await settle();
  const toStall = sent.filter((x) => x.data.type === 'CAMPUS_BOOKING' && x.tokens.some((t) => t.startsWith('stall') || t.startsWith('vendor')));
  assert.strictEqual(toStall.length, 1, JSON.stringify(sent));
  assert.deepStrictEqual(toStall[0].tokens, [tok('stall')]);
  assert.match(toStall[0].title, /payment to review/i);
  assert.strictEqual(toStall[0].data.bookingId, id);

  const toStudent = sent.filter((x) => x.tokens.includes(tok('student')));
  assert.strictEqual(toStudent.length, 1);
  assert.strictEqual(toStudent[0].data.type, 'CAMPUS_BOOKING');
  assert.strictEqual(toStudent[0].data.bookingId, id);
  assert.strictEqual(toStudent[0].data.orderId, undefined, 'no orderId: the inbox must not open delivery tracking');

  // A delivery-order alert (no apps option) never reaches the Campus Stall phone.
  sent.length = 0;
  await T.r('utils/storePush').pushToStore(s.store.id, 'New order', 'Order #1', { type: 'NEW_ORDER' });
  assert.deepStrictEqual(sent.map((x) => x.tokens), [[tok('vendor')]]);
});

test('every stage pushes the student once (accepted, preparing, ready, collected)', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser({ fcmTokens: [tok('stu2')] });
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'PSH111222334', imageUrl: await T.uploadProof(u) });
  await settle();
  sent.length = 0;
  const V = '/api/campus-booking/vendor';
  await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  await T.cb('POST', `${V}/bookings/${id}/preparing`, s.store.token, {});
  await T.cb('POST', `${V}/bookings/${id}/ready`, s.store.token, {});
  const code = (await T.ctx.M('CampusBooking').findByPk(id)).pickupCode;
  await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  await settle();
  const titles = sent.filter((x) => x.tokens.includes(tok('stu2'))).map((x) => x.title);
  assert.deepStrictEqual(titles, ['Order accepted', 'Preparing your order', 'Order ready for pickup', 'Order collected']);
  for (const x of sent) assert.ok(!JSON.stringify(x).includes(code), 'the pickup code is never in a push');
});

test('hand-over straight from Preparing: a wrong code tells nobody; the right code collects with no false "ready" push', async () => {
  const s = await T.mkStall();
  const u = await T.mkUser({ fcmTokens: [tok('stu3')] });
  const id = (await T.book(u, s)).body.booking.id;
  await T.cb('POST', `/api/campus-booking/bookings/${id}/proof`, u.token, { upiRef: 'PSH111222335', imageUrl: await T.uploadProof(u) });
  const V = '/api/campus-booking/vendor';
  await T.cb('POST', `${V}/bookings/${id}/confirm-payment`, s.store.token, {});
  await T.cb('POST', `${V}/bookings/${id}/preparing`, s.store.token, {});
  await settle();
  sent.length = 0;
  const code = (await T.ctx.M('CampusBooking').findByPk(id)).pickupCode;
  const wrong = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code: code === 'A3F7' ? 'B4G8' : 'A3F7' });
  assert.strictEqual(wrong.body.code, 'WRONG_CODE');
  await settle();
  assert.strictEqual(sent.filter((x) => x.tokens.includes(tok('stu3'))).length, 0, 'a wrong code pushes nothing');
  assert.strictEqual((await T.ctx.M('CampusBooking').findByPk(id)).status, 'PREPARING');
  const ok = await T.cb('POST', `${V}/bookings/${id}/collect`, s.store.token, { code });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.booking.status, 'COLLECTED');
  const row = await T.ctx.M('CampusBooking').findByPk(id);
  assert.ok(row.readyAt && row.collectedAt, 'ready and collected times stamped');
  await settle();
  assert.deepStrictEqual(sent.filter((x) => x.tokens.includes(tok('stu3'))).map((x) => x.title), ['Order collected']);
});

test("a stall token registers with app 'campusstall'", async () => {
  const { registerStoreToken } = T.r('utils/storePush');
  const s = await T.mkStall();
  await registerStoreToken(s.store.id, tok('reg'), { app: 'campusstall' });
  const row = await T.ctx.M('Restaurant').findByPk(s.store.id);
  assert.deepStrictEqual(row.fcmTokens.map((t) => [t.token, t.app]), [[tok('reg'), 'campusstall']]);
});
