// Commission snapshot: taken from the store's rate when the order is created, never recomputed — a rate
// change does not touch existing orders, settlement and the finance report use the snapshot; the one-time
// backfill snapshots unsettled pre-C6 orders with the CURRENT rate, skips settled ones, and is a no-op later.
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

test('snapshot at creation; changing the store rate leaves existing orders unchanged; new orders use the new rate', async () => {
  const { store, item } = await H.mkStore({ price: 250, rate: 10 });
  const u = await H.mkUser();
  const o1 = await H.placeOrder({ item, user: u });
  let row = await H.ctx.M('Order').findByPk(o1.id);
  assert.equal(row.commissionRate, 10);
  assert.equal(row.commissionType, 'percentage');
  assert.equal(row.commissionAmountPaise, 2500);
  assert.equal(row.storeNetPaise, 22500);
  assert.equal(row.commissionSource, 'order');
  assert.ok(!('commissionAmountPaise' in o1), 'customer reply hides the snapshot');

  await H.ctx.M('Restaurant').update({ commissionRate: 20 }, { where: { id: store.id } });
  const o2 = await H.placeOrder({ item, user: u });
  row = await H.ctx.M('Order').findByPk(o1.id);
  assert.equal(row.commissionAmountPaise, 2500, 'old order keeps 10%');
  assert.equal((await H.ctx.M('Order').findByPk(o2.id)).commissionAmountPaise, 5000, 'new order at 20%');

  // Both delivered: the payout list and a statement use the snapshots (2500 + 5000), not 20% of both.
  await H.ctx.M('Order').update({ status: 'Delivered', deliveredAt: new Date() }, { where: { id: [o1.id, o2.id] } });
  const list = await api('GET', '/api/admin/finance/payouts', admin.token);
  const mine = list.body.find((x) => x.restaurantId === store.id);
  assert.equal(mine.commissionPaise, 7500);
  assert.equal(mine.grossPaise, 50000);
  assert.equal(mine.netPaise, 42500);
  const prev = await api('GET', `/api/admin/payouts/preview?partnerType=restaurant&partnerId=${store.id}`, admin.token);
  assert.equal(prev.body.commissionPaise, 7500);
  // Finance report too.
  const fin = await api('GET', '/api/admin/finance?limit=200', admin.token);
  const txs = fin.body.transactions.filter((t) => [o1.id, o2.id].includes(t._id));
  assert.deepEqual(txs.map((t) => t.commissionPaise).sort(), [2500, 5000]);
  assert.ok(txs.every((t) => t.commissionEstimated === false));
});

test('flat commission: min(rate, subtotal)', () => {
  const { computeCommission } = H.r('utils/commission');
  assert.deepEqual(computeCommission({ subtotal: 100, rate: 15, type: 'flat' }), { commissionRate: 15, commissionType: 'flat', grossPaise: 10000, commissionAmountPaise: 1500, storeNetPaise: 8500 });
  assert.equal(computeCommission({ subtotal: 10, rate: 15, type: 'flat' }).commissionAmountPaise, 1000);
  assert.equal(computeCommission({ subtotal: 99.99, rate: 12.5, type: 'percentage' }).commissionAmountPaise, 1250); // 1249.875 -> 1250
  assert.equal(computeCommission({ subtotal: 100, rate: null }).commissionAmountPaise, 0);
});

test('backfill: unsettled pre-C6 orders get the CURRENT rate once (count logged), settled / cancelled are skipped, re-run is a no-op', async () => {
  const { store } = await H.mkStore({ rate: 8 });
  const u = await H.mkUser();
  const mk = (extra) => H.ctx.M('Order').create({ userId: u.id, restaurantId: store.id, items: [], totalPrice: 200, deliveryFee: 30, finalPrice: 230, paymentMethod: 'COD', status: 'Delivered', deliveredAt: new Date(), ...extra });
  const unsettled = await mk({ payoutSettled: false });
  const active = await mk({ status: 'Preparing', deliveredAt: null });
  const settled = await mk({ payoutSettled: true });
  const cancelled = await mk({ status: 'Cancelled', deliveredAt: null });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  let r1;
  try { r1 = await H.r('utils/financeMigrations').runFinanceMigrations(H.ctx.sequelize); } finally { console.log = origLog; }
  assert.ok(r1.commission.updated >= 2, JSON.stringify(r1));
  assert.ok(logs.some((l) => /C6_COMMISSION_BACKFILL\] Commission snapshot taken .* for \d+ unsettled order/.test(l)), logs.join('\n'));
  const get = async (o) => H.ctx.M('Order').findByPk(o.id);
  assert.equal((await get(unsettled)).commissionAmountPaise, 1600);
  assert.equal((await get(unsettled)).commissionSource, 'backfill');
  assert.equal((await get(active)).commissionAmountPaise, 1600);
  assert.equal((await get(settled)).commissionAmountPaise, null);
  assert.equal((await get(cancelled)).commissionAmountPaise, null);
  const marker = await H.ctx.M('GlobalConfig').findOne({ where: { key: 'C6_COMMISSION_BACKFILL' } });
  assert.ok(marker);
  // Rate change + re-run: nothing changes any more.
  await H.ctx.M('Restaurant').update({ commissionRate: 30 }, { where: { id: store.id } });
  const r2 = await H.r('utils/financeMigrations').runFinanceMigrations(H.ctx.sequelize);
  assert.equal(r2.commission.updated, 0);
  assert.equal((await get(unsettled)).commissionAmountPaise, 1600);
});
