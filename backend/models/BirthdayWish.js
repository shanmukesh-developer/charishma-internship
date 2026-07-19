const { DataTypes } = require('sequelize');

let BirthdayWish;

const initBirthdayWishModel = (sequelize) => {
  if (!sequelize) return null;

  BirthdayWish = sequelize.define('BirthdayWish', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    celebrationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    userName: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.STRING(255), allowNull: true }
  }, { 
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['celebrationId', 'userId']
      }
    ]
  });

  return BirthdayWish;
};

module.exports = { initBirthdayWishModel, getBirthdayWishModel: () => BirthdayWish };
