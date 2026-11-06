// S0 items 2 + 9 against the REAL server.js (child process, fresh temp SQLite, Redis unset):
//   - shared carts: per-socket room cap, per-IP join budget (code brute force stops), whitelisted /
//     bounded cart payloads, oversized carts dropped.
//   - After Dark: access re-checked on send / react (unfriended after joining -> refused), a kick
//     removes the live socket from the room, a quoted reply is rebuilt from the database.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const B = path.join(__dirname, '..', '..');
const ioc = require(path.join(B, 'node_modules/socket.io-client'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const SECRET = 's0-socket-test-secret';

const PORT = 21000 + (process.pid % 8000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `s0-srv-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
let child = null;
let logs = '';

const evalIn = async (code) => {
  const r = await fetch(`http://127.0.0.1:${CTRL}/eval`, { method: 'POST', body: code });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.out;
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, 'boot_server.js')], {
    env: { ...process.env, S0_SQLITE: file, PORT: String(PORT), S0_CTRL_PORT: String(CTRL), REDIS_URL: '', REDIS_ENABLED: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d; if (logs.length > 200000) logs = logs.slice(-100000); });
  child.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/chat/status`);
      if (r.status === 200 && await evalIn("const U = require(B + '/models/User').getUserModel(); if (!U) throw new Error('no db'); return await U.count();") !== undefined) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`server did not start:\n${logs.slice(-3000)}`);
});

test.after(async () => {
  if (child) {
    child.kill('SIGKILL');
    await new Promise((res) => { if (child.exitCode !== null) res(); else child.once('exit', res); });
  }
  await sleep(200);
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
});

const connect = (token) => new Promise((res, rej) => {
  const s = ioc(BASE, { transports: ['websocket'], auth: token ? { token } : {}, forceNew: true, reconnection: false });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});
const ack = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const code = (n) => `ZN-${crypto.randomBytes(8).toString('hex').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n)}`;

test('shared cart: 3 rooms per socket, then a per-IP join budget stops brute force', async () => {
  const socks = [];
  try {
    const s = await connect(null);
    socks.push(s);
    let joined = 0;
    for (let i = 0; i < 3; i++) if ((await ack(s, 'joinRoom', code(10))).ok) joined++;
    assert.strictEqual(joined, 3);
    const fourth = await ack(s, 'joinRoom', code(10));
    assert.strictEqual(fourth.code, 'TOO_MANY_BASKETS');
    // more sockets from the same address: 20 joins per 10 min in total
    let ok = 3; let limited = false;
    for (let k = 0; k < 8 && !limited; k++) {
      const t = await connect(null);
      socks.push(t);
      for (let i = 0; i < 3; i++) {
        const a = await ack(t, 'joinRoom', code(8));
        if (a.ok) ok++; else { assert.strictEqual(a.code, 'RATE_LIMITED', JSON.stringify(a)); limited = true; break; }
      }
    }
    assert.ok(limited, 'join budget must stop guessing');
    assert.strictEqual(ok, 20);
  } finally {
    socks.forEach((s) => s.close());
  }
});

test('shared cart: payloads are whitelisted and bounded; oversized carts dropped', async () => {
  // fresh address budget: reset the in-process join counters
  await evalIn("require(B + '/utils/cartRooms').resetJoins(); return 1;");
  const room = code(10);
  const host = await connect(null);
  const mate = await connect(null);
  try {
    assert.ok((await ack(host, 'joinRoom', room)).ok);
    assert.ok((await ack(mate, 'joinRoom', room)).ok);
    const got = new Promise((res) => mate.once('cart_updated', res));
    host.emit('cart_change', { roomCode: room, cart: [{ id: 'm1', name: 'Dosa', quantity: 3, price: 40, evil: 'x'.repeat(5000), image: 'javascript:alert(1)', customizations: { size: 'L', deep: { a: { b: 1 } } } }, { junk: true }] });
    const cart = await got;
    assert.strictEqual(cart.length, 1);
    assert.deepStrictEqual(Object.keys(cart[0]).sort(), ['customizations', 'id', 'name', 'price', 'qty', 'quantity']);
    assert.deepStrictEqual(cart[0].customizations, { size: 'L' });
    // > 32 KB -> dropped (nobody receives it, the snapshot is unchanged)
    let leaked = false;
    mate.once('cart_updated', () => { leaked = true; });
    await sleep(250); // token bucket refill
    host.emit('cart_change', { roomCode: room, cart: Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`.padEnd(60, 'x'), name: 'n'.repeat(80), restaurantName: 'r'.repeat(80), image: `https://cdn.example/${'p'.repeat(500)}` })) });
    await sleep(400);
    assert.strictEqual(leaked, false);
    // a late joiner gets the last good (sanitized) basket
    const late = await connect(null);
    const snap = new Promise((res) => late.once('cart_updated', res));
    assert.ok((await ack(late, 'joinRoom', room)).ok);
    assert.strictEqual((await snap)[0].name, 'Dosa');
    late.close();
  } finally {
    host.close(); mate.close();
  }
});

test('After Dark: access re-checked on send / react; reply quotes rebuilt from the database', async () => {
  const ids = await evalIn(`
    const U = require(B + '/models/User').getUserModel();
    const F = require(B + '/models/Friendship').getFriendshipModel();
    const a = await U.create({ name: 'Ad Alpha', phone: '7900000001', role: 'student', isActive: true, password: 'x-test-only-1' });
    const b = await U.create({ name: 'Ad Beta', phone: '7900000002', role: 'student', isActive: true, password: 'x-test-only-2' });
    const f = await F.create({ requesterId: a.id, recipientId: b.id, status: 'accepted' });
    return { a: a.id, b: b.id, f: f.id };
  `);
  const tok = (id) => jwt.sign({ id, role: 'student', tv: 0 }, SECRET);
  const sa = await connect(tok(ids.a));
  const sb = await connect(tok(ids.b));
  try {
    sa.emit('join_after_dark_group', { groupId: ids.f });
    sb.emit('join_after_dark_group', { groupId: ids.f });
    await sleep(400);
    const first = new Promise((res) => sb.once('receive_after_dark_message', res));
    sa.emit('send_after_dark_message', { groupId: ids.f, text: 'hello friend' });
    const m1 = await first;
    assert.strictEqual(m1.text, 'hello friend');
    // forged quote: the server rebuilds it from the quoted message of this chat
    const second = new Promise((res) => sb.once('receive_after_dark_message', res));
    sa.emit('send_after_dark_message', { groupId: ids.f, text: 'reply', replyTo: { id: m1.id, senderName: 'Someone Else', text: 'words they never said', extra: 'x'.repeat(10000) } });
    const m2 = await second;
    const rt = typeof m2.replyTo === 'string' ? JSON.parse(m2.replyTo) : m2.replyTo;
    assert.strictEqual(rt.text, 'hello friend');
    assert.strictEqual(rt.senderName, 'Ad Alpha');
    assert.strictEqual(rt.extra, undefined);

    // unfriended after joining: the next send / react is refused (no delivery)
    await evalIn(`await require(B + '/models/Friendship').getFriendshipModel().update({ status: 'removed' }, { where: { id: '${ids.f}' } }); return 1;`);
    let delivered = false;
    sb.on('receive_after_dark_message', () => { delivered = true; });
    let reacted = false;
    sb.on('receive_message_reaction', () => { reacted = true; });
    const err = new Promise((res) => sa.once('after_dark_error', res));
    sa.emit('send_after_dark_message', { groupId: ids.f, text: 'after unfriending' });
    assert.strictEqual((await err).code, 'NOT_A_PARTICIPANT');
    sa.emit('react_to_after_dark_message', { groupId: ids.f, messageId: m1.id, emoji: '🔥' });
    await sleep(500);
    assert.strictEqual(delivered, false);
    assert.strictEqual(reacted, false);
    const stored = await evalIn(`return await require(B + '/models/Message').getMessageModel().count({ where: { conversationId: '${ids.f}' } });`);
    assert.strictEqual(stored, 2);
  } finally {
    sa.close(); sb.close();
  }
});

test('After Dark rooms: a kick takes the member\'s live socket out of the room', async () => {
  const ids = await evalIn(`
    const U = require(B + '/models/User').getUserModel();
    const a = await U.create({ name: 'Room Owner', phone: '7900000011', role: 'student', isActive: true, password: 'x-test-only-11' });
    const b = await U.create({ name: 'Room Guest', phone: '7900000012', role: 'student', isActive: true, password: 'x-test-only-12' });
    return { a: a.id, b: b.id };
  `);
  const tok = (id) => jwt.sign({ id, role: 'student', tv: 0 }, SECRET);
  const api = async (method, url, token, body) => {
    const r = await fetch(BASE + url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const created = await api('POST', '/api/rooms/create', tok(ids.a), { name: 'Midnight' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const room = created.body.room;
  assert.strictEqual((await api('POST', '/api/rooms/join', tok(ids.b), { joinCode: room.joinCode })).status, 200);
  const sa = await connect(tok(ids.a));
  const sb = await connect(tok(ids.b));
  try {
    sa.emit('join_after_dark_group', { groupId: room.id });
    sb.emit('join_after_dark_group', { groupId: room.id });
    await sleep(400);
    const removed = new Promise((res) => sb.once('after_dark_removed', res));
    const k = await api('POST', '/api/rooms/kick', tok(ids.a), { roomId: room.id, targetUserId: ids.b });
    assert.strictEqual(k.status, 200);
    assert.strictEqual((await removed).groupId, room.id);
    let got = false;
    sb.on('receive_after_dark_message', () => { got = true; });
    sa.emit('send_after_dark_message', { groupId: room.id, text: 'only for members' });
    // the kicked socket cannot send either (no longer in the room)
    sb.emit('send_after_dark_message', { groupId: room.id, text: 'kicked but talking' });
    await sleep(600);
    assert.strictEqual(got, false, 'kicked socket still received room messages');
    const texts = await evalIn(`return (await require(B + '/models/Message').getMessageModel().findAll({ where: { conversationId: '${room.id}' } })).map((m) => m.text);`);
    assert.deepStrictEqual(texts, ['only for members']);
    // and rejoining the socket room is refused
    sb.emit('join_after_dark_group', { groupId: room.id });
    await sleep(300);
    sa.emit('send_after_dark_message', { groupId: room.id, text: 'second' });
    await sleep(500);
    assert.strictEqual(got, false);
  } finally {
    sa.close(); sb.close();
  }
});

// Bug hunt 6 Nov 2026 (M8): message:react, receipt:read and message:delete re-check the chat on every event
// (participant + conversationGuard 'join'), so a socket that joined while the Connect match was live cannot
// keep reacting, marking read or deleting after the match ends.
test('Campus chat: react / read receipt / delete refused after the Connect match ends (socket still in the room)', async () => {
  const ids = await evalIn(`
    const U = require(B + '/models/User').getUserModel();
    const C = require(B + '/models/Conversation').getConversationModel();
    const Msg = require(B + '/models/Message').getMessageModel();
    const { getModel } = require(B + '/modules/friends');
    const a = await U.create({ name: 'Cx Alpha', phone: '7900000021', role: 'student', isActive: true, password: 'x-test-only-21' });
    const b = await U.create({ name: 'Cx Beta', phone: '7900000022', role: 'student', isActive: true, password: 'x-test-only-22' });
    const conv = await C.create({ isGroup: false, participants: [a.id, b.id], refType: 'connect' });
    const [low, high] = [a.id, b.id].sort();
    const match = await getModel('ConnectMatch').create({ userLowId: low, userHighId: high, status: 'active', conversationId: conv.id });
    await conv.update({ refId: match.id });
    const m1 = await Msg.create({ conversationId: conv.id, senderId: b.id, senderName: 'Cx Beta', text: 'hello match' });
    const m2 = await Msg.create({ conversationId: conv.id, senderId: a.id, senderName: 'Cx Alpha', text: 'my own words' });
    return { a: a.id, b: b.id, conv: conv.id, match: match.id, m1: m1.id, m2: m2.id };
  `);
  const tok = (id) => jwt.sign({ id, role: 'student', tv: 0 }, SECRET);
  const sa = await new Promise((res, rej) => {
    const s = ioc(`${BASE}/campus`, { transports: ['websocket'], auth: { token: tok(ids.a) }, forceNew: true, reconnection: false });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
  try {
    assert.strictEqual((await ack(sa, 'chat:join', { chatId: ids.conv })).status, 'joined');
    // live match: a reaction works
    assert.strictEqual((await ack(sa, 'message:react', { messageId: ids.m1, emoji: '👍' })).status, 'ok');

    await evalIn(`await require(B + '/modules/friends').getModel('ConnectMatch').update({ status: 'unmatched' }, { where: { id: '${ids.match}' } }); return 1;`);
    const react = await ack(sa, 'message:react', { messageId: ids.m1, emoji: '🔥' });
    assert.ok(react.error, JSON.stringify(react));
    const del = await ack(sa, 'message:delete', { messageId: ids.m2, forEveryone: true });
    assert.ok(del.error, JSON.stringify(del));
    const delMe = await ack(sa, 'message:delete', { messageId: ids.m1, forEveryone: false });
    assert.ok(delMe.error, JSON.stringify(delMe));
    sa.emit('receipt:read', { chatId: ids.conv, messageIds: [ids.m1] });
    await sleep(400);
    const rows = await evalIn(`
      const Msg = require(B + '/models/Message').getMessageModel();
      const m1 = await Msg.findByPk('${ids.m1}'); const m2 = await Msg.findByPk('${ids.m2}');
      return { reactions: m1.reactions, readBy: m1.readBy, deletedFor: m1.deletedFor, m2Deleted: !!m2.isDeletedForEveryone, m2Text: m2.text };
    `);
    assert.deepStrictEqual(JSON.parse(rows.reactions), { [ids.a]: '👍' }, 'reaction changed after the match ended');
    assert.ok(!(rows.readBy || []).some((r) => r.userId === ids.a), 'read receipt stored after the match ended');
    assert.ok(!String(rows.deletedFor || '').includes(ids.a), 'delete-for-me applied after the match ended');
    assert.strictEqual(rows.m2Deleted, false);
    assert.strictEqual(rows.m2Text, 'my own words');
  } finally {
    sa.close();
  }
});
