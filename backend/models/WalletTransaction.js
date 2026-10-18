const { DataTypes } = require('sequelize');

// C5 wallet ledger: one row per change of a User / DeliveryPartner walletBalance, written by
// utils/walletLedger.applyWalletChange inside the same transaction as the balance change.
// Amounts are integer paise (signed: + credit, - debit); balanceAfterPaise is the owner's balance
// right after this row. The FLOAT walletBalance columns stay the balance of record for old code.
// Indexes (named, partial unique) are created by utils/walletLedger.ensureWalletLedgerIndexes.
let WalletTransaction;

const initWalletTransactionModel = (sequelize) => {
  if (!sequelize) return null;
  WalletTransaction = sequelize.define('WalletTransaction', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    ownerType: { type: DataTypes.STRING(8), allowNull: false }, // 'user' | 'rider'
    ownerId: { type: DataTypes.STRING(64), allowNull: false },
    amountPaise: { type: DataTypes.INTEGER, allowNull: false },
    balanceAfterPaise: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING(32), allowNull: false },
    refType: { type: DataTypes.STRING(32), allowNull: true },
    refId: { type: DataTypes.STRING(64), allowNull: true },
    actorType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'system' }, // system | admin | user | rider
    actorId: { type: DataTypes.STRING(64), allowNull: true },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(160), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'WalletTransactions',
    timestamps: false,
  });
  return WalletTransaction;
};

const getWalletTransactionModel = () => WalletTransaction;

module.exports = { initWalletTransactionModel, getWalletTransactionModel };
