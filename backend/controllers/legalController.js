// C4 legal / compliance: admin settings (Config → Legal), the public policy info the apps read, and
// recording a signed-in customer's acceptance of the current Terms.
const legal = require('../utils/legalSettings');
const { getGlobalConfigModel } = require('../models/GlobalConfig');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { sendServerError } = require('../utils/httpErrors');

const adminShape = (req, settings, row) => ({
  success: true,
  settings,
  defaults: legal.defaults(),
  grievanceComplete: legal.grievanceComplete(settings),
  missing: legal.missingFields(settings),
  pages: legal.pageUrls(req),
  updatedAt: row && row.updatedAt ? row.updatedAt : null,
});

const sameTime = (a, b) => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
};

// @route GET /api/admin/legal-settings   (admin)
exports.getAdminLegalSettings = async (req, res) => {
  try {
    const { settings, row } = await legal.readFromDb();
    res.set('Cache-Control', 'no-store');
    res.json(adminShape(req, settings, row));
  } catch (error) {
    sendServerError(res, error, '[LEGAL_SETTINGS_ADMIN_GET_ERROR]');
  }
};

// @route PUT /api/admin/legal-settings   (admin)  Partial: only the fields sent change.
exports.updateAdminLegalSettings = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { settings: before, row } = await legal.readFromDb();
    if (typeof body.ifUpdatedAt === 'string' && body.ifUpdatedAt && row && row.updatedAt && !sameTime(row.updatedAt, body.ifUpdatedAt)) {
      return res.status(409).json({ success: false, code: 'CONFIG_CONFLICT', message: 'Someone else changed the legal settings since you loaded them. Reload and make your change again.', ...adminShape(req, before, row) });
    }
    const { settings, error } = legal.validateUpdate(before, body);
    if (error) return res.status(400).json({ success: false, code: 'INVALID_LEGAL_SETTINGS', message: error });
    const changes = legal.diff(before, settings);
    if (!Object.keys(changes).length) return res.json({ ...adminShape(req, before, row), changed: false });

    await getGlobalConfigModel().upsert({ key: legal.KEY, value: settings, description: 'Business + grievance officer details and policy version shown on /legal pages. Edit on Config → Legal.' });
    legal.clearCache();
    try {
      await getVerificationLogModel().create({
        adminId: req.user && req.user.id ? String(req.user.id) : 'admin_default',
        targetId: 'legal_settings',
        action: 'LEGAL_SETTINGS_UPDATED',
        details: JSON.stringify({ changes }).slice(0, 8000),
      });
    } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
    try { require('../utils/realtime').publish('config', 'updated', 'legal_settings', { scope: 'legal_settings' }); } catch { /* best effort */ }

    const fresh = await legal.readFromDb();
    res.json({ ...adminShape(req, fresh.settings, fresh.row), changed: true, changes });
  } catch (error) {
    sendServerError(res, error, '[LEGAL_SETTINGS_ADMIN_PUT_ERROR]');
  }
};

// @route GET /api/config/legal   (public, no auth) — what the apps show next to "By continuing you agree…"
exports.getPublicLegal = async (req, res) => {
  try {
    const s = await legal.getSettings();
    res.json({
      success: true,
      businessName: s.businessName,
      policyVersion: s.policyVersion,
      effectiveDate: s.effectiveDate,
      contactEmail: s.contactEmail,
      urls: legal.pageUrls(req),
    });
  } catch (error) {
    sendServerError(res, error, '[LEGAL_PUBLIC_ERROR]');
  }
};

// @route GET /api/users/legal/status   (protect)
exports.getMyLegalStatus = async (req, res) => {
  try {
    const { getUserModel } = require('../models/User');
    const user = await getUserModel().findByPk(req.user.id, { attributes: ['id', 'termsAcceptedVersion', 'termsAcceptedAt'] });
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });
    const s = await legal.getSettings();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...legal.acceptanceStatus(user, s), urls: legal.pageUrls(req) });
  } catch (error) {
    sendServerError(res, error, '[LEGAL_STATUS_ERROR]');
  }
};

// @route POST /api/users/legal/accept { version }   (protect)
// Records acceptance of the CURRENT version only, so a stale prompt can never record an old one as current.
exports.acceptTerms = async (req, res) => {
  try {
    const s = await legal.getSettings({ fresh: true });
    const sent = req.body && typeof req.body.version === 'string' ? req.body.version.trim() : '';
    if (sent && sent !== s.policyVersion) {
      return res.status(409).json({ success: false, code: 'TERMS_VERSION_CHANGED', message: 'The Terms were updated again. Please review the latest version.', termsCurrentVersion: s.policyVersion });
    }
    const { getUserModel } = require('../models/User');
    const user = await getUserModel().findByPk(req.user.id);
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });
    if (user.termsAcceptedVersion !== s.policyVersion) {
      await user.update({ termsAcceptedVersion: s.policyVersion, termsAcceptedAt: new Date() });
    }
    res.json({ success: true, ...legal.acceptanceStatus(user, s) });
  } catch (error) {
    sendServerError(res, error, '[LEGAL_ACCEPT_ERROR]');
  }
};
