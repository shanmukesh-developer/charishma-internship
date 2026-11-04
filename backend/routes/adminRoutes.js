const express = require('express');
const router = express.Router();
const { 
  getAllRestaurants, 
  createRestaurant, 
  updateRestaurant, 
  getAllMenuItems,
  upsertMenuItem,
  deleteMenuItem,
  deleteRestaurant,
  getAllRiders,
  approveRider,
  getAllUsers,
  setEliteStatus,
  updateGlobalConfig,
  getGlobalConfig,
  getVaultItems,
  upsertVaultItem,
  deleteVaultItem,
  seedDatabase,
  getDashboardStats,
  getFinanceReport,
  getAuditLogs,
  getRewardsAnalytics,
  getSystemHealth,
  getOrderVolumeStats,
  batchUpdateOrders,
  getAllCoupons,
  createCoupon,
  deleteCoupon,
  broadcastPushNotification,
  updateRider,
  resetRiderSos,
  updateUserWallet,
  getRestaurantPayouts,
  settleRestaurantPayout,
  settleRiderPayout,
  getDisputedOrders,
  processManualRefund,
  toggleUserBan,
  getRecentReviews,
  deleteReview,
  getRiderPayouts,
  getRestaurantStats,
  bulkCreateMenuItems,
  bulkUpdateMenuItems,
  bulkUpdateRestaurants,
  duplicateRestaurant,
  createRider,
  getAttentionCounts
} = require('../controllers/adminController');
const { getAllOrders } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware');

// ─── Protected Admin Routes ──────────────────────────────────
router.use(protect);

// S1: admin 2-step sign-in endpoints + the session check also accept an admin session that still has to
// set up 2FA (ADMIN_2FA_REQUIRED): such a session has no admin powers anywhere else.
const twoFactor = require('../services/adminTwoFactor');
router.use('/2fa', twoFactor.requireAdminAccount, twoFactor.router());

// The signed-in admin's own password is still one the old seed scripts published (C1-1 follow-up, 1 Nov 2026):
// scripts/admin_seed_reset only warns in the server log while ADMIN_RESET_PASSWORD is unset, which the owner never
// sees, so /me tells the dashboard (a red banner). bcrypt is slow: one answer per account and password version
// (a password change bumps tokenVersion). Never throws; false when unsure.
const weakPasswordCache = new Map();
const hasSeedPassword = async (id) => {
  try {
    const { getUserModel } = require('../models/User');
    const row = await getUserModel().findByPk(id, { attributes: ['id', 'password', 'tokenVersion'] });
    if (!row) return false;
    const key = `${row.id}:${Number(row.tokenVersion) || 0}`;
    if (weakPasswordCache.has(key)) return weakPasswordCache.get(key);
    const weak = await require('../scripts/admin_seed_reset').usesSeedPassword(row);
    if (weakPasswordCache.size > 500) weakPasswordCache.clear();
    weakPasswordCache.set(key, weak);
    return weak;
  } catch {
    return false;
  }
};

// Admin session check for the dashboard: 200 only for a valid admin token
// (protect -> 401 without/with a bad token, 403 for non-admins).
router.get('/me', twoFactor.requireAdminAccount, async (req, res) => {
  const { id, name, phone, email } = req.user;
  res.set('Cache-Control', 'no-store');
  const pending = !!req.user.adminMfaPending;
  const enabled = await twoFactor.isEnabled(id);
  // 2FA is on but this session never passed the code: sign in again (with the code).
  if (pending && enabled) return res.status(401).json({ code: 'MFA_REQUIRED', message: 'Sign in again with your 2-step code.' });
  res.json({ id, name: name || 'Admin', phone: phone || null, email: email || null, role: 'admin', mfaSetupRequired: pending, twoFactorEnabled: enabled, twoFactorRequired: twoFactor.required(), weakPassword: await hasSeedPassword(id) });
});

router.use(admin);

// Mailer check: sends one demo email through Brevo so the admin can confirm BREVO_API_KEY/MAIL_FROM work.
router.post('/mail/test', async (req, res) => {
  const { sendMail, isMailerConfigured } = require('../utils/mailer');
  if (!isMailerConfigured()) return res.status(503).json({ ok: false, reason: 'not_configured' });
  const to = String(req.body?.to || '').trim();
  const result = await sendMail({
    to,
    subject: 'ZENV test email',
    text: 'This is a test email from ZENV. If you can read this, email delivery (Brevo) is working.',
    html: '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:22px"><h2 style="margin:0 0 12px">ZENV test email</h2><p>If you can read this, email delivery (Brevo) is working. College verification codes will arrive the same way.</p></div>',
  });
  res.status(result.ok ? 200 : 502).json(result);
});

// Admin Broadcast Push
router.post('/broadcast-push', broadcastPushNotification);
// Recipients preview (nothing is sent) and the history of past broadcasts (from the audit log).
router.get('/broadcast-push/preview', require('../controllers/adminController').previewBroadcastAudience);
router.get('/broadcast-push/history', require('../controllers/adminController').getBroadcastHistory);

// Live Orders Intelligence
router.get('/orders', getAllOrders);
router.get('/stats', getDashboardStats);
router.get('/attention-counts', getAttentionCounts);
router.get('/stats/volume', getOrderVolumeStats);
router.put('/orders/batch-update', batchUpdateOrders);
// Support: give an order to a rider / take it back (before pickup). { riderId: uuid | null }
router.put('/orders/:id/rider', require('../controllers/adminController').assignOrderRider);

// Restaurant & Menu Control
router.get('/restaurants', getAllRestaurants);
// Static paths first: they must not be captured by POST /restaurants/:id or /menu-items/:id.
router.get('/restaurants/stats', getRestaurantStats);
router.post('/restaurants/bulk-update', bulkUpdateRestaurants);
router.post('/restaurants/:id/duplicate', duplicateRestaurant);
router.post('/menu-items/bulk', bulkCreateMenuItems);
router.post('/menu-items/bulk-update', bulkUpdateMenuItems);
router.post('/restaurants', createRestaurant);
router.post('/restaurants/:id', updateRestaurant);
router.get('/menu-items', getAllMenuItems);
router.post('/menu-items/:id', upsertMenuItem); // id can be 'new'
router.delete('/menu-items/:id/delete', deleteMenuItem);
router.delete('/restaurants/:id', deleteRestaurant);

// Fleet Management
router.get('/riders', getAllRiders);
router.post('/riders', createRider);
router.put('/riders/:id/approve', approveRider);
router.route('/riders/:id')
  .post(updateRider)
  .put(updateRider);
router.post('/riders/:id/reset-sos', resetRiderSos);
router.get('/fleet/payouts', getRiderPayouts);

// User Management
router.get('/users', getAllUsers);
router.put('/users/:userId/elite', setEliteStatus);
router.post('/users/:userId/wallet', updateUserWallet);
// C5 wallet ledger: per-owner history (user | rider) and the read-only reconciliation check.
{
  const ac = require('../controllers/adminController');
  router.get('/wallet/reconcile', ac.getWalletReconcile);
  router.get('/wallet/:ownerType/:ownerId/transactions', ac.getWalletTransactions);
}
router.put('/users/:userId/ban', toggleUserBan);

// Coupon Management
router.get('/coupons', getAllCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:id', deleteCoupon);

// Global Configuration
// Colleges served (utils/campuses): open / paused / soon per college, and how many stores serve each.
router.get('/campuses', require('../controllers/adminController').getCampuses);
router.put('/campuses/:key', require('../controllers/adminController').setCampusStatus);
router.get('/config', getGlobalConfig);
router.post('/config', updateGlobalConfig);
// C3 force-update: per-app minimum / latest versions (validated, audited). The generic POST /config
// above refuses this key so it can only be written through these validated endpoints.
{
  const appVersions = require('../controllers/appVersionController');
  router.get('/app-versions', appVersions.getAdminAppVersions);
  router.put('/app-versions', appVersions.updateAdminAppVersions);
}
// C4 legal: business + grievance officer details and policy version for the /legal pages (validated, audited).
{
  const legalCtl = require('../controllers/legalController');
  router.get('/legal-settings', legalCtl.getAdminLegalSettings);
  router.put('/legal-settings', legalCtl.updateAdminLegalSettings);
}
// C8: receipt tax display / platform GSTIN / hide stores without FSSAI (validated, audited); store compliance
// (legal name, FSSAI, GSTIN, PAN, payout) edits and FSSAI verification (audited).
{
  const receiptCtl = require('../controllers/receiptController');
  router.get('/receipt-settings', receiptCtl.getAdminReceiptSettings);
  router.put('/receipt-settings', receiptCtl.updateAdminReceiptSettings);
  const complianceCtl = require('../controllers/complianceController');
  router.get('/restaurants/:id/compliance', complianceCtl.getStoreCompliance);
  router.put('/restaurants/:id/compliance', complianceCtl.adminUpdateCompliance);
  router.post('/restaurants/:id/fssai-verification', complianceCtl.adminVerifyFssai);
}

// Zenvy Vault Control
router.get('/vault', getVaultItems);
router.post('/vault/:id', upsertVaultItem); // id can be 'new'
router.delete('/vault/:id', deleteVaultItem);

// Database Seeding Engine
router.post('/seed', seedDatabase);

// Finance & Payouts
router.get('/finance', getFinanceReport);
router.get('/finance/payouts', getRestaurantPayouts);
router.post('/finance/settle-restaurant', settleRestaurantPayout);
router.post('/finance/settle-rider', settleRiderPayout);
router.get('/finance/disputes', getDisputedOrders);
// C6: rider cash ledger + payout statements (controllers/financeController).
{
  const fc = require('../controllers/financeController');
  router.get('/rider-cash', fc.getRiderCashHoldings);
  router.get('/rider-cash/reconcile', fc.getRiderCashReconcile);
  router.post('/rider-cash/orders/:orderId/record', fc.recordMissingCodRow);
  router.get('/rider-cash/:riderId/entries', fc.getRiderCashEntries);
  router.post('/rider-cash/:riderId/deposit', fc.recordRiderDeposit);
  router.post('/rider-cash/:riderId/adjust', fc.adjustRiderCash);
  router.get('/payouts/pending', fc.getPendingPayouts);
  router.get('/payouts/preview', fc.previewPayout);
  router.get('/payouts', fc.listPayouts);
  router.post('/payouts', fc.createPayout);
  router.get('/payouts/:id', fc.getPayout);
  router.post('/payouts/:id/mark-paid', fc.markPayoutPaid);
  router.post('/payouts/:id/cancel', fc.cancelPayout);
}
router.post('/finance/refund/:orderId', processManualRefund);

// Reviews & Analytics
router.get('/reviews', getRecentReviews);
router.delete('/reviews/:orderId', deleteReview);
router.get('/audit', getAuditLogs);
router.get('/rewards-analytics', getRewardsAnalytics);
router.get('/health', getSystemHealth);
// P1: server-side performance metrics (utils/perfMetrics.js). ?reset=1 clears the per-route figures.
router.get('/metrics/perf', async (req, res) => {
  const perf = require('../utils/perfMetrics');
  // B1: fresh Redis round-trip time (no-op without REDIS_URL; bounded by the command timeout).
  try { await require('../utils/redis').ping(); } catch { /* reported as not ready */ }
  const snap = perf.snapshot();
  // Infra switch-over checks (docs/INFRA_SWITCHOVER.md): DB host kind + a fresh measured round trip,
  // media storage driver, public URL settings. No URLs with credentials, no keys.
  snap.infra = await perf.infraSnapshot();
  // C5: last wallet reconciliation (owners checked, mismatches, alerts sent).
  try { snap.wallet = require('../utils/walletLedger').reconcileStatus(); } catch { /* optional */ }
  // C6: last rider cash reconciliation (riders / COD orders checked, problems, alerts sent).
  try { snap.riderCash = require('../utils/riderCash').reconcileStatus(); } catch { /* optional */ }
  // S1: App Check counters (mode, valid / invalid / missing / unavailable / blocked per group).
  try { snap.appCheck = require('../utils/appCheck').stats(); } catch { /* optional */ }
  if (String(req.query.reset || '') === '1') perf.resetRoutes();
  res.set('Cache-Control', 'no-store');
  res.json(snap);
});

module.exports = router;
