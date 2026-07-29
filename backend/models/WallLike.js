const { DataTypes } = require('sequelize');

let WallLike;

const initWallLikeModel = (sequelize) => {
  if (!sequelize) return null;

  WallLike = sequelize.define('WallLike', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    submissionId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['submissionId', 'userId'] }
    ]
  });

  return WallLike;
};

module.exports = { initWallLikeModel, getWallLikeModel: () => WallLike };
