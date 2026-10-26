const express = require('express');
const { createOrder, quoteOrder, getServiceability, getDeliverySlots, getOrderById, getMyOrders, rateOrder, cancelOrder, getAllOrders, updateOrderStatus, getSurgeStatus, restaurantAcceptOrder, verifyUPIPayment, restaurantReadyOrder, getOrderStats, uploadItemPhoto, approvePurchase, uploadBillProof, approveBill, restaurantUpdateOrderStatus } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware');
const router = express.Router();

// Non-UUID ids answer 404 instead of a PostgreSQL "invalid input syntax for type uuid" 500
// (SQLite never complained, so this only showed up in production).
const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('id', (req, res, next, id) => (UUID_PARAM_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Order not found', code: 'NOT_FOUND' })));

const { body, validationResult } = require('express-validator');

// Validation Error Handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Friendly single message first (the app shows `message`), details kept for debugging.
    const first = errors.array()[0];
    return res.status(400).json({ message: first && first.msg ? first.msg : 'Some order details are missing. Please check and try again.', code: 'INVALID_ORDER', errors: errors.array() });
  }
  next();
};

const orderValidation = [
  body('items').isArray({ min: 1 }).withMessage('Your basket is empty. Add something tasty first!'),
  body('totalAmount').optional().isNumeric().withMessage('Total amount must be a number'),
  body('deliverySlot').optional().trim().escape(),
  body('restaurantId').optional().trim().escape(),
  body('deliveryMethod').optional().trim().escape()
];

router.post('/quote', protect, quoteOrder);            // server bill for a basket (no side effects)
// is campus ordering open right now? (clock-based, no DB: cached briefly for the ETag / 304)
router.get('/serviceability', require('../utils/responseCache').cacheGet('serviceability', { ttlMs: 15 * 1000 }), getServiceability);
// delivery slots (today + tomorrow, IST) for a kind of order: shopping list, Home hint (clock + cached config)
router.get('/delivery-slots', getDeliverySlots);
router.post('/', protect, orderValidation, validate, createOrder);
router.get('/', protect, admin, getAllOrders);
router.get('/myorders', protect, getMyOrders);
router.get('/stats', protect, getOrderStats);
router.get('/surge-status', getSurgeStatus);
router.get('/:id', protect, getOrderById);
// C9: persisted order chat history (customer of the order, its current rider, admins).
router.get('/:id/messages', protect, require('../utils/orderMessages').getOrderMessagesRoute);
// C8: structured receipt of a delivered order (customer / its store / admin) + a signed 15-min HTML link.
router.get('/:id/receipt', protect, require('../controllers/receiptController').getOrderReceipt);
router.put('/:id/rate', protect, rateOrder);
router.put('/:id/cancel', protect, cancelOrder);
// Admins: any status. The restaurant partner app also calls this for its own orders (kitchen steps only).
router.put('/:id/status', protect, (req, res, next) => (
  String(req.user?.role || '').toLowerCase() === 'restaurant' ? restaurantUpdateOrderStatus(req, res) : next()
), admin, updateOrderStatus);
router.put('/:id/restaurant-accept', protect, restaurantAcceptOrder);
router.put('/:id/restaurant-ready', protect, restaurantReadyOrder);
router.put('/:id/verify-upi', protect, admin, verifyUPIPayment); // legacy UPI orders only

// Mega Basket Kirana pre-purchase and final bill approval endpoints
router.put('/:id/upload-item-photo', protect, uploadItemPhoto);
router.put('/:id/approve-purchase', protect, approvePurchase);
router.put('/:id/upload-bill-proof', protect, uploadBillProof);
router.put('/:id/approve-bill', protect, approveBill);

module.exports = router;

