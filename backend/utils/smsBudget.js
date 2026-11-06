// C1-6: global daily SMS budget (circuit breaker against SMS-cost abuse), counted in the database
// (SmsDailyCounts, one row per IST day) so every server process shares it.
//   reserve()  -> { ok: true, day, count } | { ok: false, day, cap }  (one slot per SMS about to go out)
//   refund(day)   gives a slot back when the provider did not send
// Cap: env SMS_DAILY_CAP (default 2000; 0 or below = no cap). The first refusal of a day pushes the
// admins once (conditional alertedAt update: one process wins). Fails OPEN on a database error (a
// counter outage must not stop logins; the per-phone cooldown / daily cap still apply).
// Early warning at 50 % / 80 % of the cap: see the end of this file.
const DEFAULT_CAP = 2000;

const dailyCap = (env = process.env) => {
  const raw = env.SMS_DAILY_CAP;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_CAP;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_CAP;
};

const istDay = (now = Date.now()) => new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const model = () => {
  const { getSmsDailyCountModel } = require('../models/SmsDailyCount');
  return getSmsDailyCountModel();
};

let tableReady = false;
const ready = async (M) => {
  if (!tableReady) { await M.sync(); tableReady = true; } // no-op when the startup sync created it
  return M;
};

const isUniqueError = (err) => !!err && (err.name === 'SequelizeUniqueConstraintError' || /unique|duplicate|PRIMARY KEY/i.test(String(err.message || '')));

const tryIncrement = async (M, day, cap) => {
  const { Op, literal } = require('sequelize');
  const [n] = await M.update({ count: literal('"count" + 1') }, { where: { day, count: { [Op.lt]: cap } } });
  return n > 0;
};

const alertOnce = async (M, day, cap, io) => {
  try {
    const [won] = await M.update({ alertedAt: new Date() }, { where: { day, alertedAt: null } });
    if (!won) return false;
    console.error(`🚨 [SMS_BUDGET] Daily SMS cap reached (${cap} on ${day} IST): OTP SMS are paused until midnight IST. Raise SMS_DAILY_CAP on Render if this is real traffic.`);
    await require('./adminAlert').pushAdmins(
      '🚨 SMS budget reached',
      `ZenWe sent ${cap} OTP SMS today (the daily cap). New OTP SMS are paused until midnight IST; password login still works. Raise SMS_DAILY_CAP if this is real traffic.`,
      { type: 'SMS_BUDGET', day },
      { io },
    );
    return true;
  } catch (err) {
    console.warn('[SMS_BUDGET_ALERT_WARN]', err.message);
    return false;
  }
};

const reserve = async ({ env = process.env, io = null, now = Date.now() } = {}) => {
  const cap = dailyCap(env);
  const day = istDay(now);
  if (cap <= 0) return { ok: true, day, count: null, uncapped: true };
  let M;
  try {
    M = model();
    if (!M) return { ok: true, day, count: null, failOpen: true };
    await ready(M);
    if (await tryIncrement(M, day, cap)) { warnLater(io); return { ok: true, day }; }
    const row = await M.findByPk(day);
    if (!row) {
      try {
        await M.create({ day, count: 1 });
        return { ok: true, day };
      } catch (err) {
        if (!isUniqueError(err)) throw err;
        if (await tryIncrement(M, day, cap)) return { ok: true, day }; // another process created it first
      }
    }
    await alertOnce(M, day, cap, io);
    return { ok: false, day, cap };
  } catch (err) {
    console.warn(`[SMS_BUDGET] counter unavailable (${err.message}); sending without the global cap`);
    return { ok: true, day, failOpen: true };
  }
};

const refund = async (day) => {
  try {
    const M = model();
    if (!M || !day) return;
    const { Op, literal } = require('sequelize');
    await M.update({ count: literal('"count" - 1') }, { where: { day, count: { [Op.gt]: 0 } } });
  } catch (err) {
    console.warn('[SMS_BUDGET_REFUND_WARN]', err.message);
  }
};

// ── Early warning (bug hunt 6 Nov 2026, M3) ─────────────────────────────────────────────────────────
// One script with many numbers could drain the whole day's budget through a single (hostel NAT) IP while
// staying under the generous per-IP send-otp limit. Once today's use passes 50 % of the cap, the per-IP
// send-otp allowance tightens (routes/userRoutes otpBudgetIpLimiter: 100, then 20 above 80 % per 15 min),
// and the admins get one push per level per day (50 % and 80 %). Per-phone limits are unchanged.
//   usage()                    -> { day, cap, count, ratio } (cached 15 s; fails open to ratio 0)
//   sendOtpIpLimit(base, r)    -> the per-IP allowance for usage ratio r
//   warnIfNeeded({ io })       -> pushes the admins once per crossed level per IST day (never throws)
const WARN_LEVELS = [50, 80];
const USAGE_TTL_MS = 15 * 1000;
const posInt = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const warnIpMax = (env = process.env) => posInt(env.OTP_SEND_IP_MAX_WARN, 100);
const highIpMax = (env = process.env) => posInt(env.OTP_SEND_IP_MAX_HIGH, 20);

let usageCache = null;
const usage = async ({ env = process.env, now = Date.now(), fresh = false } = {}) => {
  const cap = dailyCap(env);
  const day = istDay(now);
  if (cap <= 0) return { day, cap, count: 0, ratio: 0, uncapped: true };
  if (!fresh && usageCache && usageCache.day === day && usageCache.cap === cap && now - usageCache.at < USAGE_TTL_MS) return usageCache;
  try {
    const M = model();
    if (!M) return { day, cap, count: 0, ratio: 0, failOpen: true };
    await ready(M);
    const row = await M.findByPk(day, { attributes: ['day', 'count'] });
    const count = row ? Number(row.count) || 0 : 0;
    usageCache = { day, cap, count, ratio: count / cap, at: now };
    return usageCache;
  } catch (err) {
    console.warn(`[SMS_BUDGET] usage unavailable (${err.message}); per-IP send-otp limit unchanged`);
    return { day, cap, count: 0, ratio: 0, failOpen: true };
  }
};

const sendOtpIpLimit = (base, ratio, env = process.env) => {
  if (ratio >= 0.8) return Math.min(base, highIpMax(env));
  if (ratio >= 0.5) return Math.min(base, warnIpMax(env));
  return base;
};

// One alert per level per IST day: claimed in this process first, then across processes through a unique
// IdempotencyKeys row (scope 'sms_budget_alert'; expired rows are cleaned up by the idempotency job).
const claimedLevels = new Set();
const claimLevel = async (day, level) => {
  const k = `${day}:${level}`;
  if (claimedLevels.has(k)) return false;
  claimedLevels.add(k);
  if (claimedLevels.size > 50) claimedLevels.delete(claimedLevels.values().next().value);
  try {
    const IK = require('../models/IdempotencyKey').getIdempotencyKeyModel();
    if (!IK) return true;
    await IK.create({
      scope: 'sms_budget_alert', userId: 'system', key: k, status: 'done',
      token: require('crypto').randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    return true;
  } catch (err) {
    if (isUniqueError(err)) return false; // another process alerted first
    console.warn('[SMS_BUDGET_WARN_CLAIM]', err.message);
    return true; // table unavailable: this process' claim stands
  }
};

const warnIfNeeded = async ({ io = null, env = process.env, now = Date.now() } = {}) => {
  try {
    const u = await usage({ env, now });
    if (u.uncapped || u.failOpen) return null;
    const crossed = WARN_LEVELS.filter((l) => u.ratio * 100 >= l);
    if (!crossed.length) return null;
    const top = crossed[crossed.length - 1];
    if (!(await claimLevel(u.day, top))) return null;
    for (const l of crossed) if (l !== top) claimedLevels.add(`${u.day}:${l}`); // a jump past 80 % sends one push
    const ipMax = sendOtpIpLimit(Infinity, u.ratio, env);
    console.error(`⚠️ [SMS_BUDGET] ${u.count} of ${u.cap} OTP SMS used today (${top}% level, ${u.day} IST): send-otp now allows ${ipMax} per IP per 15 min.`);
    await require('./adminAlert').pushAdmins(
      `⚠️ SMS budget ${top}% used`,
      `ZenWe has sent ${u.count} of today's ${u.cap} OTP SMS. To protect the rest, each network can now request ${ipMax} codes per 15 minutes (per-number limits unchanged). If this is not real traffic, check for an OTP flood; raise SMS_DAILY_CAP on Render if it is.`,
      { type: 'SMS_BUDGET_WARN', day: u.day, level: top, count: u.count, cap: u.cap },
      { io },
    );
    return top;
  } catch (err) {
    console.warn('[SMS_BUDGET_WARN_WARN]', err.message);
    return null;
  }
};
// After a successful reserve: checked in the background, never delays or fails the SMS.
function warnLater(io) {
  setImmediate(() => { warnIfNeeded({ io }).catch(() => {}); });
}

const _resetWarnings = () => { claimedLevels.clear(); usageCache = null; };

module.exports = { reserve, refund, dailyCap, istDay, DEFAULT_CAP, usage, sendOtpIpLimit, warnIfNeeded, WARN_LEVELS, _resetWarnings };
