const { DataTypes } = require('sequelize');

// Promotions on the PG list page (admin only; utils/pgContent.validatePromotion validates). Shown while
// isActive and startsAt <= now < endsAt, and only while the linked PG is listed. `label` is shown to
// students as-is ("Featured" or "Sponsored").
let PgPromotion;

const initPgPromotionModel = (sequelize) => {
  if (!sequelize) return null;

  PgPromotion = sequelize.define('PgPromotion', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    type: { type: DataTypes.STRING(8), allowNull: false }, // 'IMAGE' | 'VIDEO'
    imageUrl: { type: DataTypes.STRING(600), allowNull: true },
    youtubeId: { type: DataTypes.STRING(11), allowNull: true },
    headline: { type: DataTypes.STRING(40), allowNull: false },
    subline: { type: DataTypes.STRING(60), allowNull: true },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    cta: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'VIEW_PG' }, // VIEW_PG | WATCH_TOUR | BOOK_VISIT
    label: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'FEATURED' }, // FEATURED | SPONSORED
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: { type: DataTypes.UUID, allowNull: true }
  }, {
    timestamps: true,
    indexes: [{ name: 'pg_promotions_window', fields: ['isActive', 'endsAt'] }]
  });

  return PgPromotion;
};

module.exports = { initPgPromotionModel, getPgPromotionModel: () => PgPromotion };
