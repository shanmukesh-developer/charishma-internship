const { DataTypes } = require('sequelize');

let Friendship;

const initFriendshipModel = (sequelize) => {
  if (!sequelize) return null;

  Friendship = sequelize.define('Friendship', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    requesterId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    recipientId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'accepted', 'blocked'),
      defaultValue: 'pending'
    },
    streakCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastInteractionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    theme: {
      type: DataTypes.STRING,
      defaultValue: 'friendship'
    },
    nickname: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['requesterId', 'recipientId']
      }
    ]
  });

  return Friendship;
};

module.exports = { initFriendshipModel, getFriendshipModel: () => Friendship };
