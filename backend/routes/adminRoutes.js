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
  deleteCoupon
} = require('../controllers/adminController');
const { getAllOrders } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware');

// ─── Protected Admin Routes ──────────────────────────────────
router.use(protect);
router.use(admin);

// Live Orders Intelligence
router.get('/orders', getAllOrders);
router.get('/stats', getDashboardStats);
router.get('/stats/volume', getOrderVolumeStats);
router.put('/orders/batch-update', batchUpdateOrders);

// Restaurant & Menu Control
router.get('/restaurants', getAllRestaurants);
router.post('/restaurants', createRestaurant);
router.post('/restaurants/:id', updateRestaurant);
router.get('/menu-items', getAllMenuItems);
router.post('/menu-items/:id', upsertMenuItem); // id can be 'new'
router.delete('/menu-items/:id/delete', deleteMenuItem);
router.delete('/restaurants/:id', deleteRestaurant);

// Fleet Management
router.get('/riders', getAllRiders);
router.put('/riders/:id/approve', approveRider);
router.post('/riders/:id', (req, res, next) => {
  const { updateRider } = require('../controllers/adminController');
  updateRider(req, res, next);
});
router.post('/riders/:id/reset-sos', (req, res, next) => {
  const { resetRiderSos } = require('../controllers/adminController');
  resetRiderSos(req, res, next);
});

// User Management
router.get('/users', getAllUsers);
router.put('/users/:userId/elite', setEliteStatus);
router.post('/users/:userId/wallet', (req, res, next) => {
  const { updateUserWallet } = require('../controllers/adminController');
  updateUserWallet(req, res, next);
});

// Coupon Management
router.get('/coupons', getAllCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:id', deleteCoupon);

// Global Configuration
router.get('/config', getGlobalConfig);
router.post('/config', updateGlobalConfig);

// Zenvy Vault Control
router.get('/vault', getVaultItems);
router.post('/vault/:id', upsertVaultItem); // id can be 'new'
router.delete('/vault/:id', deleteVaultItem);

// Database Seeding Engine
router.post('/seed', seedDatabase);

// Nexus Intelligence
router.get('/finance', getFinanceReport);
router.get('/finance/payouts', (req, res, next) => {
  const { getRestaurantPayouts } = require('../controllers/adminController');
  getRestaurantPayouts(req, res, next);
});
router.get('/finance/disputes', (req, res, next) => {
  const { getDisputedOrders } = require('../controllers/adminController');
  getDisputedOrders(req, res, next);
});
router.post('/finance/refund/:orderId', (req, res, next) => {
  const { processManualRefund } = require('../controllers/adminController');
  processManualRefund(req, res, next);
});

// Advanced God-Tier
router.put('/users/:userId/ban', (req, res, next) => {
  const { toggleUserBan } = require('../controllers/adminController');
  toggleUserBan(req, res, next);
});
router.post('/broadcast-push', (req, res, next) => {
  const { broadcastPushNotification } = require('../controllers/adminController');
  broadcastPushNotification(req, res, next);
});
router.get('/reviews', (req, res, next) => {
  const { getRecentReviews } = require('../controllers/adminController');
  getRecentReviews(req, res, next);
});
router.delete('/reviews/:orderId', (req, res, next) => {
  const { deleteReview } = require('../controllers/adminController');
  deleteReview(req, res, next);
});
router.get('/fleet/payouts', (req, res, next) => {
  const { getRiderPayouts } = require('../controllers/adminController');
  getRiderPayouts(req, res, next);
});

router.get('/audit', getAuditLogs);
router.get('/rewards-analytics', getRewardsAnalytics);
router.get('/health', getSystemHealth);

module.exports = router;
