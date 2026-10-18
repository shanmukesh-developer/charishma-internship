const { DataTypes } = require('sequelize');

// C8 receipt number counters: one row per series (e.g. 'ZNV/2026-27'). utils/receipts increments it inside
// the same transaction that writes Order.receiptNumber, so numbers are unique, sequential and gap-free (a
// lost race rolls the increment back).
let ReceiptCounter;

const initReceiptCounterModel = (sequelize) => {
  if (!sequelize) return null;
  ReceiptCounter = sequelize.define('ReceiptCounter', {
    series: { type: DataTypes.STRING(40), primaryKey: true },
    lastNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { timestamps: true });
  return ReceiptCounter;
};

module.exports = { initReceiptCounterModel, getReceiptCounterModel: () => ReceiptCounter };
