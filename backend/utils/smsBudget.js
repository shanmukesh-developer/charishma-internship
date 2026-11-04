// C1-6: global daily SMS budget (circuit breaker against SMS-cost abuse), counted in the database
// (SmsDailyCounts, one row per IST day) so every server process shares it.
//   reserve()  -> { ok: true, day, count } | { ok: false, day, cap }  (one slot per SMS about to go out)
//   refund(day)   gives a slot back when the provider did not send
// Cap: env SMS_DAILY_CAP (default 2000; 0 or below = no cap). The first refusal of a day pushes the
// admins once (conditional alertedAt update: one process wins). Fails OPEN on a database error (a
// counter outage must not stop logins; the per-phone cooldown / daily cap still apply).
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
      `ZENV sent ${cap} OTP SMS today (the daily cap). New OTP SMS are paused until midnight IST; password login still works. Raise SMS_DAILY_CAP if this is real traffic.`,
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
    if (await tryIncrement(M, day, cap)) return { ok: true, day };
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

module.exports = { reserve, refund, dailyCap, istDay, DEFAULT_CAP };
