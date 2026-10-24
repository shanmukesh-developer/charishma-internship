const { DataTypes } = require('sequelize');

// Co-Ride regular rides: a host's saved weekly ride. jobs/index.js 'coride.templates' publishes a normal
// BikePool ride from it ~150 minutes before each departure (services/coRideTemplates.js). One publish per
// (template, IST date), guarded by the RideTemplateRuns unique index.
let RideTemplate;

const jsonList = (field) => ({
  type: DataTypes.TEXT,
  defaultValue: '[]',
  get() {
    const raw = this.getDataValue(field);
    try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
  },
  set(val) {
    this.setDataValue(field, JSON.stringify(Array.isArray(val) ? val : []));
  },
});

const initRideTemplateModel = (sequelize) => {
  if (!sequelize) return null;
  RideTemplate = sequelize.define('RideTemplate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    creatorId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(60), allowNull: false },
    origin: { type: DataTypes.STRING(120), allowNull: false },
    destination: { type: DataTypes.STRING(120), allowNull: false },
    days: jsonList('days'), // weekdays 0 (Sunday) .. 6 (Saturday), IST
    time: { type: DataTypes.STRING(5), allowNull: false }, // 'HH:MM' Asia/Kolkata
    vehicleType: { type: DataTypes.STRING(10), defaultValue: 'Bike' }, // 'Bike' | 'Car'
    seats: { type: DataTypes.INTEGER, defaultValue: 1 }, // Bike 1, Car 1..4
    estimatedFuelCost: { type: DataTypes.FLOAT, defaultValue: 0 }, // same field / range as BikePool
    rideVibe: { type: DataTypes.STRING(30), defaultValue: 'Any' },
    notes: { type: DataTypes.TEXT, allowNull: true },
    vehicleInfo: { type: DataTypes.STRING(120), allowNull: true },
    autoApprove: { type: DataTypes.BOOLEAN, defaultValue: false },
    autoAcceptKnown: { type: DataTypes.BOOLEAN, defaultValue: false },
    womenOnly: { type: DataTypes.BOOLEAN, defaultValue: false },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    skipDates: jsonList('skipDates'), // ['YYYY-MM-DD'] IST dates not to publish
    lastPublishedDate: { type: DataTypes.STRING(10), allowNull: true },
  }, {
    timestamps: true,
    indexes: [{ name: 'ride_templates_creator', fields: ['creatorId'] }, { name: 'ride_templates_active', fields: ['active'] }],
  });
  return RideTemplate;
};

module.exports = { initRideTemplateModel, getRideTemplateModel: () => RideTemplate };
