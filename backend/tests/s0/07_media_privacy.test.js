// S0 item 7: chat photos, bills, basket photos and delivery proof are private media. Authorised viewers get
// short-lived signed links in API / socket payloads; anyone else (by raw URL) gets 404. Someone else's
// private upload can never be attached anywhere; ID cards must be private; chat / lost & found refuse
// external image links; classwork fileUrl is validated.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const H = require('./helpers');

let alice; let bob; let eve; let chat; let rider; let rider2; let store; let order;
test.before(async () => {
  await H.setup();
  const M = H.ctx.M;
  alice = await H.mkUser({ name: 'Media Alice' });
  bob = await H.mkUser({ name: 'Media Bob' });
  eve = await H.mkUser({ name: 'Media Eve' });
  chat = await M.Conversation.create({ isGroup: false, participants: [alice.id, bob.id] });
  rider = await H.mkRider();
  rider2 = await H.mkRider();
  store = await H.mkStore();
  order = await M.Order.create({ userId: alice.id, restaurantId: store.id, deliveryPartnerId: rider.id, items: [], totalPrice: 300, deliveryFee: 20, finalPrice: 320, paymentMethod: 'COD', status: 'Accepted', category: 'mega basket' });
});
test.after(() => H.teardown());

const upload = async (user, purpose) => H.api('POST', '/api/campus/media', user.token, { image: H.pngDataUrl(), purpose });

test('chat / bill / basket / delivery-proof uploads are private; raw URL is 404 for others, signed link works', async () => {
  for (const purpose of ['chat', 'bill', 'basket', 'delivery_proof']) {
    const up = await upload(alice, purpose);
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    assert.strictEqual(up.body.isPrivate, true, purpose);
    assert.ok(up.body.previewUrl, `${purpose} previewUrl`);
    assert.strictEqual(await H.fetchMedia(up.body.url), 404, `${purpose} anonymous`);
    assert.strictEqual(await H.fetchMedia(up.body.url, eve.token), 404, `${purpose} other student`);
    assert.strictEqual(await H.fetchMedia(up.body.url, alice.token), 200, `${purpose} owner`);
    assert.strictEqual(await H.fetchMedia(up.body.previewUrl), 200, `${purpose} signed`);
  }
  // public purposes stay public (posts, avatars, lost & found, store photos)
  const pub = await upload(alice, 'post');
  assert.strictEqual(pub.body.isPrivate, false);
  assert.strictEqual(await H.fetchMedia(pub.body.url), 200);
  // inline base64 through storeImageRef (socket / bill paths) is private too
  const { storeImageRef } = H.r('utils/imageStore');
  const ref = await storeImageRef(H.pngDataUrl(), { ownerId: bob.id, purpose: 'chat' });
  assert.ok(ref.ok);
  assert.strictEqual(await H.fetchMedia(ref.value), 404);
});

test('chat history (campus + friends) returns signed links to participants; non-participants cannot read', async () => {
  const M = H.ctx.M;
  const ph = await H.media(alice.id, 'chat');
  const legacy = await H.media(alice.id, 'chat', false); // uploaded before S0: stays public, URL unchanged
  await M.Message.create({ conversationId: chat.id, senderId: alice.id, senderName: 'Media Alice', text: '', type: 'image', mediaUrl: `http://x.test${ph.path}` });
  await M.Message.create({ conversationId: chat.id, senderId: alice.id, senderName: 'Media Alice', text: '', type: 'image', mediaUrl: legacy.path });
  let r = await H.api('GET', `/api/campus/chats/${chat.id}/messages`, bob.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const urls = r.body.messages.map((m) => m.mediaUrl);
  const signed = urls.find((u) => u && u.includes(ph.id));
  assert.match(signed, /\?exp=\d+&sig=[0-9a-f]{32}$/);
  assert.strictEqual(await H.fetchMedia(signed), 200);
  assert.ok(urls.includes(legacy.path), 'legacy public row untouched');
  r = await H.api('GET', `/api/friends/messages/${chat.id}`, bob.token);
  assert.ok(r.body.some((m) => m.mediaUrl && m.mediaUrl.includes(ph.id) && /sig=/.test(m.mediaUrl)));
  r = await H.api('GET', `/api/chat/conversations/${chat.id}/messages`, bob.token);
  assert.ok(r.body.some((m) => m.mediaUrl && m.mediaUrl.includes(ph.id) && /sig=/.test(m.mediaUrl)));
  r = await H.api('GET', `/api/campus/chats/${chat.id}/messages`, eve.token);
  assert.strictEqual(r.status, 403);
  // a chat message that references someone's ID card is never signed in a chat context
  const idc = await H.media(eve.id, 'id_card');
  await M.Message.create({ conversationId: chat.id, senderId: alice.id, senderName: 'Media Alice', text: '', type: 'image', mediaUrl: idc.path });
  r = await H.api('GET', `/api/campus/chats/${chat.id}/messages`, bob.token);
  assert.ok(!JSON.stringify(r.body).includes(idc.id), 'foreign private media dropped');
});

test('someone else\'s private upload cannot be attached (storeImageRef); own one can; admins can', async () => {
  const { storeImageRef } = H.r('utils/imageStore');
  const theirs = await H.media(eve.id, 'id_card');
  let res = await storeImageRef(theirs.path, { ownerId: alice.id, purpose: 'chat' });
  assert.strictEqual(res.ok, false);
  res = await storeImageRef(`https://evil.example${theirs.path}`, { ownerId: alice.id, purpose: 'bill' });
  assert.strictEqual(res.ok, false, 'absolute form on another host is normalised and refused too');
  res = await storeImageRef(theirs.path, { ownerId: eve.id, purpose: 'chat' });
  assert.strictEqual(res.ok, true);
  res = await storeImageRef(theirs.path, { req: { user: { id: alice.id, role: 'admin' }, get: () => '127.0.0.1', protocol: 'http' }, purpose: 'other' });
  assert.strictEqual(res.ok, true);
  const pub = await H.media(eve.id, 'post');
  res = await storeImageRef(pub.path, { ownerId: alice.id, purpose: 'post' });
  assert.strictEqual(res.ok, true, 'public media can be shared');
  res = await storeImageRef('https://tracker.example/pixel.png', { ownerId: alice.id, purpose: 'chat', allowExternal: false });
  assert.strictEqual(res.ok, false);
});

test('order bill: rider uploads (private), customer sees a signed link, raw URL 404, foreign media refused', async () => {
  let r = await H.api('PUT', `/api/orders/${order.id}/upload-bill-proof`, rider.token, { billProofUrl: H.pngDataUrl(), billAmount: 290 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.order.billProofUrl, /sig=/, 'rider response signed');
  const stored = (await H.ctx.M.Order.findByPk(order.id)).billProofUrl;
  assert.ok(!/sig=/.test(stored), 'database keeps the plain media URL');
  assert.strictEqual(await H.fetchMedia(stored), 404);
  const bc = H.ctx.emitted.find((e) => e.ev === 'statusUpdated' && e.p && e.p.billProofUrl);
  assert.match(bc.p.billProofUrl, /sig=/, 'socket broadcast signed');
  r = await H.api('GET', `/api/orders/${order.id}`, alice.token);
  assert.strictEqual(r.status, 200);
  assert.match(r.body.billProofUrl, /sig=/);
  assert.strictEqual(await H.fetchMedia(r.body.billProofUrl), 200);
  r = await H.api('GET', '/api/orders/myorders', alice.token);
  assert.match(r.body.find((o) => o.id === order.id).billProofUrl, /sig=/);
  // other people cannot read the order
  r = await H.api('GET', `/api/orders/${order.id}`, eve.token);
  assert.strictEqual(r.status, 403);
  // a rider cannot attach another person's private photo as the bill
  const idc = await H.media(eve.id, 'id_card');
  await H.ctx.M.Order.update({ billProofUrl: null }, { where: { id: order.id } });
  r = await H.api('PUT', `/api/orders/${order.id}/upload-bill-proof`, rider.token, { billProofUrl: idc.path, billAmount: 290 });
  assert.strictEqual(r.status, 400);
  r = await H.api('PUT', `/api/orders/${order.id}/upload-bill-proof`, rider2.token, { billProofUrl: H.pngDataUrl(), billAmount: 290 });
  assert.strictEqual(r.status, 403);
});

test('ID card must be the student\'s own PRIVATE upload', async () => {
  const newbie = await H.mkUser({ name: 'Unverified Uma', verified: false });
  const pub = await H.media(newbie.id, 'post');
  let r = await H.api('POST', '/api/campus/verify/upload-id', newbie.token, { idCardImageUrl: pub.path });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'ID_IMAGE_REQUIRED');
  const priv = await H.media(newbie.id, 'id_card');
  r = await H.api('POST', '/api/campus/verify/upload-id', newbie.token, { idCardImageUrl: priv.path });
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.body));
  r = await H.api('POST', '/api/campus/verify/upload-id', newbie.token, { idCardImageUrl: 'https://example.com/id.png' });
  assert.strictEqual(r.status, 400);
});

test('lost & found refuses external image links; classwork fileUrl validated', async () => {
  let r = await H.api('POST', '/api/campus/lost-found', alice.token, { type: 'lost', title: 'Blue bottle', location: 'Library', imageUrl: 'https://tracker.example/x.png' });
  assert.strictEqual(r.status, 400, JSON.stringify(r.body));
  r = await H.api('POST', '/api/campus/lost-found', alice.token, { type: 'lost', title: 'Blue bottle', location: 'Library', imageUrl: H.pngDataUrl() });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));

  const M = H.ctx.M;
  const cls = await M.Conversation.create({ isGroup: true, name: 'Class', type: 'class', participants: [alice.id, bob.id], adminIds: [bob.id] });
  const a = await M.ClassAssignment.create({ conversationId: cls.id, facultyId: bob.id, facultyName: 'Prof Bob', title: 'HW1', dueDate: new Date(Date.now() + 86400000) });
  const submit = (fileUrl) => H.api('POST', `/api/campus/assignments/${a.id}/submit`, alice.token, { submissionText: 'done', fileUrl });
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'http://plain.example/x', `${'https://x.example/'}${'a'.repeat(2100)}`]) {
    r = await submit(bad);
    assert.strictEqual(r.status, 400, bad.slice(0, 30));
  }
  const theirs = await H.media(eve.id, 'chat');
  r = await submit(theirs.path);
  assert.strictEqual(r.status, 400);
  r = await submit('https://github.com/alice/hw1');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const mine = await H.media(alice.id, 'other');
  r = await submit(mine.path);
  assert.strictEqual(r.status, 200);
});

test('campus socket: chat photo from an external URL refused; own private photo broadcast as a signed link', async () => {
  const { Server } = require(path.join(H.B, 'node_modules/socket.io'));
  const ioc = require(path.join(H.B, 'node_modules/socket.io-client'));
  const srv = http.createServer();
  const io = new Server(srv);
  H.r('modules/campus/campusSocket').initCampusSocket(io);
  await require('../listenFree').listenFree(srv);
  const url = `http://127.0.0.1:${srv.address().port}/campus`;
  const sa = ioc(url, { auth: { token: alice.token }, transports: ['websocket'] });
  const sb = ioc(url, { auth: { token: bob.token }, transports: ['websocket'] });
  try {
    await Promise.all([sa, sb].map((s) => new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); })));
    const emitAck = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
    await emitAck(sa, 'chat:join', { chatId: chat.id });
    await emitAck(sb, 'chat:join', { chatId: chat.id });
    let ack = await emitAck(sa, 'message:send', { chatId: chat.id, type: 'image', mediaUrl: 'https://tracker.example/p.png', clientMsgId: 'c1' });
    assert.strictEqual(ack.code, 'BAD_MEDIA', JSON.stringify(ack));
    const theirs = await H.media(eve.id, 'chat');
    ack = await emitAck(sa, 'message:send', { chatId: chat.id, type: 'image', mediaUrl: theirs.path, clientMsgId: 'c2' });
    assert.strictEqual(ack.code, 'BAD_MEDIA', 'someone else\'s private photo refused');
    const mine = await upload(alice, 'chat');
    const got = new Promise((res) => sb.on('message:new', (m) => { if (m.clientMsgId === 'c3') res(m); }));
    ack = await emitAck(sa, 'message:send', { chatId: chat.id, type: 'image', mediaUrl: mine.body.url, clientMsgId: 'c3' });
    assert.ok(!ack.error, JSON.stringify(ack));
    const m = await got;
    assert.match(m.mediaUrl, /sig=/);
    assert.strictEqual(await H.fetchMedia(m.mediaUrl), 200);
  } finally {
    sa.close(); sb.close();
    io.close();
    await new Promise((res) => srv.close(() => res()));
  }
});

test('mega basket: item proof photos come back signed to the basket owner (list + detail)', async () => {
  const M = H.ctx.M;
  const ph = await H.media(rider.id, 'basket');
  const basket = await M.MegaBasket.create({ userId: alice.id, deliveryPartnerId: rider.id, estimatedTotal: 200, deliveryAddress: 'Hostel A', status: 'Shopping' });
  await M.MegaBasketItem.create({ basketId: basket.id, name: 'Milk', photoProofUrl: ph.path });
  let r = await H.api('GET', `/api/mega-basket/${basket.id}`, alice.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.items[0].photoProofUrl, /sig=/);
  assert.strictEqual(await H.fetchMedia(r.body.items[0].photoProofUrl), 200);
  r = await H.api('GET', '/api/mega-basket', alice.token);
  assert.match(r.body.find((b) => b.id === basket.id).items[0].photoProofUrl, /sig=/);
  r = await H.api('GET', `/api/mega-basket/${basket.id}`, eve.token);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(await H.fetchMedia(ph.path), 404);
});
