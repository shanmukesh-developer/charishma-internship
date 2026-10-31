// Whispers privacy (31 Oct 2026): every whisper of one person carries the same alias, so a feed that hid a blocked
// author's whispers let anyone unmask that author (block a suspect, watch the alias vanish, unblock). Blocking now
// changes nothing in the anonymous feed, and the author id is never sent.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

test('blocking someone never hides or reveals their anonymous whispers', async () => {
  const author = await H.mkUser({ name: 'Secret Author' });
  const viewer = await H.mkUser({ name: 'Curious Viewer' });
  const post = await H.api('POST', '/api/campus/pulse/whispers', author.token, { text: 'nobody knows this is me', topic: 'Late Night' });
  assert.ok(post.status === 200 || post.status === 201, JSON.stringify(post.body));

  const aliasesSeen = async () => {
    const r = await H.api('GET', '/api/campus/pulse/whispers', viewer.token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    for (const w of r.body.whispers) {
      assert.ok(!('userId' in w) && !('authorId' in w), 'no author id is ever sent');
    }
    return r.body.whispers.map((w) => `${w.alias}|${w.text}`).sort();
  };
  const before = await aliasesSeen();
  assert.ok(before.some((x) => x.endsWith('|nobody knows this is me')), 'the whisper is listed');

  const blk = await H.api('POST', '/api/friends/block', viewer.token, { userId: author.id });
  assert.ok(blk.status < 300, JSON.stringify(blk.body));
  assert.deepStrictEqual(await aliasesSeen(), before, 'the feed is identical after blocking the author');
});

test('account blocks are capped at 20 a day (probing pseudonymous profiles by block / unblock is impractical)', async () => {
  const me = await H.mkUser({ name: 'Block Prober' });
  let last;
  for (let i = 0; i < 21; i++) {
    const other = await H.mkUser({ name: `Target ${i}` });
    last = await H.api('POST', '/api/friends/block', me.token, { userId: other.id });
    if (i < 20) assert.ok(last.status < 300, `block ${i + 1}: ${JSON.stringify(last.body)}`);
  }
  assert.strictEqual(last.status, 429, JSON.stringify(last.body));
  assert.strictEqual(last.body.code, 'RATE_LIMITED');
});
