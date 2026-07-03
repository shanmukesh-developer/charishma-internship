const express = require('express');
const { registerUser, authUser, saveFcmToken, getUserProfile, updateUserProfile, logoutUser } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Strict Auth Shield (Brute-Force Protection) ──────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login/register requests per window
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' }
});

const { body, validationResult } = require('express-validator');

// Validation Error Handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: errors.array()[0].msg,
      errors: errors.array() 
    });
  }
  next();
};

const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').escape(),
  body('email').optional().isEmail().withMessage('Invalid email').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').notEmpty().withMessage('Phone is required').trim().escape(),
  body('role').optional().isIn(['student', 'admin', 'restaurant', 'delivery']).withMessage('Invalid role'),
  body('referralCode').optional().trim().escape()
];

const loginValidation = [
  body('phone').notEmpty().withMessage('Phone is required').trim().escape(),
  body('password').optional() // password might be optional if using firebaseToken
];

router.post('/register', authLimiter, registerValidation, validate, registerUser);
router.post('/login', authLimiter, loginValidation, validate, authUser);
router.post('/google-login', authLimiter, require('../controllers/userController').googleLogin);
router.post('/reset-password', authLimiter, require('../controllers/userController').resetPassword);
router.post('/logout', logoutUser);
router.post('/fcm-token', saveFcmToken);
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);

// Public Asset Discovery
router.get('/config', require('../controllers/adminController').getGlobalConfig);
router.get('/restaurants', require('../controllers/adminController').getRestaurants);
router.get('/restaurants/:id', require('../controllers/adminController').getRestaurantById);
router.get('/search', require('../controllers/searchController').globalSearch);

// ── BUG FIX: GET /products (all items) ──
// Returns all menu items across all restaurants for the catalog browse
// IMPORTANT: Must be registered BEFORE /products/:id to prevent route shadowing
router.get('/products', async (req, res) => {
  try {
    const { getMenuItemModel } = require('../models/MenuItem');
    const MenuItem = getMenuItemModel();
    const items = await MenuItem.findAll({ where: { isAvailable: true }, order: [['createdAt', 'DESC']] });
    res.json(items);
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch products', error: _err.message });
  }
});

router.get('/products/:id', require('../controllers/adminController').getMenuItemById);

// ── BUG FIX: GET /orders (customer's own orders) ──
router.get('/orders', protect, async (req, res) => {
  try {
    const { getOrderModel } = require('../models/Order');
    const Order = getOrderModel();
    const orders = await Order.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
    res.json(orders);
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch orders', error: _err.message });
  }
});

// ── BUG FIX: GET /rewards (spin + leaderboard) ──
router.get('/rewards', protect, async (req, res) => {
  try {
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    const user = await User.findByPk(req.user.id, { attributes: ['id', 'name', 'zenPoints', 'completedOrders', 'streakCount', 'badges', 'spinsUsed'] });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const spinsEarned = Math.floor((user.completedOrders || 0) / 2);
    const spinsAvailable = Math.max(0, spinsEarned - (user.spinsUsed || 0));

    res.json({
      zenPoints: user.zenPoints || 0,
      completedOrders: user.completedOrders || 0,
      streakCount: user.streakCount || 0,
      badges: user.badges || [],
      spinEligible: spinsAvailable > 0
    });
  } catch (_err) {
    res.status(500).json({ message: 'Failed to fetch rewards', error: _err.message });
  }
});

module.exports = router;
