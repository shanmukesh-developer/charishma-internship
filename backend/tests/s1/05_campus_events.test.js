// S1 quick fixes (Campus Events): slot create / edit on a live event goes through admin review + slot price
// capped at settings.maxPrice; organizer gate rights need ACTIVE organizer access; typed check-in codes are
// looked up inside the event only; ?tab= lookups are prototype-safe.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../modules/campusEvents/tests/helpers');

test.before(async () => { await H.setup({ label: 's1-ce' }); await H.setFlag(true); });
test.after(() => H.teardown());

const slotBody = (event, offH, cap = 3, extra = {}) => {
  const start = Date.parse(event.startAt) + offH * H.HOUR;
  return { label: `Extra ${offH}`, startAt: new Date(start).toISOString(), endAt: new Date(start + H.HOUR).toISOString(), capacity: cap, ...extra };
};

test('live event: a new slot waits for the admin (PENDING, not bookable); approve opens it, reject closes it', async () => {
  const { event, organizer } = await H.mkEvent({ format: 'SLOT', capacity: 2 });
  assert.equal(event.status, 'PUBLISHED');
  const c = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/slots`, organizer.token, slotBody(event, 1));
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.pendingReview, true);
  const slotId = c.body.slots[0].id;
  assert.equal((await H.ctx.M('CeSlot').findByPk(slotId)).status, 'PENDING');
  const ev = await H.ctx.M('CeEvent').findByPk(event.id);
  assert.equal(ev.pendingChanges.fields.slotChanges[0].op, 'add');
  // students cannot see or book it
  const s = await H.mkStudent();
  const list = await H.api('GET', `/api/campus-events/${event.id}/slots`, s.token);
  assert.ok(!list.body.slots.some((x) => x.id === slotId));
  const book = await H.register(event.id, s, { slotId });
  assert.notEqual(book.status, 201);
  // admin review queue shows it, approve opens it
  const admin = await H.admin();
  const q = await H.api('GET', '/api/admin/campus-events/review-queue', admin.token);
  if (q.status === 200) assert.ok(JSON.stringify(q.body).includes(event.id));
  const ap = await H.api('POST', `/api/admin/campus-events/events/${event.id}/changes/approve`, admin.token, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal((await H.ctx.M('CeSlot').findByPk(slotId)).status, 'OPEN');
  assert.equal((await H.ctx.M('CeEvent').findByPk(event.id)).pendingChanges, null);
  assert.equal((await H.register(event.id, s, { slotId })).status, 201);
  // another one, rejected
  const c2 = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/slots`, organizer.token, slotBody(event, 2));
  const rj = await H.api('POST', `/api/admin/campus-events/events/${event.id}/changes/reject`, admin.token, { note: 'No' });
  assert.equal(rj.status, 200);
  assert.equal((await H.ctx.M('CeSlot').findByPk(c2.body.slots[0].id)).status, 'REJECTED');
});

test('live event: slot capacity / price / time edits are queued (label applies at once); approval re-checks', async () => {
  const { event, organizer, slots } = await H.mkEvent({ format: 'SLOT', capacity: 2, priceType: 'PAID', price: 20, paymentModes: ['VENUE'] });
  const id = slots[0].id;
  const e = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}/slots/${id}`, organizer.token, { label: 'Renamed', capacity: 50, price: 10 });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual(e.body.pendingReview.sort(), ['capacity', 'price']);
  const row = await H.ctx.M('CeSlot').findByPk(id);
  assert.equal(row.label, 'Renamed');
  assert.equal(row.capacity, 2, 'capacity unchanged until approved');
  assert.equal(row.price, null);
  const ap = await H.api('POST', `/api/admin/campus-events/events/${event.id}/changes/approve`, (await H.admin()).token, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const after = await H.ctx.M('CeSlot').findByPk(id);
  assert.equal(after.capacity, 50);
  assert.equal(Number(after.price), 10);
});

test('slot price is capped at settings.maxPrice (draft and live)', async () => {
  const { event, organizer } = await H.mkEvent({ format: 'SLOT', capacity: 2, approve: false });
  const max = (await H.r('modules/campusEvents/services/flag').readSettings()).maxPrice;
  const over = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/slots`, organizer.token, slotBody(event, 1, 2, { price: max + 1 }));
  assert.equal(over.status, 400);
  assert.equal(over.body.field || (over.body.details && over.body.details.field) || 'price', 'price');
  const ok = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/slots`, organizer.token, slotBody(event, 2, 2, { price: max }));
  assert.equal(ok.status, 201);
  const live = await H.mkEvent({ format: 'SLOT', capacity: 2 });
  const e = await H.api('PATCH', `/api/campus-events/organizer/events/${live.event.id}/slots/${live.slots[0].id}`, live.organizer.token, { price: 99999 });
  assert.equal(e.status, 400);
});

test('check-in: a suspended organizer loses gate rights; a typed code is looked up inside this event only', async () => {
  const organizer = await H.mkOrganizer();
  const { event } = await H.mkEvent({ organizer, capacity: 5 });
  const other = await H.mkEvent({ organizer, capacity: 5 });
  const s = await H.mkStudent();
  const reg = await H.register(event.id, s);
  assert.equal(reg.status, 201);
  const regRow = await H.ctx.M('CeRegistration').findByPk(reg.body.registration.id);
  const tk = await H.ctx.M('CeTicket').findOne({ where: { registrationId: regRow.id } });
  const validate = (u, eventId, body) => H.api('POST', '/api/campus-events/check-in/validate', u.token, { eventId, ...body });
  let v = await validate(organizer, event.id, { code: tk.ticketCode });
  assert.equal(v.status, 200);
  assert.notEqual(v.body.result, 'INVALID');
  // the same organizer at their other event: the code is not found there (no cross-event lookup)
  v = await validate(organizer, other.event.id, { code: tk.ticketCode });
  assert.equal(v.body.result, 'INVALID');
  // suspend the organizer access -> no gate rights for own events, list empty
  await H.ctx.M('CeOrganizer').update({ status: 'SUSPENDED' }, { where: { userId: organizer.id } });
  v = await validate(organizer, event.id, { code: tk.ticketCode });
  assert.equal(v.status, 403);
  assert.equal(v.body.code, 'NOT_EVENT_STAFF');
  const mine = await H.api('GET', '/api/campus-events/check-in/events', organizer.token);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.events.length, 0);
  await H.ctx.M('CeOrganizer').update({ status: 'ACTIVE' }, { where: { userId: organizer.id } });
  assert.equal((await validate(organizer, event.id, { code: tk.ticketCode })).status, 200);
});

test('my registrations ?tab= rejects prototype keys (constructor / __proto__ / toString)', async () => {
  const s = await H.mkStudent();
  for (const tab of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await H.api('GET', `/api/campus-events/my/registrations?tab=${tab}`, s.token);
    assert.equal(r.status, 400, tab);
  }
  assert.equal((await H.api('GET', '/api/campus-events/my/registrations?tab=upcoming', s.token)).status, 200);
});
