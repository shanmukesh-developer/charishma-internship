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
    status: { type: DataTypes.STRING, defaultValue: 'Pending' }, // 'Pending', 'Confirmed', 'Cancelled'
    rentPaid: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { timestamps: true });

  return PGBooking;
};

module.exports = { initPGBookingModel, getPGBookingModel: () => PGBooking };
