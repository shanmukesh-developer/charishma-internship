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
    deliveryPin: { type: DataTypes.STRING },
    upiUTR: { type: DataTypes.STRING },
    paymentStatus: {
      type: DataTypes.ENUM('Pending', 'Completed', 'Failed'),
      defaultValue: 'Pending'
    },
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
