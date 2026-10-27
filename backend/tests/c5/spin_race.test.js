// Lucky Spin double tap (27 Oct 2026 transaction audit): parallel use-spin calls with one spin left give exactly one
// prize, the other taps get a clean 400 "No spins left" (they used to fail with 500 on SQLite), and the points
// credited equal the one prize (atomic, conditional on the spin count read).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.setup(); });
after(H.teardown);

test('5 parallel spins, 1 available: one 200, four 400, points = that prize, spinsUsed 1', async () => {
  for (let round = 0; round < 3; round++) {
    const u = await H.mkUser({ completedOrders: 2, spinsUsed: 0, zenPoints: 7 });
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => H.api('POST', '/api/rewards/use-spin', u.token, {})));
    const statuses = rs.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 400, 400, 400, 400], JSON.stringify(rs.map((r) => r.body)));
    const win = rs.find((r) => r.status === 200).body;
    const row = await H.ctx.M('User').findByPk(u.id);
    assert.equal(Number(row.spinsUsed), 1);
    const pts = win.prize.type === 'points' ? Number(win.prize.value) : 0;
    assert.equal(Number(row.zenPoints), 7 + pts);
    assert.equal(win.zenPoints, 7 + pts);
    assert.equal(win.spinsAvailable, 0);
  }
});

test('a NULL spin count (older rows) still spins once', async () => {
  const u = await H.mkUser({ completedOrders: 4, zenPoints: 0 });
  await H.ctx.sequelize.query('UPDATE "Users" SET "spinsUsed" = NULL WHERE id = :id', { replacements: { id: u.id } });
  const r = await H.api('POST', '/api/rewards/use-spin', u.token, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(Number((await H.ctx.M('User').findByPk(u.id)).spinsUsed), 1);
  assert.equal(r.body.spinsAvailable, 1);
});
