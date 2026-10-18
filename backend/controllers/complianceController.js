// C8 seller compliance (utils/storeCompliance): the store owner's own view / submission (restaurant and
// vendor apps) and the admin edit + FSSAI verification. Every write is audited in VerificationLogs.
const comp = require('../utils/storeCompliance');
const { getRestaurantModel } = require('../models/Restaurant');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { sendServerError } = require('../utils/httpErrors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const audit = async (actorId, storeId, action, details) => {
  try {
    await getVerificationLogModel().create({
      adminId: String(actorId || 'unknown'),
      targetId: String(storeId),
      action,
      details: JSON.stringify(details).slice(0, 8000),
    });
  } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
};

const afterStoreChange = (req, store) => {
  try { require('./adminController').clearRestaurantsCache(); } catch { /* listings expire on their own */ }
  try { require('../utils/realtime').publish('store', 'updated', store.id, { storeId: store.id, scope: 'compliance' }); } catch { /* best effort */ }
};

const sendInputError = (res, error) => res.status(400).json({ success: false, code: error.code, field: error.field, message: error.message });

const isOwnerOrAdmin = (req) => {
  const role = String((req.user && req.user.role) || '').toLowerCase();
  return role === 'admin' || (role === 'restaurant' && String(req.user.id) === String(req.params.id));
};

const shape = (store) => ({
  success: true,
  storeId: store.id,
  storeName: store.name,
  compliance: comp.privateView(store),
  ownerEditable: comp.OWNER_FIELDS,
  fssaiTypes: comp.FSSAI_TYPES,
});

// @route GET /api/restaurants/:id/compliance   (the store itself or an admin)
exports.getStoreCompliance = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(404).json({ message: 'Store not found' });
    if (!isOwnerOrAdmin(req)) return res.status(403).json({ message: 'Not authorized for this store' });
    const store = await getRestaurantModel().findByPk(req.params.id);
    if (!store) return res.status(404).json({ message: 'Store not found' });
    res.set('Cache-Control', 'no-store');
    res.json(shape(store));
  } catch (error) {
    sendServerError(res, error, '[STORE_COMPLIANCE_GET_ERROR]');
  }
};

// @route PUT /api/restaurants/:id/compliance   (store owner: legal name, FSSAI, GSTIN; admin: everything)
exports.updateStoreCompliance = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(404).json({ message: 'Store not found' });
    if (!isOwnerOrAdmin(req)) return res.status(403).json({ message: 'Not authorized for this store' });
    const isAdmin = String(req.user.role || '').toLowerCase() === 'admin';
    const store = await getRestaurantModel().findByPk(req.params.id);
    if (!store) return res.status(404).json({ message: 'Store not found' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const unknown = Object.keys(body).filter((k) => !comp.INPUT_FIELDS.includes(k));
    if (unknown.length) return res.status(400).json({ success: false, code: 'INVALID_COMPLIANCE', field: unknown[0], message: `Unknown field: ${unknown[0]}.` });
    let result;
    try {
      result = comp.validateCompliance(body, store, { actor: isAdmin ? 'admin' : 'store' });
    } catch (e) {
      if (e instanceof comp.ComplianceInputError) {
        return e.code === 'ADMIN_ONLY_FIELD' ? res.status(403).json({ success: false, code: e.code, field: e.field, message: e.message }) : sendInputError(res, e);
      }
      throw e;
    }
    const { patch, changes } = result;
    if (!Object.keys(patch).length) return res.json({ ...shape(store), changed: false });
    await store.update(patch);
    await audit(isAdmin ? req.user.id : `store:${store.id}`, store.id, isAdmin ? 'STORE_COMPLIANCE_UPDATED' : 'STORE_COMPLIANCE_SUBMITTED', { name: store.name, changes });
    afterStoreChange(req, store);
    res.json({ ...shape(store), changed: true });
  } catch (error) {
    sendServerError(res, error, '[STORE_COMPLIANCE_PUT_ERROR]');
  }
};

// @route PUT /api/admin/restaurants/:id/compliance   (admin; same rules as the owner route, every field)
exports.adminUpdateCompliance = (req, res) => exports.updateStoreCompliance(req, res);

// @route POST /api/admin/restaurants/:id/fssai-verification  { verified: boolean }   (admin, audited)
// verified:true needs a 14-digit number that has not expired; the check is recorded as fssaiVerifiedAt / By.
exports.adminVerifyFssai = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(404).json({ message: 'Store not found' });
    const verified = (req.body || {}).verified;
    if (typeof verified !== 'boolean') return res.status(400).json({ code: 'INVALID_COMPLIANCE', message: 'Send verified: true or false.' });
    const store = await getRestaurantModel().findByPk(req.params.id);
    if (!store) return res.status(404).json({ message: 'Store not found' });
    const st = comp.fssaiStatus(store);
    if (verified) {
      if (st.status === 'MISSING') return res.status(400).json({ code: 'FSSAI_MISSING', message: 'This store has no FSSAI licence number to verify.' });
      if (st.status === 'EXPIRED') return res.status(400).json({ code: 'FSSAI_EXPIRED', message: 'This FSSAI licence has expired. Ask the store for the renewed licence.' });
      if (st.status === 'VERIFIED') return res.json({ ...shape(store), changed: false });
      await store.update({ fssaiVerifiedAt: new Date(), fssaiVerifiedBy: String(req.user.id) });
    } else {
      if (!store.fssaiVerifiedAt && !store.fssaiVerifiedBy) return res.json({ ...shape(store), changed: false });
      await store.update({ fssaiVerifiedAt: null, fssaiVerifiedBy: null });
    }
    await audit(req.user.id, store.id, verified ? 'FSSAI_VERIFIED' : 'FSSAI_VERIFICATION_REVOKED', { name: store.name, fssaiLicenseNumber: store.fssaiLicenseNumber, fssaiExpiry: comp.ymdOf(store.fssaiExpiry) });
    afterStoreChange(req, store);
    res.json({ ...shape(store), changed: true });
  } catch (error) {
    sendServerError(res, error, '[FSSAI_VERIFY_ERROR]');
  }
};
