const express = require('express');
const { registerPartner, authPartner, acceptOrder, getPendingOrders, getActiveOrders, updateOrderStatus, toggleOnline, getOrderHistory, saveFcmToken, getLeaderboard, getRiderProfile, updateRiderProfile, getPublicRiderProfile, getTodayStats, cancelOrderByRider, changePassword, notifyArrivalAtGate } = require('../controllers/deliveryPartnerController');
const { protect, rider } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Strict Auth Shield (Scaled for 500+ campus users on shared Wi-Fi) ──────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // 500+ students share same campus Wi-Fi IP → must allow bulk logins
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' }
});

const { accountLockout } = require('../middleware/lockoutMiddleware');

router.post('/register', authLimiter, registerPartner);
router.post('/login', authLimiter, accountLockout, authPartner);
router.post('/fcm-token', protect, rider, saveFcmToken);
router.get('/orders/pending', protect, rider, getPendingOrders);
router.get('/orders/active', protect, rider, getActiveOrders);
router.get('/orders/history', protect, rider, getOrderHistory);
router.get('/leaderboard', protect, rider, getLeaderboard);
router.get('/stats/today', protect, rider, getTodayStats);
router.get('/profile', protect, rider, getRiderProfile);
router.put('/profile', protect, rider, updateRiderProfile);
router.put('/profile/password', protect, rider, changePassword);
router.get('/profile/:id/public', getPublicRiderProfile);   // No auth — customer tracking
router.put('/accept/:orderId', protect, rider, acceptOrder);
router.put('/status/:orderId', protect, rider, updateOrderStatus);
router.put('/arrive/:orderId', protect, rider, notifyArrivalAtGate);
router.put('/cancel/:orderId', protect, rider, cancelOrderByRider);
router.put('/online', protect, rider, toggleOnline);

module.exports = router;
