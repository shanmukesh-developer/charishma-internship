// Reconciliation (read-only): clean ledger -> ok; a delivered COD order without its COD_COLLECTED row is
// reported (and only an admin action records it); a tampered cashHeldPaise is a mismatch; the daily job
// alerts the admins and is registered as a single-runner job; metrics expose the last run.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin', fcmTokens: ['admin-device-token-c6'] });
});
after(H.teardown);

const check = () => api('GET', '/api/admin/rider-cash/reconcile', admin.token);

test('clean ledger: ok', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const d = await H.mkRider();
  const { res } = await H.fullDelivery({ item, user: await H.mkUser(), rider: d });
  assert.equal(res.status, 200);
  const r = await check();
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(r.body.ordersChecked >= 1);
});

test('missing COD row detected (never auto-fixed); admin "record" fixes it once; tampered balance is a mismatch', async () => {
  const { store } = await H.mkStore();
  const u = await H.mkUser();
  const d = await H.mkRider();
  // A COD order delivered after the ledger start without a cash row (e.g. by an old process during a deploy).
  const o = await H.ctx.M('Order').create({ userId: u.id, restaurantId: store.id, items: [], totalPrice: 100, deliveryFee: 30, finalPrice: 130, paymentMethod: 'COD', paymentStatus: 'Completed', status: 'Delivered', deliveryPartnerId: d.id, deliveredAt: new Date(), fulfilment: 'ZENVY' });
  let r = await check();
  assert.equal(r.body.ok, false);
  assert.equal(r.body.counts.missingRows, 1);
  assert.equal(r.body.missingRows[0].orderId, o.id);
  assert.equal(r.body.missingRows[0].expectedPaise, 13000);
  assert.equal((await H.cashRows(d.id)).length, 0, 'reconcile never writes');
  // Job: alerts admins (push + socket), counts it.
  const before = H.ctx.pushes.length;
  const job = await H.r('utils/riderCash').runReconcileJob({ io: null });
  assert.equal(job.problems, 1);
  assert.ok(H.ctx.pushes.slice(before).some((p) => /Rider cash check/.test(p.title) && p.tokens.includes('admin-device-token-c6')));
  assert.ok(H.r('utils/riderCash').reconcileStatus().alertsSent >= 1);
  // Admin records it (reason required); twice = still one row.
  assert.equal((await api('POST', `/api/admin/rider-cash/orders/${o.id}/record`, admin.token, {})).status, 400);
  for (let i = 0; i < 2; i++) {
    const f = await api('POST', `/api/admin/rider-cash/orders/${o.id}/record`, admin.token, { reason: 'Rider confirmed the cash' });
    assert.equal(f.status, 200, JSON.stringify(f.body));
  }
  assert.equal((await H.cashRows(d.id)).length, 1);
  r = await check();
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  // Tamper the balance outside the ledger: mismatch.
  await H.ctx.M('DeliveryPartner').update({ cashHeldPaise: 99 }, { where: { id: d.id } });
  r = await check();
  assert.equal(r.body.counts.mismatches, 1);
  assert.equal(r.body.mismatches[0].riderId, d.id);
  assert.equal(r.body.mismatches[0].differencePaise, 99 - 13000);
  await H.ctx.M('DeliveryPartner').update({ cashHeldPaise: 13000 }, { where: { id: d.id } });
  // A cash row for a prepaid order is reported as wrong.
  const pre = await H.ctx.M('Order').create({ userId: u.id, restaurantId: store.id, items: [], totalPrice: 50, deliveryFee: 30, finalPrice: 80, paymentMethod: 'Wallet', paymentStatus: 'Completed', status: 'Delivered', deliveryPartnerId: d.id, deliveredAt: new Date() });
  await H.ctx.sequelize.transaction((t) => H.r('utils/riderCash').applyCashChange({ t, riderId: d.id, amountPaise: 8000, type: 'COD_COLLECTED', orderId: pre.id }));
  r = await check();
  assert.equal(r.body.counts.wrongRows, 1);
  assert.equal(r.body.wrongRows[0].notACodDelivery, true);
  // The admin "record" endpoint refuses a prepaid order.
  assert.equal((await api('POST', `/api/admin/rider-cash/orders/${pre.id}/record`, admin.token, { reason: 'Should not work' })).body.code, 'NOT_A_COD_DELIVERY');
});

test('job registry: riderCash.reconcile is a daily single-runner job; metrics expose its state', async () => {
  const jobs = H.r('jobs/index.js');
  const names = typeof jobs.listJobs === 'function' ? jobs.listJobs().map((j) => (typeof j === 'string' ? j : j.name)) : [];
  assert.ok(names.includes('riderCash.reconcile'), names.join(','));
  const m = await api('GET', '/api/admin/metrics/perf', admin.token);
  assert.equal(m.status, 200);
  assert.ok(m.body.riderCash && typeof m.body.riderCash.runs === 'number');
});
