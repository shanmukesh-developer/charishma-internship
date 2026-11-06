// Bug hunt 6 Nov 2026 (M7): polls inside an anonymous Connect chat must not expose account ids. The creator
// and every other voter appear only as their Connect alias (same masking as the chat history); an ended match
// loses poll access like it loses the chat. Ordinary group polls are unchanged.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let alice; let bob; let carol; let connectConv; let group; let bobProfile;
test.before(async () => {
  await H.setup();
  const M = H.ctx.M;
  alice = await H.mkUser({ name: 'Alice Pollname' });
  bob = await H.mkUser({ name: 'Bob Hiddenname' });
  carol = await H.mkUser({ name: 'Carol Grouppoll' });
  await M.ConnectProfile.create({ userId: alice.id, campusId: H.ctx.campus.id, displayName: 'Poll A', status: 'active' });
  bobProfile = await M.ConnectProfile.create({ userId: bob.id, campusId: H.ctx.campus.id, displayName: 'Poll B', status: 'active' });
  connectConv = await M.Conversation.create({ isGroup: false, participants: [alice.id, bob.id], refType: 'connect' });
  const [low, high] = [alice.id, bob.id].sort();
  const match = await M.ConnectMatch.create({ userLowId: low, userHighId: high, status: 'active', conversationId: connectConv.id });
  await connectConv.update({ refId: match.id });
  group = await M.Conversation.create({ isGroup: true, name: 'S0 Poll Group', participants: [carol.id, alice.id, bob.id], adminIds: [carol.id] });
});
test.after(() => H.teardown());

test('Connect chat poll: creator and voters are Connect aliases, never account ids', async () => {
  const created = await H.api('POST', '/api/campus/polls', bob.token, { conversationId: connectConv.id, question: 'Coffee or tea?', options: ['Coffee', 'Tea'], isAnonymous: false });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const pollId = created.body.poll.id;
  // the creator sees their own id (it is theirs), nobody else's
  assert.strictEqual(created.body.poll.creatorId, bob.id);
  const voted = await H.api('POST', `/api/campus/polls/${pollId}/vote`, bob.token, { optionIndexes: [0] });
  assert.strictEqual(voted.status, 200, JSON.stringify(voted.body));
  assert.deepStrictEqual(voted.body.poll.votes['0'], [bob.id], 'own vote still recognisable');

  const mine = await H.api('POST', `/api/campus/polls/${pollId}/vote`, alice.token, { optionIndexes: [1] });
  assert.strictEqual(mine.status, 200, JSON.stringify(mine.body));
  assert.ok(!JSON.stringify(mine.body).includes(bob.id), 'vote answer leaks the peer account id');
  assert.deepStrictEqual(mine.body.poll.votes['1'], [alice.id], 'own vote still recognisable');

  const list = await H.api('GET', `/api/campus/polls/${connectConv.id}`, alice.token);
  assert.strictEqual(list.status, 200, JSON.stringify(list.body));
  const s = JSON.stringify(list.body);
  assert.ok(!s.includes(bob.id), 'poll list leaks the peer account id');
  const p = list.body.polls[0];
  assert.strictEqual(p.creatorId, String(bobProfile.id));
  assert.deepStrictEqual(p.votes['0'], [String(bobProfile.id)]);
  assert.deepStrictEqual(p.voteCounts, { 0: 1, 1: 1 });
  // and the other way round
  const bobView = await H.api('GET', `/api/campus/polls/${connectConv.id}`, bob.token);
  assert.ok(!JSON.stringify(bobView.body).includes(alice.id), 'poll list leaks the peer account id');
});

test('ended Connect match: polls are refused like the chat itself', async () => {
  await H.ctx.M.ConnectMatch.update({ status: 'unmatched' }, { where: { id: connectConv.refId } });
  const list = await H.api('GET', `/api/campus/polls/${connectConv.id}`, alice.token);
  assert.strictEqual(list.status, 403, JSON.stringify(list.body));
  const create = await H.api('POST', '/api/campus/polls', alice.token, { conversationId: connectConv.id, question: 'Still here?', options: ['Yes', 'No'] });
  assert.strictEqual(create.status, 403);
});

test('ordinary group poll: voter ids unchanged (non-anonymous poll)', async () => {
  const created = await H.api('POST', '/api/campus/polls', carol.token, { conversationId: group.id, question: 'Study at 6?', options: ['Yes', 'No'] });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  await H.api('POST', `/api/campus/polls/${created.body.poll.id}/vote`, bob.token, { optionIndexes: [0] });
  const list = await H.api('GET', `/api/campus/polls/${group.id}`, alice.token);
  assert.strictEqual(list.status, 200);
  const p = list.body.polls.find((x) => x.id === created.body.poll.id);
  assert.strictEqual(p.creatorId, carol.id);
  assert.deepStrictEqual(p.votes['0'], [bob.id]);
});
