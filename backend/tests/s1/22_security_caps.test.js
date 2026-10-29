// 29 Oct 2026 security pass, abuse caps:
//  • a student has at most 8 service bookings in progress (each one reaches every on-duty rider);
//  • the generic uploads (POST /api/upload, POST /api/services/documents) share a per-account hourly budget of
//    60 files / 150 MB (utils/uploadBudget); admins are exempt.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const book = (user, body) => H.api('POST', '/api/services/book', user.token, {
  pickupSlot: 'Tomorrow, 10 AM', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210', paymentMethod: 'COD', ...body,
});

test('at most 8 service bookings in progress per student', async () => {
  const store = await H.mkStore();
  await store.update({ vendorType: 'LAUNDRY' });
  const item = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'Wash & Fold (per kg)', price: 60, isAvailable: true, specs: { bookingOnly: true } });
  const u = await H.mkUser();
  const one = () => book(u, { serviceType: 'LAUNDRY', title: 'Wash & Fold (per kg)', specifications: { catalogueItemId: item.id, category: 'laundry', quantity: 1, unit: 'kg' } });
  const made = [];
  for (let i = 0; i < 8; i++) {
    const r = await one();
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    made.push(r.body.booking.id);
  }
  const ninth = await one();
  assert.deepStrictEqual([ninth.status, ninth.body.code], [409, 'TOO_MANY_OPEN']);
  // One finished: room for another.
  await H.ctx.M.ServiceBooking.update({ status: 'COMPLETED' }, { where: { id: made[0] } });
  assert.strictEqual((await one()).status, 201);
});

test('upload budget: 60 files or 150 MB an hour per account; admins exempt', () => {
  const budget = H.r('utils/uploadBudget');
  budget._reset();
  for (let i = 0; i < budget.MAX_FILES; i++) assert.strictEqual(budget.take('user-a', 1000), null);
  const over = budget.take('user-a', 1000);
  assert.ok(over && over.retryAfter >= 60, JSON.stringify(over));
  assert.strictEqual(budget.take('user-b', budget.MAX_BYTES), null);
  assert.ok(budget.take('user-b', 1), 'bytes cap reached');
  for (let i = 0; i < budget.MAX_FILES + 5; i++) assert.strictEqual(budget.take('admin-a', 1000, { exempt: true }), null);
  budget._reset();
});

test('POST /api/services/documents answers 429 UPLOAD_LIMIT once the hourly budget is used', async () => {
  const budget = H.r('utils/uploadBudget');
  budget._reset();
  const u = await H.mkUser();
  for (let i = 0; i < budget.MAX_FILES; i++) budget.take(u.id, 100);
  const form = new FormData();
  form.append('document', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')], { type: 'application/pdf' }), 'Notes.pdf');
  const res = await fetch(`${H.ctx.base}/api/services/documents`, { method: 'POST', headers: { authorization: `Bearer ${u.token}` }, body: form });
  const body = await res.json();
  assert.deepStrictEqual([res.status, body.code], [429, 'UPLOAD_LIMIT']);
  assert.ok(Number(res.headers.get('retry-after')) >= 60);
  budget._reset();
});
