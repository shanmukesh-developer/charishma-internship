// Cash limit (RIDER_CASH_LIMIT): default 0 = OFF (owner decision, riders never blocked); only if an admin
// sets a limit > 0 a rider at / over it cannot claim NEW COD orders (409 CASH_LIMIT "Deposit ₹X"); deposits (cash / UPI + reference) reduce the cash
// held, are idempotent and never go below zero; adjustments need a reason; the config key is validated.
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

const adjust = (riderId, amountPaise, reason = 'Opening cash held before ledger start') => api('POST', `/api/admin/rider-cash/${riderId}/adjust`, admin.token, { amountPaise, reason });
const deposit = (riderId, body) => api('POST', `/api/admin/rider-cash/${riderId}/deposit`, admin.token, body);
const setLimit = (value) => api('POST', '/api/admin/config', admin.token, { key: 'RIDER_CASH_LIMIT', value });

test('default: limit OFF (owner decision) - a rider holding lots of cash can still claim COD orders; app shows "Cash with you"', async () => {
  const d = await H.mkRider();
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  assert.equal((await adjust(d.id, 1000000)).status, 201); // ₹10,000 held
  const cod = await H.placeOrder({ item, user: u, method: 'COD' });
  const c1 = await H.readyAndClaim(cod.id, d);
  assert.equal(c1.status, 200, JSON.stringify(c1.body));
  const me = await api('GET', '/api/delivery/cash', d.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.limitEnabled, false);
  assert.equal(me.body.overLimit, false);
  assert.equal(me.body.message, null);
  assert.equal(me.body.info, 'Cash with you: ₹10000');
  const today = await api('GET', '/api/delivery/stats/today', d.token);
  assert.equal(today.body.cash.limitEnabled, false);
  assert.equal(today.body.cash.cashHeldPaise, 1000000);
});

test('if an admin sets a limit > 0: at the limit COD claims get 409 CASH_LIMIT ("Deposit ₹X"), prepaid claims still work, a deposit unblocks', async () => {
  assert.equal((await setLimit(2000)).status, 200);
  try {
    const d = await H.mkRider();
    const { item } = await H.mkStore({ price: 100 });
    const u = await H.mkUser({ wallet: 1000 });
    assert.equal((await adjust(d.id, 200000)).status, 201); // ₹2000 held
    const cod = await H.placeOrder({ item, user: u, method: 'COD' });
    const c1 = await H.readyAndClaim(cod.id, d);
    assert.equal(c1.status, 409, JSON.stringify(c1.body));
    assert.equal(c1.body.code, 'CASH_LIMIT');
    assert.match(c1.body.message, /Deposit ₹1 to keep taking COD orders/);
    assert.equal((await H.ctx.M('Order').findByPk(cod.id)).deliveryPartnerId, null, 'COD order stays in the pool');
    const pre = await H.placeOrder({ item, user: u, method: 'Wallet' });
    assert.equal((await H.readyAndClaim(pre.id, d)).status, 200);
    const me = await api('GET', '/api/delivery/cash', d.token);
    assert.equal(me.body.overLimit, true);
    assert.equal(me.body.message, 'Deposit ₹1 to keep taking COD orders.');
    const dep = await deposit(d.id, { amount: 500, method: 'upi', reference: 'UTR123456789' });
    assert.equal(dep.status, 201, JSON.stringify(dep.body));
    assert.equal(dep.body.cashHeldPaise, 150000);
    assert.equal((await H.readyAndClaim(cod.id, d)).status, 200);
  } finally {
    assert.equal((await setLimit(0)).status, 200);
  }
});

test('limit is admin-editable (RIDER_CASH_LIMIT, whole rupees, 0 = off) and validated', async () => {
  for (const bad of [-1, 1.5, 'abc', 100001]) {
    const r = await setLimit(bad);
    assert.equal(r.status, 400, `value ${bad}`);
  }
  assert.equal((await api('POST', '/api/admin/config', admin.token, { key: 'RIDER_CASH_LEDGER_START', value: 'x' })).status, 400);
  const d = await H.mkRider();
  const { item } = await H.mkStore({ price: 50 });
  const u = await H.mkUser();
  await adjust(d.id, 60000); // ₹600
  assert.equal((await setLimit(500)).status, 200);
  const o1 = await H.placeOrder({ item, user: u });
  const blocked = await H.readyAndClaim(o1.id, d);
  assert.equal(blocked.body.code, 'CASH_LIMIT');
  assert.match(blocked.body.message, /Deposit ₹101 /);
  assert.equal((await setLimit(0)).status, 200);
  const ok = await H.readyAndClaim(o1.id, d);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const h = await api('GET', '/api/admin/rider-cash', admin.token);
  assert.equal(h.status, 200);
  assert.equal(h.body.limitPaise, 0);
  assert.equal(h.body.limitEnabled, false);
  assert.ok(h.body.riders.some((r) => r.riderId === d.id && r.cashHeldPaise === 60000));
});

test('deposit: reference + method required, cannot exceed cash held, idempotent, ledger sums to cash held', async () => {
  const d = await H.mkRider();
  await adjust(d.id, 100000); // ₹1000
  assert.equal((await deposit(d.id, { amount: 100, method: 'cash' })).body.code, 'REFERENCE_REQUIRED');
  assert.equal((await deposit(d.id, { amount: 100, method: 'card', reference: 'R-1' })).status, 400);
  assert.equal((await deposit(d.id, { amount: 0, method: 'cash', reference: 'R-1' })).status, 400);
  const over = await deposit(d.id, { amount: 1000.01, method: 'cash', reference: 'Receipt 7' });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'NOT_ENOUGH_CASH');
  const key = 'dep-key-1';
  const rs = await Promise.all([1, 2, 3, 4].map(() => deposit(d.id, { amount: 400, method: 'cash', reference: 'Receipt 8 (Ravi)', idempotencyKey: key })));
  assert.equal(rs.filter((x) => x.status === 201).length, 1, rs.map((x) => x.status).join(','));
  assert.ok(rs.every((x) => x.status === 201 || (x.status === 200 && x.body.duplicate === true)));
  assert.equal(await H.cashHeld(d.id), 60000);
  // Parallel distinct deposits that together exceed the cash: never below zero.
  const many = await Promise.all([1, 2, 3, 4, 5].map((i) => deposit(d.id, { amount: 200, method: 'upi', reference: `UTR-par-${i}` })));
  assert.equal(many.filter((x) => x.status === 201).length, 3, many.map((x) => x.status).join(','));
  assert.equal(await H.cashHeld(d.id), 0);
  assert.equal(await H.cashSum(d.id), 0);
  const hist = await api('GET', `/api/admin/rider-cash/${d.id}/entries`, admin.token);
  assert.equal(hist.status, 200);
  assert.equal(hist.body.inSync, true);
  assert.equal(hist.body.entries[0].type, 'CASH_DEPOSITED');
  assert.equal(hist.body.entries[0].balanceAfterPaise, 0);
  // Rider sees deposit history (deposits + adjustments only with ?type=deposits).
  const mine = await api('GET', '/api/delivery/cash/entries?type=deposits', d.token);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.entries.every((e) => ['CASH_DEPOSITED', 'ADJUSTMENT'].includes(e.type)));
  assert.equal(mine.body.entries.filter((e) => e.type === 'CASH_DEPOSITED').length, 4);
  assert.ok(!('idempotencyKey' in mine.body.entries[0]));
});

test('adjustment: reason required, signed, audited; non-admin cannot record cash', async () => {
  const d = await H.mkRider();
  const r1 = await api('POST', `/api/admin/rider-cash/${d.id}/adjust`, admin.token, { amountPaise: 5000 });
  assert.equal(r1.status, 400);
  assert.equal(r1.body.code, 'REASON_REQUIRED');
  assert.equal((await adjust(d.id, 5000, 'Cash found in bag')).status, 201);
  assert.equal((await adjust(d.id, -2000, 'Counted twice yesterday')).status, 201);
  assert.equal(await H.cashHeld(d.id), 3000);
  assert.equal((await adjust(d.id, -5000, 'Too much')).body.code, 'NOT_ENOUGH_CASH');
  const logs = await H.ctx.M('VerificationLog').count({ where: { targetId: d.id, action: 'RIDER_CASH_ADJUST' } });
  assert.equal(logs, 2);
  const u = await H.mkUser();
  assert.equal((await api('POST', `/api/admin/rider-cash/${d.id}/deposit`, u.token, { amount: 10, method: 'cash', reference: 'x-1' })).status, 403);
  assert.equal((await api('POST', `/api/admin/rider-cash/${d.id}/deposit`, d.token, { amount: 10, method: 'cash', reference: 'x-1' })).status, 403);
});

test('net position: cash held vs what ZenWe owes (earnings + tips), never netted', async () => {
  const d = await H.mkRider({ wallet: 25 });
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  const { order, res } = await H.fullDelivery({ item, user: u, rider: d });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const me = await api('GET', '/api/delivery/cash', d.token);
  const fp = H.toPaise(order.finalPrice);
  assert.equal(me.body.position.cashHeldPaise, fp);
  assert.equal(me.body.position.earningsPaise, H.toPaise(order.deliveryFee));
  assert.equal(me.body.position.tipsPaise, 2500);
  assert.equal(me.body.position.zenvyOwesPaise, H.toPaise(order.deliveryFee) + 2500);
  assert.equal(me.body.position.netPaise, H.toPaise(order.deliveryFee) + 2500 - fp);
  assert.equal(me.body.position.direction, 'rider_owes_zenvy');
});
