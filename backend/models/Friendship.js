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
