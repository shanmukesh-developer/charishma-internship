const { DataTypes } = require('sequelize');

let BirthdayCelebration;

const initBirthdayCelebrationModel = (sequelize) => {
  if (!sequelize) return null;

  BirthdayCelebration = sequelize.define('BirthdayCelebration', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    candidateName: { type: DataTypes.STRING, allowNull: false },
    candidatePhotoUrl: { type: DataTypes.TEXT, allowNull: true },
    birthdayDate: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'expired'), defaultValue: 'pending' },
    approvedBy: { type: DataTypes.STRING, allowNull: true },
    approvedAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    wishCount: { type: DataTypes.INTEGER, defaultValue: 0 }
  }, { timestamps: true });

  return BirthdayCelebration;
};

module.exports = { initBirthdayCelebrationModel, getBirthdayCelebrationModel: () => BirthdayCelebration };
