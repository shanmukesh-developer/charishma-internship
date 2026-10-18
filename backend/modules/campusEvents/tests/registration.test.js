// Individual registration, payments, cancellation, eligibility, idempotency.
// Owner scenarios: #3 free registration, #4 paid registration, #5 failed payment is not confirmed,
// #7 capacity reached rejects, #9 cancel within window.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(async () => { await H.setup({ label: 'ce-registration' }); await H.setFlag(true); });
test.after(async () => { await H.configureRazorpay(false); await H.teardown(); });

const QUESTIONS = [
  { id: 'tshirt', label: 'T-shirt size', type: 'CHOICE', options: ['S', 'M', 'L'], required: true },
  { id: 'why', label: 'Why do you want to join?', type: 'TEXT', required: false, maxLength: 50 },
];

test('#3 free registration: questions + rules, CONFIRMED at once, registration ID + QR ticket, notification', async () => {
  const { event } = await H.mkEvent({ capacity: 5, rules: 'Be on time. No outside food.', questions: QUESTIONS });
  const s = await H.mkStudent();
  const d = await H.api('GET', `/api/campus-events/${event.id}`, s.token);
  assert.equal(d.body.event.rulesVersion, 1);
  assert.equal(d.body.event.questions.length, 2);
  const noRules = await H.api('POST', `/api/campus-events/${event.id}/register`, s.token, { answers: { tshirt: 'M' } });
  assert.equal(noRules.status, 400);
  assert.equal(noRules.body.code, 'RULES_NOT_ACCEPTED');
  const missing = await H.register(event.id, s, { answers: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'ANSWER_REQUIRED');
  const badChoice = await H.register(event.id, s, { answers: { tshirt: 'XXL' } });
  assert.equal(badChoice.body.code, 'INVALID_ANSWER');
  const tooLong = await H.register(event.id, s, { answers: { tshirt: 'S', why: 'x'.repeat(80) } });
  assert.equal(tooLong.body.code, 'INVALID_ANSWER');
  const r = await H.register(event.id, s, { answers: { tshirt: 'M', why: 'Robots!', injected: 'ignored' } });
  assert.equal(r.status, 201);
  const reg = r.body.registration;
  assert.equal(reg.status, 'CONFIRMED');
  assert.match(reg.code, /^EV-[A-Z2-9]{6}$/);
  assert.equal(reg.payment.mode, 'NONE');
  assert.deepEqual(reg.answers, { tshirt: 'M', why: 'Robots!' });
  assert.equal(reg.tickets.length, 1);
  assert.equal(reg.ticketStatus, 'AVAILABLE');
  const tk = await H.api('GET', `/api/campus-events/tickets/${reg.tickets[0].id}`, s.token);
  assert.equal(tk.status, 200);
  assert.match(tk.body.ticket.qrToken, /^ZE1\.[0-9a-f-]{36}\.1\.[A-Za-z0-9_-]+$/);
  assert.match(tk.body.ticket.ticketCode, /^[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(JSON.stringify(tk.body).includes(s.phone), false, 'no phone in ticket');
  const again = await H.register(event.id, s, { answers: { tshirt: 'L' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_REGISTERED');
  const notes = await H.notificationsFor(s.id);
  assert.ok(notes.some((n) => n.type === 'CE_REGISTRATION_CONFIRMED'));
  const d2 = await H.api('GET', `/api/campus-events/${event.id}`, s.token);
  assert.equal(d2.body.event.cta.action, 'VIEW_TICKET');
  assert.equal(d2.body.event.capacity.remaining, 4);
  // Rules changed by an admin edit -> old rulesVersion refused.
  const adm = await H.admin();
  assert.equal((await H.api('PATCH', `/api/admin/campus-events/events/${event.id}`, adm.token, { rules: 'Be on time. Bring your ID card.' })).status, 200);
  const s2 = await H.mkStudent();
  const stale = await H.register(event.id, s2, { answers: { tshirt: 'S' }, rulesVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'RULES_CHANGED');
  assert.equal((await H.register(event.id, s2, { answers: { tshirt: 'S' }, rulesVersion: 2 })).status, 201);
});

test('eligibility: verified student of the same campus, year / branch / adult rules', async () => {
  const { event } = await H.mkEvent({ capacity: 10, eligibility: { years: [3, 4], branches: ['ECE'], adultOnly: true } });
  const cases = [
    [await H.mkStudent({ verified: false, year: 3, branch: 'ECE' }), 'VERIFICATION_REQUIRED'],
    [await H.mkStudent({ year: 1, branch: 'ECE' }), 'NOT_ELIGIBLE'],
    [await H.mkStudent({ year: 3, branch: 'CSE' }), 'NOT_ELIGIBLE'],
    [await H.mkStudent({ year: 3, branch: 'ECE', isAdult: false }), 'NOT_ELIGIBLE'],
    [await H.mkStudent({ noProfile: true }), 'VERIFICATION_REQUIRED'],
  ];
  for (const [u, code] of cases) {
    const r = await H.register(event.id, u);
    assert.ok([403, 404].includes(r.status), `${code} ${r.status}`);
    if (r.status === 403) assert.equal(r.body.code, code);
  }
  const ok = await H.mkStudent({ year: 4, branch: 'ece' });
  assert.equal((await H.register(event.id, ok)).status, 201);
  const other = await H.mkStudent({ year: 3, branch: 'ECE', campusRow: await H.mkCampus('Elsewhere') });
  assert.equal((await H.register(event.id, other)).status, 404, 'other campus cannot even see it');
  const d = await H.api('GET', `/api/campus-events/${event.id}`, cases[1][0].token);
  assert.equal(d.body.event.cta.action, 'NOT_ELIGIBLE');
  assert.deepEqual(d.body.event.eligibilityReasons, ['YEAR_NOT_ELIGIBLE']);
});

test('#4 paid registration: pay at venue (DUE_AT_VENUE, mark paid audited, max 3 unpaid) + wallet (off by default, debit, refund exactly once)', async () => {
  const org = await H.mkOrganizer();
  const mk = (extra = {}) => H.mkEvent({ organizer: org, capacity: 5, priceType: 'PAID', price: 120, extraCharges: [{ label: 'Kit', amount: 30 }], paymentModes: ['VENUE', 'WALLET'], ...extra });
  const { event } = await mk();
  const s = await H.mkStudent({ wallet: 500 });
  const d = await H.api('GET', `/api/campus-events/${event.id}`, s.token);
  assert.equal(d.body.event.price.total, 150, 'fee + extras shown before confirming');
  assert.deepEqual(d.body.event.paymentModes, ['VENUE'], 'wallet hidden while CAMPUS_EVENTS_WALLET_ENABLED is off');
  const w = await H.register(event.id, s, { paymentMode: 'WALLET', price: 1, total: 1 });
  assert.equal(w.status, 403);
  assert.equal(w.body.code, 'PAYMENT_METHOD_OFF');
  const v = await H.register(event.id, s, { paymentMode: 'VENUE', total: 1 });
  assert.equal(v.status, 201);
  assert.equal(v.body.registration.status, 'CONFIRMED');
  assert.equal(v.body.registration.payment.status, 'DUE_AT_VENUE');
  assert.equal(v.body.registration.payment.total, 150, 'server price, client total ignored');
  // Organizer marks it paid (audited).
  const mp = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/registrations/${v.body.registration.id}/mark-paid`, org.token);
  assert.equal(mp.status, 200);
  assert.equal(mp.body.registration.paymentStatus, 'PAID_AT_VENUE');
  assert.ok(await H.ctx.M('CeAuditLog').findOne({ where: { registrationId: v.body.registration.id, action: 'payment.mark_paid_at_venue' } }));
  // Max 3 unpaid venue reservations per student.
  const u = await H.mkStudent();
  for (let i = 0; i < 3; i++) assert.equal((await H.register((await mk()).event.id, u, { paymentMode: 'VENUE' })).status, 201);
  const fourth = await H.register((await mk()).event.id, u, { paymentMode: 'VENUE' });
  assert.equal(fourth.status, 409);
  assert.equal(fourth.body.code, 'TOO_MANY_UNPAID');
  // Wallet on.
  await H.setWallet(true);
  const { event: e2 } = await mk({ cancellationPolicy: { userCancelUntilHours: 1, refundPct: 50 } });
  const poor = await H.mkStudent({ wallet: 10 });
  const short = await H.register(e2.id, poor, { paymentMode: 'WALLET' });
  assert.equal(short.status, 402);
  assert.equal((await H.ctx.M('CeRegistration').count({ where: { userId: poor.id } })), 0, 'nothing kept after a failed debit');
  assert.equal(await H.ctx.M('WalletTransaction').count({ where: { ownerId: poor.id } }), 0, 'C5: no ledger row for a failed debit');
  const rich = await H.mkStudent({ wallet: 400 });
  const ok = await H.register(e2.id, rich, { paymentMode: 'WALLET' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.registration.payment.status, 'SUCCESS');
  assert.equal(Number((await H.ctx.M('User').findByPk(rich.id)).walletBalance), 250);
  const c = await H.api('POST', `/api/campus-events/registrations/${ok.body.registration.id}/cancel`, rich.token, {});
  assert.equal(c.status, 200);
  await H.idle();
  const after = await H.ctx.M('CeRegistration').findByPk(ok.body.registration.id);
  assert.equal(after.paymentStatus, 'REFUNDED');
  assert.equal(after.refundAmount, 75, '50 % policy');
  assert.equal(Number((await H.ctx.M('User').findByPk(rich.id)).walletBalance), 325);
  const pay = H.r('modules/campusEvents/services/payments');
  assert.equal(await pay.processRefund(after.id), 0, 'second refund is a no-op');
  assert.equal(Number((await H.ctx.M('User').findByPk(rich.id)).walletBalance), 325);
  // C5 ledger: opening 400, EVENT_PAYMENT -150, exactly one EVENT_REFUND +75; history sums to the balance.
  const rows = (await H.ctx.M('WalletTransaction').findAll({ where: { ownerType: 'user', ownerId: rich.id }, order: [['createdAt', 'ASC']] })).map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.refType, x.refId]);
  assert.deepEqual(rows, [
    ['OPENING_BALANCE', 40000, 40000, null, null],
    ['EVENT_PAYMENT', -15000, 25000, 'EVENT_REGISTRATION', ok.body.registration.id],
    ['EVENT_REFUND', 7500, 32500, 'EVENT_REGISTRATION', ok.body.registration.id],
  ]);
  await H.setWallet(false);
});

test('#4 paid online (Razorpay): 503 PAYMENT_NOT_CONFIGURED until set up; PENDING_PAYMENT until a signed webhook; #5 failed payment is not confirmed', async () => {
  const org = await H.mkOrganizer();
  const { event } = await H.mkEvent({ organizer: org, capacity: 3, priceType: 'PAID', price: 200, paymentModes: ['ONLINE'] });
  const s = await H.mkStudent();
  const off = await H.register(event.id, s, { paymentMode: 'ONLINE' });
  assert.equal(off.status, 503);
  assert.equal(off.body.code, 'PAYMENT_NOT_CONFIGURED');
  await H.configureRazorpay(true);
  const r = await H.register(event.id, s, { paymentMode: 'ONLINE' });
  assert.equal(r.status, 201);
  const regId = r.body.registration.id;
  assert.equal(r.body.registration.status, 'PENDING_PAYMENT');
  assert.equal(r.body.registration.tickets.length, 0, 'no ticket before payment');
  const o = await H.api('POST', `/api/campus-events/registrations/${regId}/pay/razorpay-order`, s.token);
  assert.equal(o.status, 200);
  assert.equal(o.body.amountPaise, 20000);
  const o2 = await H.api('POST', `/api/campus-events/registrations/${regId}/pay/razorpay-order`, s.token);
  assert.equal(o2.body.orderId, o.body.orderId, 'same open order reused (no duplicate charge)');
  // #5: a failed payment webhook never confirms.
  const f = await H.webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_fail1', order_id: o.body.orderId, amount: 20000, error_description: 'Card declined' } } } });
  assert.equal(f.status, 200);
  let st = await H.api('GET', `/api/campus-events/registrations/${regId}/payment`, s.token);
  assert.equal(st.body.status, 'PENDING_PAYMENT');
  assert.equal(st.body.payment.status, 'FAILED');
  assert.equal(st.body.confirmed, false);
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: regId } }), 0);
  assert.ok((await H.notificationsFor(s.id)).some((n) => n.type === 'CE_PAYMENT_FAILED'));
  // The client claiming success changes nothing.
  st = await H.api('GET', `/api/campus-events/registrations/${regId}/payment`, s.token);
  assert.equal(st.body.confirmed, false);
  // Retry -> a new order -> captured webhook confirms + ticket.
  const o3 = await H.api('POST', `/api/campus-events/registrations/${regId}/pay/razorpay-order`, s.token);
  assert.notEqual(o3.body.orderId, o.body.orderId);
  const wrongAmt = await H.webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: o3.body.orderId, amount: 100 } } } });
  assert.equal(wrongAmt.body.result, 'rejected:amount_mismatch');
  const ok = await H.webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_ok1', order_id: o3.body.orderId, amount: 20000 } } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result, 'confirmed');
  st = await H.api('GET', `/api/campus-events/registrations/${regId}/payment`, s.token);
  assert.equal(st.body.status, 'CONFIRMED');
  assert.equal(st.body.payment.status, 'SUCCESS');
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: regId, status: 'ACTIVE' } }), 1);
  // Payment timeout: a second student never pays -> EXPIRED (paymentStatus TIMEOUT), place released.
  const t = await H.mkStudent();
  const r2 = await H.register(event.id, t, { paymentMode: 'ONLINE' });
  assert.equal(r2.body.registration.status, 'PENDING_PAYMENT');
  H.advance(16 * H.MIN);
  await H.runJobs();
  const exp = await H.ctx.M('CeRegistration').findByPk(r2.body.registration.id);
  assert.equal(exp.status, 'EXPIRED');
  assert.equal(exp.paymentStatus, 'TIMEOUT');
  assert.equal((await H.checkInvariants(event.id)).problems.length, 0);
  // Cancel the confirmed online one inside the window -> Razorpay refund via the provider boundary.
  const c = await H.api('POST', `/api/campus-events/registrations/${regId}/cancel`, s.token, {});
  assert.equal(c.status, 200);
  await H.idle();
  const refunded = await H.ctx.M('CeRegistration').findByPk(regId);
  assert.equal(refunded.paymentStatus, 'REFUNDED');
  assert.ok(H.razorpayCalls.some((x) => /\/payments\/pay_ok1\/refund$/.test(x.url) && x.body.amount === 20000));
  await H.configureRazorpay(false);
});

test('#7 capacity reached rejects (waitlist off -> 409 EVENT_FULL; waitlist on -> WAITLISTED, never over capacity)', async () => {
  const { event } = await H.mkEvent({ capacity: 2, waitlistEnabled: false });
  const a = await H.mkStudent();
  const b = await H.mkStudent();
  const c = await H.mkStudent();
  assert.equal((await H.register(event.id, a)).status, 201);
  assert.equal((await H.register(event.id, b)).status, 201);
  const full = await H.register(event.id, c);
  assert.equal(full.status, 409);
  assert.equal(full.body.code, 'EVENT_FULL');
  const d = await H.api('GET', `/api/campus-events/${event.id}`, c.token);
  assert.equal(d.body.event.cta.action, 'EVENT_FULL');
  assert.equal(d.body.event.registrationState, 'FULL');
  const { event: e2 } = await H.mkEvent({ capacity: 1, waitlistEnabled: true });
  assert.equal((await H.register(e2.id, a)).status, 201);
  const w = await H.register(e2.id, b);
  assert.equal(w.status, 201);
  assert.equal(w.body.waitlisted, true);
  assert.equal(w.body.registration.status, 'WAITLISTED');
  const no = await H.register(e2.id, c, { joinWaitlist: false });
  assert.equal(no.status, 409);
  const inv = await H.checkInvariants(e2.id);
  assert.deepEqual(inv.problems, []);
  assert.equal(inv.event.unitsLive, 1);
  assert.equal(inv.event.waitlistCount, 1);
});

test('#9 cancel within the window frees the place, voids the ticket; after the window -> 409 CANCEL_WINDOW_CLOSED', async () => {
  const { event } = await H.mkEvent({ capacity: 1, startInH: 30, cancellationPolicy: { userCancelUntilHours: 24 }, waitlistEnabled: false });
  const s = await H.mkStudent();
  const r = await H.register(event.id, s);
  const tId = r.body.registration.tickets[0].id;
  const c = await H.api('POST', `/api/campus-events/registrations/${r.body.registration.id}/cancel`, s.token, { reason: 'Exam clash' });
  assert.equal(c.status, 200);
  assert.equal(c.body.registration.status, 'CANCELLED');
  assert.equal((await H.ctx.M('CeTicket').findByPk(tId)).status, 'CANCELLED');
  const s2 = await H.mkStudent();
  const r2 = await H.register(event.id, s2);
  assert.equal(r2.status, 201, 'place released');
  assert.equal(r2.body.registration.canCancel, true);
  H.advance(7 * H.HOUR); // now 23 h before start
  const late = await H.api('POST', `/api/campus-events/registrations/${r2.body.registration.id}/cancel`, s2.token, {});
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'CANCEL_WINDOW_CLOSED');
  const det = await H.api('GET', `/api/campus-events/registrations/${r2.body.registration.id}`, s2.token);
  assert.equal(det.body.registration.canCancel, false);
  // Someone else's registration is invisible.
  assert.equal((await H.api('POST', `/api/campus-events/registrations/${r2.body.registration.id}/cancel`, s.token, {})).status, 404);
  assert.equal((await H.api('GET', `/api/campus-events/registrations/${r2.body.registration.id}`, s.token)).status, 404);
  // My Registrations tabs.
  const cancelled = await H.api('GET', '/api/campus-events/my/registrations?tab=cancelled', s.token);
  assert.ok(cancelled.body.registrations.some((x) => x.id === r.body.registration.id));
  const up = await H.api('GET', '/api/campus-events/my/registrations?tab=upcoming', s2.token);
  assert.ok(up.body.registrations.some((x) => x.id === r2.body.registration.id));
});

test('idempotent register replay: same Idempotency-Key -> same registration, one row; ended key refused', async () => {
  const { event } = await H.mkEvent({ capacity: 5 });
  const s = await H.mkStudent();
  const key = 'reg-key-0001-abcdef';
  const [a, b] = await Promise.all([
    H.api('POST', `/api/campus-events/${event.id}/register`, s.token, { acceptRules: true, rulesVersion: 1 }, { 'Idempotency-Key': key }),
    H.api('POST', `/api/campus-events/${event.id}/register`, s.token, { acceptRules: true, rulesVersion: 1 }, { 'Idempotency-Key': key }),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 201]);
  assert.equal(a.body.registration.id, b.body.registration.id);
  const c = await H.api('POST', `/api/campus-events/${event.id}/register`, s.token, { acceptRules: true, rulesVersion: 1 }, { 'Idempotency-Key': key });
  assert.equal(c.status, 200);
  assert.equal(c.body.replay, true);
  assert.equal(await H.ctx.M('CeRegistration').count({ where: { userId: s.id, eventId: event.id } }), 1);
  await H.api('POST', `/api/campus-events/registrations/${a.body.registration.id}/cancel`, s.token, {});
  const d = await H.api('POST', `/api/campus-events/${event.id}/register`, s.token, { acceptRules: true, rulesVersion: 1 }, { 'Idempotency-Key': key });
  assert.equal(d.status, 409);
  assert.equal(d.body.code, 'IDEMPOTENCY_KEY_REUSED');
  const e = await H.api('POST', `/api/campus-events/${event.id}/register`, s.token, { acceptRules: true, rulesVersion: 1 }, { 'Idempotency-Key': 'reg-key-0002-abcdef' });
  assert.equal(e.status, 201);
});

test('approval required: PENDING_APPROVAL keeps the place; organizer approves (ticket) / rejects (refund + place freed)', async () => {
  await H.setWallet(true);
  const org = await H.mkOrganizer();
  const { event } = await H.mkEvent({ organizer: org, capacity: 2, approvalRequired: true, priceType: 'PAID', price: 50, paymentModes: ['WALLET', 'VENUE'] });
  const a = await H.mkStudent({ wallet: 100 });
  const b = await H.mkStudent({ wallet: 100 });
  const ra = await H.register(event.id, a, { paymentMode: 'WALLET' });
  const rb = await H.register(event.id, b, { paymentMode: 'VENUE' });
  assert.equal(ra.body.registration.status, 'PENDING_APPROVAL');
  assert.equal(rb.body.registration.status, 'PENDING_APPROVAL');
  assert.equal(ra.body.registration.tickets.length, 0);
  const c = await H.mkStudent();
  const full = await H.register(event.id, c, { paymentMode: 'VENUE', joinWaitlist: false });
  assert.equal(full.body.code, 'EVENT_FULL', 'pending approvals keep their units');
  const list = await H.api('GET', `/api/campus-events/organizer/events/${event.id}/registrations`, org.token);
  assert.equal(list.status, 200);
  const rowA = list.body.registrations.find((x) => x.id === ra.body.registration.id);
  assert.equal(rowA.name, 'Test Student');
  for (const k of ['phone', 'email', 'userId', 'walletBalance']) assert.equal(k in rowA, false, `no ${k} for organizers`);
  assert.equal(JSON.stringify(list.body).includes(a.phone), false);
  const ap = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/registrations/${ra.body.registration.id}/approve`, org.token);
  assert.equal(ap.status, 200);
  assert.equal(ap.body.registration.status, 'CONFIRMED');
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: ra.body.registration.id, status: 'ACTIVE' } }), 1);
  const rj = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/registrations/${rb.body.registration.id}/reject`, org.token, { reason: 'Seats reserved for members' });
  assert.equal(rj.status, 200);
  assert.equal(rj.body.registration.status, 'REJECTED');
  assert.equal((await H.register(event.id, c, { paymentMode: 'VENUE' })).status, 201, 'rejected place freed');
  const notes = await H.notificationsFor(b.id);
  assert.ok(notes.some((n) => n.type === 'CE_REGISTRATION_REJECTED'));
  assert.ok((await H.notificationsFor(a.id)).some((n) => n.type === 'CE_REGISTRATION_APPROVED'));
  assert.deepEqual((await H.checkInvariants(event.id)).problems, []);
  await H.setWallet(false);
});
