const { DataTypes } = require('sequelize');

let Order;

const initOrderModel = (sequelize) => {
  if (!sequelize) return null;

  Order = sequelize.define('Order', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
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
    batchDiscount: { type: DataTypes.FLOAT, defaultValue: 0 },
    gateDiscount: { type: DataTypes.FLOAT, defaultValue: 0 },
    finalPrice: { type: DataTypes.FLOAT, allowNull: false },
    // Server-computed bill shown to the customer: { subtotal, deliveryFee, packagingFee, taxes, discounts[], totalDiscount, finalPrice, couponCode }
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
    deliverySlot: { type: DataTypes.STRING },
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

  return Order;
};

module.exports = { initOrderModel, getOrderModel: () => Order };
