const express = require('express');
const {
  registerUser, authUser, saveFcmToken, removeFcmToken, getUserProfile, updateUserProfile, logoutUser,
  sendOtp, sendEmailOtp, verifyOtp, googleLogin, googleComplete, resetPassword, refreshUserToken
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Auth Shield (scaled for 500-1000 campus users on ONE shared Wi-Fi NAT IP) ───────────────────
// 50 per IP per 15 min was the whole campus' budget: ~16 students logging in (send-otp +
// verify-otp + login) locked everyone else out for 15 minutes. Guessing is already capped per
// account (accountLockout, 5 OTP attempts per code, 8 SMS per number per day), so the per-IP cap
// is only a flood guard now, and each phone number gets its own small budget on top.
const { normalizePhone } = require('../utils/phoneUtils');
const AUTH_IP_MAX = Math.max(50, Number(process.env.AUTH_RATE_LIMIT_IP_MAX) || 600);
const AUTH_PHONE_MAX = Math.max(10, Number(process.env.AUTH_RATE_LIMIT_PHONE_MAX) || 30);
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_IP_MAX,
  // Load-test requests (X-Loadtest-Key === env LOADTEST_KEY) skip this IP flood guard only; the
  // per-phone budget below, accountLockout and validation still apply to them.
  skip: (req) => require('../utils/loadtestBypass').skipRateLimit(req),
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.', code: 'RATE_LIMITED' },
  ...require('../utils/sharedRateLimit').expressStore('user.authIpLimiter'),
});
const authPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_PHONE_MAX,
  // Requests without a phone (Google sign-in) share the IP bucket above only.
  skip: (req, res) => !require('../utils/loadtestBypass').rateLimitsActive() || !normalizePhone(String((req.body && req.body.phone) || '')),
  keyGenerator: (req) => `phone:${normalizePhone(String((req.body && req.body.phone) || ''))}`,
  message: { message: 'Too many attempts for this number, please try again after 15 minutes.', code: 'RATE_LIMITED' },
  ...require('../utils/sharedRateLimit').expressStore('user.authPhoneLimiter'),
});
const authLimiter = [authIpLimiter, authPhoneLimiter];
// C1-6: send-otp costs real money per call, so it gets its own, tighter per-IP flood guard on top
// (default 200 per 15 min per IP, floor 30). It stays generous on purpose: a whole hostel shares a few
// NAT IPs. The real abuse limits are per phone (cooldown + daily cap in the controller, the phone
// bucket above) and the global daily SMS cap (utils/smsBudget, SMS_DAILY_CAP).
const OTP_SEND_IP_MAX = Math.max(30, Number(process.env.OTP_SEND_IP_MAX) || 200);
const otpSendIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: OTP_SEND_IP_MAX,
  skip: (req) => require('../utils/loadtestBypass').skipRateLimit(req),
  message: { message: 'Too many codes requested from this network. Please try again in a few minutes or log in with your password.', code: 'RATE_LIMITED' },
  ...require('../utils/sharedRateLimit').expressStore('user.otpSendIpLimiter'),
});

const { accountLockout } = require('../middleware/lockoutMiddleware');

const { body, validationResult } = require('express-validator');
const { sendServerError } = require('../utils/httpErrors');

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
  // Names are stored as typed (React escapes on render) — no HTML-entity escaping here.
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 60 }).withMessage('Name is too long'),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email'),
  // Password is optional for OTP / Google sign-ups; when given it must be 6+ chars
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').notEmpty().withMessage('Phone is required').trim(),
  body('referralCode').optional({ values: 'falsy' }).trim()
];

const loginValidation = [
  body('phone').notEmpty().withMessage('Phone is required').trim().escape(),
  body('password').optional() // password might be optional if using firebaseToken
];

router.post('/register', authLimiter, registerValidation, validate, registerUser);
router.post('/login', authLimiter, accountLockout, loginValidation, validate, authUser);
// S1: admin 2-step sign-in, second step ({ mfaToken, code | recoveryCode }); 5 wrong codes lock it 15 min.
router.post('/login/mfa', authIpLimiter, require('../services/adminTwoFactor').loginMfa);
router.post('/send-otp', authLimiter, otpSendIpLimiter, sendOtp);
// Email backup when the SMS code cannot be sent (same limits as the SMS code; 503 while email is not set up).
router.post('/send-email-otp', authLimiter, otpSendIpLimiter, sendEmailOtp);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/google-login', authLimiter, googleLogin);
router.post('/google-complete', authLimiter, googleComplete);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/logout', logoutUser);
// Silent session refresh (sliding 30 days): the app calls it when its token is within ~7 days of expiry.
router.post('/refresh', protect, refreshUserToken);
router.post('/refresh-token', protect, refreshUserToken);
router.post('/fcm-token', protect, saveFcmToken);
router.delete('/fcm-token', protect, removeFcmToken);
router.post('/fcm-token/remove', protect, removeFcmToken);
router.get('/profile', protect, getUserProfile);
// C4 legal: has this account accepted the current Terms? / record acceptance (never blocks the account).
router.get('/legal/status', protect, require('../controllers/legalController').getMyLegalStatus);
router.post('/legal/accept', protect, require('../controllers/legalController').acceptTerms);
router.put('/profile', protect, updateUserProfile);
// C5: my wallet history (newest first, paginated, human labels + order / booking links).
router.get('/wallet/transactions', protect, require('../controllers/walletController').getMyWalletTransactions);
// Customer polish: favourite stores and saved addresses, synced to the account (the app keeps a local copy).
router.get('/favorites', protect, require('../controllers/customerExtrasController').getFavorites);
router.put('/favorites', protect, require('../controllers/customerExtrasController').putFavorites);
router.get('/addresses', protect, require('../controllers/customerExtrasController').getAddresses);
router.put('/addresses', protect, require('../controllers/customerExtrasController').putAddresses);

// Public Asset Discovery (short server cache + ETag; cleared on every store / product / config write)
const { cacheGet } = require('../utils/responseCache');
router.get('/config', cacheGet('config', { ttlMs: 60 * 1000, bypass: require('../utils/responseCache').liveAdminBypass }), require('../controllers/adminController').getPublicConfig); // S0: public allow-list (admins: every row)
router.get('/restaurants', cacheGet('catalog', { ttlMs: 30 * 1000 }), require('../controllers/adminController').getRestaurants);
// S0: the store's own token / a live admin skip the shared cache (they may read an inactive store).
router.get('/restaurants/:id', cacheGet('catalog', { ttlMs: 30 * 1000, bypass: (req) => require('../controllers/adminController').storeViewerPrivileged(req, req.params.id) }), require('../controllers/adminController').getRestaurantById);
// Same handler + cache key as GET /api/search (public, no per-user data; 'catalog' group).
router.get('/search', cacheGet('catalog', { ttlMs: 30 * 1000, key: require('../controllers/searchController').searchCacheKey }), require('../controllers/searchController').globalSearch);

// ── BUG FIX: GET /products (all items) ──
// Returns all menu items across all restaurants for the catalog browse
// IMPORTANT: Must be registered BEFORE /products/:id to prevent route shadowing
router.get('/products', async (req, res) => {
  try {
    const { getMenuItemModel } = require('../models/MenuItem');
    const MenuItem = getMenuItemModel();
    const { getRestaurantModel } = require('../models/Restaurant');
    // Only items of stores that are switched on: hidden stores (e.g. awaiting owner review) stay hidden.
    const activeStores = await getRestaurantModel().findAll({ where: { isActive: true }, attributes: ['id'] });
    const items = await MenuItem.findAll({
      where: { isAvailable: true, restaurantId: activeStores.map((r) => r.id) },
      order: [['createdAt', 'DESC']],
    });
    const { stripItemSecrets } = require('../utils/publicFields');
    res.json(items.map((m) => stripItemSecrets(m.toJSON())));
  } catch (_err) {
    sendServerError(res, _err, '[USERROUTES_ERROR]');
  }
});

// ── GENUINE PRODUCT REVIEWS & RATINGS (Direct from Customer Orders) ──
router.get('/products/:id/reviews', async (req, res) => {
  try {
    const rawId = req.params.id.trim();
    const cleanSlug = rawId.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const { getProductReviewModel } = require('../models/ProductReview');
    const { getOrderModel } = require('../models/Order');
    const { Op } = require('sequelize');
    const ProductReview = getProductReviewModel();
    const Order = getOrderModel();

    let allReviews = [];

    // 1. Fetch from ProductReview table
    if (ProductReview) {
      const dbReviews = await ProductReview.findAll({
        where: {
          [Op.or]: [
            { productId: rawId },
            { productId: cleanSlug },
            { productName: { [Op.like]: `%${rawId.replace(/[-_]/g, ' ')}%` } }
          ]
        },
        order: [['createdAt', 'DESC']],
        limit: 50
      });

      // Only a first name is shown — never a hostel block / room or anything from an address.
      allReviews = dbReviews.map(r => ({
        id: r.id,
        name: r.userName ? String(r.userName).trim().split(/\s+/)[0] : 'ZCS customer',
        block: null,
        rating: r.rating,
        time: new Date(r.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
        comment: r.comment || '',
        orderId: r.orderId || null,
        verified: !!r.orderId, // verified = written for a delivered order
        helpfulCount: r.helpfulCount || 0,
        tags: r.tags || []
      }));
    }

    // 2. Also check completed orders for this item
    if (Order) {
      const ordersWithReviews = await Order.findAll({
        where: {
          review: { [Op.not]: null },
          status: 'Delivered'
        },
        order: [['createdAt', 'DESC']],
        limit: 30
      });

      for (const ord of ordersWithReviews) {
        let items = [];
        try {
          items = typeof ord.items === 'string' ? JSON.parse(ord.items) : (Array.isArray(ord.items) ? ord.items : []);
        } catch {
          items = [];
        }
        const matchingItem = items.find(it => 
          (it.menuItemId && (it.menuItemId === rawId || it.menuItemId === cleanSlug)) ||
          (it.id && (it.id === rawId || it.id === cleanSlug)) ||
          (it.name && it.name.toLowerCase().includes(rawId.replace(/[-_]/g, ' ').toLowerCase()))
        );

        if (matchingItem && ord.review && !allReviews.some(r => r.id === 'ord-rev-' + ord.id)) {
          // Orders rated after the review sync already have ProductReview rows (same orderId).
          if (ord.rating && !allReviews.some(r => r.orderId === String(ord.id))) {
            allReviews.push({
              id: 'ord-rev-' + ord.id,
              name: 'ZCS customer',
              block: null,
              rating: ord.rating,
              time: new Date(ord.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
              comment: ord.review,
              verified: true,
              helpfulCount: 0
            });
          }
        }
      }
    }

    // Calculate genuine mathematical average and star distribution
    const count = allReviews.length;
    let avg = 0;
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    if (count > 0) {
      let sum = 0;
      allReviews.forEach(r => {
        const star = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 1)));
        dist[star] = (dist[star] || 0) + 1;
        sum += star;
      });
      avg = parseFloat((sum / count).toFixed(1));
    }

    res.json({
      success: true,
      productId: rawId,
      totalCount: count,
      averageRating: avg,
      distribution: dist,
      reviews: allReviews
    });
  } catch (err) {
    sendServerError(res, err, '[USERROUTES_ERROR]');
  }
});

// Post a genuine review directly for a product
router.post('/products/:id/reviews', protect, async (req, res) => {
  try {
    const rawId = req.params.id.trim();
    const { rating, comment, tags } = req.body;
    const { getProductReviewModel } = require('../models/ProductReview');
    const { getUserModel } = require('../models/User');
    const ProductReview = getProductReviewModel();
    const User = getUserModel();

    const starRating = Number(rating);
    if (!Number.isInteger(starRating) || starRating < 1 || starRating > 5) {
      return res.status(400).json({ message: 'Please pick a rating from 1 to 5 stars.' });
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(401).json({ message: 'Please log in again.' });

    // Must have a delivered order containing this product.
    const { getOrderModel } = require('../models/Order');
    const Order = getOrderModel();
    const delivered = await Order.findAll({ where: { userId: req.user.id, status: 'Delivered' }, order: [['createdAt', 'DESC']], limit: 100 });
    const purchase = delivered.find(o => {
      let items = o.items;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
      return (Array.isArray(items) ? items : []).some(it => String(it.menuItemId || it.id || '') === rawId);
    });
    if (!purchase) {
      return res.status(403).json({ message: 'You can review this once you have ordered it and it has been delivered.' });
    }
    const already = await ProductReview.findOne({ where: { productId: rawId, userId: String(req.user.id) } });
    if (already) return res.status(409).json({ message: 'You have already reviewed this product. Thank you!' });

    const text = typeof comment === 'string' ? comment.trim().replace(/[<>]/g, '').slice(0, 1000) : '';
    // One review per (user, product) (B25): the named unique index backs the check above.
    const newReview = await ProductReview.create({
      productId: rawId,
      productName: typeof req.body.productName === 'string' ? req.body.productName.slice(0, 120) : null,
      orderId: String(purchase.id),
      userId: String(req.user.id),
      userName: user.name ? String(user.name).trim().split(/\s+/)[0] : 'ZCS customer',
      userBlock: null,
      rating: starRating,
      comment: text || null,
      tags: Array.isArray(tags) ? tags.slice(0, 10).map(x => String(x).slice(0, 40)) : [],
      verified: true,
      helpfulCount: 0
    }).catch((e) => {
      if (e && e.name === 'SequelizeUniqueConstraintError') return null;
      throw e;
    });
    if (!newReview) return res.status(409).json({ message: 'You have already reviewed this product. Thank you!' });

    res.json({
      success: true,
      message: 'Thanks for your review!',
      review: newReview
    });
  } catch (err) {
    console.error('[POST_REVIEW_ERROR]', err);
    res.status(500).json({ message: 'Could not post your review. Please try again.' });
  }
});

router.get('/products/:id', cacheGet('catalog', { ttlMs: 30 * 1000 }), require('../controllers/adminController').getMenuItemById);

// ── BUG FIX: GET /orders (customer's own orders) ──
router.get('/orders', protect, async (req, res) => {
  try {
    const { getOrderModel } = require('../models/Order');
    const Order = getOrderModel();
    // 1-100 (a negative ?limit was a PostgreSQL error); same customer-facing fields as /api/orders/myorders.
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const orders = await Order.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit });
    const { customerOrderJson } = require('../controllers/orderController');
    res.json(orders.map(customerOrderJson));
  } catch (_err) {
    sendServerError(res, _err, '[USERROUTES_ERROR]');
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
    sendServerError(res, _err, '[USERROUTES_ERROR]');
  }
});

module.exports = router;
