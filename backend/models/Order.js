const { DataTypes } = require('sequelize');
const orderNumbers = require('../utils/orderNumbers');

let Order;

const initOrderModel = (sequelize) => {
  if (!sequelize) return null;

  Order = sequelize.define('Order', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Human order ID: orderNumber 123 -> orderCode 'ZEN-123' (utils/orderNumbers; server-wide running count).
    ...orderNumbers.attributes(DataTypes),
    // Owner-only test row (utils/testView, scripts/test_data_v2_seed.js): hidden from every non-tester request.
    isTestData: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    restaurantId: { type: DataTypes.UUID, allowNull: false },
    deliveryPartnerId: { type: DataTypes.UUID },
    items: { 
      type: DataTypes.JSON, 
      defaultValue: [],
      get() {
        const rawValue = this.getDataValue('items');
        if (typeof rawValue === 'string') {
          try { return JSON.parse(rawValue); } catch { return []; }
        }
        return rawValue || [];
      }
    },
    totalPrice: { type: DataTypes.FLOAT, allowNull: false },
    deliveryFee: { type: DataTypes.FLOAT, allowNull: false },
    // ZenWe platform fee charged on this order (utils/orderPricing, 5 Nov 2026; 0 on stall orders and on
    // orders placed before it). Part of finalPrice, so wallet refunds return it with everything else.
    platformFee: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    batchDiscount: { type: DataTypes.FLOAT, defaultValue: 0 },
    gateDiscount: { type: DataTypes.FLOAT, defaultValue: 0 },
    finalPrice: { type: DataTypes.FLOAT, allowNull: false },
    // Server-computed bill shown to the customer: { subtotal, deliveryFee, platformFee, packagingFee, taxes, discounts[], totalDiscount, finalPrice, couponCode }
    priceBreakdown: { type: DataTypes.JSON, allowNull: true },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'Pending',
      validate: {
        isIn: [['Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'Picking', 'PickedUp', 'ArrivedAtGate', 'OutForDelivery', 'Delivered', 'Cancelled']]
      }
    },
    cancellationReason: { type: DataTypes.STRING },
    paymentStatus: {
      type: DataTypes.ENUM('Pending', 'Completed', 'Failed'),
      defaultValue: 'Pending'
    },
    // New orders: 'COD' or 'Wallet' only (validated in createOrder). 'UPI'/'Card' stay for old rows.
    paymentMethod: {
      type: DataTypes.ENUM('COD', 'UPI', 'Card', 'Wallet'),
      allowNull: false
    },
    // Delivery slot (utils/deliverySlots): deliverySlot = "Tue 27 Oct, 12:30–1:00 PM" (older rows: 'ASAP'),
    // slotStart / slotEnd = the slot window. Null on orders placed before slots (and with the kill switch).
    deliverySlot: { type: DataTypes.STRING },
    slotStart: { type: DataTypes.DATE, allowNull: true },
    slotEnd: { type: DataTypes.DATE, allowNull: true },
    // When the 'orders.slotDispatch' job released a held-back slot order to riders (null = not yet / not needed).
    slotDispatchedAt: { type: DataTypes.DATE, allowNull: true },
    deliveryAddress: { type: DataTypes.TEXT },
    // Customer's delivery notes, e.g. ["Call on arrival", "No plastic cutlery"] (also kept in deliveryAddress for older rider apps)
    deliveryInstructions: { type: DataTypes.JSON, allowNull: true },
    distance: { type: DataTypes.FLOAT },
    // When the order was actually handed over (set by the Delivered flip). Older rows: null, readers fall back to updatedAt.
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    estDuration: { type: DataTypes.INTEGER },
    // Kitchen timestamps (restaurant partner app: real prep time + "ready by"). Null on older rows.
    acceptedAt: { type: DataTypes.DATE, allowNull: true },
    readyAt: { type: DataTypes.DATE, allowNull: true },
    // Who delivers: 'ZENVY' (rider pool) or 'VENDOR' (CampusBites stall delivers it itself: no rider,
    // no delivery PIN, COD to the stall). Older rows: null = 'ZENVY'.
    fulfilment: { type: DataTypes.STRING(16), allowNull: true, defaultValue: 'ZENVY' },
    // Stall orders: when the vendor left with the order (status OutForDelivery).
    outForDeliveryAt: { type: DataTypes.DATE, allowNull: true },
    // Stall orders still Accepted / OutForDelivery hours later: flagged once by utils/stallStuckJob.js
    // (admin + stall notified). Never auto-cancelled. Null = never flagged.
    stuckFlaggedAt: { type: DataTypes.DATE, allowNull: true },
    // Who cancelled: 'customer' | 'store' | 'support' | 'system' (auto-cancel jobs). Null on older rows.
    // Lets the partner apps say the right thing ("the customer cancelled" vs "Zenvy support cancelled").
    cancelledBy: { type: DataTypes.STRING(16), allowNull: true },
    // Client Idempotency-Key for POST /api/orders (unique per user, see config/db.js index), so a
    // retry after a restart or after minutes still returns the same order instead of a second one.
    idempotencyKey: { type: DataTypes.STRING(120), allowNull: true },
    // Customer's delivery pin (POST /api/orders coordinates). Sent to the ASSIGNED rider only (dropCoords). Null on older rows.
    dropLat: { type: DataTypes.FLOAT, allowNull: true },
    dropLng: { type: DataTypes.FLOAT, allowNull: true },
    isSurge: { type: DataTypes.BOOLEAN, defaultValue: false },
    hostelGateDelivery: { type: DataTypes.BOOLEAN, defaultValue: false },
    rating: { type: DataTypes.FLOAT },
    review: { type: DataTypes.TEXT },
    deliveryPin: { type: DataTypes.STRING },
    deliveryPinAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // wrong PINs entered by the rider
    upiUTR: { type: DataTypes.STRING },
    upiScreenshot: { type: DataTypes.TEXT },
    upiStatus: {
      type: DataTypes.ENUM('Pending', 'Verified', 'Rejected'),
      defaultValue: 'Pending'
    },
    proofImage: { type: DataTypes.TEXT },
    proofTimestamp: { type: DataTypes.DATE },
    payoutSettled: { type: DataTypes.BOOLEAN, defaultValue: false },
    riderPayoutSettled: { type: DataTypes.BOOLEAN, defaultValue: false },
    // C6 commission snapshot (utils/commission): taken from the store's rate when the order is created and
    // never recomputed. Null on orders settled before C6 (unsettled ones are backfilled once at startup).
    commissionRate: { type: DataTypes.FLOAT, allowNull: true },
    commissionType: { type: DataTypes.STRING(16), allowNull: true }, // percentage | flat
    commissionAmountPaise: { type: DataTypes.INTEGER, allowNull: true },
    storeNetPaise: { type: DataTypes.INTEGER, allowNull: true }, // item subtotal - commission
    commissionSource: { type: DataTypes.STRING(16), allowNull: true }, // order | backfill
    // Buy-at-store shop (utils/riderPurchase) at order time: the rider paid the shop at the counter, so the
    // shop is not paid out by Zenvy and the rider's cash ledger records what they paid. Null on older rows.
    storePaidByRider: { type: DataTypes.BOOLEAN, allowNull: true },
    // C6 payout statements this order is on (models/Payout). Null = not on any statement yet.
    payoutId: { type: DataTypes.UUID, allowNull: true },
    riderPayoutId: { type: DataTypes.UUID, allowNull: true },
    // C8 receipt (utils/receipts): number from the per-financial-year counter (ZNV/2026-27/000123), assigned
    // once when the order is Delivered and never changed (model hooks below refuse it). receiptSnapshot =
    // seller + platform details as they were at issue (the receipt never changes after that).
    receiptNumber: { type: DataTypes.STRING(40), allowNull: true },
    receiptIssuedAt: { type: DataTypes.DATE, allowNull: true },
    receiptSnapshot: { type: DataTypes.TEXT, allowNull: true },
    // Set once when an admin manual refund is credited (idempotency guard; nullable).
    refundedAt: { type: DataTypes.DATE, allowNull: true },
    
    // Mega Basket & Kirana pre-purchase approval properties
    isPurchasingApprovedByCustomer: { type: DataTypes.BOOLEAN, defaultValue: false },
    itemPhotoUrl: { type: DataTypes.TEXT },
    billProofUrl: { type: DataTypes.TEXT },
    billAmount: { type: DataTypes.FLOAT },
    isBillApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
    
    // Categories and multi-restaurant stops properties
    category: { type: DataTypes.STRING, defaultValue: 'Food' },
    isMultiRestaurant: { type: DataTypes.BOOLEAN, defaultValue: false },
    pickupStops: {
      type: DataTypes.JSON,
      defaultValue: [],
      get() {
        const rawValue = this.getDataValue('pickupStops');
        if (typeof rawValue === 'string') {
          try { return JSON.parse(rawValue); } catch { return []; }
        }
        return rawValue || [];
      }
    }
  }, { 
    timestamps: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
      { fields: ['restaurantId', 'createdAt'] }
    ],
    hooks: {
      beforeCreate: (order) => {
        if (sequelize.getDialect() === 'sqlite') {
          if (typeof order.items !== 'string') {
            order.items = JSON.stringify(order.items);
          }
          if (typeof order.pickupStops !== 'string') {
            order.pickupStops = JSON.stringify(order.pickupStops || []);
          }
        }
      },
      beforeUpdate: (order) => {
        if (sequelize.getDialect() === 'sqlite') {
          if (typeof order.items !== 'string') {
            order.items = JSON.stringify(order.items);
          }
          if (typeof order.pickupStops !== 'string') {
            order.pickupStops = JSON.stringify(order.pickupStops || []);
          }
        }
      }
    }
  });

  // C8: receipt fields are write-once. Only utils/receipts.assignReceiptNumber (option c8ReceiptAssign, which
  // also requires receiptNumber IS NULL in its WHERE) may set them; every other write that touches them fails.
  const RECEIPT_FIELDS = ['receiptNumber', 'receiptIssuedAt', 'receiptSnapshot'];
  Order.beforeUpdate((order, options) => {
    if (options && options.c8ReceiptAssign) return;
    for (const f of RECEIPT_FIELDS) {
      if (order.changed(f) && order.previous(f) !== null && order.previous(f) !== undefined) {
        throw new Error(`Order.${f} is immutable once a receipt is issued.`);
      }
    }
  });
  Order.beforeBulkUpdate((options) => {
    if (options && options.c8ReceiptAssign) return;
    const fields = Object.keys((options && options.attributes) || {});
    if (RECEIPT_FIELDS.some((f) => fields.includes(f))) {
      throw new Error('Order receipt fields can only be set by the receipt service.');
    }
  });
  // Delivered flips (rider / admin / stall paths all use a conditional static update by id) issue the
  // receipt number right after the flip commits. Fire-and-forget: GET /api/orders/:id/receipt assigns it
  // too if this ever fails.
  const scheduleReceipt = (ids, options) => {
    if (!ids.length) return;
    const run = () => setTimeout(() => {
      try {
        const receipts = require('../utils/receipts');
        for (const id of ids) receipts.assignReceiptNumber(id).catch((err) => console.warn('[RECEIPT_ASSIGN_WARN]', id, err.message));
      } catch (err) { console.warn('[RECEIPT_ASSIGN_WARN]', err.message); }
    });
    const t = options && options.transaction;
    if (t && typeof t.afterCommit === 'function') t.afterCommit(run); else run();
  };
  Order.afterBulkUpdate((options) => {
    if (!options || options.c8ReceiptAssign) return;
    const attrs = options.attributes || {};
    if (attrs.status !== 'Delivered') return;
    const w = options.where || {};
    const ids = typeof w.id === 'string' ? [w.id] : Array.isArray(w.id) ? w.id.filter((x) => typeof x === 'string').slice(0, 50) : [];
    scheduleReceipt(ids, options);
  });
  Order.afterUpdate((order, options) => {
    if (options && options.c8ReceiptAssign) return;
    if (order.changed('status') && order.status === 'Delivered' && !order.receiptNumber) scheduleReceipt([order.id], options);
  });

  orderNumbers.installNumbering(Order);

  return Order;
};

module.exports = { initOrderModel, getOrderModel: () => Order };
