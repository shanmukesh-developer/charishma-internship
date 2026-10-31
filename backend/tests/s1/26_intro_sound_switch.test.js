// Intro sound switch (owner, 31 Oct 2026): GET /api/config/sections carries introSound { on }, on until the admins
// switch it off (POST /api/admin/config INTRO_SOUND_ENABLED, true / false only, audited), and a change shows at once
// (the sections answer is cached for 60 s and refreshed by the save). Students cannot change it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('../c5/helpers');

let base; let server;
test.before(async () => {
  await H.setup();
  const express = require(path.join(H.B, 'node_modules/express'));
  const app = express();
  app.use('/api/config', H.r('routes/appConfigRoutes'));
  server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

const sections = async () => (await (await fetch(`${base}/api/config/sections`)).json()).sections;

test('intro sound: on by default, off / on from the admin switch at once, true / false only, admins only', async () => {
  assert.deepEqual((await sections()).introSound, { on: true }, 'on when never set');
  const admin = await H.mkUser({ role: 'admin' });
  const student = await H.mkUser();
  const save = (value, token = admin.token) => H.api('POST', '/api/admin/config', token, { key: 'INTRO_SOUND_ENABLED', value });
  assert.equal((await save(false, student.token)).status, 403);
  for (const bad of ['off', 0, 1, null, 'yes']) {
    const r = await save(bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)}: ${JSON.stringify(r.body)}`);
  }
  const off = await save(false);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.deepEqual((await sections()).introSound, { on: false }, 'off right after the save');
  assert.equal((await save('true')).status, 200);
  assert.deepEqual((await sections()).introSound, { on: true });
  assert.ok((await sections()).campus, 'the other sections are still there');
});
