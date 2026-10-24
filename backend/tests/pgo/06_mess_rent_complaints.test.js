// Mess timetable + holidays (shown to students), building info, the rent ledger (a record only; no money
// moves) and tenant complaints with owner replies.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let pg; let room; let owner; let tenant; let tenantBooking;
const ymd = (days) => new Date(Date.now() + 330 * 60 * 1000 + days * 86400000).toISOString().slice(0, 10);
const month = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 7);

test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  pg = await H.mkPg(admin);
  room = await H.mkRoom(admin, pg.id, { totalBeds: 3, availableBeds: 3, pricePerBed: 7000 });
  owner = await H.readyOwner(admin, [pg.id]);
  tenant = await H.mkUser({ name: 'Anjali Rao' });
  // Moved in today: rent is due this month.
  const req = await H.api('POST', `/api/pg/${room.id}/book`, tenant.token, { checkInDate: ymd(0) });
  assert.strictEqual(req.status, 201, JSON.stringify(req.body));
  tenantBooking = req.body.booking;
  const acc = await H.api('POST', `/api/pg-owner/bookings/${tenantBooking.id}/accept`, owner.token, {});
  assert.strictEqual(acc.status, 200, JSON.stringify(acc.body));
});
test.after(H.teardown);

test('mess timetable with veg / non-veg menus and holidays reaches the customer detail', async () => {
  const messTimetable = {
    meals: [{ label: 'Breakfast', start: '07:30', end: '09:30' }, { label: 'Dinner', start: '19:30', end: '21:30' }],
    days: { mon: { breakfast: { menu: 'Idli, sambar', tag: 'veg' }, dinner: { menu: 'Chicken curry, rice', tag: 'nonveg' } } },
    notes: 'Sunday special lunch',
    holidays: [{ date: ymd(5), meals: [], note: 'Sankranti' }, { date: ymd(-3), meals: ['dinner'], note: 'Old' }],
  };
  const save = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/mess`, owner.token, { messTimetable });
  assert.strictEqual(save.status, 200, JSON.stringify(save.body));
  assert.strictEqual(save.body.listing.messTimetable.holidays.length, 2, 'owner sees every holiday');
  const pub = await H.api('GET', `/api/pg/${pg.id}`);
  const m = pub.body.messTimetable;
  assert.deepStrictEqual(m.meals.map((x) => x.key), ['breakfast', 'dinner']);
  assert.strictEqual(m.days.mon.dinner.tag, 'nonveg');
  assert.deepStrictEqual(m.holidays, [{ date: ymd(5), meals: [], note: 'Sankranti' }], 'students see upcoming holidays only');

  const bad = [
    { meals: [{ label: 'Lunch' }], holidays: [{ date: '2026-02-31' }] },
    { meals: [{ label: 'Lunch' }], holidays: [{ date: ymd(1), meals: ['brunch'] }] },
    { meals: [{ label: 'Lunch' }], holidays: [{ date: ymd(1) }, { date: ymd(1) }] },
    { meals: [{ label: 'Lunch' }], holidays: [{ date: ymd(1), note: 'Call 98765 43210' }] },
    { meals: [{ label: 'Lunch' }], days: { mon: { lunch: { menu: 'Rice', tag: 'fish' } } } },
  ];
  for (const t of bad) {
    const r = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/mess`, owner.token, { messTimetable: t });
    assert.strictEqual(r.status, 400, JSON.stringify(t));
  }
  // An admin save of the timetable (no holidays field) keeps the owner's holidays.
  const adminSave = await H.api('PUT', `/api/pg/${pg.id}/mess`, admin.token, { messTimetable: { meals: messTimetable.meals, days: messTimetable.days, notes: '' } });
  assert.strictEqual(adminSave.status, 200, JSON.stringify(adminSave.body));
  assert.strictEqual(adminSave.body.messTimetable.holidays.length, 1);
});

test('building info: description, amenities and house rules; no phone numbers', async () => {
  const info = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/info`, owner.token, { description: 'Quiet rooms, 5 minutes from Gate 1.', amenities: ['Wi-Fi', 'wi-fi', 'Hot water'] });
  assert.strictEqual(info.status, 200, JSON.stringify(info.body));
  assert.deepStrictEqual(info.body.listing.amenities, ['Wi-Fi', 'Hot water']);
  const phone = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/info`, owner.token, { description: 'Call 9876543210 to book' });
  assert.strictEqual(phone.status, 400);
  assert.strictEqual(phone.body.code, 'PHONE_NOT_ALLOWED');
  const rules = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/house-rules`, owner.token, { houseRules: [{ category: 'gate', rules: ['Gate closes at 10 pm'] }] });
  assert.strictEqual(rules.status, 200, JSON.stringify(rules.body));
  const pub = await H.api('GET', `/api/pg/${pg.id}`);
  assert.strictEqual(pub.body.description, 'Quiet rooms, 5 minutes from Gate 1.');
  assert.deepStrictEqual(pub.body.houseRules.map((g) => g.category), ['gate']);
  assert.deepStrictEqual(pub.body.rules, ['Gate closes at 10 pm'], 'older app builds see the same rules');
});

test('photos: owner uploads public pg media and saves the gallery', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await H.api('POST', '/api/pg-owner/media', owner.token, { image: png });
  assert.strictEqual(up.status, 201, JSON.stringify(up.body));
  const save = await H.api('PUT', `/api/pg-owner/listings/${pg.id}/photos`, owner.token, { photos: [{ url: up.body.url, category: 'ROOM', caption: 'Twin room' }] });
  assert.strictEqual(save.status, 200, JSON.stringify(save.body));
  assert.strictEqual(save.body.listing.photos.length, 1);
  assert.strictEqual(save.body.listing.photos[0].isCover, true);
  const media = await H.ctx.M('CampusMedia').findByPk(up.body.id);
  assert.strictEqual(media.isPrivate, false);
  assert.strictEqual(media.purpose, 'pg');
});

test('rent ledger: mark received once, undo, mark again; due counts follow', async () => {
  const m = month();
  const before = await H.api('GET', `/api/pg-owner/rent?month=${m}`, owner.token);
  assert.strictEqual(before.status, 200, JSON.stringify(before.body));
  assert.strictEqual(before.body.summary.tenants, 1);
  assert.strictEqual(before.body.summary.due, 1);
  assert.strictEqual(before.body.rows[0].expected, 7000);

  const rec = await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: tenantBooking.id, month: m, method: 'upi' });
  assert.strictEqual(rec.status, 201, JSON.stringify(rec.body));
  assert.strictEqual(rec.body.record.amount, 7000, 'defaults to the room rent');
  const dup = await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: tenantBooking.id, month: m });
  assert.strictEqual(dup.status, 409);

  const after = await H.api('GET', `/api/pg-owner/rent?month=${m}`, owner.token);
  assert.strictEqual(after.body.summary.received, 1);
  assert.strictEqual(after.body.summary.amountReceived, 7000);
  assert.strictEqual(after.body.ledger[0].tenant.firstName, 'Anjali');
  const home = await H.api('GET', '/api/pg-owner/home', owner.token);
  assert.strictEqual(home.body.counts.rentDue, 0);

  const undo = await H.api('POST', `/api/pg-owner/rent/${rec.body.record.id}/void`, owner.token, { reason: 'Wrong month' });
  assert.strictEqual(undo.status, 200);
  assert.strictEqual((await H.api('GET', `/api/pg-owner/rent?month=${m}`, owner.token)).body.summary.due, 1);
  const again = await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: tenantBooking.id, month: m, amount: 6500, method: 'cash' });
  assert.strictEqual(again.status, 201, JSON.stringify(again.body));
  assert.strictEqual(again.body.record.amount, 6500);

  // Before move-in, far future, bad method, non-tenant: refused.
  const prev = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: tenantBooking.id, month: prev })).status, 400);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: tenantBooking.id, month: '2099-01' })).status, 400);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: tenantBooking.id, month: m, method: 'card' })).status, 400, 'unknown payment method');
  const pendingStudent = await H.mkUser();
  const pending = await H.book(pendingStudent, room.id);
  assert.strictEqual((await H.api('POST', '/api/pg-owner/rent', owner.token, { bookingId: pending.body.booking.id, month: m })).status, 409);
  assert.ok((await H.auditRows('PG_OWNER_RENT_RECORDED')).length >= 2);
});

test('complaints: only tenants can raise them; the owner replies and the student is notified', async () => {
  const outsider = await H.mkUser();
  const no = await H.api('POST', '/api/pg-tenant/complaints', outsider.token, { hostelId: pg.id, category: 'water', text: 'No hot water in the mornings.' });
  assert.strictEqual(no.status, 403);
  const short = await H.api('POST', '/api/pg-tenant/complaints', tenant.token, { hostelId: pg.id, category: 'water', text: 'bad' });
  assert.strictEqual(short.status, 400);
  const c = await H.api('POST', '/api/pg-tenant/complaints', tenant.token, { hostelId: pg.id, category: 'water', text: 'No hot water in the mornings this week.' });
  assert.strictEqual(c.status, 201, JSON.stringify(c.body));
  assert.ok((await H.notificationsFor(owner.id)).some((n) => n.type === 'PG_OWNER_COMPLAINT'));

  const list = await H.api('GET', '/api/pg-owner/complaints', owner.token);
  assert.strictEqual(list.body.counts.open, 1);
  assert.strictEqual(list.body.complaints[0].firstName, 'Anjali');
  assert.ok(!JSON.stringify(list.body).includes(tenant.phone));

  H.push.calls.length = 0;
  const reply = await H.api('POST', `/api/pg-owner/complaints/${c.body.complaint.id}/reply`, owner.token, { reply: 'Geyser fixed today.', status: 'RESOLVED' });
  assert.strictEqual(reply.status, 200, JSON.stringify(reply.body));
  assert.strictEqual(reply.body.complaint.status, 'RESOLVED');
  assert.ok(H.push.calls.some((p) => p.data.type === 'PG_COMPLAINT_REPLY' && p.recipients[0] === tenant.id));
  const mine = await H.api('GET', '/api/pg-tenant/complaints', tenant.token);
  assert.strictEqual(mine.body.complaints[0].ownerReply, 'Geyser fixed today.');
  assert.strictEqual((await H.api('GET', '/api/pg-owner/complaints', owner.token)).body.counts.open, 0);
});
