// C3 force-update: public per-app policy + admin read/write (utils/appVersionPolicy.js).
const avp = require('../utils/appVersionPolicy');
const { getGlobalConfigModel } = require('../models/GlobalConfig');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { sendServerError } = require('../utils/httpErrors');

// @route GET /api/config/app-version?app=customer   (public, no auth, tiny, cached)
exports.getPublicAppVersion = async (req, res) => {
  try {
    const app = avp.normalizeApp(String((req.query && req.query.app) || ''));
    if (!app) return res.status(400).json({ success: false, code: 'UNKNOWN_APP', message: `Pass ?app= one of: ${avp.APPS.join(', ')}.` });
    const policy = await avp.getPolicy();
    const body = { success: true, ...avp.publicAppPolicy(policy, app) };
    // CLOSED-TEST ONLY (utils/usageTime): the customer app sends usage heartbeats only while this is true.
    if (app === 'customer') body.usageTracking = await require('../utils/usageTime').isEnabled();
    res.json(body);
  } catch (error) {
    sendServerError(res, error, '[APP_VERSION_PUBLIC_ERROR]');
  }
};

const adminShape = (policy, row) => ({
  success: true,
  policy,
  apps: avp.APPS,
  packages: avp.PACKAGES,
  labels: avp.APP_LABELS,
  defaultMessage: avp.DEFAULT_MESSAGE,
  updatedAt: row && row.updatedAt ? row.updatedAt : null,
});

// @route GET /api/admin/app-versions   (admin)
exports.getAdminAppVersions = async (req, res) => {
  try {
    const { policy, row } = await avp.readFromDb();
    res.set('Cache-Control', 'no-store');
    res.json(adminShape(policy, row));
  } catch (error) {
    sendServerError(res, error, '[APP_VERSION_ADMIN_GET_ERROR]');
  }
};

const sameTime = (a, b) => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
};

// Only what changed, for the audit row.
const diff = (before, after) => {
  const changes = {};
  if (before.blockUnversionedClients !== after.blockUnversionedClients) changes.blockUnversionedClients = [before.blockUnversionedClients, after.blockUnversionedClients];
  for (const app of avp.APPS) {
    for (const [k, v] of Object.entries(after.apps[app])) {
      const old = before.apps[app][k];
      if (old !== v) changes[`${app}.${k}`] = [old, v];
    }
  }
  return changes;
};

// @route PUT /api/admin/app-versions   (admin)
// body: { apps?: { customer?: { minSupportedVersion?, latestVersion?, minSupportedBuild?, storeUrl?, message?, softPromptEnabled? }, … },
//         blockUnversionedClients?, ifUpdatedAt? }   Partial: only the fields sent change.
exports.updateAdminAppVersions = async (req, res) => {
  try {
    const GlobalConfig = getGlobalConfigModel();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { policy: before, row } = await avp.readFromDb();
    if (typeof body.ifUpdatedAt === 'string' && body.ifUpdatedAt && row && row.updatedAt && !sameTime(row.updatedAt, body.ifUpdatedAt)) {
      return res.status(409).json({ success: false, code: 'CONFIG_CONFLICT', message: 'Someone else changed the app versions since you loaded them. Reload and make your change again.', ...adminShape(before, row) });
    }
    const { policy, error } = avp.validateUpdate(before, body);
    if (error) return res.status(400).json({ success: false, code: 'INVALID_APP_VERSION_POLICY', message: error });
    const changes = diff(before, policy);
    if (!Object.keys(changes).length) return res.json({ ...adminShape(before, row), changed: false });

    await GlobalConfig.upsert({ key: avp.POLICY_KEY, value: policy, description: 'Per-app minimum / latest versions (force update). Edit on Config → App versions.' });
    avp.clearCache();
    try {
      await getVerificationLogModel().create({
        adminId: req.user && req.user.id ? String(req.user.id) : 'admin_default',
        targetId: 'app_versions',
        action: 'APP_VERSION_POLICY_UPDATED',
        details: JSON.stringify({ changes }).slice(0, 8000),
      });
    } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
    try { require('../utils/realtime').publish('config', 'updated', 'app_versions', { scope: 'app_versions' }); } catch { /* best effort */ }

    const fresh = await avp.readFromDb();
    res.json({ ...adminShape(fresh.policy, fresh.row), changed: true, changes });
  } catch (error) {
    sendServerError(res, error, '[APP_VERSION_ADMIN_PUT_ERROR]');
  }
};
