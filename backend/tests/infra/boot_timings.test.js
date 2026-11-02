// utils/bootTimings (2 Nov 2026): startup phases in ms since process start for /api/health?infra=1; the first mark
// of a name wins (a later retry of the same phase does not move it), and snapshot() is a copy.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { mark, snapshot } = require(path.join(__dirname, '..', '..', 'utils', 'bootTimings'));

test('marks are ms since process start, first one wins, snapshot is a copy', async () => {
  const a = mark('phaseA');
  assert.ok(Number.isInteger(a) && a > 0 && a <= Math.round(process.uptime() * 1000));
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(mark('phaseA'), a, 'the first mark of a name counts');
  const b = mark('phaseB');
  assert.ok(b >= a + 15, `${b} after ${a}`);
  const snap = snapshot();
  assert.deepStrictEqual(snap, { phaseA: a, phaseB: b });
  snap.phaseA = 0;
  assert.strictEqual(snapshot().phaseA, a, 'snapshot() is a copy');
});
