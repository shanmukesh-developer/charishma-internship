const { DataTypes } = require('sequelize');

let Room;

const initRoomModel = (sequelize) => {
  if (!sequelize) return null;

  Room = sequelize.define('Room', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    adminId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    joinCode: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true // If quiet for X hours, this gets updated by a cron job or just an archive field
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    timestamps: true
  });

  return Room;
};

module.exports = { initRoomModel, getRoomModel: () => Room };
