const { DataTypes } = require('sequelize');

// C6 payout records: one statement per partner and period (restaurant | vendor | rider). Generated from
// the orders not yet on any statement (Order.payoutId / Order.riderPayoutId point back here), then marked
// PAID with the bank / UPI reference (UTR), or CANCELLED (its orders are released again).
// Amounts are integer paise. netPaise = grossPaise - commissionPaise + adjustmentsPaise + tipsPaise and
// can be negative for a stall that already holds the customers' cash (it owes Zenvy the commission).
let Payout;

const initPayoutModel = (sequelize) => {
  if (!sequelize) return null;
  Payout = sequelize.define('Payout', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    partnerType: { type: DataTypes.STRING(16), allowNull: false }, // restaurant | vendor | rider
    partnerId: { type: DataTypes.STRING(64), allowNull: false },
    partnerName: { type: DataTypes.STRING(255), allowNull: true }, // at the time of the statement
    periodStart: { type: DataTypes.DATE, allowNull: true },
    periodEnd: { type: DataTypes.DATE, allowNull: false },
    orderCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    orderIds: { type: DataTypes.JSON, allowNull: true },
    grossPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    commissionPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    adjustmentsPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    tipsPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    netPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Per-part explanation shown on the statement (e.g. cash a stall collected itself).
    breakdown: { type: DataTypes.JSON, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'PENDING' }, // PENDING | PAID | CANCELLED
    method: { type: DataTypes.STRING(16), allowNull: true }, // bank | upi | cash | other
    utr: { type: DataTypes.STRING(120), allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    paidBy: { type: DataTypes.STRING(64), allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledBy: { type: DataTypes.STRING(64), allowNull: true },
    notes: { type: DataTypes.STRING(1000), allowNull: true },
  }, {
    tableName: 'Payouts',
    timestamps: true,
    indexes: [
      { fields: ['partnerType', 'partnerId', 'createdAt'] },
      { fields: ['status'] },
    ],
  });
  return Payout;
};

const getPayoutModel = () => Payout;

module.exports = { initPayoutModel, getPayoutModel };
