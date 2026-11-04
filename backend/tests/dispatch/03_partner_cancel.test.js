// Service pickups (27 Oct 2026 transaction audit): the rider holding a pickup never cancels the student's booking.
// Before collecting it they hand it back to the pool (POST /:id/release); after collecting it (IN_PROGRESS /
// READY_FOR_DELIVERY) they have the student's things and must return them. The student (before collection) and
// ZCS support still cancel as before.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('./helpers');

const { H } = D;
before(async () => { await D.setup(); });
after(async () => { await D.settle(1200); await D.teardown(); });
beforeEach(() => D.reset());

const claimed = async () => {
  const rider = await D.mkRider();
  const cust = await D.mkCustomer();
  const { item } = await D.mkServiceItem('LAUNDRY');
  const id = (await D.bookLaundry(cust, item)).body.booking.id;
  assert.equal((await D.api('POST', `/api/services/${id}/claim`, rider.token)).status, 200);
  return { rider, cust, id };
};

test('a rider cannot cancel a pickup before collecting it: 403, the booking stays open; release still works', async () => {
  const { rider, id } = await claimed();
  const r = await D.api('PATCH', `/api/services/${id}/status`, rider.token, { status: 'CANCELLED' });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'PARTNER_CANNOT_CANCEL');
  const row = await H.ctx.M('ServiceBooking').findByPk(id);
  assert.equal(row.status, 'REQUESTED');
  assert.equal(row.assignedPartnerId, rider.id);
  assert.equal((await D.api('POST', `/api/services/${id}/release`, rider.token)).status, 200);
  assert.equal((await H.ctx.M('ServiceBooking').findByPk(id)).assignedPartnerId, null);
});

test('a rider holding the student items cannot cancel: 403 PARTNER_CANNOT_CANCEL_COLLECTED (collected and ready)', async () => {
  const { rider, id } = await claimed();
  assert.equal((await D.api('PATCH', `/api/services/${id}/status`, rider.token, { status: 'IN_PROGRESS' })).status, 200);
  for (const at of ['IN_PROGRESS', 'READY_FOR_DELIVERY']) {
    if (at === 'READY_FOR_DELIVERY') assert.equal((await D.api('PATCH', `/api/services/${id}/status`, rider.token, { status: at })).status, 200);
    const r = await D.api('PATCH', `/api/services/${id}/status`, rider.token, { status: 'CANCELLED', note: 'not doing it' });
    assert.equal(r.status, 403, `${at}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'PARTNER_CANNOT_CANCEL_COLLECTED');
    assert.equal((await H.ctx.M('ServiceBooking').findByPk(id)).status, at);
  }
  // The rider can still finish the job.
  assert.equal((await D.api('PATCH', `/api/services/${id}/status`, rider.token, { status: 'COMPLETED' })).status, 200);
});

test('ZenWe support still cancels a collected pickup; the student still cancels before collection', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const a = await claimed();
  assert.equal((await D.api('PATCH', `/api/services/${a.id}/status`, a.rider.token, { status: 'IN_PROGRESS' })).status, 200);
  const s = await D.api('PATCH', `/api/services/${a.id}/status`, admin.token, { status: 'CANCELLED', note: 'Support: shop closed' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.booking.status, 'CANCELLED');

  const b = await claimed();
  const c = await D.api('POST', `/api/services/${b.id}/cancel`, b.cust.token, {});
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await H.ctx.M('ServiceBooking').findByPk(b.id)).status, 'CANCELLED');
});
