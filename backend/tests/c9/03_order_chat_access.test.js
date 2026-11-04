// C9: persisted order chat (OrderMessages): who may read it (REST), save rules, the 90-day retention purge
// (also through the hourly retention job), issue tickets with their per-hour budget, legal page text.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let OM;
test.before(async () => {
  await H.setup();
  OM = H.r('utils/orderMessages');
});
test.after(() => H.teardown());

const DAY = 24 * 60 * 60 * 1000;

test('GET /api/orders/:id/messages: customer, current rider and admin only; oldest first; names from accounts', async () => {
  const user = await H.mkUser();
  const other = await H.mkUser();
  const adminU = await H.mkUser({ role: 'admin' });
  const rider = await H.mkRider();
  const rider2 = await H.mkRider();
  const store = await H.mkStore();
  const order = await H.mkOrder({ user, store, rider });

  const a = await OM.saveOrderMessage({ orderId: order.id, actor: { id: user.id, role: 'student' }, text: '  hello rider  ' });
  assert.ok(a && a.id);
  assert.strictEqual(a.text, 'hello rider');
  assert.strictEqual(a.senderType, 'customer');
  await new Promise((res) => setTimeout(res, 15));
  await OM.saveOrderMessage({ orderId: order.id, actor: { id: rider.id, role: 'rider' }, text: 'x'.repeat(800) });
  await new Promise((res) => setTimeout(res, 15));
  await OM.saveOrderMessage({ orderId: order.id, actor: { id: adminU.id, role: 'admin' }, text: 'support here' });
  assert.strictEqual(await OM.saveOrderMessage({ orderId: order.id, actor: { id: user.id, role: 'student' }, text: '   ' }), null, 'empty text not stored');
  assert.strictEqual(await OM.saveOrderMessage({ orderId: 'not-a-uuid', actor: { id: user.id, role: 'student' }, text: 'x' }), null);

  const url = `/api/orders/${order.id}/messages`;
  for (const who of [user, rider, adminU]) {
    const r = await H.api('GET', url, who.token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.messages.length, 3);
    assert.strictEqual(r.body.retentionDays, 90);
  }
  const r = await H.api('GET', url, user.token);
  const [m1, m2, m3] = r.body.messages;
  assert.strictEqual(m1.message, 'hello rider');
  assert.strictEqual(m1.senderRole, 'customer');
  assert.strictEqual(m1.sender, user.name);
  assert.strictEqual(m2.message.length, 500, 'capped at 500 characters');
  assert.strictEqual(m2.sender, rider.name);
  assert.strictEqual(m3.sender, 'ZenWe Support');

  // not a party
  assert.strictEqual((await H.api('GET', url, other.token)).status, 403);
  assert.strictEqual((await H.api('GET', url, rider2.token)).status, 403);
  assert.strictEqual((await H.api('GET', url, store.token)).status, 403, 'the store is not part of the rider chat');
  assert.strictEqual((await H.api('GET', url)).status, 401);
  const drv = await H.mkDriver();
  assert.strictEqual((await H.api('GET', url, drv.token)).status, 401);
  assert.strictEqual((await H.api('GET', `/api/orders/${'0'.repeat(8)}-0000-4000-8000-000000000000/messages`, user.token)).status, 404);

  // reassignment: the old rider loses access at once, the new one gains it
  await order.update({ deliveryPartnerId: rider2.id });
  assert.strictEqual((await H.api('GET', url, rider.token)).status, 403);
  assert.strictEqual((await H.api('GET', url, rider2.token)).status, 200);
  assert.strictEqual(await OM.canAccessOrderChat({ id: rider.id, role: 'rider' }, order.id), false);
  assert.strictEqual(await OM.canAccessOrderChat({ id: rider2.id, role: 'rider' }, order.id), true);
  assert.strictEqual(await OM.canAccessOrderChat({ id: store.id, role: 'restaurant' }, order.id), false);
});

test('Mega Basket ids are order rooms too', async () => {
  const user = await H.mkUser();
  const rider = await H.mkRider();
  const basket = await H.ctx.M('MegaBasket').create({ userId: user.id, deliveryPartnerId: rider.id, status: 'Shopping', estimatedTotal: 200, deliveryAddress: 'Block A' }).catch((e) => { throw new Error(`basket: ${e.message}`); });
  assert.strictEqual(await OM.canAccessOrderChat({ id: user.id, role: 'student' }, basket.id), true);
  assert.strictEqual(await OM.canAccessOrderChat({ id: rider.id, role: 'rider' }, basket.id), true);
  const r = await H.api('GET', `/api/orders/${basket.id}/messages`, rider.token);
  assert.strictEqual(r.status, 200);
});

test('retention: messages older than 90 days are deleted, newer kept; ORDER_CHAT_RETENTION_DAYS overrides', async () => {
  const M = H.ctx.M;
  const user = await H.mkUser();
  const store = await H.mkStore();
  const order = await H.mkOrder({ user, store });
  const old = await M('OrderMessage').create({ orderId: order.id, senderType: 'customer', senderId: user.id, text: 'old' });
  const recent = await M('OrderMessage').create({ orderId: order.id, senderType: 'customer', senderId: user.id, text: 'recent' });
  await H.ctx.sequelize.query('UPDATE "OrderMessages" SET "createdAt" = ? WHERE id = ?', { replacements: [new Date(Date.now() - 91 * DAY).toISOString().replace('T', ' ').replace('Z', ' +00:00'), old.id] });
  await H.ctx.sequelize.query('UPDATE "OrderMessages" SET "createdAt" = ? WHERE id = ?', { replacements: [new Date(Date.now() - 30 * DAY).toISOString().replace('T', ' ').replace('Z', ' +00:00'), recent.id] });
  const n = await OM.purgeOldOrderMessages();
  assert.ok(n >= 1);
  assert.strictEqual(await M('OrderMessage').findByPk(old.id), null);
  assert.ok(await M('OrderMessage').findByPk(recent.id));
  process.env.ORDER_CHAT_RETENTION_DAYS = '7';
  try {
    assert.strictEqual(OM.retentionDays(), 7);
    await OM.purgeOldOrderMessages();
    assert.strictEqual(await M('OrderMessage').findByPk(recent.id), null);
  } finally {
    delete process.env.ORDER_CHAT_RETENTION_DAYS;
  }
  assert.strictEqual(OM.retentionDays(), 90);
});

test('the hourly retention job also purges order chat', async () => {
  const M = H.ctx.M;
  const user = await H.mkUser();
  const store = await H.mkStore();
  const order = await H.mkOrder({ user, store });
  const old = await M('OrderMessage').create({ orderId: order.id, senderType: 'customer', senderId: user.id, text: 'very old' });
  await H.ctx.sequelize.query('UPDATE "OrderMessages" SET "createdAt" = ? WHERE id = ?', { replacements: [new Date(Date.now() - 200 * DAY).toISOString().replace('T', ' ').replace('Z', ' +00:00'), old.id] });
  const jobs = H.r('jobs/index');
  const out = await H.silent(() => jobs.runJob('retention.chatPulse'));
  const result = out && (out.result || out);
  assert.ok(result && typeof result.orderChat === 'number', JSON.stringify(out));
  assert.ok(result.orderChat >= 1);
  assert.strictEqual(await M('OrderMessage').findByPk(old.id), null);
});

test('createIssueTicket: customer -> userId, rider -> riderId, linked to the order; 3 per reporter per order per hour', async () => {
  OM._resetIssueBudget();
  const M = H.ctx.M;
  const user = await H.mkUser();
  const rider = await H.mkRider();
  const store = await H.mkStore();
  const order = await H.mkOrder({ user, store, rider });
  const t1 = await OM.createIssueTicket({ orderId: order.id, actor: { id: user.id, role: 'student' }, issueType: 'Late delivery', details: 'Waiting 40 min' });
  assert.ok(t1);
  assert.strictEqual(t1.userId, user.id);
  assert.strictEqual(t1.riderId, null);
  assert.strictEqual(t1.orderId, order.id);
  assert.strictEqual(t1.status, 'Open');
  assert.strictEqual(t1.priority, 'High');
  assert.match(t1.subject, /^Order issue: Late delivery/);
  assert.match(t1.description, /Waiting 40 min/);
  const t2 = await OM.createIssueTicket({ orderId: order.id, actor: { id: rider.id, role: 'rider' }, issueType: 'Customer not reachable' });
  assert.strictEqual(t2.riderId, rider.id);
  assert.strictEqual(t2.userId, null);
  await OM.createIssueTicket({ orderId: order.id, actor: { id: user.id, role: 'student' }, issueType: 'x' });
  await OM.createIssueTicket({ orderId: order.id, actor: { id: user.id, role: 'student' }, issueType: 'y' });
  assert.strictEqual(await OM.createIssueTicket({ orderId: order.id, actor: { id: user.id, role: 'student' }, issueType: 'z' }), null, '4th in an hour: no ticket');
  assert.strictEqual(await M('Ticket').count({ where: { orderId: order.id } }), 4);
  assert.strictEqual(await OM.createIssueTicket({ orderId: 'ZN-ABCDEF', actor: { id: user.id, role: 'student' }, issueType: 'x' }), null, 'cart rooms never open tickets');
});

test('a customer deleting their account removes their order chat lines; the rider lines stay', async () => {
  const M = H.ctx.M;
  const user = await H.mkUser();
  const rider = await H.mkRider();
  const store = await H.mkStore();
  const order = await H.mkOrder({ user, store, rider, status: 'Delivered' });
  const mine = await OM.saveOrderMessage({ orderId: order.id, actor: { id: user.id, role: 'student' }, text: 'my room is 204' });
  const theirs = await OM.saveOrderMessage({ orderId: order.id, actor: { id: rider.id, role: 'rider' }, text: 'at the gate' });
  const r = await H.silent(() => H.api('POST', '/api/users/account/delete', user.token, { confirm: 'DELETE', password: H.USER_PW }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(await M('OrderMessage').findByPk(mine.id), null);
  assert.ok(await M('OrderMessage').findByPk(theirs.id));
});

test('legal delete-account page covers riders, auto drivers and stores', async () => {
  const r = await H.api('GET', '/legal/delete-account');
  assert.strictEqual(r.status, 200);
  const t = r.text;
  for (const s of ['id="riders"', 'id="stores"', 'ZenWe Rider', 'ZenWe Auto Driver', 'com.zenvy.restaurant', 'com.srm.zenvyvendor', 'Delete account', 'Order chat is deleted after 90 days']) {
    assert.ok(t.includes(s), s);
  }
  const p = await H.api('GET', '/legal/privacy');
  assert.ok(p.text.includes('Riders and auto drivers can delete their account in their app'));
});
