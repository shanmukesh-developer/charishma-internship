const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

let Restaurant;

const initRestaurantModel = (sequelize) => {
  if (!sequelize) return null;

  Restaurant = sequelize.define('Restaurant', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    location: { type: DataTypes.STRING, allowNull: false },
    lat: { type: DataTypes.FLOAT },
    lon: { type: DataTypes.FLOAT },
    zone: { type: DataTypes.STRING, defaultValue: 'Amaravathi_Central' },
    imageUrl: { type: DataTypes.TEXT },
    vendorType: { type: DataTypes.STRING, defaultValue: 'RESTAURANT' },
    rating: { type: DataTypes.FLOAT, defaultValue: 0 },
    deliveryTime: { type: DataTypes.INTEGER },
    commissionRate: { type: DataTypes.FLOAT, defaultValue: 10 },
    commissionType: { type: DataTypes.STRING, defaultValue: 'percentage' },
    tags: { type: DataTypes.JSON, defaultValue: [] },
    operatingHours: { type: DataTypes.JSON, defaultValue: { start: '09:00', end: '22:00' } },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    isOffline: { type: DataTypes.BOOLEAN, defaultValue: false }, // For shops without a smartphone
    password: { type: DataTypes.STRING, allowNull: true }, // For restaurant portal login
    isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
    featuredUntil: { type: DataTypes.DATE, allowNull: true },
    featuredBadge: { type: DataTypes.STRING, allowNull: true, defaultValue: 'Sponsored' }
  }, { timestamps: true });

  const hashPassword = async (restaurant) => {
    if (restaurant.password && restaurant.changed('password')) {
      restaurant.password = await bcrypt.hash(restaurant.password, 10);
    }
  };

  Restaurant.beforeCreate(hashPassword);
  Restaurant.beforeUpdate(hashPassword);
  Restaurant.beforeBulkCreate(async (restaurants) => {
    for (const rest of restaurants) {
      if (rest.password) {
        rest.password = await bcrypt.hash(rest.password, 10);
      }
    }
  });

  Restaurant.prototype.comparePassword = async function(candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
  };

  return Restaurant;
};

module.exports = { initRestaurantModel, getRestaurantModel: () => Restaurant };
