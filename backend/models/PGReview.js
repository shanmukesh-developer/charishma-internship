const { DataTypes } = require('sequelize');

// Reviews of a PG by students who stayed there: one per confirmed booking whose check-in date has
// arrived (routes/pgRoutes.js checks eligibility). `firstName` is a snapshot so the public read needs
// no join and never exposes the account. Admins can hide a review (audited); students can report one.
let PGReview;

const initPGReviewModel = (sequelize) => {
  if (!sequelize) return null;

  PGReview = sequelize.define('PGReview', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    bookingId: { type: DataTypes.UUID, allowNull: false },
    rating: { type: DataTypes.INTEGER, allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    firstName: { type: DataTypes.STRING(24), allowNull: true },
    // 'visible' | 'hidden'
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'visible' },
    hiddenReason: { type: DataTypes.STRING(200), allowNull: true },
    // [{ userId, reason, at }] (one per reporter)
    reports: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() { const v = this.getDataValue('reports'); try { const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a : []; } catch { return []; } },
      set(v) { this.setDataValue('reports', JSON.stringify(Array.isArray(v) ? v : [])); }
    },
    reportCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    timestamps: true,
    indexes: [
      { name: 'pg_reviews_booking_unique', unique: true, fields: ['bookingId'] },
      { name: 'pg_reviews_hostel_status', fields: ['hostelId', 'status'] },
    ]
  });

  return PGReview;
};

module.exports = { initPGReviewModel, getPGReviewModel: () => PGReview };
