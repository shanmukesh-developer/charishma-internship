// Owner scenario #25: existing navigation / features still work.
//  - shared files changed additively only: every earlier router mount, job, realtime type and media purpose
//    is still there, in the same order, and the Campus Events routers sit before /api/admin;
//  - the old "Today on Campus" CampusEvent model / table is untouched (Ce* tables are separate);
//  - the existing Auto-Ride node:test suite still passes (the shell regression covers the e7 / a1-a4 /
//    c1-c2 suites: see scratchpad/p1_regress.sh). Set CE_SKIP_REGRESSION=1 to skip the child suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const B = path.join(__dirname, '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(B, f), 'utf8');

test('#25 shared wiring is additive: routers, webhook before express.json, jobs, realtime, media purposes', () => {
  const server = read('server.js');
  const order = ['/api/rentals', '/api/auto-ride/driver', '/api/auto-ride', '/api/campus-events/organizer', '/api/campus-events/check-in', "app.use('/api/campus-events'", '/api/admin/campus-events', "app.use('/api/admin', require"];
  let at = -1;
  for (const k of order) {
    const i = server.indexOf(k, at + 1);
    assert.ok(i > at, `mount order: ${k}`);
    at = i;
  }
  const hook = server.indexOf("app.post('/api/campus-events/webhooks/razorpay', express.raw(");
  const json = server.indexOf("app.use(require('./utils/bodyLimits').bodyParsers());"); // A5: global JSON / form parsers
  assert.ok(hook > 0 && hook < json, 'raw-body webhook registered before the global express.json');
  const jobs = require(path.join(B, 'jobs')).listJobs().map((j) => j.name);
  for (const n of ['community.expiryCleanup', 'orders.autoCancel', 'orders.stallStuck', 'stores.featuredExpiry', 'menu.autoRestore', 'rentals.lifecycle', 'autoRide.lifecycle', 'wall.finalize', 'retention.chatPulse', 'idempotency.cleanup', 'media.base64Migration']) assert.ok(jobs.includes(n), n);
  const ce = require(path.join(B, 'jobs')).listJobs().find((j) => j.name === 'campusEvents.lifecycle');
  assert.deepEqual(ce.schedule, { everyMs: 60000, firstMs: 55000 });
  assert.equal(ce.quietWhenIdle, true);
  const rt = read('utils/realtime.js');
  for (const t of ["'rental'", "'auto_trip'", "'campus_event'", "'auto_incident'", "'campus_event_admin'", "'friends_report'"]) assert.ok(rt.includes(t), t);
  const media = read('modules/campus/controllers/mediaController.js');
  const store = read('utils/imageStore.js');
  for (const p of ["'rental_photo'", "'auto_driver_doc'", "'event_poster'"]) assert.ok(media.includes(p), `mediaController ${p}`);
  assert.ok(store.includes("'event_poster'") && store.includes("'auto_driver_doc'"));
  // S0: the private-purpose list moved to utils/mediaAccess (mediaController imports it).
  const privMatch = /PRIVATE_PURPOSES = new Set\(\[([^\]]+)\]\)/.exec(read('utils/mediaAccess.js'));
  assert.ok(privMatch && !privMatch[1].includes('event_poster'), 'posters are public');
  const db = read('config/db.js');
  assert.equal((db.match(/runCampusEventsMigrations\(sequelize\)/g) || []).length, 2, 'migrations in both branches');
  assert.ok(db.indexOf('initAutoRideModels(instance)') < db.indexOf('initCampusEventsModels(instance)'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:autoride'], 'node modules/autoRide/tests/run.js');
  assert.equal(pkg.scripts['test:events'], 'node modules/campusEvents/tests/run.js');
});

test('#25 the old CampusEvent ("Today on Campus") model is untouched; Ce* tables are separate', () => {
  const pulse = read('modules/campus/models/Pulse.js');
  assert.ok(/define\('CampusEvent'/.test(pulse));
  const models = read('modules/campusEvents/models.js');
  assert.ok(!/define\('CampusEvent'/.test(models));
  const names = [...models.matchAll(/sequelize\.define\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 13 && names.every((n) => n.startsWith('Ce')), names.join(','));
  const tables = [...models.matchAll(/tableName: '(\w+)'/g)].map((m) => m[1]);
  assert.ok(tables.every((n) => n.startsWith('Ce')), tables.join(','));
});

test('#25 existing Auto-Ride suite still passes (npm run test:autoride)', { skip: process.env.CE_SKIP_REGRESSION === '1' }, () => {
  // A child of node --test inherits NODE_TEST_CONTEXT, which would turn the nested runner into a sub-reporter.
  const env = { ...process.env, NODE_ENV: 'test' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(B, 'modules/autoRide/tests/run.js')], { cwd: B, env, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const pass = /ℹ pass (\d+)/.exec(out);
  const failN = /ℹ fail (\d+)/.exec(out);
  assert.equal(r.status, 0, out.slice(-2000));
  assert.ok(pass && Number(pass[1]) > 0);
  assert.equal(failN && Number(failN[1]), 0);
});
