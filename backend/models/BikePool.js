const { DataTypes } = require('sequelize');

let BikePool;

const initBikePoolModel = (sequelize) => {
  if (!sequelize) return null;

  BikePool = sequelize.define('BikePool', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    creatorId: { type: DataTypes.UUID, allowNull: false },
    creatorRole: { type: DataTypes.STRING, allowNull: false }, // 'rider' or 'passenger'
    coRiderId: { type: DataTypes.UUID, allowNull: true }, // Legacy/1-to-1 fallback. Will use PoolRequests for many.
    origin: { type: DataTypes.STRING, allowNull: false },
    destination: { type: DataTypes.STRING, allowNull: false },
    departureTime: { type: DataTypes.DATE, allowNull: false },
    estimatedFuelCost: { type: DataTypes.FLOAT, defaultValue: 0 },
    splitAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
    vehicleType: { type: DataTypes.STRING, defaultValue: 'Bike' }, // 'Bike', 'Car', 'Auto'
    availableSeats: { type: DataTypes.INTEGER, defaultValue: 1 },
    autoApprove: { type: DataTypes.BOOLEAN, defaultValue: false },
    stopovers: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('stopovers');
        return val ? JSON.parse(val) : [];
      },
      set(val) {
        this.setDataValue('stopovers', JSON.stringify(val));
      }
    },
    vehicleInfo: { type: DataTypes.STRING, allowNull: true },
    genderPreference: { type: DataTypes.STRING, defaultValue: 'Any' }, // 'Any', 'Same Gender Only'
    rideVibe: { type: DataTypes.STRING, defaultValue: 'Any' }, // 'Any', 'Silent', 'Chatty', 'Music'
    status: { type: DataTypes.STRING, defaultValue: 'Available' }, // 'Available', 'Matched', 'Completed', 'Cancelled'
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'Unpaid' }, // 'Unpaid', 'Paid'
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, { timestamps: true });

  return BikePool;
};

module.exports = { initBikePoolModel, getBikePoolModel: () => BikePool };
