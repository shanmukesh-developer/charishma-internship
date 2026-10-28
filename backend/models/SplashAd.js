const { DataTypes } = require('sequelize');

// Full-screen ads the customer app shows right after its intro (admin only; utils/splashAds validates).
// Each ad promotes one real store and uses one of the 8 interactive styles (utils/splashAds.STYLES).
// Served by GET /api/ads/splash while isActive, startsAt <= now < endsAt (null = open-ended) and the store
// is listed. At most one ACTIVE ad per style (partial unique index below + a 409 in the admin routes), so
// at most 8 run at once.
let SplashAd;

const initSplashAdModel = (sequelize) => {
  if (!sequelize) return null;

  SplashAd = sequelize.define('SplashAd', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    restaurantId: { type: DataTypes.UUID, allowNull: false },
    style: { type: DataTypes.STRING(16), allowNull: false }, // tear | scratch | envelope | gift | glass | coupon | portal | peel
    offerText: { type: DataTypes.STRING(24), allowNull: false }, // "20% OFF"
    headline: { type: DataTypes.STRING(60), allowNull: false }, // may hold one line break
    subline: { type: DataTypes.STRING(90), allowNull: true },
    bannerText: { type: DataTypes.STRING(40), allowNull: true }, // "Sponsored" strip on Home
    imageUrl: { type: DataTypes.TEXT, allowNull: false },
    colorA: { type: DataTypes.STRING(7), allowNull: false, defaultValue: '#7d2c12' },
    colorB: { type: DataTypes.STRING(7), allowNull: false, defaultValue: '#120805' },
    startsAt: { type: DataTypes.DATE, allowNull: true },
    endsAt: { type: DataTypes.DATE, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdBy: { type: DataTypes.UUID, allowNull: true }
  }, {
    timestamps: true,
    indexes: [
      { name: 'splash_ads_active', fields: ['isActive', 'priority'] },
      // One active ad per style (race guard for two admins saving at once; the route checks first).
      { name: 'splash_ads_active_style', unique: true, fields: ['style'], where: { isActive: true } }
    ]
  });

  return SplashAd;
};

module.exports = { initSplashAdModel, getSplashAdModel: () => SplashAd };
