// CLOSED-TEST ONLY: app usage time (utils/usageTime, POST /api/users/usage-heartbeat, Admin > Active testers switch +
// delete). Heartbeat clamping (75 s per beat, never more than wall-clock time, duplicates within 30 s ignored unless
// final), sessions (gap > 5 min), IST midnight split, auth (customer accounts on the customer app only), switch off ->
// nothing recorded (and the app-version answer says so), delete -> usage cleared (streak history only on request),
// admin-only + audited.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');

const { api } = H;
let admin;
let usage;
let dt;
const UDA = () => H.ctx.M('UserDailyActivity');
before(async () => {
  await H.setup();
  H.r('models/UserDailyActivity').initUserDailyActivityModel(H.ctx.sequelize);
  dt = H.r('utils/testerDailyTarget');
  usage = H.r('utils/usageTime');
  await dt.runDailyActivityMigrations(H.ctx.sequelize);
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);
beforeEach(async () => {
  await H.ctx.M('GlobalConfig').destroy({ where: { key: 'USAGE_TRACKING_ENABLED' } });
  usage._resetCache();
});

const ist = (day, time) => new Date(`${day}T${time}+05:30`);
const plus = (d, s) => new Date(d.getTime() + s * 1000);
const day = async (u, d) => UDA().findOne({ where: { userId: String(u.id), day: d }, raw: true });
const CUSTOMER = { 'x-app-name': 'customer', 'x-app-version': '1.0.68', 'x-app-build': '69' };
const beat = (u, body, headers = CUSTOMER) => api('POST', '/api/users/usage-heartbeat', u.token, body, headers);

test('clamping: 75 s per beat, never more than real time, duplicates within 30 s ignored unless final; sessions', async () => {
  const u = await H.mkUser();
  const t0 = ist('2026-10-10', '12:00:00');
  const hb = (seconds, at, final = false) => usage.heartbeat(u.id, { seconds, final, now: at });

  let r = await hb(500, t0);
  assert.deepEqual([r.credited, r.newSession], [75, true], 'first beat: capped at 75');
  r = await hb(60, plus(t0, 20));
  assert.deepEqual([r.credited, r.duplicate], [0, true], 'within 30 s: duplicate');
  r = await hb(60, plus(t0, 20), true);
  assert.equal(r.credited, 20, 'final beat within 30 s: credited, but only the 20 s that really passed');
  r = await hb(60, plus(t0, 80));
  assert.equal(r.credited, 60);
  r = await hb(3600, plus(t0, 170));
  assert.equal(r.credited, 75, '90 s passed, 3600 claimed: 75');
  r = await hb(60, plus(t0, 160));
  assert.deepEqual([r.credited, r.duplicate], [0, true], 'a beat older than the last one is ignored');
  let row = await day(u, '2026-10-10');
  assert.equal(row.activeSeconds, 75 + 20 + 60 + 75);
  assert.equal(row.sessions, 1);

  // 6 minutes of silence: a new session; 75 s at most.
  r = await hb(60, plus(t0, 170 + 360));
  assert.deepEqual([r.credited, r.newSession], [60, true]);
  row = await day(u, '2026-10-10');
  assert.equal(row.sessions, 2);
  assert.equal(row.activeSeconds, 290);

  // Two identical beats at once: only one counts.
  const at = plus(t0, 170 + 360 + 60);
  const both = await Promise.all([hb(60, at), hb(60, at)]);
  assert.equal(both.reduce((s, x) => s + x.credited, 0), 60);
  assert.equal((await day(u, '2026-10-10')).activeSeconds, 350);
});

test('IST midnight: a beat that spans 00:00 IST is split between the two days; the session counts on both', async () => {
  const u = await H.mkUser();
  let r = await usage.heartbeat(u.id, { seconds: 60, now: ist('2026-10-12', '23:59:30') });
  assert.equal(r.credited, 60);
  r = await usage.heartbeat(u.id, { seconds: 60, now: ist('2026-10-13', '00:00:20') });
  assert.equal(r.credited, 50, '50 s since the last beat');
  assert.equal(r.split, true);
  const d1 = await day(u, '2026-10-12');
  const d2 = await day(u, '2026-10-13');
  assert.equal(d1.activeSeconds, 60 + 30);
  assert.equal(d2.activeSeconds, 20);
  assert.equal(d1.sessions, 1);
  assert.equal(d2.sessions, 1, 'the session continuing past midnight counts today too');
  // Next beat stays on the new day.
  r = await usage.heartbeat(u.id, { seconds: 60, now: ist('2026-10-13', '00:01:20') });
  assert.equal(r.credited, 60);
  assert.equal((await day(u, '2026-10-13')).activeSeconds, 80);
  assert.equal((await day(u, '2026-10-13')).sessions, 1);
  assert.equal((await day(u, '2026-10-12')).activeSeconds, 90);
});

test('route: customer accounts on the customer app only; validation', async () => {
  const u = await H.mkUser();
  assert.equal((await beat({ token: null }, { seconds: 60 })).status, 401);
  const rider = await H.mkRider();
  const rTok = require('jsonwebtoken').sign({ id: rider.id, role: 'rider', tv: 0 }, process.env.JWT_SECRET);
  assert.equal((await api('POST', '/api/users/usage-heartbeat', rTok, { seconds: 60 }, CUSTOMER)).status, 403, 'rider');
  assert.equal((await beat(u, { seconds: 60 }, {})).status, 403, 'no X-App-Name');
  assert.equal((await beat(u, { seconds: 60 }, { 'x-app-name': 'rider' })).status, 403, 'partner app');
  for (const bad of [{}, { seconds: '60' }, { seconds: -1 }, { seconds: 4000 }, { seconds: null }]) {
    assert.equal((await beat(u, bad)).status, 400, JSON.stringify(bad));
  }
  const ok = await beat(u, { seconds: 40 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.enabled, ok.body.credited, ok.body.newSession], [true, 40, true]);
  const row = await day(u, dt.istDay(new Date()));
  assert.equal(row.activeSeconds, 40);
  assert.equal(row.sessions, 1);
});

test('switch off: nothing recorded, the app-version answer says so; admin-only + audited', async () => {
  const u = await H.mkUser();
  const other = await H.mkUser();
  // Non-admins / signed out.
  for (const [m, url, body] of [['GET', '/api/admin/active-users/usage-tracking'], ['PUT', '/api/admin/active-users/usage-tracking', { enabled: false }], ['POST', '/api/admin/active-users/usage-data/delete', { confirm: 'DELETE' }]]) {
    assert.equal((await api(m, url, other.token, body)).status, 403, url);
    assert.equal((await api(m, url, null, body)).status, 401, url);
  }
  const versionAnswer = async () => {
    let out = null;
    await H.r('controllers/appVersionController').getPublicAppVersion({ query: { app: 'customer' } }, { json: (b) => { out = b; }, status() { return this; } });
    return out;
  };
  assert.equal((await versionAnswer()).usageTracking, true, 'default ON');

  assert.equal((await api('PUT', '/api/admin/active-users/usage-tracking', admin.token, { enabled: 'no' })).status, 400);
  const off = await api('PUT', '/api/admin/active-users/usage-tracking', admin.token, { enabled: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.enabled, false);
  assert.equal(off.body.changed, true);
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'USAGE_TRACKING_SWITCHED' }, raw: true });
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0].details), { before: true, after: false });
  assert.equal(logs[0].adminId, String(admin.id));
  assert.equal((await versionAnswer()).usageTracking, false);

  const r = await beat(u, { seconds: 60 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.enabled, r.body.credited], [false, 0]);
  // The request itself still counts as "opened today" (presence: daily target), but no time is recorded.
  const sumUsage = async () => (await UDA().findAll({ where: { userId: String(u.id) }, raw: true })).reduce((n, x) => n + x.activeSeconds + x.sessions + (x.lastBeatMs ? 1 : 0), 0);
  assert.equal(await sumUsage(), 0, 'no usage time written');
  const direct = await usage.heartbeat(u.id, { seconds: 60, now: ist('2026-10-14', '10:00:00') });
  assert.equal(direct.enabled, false);
  assert.equal(await UDA().count({ where: { userId: String(u.id), day: '2026-10-14' } }), 0);
  assert.equal(await sumUsage(), 0);
  // The partner-app versions never carry the flag.
  let riderAnswer = null;
  await H.r('controllers/appVersionController').getPublicAppVersion({ query: { app: 'rider' } }, { json: (b) => { riderAnswer = b; }, status() { return this; } });
  assert.equal('usageTracking' in riderAnswer, false);

  const on = await api('PUT', '/api/admin/active-users/usage-tracking', admin.token, { enabled: true });
  assert.equal(on.body.enabled, true);
  assert.equal((await beat(u, { seconds: 30 })).body.credited, 30);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'USAGE_TRACKING_SWITCHED' } }), 2);
});

test('delete: usage cleared and active-day rows kept; with history: every row deleted; confirm required; audited', async () => {
  const u = await H.mkUser();
  await usage.heartbeat(u.id, { seconds: 60, now: ist('2026-10-15', '10:00:00') });
  await UDA().create({ userId: String(u.id), day: '2026-10-16', firstAt: ist('2026-10-16', '09:00:00'), lastAt: ist('2026-10-16', '09:30:00') });
  const st = await api('GET', '/api/admin/active-users/usage-tracking', admin.token);
  assert.equal(st.status, 200);
  assert.ok(st.body.rowsWithUsage >= 1);

  const del = (body) => api('POST', '/api/admin/active-users/usage-data/delete', admin.token, body);
  assert.equal((await del({})).status, 400);
  assert.equal((await del({ confirm: 'delete' })).status, 400);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'USAGE_DATA_DELETED' } }), 0);

  const r = await del({ confirm: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rowsWithUsage, 0);
  assert.ok(r.body.dailyRows >= 2, 'active-day rows kept for the streak');
  const kept = await day(u, '2026-10-15');
  assert.deepEqual([kept.activeSeconds, kept.sessions, kept.lastBeatMs], [0, 0, null]);

  const r2 = await del({ confirm: 'DELETE', includeDailyHistory: true });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.dailyRows, 0);
  assert.equal(await UDA().count(), 0);
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'USAGE_DATA_DELETED' }, order: [['timestamp', 'ASC']], raw: true });
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0].details).includeDailyHistory, false);
  assert.equal(JSON.parse(logs[1].details).includeDailyHistory, true);
});

test('admin report: minutes today, sessions, 7-day average per day opened, today\'s totals', async () => {
  const u = await H.mkUser({ name: 'Usage Report' });
  const now = new Date();
  const today = dt.istDay(now);
  await UDA().create({ userId: String(u.id), day: today, firstAt: now, lastAt: now, activeSeconds: 600, sessions: 2 });
  await UDA().create({ userId: String(u.id), day: dt.addDays(today, -2), firstAt: now, lastAt: now, activeSeconds: 1200, sessions: 1 });
  await UDA().create({ userId: String(u.id), day: dt.addDays(today, -9), firstAt: now, lastAt: now, activeSeconds: 99999, sessions: 9 });
  await UDA().create({ userId: String(admin.id), day: today, firstAt: now, lastAt: now, activeSeconds: 6000, sessions: 1 });
  const r = await api('GET', `/api/admin/active-users?search=${encodeURIComponent('Usage Report')}`, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.users.find((x) => x.id === String(u.id));
  assert.deepEqual(row.usage, { minutesToday: 10, sessionsToday: 2, avgMinutes7d: 15, daysActive7d: 2 });
  assert.equal(r.body.usageToday.totalMinutes, 10, 'admins left out');
  assert.equal(r.body.usageToday.usersWithTime, 1);
  assert.equal(r.body.usageToday.avgMinutesPerActiveUser, 10);
  assert.equal(r.body.usageToday.trackingEnabled, true);
});
