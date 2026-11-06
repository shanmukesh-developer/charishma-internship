/**
 * Active testers (owner, 6 Nov 2026: "know whether each Play closed tester has installed and is using the app").
 *
 * Every signed-in request from the CUSTOMER app (X-App-Name: customer, utils/appVersionPolicy) records on the User row:
 *   lastSeenAt, lastAppVersion, lastAppBuild, lastPlatform, and firstSeenAt (set once, the first time).
 *
 * Cheap and safe by design:
 *   - at most one write per user per 10 minutes (in-memory map on each instance, plus a conditional UPDATE
 *     "WHERE lastSeenAt IS NULL OR lastSeenAt < now - 10 min" so several instances still write about once);
 *     a new app version in that window is written at once (so the version breakdown is right after an update);
 *   - fire-and-forget: never awaited by the request, never throws, a failed write is only logged;
 *   - only the customer app (partner apps, the web admin and web builds send another or no X-App-Name);
 *   - never for load-test traffic (utils/loadtestBypass);
 *   - silent: the row's updatedAt is not touched and no model hooks run.
 * Called from middleware/authMiddleware protect() once req.user is a User-table account.
 * The columns are admin-only: utils/publicFields + userController sanitizeUser are allow-lists that leave them out.
 */
const { Op } = require('sequelize');

const THROTTLE_MS = 10 * 60 * 1000;
const MAP_MAX = 20000;
const CUSTOMER_APP = 'customer';

// userId -> { at: ms of the last write (or attempt), version }
const recent = new Map();

const clean = (v, re, max) => {
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s && re.test(s) ? s : null;
};
const versionOf = (h) => clean(h['x-app-version'], /^[0-9A-Za-z.+_-]+$/, 32);
const buildOf = (h) => clean(h['x-app-build'], /^\d+$/, 16);
const platformOf = (h) => {
  const p = clean(h['x-app-platform'] || h['x-platform'], /^[A-Za-z0-9_-]+$/, 16);
  return p ? p.toLowerCase() : 'android';
};

/** True when this request comes from the customer app (any accepted alias). */
const isCustomerApp = (req) => {
  const raw = req && req.headers ? req.headers['x-app-name'] : null;
  const name = Array.isArray(raw) ? raw[0] : raw;
  if (typeof name !== 'string' || !name) return false;
  return require('./appVersionPolicy').normalizeApp(name) === CUSTOMER_APP;
};

const remember = (id, entry) => {
  if (recent.size >= MAP_MAX && !recent.has(id)) recent.delete(recent.keys().next().value);
  recent.set(id, entry);
};

/** The conditional write. Resolves to the number of rows updated (0 or 1); rejects on a database error. */
const write = async (userId, { version, build, platform, now = new Date() }) => {
  const User = require('../models/User').getUserModel();
  if (!User || !User.rawAttributes.lastSeenAt) return 0;
  const cutoff = new Date(now.getTime() - THROTTLE_MS);
  const sequelize = User.sequelize;
  const due = [{ lastSeenAt: null }, { lastSeenAt: { [Op.lt]: cutoff } }];
  // A different app version is written at once (the version breakdown is right just after an update).
  if (version) due.push({ lastAppVersion: null }, { lastAppVersion: { [Op.ne]: version } });
  const [n] = await User.update({
    lastSeenAt: now,
    firstSeenAt: sequelize.fn('COALESCE', sequelize.col('firstSeenAt'), now),
    lastAppVersion: version,
    lastAppBuild: build,
    lastPlatform: platform,
  }, { where: { id: userId, [Op.or]: due }, silent: true, hooks: false, logging: false });
  return n;
};

/**
 * Records a "seen" for this request when it qualifies. Synchronous, returns at once; the write runs in the background.
 * Returns the background promise (resolves to rows written, never rejects) for tests, or null when skipped.
 */
const noteSeen = (req) => {
  try {
    const user = req && req.user;
    if (!user || !user.id) return null;
    const role = String(user.role || '').toLowerCase();
    if (role === 'restaurant' || role === 'rider' || role === 'deleted') return null;
    if (!isCustomerApp(req)) return null;
    if (require('./loadtestBypass').isLoadtestRequest(req)) return null;
    const h = req.headers;
    const version = versionOf(h);
    const build = buildOf(h);
    const id = String(user.id);
    const nowMs = Date.now();
    const last = recent.get(id);
    const versionChanged = !!(last && version && last.version !== version);
    if (last && nowMs - last.at < THROTTLE_MS && !versionChanged) return null;
    remember(id, { at: nowMs, version });
    const platform = platformOf(h);
    return write(id, { version, build, platform, now: new Date(nowMs) })
      .catch((err) => {
        console.warn('[APP_PRESENCE_WARN]', err && err.message);
        return 0;
      });
  } catch (err) {
    console.warn('[APP_PRESENCE_WARN]', err && err.message);
    return null;
  }
};

const _reset = () => recent.clear();

module.exports = { noteSeen, write, isCustomerApp, THROTTLE_MS, CUSTOMER_APP, _reset };
