// Orders per delivery slot (owner, 30 Oct 2026, launch audit: 100 orders with 1 rider were cancelled at slot time).
// GlobalConfig SLOT_MAX_ORDERS (0 = no limit), set from Admin > Config: a slot holding that many orders (any status
// but Cancelled) shows "Full: please pick another slot" (open: false, closedReason 'full'), the default moves to the
// next open slot, an order for the full slot is refused with 409 SLOT_CLOSED + the open slots, a cancelled order frees
// its place, and 0 turns the limit off.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers');

const { H, S, IST, setNow } = T;
let admin;
before(async () => { await T.setup(); admin = await H.mkUser({ role: 'admin' }); });
after(T.teardown);
afterEach(async () => {
  setNow(null);
  await H.ctx.M('GlobalConfig').destroy({ where: { key: 'SLOT_MAX_ORDERS' } });
  await S.loadConfig({ fresh: true });
});

const quote = (user, item) => H.api('POST', '/api/orders/quote', user.token, H.orderBody(item.id, 'COD'));
const place = (user, item, slot) => H.api('POST', '/api/orders', user.token, H.orderBody(item.id, 'COD', { deliverySlot: slot }));
const setCap = (value) => H.api('POST', '/api/admin/config', admin.token, { key: 'SLOT_MAX_ORDERS', value });

test('admin setting: whole orders 0 to 500, anything else refused', async () => {
  for (const bad of [-1, 501, 2.5, 'ten', '']) {
    const r = await setCap(bad);
    assert.equal(r.status, 400, `value ${JSON.stringify(bad)}: ${JSON.stringify(r.body)}`);
  }
  const ok = await setCap(12);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.value, 12);
  assert.equal(S.maxOrdersPerSlot(), 12, 'the cache is refreshed at once');
});

test('a full slot shows Full, refuses orders with the open slots, and frees a place when an order is cancelled', async () => {
  setNow(IST('2026-10-27T09:00:00'));
  assert.equal((await setCap(2)).status, 200);
  const { item } = await T.mkStore({ name: 'Capacity Biryani' });
  const [a, b, c] = [await H.mkUser(), await H.mkUser(), await H.mkUser()];
  const s1 = '2026-10-27|S1';

  const first = await place(a, item, s1);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const q1 = await quote(c, item);
  assert.equal(q1.body.deliverySlots.slots.find((s) => s.id === s1).open, true, 'one order of two: still open');
  const second = await place(b, item, s1);
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const q2 = await quote(c, item);
  assert.equal(q2.status, 200, JSON.stringify(q2.body));
  const full = q2.body.deliverySlots.slots.find((s) => s.id === s1);
  assert.equal(full.open, false);
  assert.equal(full.closedReason, 'full');
  assert.equal(full.closedText, 'Full: please pick another slot');
  assert.equal(q2.body.deliverySlots.defaultSlotId, '2026-10-27|S2', 'the default moves to the next open slot');

  const third = await place(c, item, s1);
  assert.equal(third.status, 409, JSON.stringify(third.body));
  assert.equal(third.body.code, 'SLOT_CLOSED');
  assert.match(third.body.message, /is full\. The next open slot is/);
  assert.ok(third.body.slots.every((s) => s.open && s.id !== s1), 'only open slots are offered');
  const next = await place(c, item, '2026-10-27|S2');
  assert.equal(next.status, 201, 'the next slot takes the order');

  await H.ctx.M('Order').update({ status: 'Cancelled' }, { where: { id: first.body.id } });
  const q3 = await quote(c, item);
  assert.equal(q3.body.deliverySlots.slots.find((s) => s.id === s1).open, true, 'a cancelled order frees its place');
});

test('every slot full: the quote says so plainly', async () => {
  setNow(IST('2026-10-27T21:40:00')); // only tomorrow's three slots are bookable
  assert.equal((await setCap(1)).status, 200);
  const { item } = await T.mkStore({ name: 'Capacity Dosa' });
  for (const slot of ['2026-10-28|S1', '2026-10-28|S2', '2026-10-28|S3']) {
    const r = await place(await H.mkUser(), item, slot);
    assert.equal(r.status, 201, `${slot}: ${JSON.stringify(r.body)}`);
  }
  const q = await quote(await H.mkUser(), item);
  assert.equal(q.status, 400, JSON.stringify(q.body));
  assert.match(q.body.message, /delivery slots are full/);
});

test('no limit (0): slots never fill', async () => {
  setNow(IST('2026-10-27T09:00:00'));
  assert.equal((await setCap(0)).status, 200);
  assert.equal(S.maxOrdersPerSlot(), 0);
  const { item } = await T.mkStore({ name: 'Capacity Thali' });
  for (let i = 0; i < 3; i++) assert.equal((await place(await H.mkUser(), item, '2026-10-27|S1')).status, 201);
  const q = await quote(await H.mkUser(), item);
  assert.equal(q.body.deliverySlots.slots.find((s) => s.id === '2026-10-27|S1').open, true);
});
