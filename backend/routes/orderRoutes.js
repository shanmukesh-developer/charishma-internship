const express = require('express');
const { createOrder, getOrderById, getMyOrders, rateOrder, cancelOrder, getAllOrders, updateOrderStatus, getSurgeStatus, restaurantAcceptOrder, verifyUPIPayment, restaurantReadyOrder, getOrderStats } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware');
const router = express.Router();

const { body, validationResult } = require('express-validator');

// Validation Error Handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const orderValidation = [
  body('items').isArray({ min: 1 }).withMessage('Items array must not be empty'),
  body('totalAmount').optional().isNumeric().withMessage('Total amount must be a number'),
  body('deliverySlot').optional().trim().escape(),
  body('restaurantId').optional().trim().escape(),
  body('deliveryMethod').optional().trim().escape()
];

router.post('/', protect, orderValidation, validate, createOrder);
router.get('/', protect, admin, getAllOrders);
router.get('/myorders', protect, getMyOrders);
router.get('/stats', protect, getOrderStats);
router.get('/surge-status', getSurgeStatus);
router.get('/:id', protect, getOrderById);
router.put('/:id/rate', protect, rateOrder);
router.put('/:id/cancel', protect, cancelOrder);
router.put('/:id/status', protect, admin, updateOrderStatus);
router.put('/:id/restaurant-accept', protect, restaurantAcceptOrder);
router.put('/:id/restaurant-ready', protect, restaurantReadyOrder);
router.put('/:id/verify-upi', protect, admin, verifyUPIPayment);

module.exports = router;

