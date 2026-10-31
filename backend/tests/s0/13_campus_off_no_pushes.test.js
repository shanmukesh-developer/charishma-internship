// Campus switched off (Admin > Friends app > Switches > "Campus (Friends) for students", 31 Oct 2026): no Campus
// push goes out, so a scheduled job (Space reminders, task expiry) never sends a student into the closed tab. On
// again: pushes flow as before.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(async () => { await H.setup(); });
test.after(async () => { await H.teardown(); });

test('Campus off: Campus notifications send nothing; switched on again, they send', async () => {
  const flags = H.r('modules/friends/services/featureFlags');
  const N = H.r('modules/friends/services/notify');
  const sent = [];
  N.pusher.send = async (ids, title) => { sent.push({ ids, title }); };
  const who = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'];
  try {
    N.resetDedupe();
    const off = await flags.setConfig({ enabled: false });
    assert.ok(!off.errors, JSON.stringify(off.errors));
    assert.deepStrictEqual(await N.notify('SPACE_REMINDER', who, { id: 'space-1' }), [], 'nobody notified while off');
    assert.strictEqual(sent.length, 0, 'no push sent while off');

    const on = await flags.setConfig({ enabled: true });
    assert.ok(!on.errors, JSON.stringify(on.errors));
    const got = await N.notify('SPACE_REMINDER', who, { id: 'space-1' });
    assert.deepStrictEqual(got.sort(), [...who].sort(), 'both notified once Campus is on (not held back by the earlier try)');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].title, N.TYPES.SPACE_REMINDER.title);
  } finally {
    N.pusher.send = null;
    N.resetDedupe();
    await flags.setConfig({ enabled: true });
  }
});
