// S0 item 1 (P1-1): legacy /api/chat list + history no longer leak Connect identities, group internals,
// expired / deleted / moderated messages; the avatar endpoint needs a signed link or a signed-in account.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let alice; let bob; let carol; let connectConv; let group; let dm;
test.before(async () => {
  await H.setup();
  const M = H.ctx.M;
  alice = await H.mkUser({ name: 'Alice Realname' });
  bob = await H.mkUser({ name: 'Bob Secretsurname' });
  carol = await H.mkUser({ name: 'Carol Groupadmin' });
  // Connect match chat between alice and bob (aliases only).
  await M.ConnectProfile.create({ userId: alice.id, campusId: H.ctx.campus.id, displayName: 'Ali C', status: 'active' });
  await M.ConnectProfile.create({ userId: bob.id, campusId: H.ctx.campus.id, displayName: 'Mystery B', status: 'active' });
  connectConv = await M.Conversation.create({ isGroup: false, participants: [alice.id, bob.id], refType: 'connect' });
  const [low, high] = [alice.id, bob.id].sort();
  const match = await M.ConnectMatch.create({ userLowId: low, userHighId: high, status: 'active', conversationId: connectConv.id });
  await connectConv.update({ refId: match.id });
  await M.Message.create({ conversationId: connectConv.id, senderId: bob.id, senderName: 'Bob Secretsurname', text: 'hi from connect' });
  // Group: carol is the admin, alice a member.
  group = await M.Conversation.create({ isGroup: true, name: 'S0 Study', participants: [carol.id, alice.id, bob.id], adminIds: [carol.id], joinCode: 'S0JOIN99' });
  dm = await M.Conversation.create({ isGroup: false, participants: [alice.id, carol.id] });
});
test.after(() => H.teardown());

test('conversation list drops Connect / task chats and strips group internals for members', async () => {
  const r = await H.api('GET', '/api/chat/conversations', alice.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const ids = r.body.map((c) => c.id);
  assert.ok(!ids.includes(connectConv.id), 'Connect chat must not be listed');
  assert.ok(ids.includes(dm.id) && ids.includes(group.id));
  const g = r.body.find((c) => c.id === group.id);
  assert.strictEqual(g.joinCode, undefined);
  assert.strictEqual(g.adminIds, undefined);
  assert.strictEqual(g.participants, undefined);
  assert.strictEqual(g.participantCount, 3);
  assert.ok(!JSON.stringify(r.body).includes(bob.id), 'no Connect peer account id anywhere');
  // the group admin still gets the internals
  const ra = await H.api('GET', '/api/chat/conversations', carol.token);
  const ga = ra.body.find((c) => c.id === group.id);
  assert.strictEqual(ga.joinCode, 'S0JOIN99');
  assert.deepStrictEqual(ga.adminIds, [carol.id]);
});

test('Connect history through /api/chat is masked (alias + Connect name only)', async () => {
  const r = await H.api('GET', `/api/chat/conversations/${connectConv.id}/messages`, alice.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes(bob.id), 'peer account id leaked');
  assert.ok(!s.includes('Secretsurname'), 'peer real name leaked');
  assert.strictEqual(r.body[0].senderName, 'Mystery B');
  // ended match -> unreadable (conversationGuard)
  await H.ctx.M.ConnectMatch.update({ status: 'unmatched' }, { where: { id: connectConv.refId } });
  const e = await H.api('GET', `/api/chat/conversations/${connectConv.id}/messages`, alice.token);
  assert.strictEqual(e.status, 403);
  assert.strictEqual(e.body.code, 'MATCH_ENDED');
});

test('history hides expired / deleted-for-me messages and blanks deleted-for-everyone ones', async () => {
  const M = H.ctx.M;
  await M.Message.create({ conversationId: dm.id, senderId: carol.id, senderName: 'Carol', text: 'visible one' });
  await M.Message.create({ conversationId: dm.id, senderId: carol.id, senderName: 'Carol', text: 'expired one', expiresAt: new Date(Date.now() - 60000) });
  await M.Message.create({ conversationId: dm.id, senderId: carol.id, senderName: 'Carol', text: 'hidden for alice', deletedFor: JSON.stringify([alice.id]) });
  await M.Message.create({ conversationId: dm.id, senderId: carol.id, senderName: 'Carol', text: 'moderated secret', isDeletedForEveryone: true, mediaUrl: '/api/campus/media/00000000-0000-4000-8000-000000000001' });
  const r = await H.api('GET', `/api/chat/conversations/${dm.id}/messages`, alice.token);
  assert.strictEqual(r.status, 200);
  const texts = r.body.map((m) => m.text);
  assert.ok(texts.includes('visible one'));
  assert.ok(!texts.includes('expired one'));
  assert.ok(!texts.includes('hidden for alice'));
  assert.ok(!texts.includes('moderated secret'));
  const del = r.body.find((m) => m.isDeletedForEveryone);
  assert.strictEqual(del.text, 'This message was deleted');
  assert.strictEqual(del.mediaUrl, null);
  // carol (not deleted-for) still sees her own
  const rc = await H.api('GET', `/api/chat/conversations/${dm.id}/messages`, carol.token);
  assert.ok(rc.body.map((m) => m.text).includes('hidden for alice'));
});

test('group history leaves out people blocked with the viewer', async () => {
  const M = H.ctx.M;
  await M.Message.create({ conversationId: group.id, senderId: bob.id, senderName: 'Bob', text: 'from bob' });
  await M.Message.create({ conversationId: group.id, senderId: carol.id, senderName: 'Carol', text: 'from carol' });
  await M.Friendship.create({ requesterId: alice.id, recipientId: bob.id, status: 'blocked' });
  try { H.r('modules/friends/services/blocks').clearBlocks(); } catch { /* optional cache */ }
  const r = await H.api('GET', `/api/chat/conversations/${group.id}/messages`, alice.token);
  const texts = r.body.map((m) => m.text);
  assert.ok(texts.includes('from carol'));
  assert.ok(!texts.includes('from bob'));
});

test('avatar endpoint: anonymous id lookup refused; signed link and signed-in viewer work; private rows never redirected', async () => {
  const img = H.pngDataUrl();
  const dave = await H.mkUser({ name: 'Dave Avatar', profileImage: img });
  // anonymous by id -> 404 (was a 200 with the photo)
  let r = await H.api('GET', `/api/campus/avatar/${dave.id}`);
  assert.strictEqual(r.status, 404);
  r = await H.api('GET', `/api/campus/avatar/${dave.id}?v=abc&s=${'0'.repeat(24)}`);
  assert.strictEqual(r.status, 404, 'forged signature refused');
  // the signed link the API hands out works without a token
  const link = H.r('modules/campus/campusHelpers').avatarUrlFor(null, { id: dave.id, profileImage: img });
  assert.match(link, /\?v=[0-9a-f]+&s=[0-9a-f]{24}$/);
  assert.strictEqual(await H.fetchMedia(link), 200);
  // a stored pre-S0 link (no s=) is re-signed by the community feed helper
  const unsigned = link.replace(/&s=.*$/, '');
  assert.strictEqual(await H.fetchMedia(unsigned), 404);
  assert.strictEqual(await H.fetchMedia(H.r('modules/campus/campusHelpers').resignAvatarUrl(unsigned)), 200);
  // signed-in viewer by id
  assert.strictEqual(await H.fetchMedia(`/api/campus/avatar/${dave.id}`, alice.token), 200);
  // a profile photo pointing at a PRIVATE media row (e.g. a Connect photo) is never redirected to
  const priv = await H.media(dave.id, 'connect');
  await H.ctx.M.User.update({ profileImage: priv.path }, { where: { id: dave.id } });
  r = await H.api('GET', `/api/campus/avatar/${dave.id}`, alice.token);
  assert.strictEqual(r.status, 404);
  const pub = await H.media(dave.id, 'avatar');
  await H.ctx.M.User.update({ profileImage: pub.path }, { where: { id: dave.id } });
  r = await H.api('GET', `/api/campus/avatar/${dave.id}`, alice.token);
  assert.strictEqual(r.status, 302);
});
