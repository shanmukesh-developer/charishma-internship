// Support tickets take up to 3 photos: the customer's own private 'support' uploads only; the list
// endpoints return signed links (customer and admin), and nobody else can open the photo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c5/helpers');

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let u; let other; let admin;
let base2 = '';
let server2 = null;
// The c5 harness does not mount tickets or campus media: a second small app on the same database does.
const api = async (method, url, token, body) => {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base2 + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};
const upload = async (who, image, purpose = 'support') => api('POST', '/api/campus/media', who.token, { image, purpose });

before(async () => {
  await H.setup();
  const { sequelize } = H.ctx;
  H.r('models/Ticket').initTicketModel(sequelize);
  H.r('modules/campus/models').initCampusModels(sequelize);
  const M = sequelize.models;
  M.Ticket.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  M.Ticket.belongsTo(M.Order, { foreignKey: 'orderId', as: 'order' });
  await sequelize.sync();
  const express = require(require('path').join(H.B, 'node_modules/express'));
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/tickets', H.r('routes/ticketRoutes'));
  app.use('/api/campus', H.r('modules/campus/campusRoutes'));
  server2 = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  base2 = `http://127.0.0.1:${server2.address().port}`;
  u = await H.mkUser();
  other = await H.mkUser();
  admin = await H.mkUser({ role: 'admin' });
});
after(async () => { if (server2) server2.close(); await H.teardown(); });

test('upload is private; a ticket keeps up to 3 own support photos and lists them as signed links', async () => {
  const up = await upload(u, PNG);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.isPrivate, true);
  const path = up.body.url;
  assert.match(path, /\/api\/campus\/media\/[0-9a-f-]{36}/);

  const t = await api('POST', '/api/tickets', u.token, { subject: 'Item missing', description: 'Raita was missing', attachments: [path] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.attachments.length, 1);
  assert.match(t.body.attachments[0], /exp=\d+&sig=/);

  const mine = await api('GET', '/api/tickets', u.token);
  const row = mine.body.find((x) => x.id === t.body.id);
  assert.equal(row.attachments.length, 1);
  assert.match(row.attachments[0], /sig=/);

  // The signed link opens; the bare path does not for another customer.
  const signedPath = row.attachments[0].replace(/^https?:\/\/[^/]+/, '');
  assert.equal((await api('GET', signedPath)).status, 200);
  assert.notEqual((await api('GET', path.replace(/^https?:\/\/[^/]+/, ''), other.token)).status, 200);
});

test('no photos still works; more than 3, a foreign upload or a non-support upload is refused', async () => {
  const plain = await api('POST', '/api/tickets', u.token, { subject: 'Question', description: 'When do you open?' });
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.body.attachments, []);

  const a = (await upload(u, PNG)).body.url;
  const b = (await upload(u, PNG2)).body.url;
  const four = await api('POST', '/api/tickets', u.token, { subject: 'S', description: 'D', attachments: [a, b, a, b] });
  assert.equal(four.status, 400);

  const foreign = (await upload(other, PNG2)).body.url;
  assert.equal((await api('POST', '/api/tickets', u.token, { subject: 'S', description: 'D', attachments: [foreign] })).status, 400);

  const chatPhoto = (await upload(u, PNG2, 'chat')).body.url;
  assert.equal((await api('POST', '/api/tickets', u.token, { subject: 'S', description: 'D', attachments: [chatPhoto] })).status, 400);
  assert.equal((await api('POST', '/api/tickets', u.token, { subject: 'S', description: 'D', attachments: ['https://evil.example/x.png'] })).status, 400);
});

test('admins see the photos as signed links in the ticket list', async () => {
  const p = (await upload(u, PNG)).body.url;
  const t = await api('POST', '/api/tickets', u.token, { subject: 'Wrong item', description: 'Got paneer not chicken', attachments: [p] });
  const all = await api('GET', '/api/tickets/admin', admin.token);
  assert.equal(all.status, 200, JSON.stringify(all.body).slice(0, 200));
  const row = all.body.find((x) => x.id === t.body.id);
  assert.equal(row.attachments.length, 1);
  assert.match(row.attachments[0], /sig=/);
});
