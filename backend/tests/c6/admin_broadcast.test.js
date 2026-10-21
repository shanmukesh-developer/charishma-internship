// Broadcast push: the recipients preview counts the same audience the send uses (nothing is sent), and
// the history lists past broadcasts from the audit log with their audience. Admin-only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let admin;
let student;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin', name: 'Broadcast Admin' });
  student = await H.mkUser({ hostelBlock: 'Vedha', fcmTokens: ['tok-a', 'tok-b'] });
  await H.mkUser({ hostelBlock: 'Ganga', fcmTokens: ['tok-c'] });
  await H.mkUser({ hostelBlock: 'Vedha', isActive: false, fcmTokens: ['tok-off'] });
});
after(H.teardown);

test('preview counts active students and unique devices, per block, and sends nothing', async () => {
  const pushesBefore = H.ctx.pushes.length;
  const all = await api('GET', '/api/admin/broadcast-push/preview', admin.token);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.campusWide, true);
  assert.ok(all.body.students >= 3);
  const vedha = await api('GET', '/api/admin/broadcast-push/preview?targetBlock=Vedha', admin.token);
  assert.equal(vedha.body.students, 1);
  assert.equal(vedha.body.devices, 2);
  assert.equal(vedha.body.campusWide, false);
  const none = await api('GET', '/api/admin/broadcast-push/preview?targetBlock=Nowhere', admin.token);
  assert.equal(none.body.students, 0);
  assert.equal(H.ctx.pushes.length, pushesBefore, 'preview never sends');
});

test('a send is recorded and appears in the history with its audience', async () => {
  const sent = await api('POST', '/api/admin/broadcast-push', admin.token, { title: 'Mess closed', body: 'Dinner at 8 today', targetBlock: 'Vedha', category: 'announcement' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.students, 1);
  const h = await api('GET', '/api/admin/broadcast-push/history', admin.token);
  assert.equal(h.status, 200);
  const row = h.body.broadcasts.find((b) => b.title === 'Mess closed');
  assert.ok(row, 'broadcast in history');
  assert.equal(row.body, 'Dinner at 8 today');
  assert.equal(row.targetBlock, 'Vedha');
  assert.equal(row.students, 1);
  assert.equal(row.devices, 2);
  assert.equal(row.sentBy, 'Broadcast Admin');
});

test('customers cannot preview or read the history', async () => {
  for (const url of ['/api/admin/broadcast-push/preview', '/api/admin/broadcast-push/history']) {
    const r = await api('GET', url, student.token);
    assert.ok(r.status === 401 || r.status === 403, `${url} ${r.status}`);
  }
});
