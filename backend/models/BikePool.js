const { DataTypes } = require('sequelize');

let BikePool;

const initBikePoolModel = (sequelize) => {
  if (!sequelize) return null;

  BikePool = sequelize.define('BikePool', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    creatorId: { type: DataTypes.UUID, allowNull: false },
    creatorRole: { type: DataTypes.STRING, allowNull: false }, // 'rider' or 'passenger'
    coRiderId: { type: DataTypes.UUID, allowNull: true },
    origin: { type: DataTypes.STRING, allowNull: false },
    destination: { type: DataTypes.STRING, allowNull: false },
    departureTime: { type: DataTypes.DATE, allowNull: false },
    estimatedFuelCost: { type: DataTypes.FLOAT, defaultValue: 0 },
    splitAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
    vehicleInfo: { type: DataTypes.STRING, allowNull: true },
    genderPreference: { type: DataTypes.STRING, defaultValue: 'Any' }, // 'Any', 'Same Gender Only'
    status: { type: DataTypes.STRING, defaultValue: 'Available' }, // 'Available', 'Matched', 'Completed', 'Cancelled'
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'Unpaid' }, // 'Unpaid', 'Paid'
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, { timestamps: true });

  return BikePool;
};

module.exports = { initBikePoolModel, getBikePoolModel: () => BikePool };
