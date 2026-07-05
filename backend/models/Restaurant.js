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
    tags: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('tags');
        try { return val ? JSON.parse(val) : []; } catch { return []; }
      },
      set(val) { this.setDataValue('tags', JSON.stringify(val)); }
    },
    operatingHours: { 
      type: DataTypes.TEXT, 
      defaultValue: '{"start":"09:00","end":"22:00"}',
      get() {
        const val = this.getDataValue('operatingHours');
        try { return val ? JSON.parse(val) : { start: '09:00', end: '22:00' }; } catch { return { start: '09:00', end: '22:00' }; }
      },
      set(val) { this.setDataValue('operatingHours', JSON.stringify(val)); }
    },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    isOffline: { type: DataTypes.BOOLEAN, defaultValue: false }, // For shops without a smartphone
    password: { type: DataTypes.STRING, allowNull: true }, // For restaurant portal login
    isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
    featuredUntil: { type: DataTypes.DATE, allowNull: true },
    featuredBadge: { type: DataTypes.STRING, allowNull: true, defaultValue: 'Sponsored' },
    // ── CampusBites: Local Vendor Fields ──────────────────────
    campus: { type: DataTypes.STRING, allowNull: true }, // e.g. 'SRM', 'VIT', 'KLU'
    isOpenNow: { type: DataTypes.BOOLEAN, defaultValue: true },
    whatsappNumber: { type: DataTypes.STRING, allowNull: true },
    subscriptionTier: { type: DataTypes.STRING, defaultValue: 'free' }, // 'free' or 'premium'
    stallDescription: { type: DataTypes.TEXT, allowNull: true },
    promoOffer: { type: DataTypes.STRING, allowNull: true }, // e.g. 'Buy 2 Get 1 Free'
    clickCount: { type: DataTypes.INTEGER, defaultValue: 0 }
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
