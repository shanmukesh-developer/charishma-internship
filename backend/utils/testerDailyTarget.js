/**
 * Daily target + streak for the Google Play closed test (owner, 6 Nov 2026: "did 12+ testers use ZenWe today?").
 *
 *   recordDay(userId, { version, now })   upsert of today's UserDailyActivities row (IST day); called by
 *                                         utils/appPresence on its throttled write path (fire-and-forget)
 *   runDailyActivityMigrations(sequelize) boot: table (Postgres + SQLite), then backfill of today's row for every
 *                                         account whose Users.lastSeenAt is today (idempotent: ON CONFLICT DO NOTHING)
 *   readSettings() / saveSettings()       GlobalConfig TESTER_DAILY_TARGET = { target, streakStart }
 *   dailyTarget({ goalDays, now })        the admin report (routes/activeUsersRoutes GET /daily-target)
 *
 * Who counts ("basis"):
 *   - the closed-tester phone list (CLOSED_TESTER_PHONES, Active testers) when it is set: exactly those accounts
 *     (admins and deleted accounts left out; an owner test account on the list counts, the owner put it there);
 *   - otherwise every customer account: admins, deleted accounts and owner test accounts (TEST_VIEWER_PHONES) left out.
 * The current tester list is applied to past days too (a tester added today also counts on the days already logged).
 *
 * Streak: each IST day from streakStart to today is "met" when its active count >= target. currentStreak counts the
 * consecutive met days ending today, or ending yesterday while today is not met yet (today is still in progress).
 * bestStreak is the longest run of met days since streakStart.
 */
const { Op, QueryTypes } = require('sequelize');

const SETTINGS_KEY = 'TESTER_DAILY_TARGET';
const DEFAULT_TARGET = 12;
const DEFAULT_STREAK_START = '2026-11-06';
const DEFAULT_GOAL_DAYS = 14;
const MAX_GOAL_DAYS = 60;
const MAX_HISTORY_DAYS = 120;
const TARGET_MIN = 1;
const TARGET_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET = 330 * 60 * 1000;
const TABLE = 'UserDailyActivities';

const toMs = (now) => (now instanceof Date ? now.getTime() : Number(now));
/** 'YYYY-MM-DD' of the IST calendar day of `now`. */
const istDay = (now = new Date()) => new Date(toMs(now) + IST_OFFSET).toISOString().slice(0, 10);
/** Start (00:00 IST) of the IST day of `now`, as a Date. */
const istDayStart = (now = new Date()) => {
  const ist = new Date(toMs(now) + IST_OFFSET);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET);
};
const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
/** A DATEONLY value as read back from Postgres / SQLite -> 'YYYY-MM-DD'. */
const dayOf = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

const model = () => require('../models/UserDailyActivity').getUserDailyActivityModel();

/**
 * Today's row for this user: inserted once per IST day, then only lastAt / appVersion refreshed (the caller is
 * already throttled to about one call per user per 10 minutes). Resolves to true when written; rejects on a
 * database error (the caller catches).
 */
const recordDay = async (userId, { version = null, now = new Date() } = {}) => {
  const M = model();
  if (!M || !userId) return false;
  const at = now instanceof Date ? now : new Date(now);
  await M.sequelize.query(
    `INSERT INTO "${TABLE}" ("userId", "day", "firstAt", "lastAt", "appVersion", "activeSeconds", "sessions")
     VALUES (:userId, :day, :at, :at, :version, 0, 0)
     ON CONFLICT ("userId", "day") DO UPDATE SET "lastAt" = excluded."lastAt",
       "appVersion" = COALESCE(excluded."appVersion", "${TABLE}"."appVersion")`,
    { replacements: { userId: String(userId), day: istDay(at), at, version: version || null }, logging: false },
  );
  return true;
};

/** Today's row for every account whose lastSeenAt is today (IST). Idempotent; returns rows inserted (approx). */
const backfillToday = async ({ now = new Date() } = {}) => {
  const M = model();
  const User = require('../models/User').getUserModel();
  if (!M || !User || !User.rawAttributes.lastSeenAt) return 0;
  const start = istDayStart(now);
  const users = await User.findAll({
    where: { lastSeenAt: { [Op.gte]: start } },
    attributes: ['id', 'firstSeenAt', 'lastSeenAt', 'lastAppVersion'],
    raw: true,
    logging: false,
  });
  let n = 0;
  for (const u of users) {
    const last = new Date(u.lastSeenAt);
    const firstSeen = u.firstSeenAt ? new Date(u.firstSeenAt) : null;
    // Earliest use known for today: firstSeenAt when it is today, else lastSeenAt.
    const first = firstSeen && firstSeen.getTime() >= start.getTime() && firstSeen.getTime() <= last.getTime() ? firstSeen : last;
    const [, meta] = await M.sequelize.query(
      `INSERT INTO "${TABLE}" ("userId", "day", "firstAt", "lastAt", "appVersion", "activeSeconds", "sessions")
       VALUES (:userId, :day, :first, :last, :version, 0, 0)
       ON CONFLICT ("userId", "day") DO NOTHING`,
      { replacements: { userId: String(u.id), day: istDay(last), first, last, version: u.lastAppVersion || null }, type: QueryTypes.INSERT, logging: false },
    );
    // [rows | lastId, affected rows] on Postgres and SQLite alike.
    n += Number(meta) || 0;
  }
  return n;
};

/** Boot: create the table if missing (sync() normally already did), then backfill today. Never throws. */
const runDailyActivityMigrations = async (sequelize) => {
  try {
    const M = model() || (sequelize && sequelize.models && sequelize.models.UserDailyActivity);
    if (!M) return { ok: false, reason: 'model not initialised' };
    await M.sync();
    const backfilled = await backfillToday();
    if (backfilled) console.log(`✅ [DAILY_ACTIVITY] Backfilled today's active-day rows: ${backfilled}`);
    return { ok: true, backfilled };
  } catch (err) {
    console.warn('⚠️ [DAILY_ACTIVITY_MIGRATION_WARN]', err.message);
    return { ok: false, error: err.message };
  }
};

// ─── Settings ────────────────────────────────────────────────────────────────

const readSettings = async () => {
  const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
  const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: SETTINGS_KEY } }) : null;
  let v = row ? row.value : null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  const t = v && Number.isInteger(v.target) && v.target >= TARGET_MIN && v.target <= TARGET_MAX ? v.target : DEFAULT_TARGET;
  const s = v && isDay(v.streakStart) ? v.streakStart : DEFAULT_STREAK_START;
  return { target: t, streakStart: s, updatedAt: row ? row.updatedAt : null, saved: !!row };
};

/**
 * Validates { target?, streakStart? }. Returns { error } or { value: { target, streakStart } } merged onto `current`.
 * target: whole number 1..500 (a digit string is accepted). streakStart: a real 'YYYY-MM-DD' from 2026-01-01 up to
 * 60 days after today (IST).
 */
const validateSettings = (body, current, now = new Date()) => {
  const b = body && typeof body === 'object' ? body : {};
  if (b.target === undefined && b.streakStart === undefined) return { error: 'Send target and / or streakStart.' };
  let target = current.target;
  let streakStart = current.streakStart;
  if (b.target !== undefined) {
    const n = typeof b.target === 'string' && /^\d{1,4}$/.test(b.target.trim()) ? Number(b.target.trim()) : b.target;
    if (!Number.isInteger(n) || n < TARGET_MIN || n > TARGET_MAX) return { error: `The daily target must be a whole number from ${TARGET_MIN} to ${TARGET_MAX}.` };
    target = n;
  }
  if (b.streakStart !== undefined) {
    const s = typeof b.streakStart === 'string' ? b.streakStart.trim() : b.streakStart;
    if (!isDay(s)) return { error: 'The streak start must be a date like 2026-11-06.' };
    if (s < '2026-01-01' || s > addDays(istDay(now), 60)) return { error: 'The streak start must be between 1 Jan 2026 and 60 days from today.' };
    streakStart = s;
  }
  return { value: { target, streakStart } };
};

const saveSettings = async (value) => {
  const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
  await GlobalConfig.upsert({ key: SETTINGS_KEY, value, description: 'Play closed test: daily active-tester target and streak start (IST). Edit on Active testers.' });
  return readSettings();
};

// ─── Report ──────────────────────────────────────────────────────────────────

const last4 = (p) => String(p || '').replace(/\D/g, '').slice(-4);
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const isOut = (role) => ['admin', 'deleted'].includes(String(role || '').toLowerCase());

const streaks = (days) => {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.met ? run + 1 : 0;
    if (run > best) best = run;
  }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && !days[i].met && days[i].isToday) i -= 1; // today still in progress: count up to yesterday
  for (; i >= 0 && days[i].met; i -= 1) current += 1;
  return { currentStreak: current, bestStreak: best };
};

const dailyTarget = async ({ goalDays = DEFAULT_GOAL_DAYS, now = new Date() } = {}) => {
  const au = require('./activeUsers');
  const User = require('../models/User').getUserModel();
  const M = model();
  const settings = await readSettings();
  const goal = Math.min(Math.max(parseInt(goalDays, 10) || DEFAULT_GOAL_DAYS, 1), MAX_GOAL_DAYS);
  const today = istDay(now);
  const todayStart = istDayStart(now);
  const start = settings.streakStart;
  const started = start <= today;
  const historyFrom = started ? (diffDays(start, today) >= MAX_HISTORY_DAYS ? addDays(today, -(MAX_HISTORY_DAYS - 1)) : start) : today;

  const [rows, seenToday, testerList] = await Promise.all([
    M ? M.findAll({ where: { day: { [Op.between]: [historyFrom, today] } }, attributes: ['userId', 'day', 'firstAt', 'lastAt', 'appVersion', 'activeSeconds', 'sessions'], raw: true }) : [],
    User.findAll({ where: { lastSeenAt: { [Op.gte]: todayStart, [Op.lt]: new Date(todayStart.getTime() + DAY_MS) } }, attributes: ['id', 'lastSeenAt', 'lastAppVersion'], raw: true }),
    au.readTesterList(),
  ]);

  const attrs = ['id', 'name', 'phone', 'role', 'lastSeenAt', 'lastAppVersion'];
  const eligible = new Map(); // id -> user
  let notSignedUp = [];
  let basis;
  let testerPhones = [];
  if (testerList.phones.length) {
    basis = 'testers';
    testerPhones = testerList.phones;
    const users = await User.findAll({ where: { phone: { [Op.in]: testerPhones.flatMap((p) => [p, `+91${p}`, `91${p}`]) } }, attributes: attrs, raw: true });
    const byPhone = new Map();
    for (const u of users) {
      const k = last10(u.phone);
      if (!byPhone.has(k) || String(byPhone.get(k).role).toLowerCase() === 'deleted') byPhone.set(k, u);
    }
    for (const p of testerPhones) {
      const u = byPhone.get(p);
      if (u && !isOut(u.role)) eligible.set(String(u.id), u);
      else if (!u || String(u.role).toLowerCase() === 'deleted') notSignedUp.push(p);
    }
  } else {
    basis = 'all customers';
    const ids = [...new Set([...rows.map((r) => String(r.userId)), ...seenToday.map((u) => String(u.id))])];
    if (ids.length) {
      const ownerTest = await (async () => {
        try { const t = await require('./testView').loadTesters(); return t && t.phones ? t.phones : new Set(); } catch { return new Set(); }
      })();
      const users = await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: attrs, raw: true });
      for (const u of users) if (!isOut(u.role) && !ownerTest.has(last10(u.phone))) eligible.set(String(u.id), u);
    }
  }

  // Active users per day (eligible only); today also counts lastSeenAt (a write the daily row may have missed).
  const perDay = new Map();
  const todayRows = new Map();
  for (const r of rows) {
    const id = String(r.userId);
    if (!eligible.has(id)) continue;
    const d = dayOf(r.day);
    if (!perDay.has(d)) perDay.set(d, new Set());
    perDay.get(d).add(id);
    if (d === today) todayRows.set(id, r);
  }
  if (!perDay.has(today)) perDay.set(today, new Set());
  for (const u of seenToday) if (eligible.has(String(u.id))) perDay.get(today).add(String(u.id));

  const target = settings.target;
  const activeIds = [...perDay.get(today)];
  const activeCount = activeIds.length;
  const seenMap = new Map(seenToday.map((u) => [String(u.id), u]));
  const activeTesters = activeIds.map((id) => {
    const u = eligible.get(id);
    const r = todayRows.get(id);
    const s = seenMap.get(id);
    return {
      userId: id,
      name: u.name || null,
      phoneLast4: last4(u.phone),
      firstAt: r ? r.firstAt : (s ? s.lastSeenAt : null),
      lastAt: r ? r.lastAt : (s ? s.lastSeenAt : null),
      appVersion: (r && r.appVersion) || u.lastAppVersion || null,
      // closed-test only (utils/usageTime.js)
      minutesToday: r ? Math.round((Number(r.activeSeconds) || 0) / 60) : 0,
      sessionsToday: r ? Number(r.sessions) || 0 : 0,
    };
  }).sort((a, b) => new Date(a.firstAt || 0).getTime() - new Date(b.firstAt || 0).getTime());

  const notYet = basis === 'testers'
    ? [
      ...[...eligible.values()].filter((u) => !perDay.get(today).has(String(u.id))).map((u) => ({
        name: u.name || null, phoneLast4: last4(u.phone), status: u.lastSeenAt ? 'not_opened_today' : 'never_opened', lastSeenAt: u.lastSeenAt || null,
      })),
      ...notSignedUp.map((p) => ({ name: null, phoneLast4: last4(p), status: 'not_signed_up', lastSeenAt: null })),
    ]
    : [];

  const days = [];
  if (started) {
    for (let d = historyFrom; d <= today; d = addDays(d, 1)) {
      const n = perDay.has(d) ? perDay.get(d).size : 0;
      days.push({ date: d, activeCount: n, met: n >= target, isToday: d === today });
    }
  }
  const { currentStreak, bestStreak } = streaks(days);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const plan = [];
  for (let i = 0; i < goal; i += 1) {
    const date = addDays(start, i);
    const d = byDate.get(date);
    let state = 'future';
    if (date < today) state = d && d.met ? 'met' : 'missed';
    else if (date === today) state = d && d.met ? 'met' : 'today';
    plan.push({ date, dayNumber: i + 1, activeCount: d ? d.activeCount : null, state });
  }
  // closed-test only (utils/usageTime.js)
  const secsOf = (id) => (todayRows.get(id) ? Number(todayRows.get(id).activeSeconds) || 0 : 0);
  const totalSeconds = activeIds.reduce((s, id) => s + secsOf(id), 0);
  const withTime = activeIds.filter((id) => secsOf(id) > 0).length;

  return {
    now: new Date(toMs(now)).toISOString(),
    timezone: 'Asia/Kolkata',
    target,
    streakStart: start,
    goalDays: goal,
    settingsUpdatedAt: settings.updatedAt,
    basis,
    testerCount: basis === 'testers' ? testerPhones.length : null,
    today: {
      date: today,
      activeCount,
      met: activeCount >= target,
      remainingToTarget: Math.max(0, target - activeCount),
      activeTesters,
      notYet,
      // closed-test only (utils/usageTime.js)
      usage: { totalMinutes: Math.round(totalSeconds / 60), avgMinutesPerActiveUser: withTime ? Math.round(totalSeconds / 60 / withTime) : 0, usersWithTime: withTime },
    },
    days,
    plan,
    dayNumber: started ? diffDays(start, today) + 1 : 0,
    daysMet: days.filter((d) => d.met).length,
    daysCompleted: plan.filter((p) => p.state === 'met').length,
    currentStreak,
    bestStreak,
  };
};

module.exports = {
  SETTINGS_KEY, DEFAULT_TARGET, DEFAULT_STREAK_START, DEFAULT_GOAL_DAYS, TARGET_MIN, TARGET_MAX, TABLE,
  istDay, istDayStart, addDays, diffDays, isDay, dayOf,
  recordDay, backfillToday, runDailyActivityMigrations,
  readSettings, validateSettings, saveSettings, dailyTarget, streaks,
};
