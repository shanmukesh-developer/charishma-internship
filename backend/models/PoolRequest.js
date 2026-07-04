const { DataTypes } = require('sequelize');

let PoolRequest;

const initPoolRequestModel = (sequelize) => {
  if (!sequelize) return null;

  PoolRequest = sequelize.define('PoolRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    poolId: { type: DataTypes.UUID, allowNull: false },
    passengerId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'Pending' }, // 'Pending', 'Approved', 'Rejected'
  }, { timestamps: true });

  return PoolRequest;
};

module.exports = { initPoolRequestModel, getPoolRequestModel: () => PoolRequest };
