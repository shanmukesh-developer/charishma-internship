// One earnings rule (utils/riderEarnings): matches both pre-C6 views on fixtures (the rider app's
// riderPayout everywhere; the admin's raw SUM(deliveryFee) wherever the fee was > 0), the SQL form equals
// the JS form, and the rider app API, admin payout list and rider statement all report the same number.
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

// The two pre-C6 implementations, verbatim.
const oldRiderApp = (order) => (Number(order?.deliveryFee) > 0 ? Number(order.deliveryFee) : 30); // utils/riderDispatch.riderPayout
const oldAdminSum = (orders) => orders.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0); // adminController SUM(deliveryFee)

const FEES = [30, 45.5, 25, 0, 30, 12.35, 0];

test('earningPaise == old rider-app riderPayout for every fixture; == old admin sum where every fee > 0', () => {
  const E = H.r('utils/riderEarnings');
  for (const fee of FEES) assert.equal(E.earningRupees({ deliveryFee: fee }), oldRiderApp({ deliveryFee: fee }), `fee ${fee}`);
  const positive = FEES.filter((f) => f > 0).map((deliveryFee) => ({ deliveryFee }));
  assert.equal(E.sumEarningsPaise(positive), H.toPaise(oldAdminSum(positive)));
  // Where they differed (fee 0): the rider app's ₹30 is kept, documented in docs/C6_FINANCE.md.
  assert.equal(E.earningPaise({ deliveryFee: 0 }), 3000);
  assert.equal(E.earningPaise({ deliveryFee: null }), 3000);
  // Stall orders have no Zenvy rider.
  assert.equal(E.earningPaise({ deliveryFee: 0, fulfilment: 'VENDOR' }), 0);
  // utils/riderDispatch.riderPayout is now the same function.
  assert.equal(H.r('utils/riderDispatch').riderPayout({ deliveryFee: 45.5 }), 45.5);
});

test('rider app (today / history), admin payout list and rider statement agree; SQL form == JS form', async () => {
  const d = await H.mkRider();
  const { store } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const now = Date.now();
  const orders = [];
  for (const [i, fee] of FEES.entries()) {
    orders.push(await H.ctx.M('Order').create({
      userId: u.id, restaurantId: store.id, items: [], totalPrice: 100, deliveryFee: fee, finalPrice: 100 + fee, paymentMethod: 'Wallet', paymentStatus: 'Completed',
      status: 'Delivered', deliveryPartnerId: d.id, deliveredAt: new Date(now - (i + 1) * 60 * 1000), fulfilment: 'ZENVY',
    }));
  }
  const expectRupees = FEES.reduce((s, f) => s + oldRiderApp({ deliveryFee: f }), 0);
  const expectPaise = H.toPaise(expectRupees);

  const today = await api('GET', '/api/delivery/stats/today', d.token);
  assert.equal(H.toPaise(today.body.earnings), expectPaise);
  const hist = await api('GET', '/api/delivery/orders/history', d.token);
  const histRows = Array.isArray(hist.body) ? hist.body : hist.body.orders;
  assert.equal(H.toPaise(histRows.reduce((s, o) => s + o.riderEarning, 0)), expectPaise);

  const fleet = await api('GET', '/api/admin/fleet/payouts', admin.token);
  const row = fleet.body.find((x) => x.riderId === d.id);
  assert.equal(row.earningsPaise, expectPaise);
  assert.equal(row.totalDeliveries, FEES.length);

  const prev = await api('GET', `/api/admin/payouts/preview?partnerType=rider&partnerId=${d.id}`, admin.token);
  assert.equal(prev.status, 200, JSON.stringify(prev.body));
  assert.equal(prev.body.grossPaise, expectPaise);

  const { earningPaiseSql } = H.r('utils/riderEarnings');
  const [sqlRow] = await H.ctx.sequelize.query(`SELECT SUM(${earningPaiseSql('sqlite')}) AS s FROM "Orders" WHERE "deliveryPartnerId" = :id`, { replacements: { id: d.id }, type: 'SELECT' });
  assert.equal(Number(sqlRow.s), expectPaise);
  assert.equal(orders.length, FEES.length);
});
