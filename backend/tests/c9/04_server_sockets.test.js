// C9 against the REAL server.js (child process via tests/s0/boot_server.js, fresh temp SQLite, Redis unset):
//   - 'sendMessage' in an order room is stored (OrderMessages) and still broadcast as 'receiveMessage'
//     (same fields + id); admins still get 'admin_intercept_chat'.
//   - a rider taken off the order can no longer chat in it, even though the socket is still in the room.
//   - 'report_issue' creates a support Ticket (linked to the order) and the alerts carry its ticketId.
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
const SECRET = 's0-socket-test-secret'; // set by tests/s0/boot_server.js

const PORT = 23000 + (process.pid % 7000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `c9-srv-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
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
  child = spawn(process.execPath, [path.join(B, 'tests', 's0', 'boot_server.js')], {
    env: { ...process.env, S0_SQLITE: file, PORT: String(PORT), S0_CTRL_PORT: String(CTRL), REDIS_URL: '', REDIS_ENABLED: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d; if (logs.length > 200000) logs = logs.slice(-100000); });
  child.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/chat/status`);
      if (r.status === 200 && await evalIn("const M = require(B + '/models/OrderMessage').getOrderMessageModel(); if (!M) throw new Error('no db'); return await M.count();") !== undefined) return;
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
  const s = ioc(BASE, { transports: ['websocket'], auth: { token }, forceNew: true, reconnection: false });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});
const waitFor = (s, ev, pred = () => true, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => { s.off(ev, h); rej(new Error(`timeout waiting for ${ev}`)); }, ms);
  const h = (p) => { if (pred(p)) { clearTimeout(t); s.off(ev, h); res(p); } };
  s.on(ev, h);
});
const none = (s, ev, pred = () => true, ms = 800) => new Promise((res) => {
  let seen = null;
  const h = (p) => { if (pred(p)) seen = p; };
  s.on(ev, h);
  setTimeout(() => { s.off(ev, h); res(seen); }, ms);
});
const tok = (id, role) => jwt.sign({ id, role, tv: 0 }, SECRET);

test('order chat is stored + relayed; an unassigned rider is refused; report_issue opens a ticket', async () => {
  const n = String(process.pid % 10000).padStart(4, '0');
  const ids = await evalIn(`
    const U = require(B + '/models/User').getUserModel();
    const D = require(B + '/models/DeliveryPartner').getDeliveryPartnerModel();
    const R = require(B + '/models/Restaurant').getRestaurantModel();
    const O = require(B + '/models/Order').getOrderModel();
    const u = await U.create({ name: 'Chat Customer', phone: '91${n}00001', role: 'student', isActive: true, password: 'x-test-pw-1' });
    const a = await U.create({ name: 'Chat Admin', phone: '91${n}00002', role: 'admin', isActive: true, password: 'x-test-pw-2' });
    const r1 = await D.create({ name: 'Rider One', phone: '91${n}00003', password: 'x-test-pw-3', isApproved: true });
    const r2 = await D.create({ name: 'Rider Two', phone: '91${n}00004', password: 'x-test-pw-4', isApproved: true });
    const s = await R.create({ name: 'Chat Store', location: 'C9', isActive: true, password: 'storepass1' });
    const o = await O.create({ userId: u.id, restaurantId: s.id, deliveryPartnerId: r1.id, items: [], totalPrice: 100, deliveryFee: 10, finalPrice: 110, paymentMethod: 'COD', status: 'PickedUp' });
    return { u: u.id, a: a.id, r1: r1.id, r2: r2.id, o: o.id };
  `);
  const socks = [];
  try {
    const cust = await connect(tok(ids.u, 'student')); socks.push(cust);
    const rider = await connect(tok(ids.r1, 'rider')); socks.push(rider);
    const adm = await connect(tok(ids.a, 'admin')); socks.push(adm);
    cust.emit('joinOrder', ids.o);
    rider.emit('joinOrder', ids.o);
    await new Promise((res) => adm.emit('joinRoom', 'admin_room', res));
    await sleep(400);

    // 1. customer -> rider, stored
    const got = waitFor(rider, 'receiveMessage', (m) => m.message === 'Gate 2 please');
    const intercepted = waitFor(adm, 'admin_intercept_chat', (m) => m.message === 'Gate 2 please');
    cust.emit('sendMessage', { orderId: ids.o, message: '  Gate 2 please  ' });
    const msg = await got;
    assert.strictEqual(msg.orderId, ids.o);
    assert.strictEqual(msg.senderId, ids.u);
    assert.strictEqual(msg.senderRole, 'customer');
    assert.strictEqual(msg.sender, 'Chat Customer');
    assert.ok(msg.timestamp);
    assert.match(String(msg.id), /^[0-9a-f-]{36}$/, 'stored row id added');
    assert.strictEqual((await intercepted).id, msg.id);
    const rows = await evalIn(`return (await require(B + '/models/OrderMessage').getOrderMessageModel().findAll({ where: { orderId: '${ids.o}' }, raw: true })).map((m) => [m.senderType, m.senderId, m.text]);`);
    assert.deepStrictEqual(rows, [['customer', ids.u, 'Gate 2 please']]);

    // 2. long text capped at 500
    const long = waitFor(cust, 'receiveMessage', (m) => m.senderId === ids.r1);
    rider.emit('sendMessage', { orderId: ids.o, message: 'y'.repeat(900) });
    assert.strictEqual((await long).message.length, 500);

    // 3. rider taken off the order: still in the socket room, but refused (no relay, nothing stored)
    await evalIn(`await require(B + '/models/Order').getOrderModel().update({ deliveryPartnerId: '${ids.r2}' }, { where: { id: '${ids.o}' } }); return 1;`);
    const leaked = none(cust, 'receiveMessage', (m) => m.message === 'still here?');
    rider.emit('sendMessage', { orderId: ids.o, message: 'still here?' });
    assert.strictEqual(await leaked, null, 'unassigned rider message must not be relayed');
    const count = await evalIn(`return await require(B + '/models/OrderMessage').getOrderMessageModel().count({ where: { orderId: '${ids.o}' } });`);
    assert.strictEqual(count, 2);

    // 4. report_issue -> ticket + alerts carry ticketId (backward compatible fields kept)
    const alert = waitFor(cust, 'issue_alert');
    const adminAlert = waitFor(adm, 'admin_issue_reported', (p) => p.orderId === ids.o);
    cust.emit('report_issue', { orderId: ids.o, issueType: 'Rider not moving', details: 'Stuck for 20 minutes' });
    const issue = await alert;
    assert.strictEqual(issue.orderId, ids.o);
    assert.strictEqual(issue.senderRole, 'Customer');
    assert.strictEqual(issue.issueType, 'Rider not moving');
    assert.strictEqual(issue.details, 'Stuck for 20 minutes');
    assert.ok(issue.ticketId, 'ticket id on the alert');
    assert.strictEqual((await adminAlert).ticketId, issue.ticketId);
    const t = await evalIn(`const t = await require(B + '/models/Ticket').getTicketModel().findByPk('${issue.ticketId}'); return t && { userId: t.userId, riderId: t.riderId, orderId: t.orderId, status: t.status, subject: t.subject };`);
    assert.deepStrictEqual(t, { userId: ids.u, riderId: null, orderId: ids.o, status: 'Open', subject: 'Order issue: Rider not moving' });

    // 5. the unassigned rider cannot open tickets on the order any more
    const before = await evalIn(`return await require(B + '/models/Ticket').getTicketModel().count({ where: { orderId: '${ids.o}' } });`);
    rider.emit('report_issue', { orderId: ids.o, issueType: 'x' });
    await sleep(600);
    const after = await evalIn(`return await require(B + '/models/Ticket').getTicketModel().count({ where: { orderId: '${ids.o}' } });`);
    assert.strictEqual(after, before);
  } finally {
    for (const s of socks) s.close();
  }
});
