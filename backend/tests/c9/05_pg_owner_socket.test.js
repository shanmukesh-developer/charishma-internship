// PF-07 / PF-08 (partner-flow test, 6 Nov 2026) against the REAL server.js (child process via tests/s0/boot_server.js,
// fresh temp SQLite, Redis unset): a ZenWe PG Partner token is accepted on the socket (it was refused with "Account not
// found", so the owner app only had a 30 s timer), joins only its own room pgowner_<id>, can join nothing else, and gets
// `pg:changed` when a student requests or cancels at one of its PGs (the cancel used to tell the owner nothing).
// An old token (password changed) and a suspended owner are refused.
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

const PORT = 31000 + (process.pid % 7000);
const CTRL = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const file = path.join(os.tmpdir(), `c9-pgo-${process.pid}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
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


test('a PG owner socket gets its own live events only, and is told when a student cancels', async () => {
  const n = String(process.pid % 10000).padStart(4, '0');
  const ids = await evalIn(`
    const U = require(B + '/models/User').getUserModel();
    const H = require(B + '/models/PGHostel').getPGHostelModel();
    const R = require(B + '/models/PGRoom').getPGRoomModel();
    const PB = require(B + '/models/PGBooking').getPGBookingModel();
    const pgo = require(B + '/modules/pgOwner');
    const O = pgo.getModel('PgOwner');
    const L = pgo.getModel('PgOwnerListing');
    const stu = await U.create({ name: 'Asha Student', phone: '92${n}00001', role: 'student', isActive: true, password: 'x-test-pw-1' });
    const adm = await U.create({ name: 'PG Admin', phone: '92${n}00002', role: 'admin', isActive: true, password: 'x-test-pw-2' });
    const h = await H.create({ ownerId: adm.id, name: 'Green PG', address: 'Near Gate 2', distanceFromCollege: 1, baseRent: 6000 });
    const other = await H.create({ ownerId: adm.id, name: 'Other PG', address: 'Far', distanceFromCollege: 3, baseRent: 5000 });
    const room = await R.create({ hostelId: h.id, roomNumber: '101', sharingType: 2, pricePerBed: 6000, totalBeds: 2, availableBeds: 2 });
    const room2 = await R.create({ hostelId: other.id, roomNumber: '9', sharingType: 2, pricePerBed: 5000, totalBeds: 2, availableBeds: 2 });
    const owner = await O.create({ name: 'Owner One', phone: '93${n}01', password: 'x', mustChangePassword: false });
    const owner2 = await O.create({ name: 'Owner Two', phone: '93${n}02', password: 'x', mustChangePassword: false });
    const stale = await O.create({ name: 'Owner Stale', phone: '93${n}03', password: 'x', mustChangePassword: false, tokenVersion: 2 });
    const susp = await O.create({ name: 'Owner Susp', phone: '93${n}04', password: 'x', mustChangePassword: false, status: 'SUSPENDED' });
    await L.create({ ownerId: owner.id, hostelId: h.id });
    await L.create({ ownerId: owner2.id, hostelId: other.id });
    const b = await PB.create({ userId: stu.id, hostelId: h.id, roomId: room.id, checkInDate: new Date(), status: 'Pending' });
    return { stu: stu.id, owner: owner.id, owner2: owner2.id, stale: stale.id, susp: susp.id, b: b.id, other: other.id, room2: room2.id };
  `);
  const socks = [];
  try {
    // Refused: a token from before a password change, and a suspended owner.
    await assert.rejects(connect(tok(ids.stale, 'pg_owner')), /Account not found/);
    await assert.rejects(connect(tok(ids.susp, 'pg_owner')), /suspended/i);

    const own = await connect(tok(ids.owner, 'pg_owner')); socks.push(own);
    const own2 = await connect(tok(ids.owner2, 'pg_owner')); socks.push(own2);
    // No other room can be joined (no handlers for this socket): an admin-room ack never comes back.
    const ack = await Promise.race([new Promise((res) => own.emit('joinRoom', 'admin_room', res)), sleep(600).then(() => 'no-ack')]);
    assert.strictEqual(ack, 'no-ack');
    own.emit('joinOrder', ids.b);
    await sleep(200);

    // The student cancels: the owner of THAT PG is told live (and pushed); the other owner hears nothing.
    const got = waitFor(own, 'pg:changed', (p) => p.bookingId === ids.b);
    const leak = none(own2, 'pg:changed');
    const r = await fetch(`${BASE}/api/pg/bookings/${ids.b}/cancel`, { method: 'PUT', headers: { authorization: `Bearer ${tok(ids.stu, 'student')}`, 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(r.status, 200, await r.text());
    const ev = await got;
    assert.strictEqual(ev.type, 'PG_OWNER_BOOKING_CANCELLED');
    assert.strictEqual(ev.status, 'Cancelled');
    assert.strictEqual(Object.keys(ev).some((k) => /name|phone/i.test(k)), false, 'ids only');
    assert.strictEqual(await leak, null);
    // (The push + inbox row for the owner is checked in tests/pgo/02_decisions: pushes are stubbed out here.)

    // A new request at the other PG reaches only its owner.
    const fresh = waitFor(own2, 'pg:changed', (p) => p.type === 'PG_OWNER_BOOKING');
    const quiet = none(own, 'pg:changed', (p) => p.type === 'PG_OWNER_BOOKING');
    const bk = await fetch(`${BASE}/api/pg/${ids.room2}/book`, { method: 'POST', headers: { authorization: `Bearer ${tok(ids.stu, 'student')}`, 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(bk.status, 201, await bk.text());
    assert.strictEqual((await fresh).hostelId, ids.other);
    assert.strictEqual(await quiet, null);
  } finally {
    for (const s of socks) s.close();
  }
});
