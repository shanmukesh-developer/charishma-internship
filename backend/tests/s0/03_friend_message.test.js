// S0 item 3 (P1-3): POST /api/friends/message is the 1:1 friend chat. Group conversations are refused
// (they skipped onlyAdminsCanSend / blocks / sanctions here); sanctioned authors cannot post; 1:1 still works.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let a; let b; let c; let dm; let group; let friendship;
test.before(async () => {
  await H.setup();
  const M = H.ctx.M;
  a = await H.mkUser({ name: 'Fm Alpha' });
  b = await H.mkUser({ name: 'Fm Beta' });
  c = await H.mkUser({ name: 'Fm Gamma' });
  friendship = await M.Friendship.create({ requesterId: a.id, recipientId: b.id, status: 'accepted' });
  dm = await M.Conversation.create({ isGroup: false, participants: [a.id, b.id] });
  group = await M.Conversation.create({ isGroup: true, name: 'Announcements', participants: [a.id, b.id, c.id], adminIds: [c.id], onlyAdminsCanSend: true });
});
test.after(() => H.teardown());

test('group conversation is refused (members could bypass onlyAdminsCanSend / blocks)', async () => {
  const r = await H.api('POST', '/api/friends/message', a.token, { conversationId: group.id, text: 'not an admin' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'GROUP_USE_CHAT');
  assert.strictEqual(await H.ctx.M.Message.count({ where: { conversationId: group.id } }), 0);
  // even the group admin uses the campus socket for groups
  const r2 = await H.api('POST', '/api/friends/message', c.token, { conversationId: group.id, text: 'hi all' });
  assert.strictEqual(r2.status, 403);
});

test('1:1 friend chat still works, by conversation id and by friendship id', async () => {
  let r = await H.api('POST', '/api/friends/message', a.token, { conversationId: dm.id, text: 'hello b' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  r = await H.api('POST', '/api/friends/message', b.token, { friendshipId: friendship.id, text: 'hello a' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const h = await H.api('GET', `/api/friends/messages/${dm.id}`, a.token);
  assert.deepStrictEqual(h.body.map((m) => m.text), ['hello b', 'hello a']);
});

test('a sanctioned author cannot post', async () => {
  await H.ctx.M.FriendsSanction.create({ userId: a.id, scope: 'friends', until: null, reason: 's0 test' });
  H.r('modules/friends/services/eligibility').clearEligibility();
  const r = await H.api('POST', '/api/friends/message', a.token, { conversationId: dm.id, text: 'still here' });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'FRIENDS_SANCTIONED');
});
