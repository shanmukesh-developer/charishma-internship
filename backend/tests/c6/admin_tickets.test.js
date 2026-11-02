// Support tickets admin additions: assign a ticket to an admin (validated, audited), list the admins a
// ticket can go to, and canned replies (defaults, validated save, audited). All admin-only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('./helpers');

const express = require(path.join(H.B, 'node_modules/express'));
let admin;
let otherAdmin;
let customer;
let base;
let server;
let ticket;

const call = async (method, url, token, body) => {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

before(async () => {
  await H.setup();
  const { sequelize } = H.ctx;
  const Ticket = H.r('models/Ticket').initTicketModel(sequelize);
  Ticket.belongsTo(sequelize.models.User, { foreignKey: 'userId', as: 'user' });
  await Ticket.sync();
  const app = express();
  app.use(express.json());
  app.use('/api/tickets', H.r('routes/ticketRoutes'));
  server = await require('../listenFree').listenFree(app);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await H.mkUser({ role: 'admin', name: 'Asha Admin' });
  otherAdmin = await H.mkUser({ role: 'admin', name: 'Bala Admin' });
  customer = await H.mkUser();
  ticket = await Ticket.create({ userId: customer.id, subject: 'Late order', description: 'My order is late' });
});
after(async () => {
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

test('assignees lists active admins only', async () => {
  const r = await call('GET', '/api/tickets/admin/assignees', admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ids = r.body.map((a) => a.id);
  assert.ok(ids.includes(admin.id) && ids.includes(otherAdmin.id));
  assert.ok(!ids.includes(customer.id));
});

test('assign to an admin, then clear; audited; customers and bad ids refused', async () => {
  const a = await call('PUT', `/api/tickets/${ticket.id}`, admin.token, { assigneeId: otherAdmin.id });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.assigneeId, otherAdmin.id);
  assert.equal(a.body.assigneeName, 'Bala Admin');
  const log = await H.ctx.M('VerificationLog').findOne({ where: { targetId: String(ticket.id), action: 'TICKET_ASSIGNED' } });
  assert.ok(log, 'assignment is in the audit log');

  const notAdmin = await call('PUT', `/api/tickets/${ticket.id}`, admin.token, { assigneeId: customer.id });
  assert.equal(notAdmin.status, 400);
  assert.equal(notAdmin.body.code, 'INVALID_ASSIGNEE');
  const junk = await call('PUT', `/api/tickets/${ticket.id}`, admin.token, { assigneeId: 'nope' });
  assert.equal(junk.status, 400);

  const cleared = await call('PUT', `/api/tickets/${ticket.id}`, admin.token, { assigneeId: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.assigneeId, null);

  const denied = await call('PUT', `/api/tickets/${ticket.id}`, customer.token, { assigneeId: admin.id });
  assert.ok(denied.status === 401 || denied.status === 403, String(denied.status));
});

test('a reply without assigneeId keeps the assignee (backward compatible)', async () => {
  await call('PUT', `/api/tickets/${ticket.id}`, admin.token, { assigneeId: admin.id });
  const r = await call('PUT', `/api/tickets/${ticket.id}`, admin.token, { adminResponse: 'Looking into it', status: 'In Progress' });
  assert.equal(r.status, 200);
  assert.equal(r.body.assigneeId, admin.id);
  assert.equal(r.body.status, 'In Progress');
});

test('canned replies: defaults, validated save, audited, admin-only', async () => {
  const d = await call('GET', '/api/tickets/admin/canned-replies', admin.token);
  assert.equal(d.status, 200);
  assert.ok(Array.isArray(d.body.replies) && d.body.replies.length >= 1);

  const bad = await call('PUT', '/api/tickets/admin/canned-replies', admin.token, { replies: [{ title: '', text: 'x' }] });
  assert.equal(bad.status, 400);
  const tooMany = await call('PUT', '/api/tickets/admin/canned-replies', admin.token, { replies: Array.from({ length: 31 }, (_, i) => ({ title: `T${i}`, text: 'x' })) });
  assert.equal(tooMany.status, 400);

  const ok = await call('PUT', '/api/tickets/admin/canned-replies', admin.token, { replies: [{ title: '  Refund   done ', text: 'Refunded to your Wallet.' }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.replies, [{ title: 'Refund done', text: 'Refunded to your Wallet.' }]);
  const again = await call('GET', '/api/tickets/admin/canned-replies', admin.token);
  assert.deepEqual(again.body.replies, [{ title: 'Refund done', text: 'Refunded to your Wallet.' }]);
  const log = await H.ctx.M('VerificationLog').findOne({ where: { action: 'SUPPORT_CANNED_REPLIES_UPDATED' } });
  assert.ok(log);

  const denied = await call('PUT', '/api/tickets/admin/canned-replies', customer.token, { replies: [] });
  assert.ok(denied.status === 401 || denied.status === 403);
});
