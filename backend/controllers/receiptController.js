// C8 order receipts (utils/receipts) + the admin RECEIPT_SETTINGS card (utils/receiptSettings).
const receipts = require('../utils/receipts');
const receiptSettings = require('../utils/receiptSettings');
const { getOrderModel } = require('../models/Order');
const { getGlobalConfigModel } = require('../models/GlobalConfig');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { sendServerError } = require('../utils/httpErrors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_ATTRS = ['id', 'userId', 'restaurantId', 'status', 'items', 'totalPrice', 'deliveryFee', 'batchDiscount', 'gateDiscount', 'finalPrice',
  'priceBreakdown', 'paymentMethod', 'paymentStatus', 'fulfilment', 'deliveredAt', 'createdAt', 'updatedAt', 'isBillApproved', 'billAmount',
  'receiptNumber', 'receiptIssuedAt', 'receiptSnapshot'];

/** Delivered order -> receipt (assigning the number when it has none yet). */
const loadReceipt = async (orderId) => {
  const Order = getOrderModel();
  let order = await Order.findByPk(orderId, { attributes: RECEIPT_ATTRS });
  if (order && order.status === 'Delivered' && !order.receiptNumber) {
    await receipts.assignReceiptNumber(order.id);
    order = await Order.findByPk(orderId, { attributes: RECEIPT_ATTRS });
  }
  return order;
};

const customerNameOf = async (order) => {
  try {
    const { getUserModel } = require('../models/User');
    const u = await getUserModel().findByPk(order.userId, { attributes: ['name'] });
    return u ? u.name : null;
  } catch { return null; }
};

// @route GET /api/orders/:id/receipt   (protect: the order's customer, its store, or an admin)
// -> { receipt, url, urlExpiresAt }. url = /receipts/<signed 15-min token> (opens without a login).
exports.getOrderReceipt = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found' });
    const Order = getOrderModel();
    const head = await Order.findByPk(req.params.id, { attributes: ['id', 'userId', 'restaurantId', 'status'] });
    // Someone else's order answers exactly like a missing one.
    if (!head || !receipts.canView(req.user, head)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found' });
    if (head.status !== 'Delivered') {
      return res.status(409).json({ code: 'RECEIPT_NOT_READY', message: head.status === 'Cancelled' ? 'This order was cancelled, so there is no receipt.' : 'The receipt is ready once the order is delivered.' });
    }
    const order = await loadReceipt(head.id);
    if (!order || !order.receiptNumber) return res.status(503).json({ code: 'RECEIPT_UNAVAILABLE', message: 'The receipt could not be prepared right now. Please try again.' });
    const receipt = receipts.buildReceipt(order, { customerName: await customerNameOf(order) });
    const link = receipts.linkFor(req, order.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, receipt, url: link.url, urlExpiresAt: link.expiresAt });
  } catch (error) {
    sendServerError(res, error, '[ORDER_RECEIPT_ERROR]');
  }
};

// @route GET /receipts/:token   (public, signed short-lived link) -> printable HTML receipt
exports.renderReceiptPage = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.type('html');
  try {
    const v = receipts.verifyLink(req.params.token);
    if (v.error === 'expired') return res.status(410).send(receipts.renderMessage('Link expired', 'This receipt link has expired. Open the receipt again from the ZCS app.'));
    if (v.error || !UUID_RE.test(v.orderId)) return res.status(404).send(receipts.renderMessage('Receipt not found', 'This receipt link is not valid.'));
    const order = await loadReceipt(v.orderId);
    if (!order || order.status !== 'Delivered' || !order.receiptNumber) return res.status(404).send(receipts.renderMessage('Receipt not found', 'This receipt is not available.'));
    const receipt = receipts.buildReceipt(order, { customerName: await customerNameOf(order) });
    res.send(receipts.renderHtml(receipt));
  } catch (error) {
    console.error('[RECEIPT_PAGE_ERROR]', error && error.message);
    res.status(500).send(receipts.renderMessage('Something went wrong', 'The receipt could not be shown right now. Please try again.'));
  }
};

// ─── Admin: RECEIPT_SETTINGS ─────────────────────────────────────────────
const adminShape = (settings, row) => ({
  success: true,
  settings,
  defaults: receiptSettings.defaults(),
  effectiveTaxDisplayMode: receiptSettings.effectiveMode(settings),
  breakdownAllowed: receiptSettings.breakdownAllowed(settings),
  inclusiveNote: receiptSettings.INCLUSIVE_NOTE,
  updatedAt: row && row.updatedAt ? row.updatedAt : null,
});
const sameTime = (a, b) => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
};

// @route GET /api/admin/receipt-settings
exports.getAdminReceiptSettings = async (req, res) => {
  try {
    const { settings, row } = await receiptSettings.readFromDb();
    res.set('Cache-Control', 'no-store');
    res.json(adminShape(settings, row));
  } catch (error) {
    sendServerError(res, error, '[RECEIPT_SETTINGS_GET_ERROR]');
  }
};

// @route PUT /api/admin/receipt-settings   Partial: only the fields sent change. Audited.
exports.updateAdminReceiptSettings = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { settings: before, row } = await receiptSettings.readFromDb();
    if (typeof body.ifUpdatedAt === 'string' && body.ifUpdatedAt && row && row.updatedAt && !sameTime(row.updatedAt, body.ifUpdatedAt)) {
      return res.status(409).json({ success: false, code: 'CONFIG_CONFLICT', message: 'Someone else changed the receipt settings since you loaded them. Reload and make your change again.', ...adminShape(before, row) });
    }
    const { settings, error } = receiptSettings.validateUpdate(before, body);
    if (error) return res.status(400).json({ success: false, code: 'INVALID_RECEIPT_SETTINGS', message: error });
    const changes = receiptSettings.diff(before, settings);
    if (!Object.keys(changes).length) return res.json({ ...adminShape(before, row), changed: false });
    await getGlobalConfigModel().upsert({ key: receiptSettings.KEY, value: settings, description: 'Receipt tax display (inclusive / GST breakdown), platform GSTIN, footer note, hide stores without FSSAI. Edit on Config → Receipts.' });
    receiptSettings.clearCache();
    if ('hideStoresWithoutFssai' in changes) {
      try { require('./adminController').clearRestaurantsCache(); } catch { /* listings expire on their own */ }
    }
    try {
      await getVerificationLogModel().create({
        adminId: req.user && req.user.id ? String(req.user.id) : 'admin_default',
        targetId: 'receipt_settings',
        action: 'RECEIPT_SETTINGS_UPDATED',
        details: JSON.stringify({ changes }).slice(0, 8000),
      });
    } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
    const fresh = await receiptSettings.readFromDb();
    res.json({ ...adminShape(fresh.settings, fresh.row), changed: true, changes });
  } catch (error) {
    sendServerError(res, error, '[RECEIPT_SETTINGS_PUT_ERROR]');
  }
};
