const express = require('express');
const { refreshStoreToken, getRestaurants, getRestaurantMenu, createRestaurant, restaurantLogin, getRestaurantOrders, toggleMenuItemAvailability, setCategoryStock, updateMenuItemTags, createMenuItem, updateMenuItem, deleteMenuItem, getLocalVendors, incrementClickCount, toggleRestaurantOffline, setRestaurantOpen, setRestaurantHours, saveStoreFcmToken, getMenuItemById } = require('../controllers/restaurantController');
const { protect, admin, vendor } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Strict Auth Shield (Scaled for 500+ campus users on shared Wi-Fi) ──────────────────────
// Store logins come from a few hundred stores, not students on shared Wi-Fi: keep this tight.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' },
  ...require('../utils/sharedRateLimit').expressStore('store.authLimiter'),
});

const { accountLockout } = require('../middleware/lockoutMiddleware');

// ── CampusBites: Local Vendor Public Routes (MUST be before /:id) ────
// Public reads: short server cache + ETag, cleared on every store / product write.
const { cacheGet } = require('../utils/responseCache');
const catalogCache = cacheGet('catalog', { ttlMs: 30 * 1000 });
router.get('/local-vendors', catalogCache, getLocalVendors);
router.post('/:id/click', incrementClickCount);
router.get('/menu/item/:itemId', catalogCache, getMenuItemById);

router.get('/', catalogCache, getRestaurants);
// The store's own menu read (and admins) skips the cache: a stock toggle / price edit within a few seconds of another
// catalog change was otherwise answered from the cached copy and flipped back in the store's own app.
router.get('/:id/menu', cacheGet('catalog', { ttlMs: 30 * 1000, bypass: (req) => require('../controllers/adminController').storeViewerPrivileged(req, req.params.id) }), getRestaurantMenu);
router.post('/login', authLimiter, accountLockout, restaurantLogin);
router.post('/refresh-token', protect, refreshStoreToken); // sliding store / vendor session (B28)
router.get('/:id/orders', protect, vendor, getRestaurantOrders); 
// C6: the store's own payout statements (API only; the partner apps have no earnings screen yet).
router.get('/:id/payouts', protect, vendor, require('../controllers/financeController').getStorePayouts);
// C8: the store's own legal name / FSSAI licence / GSTIN (PAN + payout details: admin only).
router.get('/:id/compliance', protect, vendor, require('../controllers/complianceController').getStoreCompliance);
router.put('/:id/compliance', protect, vendor, require('../controllers/complianceController').updateStoreCompliance);
router.put('/:id/offline', protect, vendor, toggleRestaurantOffline);
router.put('/:id/open', protect, vendor, setRestaurantOpen);
router.put('/:id/hours', protect, vendor, setRestaurantHours);
// Whole menu category in / out of stock in one tap (the store's own items only).
router.put('/:id/menu/category-stock', protect, vendor, setCategoryStock);
router.post('/fcm-token', protect, vendor, saveStoreFcmToken);
router.post('/fcm-token/remove', protect, vendor, saveStoreFcmToken);
router.post('/menu', protect, vendor, createMenuItem);
router.put('/menu/:itemId', protect, vendor, updateMenuItem);
router.put('/menu/:itemId/toggle', protect, vendor, toggleMenuItemAvailability);
router.put('/menu/:itemId/tags', protect, vendor, updateMenuItemTags);
router.delete('/menu/:itemId', protect, vendor, deleteMenuItem);
router.post('/', protect, admin, createRestaurant);

module.exports = router;

