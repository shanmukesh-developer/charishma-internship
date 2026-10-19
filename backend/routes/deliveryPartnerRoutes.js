const express = require('express');
const { registerPartner, authPartner, acceptOrder, getPendingOrders, getActiveOrders, updateOrderStatus, toggleOnline, getOrderHistory, saveFcmToken, getLeaderboard, getRiderProfile, updateRiderProfile, getPublicRiderProfile, getTodayStats, cancelOrderByRider, changePassword, notifyArrivalAtGate, getWeekStats, createRiderTicket, getRiderTickets, removeFcmToken, triggerSos } = require('../controllers/deliveryPartnerController');
const { protect, rider } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Strict Auth Shield (Scaled for 500+ campus users on shared Wi-Fi) ──────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // 500+ students share same campus Wi-Fi IP → must allow bulk logins
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' },
  ...require('../utils/sharedRateLimit').expressStore('rider.authLimiter'),
});

const { accountLockout } = require('../middleware/lockoutMiddleware');

router.post('/register', authLimiter, registerPartner);
router.post('/login', authLimiter, accountLockout, authPartner);
router.post('/fcm-token', protect, rider, saveFcmToken);
// Logout on this phone: stop order pushes to its token (partners-3). Any rider session, approved or not.
router.post('/fcm-token/remove', protect, rider, removeFcmToken);
// Rider SOS (admin-11): any signed-in rider, approved or not. Rate limited per IP.
const sosLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { message: 'Too many SOS requests. If you are in danger call 112.' }, ...require('../utils/sharedRateLimit').expressStore('rider.sosLimiter') });
router.post('/sos', sosLimiter, protect, rider, triggerSos);
router.get('/orders/pending', protect, rider, getPendingOrders);
router.get('/orders/active', protect, rider, getActiveOrders);
router.get('/orders/history', protect, rider, getOrderHistory);
router.get('/leaderboard', protect, rider, getLeaderboard);
router.get('/stats/today', protect, rider, getTodayStats);
router.get('/stats/week', protect, rider, getWeekStats);
router.post('/support', protect, rider, createRiderTicket);
router.get('/support', protect, rider, getRiderTickets);
router.get('/profile', protect, rider, getRiderProfile);
// C5: rider wallet (customer tips, payouts) history.
router.get('/wallet/transactions', protect, rider, require('../controllers/walletController').getRiderWalletTransactions);
// C6: cash held for Zenvy (COD) + limit + net position, cash history, payout statements.
{
  const fc = require('../controllers/financeController');
  router.get('/cash', protect, rider, fc.getMyCash);
  router.get('/cash/entries', protect, rider, fc.getMyCashEntries);
  router.get('/payouts', protect, rider, fc.getMyPayouts);
}
router.put('/profile', protect, rider, updateRiderProfile);
router.put('/profile/password', protect, rider, changePassword);
router.get('/profile/:id/public', protect, getPublicRiderProfile);
router.put('/accept/:orderId', protect, rider, acceptOrder);
router.put('/status/:orderId', protect, rider, updateOrderStatus);
router.put('/arrive/:orderId', protect, rider, notifyArrivalAtGate);
router.put('/cancel/:orderId', protect, rider, cancelOrderByRider);
// Alias used by the rider app's "unassign" button (POST /api/delivery/orders/:orderId/cancel).
router.post('/orders/:orderId/cancel', protect, rider, cancelOrderByRider);
router.put('/online', protect, rider, toggleOnline);
// C9: in-app account deletion (any signed-in rider, approved or not): /account/deletion-check, /delete-otp, /delete.
router.use('/account', require('./partnerAccountRoutes').riderRouter);

module.exports = router;
