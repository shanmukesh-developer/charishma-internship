const { DataTypes } = require('sequelize');

let PGBooking;

const initPGBookingModel = (sequelize) => {
  if (!sequelize) return null;

  PGBooking = sequelize.define('PGBooking', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    roomId: { type: DataTypes.UUID, allowNull: false },
    checkInDate: { type: DataTypes.DATE, allowNull: false },
    // 'Pending', 'Confirmed', 'Cancelled', 'Rejected' (declined by the PG owner), 'MovedOut' (utils/pgBookings.js)
    status: { type: DataTypes.STRING, defaultValue: 'Pending' },
    rentPaid: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Added for the ZCS PG Partner app (nullable; config/db.js addMissingColumns adds them on boot).
    // How long the student plans to stay (months, 1-24) and a short note to the PG (no phone numbers).
    durationMonths: { type: DataTypes.INTEGER, allowNull: true },
    note: { type: DataTypes.STRING(300), allowNull: true },
    // Owner / admin decision: the reason the student sees on a declined request, when and by whom.
    decisionReason: { type: DataTypes.STRING(300), allowNull: true },
    decidedAt: { type: DataTypes.DATE, allowNull: true },
    decidedBy: { type: DataTypes.STRING(64), allowNull: true },
    movedOutAt: { type: DataTypes.DATE, allowNull: true }
  }, { timestamps: true });

  return PGBooking;
};

module.exports = { initPGBookingModel, getPGBookingModel: () => PGBooking };
