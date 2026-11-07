/**
 * ============================================================================================================
 *  CLOSED-TEST ONLY: app usage time (owner, 6 Nov 2026). Temporary: switched off and the data deleted once ZenWe
 *  reaches production. To remove it entirely later: this file, the /usage-heartbeat route (routes/userRoutes),
 *  the usage-tracking routes (routes/activeUsersRoutes), the usageTracking flag (controllers/appVersionController),
 *  customer-mobile/utils/usageTime.ts (+ its one line in app/_layout.tsx) and the usage UI on Admin > Active testers.
 * ============================================================================================================
 *
 * How long each signed-in customer uses the app, per IST day, in UserDailyActivities.activeSeconds / sessions.
 *
 * Switch: GlobalConfig USAGE_TRACKING_ENABLED = { enabled } (default ON while no row exists). The customer app
 * reads it from GET /api/config/app-version?app=customer (field usageTracking, the call it already makes on launch
 * and resume) and sends nothing when it is off; heartbeats that still arrive are ignored. Turning it off needs no
 * app update.
 *
 * heartbeat(userId, { seconds, final, now }): the app sends the foreground seconds since its last beat, about every
 * 60 s and once when it goes to the background (final). The server never trusts the number:
 *   - at most MAX_BEAT_SECONDS (75) are credited per beat;
 *   - inside a session at most the wall-clock time since the last credited beat is credited (so beats can never
 *     add more than real time), and a beat within 30 s of the last one is a duplicate and ignored (unless final);
 *   - a gap of more than 5 minutes since the last beat starts a new session (sessions + 1);
 *   - credited time that crosses IST midnight is split between the two days;
 *   - concurrent beats: the last-beat marker is claimed with a conditional UPDATE, so only one of them counts.
 */
const { QueryTypes } = require('sequelize');
const dt = require('./testerDailyTarget');

const SWITCH_KEY = 'USAGE_TRACKING_ENABLED';
const MAX_BEAT_SECONDS = 75;
const DUPLICATE_MS = 30 * 1000;
const SESSION_GAP_MS = 5 * 60 * 1000;
const CACHE_MS = 15 * 1000;
const T = `"${dt.TABLE}"`;

let cache = { at: 0, value: null };

/** { enabled, updatedAt }. Default ON (no row). Cached 15 s per instance. */
const readSwitch = async ({ fresh = false } = {}) => {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
  const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: SWITCH_KEY } }) : null;
  let v = row ? row.value : null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  const value = { enabled: !(v && v.enabled === false), updatedAt: row ? row.updatedAt : null };
  cache = { at: Date.now(), value };
  return value;
};
const isEnabled = async () => {
  try { return (await readSwitch()).enabled; } catch { return false; }
};
const setSwitch = async (enabled) => {
  const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
  await GlobalConfig.upsert({ key: SWITCH_KEY, value: { enabled: !!enabled }, description: 'CLOSED-TEST ONLY: record how long customers use the app. Edit on Active testers.' });
  cache = { at: 0, value: null };
  return readSwitch({ fresh: true });
};
const _resetCache = () => { cache = { at: 0, value: null }; };

const db = () => require('../models/UserDailyActivity').getUserDailyActivityModel().sequelize;

const ensureRow = (s, userId, day, at) => s.query(
  `INSERT INTO ${T} ("userId", "day", "firstAt", "lastAt", "activeSeconds", "sessions") VALUES (:userId, :day, :at, :at, 0, 0)
   ON CONFLICT ("userId", "day") DO NOTHING`,
  { replacements: { userId, day, at }, logging: false },
);
// With type UPDATE / INSERT, Postgres and SQLite both answer [rows | lastId, affectedRowCount].
const affected = (n) => (typeof n === 'number' ? n : Number(n) || 0);

/**
 * Credits one heartbeat. Returns { enabled, credited, duplicate, newSession, split }.
 * `seconds` must already be a finite number (the route validates it).
 */
const heartbeat = async (userId, { seconds, final = false, now = new Date() } = {}) => {
  if (!(await isEnabled())) return { enabled: false, credited: 0, duplicate: false, newSession: false };
  const s = db();
  const id = String(userId);
  const at = now instanceof Date ? now : new Date(now);
  const nowMs = at.getTime();
  const today = dt.istDay(at);
  const claimed = Math.max(0, Math.min(Math.round(Number(seconds) || 0), 3600));

  const [latest] = await s.query(
    `SELECT "day", "lastBeatMs" FROM ${T} WHERE "userId" = :id AND "lastBeatMs" IS NOT NULL ORDER BY "day" DESC LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT, logging: false },
  );
  const prevMs = latest ? Number(latest.lastBeatMs) : null;
  const gap = prevMs === null ? null : nowMs - prevMs;
  if (gap !== null && gap < 0) return { enabled: true, credited: 0, duplicate: true, newSession: false };
  if (gap !== null && gap < DUPLICATE_MS && !final) return { enabled: true, credited: 0, duplicate: true, newSession: false };
  const newSession = gap === null || gap > SESSION_GAP_MS;
  const credit = Math.min(claimed, MAX_BEAT_SECONDS, newSession ? MAX_BEAT_SECONDS : Math.ceil(gap / 1000));

  await ensureRow(s, id, today, at);
  // Claim the last-beat marker (only one of two concurrent beats wins).
  let claimedOk;
  if (latest) {
    const [, meta] = await s.query(
      `UPDATE ${T} SET "lastBeatMs" = :nowMs WHERE "userId" = :id AND "day" = :day AND "lastBeatMs" = :prevMs`,
      { replacements: { id, day: dt.dayOf(latest.day), nowMs, prevMs }, type: QueryTypes.UPDATE, logging: false },
    );
    claimedOk = affected(meta) > 0;
  } else {
    const [, meta] = await s.query(
      `UPDATE ${T} SET "lastBeatMs" = :nowMs WHERE "userId" = :id AND "day" = :day AND "lastBeatMs" IS NULL`,
      { replacements: { id, day: today, nowMs }, type: QueryTypes.UPDATE, logging: false },
    );
    claimedOk = affected(meta) > 0;
  }
  if (!claimedOk) return { enabled: true, credited: 0, duplicate: true, newSession: false };

  // Split across IST midnight: the part before 00:00 goes to yesterday's row.
  const dayStartMs = dt.istDayStart(at).getTime();
  const before = Math.max(0, Math.min(credit, Math.ceil((dayStartMs - (nowMs - credit * 1000)) / 1000)));
  const after = credit - before;
  if (before > 0) {
    const yday = dt.addDays(today, -1);
    const ydayAt = new Date(dayStartMs - 1000);
    await ensureRow(s, id, yday, ydayAt);
    await s.query(
      `UPDATE ${T} SET "activeSeconds" = "activeSeconds" + :before, "sessions" = CASE WHEN "sessions" = 0 THEN 1 ELSE "sessions" END
       WHERE "userId" = :id AND "day" = :yday`,
      { replacements: { id, yday, before }, logging: false },
    );
  }
  // A session continuing from an earlier day also counts as a session today.
  const continuing = !!latest && dt.dayOf(latest.day) !== today;
  await s.query(
    `UPDATE ${T} SET "activeSeconds" = "activeSeconds" + :after, "lastBeatMs" = :nowMs,
       "sessions" = "sessions" + (CASE WHEN :inc = 1 THEN 1 WHEN "sessions" = 0 THEN 1 ELSE 0 END)
     WHERE "userId" = :id AND "day" = :today`,
    { replacements: { id, today, after, nowMs, inc: newSession || continuing ? 1 : 0 }, logging: false },
  );
  return { enabled: true, credited: credit, duplicate: false, newSession, split: before > 0 };
};

/**
 * Deletes usage data. includeDailyHistory=false: activeSeconds / sessions / lastBeatMs reset on every row (the
 * active-day rows and the streak stay). true: every UserDailyActivities row is deleted (streak history too).
 */
const deleteUsageData = async ({ includeDailyHistory = false } = {}) => {
  const M = require('../models/UserDailyActivity').getUserDailyActivityModel();
  if (includeDailyHistory) {
    const n = await M.destroy({ where: {}, truncate: false });
    return { rowsDeleted: n, rowsCleared: 0 };
  }
  const [n] = await M.update({ activeSeconds: 0, sessions: 0, lastBeatMs: null }, { where: {} });
  return { rowsDeleted: 0, rowsCleared: n };
};

/** Rows that hold usage time (for the admin page). */
const usageDataStats = async () => {
  const M = require('../models/UserDailyActivity').getUserDailyActivityModel();
  const { Op } = require('sequelize');
  const [withTime, total] = await Promise.all([
    M.count({ where: { [Op.or]: [{ activeSeconds: { [Op.gt]: 0 } }, { sessions: { [Op.gt]: 0 } }] } }),
    M.count(),
  ]);
  return { rowsWithUsage: withTime, dailyRows: total };
};

/**
 * Per user: today's seconds + sessions and the 7-day average minutes per day (total minutes across the last 7 IST days
 * divided by 7). Map userId -> { minutesToday, sessionsToday, avgMinutes7d, daysActive7d }.
 */
const usageFor = async (userIds, { now = new Date() } = {}) => {
  const out = new Map();
  const M = require('../models/UserDailyActivity').getUserDailyActivityModel();
  if (!M || !userIds.length) return out;
  const { Op } = require('sequelize');
  const today = dt.istDay(now);
  const rows = await M.findAll({
    where: { userId: { [Op.in]: userIds.map(String) }, day: { [Op.between]: [dt.addDays(today, -6), today] } },
    attributes: ['userId', 'day', 'activeSeconds', 'sessions'],
    raw: true,
  });
  for (const r of rows) {
    const id = String(r.userId);
    const e = out.get(id) || { secondsToday: 0, sessionsToday: 0, seconds7d: 0, daysActive7d: 0 };
    const secs = Number(r.activeSeconds) || 0;
    if (dt.dayOf(r.day) === today) { e.secondsToday = secs; e.sessionsToday = Number(r.sessions) || 0; }
    e.seconds7d += secs;
    e.daysActive7d += 1;
    out.set(id, e);
  }
  for (const [id, e] of out) {
    out.set(id, {
      minutesToday: Math.round(e.secondsToday / 60),
      sessionsToday: e.sessionsToday,
      avgMinutes7d: Math.round(e.seconds7d / 60 / 7),
      daysActive7d: e.daysActive7d,
    });
  }
  return out;
};

/** Today's totals over the given eligible user ids' rows: { totalMinutes, activeUsers, avgMinutesPerActiveUser }. */
const todayTotals = async (isEligible, { now = new Date() } = {}) => {
  const M = require('../models/UserDailyActivity').getUserDailyActivityModel();
  if (!M) return { totalMinutes: 0, usersWithTime: 0, avgMinutesPerActiveUser: 0 };
  const rows = await M.findAll({ where: { day: dt.istDay(now) }, attributes: ['userId', 'activeSeconds'], raw: true });
  let secs = 0;
  let users = 0;
  for (const r of rows) {
    const n = Number(r.activeSeconds) || 0;
    if (n > 0 && isEligible(String(r.userId))) { secs += n; users += 1; }
  }
  return { totalMinutes: Math.round(secs / 60), usersWithTime: users, avgMinutesPerActiveUser: users ? Math.round(secs / 60 / users) : 0 };
};

const NOT_CUSTOMER = new Set(['restaurant', 'rider', 'deleted', 'auto_driver', 'pg_owner']);

/**
 * POST /api/users/usage-heartbeat { seconds, final? }   (routes/userRoutes: protect + per-user rate limit)
 * Customer accounts on the customer app only. 200 { enabled, credited, duplicate, newSession } (enabled false = the
 * switch is off: the app stops sending until the next app-version check says it is on again).
 */
const heartbeatHandler = async (req, res) => {
  try {
    const user = req.user || {};
    if (!user.id || NOT_CUSTOMER.has(String(user.role || '').toLowerCase())) {
      return res.status(403).json({ code: 'CUSTOMERS_ONLY', message: 'Only customer accounts.' });
    }
    if (!require('./appPresence').isCustomerApp(req)) {
      return res.status(403).json({ code: 'CUSTOMER_APP_ONLY', message: 'Only the ZenWe customer app.' });
    }
    if (require('./loadtestBypass').isLoadtestRequest(req)) return res.json({ enabled: false, credited: 0 });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seconds = typeof body.seconds === 'number' ? body.seconds : NaN;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
      return res.status(400).json({ code: 'INVALID_SECONDS', message: 'seconds must be a number from 0 to 3600.' });
    }
    const r = await heartbeat(user.id, { seconds, final: body.final === true });
    res.json(r);
  } catch (err) {
    // Never matters to the user: logged, answered quietly.
    console.warn('[USAGE_HEARTBEAT_WARN]', err && err.message);
    res.status(200).json({ enabled: true, credited: 0, error: true });
  }
};

module.exports = {
  heartbeatHandler,
  SWITCH_KEY, MAX_BEAT_SECONDS, DUPLICATE_MS, SESSION_GAP_MS,
  readSwitch, isEnabled, setSwitch, heartbeat, deleteUsageData, usageDataStats, usageFor, todayTotals, _resetCache,
};
