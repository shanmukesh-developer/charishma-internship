// Admin wallet adjust (reason required, ledger + audit in one transaction, errors surface), admin ledger
// view, the one-time opening-balance migration (idempotent) and the read-only reconciliation (job + API).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
let L;
before(async () => {
  await H.setup();
  L = H.r('utils/walletLedger');
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

const adjust = (userId, body, headers) => api('POST', `/api/admin/users/${userId}/wallet`, admin.token, body, headers);
const audits = (userId) => H.ctx.M('VerificationLog').findAll({ where: { targetId: String(userId), action: 'WALLET_UPDATE' } });

test('admin adjust without a reason (old dashboard) -> 400 REASON_REQUIRED with a clear message, nothing changes', async () => {
  const u = await H.mkUser({ wallet: 100 });
  for (const body of [{ amount: 50 }, { amount: 50, reason: '' }, { amount: 50, reason: '  ok  ' }]) {
    const r = await adjust(u.id, body);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'REASON_REQUIRED');
    assert.match(r.body.message, /reason/i);
  }
  assert.equal((await adjust(u.id, { amount: 0, reason: 'Testing zero' })).status, 400);
  assert.equal((await adjust(u.id, { amount: 'abc', reason: 'Testing junk' })).status, 400);
  assert.equal(await H.balancePaise('user', u.id), 10000);
  assert.equal((await H.ledger('user', u.id)).length, 0);
  assert.equal((await audits(u.id)).length, 0);
  const student = await H.mkUser();
  assert.equal((await api('POST', `/api/admin/users/${u.id}/wallet`, student.token, { amount: 50, reason: 'Sneaky credit' })).status, 403);
});

test('admin credit / debit: ADMIN_CREDIT / ADMIN_DEBIT row with actor + reason and the WALLET_UPDATE audit row; same response shape', async () => {
  const u = await H.mkUser({ wallet: 100 });
  const c = await adjust(u.id, { amount: 49.5, reason: 'Refund for missing item' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.message, 'Wallet updated');
  assert.equal(c.body.walletBalance, 149.5);
  assert.ok(c.body.transactionId);
  const d = await adjust(u.id, { amount: -20, reason: 'Duplicate credit reversed' });
  assert.equal(d.body.walletBalance, 129.5);
  const rows = await H.ledger('user', u.id);
  assert.deepEqual(rows.map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.actorType, x.actorId, x.reason]), [
    ['OPENING_BALANCE', 10000, 10000, 'system', null, 'Balance before wallet history started'],
    ['ADMIN_CREDIT', 4950, 14950, 'admin', admin.id, 'Refund for missing item'],
    ['ADMIN_DEBIT', -2000, 12950, 'admin', admin.id, 'Duplicate credit reversed'],
  ]);
  const logs = await audits(u.id);
  assert.equal(logs.length, 2);
  const det = logs.map((l) => JSON.parse(l.details));
  assert.ok(det.some((x) => x.transactionId === c.body.transactionId && x.reason === 'Refund for missing item' && x.newBalance === 149.5));
  // Overdraw refused, nothing written.
  const over = await adjust(u.id, { amount: -500, reason: 'Too much to take' });
  assert.equal(over.status, 400);
  assert.match(over.body.message, /negative/);
  assert.equal((await H.ledger('user', u.id)).length, 3);
  assert.equal((await audits(u.id)).length, 2);
  // Idempotency-Key: a double submit applies once.
  const k1 = await adjust(u.id, { amount: 10, reason: 'Double click test' }, { 'Idempotency-Key': 'adm-c5-1' });
  const k2 = await adjust(u.id, { amount: 10, reason: 'Double click test' }, { 'Idempotency-Key': 'adm-c5-1' });
  assert.equal(k1.body.transactionId, k2.body.transactionId);
  assert.equal(k2.body.duplicate, true);
  assert.equal(k2.body.walletBalance, 139.5);
  assert.equal((await audits(u.id)).length, 3, 'one audit row for the one change');
  assert.equal(await H.ledgerSum('user', u.id), await H.balancePaise('user', u.id));
});

test('admin adjust is all-or-nothing: audit write fails -> 500, no balance change, no ledger row', async () => {
  const u = await H.mkUser({ wallet: 100 });
  const VL = H.ctx.M('VerificationLog');
  const orig = VL.create;
  VL.create = async () => { throw new Error('audit table unavailable'); };
  try {
    const r = await adjust(u.id, { amount: 75, reason: 'Should roll back' });
    assert.equal(r.status, 500);
  } finally {
    VL.create = orig;
  }
  assert.equal(await H.balancePaise('user', u.id), 10000);
  assert.equal((await H.ledger('user', u.id)).length, 0);
  assert.equal((await audits(u.id)).length, 0);
});

test('admin ledger view: newest first with actor / reason / key, in-sync flag; bad params', async () => {
  const u = await H.mkUser({ wallet: 10 });
  await adjust(u.id, { amount: 5, reason: 'Small goodwill credit' });
  const r = await api('GET', `/api/admin/wallet/user/${u.id}/transactions`, admin.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.owner.walletBalance, 15);
  assert.equal(r.body.inSync, true);
  assert.equal(r.body.total, 2);
  assert.equal(r.body.transactions[0].type, 'ADMIN_CREDIT');
  assert.equal(r.body.transactions[0].reason, 'Small goodwill credit');
  assert.equal(r.body.transactions[0].actorId, admin.id);
  assert.equal(r.body.transactions[0].note, 'Small goodwill credit');
  assert.equal((await api('GET', `/api/admin/wallet/shop/${u.id}/transactions`, admin.token)).status, 400);
  assert.equal((await api('GET', '/api/admin/wallet/user/not-a-uuid/transactions', admin.token)).status, 400);
  assert.equal((await api('GET', '/api/admin/wallet/user/00000000-0000-4000-8000-000000000000/transactions', admin.token)).status, 404);
  const d = await H.mkRider({ wallet: 0 });
  assert.equal((await api('GET', `/api/admin/wallet/rider/${d.id}/transactions`, admin.token)).status, 200);
});

test('opening-balance migration: one OPENING_BALANCE per non-zero owner without rows; idempotent; never changes balances', async () => {
  const W = H.ctx.M('WalletTransaction');
  const a = await H.mkUser({ wallet: 120.75 });
  const b = await H.mkUser({ wallet: 0 });
  const c = await H.mkUser({ wallet: 40 });
  await adjust(c.id, { amount: 10, reason: 'Already has history' }); // c: opening via the first change
  const d = await H.mkRider({ wallet: 33.33 });
  const before1 = await W.count();
  const r1 = await L.backfillOpeningBalances(H.ctx.sequelize, { batch: 2 });
  assert.ok(r1.user >= 1 && r1.rider >= 1, JSON.stringify(r1));
  assert.deepEqual(await H.ledgerShape('user', a.id), [['OPENING_BALANCE', 12075, 12075, null, null]]);
  assert.deepEqual(await H.ledgerShape('rider', d.id), [['OPENING_BALANCE', 3333, 3333, null, null]]);
  assert.equal((await H.ledger('user', b.id)).length, 0, 'zero balance: no row');
  assert.equal((await H.ledger('user', c.id)).filter((x) => x.type === 'OPENING_BALANCE').length, 1, 'owner with history untouched');
  const mid = await W.count();
  assert.ok(mid > before1);
  const r2 = await L.backfillOpeningBalances(H.ctx.sequelize);
  assert.deepEqual([r2.user, r2.rider], [0, 0]);
  const r3 = await L.runWalletLedgerMigrations(H.ctx.sequelize);
  assert.deepEqual([r3.opening.user, r3.opening.rider], [0, 0]);
  assert.equal(await W.count(), mid, 'second and third runs add nothing');
  assert.equal(await H.balancePaise('user', a.id), 12075);
  const rec = await L.reconcile({ sequelize: H.ctx.sequelize });
  assert.equal(rec.mismatchCount, 0, JSON.stringify(rec.mismatches));
  assert.equal(rec.withoutHistoryCount, 0, JSON.stringify(rec.withoutHistory));
});

test('reconciliation detects a manual balance edit (never fixes it), alerts admins, API + metrics report it', async () => {
  const u = await H.mkUser({ wallet: 0 });
  await adjust(u.id, { amount: 200, reason: 'Initial credit for test' });
  const clean = await api('GET', '/api/admin/wallet/reconcile', admin.token);
  assert.equal(clean.status, 200);
  assert.equal(clean.body.ok, true, JSON.stringify(clean.body));
  // Someone edits the balance directly in the database.
  await H.ctx.M('User').update({ walletBalance: 250 }, { where: { id: u.id } });
  const stranger = await H.mkUser({ wallet: 0 });
  await H.ctx.M('User').update({ walletBalance: 30 }, { where: { id: stranger.id } }); // balance with no history at all
  const r = await api('GET', '/api/admin/wallet/reconcile?limit=10', admin.token);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.mismatchCount, 1);
  const m = r.body.mismatches[0];
  assert.deepEqual([m.ownerType, m.ownerId, m.balancePaise, m.ledgerPaise, m.differencePaise], ['user', u.id, 25000, 20000, 5000]);
  assert.equal(r.body.withoutHistoryCount, 1);
  assert.equal(r.body.withoutHistory[0].ownerId, stranger.id);
  assert.equal(await H.balancePaise('user', u.id), 25000, 'never auto-fixed');
  assert.equal((await H.ledger('user', u.id)).length, 1);
  // Daily job: same result, admin alert on the admin room, status for /metrics/perf.
  H.ctx.emitted.length = 0;
  const job = await L.runReconcileJob({ io: { to: (room) => ({ emit: (ev, p) => H.ctx.emitted.push({ room, ev, p }) }) } });
  assert.deepEqual([job.mismatches, job.withoutHistory], [1, 1]);
  assert.ok(H.ctx.emitted.some((e) => e.room === 'admin-room' && e.ev === 'adminAlert' && e.p.type === 'WALLET_RECONCILE'));
  const st = L.reconcileStatus();
  assert.equal(st.mismatches, 1);
  assert.ok(st.alertsSent >= 1);
  const job2 = H.r('jobs').listJobs().find((j) => j.name === 'wallet.reconcile');
  assert.deepEqual(job2.schedule, { cron: '30 4 * * *', timezone: 'Asia/Kolkata' });
  const student = await H.mkUser();
  assert.equal((await api('GET', '/api/admin/wallet/reconcile', student.token)).status, 403);
});
