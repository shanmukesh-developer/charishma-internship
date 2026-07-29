const { DataTypes } = require('sequelize');

let WallSubmission;

const initWallSubmissionModel = (sequelize) => {
  if (!sequelize) return null;

  WallSubmission = sequelize.define('WallSubmission', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    eventId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    imageUrl: { type: DataTypes.TEXT, allowNull: false },
    likeCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    isApproved: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['eventId', 'userId'] },
      { fields: ['eventId', 'likeCount'] }
    ]
  });

  return WallSubmission;
};

module.exports = { initWallSubmissionModel, getWallSubmissionModel: () => WallSubmission };
