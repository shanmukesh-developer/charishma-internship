const { DataTypes } = require('sequelize');

let VaultItem;

const initVaultItemModel = (sequelize) => {
  if (!sequelize) return null;

  VaultItem = sequelize.define('VaultItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    price: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    originalPrice: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    remainingCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    imageUrl: {
      // TEXT: uploaded images are stored as data URLs (longer than VARCHAR(255))
      type: DataTypes.TEXT
    },
    // Owner-only test row (utils/testView, scripts/test_data_v2_seed.js): hidden from every non-tester request.
    isTestData: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    resetAt: {
      type: DataTypes.DATE
    },
    streakRequirement: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // C1-4 (all nullable, added on boot by addMissingColumns): the store (and optionally the product)
    // the deal is for, and its own minimum order. A claimed coupon carries these and the order bill
    // (utils/orderPricing) enforces them. Deals without a store stay valid at any store, but always
    // with a minimum (minOrderValue, else the deal's original price).
    restaurantId: { type: DataTypes.UUID, allowNull: true },
    menuItemId: { type: DataTypes.UUID, allowNull: true },
    minOrderValue: { type: DataTypes.FLOAT, allowNull: true }
  }, { timestamps: true });

  return VaultItem;
};

const getVaultItemModel = () => VaultItem;

module.exports = { initVaultItemModel, getVaultItemModel };
