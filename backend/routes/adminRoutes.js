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
  batchUpdateOrders
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
router.get('/audit', getAuditLogs);
router.get('/rewards-analytics', getRewardsAnalytics);
router.get('/health', getSystemHealth);

module.exports = router;
