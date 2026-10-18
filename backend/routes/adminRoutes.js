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
router.use(admin);

// Admin session check for the dashboard: 200 only for a valid admin token
// (protect -> 401 without/with a bad token, admin -> 403 for non-admins).
router.get('/me', (req, res) => {
  const { id, name, phone, email, role } = req.user;
  res.set('Cache-Control', 'no-store');
  res.json({ id, name: name || 'Admin', phone: phone || null, email: email || null, role });
});

// Mailer check: sends one demo email through Brevo so the admin can confirm BREVO_API_KEY/MAIL_FROM work.
router.post('/mail/test', async (req, res) => {
  const { sendMail, isMailerConfigured } = require('../utils/mailer');
  if (!isMailerConfigured()) return res.status(503).json({ ok: false, reason: 'not_configured' });
  const to = String(req.body?.to || '').trim();
  const result = await sendMail({
    to,
    subject: 'Zenvy test email',
    text: 'This is a test email from Zenvy. If you can read this, email delivery (Brevo) is working.',
    html: '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:22px"><h2 style="margin:0 0 12px">Zenvy test email</h2><p>If you can read this, email delivery (Brevo) is working. College verification codes will arrive the same way.</p></div>',
  });
  res.status(result.ok ? 200 : 502).json(result);
});

// Admin Broadcast Push
router.post('/broadcast-push', broadcastPushNotification);

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
router.put('/users/:userId/ban', toggleUserBan);

// Coupon Management
router.get('/coupons', getAllCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:id', deleteCoupon);

// Global Configuration
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
  if (String(req.query.reset || '') === '1') perf.resetRoutes();
  res.set('Cache-Control', 'no-store');
  res.json(snap);
});

module.exports = router;
