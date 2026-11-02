// scripts/campus_off_until_launch_v1.js (owner, 2 Nov 2026 night, before the Play submission: "block the campus
// section ... don't delete code, but remove that in app"; "after Sankranti I will launch that feature"): the admins'
// Campus (Friends) master switch goes off once, so GET /api/config/sections reports campus.live false and the app
// hides Campus; the sub-tab switches are kept; switched back on from the admin, a later start leaves it on; the
// switch works.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const H = require('./helpers');

let base; let server; let flags; let script;
test.before(async () => {
  await H.setup();
  const seq = H.ctx.sequelize;
  const db = require(path.join(H.B, 'config/db.js'));
  db.getSequelize = () => seq;
  const express = require(path.join(H.B, 'node_modules/express'));
  const app = express();
  app.use('/api/config', H.r('routes/appConfigRoutes'));
  server = await require('../listenFree').listenFree(app);
  base = `http://127.0.0.1:${server.address().port}`;
  flags = H.r('modules/friends/services/featureFlags');
  script = H.r('scripts/campus_off_until_launch_v1');
});
test.after(async () => {
  delete process.env.DISABLE_CAMPUS_OFF_ONCE;
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

const campus = async () => {
  await H.r('utils/responseCache').invalidate('sections');
  const res = await fetch(`${base}/api/config/sections`);
  return (await res.json()).sections.campus;
};
const marker = () => H.ctx.sequelize.models.GlobalConfig.findOne({ where: { key: script.MARKER } });

test('the switch keeps it from running', async () => {
  process.env.DISABLE_CAMPUS_OFF_ONCE = 'true';
  assert.deepStrictEqual(await script.runCampusOffOnce(), { skipped: 'disabled' });
  delete process.env.DISABLE_CAMPUS_OFF_ONCE;
  assert.deepStrictEqual(await campus(), { live: true });
  assert.strictEqual(await marker(), null);
});

test('Campus goes off once: the app is told campus.live false; the sub-tab switches are kept', async () => {
  const before = await flags.getConfig({ fresh: true });
  assert.strictEqual(before.enabled, true);
  assert.deepStrictEqual(await script.runCampusOffOnce(), { campus: 'switched off' });
  const after = await flags.getConfig({ fresh: true });
  assert.strictEqual(after.enabled, false);
  assert.deepStrictEqual(after.features, before.features);
  assert.deepStrictEqual(await campus(), { live: false });
  assert.ok(await marker());
});

test('switched back on from the admin after Sankranti: a later start leaves it on', async () => {
  await flags.setConfig({ enabled: true });
  assert.deepStrictEqual(await script.runCampusOffOnce(), { skipped: 'already done' });
  assert.strictEqual((await flags.getConfig({ fresh: true })).enabled, true);
  assert.deepStrictEqual(await campus(), { live: true });
});
