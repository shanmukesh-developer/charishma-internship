const { DataTypes } = require('sequelize');

let MegaBasket;

const initMegaBasketModel = (sequelize) => {
  if (!sequelize) return null;

  MegaBasket = sequelize.define('MegaBasket', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    deliveryPartnerId: { type: DataTypes.UUID },
    status: {
      type: DataTypes.ENUM(
        'Created',
        'PaidEstimate',
        'PartnerAssigned',
        'Shopping',
        'PriceApprovalPending',
        'Approved',
        'Purchased',
        'Delivering',
        'Delivered',
        'Cancelled'
      ),
      defaultValue: 'Created'
    },
    estimatedTotal: { type: DataTypes.FLOAT, allowNull: false },
    actualTotal: { type: DataTypes.FLOAT },
    shoppingFee: { type: DataTypes.FLOAT, defaultValue: 30 },
    deliveryFee: { type: DataTypes.FLOAT, defaultValue: 20 },
    deliveryAddress: { type: DataTypes.TEXT, allowNull: false },
    // Delivery slot (utils/deliverySlots), same fields as Order. Null on lists made before slots.
    deliverySlot: { type: DataTypes.STRING, allowNull: true },
    slotStart: { type: DataTypes.DATE, allowNull: true },
    slotEnd: { type: DataTypes.DATE, allowNull: true },
    deliveryPin: { type: DataTypes.STRING },
    deliveryPinAttempts: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 }, // wrong PINs by the rider
    upiUTR: { type: DataTypes.STRING },
    paymentStatus: {
      type: DataTypes.ENUM('Pending', 'Completed', 'Failed'),
      defaultValue: 'Pending'
    },
    // Client retry key (Idempotency-Key / body.idempotencyKey), unique per user (partial index in
    // config/sweepMigrations.js).
    idempotencyKey: { type: DataTypes.STRING(120), allowNull: true },
    paymentMethod: {
      type: DataTypes.ENUM('COD', 'UPI'),
      defaultValue: 'COD'
    }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] }
    ]
  });

  return MegaBasket;
};

module.exports = { initMegaBasketModel, getMegaBasketModel: () => MegaBasket };
