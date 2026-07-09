const { DataTypes } = require('sequelize');

let MegaBasketItem;

const initMegaBasketItemModel = (sequelize) => {
  if (!sequelize) return null;

  MegaBasketItem = sequelize.define('MegaBasketItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    basketId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.INTEGER, defaultValue: 1 },
    unit: { type: DataTypes.STRING, defaultValue: 'pcs' },
    priceEstimated: { type: DataTypes.FLOAT, defaultValue: 0 },
    priceActual: { type: DataTypes.FLOAT },
    status: {
      type: DataTypes.ENUM('Pending', 'Approved', 'Purchased', 'Unavailable'),
      defaultValue: 'Pending'
    },
    photoProofUrl: { type: DataTypes.TEXT }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['basketId'] },
      { fields: ['status'] }
    ]
  });

  return MegaBasketItem;
};

module.exports = { initMegaBasketItemModel, getMegaBasketItemModel: () => MegaBasketItem };
