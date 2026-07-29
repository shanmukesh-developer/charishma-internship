const { DataTypes } = require('sequelize');

let WallEvent;

const initWallEventModel = (sequelize) => {
  if (!sequelize) return null;

  WallEvent = sequelize.define('WallEvent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    startTime: { type: DataTypes.DATE, allowNull: false },
    endTime: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.ENUM('ACTIVE', 'ENDED'), defaultValue: 'ACTIVE' },
    couponCode: { type: DataTypes.STRING, allowNull: true },
    couponValue: { type: DataTypes.INTEGER, defaultValue: 100 },
    winnerUserId: { type: DataTypes.STRING, allowNull: true }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['status', 'endTime'] }
    ]
  });

  return WallEvent;
};

module.exports = { initWallEventModel, getWallEventModel: () => WallEvent };
