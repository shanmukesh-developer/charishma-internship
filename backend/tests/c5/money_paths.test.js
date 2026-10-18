// Every money path through the real routes writes exactly one ledger row with the right sign / type /
// balanceAfter / ref, keeps its exactly-once rules, and leaves history == balance.
// (Auto-Ride and Campus Events wallet paths are asserted in their own suites: test:autoride wallet,
// test:events registration.)
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

const inSync = async (ownerType, id) => assert.equal(await H.ledgerSum(ownerType, id), await H.balancePaise(ownerType, id), `${ownerType} ${id}: history sums to balance`);

test('wallet order: ORDER_PAYMENT row (-finalPrice, ref ORDER) in the order transaction; response unchanged', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 500 });
  const r = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.paymentStatus, 'Completed');
  const fp = H.r('utils/walletLedger').toPaise(r.body.finalPrice);
  assert.ok(fp > 0);
  assert.deepEqual(await H.ledgerShape('user', u.id), [
    ['OPENING_BALANCE', 50000, 50000, null, null],
    ['ORDER_PAYMENT', -fp, 50000 - fp, 'ORDER', r.body.id],
  ]);
  await inSync('user', u.id);
  // COD never touches the wallet.
  const cod = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'COD'));
  assert.equal(cod.status, 201);
  assert.equal((await H.ledger('user', u.id)).length, 2);
});

test('insufficient wallet: 400 INSUFFICIENT_WALLET, no order, no ledger row', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 20 });
  const r = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'INSUFFICIENT_WALLET');
  assert.equal(r.body.walletBalance, 20);
  assert.equal(await H.ctx.M('Order').count({ where: { userId: u.id } }), 0);
  assert.equal((await H.ledger('user', u.id)).length, 0);
  assert.equal(await H.balancePaise('user', u.id), 2000);
});

test('5 parallel orders on a balance that covers 2: exactly 2 orders, 2 ORDER_PAYMENT rows, never negative', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 0 });
  const probe = await api('POST', '/api/orders/quote', u.token, H.orderBody(item.id, 'Wallet'));
  const fp = Number(probe.body.finalPrice || (probe.body.quote && probe.body.quote.finalPrice));
  assert.ok(fp > 0, JSON.stringify(probe.body));
  await H.ctx.M('User').update({ walletBalance: fp * 2 + 5 }, { where: { id: u.id } });
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'))));
  assert.equal(rs.filter((x) => x.status === 201).length, 2, rs.map((x) => x.status).join(','));
  assert.ok(rs.filter((x) => x.status !== 201).every((x) => x.body.code === 'INSUFFICIENT_WALLET'));
  const rows = await H.ledger('user', u.id);
  assert.equal(rows.filter((x) => x.type === 'ORDER_PAYMENT').length, 2);
  assert.equal(await H.balancePaise('user', u.id), 500);
  await inSync('user', u.id);
});

test('cancel: 5 parallel cancels -> one ORDER_REFUND row (ref ORDER), balance restored; cancelAndRefund again is a no-op', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 300 });
  const o = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'));
  assert.equal(o.status, 201);
  const cs = await Promise.all([1, 2, 3, 4, 5].map(() => api('PUT', `/api/orders/${o.body.id}/cancel`, u.token, { reason: 'Changed my mind' })));
  assert.equal(cs.filter((c) => c.status === 200).length, 1, cs.map((c) => c.status).join(','));
  const fp = H.r('utils/walletLedger').toPaise(o.body.finalPrice);
  const shape = await H.ledgerShape('user', u.id);
  assert.deepEqual(shape.slice(1), [
    ['ORDER_PAYMENT', -fp, 30000 - fp, 'ORDER', o.body.id],
    ['ORDER_REFUND', fp, 30000, 'ORDER', o.body.id],
  ]);
  const { cancelAndRefund } = H.r('controllers/orderController');
  const again = await cancelAndRefund(await H.ctx.M('Order').findByPk(o.body.id), { reason: 'job' });
  assert.deepEqual(again, { cancelled: false, refunded: 0 });
  assert.equal((await H.ledger('user', u.id)).filter((x) => x.type === 'ORDER_REFUND').length, 1);
  assert.equal(await H.balancePaise('user', u.id), 30000);
  await inSync('user', u.id);
});

test('final bill (buy-for-me): lower bill -> BILL_DIFFERENCE credit; higher bill -> debit; short wallet -> nothing', async () => {
  const { item } = await H.mkStore({ price: 100 }); // buy-at-store shops are COD only; older buy-for-me rows can be Wallet
  const u = await H.mkUser({ wallet: 1000 });
  const mk = async () => {
    const o = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'));
    assert.equal(o.status, 201, JSON.stringify(o.body));
    return o.body;
  };
  const lower = await mk();
  await H.ctx.M('Order').update({ category: 'Kirana', billAmount: 60 }, { where: { id: lower.id } });
  const a = await api('PUT', `/api/orders/${lower.id}/approve-bill`, u.token, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const diffA = H.r('utils/walletLedger').toPaise(a.body.amountPayable) - H.r('utils/walletLedger').toPaise(lower.finalPrice);
  assert.ok(diffA < 0);
  let rows = await H.ledger('user', u.id);
  const bdA = rows.filter((x) => x.type === 'BILL_DIFFERENCE');
  assert.equal(bdA.length, 1);
  assert.equal(bdA[0].amountPaise, -diffA, 'credit = what was over-paid');
  assert.equal(bdA[0].refId, lower.id);
  assert.match(a.body.message, /returned to your Wallet/);
  const again = await api('PUT', `/api/orders/${lower.id}/approve-bill`, u.token, {});
  assert.equal(again.status, 200);
  assert.equal((await H.ledger('user', u.id)).filter((x) => x.type === 'BILL_DIFFERENCE').length, 1, 'approve twice -> one row');

  const higher = await mk();
  await H.ctx.M('Order').update({ category: 'Kirana', billAmount: 180 }, { where: { id: higher.id } });
  const b = await api('PUT', `/api/orders/${higher.id}/approve-bill`, u.token, {});
  assert.equal(b.status, 200, JSON.stringify(b.body));
  rows = await H.ledger('user', u.id);
  const bdB = rows.filter((x) => x.type === 'BILL_DIFFERENCE' && x.refId === higher.id);
  assert.equal(bdB.length, 1);
  assert.equal(bdB[0].amountPaise, -8000, 'debit = 180 - 100');
  await inSync('user', u.id);

  const poor = await H.mkUser({ wallet: 0 });
  const pq = await api('POST', '/api/orders/quote', poor.token, H.orderBody(item.id, 'Wallet'));
  const pfp = Number(pq.body.finalPrice || (pq.body.quote && pq.body.quote.finalPrice));
  await H.ctx.M('User').update({ walletBalance: pfp }, { where: { id: poor.id } });
  const po = await api('POST', '/api/orders', poor.token, H.orderBody(item.id, 'Wallet'));
  assert.equal(po.status, 201);
  await H.ctx.M('Order').update({ category: 'Kirana', billAmount: 500 }, { where: { id: po.body.id } });
  const c = await api('PUT', `/api/orders/${po.body.id}/approve-bill`, poor.token, {});
  assert.equal(c.status, 400);
  assert.equal(c.body.code, 'INSUFFICIENT_WALLET');
  assert.equal((await H.ledger('user', poor.id)).filter((x) => x.type === 'BILL_DIFFERENCE').length, 0);
  assert.equal((await H.ctx.M('Order').findByPk(po.body.id)).isBillApproved, false, 'not approved');
  await inSync('user', poor.id);
});

test('tip: TIP_SENT on the customer + TIP_RECEIVED on the rider, once; admin payout -> TIP_PAYOUT', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 400 });
  const d = await H.mkRider();
  const o = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'));
  await H.ctx.M('Order').update({ status: 'Delivered', deliveryPartnerId: d.id, deliveredAt: new Date() }, { where: { id: o.body.id } });
  const rt = await api('PUT', `/api/orders/${o.body.id}/rate`, u.token, { rating: 5, tipAmount: 20 });
  assert.equal(rt.status, 200, JSON.stringify(rt.body));
  assert.equal(rt.body.tipApplied, true);
  const rt2 = await api('PUT', `/api/orders/${o.body.id}/rate`, u.token, { rating: 4, tipAmount: 20 });
  assert.equal(rt2.status, 409);
  const ut = (await H.ledger('user', u.id)).filter((x) => x.type === 'TIP_SENT');
  assert.equal(ut.length, 1);
  assert.equal(ut[0].amountPaise, -2000);
  assert.equal(ut[0].refId, o.body.id);
  assert.deepEqual(await H.ledgerShape('rider', d.id), [['TIP_RECEIVED', 2000, 2000, 'ORDER', o.body.id]]);
  await inSync('user', u.id);
  await inSync('rider', d.id);

  // Short wallet: tip refused, nothing written on either side.
  const u2 = await H.mkUser({ wallet: 0 });
  const o2 = await H.ctx.M('Order').create({ userId: u2.id, restaurantId: item.restaurantId, items: [], totalPrice: 10, deliveryFee: 0, finalPrice: 10, paymentMethod: 'COD', paymentStatus: 'Completed', status: 'Delivered', deliveryPartnerId: d.id });
  const rt3 = await api('PUT', `/api/orders/${o2.id}/rate`, u2.token, { rating: 5, tipAmount: 30 });
  assert.equal(rt3.status, 200);
  assert.equal(rt3.body.tipApplied, false);
  assert.equal((await H.ledger('user', u2.id)).length, 0);
  assert.equal((await H.ledger('rider', d.id)).length, 1);

  // Rider history endpoint.
  const hist = await api('GET', '/api/delivery/wallet/transactions', d.token);
  assert.equal(hist.status, 200);
  assert.equal(hist.body.balance, 20);
  assert.equal(hist.body.transactions[0].label, 'Tip from a customer');

  const pay = await api('POST', '/api/admin/finance/settle-rider', admin.token, { riderId: d.id, includeTips: true, tipsAmount: 20, upTo: new Date().toISOString(), utr: 'UTR-C5-TIPS' }); // C6: payouts need a UTR
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.tipsSettled, 20);
  const rows = await H.ledger('rider', d.id);
  assert.deepEqual(rows.map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.actorType, x.actorId]).slice(-1), [['TIP_PAYOUT', -2000, 0, 'admin', admin.id]]);
  const pay2 = await api('POST', '/api/admin/finance/settle-rider', admin.token, { riderId: d.id, includeTips: true, tipsAmount: 20, utr: 'UTR-C5-TIPS-2' });
  assert.equal(pay2.status, 400, 'nothing left to pay out'); // C6: no empty Payout record
  assert.equal(pay2.body.code, 'NOTHING_TO_PAY');
  assert.equal((await H.ledger('rider', d.id)).length, 2);
  await inSync('rider', d.id);
});

test('admin manual refund of a cancelled UPI order: ORDER_REFUND by the admin, exactly once under parallel clicks', async () => {
  const { store } = await H.mkStore();
  const u = await H.mkUser({ wallet: 0 });
  const o = await H.ctx.M('Order').create({ userId: u.id, restaurantId: store.id, items: [], totalPrice: 150, deliveryFee: 0, finalPrice: 150, paymentMethod: 'UPI', paymentStatus: 'Completed', status: 'Cancelled' });
  const rs = await Promise.all([1, 2, 3, 4].map(() => api('POST', `/api/admin/finance/refund/${o.id}`, admin.token, {})));
  assert.equal(rs.filter((x) => x.status === 200).length, 1, rs.map((x) => `${x.status}`).join(','));
  const ok = rs.find((x) => x.status === 200);
  assert.equal(ok.body.refundAmount, 150);
  assert.equal(Number(ok.body.walletBalance), 150);
  const rows = await H.ledger('user', u.id);
  assert.deepEqual(rows.map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.refType, x.refId, x.actorType, x.actorId]), [['ORDER_REFUND', 15000, 15000, 'ORDER', o.id, 'admin', admin.id]]);
  await inSync('user', u.id);
});

test('gift (off by default -> 403, nothing written); switched on -> GIFT_SENT + GIFT_RECEIVED once per retry key', async () => {
  const sender = await H.mkUser({ wallet: 200, isElite: true });
  const friend = await H.mkUser({ wallet: 0 });
  const off = await api('POST', '/api/features/gift', sender.token, { recipientPhone: friend.phone, amount: 50 });
  assert.equal(off.status, 403);
  assert.equal(off.body.code, 'TRANSFER_DISABLED');
  assert.equal((await H.ledger('user', sender.id)).length, 0);
  process.env.WALLET_TRANSFERS_ENABLED = 'true';
  try {
    const key = 'gift-key-c5-1';
    const g = await api('POST', '/api/features/gift', sender.token, { recipientPhone: friend.phone, amount: 50, idempotencyKey: key });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(g.body.newBalance, 150);
    const g2 = await api('POST', '/api/features/gift', sender.token, { recipientPhone: friend.phone, amount: 50, idempotencyKey: key });
    assert.equal(g2.status, 200);
    assert.equal(g2.body.duplicate, true);
    assert.deepEqual((await H.ledgerShape('user', sender.id)).map((x) => x.slice(0, 4)), [['OPENING_BALANCE', 20000, 20000, null], ['GIFT_SENT', -5000, 15000, 'USER']]);
    assert.deepEqual((await H.ledgerShape('user', friend.id)).map((x) => x.slice(0, 4)), [['GIFT_RECEIVED', 5000, 5000, 'USER']]);
    const big = await api('POST', '/api/features/gift', sender.token, { recipientPhone: friend.phone, amount: 400, idempotencyKey: 'gift-key-c5-2' });
    assert.equal(big.status, 400);
    assert.equal((await H.ledger('user', sender.id)).length, 2, 'refused gift writes nothing');
    await inSync('user', sender.id);
    await inSync('user', friend.id);
  } finally {
    delete process.env.WALLET_TRANSFERS_ENABLED;
  }
});

test('customer history: newest first, labels, signed amounts, running balance, order link, pagination; riders refused', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser({ wallet: 300 });
  const o = await api('POST', '/api/orders', u.token, H.orderBody(item.id, 'Wallet'));
  await api('PUT', `/api/orders/${o.body.id}/cancel`, u.token, {});
  const h = await api('GET', '/api/users/wallet/transactions?limit=2', u.token);
  assert.equal(h.status, 200);
  assert.equal(h.body.balance, 300);
  assert.equal(h.body.hasMore, true);
  const [refund, payment] = h.body.transactions;
  assert.equal(refund.type, 'ORDER_REFUND');
  assert.equal(refund.label, 'Order refund');
  assert.equal(refund.direction, 'credit');
  assert.equal(refund.balanceAfter, 300);
  assert.deepEqual(refund.ref, { type: 'ORDER', id: o.body.id, label: `Order #${o.body.id.slice(0, 8).toUpperCase()}`, link: `/tracking/${o.body.id}` });
  assert.equal(payment.type, 'ORDER_PAYMENT');
  assert.ok(payment.amount < 0);
  assert.equal(payment.direction, 'debit');
  for (const k of ['idempotencyKey', 'actorId', 'ownerId']) assert.equal(k in refund, false, `no ${k} for customers`);
  const p2 = await api('GET', '/api/users/wallet/transactions?limit=2&page=2', u.token);
  assert.equal(p2.body.transactions.length, 1);
  assert.equal(p2.body.transactions[0].type, 'OPENING_BALANCE');
  assert.equal(p2.body.hasMore, false);
  const d = await H.mkRider();
  assert.equal((await api('GET', '/api/users/wallet/transactions', d.token)).status, 403);
  assert.equal((await api('GET', '/api/users/wallet/transactions')).status, 401);
  assert.equal((await api('GET', '/api/delivery/wallet/transactions', u.token)).status, 403);
});
