// Slot booking engine + waitlist.
// Owner scenarios: #8 expired hold releases, #23 waitlist promotion follows capacity rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(async () => { await H.setup({ label: 'ce-slots' }); await H.setFlag(true); });
test.after(async () => { await H.configureRazorpay(false); await H.teardown(); });

const slotEvent = (extra = {}) => H.mkEvent({
  format: 'SLOT', capacity: 2, maxBookingsPerStudent: 2,
  slots: [{ startOffsetH: 0, durationH: 1, capacity: 2 }, { startOffsetH: 1, durationH: 1, capacity: 1 }, { startOffsetH: 2, durationH: 1, capacity: 3, price: 0 }],
  ...extra,
});

test('slot picker: dates -> sessions -> slot; per-slot capacity; per-student limit; no duplicate same slot; server price', async () => {
  const { event, slots } = await slotEvent({ priceType: 'PAID', price: 40, paymentModes: ['VENUE'], category: 'RECREATION', title: 'Drone Soccer' });
  const s = await H.mkStudent();
  const v = await H.api('GET', `/api/campus-events/${event.id}/slots`, s.token);
  assert.equal(v.status, 200);
  assert.equal(v.body.days.length, 1);
  assert.equal(v.body.slots.length, 3);
  assert.equal(v.body.slots[0].remaining, 2);
  assert.equal(v.body.slots[0].price.total, 40);
  assert.equal(v.body.slots[2].price.total, 0, 'slot price override');
  const noSlot = await H.register(event.id, s, { paymentMode: 'VENUE' });
  assert.equal(noSlot.status, 400);
  const b1 = await H.api('POST', `/api/campus-events/${event.id}/slots/${slots[1].id}/book`, s.token, { acceptRules: true, rulesVersion: 1, paymentMode: 'VENUE', price: 0 });
  assert.equal(b1.status, 201);
  assert.equal(b1.body.registration.status, 'CONFIRMED');
  assert.equal(b1.body.registration.payment.total, 40);
  assert.equal(b1.body.registration.tickets[0].kind, 'SLOT');
  const dup = await H.register(event.id, s, { slotId: slots[1].id, paymentMode: 'VENUE' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'ALREADY_REGISTERED');
  const other = await H.mkStudent();
  const full = await H.register(event.id, other, { slotId: slots[1].id, paymentMode: 'VENUE', joinWaitlist: false });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, 'SLOT_FULL');
  assert.equal((await H.register(event.id, s, { slotId: slots[2].id })).status, 201, 'free slot needs no payment');
  const third = await H.register(event.id, s, { slotId: slots[0].id, paymentMode: 'VENUE' });
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'BOOKING_LIMIT');
  const av = await H.api('GET', `/api/campus-events/${event.id}/availability`, s.token);
  assert.deepEqual(av.body.slots.map((x) => x.remaining), [2, 0, 2]);
  assert.deepEqual((await H.checkInvariants(event.id)).problems, []);
});

test('#8 expired hold releases the place (lazy on next booking and via the lifecycle job); confirm after expiry -> 410', async () => {
  const { event, slots } = await slotEvent();
  const a = await H.mkStudent();
  const b = await H.mkStudent();
  const h = await H.api('POST', `/api/campus-events/${event.id}/slots/${slots[1].id}/hold`, a.token, {});
  assert.equal(h.status, 201);
  assert.equal(h.body.registration.status, 'HELD');
  assert.ok(h.body.registration.holdExpiresAt);
  const blocked = await H.register(event.id, b, { slotId: slots[1].id, joinWaitlist: false });
  assert.equal(blocked.body.code, 'SLOT_FULL', 'a hold occupies the place');
  H.advance(11 * H.MIN);
  const now = await H.register(event.id, b, { slotId: slots[1].id });
  assert.equal(now.status, 201, 'stale hold expired lazily inside the lock');
  assert.equal(now.body.registration.status, 'CONFIRMED');
  const late = await H.api('POST', `/api/campus-events/registrations/${h.body.registration.id}/confirm`, a.token, { acceptRules: true, rulesVersion: 1 });
  assert.equal(late.status, 410);
  assert.equal(late.body.code, 'HOLD_EXPIRED');
  // Via the job: hold, wait, job releases, counters back.
  const c = await H.mkStudent();
  const h2 = await H.api('POST', `/api/campus-events/${event.id}/slots/${slots[0].id}/hold`, c.token, {});
  assert.equal((await H.ctx.M('CeSlot').findByPk(slots[0].id)).unitsLive, 1);
  H.advance(11 * H.MIN);
  const j = await H.runJobs();
  assert.ok(j.expired >= 1);
  assert.equal((await H.ctx.M('CeRegistration').findByPk(h2.body.registration.id)).status, 'EXPIRED');
  assert.equal((await H.ctx.M('CeSlot').findByPk(slots[0].id)).unitsLive, 0);
  assert.ok((await H.notificationsFor(c.id)).some((n) => n.type === 'CE_HOLD_EXPIRED'));
  // Hold -> confirm happy path + release.
  const d = await H.mkStudent();
  const h3 = await H.api('POST', `/api/campus-events/${event.id}/slots/${slots[0].id}/hold`, d.token, {});
  const cf = await H.api('POST', `/api/campus-events/registrations/${h3.body.registration.id}/confirm`, d.token, { acceptRules: true, rulesVersion: 1 });
  assert.equal(cf.status, 200);
  assert.equal(cf.body.registration.status, 'CONFIRMED');
  const e = await H.mkStudent();
  const h4 = await H.api('POST', `/api/campus-events/${event.id}/slots/${slots[0].id}/hold`, e.token, {});
  const rel = await H.api('POST', `/api/campus-events/registrations/${h4.body.registration.id}/release`, e.token, {});
  assert.equal(rel.body.registration.status, 'CANCELLED');
  assert.deepEqual((await H.checkInvariants(event.id)).problems, []);
});

test('#23 waitlist promotion by capacity rules: FIFO; free / venue -> confirmed directly; wallet -> OFFERED then next on expiry', async () => {
  const { event } = await H.mkEvent({ capacity: 1, waitlistEnabled: true });
  const [a, b, c] = [await H.mkStudent(), await H.mkStudent(), await H.mkStudent()];
  const ra = await H.register(event.id, a);
  const rb = await H.register(event.id, b);
  H.advance(H.MIN);
  const rc = await H.register(event.id, c);
  assert.equal(rb.body.registration.status, 'WAITLISTED');
  assert.equal(rc.body.registration.status, 'WAITLISTED');
  await H.api('POST', `/api/campus-events/registrations/${ra.body.registration.id}/cancel`, a.token, {});
  const pb = await H.ctx.M('CeRegistration').findByPk(rb.body.registration.id);
  assert.equal(pb.status, 'CONFIRMED', 'first in line promoted');
  assert.equal((await H.ctx.M('CeRegistration').findByPk(rc.body.registration.id)).status, 'WAITLISTED');
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: pb.id, status: 'ACTIVE' } }), 1, 'ticket issued on promotion');
  assert.ok((await H.notificationsFor(b.id)).some((n) => n.type === 'CE_WAITLIST_PROMOTED'));
  // Organizer raises capacity -> the next one is promoted too (admin-approved change).
  const adm = await H.admin();
  assert.equal((await H.api('PATCH', `/api/admin/campus-events/events/${event.id}`, adm.token, { capacity: 2 })).status, 200);
  assert.equal((await H.ctx.M('CeRegistration').findByPk(rc.body.registration.id)).status, 'CONFIRMED');
  assert.equal((await H.api('PATCH', `/api/admin/campus-events/events/${event.id}`, adm.token, { capacity: 1 })).body.code, 'CAPACITY_BELOW_TAKEN');
  // Wallet event: offer with expiry, then the next person.
  await H.setWallet(true);
  const { event: e2 } = await H.mkEvent({ capacity: 1, priceType: 'PAID', price: 60, paymentModes: ['WALLET'], waitlistOfferMinutes: 30 });
  const [x, y, z] = [await H.mkStudent({ wallet: 100 }), await H.mkStudent({ wallet: 100 }), await H.mkStudent({ wallet: 100 })];
  const rx = await H.register(e2.id, x, { paymentMode: 'WALLET' });
  const ry = await H.register(e2.id, y, { paymentMode: 'WALLET' });
  H.advance(H.MIN);
  const rz = await H.register(e2.id, z, { paymentMode: 'WALLET' });
  assert.equal(ry.body.registration.status, 'WAITLISTED');
  assert.equal(Number((await H.ctx.M('User').findByPk(y.id)).walletBalance), 100, 'waitlist charges nothing');
  await H.api('POST', `/api/campus-events/registrations/${rx.body.registration.id}/cancel`, x.token, {});
  let gy = await H.ctx.M('CeRegistration').findByPk(ry.body.registration.id);
  assert.equal(gy.status, 'OFFERED');
  assert.ok((await H.notificationsFor(y.id)).some((n) => n.type === 'CE_WAITLIST_OFFER'));
  H.advance(31 * H.MIN);
  await H.runJobs();
  gy = await H.ctx.M('CeRegistration').findByPk(ry.body.registration.id);
  assert.equal(gy.status, 'EXPIRED');
  const gz = await H.ctx.M('CeRegistration').findByPk(rz.body.registration.id);
  assert.equal(gz.status, 'OFFERED', 'next in line offered');
  const acc = await H.api('POST', `/api/campus-events/registrations/${gz.id}/accept-offer`, z.token, {});
  assert.equal(acc.status, 200);
  assert.equal(acc.body.registration.status, 'CONFIRMED');
  assert.equal(Number((await H.ctx.M('User').findByPk(z.id)).walletBalance), 40);
  assert.equal((await H.api('POST', `/api/campus-events/registrations/${gy.id}/accept-offer`, y.token, {})).status, 410);
  assert.deepEqual((await H.checkInvariants(e2.id)).problems, []);
  await H.setWallet(false);
});

test('slots: organizer edits (capacity never below taken, time change notifies), slot cancel refunds + notifies', async () => {
  const { event, slots, organizer } = await slotEvent();
  const s = await H.mkStudent();
  await H.register(event.id, s, { slotId: slots[0].id });
  const low = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}/slots/${slots[0].id}`, organizer.token, { capacity: 0 });
  assert.equal(low.status, 400);
  const t = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}/slots/${slots[0].id}`, organizer.token, { startAt: new Date(Date.parse(slots[0].startAt) + 30 * H.MIN).toISOString(), endAt: new Date(Date.parse(slots[0].endAt) + 30 * H.MIN).toISOString() });
  assert.equal(t.status, 200);
  // S1: on a published event a slot time change waits for an admin; approving applies it and notifies.
  assert.deepEqual(t.body.pendingReview, ['startAt', 'endAt']);
  const ap = await H.api('POST', `/api/admin/campus-events/events/${event.id}/changes/approve`, (await H.admin()).token, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.ok((await H.notificationsFor(s.id)).some((n) => n.type === 'CE_SLOT_CHANGED'));
  const c = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/slots/${slots[0].id}/cancel`, organizer.token, { reason: 'Rain' });
  assert.equal(c.status, 200);
  const regs = await H.ctx.M('CeRegistration').findAll({ where: { slotId: slots[0].id } });
  assert.ok(regs.every((g) => g.status === 'CANCELLED'));
  assert.ok(regs.every((g) => g.cancelledBy === 'organizer'));
});
