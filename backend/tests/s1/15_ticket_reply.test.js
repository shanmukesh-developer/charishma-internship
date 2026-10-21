// Customer replies on support tickets (polish hunt C-M11): POST /api/tickets/:id/reply { text }.
//  - only the customer who opened the ticket (others, riders and unknown ids: 404; no token: 401);
//  - appended to responses as by: 'customer'; the text transcript labels it "You:";
//  - a Resolved ticket reopens as Open; a Closed one refuses (409); empty / too long refused (400);
//  - at most 20 customer replies per ticket (429); a later support reply keeps the labels.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

const express = require(path.join(H.B, 'node_modules/express'));
let server;
let base;
let Ticket;

const call = async (method, url, token, body) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

test.before(async () => {
  await H.setup();
  const { sequelize } = H.ctx;
  Ticket = H.r('models/Ticket').initTicketModel(sequelize);
  if (!Ticket.associations.user) Ticket.belongsTo(sequelize.models.User, { foreignKey: 'userId', as: 'user' });
  if (!Ticket.associations.order) Ticket.belongsTo(sequelize.models.Order, { foreignKey: 'orderId', as: 'order' });
  await Ticket.sync();
  const app = express();
  app.use(express.json());
  app.use('/api/tickets', H.r('routes/ticketRoutes'));
  server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

const mkTicket = (userId, extra = {}) => Ticket.create({ userId, subject: 'Late order', description: 'My order is late', ...extra });

test('owner replies; thread and transcript updated; GET shows it; support reply keeps labels', async () => {
  const u = await H.mkUser();
  const admin = await H.mkUser({ role: 'admin' });
  const t = await mkTicket(u.id);
  // support asks first
  const s = await call('PUT', `/api/tickets/${t.id}`, admin.token, { adminResponse: 'Which item was missing?' });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));

  const r = await call('POST', `/api/tickets/${t.id}/reply`, u.token, { text: '  The <b>raita</b>  ' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const thread = r.body.responses;
  assert.strictEqual(thread.length, 2);
  assert.deepStrictEqual(thread.map((x) => x.by), ['support', 'customer']);
  assert.strictEqual(thread[1].text, 'The braita/b', 'angle brackets stripped, trimmed');
  assert.match(r.body.adminResponse, /Which item was missing\?/);
  assert.match(r.body.adminResponse, /You: The braita\/b/);

  const mine = await call('GET', '/api/tickets', u.token);
  assert.strictEqual(mine.status, 200);
  const row = mine.body.find((x) => x.id === t.id);
  assert.strictEqual(row.responses.length, 2);

  const s2 = await call('PUT', `/api/tickets/${t.id}`, admin.token, { adminResponse: 'Refunded to your wallet.' });
  assert.strictEqual(s2.status, 200);
  assert.strictEqual(s2.body.responses.length, 3);
  assert.match(s2.body.adminResponse, /You: The braita\/b/);
  assert.match(s2.body.adminResponse, /Refunded to your wallet\./);
});

test('strangers, riders, bad ids and no token cannot reply', async () => {
  const owner = await H.mkUser();
  const other = await H.mkUser();
  const rider = await H.mkRider();
  const t = await mkTicket(owner.id);
  assert.strictEqual((await call('POST', `/api/tickets/${t.id}/reply`, other.token, { text: 'hi' })).status, 404);
  assert.strictEqual((await call('POST', `/api/tickets/${t.id}/reply`, rider.token, { text: 'hi' })).status, 404);
  assert.strictEqual((await call('POST', '/api/tickets/not-a-uuid/reply', owner.token, { text: 'hi' })).status, 404);
  assert.strictEqual((await call('POST', '/api/tickets/00000000-0000-4000-8000-000000000000/reply', owner.token, { text: 'hi' })).status, 404);
  assert.strictEqual((await call('POST', `/api/tickets/${t.id}/reply`, null, { text: 'hi' })).status, 401);
  const riderTicket = await Ticket.create({ riderId: rider.id, subject: 'Rider', description: 'x' });
  assert.strictEqual((await call('POST', `/api/tickets/${riderTicket.id}/reply`, rider.token, { text: 'hi' })).status, 404);
  await t.reload();
  assert.strictEqual(t.responses.length, 0);
});

test('validation, Resolved reopens, Closed refuses, reply cap', async () => {
  const u = await H.mkUser();
  const t = await mkTicket(u.id);
  assert.strictEqual((await call('POST', `/api/tickets/${t.id}/reply`, u.token, { text: '   ' })).status, 400);
  assert.strictEqual((await call('POST', `/api/tickets/${t.id}/reply`, u.token, { text: 42 })).status, 400);
  assert.strictEqual((await call('POST', `/api/tickets/${t.id}/reply`, u.token, { text: 'x'.repeat(2001) })).status, 400);

  await t.update({ status: 'Resolved' });
  const re = await call('POST', `/api/tickets/${t.id}/reply`, u.token, { text: 'Still not fixed' });
  assert.strictEqual(re.status, 201);
  assert.strictEqual(re.body.status, 'Open');

  const closed = await mkTicket(u.id, { status: 'Closed' });
  const c = await call('POST', `/api/tickets/${closed.id}/reply`, u.token, { text: 'hello' });
  assert.strictEqual(c.status, 409);
  assert.strictEqual(c.body.code, 'TICKET_CLOSED');

  const busy = await mkTicket(u.id);
  for (let i = 0; i < 20; i++) {
    const ok = await call('POST', `/api/tickets/${busy.id}/reply`, u.token, { text: `reply ${i}` });
    assert.strictEqual(ok.status, 201);
  }
  const cap = await call('POST', `/api/tickets/${busy.id}/reply`, u.token, { text: 'one more' });
  assert.strictEqual(cap.status, 429);
  assert.strictEqual(cap.body.code, 'TOO_MANY_REPLIES');
});
