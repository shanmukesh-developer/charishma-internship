const { DataTypes } = require('sequelize');

// One row per (RideTemplate, IST departure date) that was published. The unique index
// ride_template_runs_template_date is the exactly-once guard: a second process (or a re-run) that tries
// to publish the same date fails the insert and publishes nothing. reminderSentAt claims the
// 15-minutes-before push (conditional update, so it is sent once).
let RideTemplateRun;

const initRideTemplateRunModel = (sequelize) => {
  if (!sequelize) return null;
  RideTemplateRun = sequelize.define('RideTemplateRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId: { type: DataTypes.UUID, allowNull: false },
    creatorId: { type: DataTypes.UUID, allowNull: false },
    rideDate: { type: DataTypes.STRING(10), allowNull: false }, // 'YYYY-MM-DD' IST
    departureAt: { type: DataTypes.DATE, allowNull: false },
    poolId: { type: DataTypes.UUID, allowNull: true },
    reminderSentAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    timestamps: true,
    indexes: [
      { name: 'ride_template_runs_template_date', unique: true, fields: ['templateId', 'rideDate'] },
      { name: 'ride_template_runs_departure', fields: ['departureAt'] },
    ],
  });
  return RideTemplateRun;
};

module.exports = { initRideTemplateRunModel, getRideTemplateRunModel: () => RideTemplateRun };
