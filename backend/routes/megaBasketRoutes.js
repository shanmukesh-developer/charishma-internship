const express = require('express');
const { protect, rider, admin } = require('../middleware/authMiddleware');
const {
  createBasket,
  payBasket,
  getBasket,
  getCustomerBaskets,
  getPendingBaskets,
  claimBasket,
  startShopping,
  updateItemStatus,
  submitBill,
  approvePrices,
  purchaseCompleted,
  startDelivery,
  completeDelivery,
  getActiveBaskets,
  getAllBaskets
} = require('../controllers/megaBasketController');

const router = express.Router();

// Admin Endpoints
router.get('/admin/all', protect, admin, getAllBaskets);

// Customer Endpoints
router.post('/', protect, createBasket);
router.get('/', protect, getCustomerBaskets);
router.get('/:id', protect, getBasket);
router.post('/:id/pay', protect, payBasket);
router.post('/:id/approve', protect, approvePrices);

// Rider Endpoints
router.get('/rider/pending', protect, rider, getPendingBaskets);
router.get('/rider/active', protect, rider, getActiveBaskets);
router.post('/:id/claim', protect, rider, claimBasket);
router.post('/:id/start-shopping', protect, rider, startShopping);
router.put('/:id/item-status', protect, rider, updateItemStatus);
router.post('/:id/submit-bill', protect, rider, submitBill);
router.post('/:id/purchase-completed', protect, rider, purchaseCompleted);
router.post('/:id/start-delivery', protect, rider, startDelivery);
router.post('/:id/complete-delivery', protect, rider, completeDelivery);

module.exports = router;
