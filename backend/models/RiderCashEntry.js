const { DataTypes } = require('sequelize');

// C6 rider cash ledger: one row per change of the cash a rider is holding for Zenvy (COD collected at the
// door, cash paid to a buy-at-store shop, deposits handed over to Zenvy, admin adjustments). Written by
// utils/riderCash.applyCashChange inside the same transaction as the change (the delivery flip for
// COD_COLLECTED). Integer paise, signed: + the rider holds more, - less. balanceAfterPaise is
// DeliveryPartner.cashHeldPaise right after this row. This is NOT the rider wallet (tips, C5): cash and
// wallet credit never mix.
// Indexes (named, partial unique) are created by utils/riderCash.ensureRiderCashIndexes.
let RiderCashEntry;

const initRiderCashEntryModel = (sequelize) => {
  if (!sequelize) return null;
  RiderCashEntry = sequelize.define('RiderCashEntry', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    riderId: { type: DataTypes.STRING(64), allowNull: false },
    amountPaise: { type: DataTypes.INTEGER, allowNull: false },
    balanceAfterPaise: { type: DataTypes.INTEGER, allowNull: false },
    // COD_COLLECTED | STORE_PURCHASE | CASH_DEPOSITED | ADJUSTMENT
    type: { type: DataTypes.STRING(24), allowNull: false },
    orderId: { type: DataTypes.STRING(64), allowNull: true },
    // Deposits: 'cash' | 'upi' and the receipt / UTR reference.
    method: { type: DataTypes.STRING(16), allowNull: true },
    reference: { type: DataTypes.STRING(120), allowNull: true },
    actorType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'system' }, // system | admin | rider
    actorId: { type: DataTypes.STRING(64), allowNull: true },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(160), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'RiderCashEntries',
    timestamps: false,
  });
  return RiderCashEntry;
};

const getRiderCashEntryModel = () => RiderCashEntry;

module.exports = { initRiderCashEntryModel, getRiderCashEntryModel };
