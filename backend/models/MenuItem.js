const { DataTypes } = require('sequelize');

let MenuItem;

const initMenuItemModel = (sequelize) => {
  if (!sequelize) return null;

  MenuItem = sequelize.define('MenuItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    restaurantId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    description: { type: DataTypes.TEXT },
    imageUrl: { type: DataTypes.TEXT },
    category: { type: DataTypes.STRING },
    tags: { type: DataTypes.JSON, defaultValue: [] },
    isVegetarian: { type: DataTypes.BOOLEAN, defaultValue: true },
    isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
    outOfStockUntil: { type: DataTypes.DATE, allowNull: true },
    isEliteOnly: { type: DataTypes.BOOLEAN, defaultValue: false },
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
