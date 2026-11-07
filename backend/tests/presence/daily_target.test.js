// Play closed test daily target + streak (utils/testerDailyTarget, routes/activeUsersRoutes /daily-target):
// the active-day row is written once per IST day by the presence path (23:59 vs 00:01 IST), testers-only basis
// (current tester list, admins / deleted left out, not-signed-up numbers listed), "all customers" basis (admins,
// deleted and owner test accounts left out), target met / not met, streak (gaps, today not yet met), admin-only,
// settings validation + audit + generic Config refused, backfill idempotent.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');

const { api } = H;
let admin;
let dt;
let presence;
const UDA = () => H.ctx.M('UserDailyActivity');
before(async () => {
  await H.setup();
  H.r('models/UserDailyActivity').initUserDailyActivityModel(H.ctx.sequelize);
  dt = H.r('utils/testerDailyTarget');
  presence = H.r('utils/appPresence');
  const mig = await dt.runDailyActivityMigrations(H.ctx.sequelize);
  assert.equal(mig.ok, true, JSON.stringify(mig));
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

// 'YYYY-MM-DD' + 'HH:MM[:SS]' in IST -> Date
const ist = (day, time) => new Date(`${day}T${time.length === 5 ? `${time}:00` : time}+05:30`);
const rowsOf = (u) => UDA().findAll({ where: { userId: String(u.id) }, order: [['day', 'ASC']], raw: true });
const CUSTOMER = { 'x-app-name': 'customer', 'x-app-version': '1.0.67', 'x-app-build': '68' };
const putDay = (u, day, extra = {}) => UDA().create({ userId: String(u.id), day, firstAt: ist(day, '10:00'), lastAt: ist(day, '11:00'), appVersion: '1.0.67', ...extra });
const setTesters = (phones) => H.ctx.M('GlobalConfig').upsert({ key: 'CLOSED_TESTER_PHONES', value: { phones } });
const clearTesters = () => H.ctx.M('GlobalConfig').destroy({ where: { key: 'CLOSED_TESTER_PHONES' } });
const setSettings = (target, streakStart) => H.ctx.M('GlobalConfig').upsert({ key: 'TESTER_DAILY_TARGET', value: { target, streakStart } });

test('the active-day row is written once per IST day: 23:59 and 00:01 IST are two days; same day = one row', async () => {
  presence._reset();
  const u = await H.mkUser();
  const req = { user: { id: u.id, role: 'student' }, headers: CUSTOMER };
  assert.equal(await presence.noteSeen(req, ist('2026-10-01', '23:58').getTime()), 1);
  // 30 s later, same day: throttled, nothing written.
  assert.equal(presence.noteSeen(req, ist('2026-10-01', '23:58:30').getTime()), null);
  // 23:59 -> 00:01: inside the 10-minute throttle, but a new IST day: written at once.
  assert.equal(await presence.noteSeen(req, ist('2026-10-02', '00:01').getTime()), 1);
  // Another instance (empty map) the same new day: the conditional UPDATE refuses the User row, the day row stays one.
  presence._reset();
  assert.equal(await presence.noteSeen(req, ist('2026-10-02', '00:03').getTime()), 0);
  const rows = await rowsOf(u);
  assert.deepEqual(rows.map((r) => dt.dayOf(r.day)), ['2026-10-01', '2026-10-02']);
  const d2 = rows[1];
  assert.equal(new Date(d2.firstAt).getTime(), ist('2026-10-02', '00:01').getTime(), 'firstAt kept');
  assert.equal(new Date(d2.lastAt).getTime(), ist('2026-10-02', '00:03').getTime(), 'lastAt refreshed');
  assert.equal(d2.appVersion, '1.0.67');
  // 5:30 UTC offset edge: 18:29 UTC is 23:59 IST (same day), 18:31 UTC is 00:01 IST (next day).
  assert.equal(dt.istDay(new Date('2026-10-05T18:29:00Z')), '2026-10-05');
  assert.equal(dt.istDay(new Date('2026-10-05T18:31:00Z')), '2026-10-06');
});

test('a failing day write never breaks the request or the last-seen write', async () => {
  presence._reset();
  const u = await H.mkUser();
  const orig = dt.recordDay;
  const warn = console.warn;
  console.warn = () => {};
  const m = H.r('utils/testerDailyTarget');
  m.recordDay = async () => { throw new Error('day table is down'); };
  try {
    assert.equal(await presence.noteSeen({ user: { id: u.id, role: 'student' }, headers: CUSTOMER }), 1);
    const r = await api('GET', '/api/users/profile', u.token, undefined, CUSTOMER);
    assert.equal(r.status, 200);
  } finally {
    m.recordDay = orig;
    console.warn = warn;
  }
  assert.ok((await H.ctx.M('User').findByPk(u.id, { raw: true })).lastSeenAt);
});

test('testers basis: met / not met, streak with a gap and today not yet met, who is active / not yet', async () => {
  const [a, b, c, d, e] = [await H.mkUser({ name: 'DT A' }), await H.mkUser({ name: 'DT B' }), await H.mkUser({ name: 'DT C' }), await H.mkUser({ name: 'DT D' }), await H.mkUser({ name: 'DT E (not a tester)' })];
  const gone = await H.mkUser({ name: 'DT Deleted', role: 'deleted' });
  const missing = '9000000123';
  await setTesters([a.phone, b.phone, c.phone, d.phone, missing, gone.phone]);
  await setSettings(3, '2026-11-01');
  const plan = {
    '2026-11-01': [a, b, c], // met
    '2026-11-02': [a, b], // missed (gap)
    '2026-11-03': [a, b, c], // met
    '2026-11-04': [a, b, c, d], // met
    '2026-11-05': [a, b, c], // met
    '2026-11-06': [a, b], // today, not met yet
  };
  for (const [day, us] of Object.entries(plan)) for (const u of [...us, e, gone]) await putDay(u, day);
  await putDay(a, '2026-10-31'); // before the streak start: ignored
  const now = ist('2026-11-06', '15:00');

  const r = await dt.dailyTarget({ now });
  assert.equal(r.basis, 'testers');
  assert.equal(r.testerCount, 6);
  assert.equal(r.target, 3);
  assert.equal(r.streakStart, '2026-11-01');
  assert.deepEqual(r.days.map((x) => [x.date, x.activeCount, x.met]), [
    ['2026-11-01', 3, true], ['2026-11-02', 2, false], ['2026-11-03', 3, true], ['2026-11-04', 4, true], ['2026-11-05', 3, true], ['2026-11-06', 2, false],
  ]);
  assert.equal(r.today.date, '2026-11-06');
  assert.equal(r.today.activeCount, 2);
  assert.equal(r.today.met, false);
  assert.equal(r.today.remainingToTarget, 1);
  assert.equal(r.currentStreak, 3, 'today not met yet: the streak ends yesterday');
  assert.equal(r.bestStreak, 3);
  assert.equal(r.dayNumber, 6);
  assert.equal(r.daysMet, 4);
  assert.equal(r.plan.length, 14);
  assert.deepEqual(r.plan.slice(0, 7).map((p) => p.state), ['met', 'missed', 'met', 'met', 'met', 'today', 'future']);
  assert.equal(r.plan[13].date, '2026-11-14');
  assert.deepEqual(r.today.activeTesters.map((t) => t.name).sort(), ['DT A', 'DT B']);
  assert.equal(r.today.activeTesters[0].phoneLast4.length, 4);
  assert.equal('phone' in r.today.activeTesters[0], false, 'only the last 4 digits');
  const notYet = Object.fromEntries(r.today.notYet.map((x) => [x.phoneLast4, x]));
  assert.equal(notYet[c.phone.slice(-4)].status, 'never_opened');
  assert.equal(notYet[d.phone.slice(-4)].name, 'DT D');
  assert.equal(notYet[missing.slice(-4)].status, 'not_signed_up');
  assert.equal(notYet[gone.phone.slice(-4)].status, 'not_signed_up', 'a deleted account is not a tester');
  assert.equal(r.today.notYet.length, 4);

  // C opens the app today (only lastSeenAt so far: counted too) -> target met, streak 4 including today.
  await H.ctx.M('User').update({ lastSeenAt: ist('2026-11-06', '14:00') }, { where: { id: c.id }, silent: true });
  const r2 = await dt.dailyTarget({ now });
  assert.equal(r2.today.activeCount, 3);
  assert.equal(r2.today.met, true);
  assert.equal(r2.today.remainingToTarget, 0);
  assert.equal(r2.currentStreak, 4);
  assert.equal(r2.bestStreak, 4);
  assert.equal(r2.plan[5].state, 'met');

  // (The presence write also logs the day row; lastSeenAt only stands in for today.)
  await putDay(c, '2026-11-06');
  // Next day, nobody yet; yesterday met: streak still 4 (today in progress).
  const r3 = await dt.dailyTarget({ now: ist('2026-11-07', '09:00') });
  assert.equal(r3.today.activeCount, 0);
  assert.equal(r3.currentStreak, 4);
  // The day after with nobody: yesterday missed -> streak 0, best stays 4.
  const r4 = await dt.dailyTarget({ now: ist('2026-11-08', '09:00') });
  assert.equal(r4.currentStreak, 0);
  assert.equal(r4.bestStreak, 4);
  assert.deepEqual(r4.days.slice(-3).map((x) => x.met), [true, false, false]);
  await H.ctx.M('User').update({ lastSeenAt: null }, { where: { id: c.id }, silent: true });

  // Streak helper on its own.
  const s = (flags, todayLast = true) => dt.streaks(flags.map((m, i) => ({ met: m, isToday: todayLast && i === flags.length - 1 })));
  assert.deepEqual(s([true, true, false, true, true, true]), { currentStreak: 3, bestStreak: 3 });
  assert.deepEqual(s([true, true, true, false]), { currentStreak: 3, bestStreak: 3 });
  assert.deepEqual(s([true, false, false]), { currentStreak: 0, bestStreak: 1 });
  assert.deepEqual(s([]), { currentStreak: 0, bestStreak: 0 });

  // Streak start in the future: no days yet, day 0.
  await setSettings(3, '2026-11-20');
  const f = await dt.dailyTarget({ now });
  assert.deepEqual(f.days, []);
  assert.equal(f.dayNumber, 0);
  assert.equal(f.plan[0].state, 'future');
  await clearTesters();
});

test('all-customers basis (no tester list): admins, deleted and owner test accounts are left out', async () => {
  await clearTesters();
  await setSettings(2, '2026-11-01');
  const day = '2026-10-20';
  await setSettings(2, day);
  const x = await H.mkUser({ name: 'All X' });
  const y = await H.mkUser({ name: 'All Y' });
  const owner = await H.mkUser({ name: 'All Owner Test' });
  const gone = await H.mkUser({ name: 'All Deleted', role: 'deleted' });
  for (const u of [x, admin, owner, gone]) await putDay(u, day);
  const prev = process.env.TEST_VIEWER_PHONES;
  process.env.TEST_VIEWER_PHONES = owner.phone;
  await H.r('utils/testView').loadTesters({ fresh: true });
  try {
    const now = ist(day, '20:00');
    const r = await dt.dailyTarget({ now });
    assert.equal(r.basis, 'all customers');
    assert.equal(r.testerCount, null);
    assert.equal(r.today.activeCount, 1);
    assert.equal(r.today.met, false);
    assert.deepEqual(r.today.notYet, []);
    await putDay(y, day);
    const r2 = await dt.dailyTarget({ now });
    assert.equal(r2.today.activeCount, 2);
    assert.equal(r2.today.met, true);
    assert.deepEqual(r2.today.activeTesters.map((t) => t.name).sort(), ['All X', 'All Y']);
    assert.equal(r2.currentStreak, 1);
  } finally {
    if (prev === undefined) delete process.env.TEST_VIEWER_PHONES; else process.env.TEST_VIEWER_PHONES = prev;
    await H.r('utils/testView').loadTesters({ fresh: true });
  }
});

test('admin only', async () => {
  const u = await H.mkUser();
  for (const [m, url, body] of [['GET', '/api/admin/active-users/daily-target'], ['PUT', '/api/admin/active-users/daily-target', { target: 5 }]]) {
    assert.equal((await api(m, url, u.token, body)).status, 403, url);
    assert.equal((await api(m, url, null, body)).status, 401, url);
  }
});

test('settings: validation, save, audit, conflict, generic Config refused; GET shape', async () => {
  await H.ctx.M('GlobalConfig').destroy({ where: { key: 'TESTER_DAILY_TARGET' } });
  const g = await api('GET', '/api/admin/active-users/daily-target?days=14', admin.token);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.target, 12, 'default target');
  assert.equal(g.body.streakStart, '2026-11-06', 'default streak start');
  assert.equal(g.body.goalDays, 14);
  assert.equal(g.body.timezone, 'Asia/Kolkata');
  assert.equal(typeof g.body.today.activeCount, 'number');
  assert.equal(typeof g.body.usageTracking.enabled, 'boolean');

  const put = (body) => api('PUT', '/api/admin/active-users/daily-target', admin.token, body);
  for (const bad of [{}, { target: 0 }, { target: 501 }, { target: 1.5 }, { target: 'abc' }, { target: null }, { streakStart: '2026-02-30' }, { streakStart: '06-11-2026' }, { streakStart: '2025-12-31' }, { streakStart: '2030-01-01' }]) {
    const r = await put(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.code, 'INVALID_DAILY_TARGET');
  }
  assert.equal(await H.ctx.M('GlobalConfig').count({ where: { key: 'TESTER_DAILY_TARGET' } }), 0, 'nothing saved');
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'TESTER_DAILY_TARGET_UPDATED' } }), 0);

  const ok = await put({ target: '15', streakStart: '2026-11-07' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.changed, true);
  assert.equal(ok.body.target, 15);
  assert.equal(ok.body.streakStart, '2026-11-07');
  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'TESTER_DAILY_TARGET_UPDATED' }, raw: true });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].adminId, String(admin.id));
  assert.deepEqual(JSON.parse(logs[0].details), { before: { target: 12, streakStart: '2026-11-06' }, after: { target: 15, streakStart: '2026-11-07' } });

  // Same values: no change, no new audit row.
  const same = await put({ target: 15 });
  assert.equal(same.body.changed, false);
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'TESTER_DAILY_TARGET_UPDATED' } }), 1);
  // Stale ifUpdatedAt: 409.
  assert.equal((await put({ target: 13, ifUpdatedAt: '2020-01-01T00:00:00.000Z' })).status, 409);
  // Back to the owner's values.
  const back = await put({ target: 12, streakStart: '2026-11-06', ifUpdatedAt: same.body.settingsUpdatedAt });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(await H.ctx.M('VerificationLog').count({ where: { action: 'TESTER_DAILY_TARGET_UPDATED' } }), 2);

  for (const key of ['TESTER_DAILY_TARGET', 'USAGE_TRACKING_ENABLED', 'CLOSED_TESTER_PHONES']) {
    const generic = await api('POST', '/api/admin/config', admin.token, { key, value: { target: 1, enabled: false } });
    assert.equal(generic.status, 400, key);
  }
});

test('backfill: today\'s row for accounts seen today, idempotent, never overwrites', async () => {
  const now = new Date();
  const u = await H.mkUser({ name: 'Backfill Today' });
  const old = await H.mkUser({ name: 'Backfill Old' });
  const firstSeen = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
  const lastSeen = new Date(Math.max(dt.istDayStart(now).getTime(), now.getTime() - 60 * 1000));
  await H.ctx.M('User').update({ lastSeenAt: lastSeen, firstSeenAt: firstSeen, lastAppVersion: '1.0.66' }, { where: { id: u.id }, silent: true });
  await H.ctx.M('User').update({ lastSeenAt: new Date(dt.istDayStart(now).getTime() - 3600 * 1000) }, { where: { id: old.id }, silent: true });

  const n1 = await dt.backfillToday({ now });
  assert.ok(n1 >= 1);
  const rows = await rowsOf(u);
  assert.equal(rows.length, 1);
  assert.equal(dt.dayOf(rows[0].day), dt.istDay(now));
  assert.equal(new Date(rows[0].firstAt).getTime(), lastSeen.getTime(), 'firstSeenAt before today: today starts at lastSeenAt');
  assert.equal(rows[0].appVersion, '1.0.66');
  assert.equal((await rowsOf(old)).length, 0, 'not seen today: nothing');

  // Again: nothing new, nothing overwritten.
  await UDA().update({ appVersion: '1.0.67' }, { where: { userId: String(u.id) } });
  const n2 = await dt.backfillToday({ now });
  assert.equal(n2, 0);
  const again = await rowsOf(u);
  assert.equal(again.length, 1);
  assert.equal(again[0].appVersion, '1.0.67');
  // The boot migration runs the same thing safely.
  const mig = await dt.runDailyActivityMigrations(H.ctx.sequelize);
  assert.equal(mig.ok, true);
  assert.equal(mig.backfilled, 0);
});
