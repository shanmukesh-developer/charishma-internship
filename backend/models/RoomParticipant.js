const { DataTypes } = require('sequelize');

let RoomParticipant;

const initRoomParticipantModel = (sequelize) => {
  if (!sequelize) return null;

  RoomParticipant = sequelize.define('RoomParticipant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    roomId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('admin', 'member'),
      defaultValue: 'member'
    },
    isMuted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['roomId', 'userId']
      }
    ]
  });

  return RoomParticipant;
};

module.exports = { initRoomParticipantModel, getRoomParticipantModel: () => RoomParticipant };
