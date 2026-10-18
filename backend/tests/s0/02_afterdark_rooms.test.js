// S0 item 2 (P1-2): a member the room admin kicked loses After Dark access (history + sockets), an inactive
// room grants nothing, and the kick takes the person's live sockets out of the chat + call rooms.
// (The live socket re-check on send / react is covered by 11_server_sockets.test.js.)
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let member; let other; let room;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ name: 'Room Admin' });
  member = await H.mkUser({ name: 'Room Member' });
  other = await H.mkUser({ name: 'Room Other' });
});
test.after(() => H.teardown());

const { getAfterDarkAccess } = require('../../utils/afterDarkAccess');

test('members can read the room; kick -> no access, no history, sockets removed everywhere', async () => {
  let r = await H.api('POST', '/api/rooms/create', admin.token, { name: 'Late night' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  room = r.body.room;
  r = await H.api('POST', '/api/rooms/join', member.token, { joinCode: room.joinCode });
  assert.strictEqual(r.status, 200);
  await H.ctx.M.Message.create({ conversationId: room.id, senderId: admin.id, senderName: 'Room Admin', text: 'room secret' });
  assert.ok(await getAfterDarkAccess(member.id, room.id));
  r = await H.api('GET', `/api/chat/conversations/${room.id}/messages`, member.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body[0].text, 'room secret');

  H.ctx.left.length = 0;
  r = await H.api('POST', '/api/rooms/kick', admin.token, { roomId: room.id, targetUserId: member.id });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(await getAfterDarkAccess(member.id, room.id), null, 'kicked member keeps no access');
  r = await H.api('GET', `/api/chat/conversations/${room.id}/messages`, member.token);
  assert.strictEqual(r.status, 403);
  const leave = H.ctx.left.find((l) => l.room === `user_${member.id}`);
  assert.ok(leave, 'socketsLeave on the user room');
  assert.deepStrictEqual(leave.rooms.sort(), [`afterdark_${room.id}`, `afterdark_call_${room.id}`].sort());
  assert.ok(H.ctx.emitted.some((e) => e.room === `user_${member.id}` && e.ev === 'after_dark_removed'));
  // the code does not let them back in
  r = await H.api('POST', '/api/rooms/join', member.token, { joinCode: room.joinCode });
  assert.strictEqual(r.status, 403);
  // the admin still has access
  assert.ok(await getAfterDarkAccess(admin.id, room.id));
});

test('an inactive (closed) room grants nothing; a non-member never had access', async () => {
  assert.strictEqual(await getAfterDarkAccess(other.id, room.id), null);
  await H.ctx.M.Room.update({ isActive: false }, { where: { id: room.id } });
  assert.strictEqual(await getAfterDarkAccess(admin.id, room.id), null);
});
