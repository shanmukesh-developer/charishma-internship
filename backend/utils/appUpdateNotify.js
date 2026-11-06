/**
 * "ZenWe update available" push (owner, 6 Nov 2026: users should update inside the app, not go to the Play Store).
 *
 * Admin-only (routes/appUpdateRoutes, mounted at /api/admin/app-update after protect + admin):
 *   GET  /notify?version=x.y.z    preview: the target version, how many customers are behind it, last send for it
 *   POST /notify { minVersion?, confirmResend? }
 *
 * Audience: customer accounts (not admins / deleted / deactivated) whose recorded app version
 * (Users.lastAppVersion, utils/appPresence) is older than the target version. The target is `minVersion` when
 * given (strict x.y.z), else Config > App versions "latest" for the customer app (utils/appVersionPolicy).
 * Accounts that never opened a tracked build (lastAppVersion null) are not targeted: their version is unknown.
 *
 * Push: title "ZenWe update available", body "Version X is ready. Open ZenWe to update in the app.",
 * data { type: 'APP_UPDATE', version }. Not in a mutable category (utils/pushCategories: an account notice).
 * The app opens Home on tap and asks Google Play right away, which shows the in-app update banner.
 *
 * Idempotent per version: the audit row (VerificationLog APP_UPDATE_PUSH_SENT, targetId "customer@<version>") is
 * the record; a second send for the same version is refused with 409 ALREADY_SENT unless confirmResend === true.
 * Concurrent sends for one version on this instance are serialised (in-process lock), so a double click sends once.
 */
const { Op } = require('sequelize');
const avp = require('./appVersionPolicy');

const ACTION = 'APP_UPDATE_PUSH_SENT';
const TITLE = 'ZenWe update available';
const bodyFor = (version) => `Version ${version} is ready. Open ZenWe to update in the app.`;
const targetIdFor = (version) => `customer@${version}`;

const User = () => require('../models/User').getUserModel();
const Audit = () => require('../models/VerificationLog').getVerificationLogModel();

const CUSTOMER = Object.freeze({
  [Op.and]: [
    { [Op.or]: [{ role: null }, { role: { [Op.notIn]: ['admin', 'deleted', 'restaurant', 'rider'] } }] },
    { [Op.or]: [{ isActive: null }, { isActive: { [Op.ne]: false } }] },
    { lastAppVersion: { [Op.ne]: null } },
  ],
});

class NotifyError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** The version to compare against: the given one (strict x.y.z) or Config > App versions latest. */
const resolveTargetVersion = async (given) => {
  if (given !== undefined && given !== null && given !== '') {
    const v = typeof given === 'string' ? given.trim() : given;
    if (!avp.isStrictSemver(v)) throw new NotifyError(400, 'INVALID_VERSION', 'Give the version as x.y.z, for example 1.0.68.');
    return { version: v, source: 'given' };
  }
  const policy = await avp.getPolicy({ fresh: true });
  const v = policy && policy.apps && policy.apps.customer && policy.apps.customer.latestVersion;
  if (!v || !avp.parseVersion(v)) {
    throw new NotifyError(400, 'NO_LATEST_VERSION', 'Set the latest customer version first (Config > App versions), or give a version.');
  }
  return { version: String(v), source: 'policy' };
};

/** Customers on an older recorded version than `version`. */
const usersBehind = async (version) => {
  const rows = await User().findAll({ where: CUSTOMER, attributes: ['id', 'lastAppVersion', 'fcmTokens'] });
  return rows.filter((u) => (avp.compareVersions(u.lastAppVersion, version) ?? 0) < 0);
};

const tokensOf = (u) => {
  const list = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
  return list.map((t) => (typeof t === 'string' ? t : t && t.token)).filter((t) => typeof t === 'string' && t);
};

const parseDetails = (row) => {
  try { return JSON.parse(row.details || '{}') || {}; } catch { return {}; }
};

/** The last send for this version, or null. */
const lastSendFor = async (version) => {
  const row = await Audit().findOne({ where: { action: ACTION, targetId: targetIdFor(version) }, order: [['timestamp', 'DESC']] });
  if (!row) return null;
  const d = parseDetails(row);
  return {
    sentAt: row.timestamp,
    adminId: row.adminId || null,
    targeted: typeof d.targeted === 'number' ? d.targeted : null,
    sent: typeof d.sent === 'number' ? d.sent : null,
  };
};

/** Preview for the admin card. */
const preview = async ({ version: given } = {}) => {
  const { version, source } = await resolveTargetVersion(given);
  const behind = await usersBehind(version);
  const withDevice = behind.filter((u) => tokensOf(u).length > 0).length;
  const byVersion = {};
  for (const u of behind) byVersion[u.lastAppVersion] = (byVersion[u.lastAppVersion] || 0) + 1;
  const versions = Object.entries(byVersion)
    .map(([v, count]) => ({ version: v, count }))
    .sort((a, b) => avp.compareVersions(b.version, a.version) ?? 0);
  return { version, versionSource: source, behind: behind.length, withDevice, versions, lastSent: await lastSendFor(version), title: TITLE, body: bodyFor(version) };
};

const inFlight = new Map();

const notify = async ({ minVersion, confirmResend = false, adminId = 'admin_default' } = {}) => {
  const { version, source } = await resolveTargetVersion(minVersion);
  if (inFlight.has(version)) throw new NotifyError(409, 'SEND_IN_PROGRESS', `A notification for version ${version} is being sent right now.`);
  const job = (async () => {
    const last = await lastSendFor(version);
    if (last && confirmResend !== true) {
      throw new NotifyError(409, 'ALREADY_SENT', `Users were already notified about version ${version}. Confirm to send it again.`, { lastSent: last, version });
    }
    const behind = await usersBehind(version);
    const recipients = behind.filter((u) => tokensOf(u).length > 0);
    const tokens = [...new Set(recipients.flatMap(tokensOf))];
    let sent = 0;
    let failed = 0;
    if (tokens.length) {
      const r = await require('./push').sendPushToTokens(
        tokens, TITLE, bodyFor(version),
        { type: 'APP_UPDATE', version },
        { recipients: recipients.map((u) => u.id) },
      );
      if (r && typeof r === 'object') {
        sent = Number(r.successCount) || 0;
        failed = Number(r.failureCount) || 0;
      }
    }
    const result = {
      version,
      versionSource: source,
      targeted: behind.length,
      withDevice: recipients.length,
      devices: tokens.length,
      sent,
      failed,
      resend: !!last,
    };
    // The audit row is also the idempotency record, so it is written even when nobody had a device.
    await Audit().create({
      adminId: String(adminId || 'admin_default'),
      targetId: targetIdFor(version),
      action: ACTION,
      details: JSON.stringify(result).slice(0, 8000),
    });
    return result;
  })();
  inFlight.set(version, job);
  try {
    return await job;
  } finally {
    inFlight.delete(version);
  }
};

module.exports = { ACTION, TITLE, bodyFor, targetIdFor, NotifyError, resolveTargetVersion, usersBehind, preview, notify, lastSendFor };
