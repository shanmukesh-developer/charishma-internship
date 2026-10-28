// Pure slot rules (utils/deliverySlots): the table, cutoffs per item type, mixed baskets, IST day boundaries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DELIVERY_SLOTS = 'on';
const S = require(path.join(__dirname, '..', '..', 'utils', 'deliverySlots'));

const IST = (s) => new Date(`${s}+05:30`);
const at = (s, lead = 60) => S.availableSlots(IST(s), lead);
const openIds = (list) => list.filter((x) => x.open).map((x) => x.id);

test('the three slots, IST, with plain labels', () => {
  const list = at('2026-10-27T08:00:00');
  assert.equal(list.length, 6);
  assert.deepEqual(list.map((x) => x.label), [
    'Today 12:30–1:00 PM', 'Today 4:30–5:30 PM', 'Today 8:30–9:30 PM',
    'Tomorrow 12:30–1:00 PM', 'Tomorrow 4:30–5:30 PM', 'Tomorrow 8:30–9:30 PM',
  ]);
  assert.equal(list[0].id, '2026-10-27|S1');
  assert.equal(list[0].startISO, '2026-10-27T07:00:00.000Z');
  assert.equal(list[0].endISO, '2026-10-27T07:30:00.000Z');
  assert.equal(list[1].endISO, '2026-10-27T12:00:00.000Z');
  assert.equal(list[2].startISO, '2026-10-27T15:00:00.000Z');
  assert.equal(list[3].id, '2026-10-28|S1');
  assert.equal(list[3].deliveryLabel, 'Wed 28 Oct, 12:30–1:00 PM');
  assert.equal(list[0].deliveryLabel, 'Tue 27 Oct, 12:30–1:00 PM');
});

test('standard (food / store / vendor / list) cutoff is 1 hour before the start: 11:30, 3:30 PM, 7:30 PM', () => {
  assert.deepEqual(openIds(at('2026-10-27T11:29:59')).slice(0, 1), ['2026-10-27|S1']);
  const after = at('2026-10-27T11:30:00');
  assert.equal(after[0].open, false);
  assert.equal(after[0].closedText, 'Closed at 11:30 AM');
  assert.equal(at('2026-10-27T15:29:00')[1].open, true);
  assert.equal(at('2026-10-27T15:30:00')[1].closedText, 'Closed at 3:30 PM');
  assert.equal(at('2026-10-27T19:29:00')[2].open, true);
  assert.equal(at('2026-10-27T19:30:00')[2].closedText, 'Closed at 7:30 PM');
  for (const type of ['food', 'store', 'grocery', 'vendor', 'list', 'anything-else', undefined]) assert.equal(S.leadForType(type).leadMinutes, 60, String(type));
});

test('normal cakes: 2 hours (keyword rule), specialized cakes: 2½ hours (MenuItem flag)', () => {
  for (const name of ['Chocolate Cake', 'Black Forest Pastry', 'Walnut Brownie', 'Red Velvet Cupcake', 'Blueberry Cheesecake', 'Gateau', 'Truffle Delight']) {
    const l = S.leadForItems([{ name }]);
    assert.equal(l.leadMinutes, 120, name);
    assert.equal(l.reason, 'Cakes need 2 hours');
  }
  // tags / category count like pricingSchema.detectProductType
  assert.equal(S.leadMinutesForItems([{ name: 'Birthday Special', tags: ['cake'] }]), 120);
  assert.equal(S.leadMinutesForItems([{ name: 'Birthday Special', tags: '["cake"]' }]), 120);
  assert.equal(S.leadMinutesForItems([{ name: 'Birthday Special', category: 'Cakes' }]), 120);
  const sp = S.leadForItems([{ name: 'Photo Print Designer', isSpecializedCake: true }]);
  assert.equal(sp.leadMinutes, 150);
  assert.equal(sp.reason, 'This cake needs 2½ hours');
  assert.equal(S.leadMinutesForItems([{ name: 'Veg Biryani' }, { name: 'Masala Chai' }]), 60);
  assert.equal(S.leadForItems([{ name: 'Veg Biryani' }]).reason, null);
  // cake cutoffs for S1 (12:30): 10:30 and 10:00
  assert.equal(at('2026-10-27T10:29:00', 120)[0].open, true);
  assert.equal(at('2026-10-27T10:30:00', 120)[0].closedText, 'Closed at 10:30 AM');
  assert.equal(at('2026-10-27T09:59:00', 150)[0].open, true);
  assert.equal(at('2026-10-27T10:00:00', 150)[0].closedText, 'Closed at 10:00 AM');
  // S3 (8:30 PM): cake 6:30 PM, specialized 6:00 PM
  assert.equal(at('2026-10-27T18:30:00', 120)[2].closedText, 'Closed at 6:30 PM');
  assert.equal(at('2026-10-27T17:59:00', 150)[2].open, true);
  assert.equal(S.leadForType('cake').leadMinutes, 120);
  assert.equal(S.leadForType('specialized_cake').leadMinutes, 150);
});

test('a mixed basket takes the longest lead', () => {
  assert.equal(S.leadMinutesForItems([{ name: 'Burger' }, { name: 'Choco Lava Cake' }]), 120);
  assert.equal(S.leadMinutesForItems([{ name: 'Burger' }, { name: 'Choco Lava Cake' }, { name: 'Custom Cake', isSpecializedCake: 1 }]), 150);
  assert.equal(S.leadMinutesForItems([]), 60);
});

test('tomorrow: all three slots always open, nothing beyond tomorrow', () => {
  for (const t of ['2026-10-27T00:00:00', '2026-10-27T13:00:00', '2026-10-27T21:45:00', '2026-10-27T23:59:59']) {
    for (const lead of [60, 120, 150]) {
      const list = at(t, lead);
      assert.equal(list.length, 6);
      assert.deepEqual(list.slice(3).map((x) => x.open), [true, true, true], `${t} lead ${lead}`);
      assert.ok(list.every((x) => x.date === '2026-10-27' || x.date === '2026-10-28'), t);
    }
  }
});

test('IST day boundary: 23:59 IST is still today (all closed), 00:00 IST rolls over to the new day', () => {
  const late = at('2026-10-27T23:59:00');
  assert.deepEqual(late.slice(0, 3).map((x) => x.open), [false, false, false]);
  assert.equal(late[3].id, '2026-10-28|S1');
  const midnight = at('2026-10-28T00:00:00');
  assert.equal(midnight[0].id, '2026-10-28|S1');
  assert.equal(midnight[0].label, 'Today 12:30–1:00 PM');
  assert.deepEqual(midnight.map((x) => x.open), [true, true, true, true, true, true]);
  assert.equal(midnight[3].id, '2026-10-29|S1');
  // The same instants in UTC: 18:29Z = 23:59 IST (27th), 18:30Z = 00:00 IST (28th). A UTC server clock
  // must not flip the day at UTC midnight (05:30 IST).
  assert.equal(S.availableSlots(new Date('2026-10-27T18:29:00Z'))[0].date, '2026-10-27');
  assert.equal(S.availableSlots(new Date('2026-10-27T18:30:00Z'))[0].date, '2026-10-28');
  assert.equal(S.availableSlots(new Date('2026-10-27T23:59:00Z'))[0].date, '2026-10-28'); // 05:29 IST
  assert.equal(S.availableSlots(new Date('2026-10-28T00:01:00Z'))[0].date, '2026-10-28'); // 05:31 IST
  // month / year rollover
  assert.equal(at('2026-10-31T22:00:00')[3].id, '2026-11-01|S1');
  assert.equal(at('2026-12-31T22:00:00')[3].id, '2027-01-01|S1');
  assert.equal(at('2026-12-31T22:00:00')[3].deliveryLabel, 'Fri 1 Jan, 12:30–1:00 PM');
});

test('after the last cutoff (7:30 PM) the earliest slot is tomorrow 12:30', () => {
  const info = S.slotsForOrder({ at: IST('2026-10-27T19:30:00') });
  assert.equal(info.defaultSlotId, '2026-10-28|S1');
  assert.equal(info.nextSlot.label, 'Tomorrow 12:30–1:00 PM');
});

test('resolveSlot: a pick, a closed pick, an unknown id, legacy ASAP / nothing', () => {
  const info = S.slotsForOrder({ at: IST('2026-10-27T12:00:00') });
  const ok = S.resolveSlot('2026-10-27|S2', info);
  assert.equal(ok.ok, true);
  assert.equal(ok.legacy, false);
  assert.deepEqual(S.slotColumns(ok.slot), { deliverySlot: 'Tue 27 Oct, 4:30–5:30 PM', slotStart: new Date('2026-10-27T11:00:00Z'), slotEnd: new Date('2026-10-27T12:00:00Z') });
  const closed = S.resolveSlot('2026-10-27|S1', info);
  assert.equal(closed.ok, false);
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, 'SLOT_CLOSED');
  assert.match(closed.body.message, /closed at 11:30 AM/);
  assert.match(closed.body.message, /next open slot is Today 4:30–5:30 PM/);
  assert.equal(closed.body.nextSlot.id, '2026-10-27|S2');
  assert.ok(closed.body.slots.every((x) => x.open));
  const far = S.resolveSlot('2026-10-29|S1', info); // beyond tomorrow
  assert.equal(far.ok, false);
  assert.equal(far.body.code, 'SLOT_CLOSED');
  for (const legacy of ['ASAP', '', undefined, null, 'Lunch']) {
    const r = S.resolveSlot(legacy, info);
    assert.equal(r.ok, true, String(legacy));
    assert.equal(r.legacy, true);
    assert.equal(r.slot.id, '2026-10-27|S2');
  }
});

test('store hours at the slot start: closed then -> that slot is closed, the rest stay open', () => {
  const store = { name: 'Evening Kitchen', isActive: true, operatingHours: { start: '16:00', end: '22:00' } };
  const info = S.slotsForOrder({ store, at: IST('2026-10-27T09:00:00') });
  assert.equal(info.slots[0].open, false);
  assert.equal(info.slots[0].closedReason, 'store_closed');
  assert.equal(info.slots[0].closedText, 'Evening Kitchen is closed then');
  assert.equal(info.slots[1].open, true);
  assert.equal(info.defaultSlotId, '2026-10-27|S2');
  // Weekly hours: closed on Wednesdays -> tomorrow (Wed 28 Oct) has no open slot.
  const day = { open: true, start: '09:00', end: '22:00' };
  const weekly = { start: '09:00', end: '22:00', weekly: { mon: day, tue: day, wed: { open: false }, thu: day, fri: day, sat: day, sun: day } };
  const w = S.slotsForOrder({ store: { name: 'Mid-week Off', isActive: true, operatingHours: weekly }, at: IST('2026-10-27T22:30:00') });
  assert.deepEqual(w.slots.map((x) => x.open), [false, false, false, false, false, false]);
  assert.equal(w.nextSlot, null);
  // Off stores have no slot at all.
  assert.equal(S.slotsForOrder({ store: { name: 'Off', isActive: false }, at: IST('2026-10-27T09:00:00') }).nextSlot, null);
  assert.equal(S.slotsForOrder({ store: { name: 'Switched off', isActive: true, isOpenNow: false }, at: IST('2026-10-27T09:00:00') }).nextSlot, null);
});

test('dispatch window: riders see a slot order from 6 hours before the start (same-day orders at once)', () => {
  assert.equal(S.DISPATCH_WINDOW_MIN, 360);
  const order = { slotStart: new Date('2026-10-27T07:00:00Z') }; // 12:30 IST
  assert.equal(S.isDispatchDue(order, IST('2026-10-27T06:29:59')), false);
  assert.equal(S.isDispatchDue(order, IST('2026-10-27T06:30:00')), true);
  assert.equal(S.dispatchOpensAt(order).toISOString(), '2026-10-27T01:00:00.000Z');
  assert.equal(S.isDispatchDue({ slotStart: null }, IST('2026-10-27T03:00:00')), true); // older rows: at once
});

test('store-accept clock: from an hour before the slot, or when placed if later', () => {
  const slotStart = new Date('2026-10-28T07:00:00Z'); // tomorrow 12:30 IST
  const night = { createdAt: IST('2026-10-27T22:30:00'), slotStart };
  assert.equal(new Date(S.acceptAnchorMs(night)).toISOString(), '2026-10-28T06:00:00.000Z'); // 11:30 IST
  const late = { createdAt: IST('2026-10-28T11:40:00'), slotStart }; // placed after 11:30 (e.g. kill switch flipped)
  assert.equal(new Date(S.acceptAnchorMs(late)).getTime(), late.createdAt.getTime());
  assert.equal(S.acceptAnchorMs({ createdAt: IST('2026-10-28T11:29:00') }), IST('2026-10-28T11:29:00').getTime());
});

test('GlobalConfig override table is validated (bad tables keep the defaults)', () => {
  assert.deepEqual(S.normalizeTable([{ id: 's1', start: '9:00', end: '09:30' }]), [{ id: 'S1', start: '09:00', end: '09:30' }]);
  assert.equal(S.normalizeTable([{ id: 'S1', start: '13:00', end: '12:00' }]), null);
  assert.equal(S.normalizeTable([{ id: 'S1', start: '12:00', end: '13:00' }, { id: 'S2', start: '12:30', end: '14:00' }]), null);
  assert.equal(S.normalizeTable([]), null);
  assert.equal(S.normalizeTable('x'), null);
});

test('kill switch: DELIVERY_SLOTS=off turns slots off', () => {
  process.env.DELIVERY_SLOTS = 'off';
  try {
    assert.equal(S.slotsEnabled(), false);
  } finally {
    process.env.DELIVERY_SLOTS = 'on';
  }
  assert.equal(S.slotsEnabled(), true);
});
