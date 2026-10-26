const express = require('express');
const router = express.Router();
const { checkSpinEntry, useSpin, getLeaderboard, getUserCoupons, getCouponHistory, validateCoupon } = require('../controllers/rewardController');
const { protect } = require('../middleware/authMiddleware');

router.get('/spin-eligibility', protect, checkSpinEntry);
router.post('/use-spin', protect, useSpin);
router.post('/validate-coupon', protect, validateCoupon);
router.get('/coupons', protect, getUserCoupons);
router.get('/coupons/history', protect, getCouponHistory);
router.get('/leaderboard', getLeaderboard); // Publicly accessible

router.get('/', protect, async (req, res) => {
  // Return summarized rewards info for the user
  const { checkSpinEntry } = require('../controllers/rewardController');
  await checkSpinEntry(req, res);
});

module.exports = router;
