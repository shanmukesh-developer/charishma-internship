const { DataTypes } = require('sequelize');

let MenuItem;

const initMenuItemModel = (sequelize) => {
  if (!sequelize) return null;

  MenuItem = sequelize.define('MenuItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Owner-only test row (utils/testView, scripts/test_data_v2_seed.js): hidden from every non-tester request.
    isTestData: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    restaurantId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    description: { type: DataTypes.TEXT },
    imageUrl: { type: DataTypes.TEXT },
    category: { type: DataTypes.STRING },
    tags: { type: DataTypes.JSON, defaultValue: [] },
    isVegetarian: { type: DataTypes.BOOLEAN, defaultValue: true },
    // 'veg' | 'nonveg' | 'egg'. Null on older rows: readers fall back to isVegetarian.
    dietType: { type: DataTypes.STRING(8), allowNull: true },
    // MRP / original price shown struck through (>= price). Null = no MRP.
    originalPrice: { type: DataTypes.FLOAT, allowNull: true },
    isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
    outOfStockUntil: { type: DataTypes.DATE, allowNull: true },
    isEliteOnly: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Specialized cake (custom / designer): booking closes 2½ hours before the delivery slot instead of the
    // 2 hours of a normal cake (utils/deliverySlots). Switched on by the store or an admin.
    isSpecializedCake: { type: DataTypes.BOOLEAN, defaultValue: false },
    customCommission: { type: DataTypes.FLOAT },
    specs: { type: DataTypes.JSON, defaultValue: {} },
    ownerName: { type: DataTypes.STRING },
    ownerPhone: { type: DataTypes.STRING }
  }, { 
    timestamps: true,
    indexes: [
      { fields: ['restaurantId'] },
      { fields: ['category'] }
    ]
  });

  return MenuItem;
};

module.exports = { initMenuItemModel, getMenuItemModel: () => MenuItem };
