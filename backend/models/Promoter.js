const { DataTypes } = require('sequelize');

// Promoter attribution (owner, 5 Nov 2026: "Have a promo link. If they have more downloads from that link,
// then they will get paid. Rs 100 for every 200 downloads." + "trackable customisable referral id").
//   Promoter        one person who shares a link / code. `code` is 4-16 chars A-Z 0-9, stored upper case, unique.
//   PromoAttribution one row per device (deviceHash, HMAC of the app's device id; never the raw id) and at most
//                    one per account (userId). A row is a VERIFIED download once it has both a promoter and the
//                    NEW account that was created on that device (utils/promoAttribution decides). `source` says
//                    whether the credit came from the Play install link ('link') or a code typed at sign-up
//                    ('code'); one account / device is credited once ever, never both ways.
//   PromoPayout     money the owner paid a promoter (amount in rupees, date, note); due = earned - sum(payouts).
let Promoter;
let PromoAttribution;
let PromoPayout;

const initPromoterModels = (sequelize) => {
  if (!sequelize) return null;

  Promoter = sequelize.define('Promoter', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(16), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    phone: { type: DataTypes.STRING(15), allowNull: true },
    upiId: { type: DataTypes.STRING(80), allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    clickCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // GET /p/<CODE> redirects
    createdBy: { type: DataTypes.UUID, allowNull: true },
  }, { timestamps: true });

  PromoAttribution = sequelize.define('PromoAttribution', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    deviceHash: { type: DataTypes.STRING(64), allowNull: true, unique: true }, // null: an old app build typed a code
    rawReferrer: { type: DataTypes.STRING(300), allowNull: true }, // the Play install referrer as received
    referrerCode: { type: DataTypes.STRING(16), allowNull: true }, // utm_campaign of a real promoter (link installs)
    attributedAt: { type: DataTypes.DATE, allowNull: true }, // when POST /api/promo/attribute arrived
    promoterId: { type: DataTypes.UUID, allowNull: true },
    source: { type: DataTypes.STRING(8), allowNull: true }, // 'link' | 'code' (set when credited)
    userId: { type: DataTypes.UUID, allowNull: true, unique: true }, // the NEW account created on this device
    phoneHash: { type: DataTypes.STRING(64), allowNull: true }, // HMAC of the account's number (re-sign-up guard)
    signedUpAt: { type: DataTypes.DATE, allowNull: true },
    verifiedAt: { type: DataTypes.DATE, allowNull: true }, // set once credited to promoterId
  }, {
    timestamps: true,
    indexes: [
      { name: 'promo_attr_promoter_verified', fields: ['promoterId', 'verifiedAt'] },
      { name: 'promo_attr_phone', fields: ['phoneHash'] },
    ],
  });

  PromoPayout = sequelize.define('PromoPayout', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    promoterId: { type: DataTypes.UUID, allowNull: false },
    amount: { type: DataTypes.INTEGER, allowNull: false }, // whole rupees
    paidAt: { type: DataTypes.DATE, allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    adminId: { type: DataTypes.UUID, allowNull: true },
  }, { timestamps: true, indexes: [{ name: 'promo_payout_promoter', fields: ['promoterId'] }] });

  return { Promoter, PromoAttribution, PromoPayout };
};

module.exports = {
  initPromoterModels,
  getPromoterModel: () => Promoter,
  getPromoAttributionModel: () => PromoAttribution,
  getPromoPayoutModel: () => PromoPayout,
};
