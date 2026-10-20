// GET /api/admin/attention-counts: the overview's "Needs attention" queues. Keeps the original keys,
// adds rider sign-ups waiting for approval (not deactivated riders) and payouts waiting to be paid,
// returns null for queues whose module is not loaded, and is admin-only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

const counts = () => api('GET', '/api/admin/attention-counts', admin.token);

test('original keys are still present', async () => {
  const r = await counts();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const k of ['tickets', 'verifications', 'pgBookings', 'wallPending', 'serviceRequests', 'stuckStallOrders', 'stuckStallHours']) {
    assert.ok(k in r.body, k);
  }
});

test('rider approvals count new sign-ups only, not deactivated riders', async () => {
  const before0 = (await counts()).body.riderApprovals;
  const DP = H.ctx.M('DeliveryPartner');
  await DP.create({ name: 'Waiting rider', phone: '8123400001', password: 'x-test-only-pw-1', isApproved: false });
  await DP.create({ name: 'Deactivated rider', phone: '8123400002', password: 'x-test-only-pw-2', isApproved: false, suspendedAt: new Date() });
  await DP.create({ name: 'Approved rider', phone: '8123400003', password: 'x-test-only-pw-3', isApproved: true });
  const r = await counts();
  assert.equal(r.body.riderApprovals, (before0 || 0) + 1);
});

test('payouts waiting to be paid are counted', async () => {
  const r0 = await counts();
  assert.equal(typeof r0.body.payoutsPending, 'number');
  const { store } = await H.mkStore();
  await H.ctx.M('Payout').create({
    partnerType: 'restaurant', partnerId: store.id, periodStart: new Date(Date.now() - 7 * 864e5), periodEnd: new Date(),
    orderCount: 1, grossPaise: 10000, commissionPaise: 1000, adjustmentsPaise: 0, netPaise: 9000, status: 'PENDING',
  }).catch((e) => { throw new Error(`payout fixture: ${e.message}`); });
  const r = await counts();
  assert.equal(r.body.payoutsPending, r0.body.payoutsPending + 1);
});

test('queues of modules that are not loaded are null, not errors', async () => {
  const r = await counts();
  for (const k of ['autoDrivers', 'autoVehicles', 'eventsToReview', 'rentalListings', 'rentalLicences', 'rentalReports', 'rentalDisputes', 'friendsReports', 'friendsAppeals']) {
    assert.ok(k in r.body, k);
    assert.ok(r.body[k] === null || typeof r.body[k] === 'number', k);
  }
});

test('customers cannot read the counts', async () => {
  const u = await H.mkUser();
  const r = await api('GET', '/api/admin/attention-counts', u.token);
  assert.ok(r.status === 401 || r.status === 403, String(r.status));
});
