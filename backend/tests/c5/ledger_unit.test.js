// applyWalletChange: sign / type / balanceAfter, paise rounding, no negatives, idempotency, lazy opening
// balance, admin reason rule, rollback with the caller's transaction, and 20 parallel debits.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let L;
let Transaction;
before(async () => {
  await H.setup();
  L = H.r('utils/walletLedger');
  ({ Transaction } = require(require('path').join(H.B, 'node_modules/sequelize')));
});
after(H.teardown);

const tx = (fn) => H.ctx.sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, fn);

test('paise helpers: floor(x*100 + 0.5), the same in JS and SQL', async () => {
  assert.equal(L.toPaise(120), 12000);
  assert.equal(L.toPaise('0.1'), 10);
  assert.equal(L.toPaise(0.1 + 0.2), 30);
  assert.equal(L.toPaise(10.005), 1001);
  assert.equal(L.toPaise(-1.5), -150);
  assert.equal(L.toRupees(12345), 123.45);
  for (const v of [0, 0.1, 0.30000000000000004, 33.335, 99.995, 1234.5649, 7.125]) {
    const [row] = await H.ctx.sequelize.query(`SELECT ${L.paiseSql('sqlite', String(v))} AS p`, { type: 'SELECT' });
    assert.equal(Number(row.p), L.toPaise(v), `sql == js for ${v}`);
  }
});

test('credit / debit: one row each, signed amount, type, ref, actor, balanceAfter; FLOAT column stays in sync', async () => {
  const u = await H.mkUser();
  const a = await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 25050, type: 'ADMIN_CREDIT', actor: { type: 'admin', id: 'adm-1' }, reason: 'Goodwill credit' }));
  assert.equal(a.applied, true);
  assert.equal(a.balancePaise, 25050);
  const b = await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: -5025, type: 'ORDER_PAYMENT', ref: { type: 'ORDER', id: 'o-1' }, actor: { type: 'user', id: u.id } }));
  assert.equal(b.balance, 200.25);
  await u.reload();
  assert.equal(u.walletBalance, 200.25);
  const rows = await H.ledger('user', u.id);
  assert.deepEqual(rows.map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.refType, x.refId, x.actorType, x.actorId, x.reason]), [
    ['ADMIN_CREDIT', 25050, 25050, null, null, 'admin', 'adm-1', 'Goodwill credit'],
    ['ORDER_PAYMENT', -5025, 20025, 'ORDER', 'o-1', 'user', u.id, null],
  ]);
  assert.equal(await H.ledgerSum('user', u.id), await H.balancePaise('user', u.id));
});

test('never below zero (INSUFFICIENT_BALANCE, nothing written) unless allowNegative', async () => {
  const u = await H.mkUser();
  await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 1000, type: 'CORRECTION' }));
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: -1001, type: 'ORDER_PAYMENT' })), (e) => e.code === 'INSUFFICIENT_BALANCE' && L.isInsufficient(e));
  assert.equal(await H.balancePaise('user', u.id), 1000);
  assert.equal((await H.ledger('user', u.id)).length, 1);
  const ok = await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: -1000, type: 'ORDER_PAYMENT' }));
  assert.equal(ok.balancePaise, 0, 'exactly to zero is fine');
  const neg = await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: -300, type: 'CORRECTION', allowNegative: true }));
  assert.equal(neg.balancePaise, -300);
  assert.equal(await H.ledgerSum('user', u.id), -300);
});

test('input rules: transaction required, owner type / amount / type validated, admin needs a reason, unknown owner', async () => {
  const u = await H.mkUser();
  await assert.rejects(L.applyWalletChange({ ownerType: 'user', ownerId: u.id, amountPaise: 100, type: 'CORRECTION' }), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'shop', ownerId: u.id, amountPaise: 100, type: 'CORRECTION' })), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 1.5, type: 'CORRECTION' })), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 0, type: 'CORRECTION' })), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 100, type: 'FREE_MONEY' })), (e) => e.code === 'INVALID_INPUT');
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 100, type: 'ADMIN_CREDIT', actor: { type: 'admin', id: 'a' }, reason: 'hey' })), (e) => e.code === 'REASON_REQUIRED');
  await assert.rejects(tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: '00000000-0000-4000-8000-000000000000', amountPaise: 100, type: 'CORRECTION' })), (e) => e.code === 'OWNER_NOT_FOUND');
  assert.equal((await H.ledger('user', u.id)).length, 0);
  assert.equal(await H.balancePaise('user', u.id), 0);
});

test('idempotencyKey: the same key for the same owner changes the balance once and returns the first row', async () => {
  const u = await H.mkUser();
  const first = await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 700, type: 'ORDER_REFUND', idempotencyKey: 'order-refund:x' }));
  const again = await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 700, type: 'ORDER_REFUND', idempotencyKey: 'order-refund:x' }));
  assert.equal(again.applied, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.row.id, first.row.id);
  assert.equal(await H.balancePaise('user', u.id), 700);
  // Unique per owner: another owner may use the same key (tip:<order> on customer + rider).
  const d = await H.mkRider();
  const other = await tx((t) => L.applyWalletChange({ t, ownerType: 'rider', ownerId: d.id, amountPaise: 700, type: 'TIP_RECEIVED', idempotencyKey: 'order-refund:x' }));
  assert.equal(other.applied, true);
  // The partial unique index itself refuses a second row with the same (owner, key).
  await assert.rejects(H.ctx.M('WalletTransaction').create({ ownerType: 'user', ownerId: u.id, amountPaise: 1, balanceAfterPaise: 1, type: 'CORRECTION', idempotencyKey: 'order-refund:x' }), (e) => e.name === 'SequelizeUniqueConstraintError');
  // Rows without a key are never unique-checked.
  await H.ctx.M('WalletTransaction').bulkCreate([1, 2].map(() => ({ ownerType: 'user', ownerId: 'nobody', amountPaise: 1, balanceAfterPaise: 1, type: 'CORRECTION' })));
});

test('a balance that predates the ledger gets its OPENING_BALANCE row on the first change (history sums to balance)', async () => {
  const u = await H.mkUser({ wallet: 350.4 });
  await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: -10040, type: 'ORDER_PAYMENT', ref: { type: 'ORDER', id: 'o-9' } }));
  assert.deepEqual(await H.ledgerShape('user', u.id), [
    ['OPENING_BALANCE', 35040, 35040, null, null],
    ['ORDER_PAYMENT', -10040, 25000, 'ORDER', 'o-9'],
  ]);
  await tx((t) => L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: 500, type: 'CORRECTION' }));
  assert.equal((await H.ledger('user', u.id)).filter((x) => x.type === 'OPENING_BALANCE').length, 1, 'opening only once');
  assert.equal(await H.ledgerSum('user', u.id), 25500);
});

test('the caller rolls back: balance change and ledger row disappear together', async () => {
  const u = await H.mkUser({ wallet: 100 });
  await assert.rejects(tx(async (t) => {
    await L.applyWalletChange({ t, ownerType: 'user', ownerId: u.id, amountPaise: -4000, type: 'ORDER_PAYMENT' });
    throw new Error('order insert failed');
  }), /order insert failed/);
  assert.equal(await H.balancePaise('user', u.id), 10000);
  assert.equal((await H.ledger('user', u.id)).length, 0, 'no row, not even the opening one');
});

test('concurrency: 20 parallel ₹30 debits on ₹100 -> exactly 3 succeed, never negative, ledger sum == balance', async () => {
  const u = await H.mkUser({ wallet: 100 });
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => tx((t) => L.applyWalletChange({
    t, ownerType: 'user', ownerId: u.id, amountPaise: -3000, type: 'ORDER_PAYMENT', ref: { type: 'ORDER', id: `par-${i}` },
  }))));
  const ok = results.filter((x) => x.status === 'fulfilled');
  const bad = results.filter((x) => x.status === 'rejected');
  assert.equal(ok.length, 3, bad.filter((x) => !L.isInsufficient(x.reason)).map((x) => x.reason && x.reason.message).join(' | '));
  assert.ok(bad.every((x) => L.isInsufficient(x.reason)), 'every loser is INSUFFICIENT_BALANCE');
  assert.equal(await H.balancePaise('user', u.id), 1000);
  const rows = await H.ledger('user', u.id);
  assert.equal(rows.filter((x) => x.type === 'ORDER_PAYMENT').length, 3);
  assert.equal(rows.filter((x) => x.type === 'OPENING_BALANCE').length, 1);
  assert.ok(rows.every((x) => x.balanceAfterPaise >= 0), 'no row ever shows a negative balance');
  assert.deepEqual(rows.filter((x) => x.type === 'ORDER_PAYMENT').map((x) => x.balanceAfterPaise).sort((a, b) => b - a), [7000, 4000, 1000]);
  assert.equal(await H.ledgerSum('user', u.id), 1000);
});

test('concurrency: 20 parallel mixed credits / debits keep history == balance', async () => {
  const u = await H.mkUser({ wallet: 50 });
  await Promise.allSettled(Array.from({ length: 20 }, (_, i) => tx((t) => L.applyWalletChange({
    t, ownerType: 'user', ownerId: u.id, amountPaise: i % 2 ? -2500 : 1000, type: i % 2 ? 'ORDER_PAYMENT' : 'ORDER_REFUND',
  }))));
  const bal = await H.balancePaise('user', u.id);
  assert.ok(bal >= 0);
  assert.equal(await H.ledgerSum('user', u.id), bal);
});
