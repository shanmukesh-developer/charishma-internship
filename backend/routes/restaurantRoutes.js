const express = require('express');
const { getRestaurants, getRestaurantMenu, createRestaurant, restaurantLogin, getRestaurantOrders, toggleMenuItemAvailability, updateMenuItemTags, createMenuItem, updateMenuItem, getLocalVendors, incrementClickCount, toggleRestaurantOffline } = require('../controllers/restaurantController');
const { protect, admin, vendor } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Strict Auth Shield (Brute-Force Protection) ──────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many authentication attempts, please try again after 15 minutes.' }
});

// ── CampusBites: Local Vendor Public Routes (MUST be before /:id) ────
router.get('/local-vendors', getLocalVendors);
router.post('/:id/click', incrementClickCount);

router.get('/', getRestaurants);
router.get('/:id/menu', getRestaurantMenu);
router.post('/login', authLimiter, restaurantLogin);
router.get('/:id/orders', protect, vendor, getRestaurantOrders); 
router.put('/:id/offline', protect, vendor, toggleRestaurantOffline);
router.post('/menu', protect, vendor, createMenuItem);
router.put('/menu/:itemId', protect, vendor, updateMenuItem);
router.put('/menu/:itemId/toggle', protect, vendor, toggleMenuItemAvailability);
router.put('/menu/:itemId/tags', protect, vendor, updateMenuItemTags);
router.post('/', protect, admin, createRestaurant);

module.exports = router;

