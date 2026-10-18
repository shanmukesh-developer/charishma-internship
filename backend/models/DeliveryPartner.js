const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

let DeliveryPartner;

const initDeliveryPartnerModel = (sequelize) => {
  if (!sequelize) return null;

  DeliveryPartner = sequelize.define('DeliveryPartner', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    vehicleType: { type: DataTypes.STRING },
    vehicleNumber: { type: DataTypes.STRING },
    photoUrl: { type: DataTypes.TEXT },
    bio: { type: DataTypes.TEXT },
    emergencyContact: { type: DataTypes.STRING },
    liveLocation: { 
      type: DataTypes.TEXT, 
      defaultValue: '{"lat":null,"lng":null}',
      get() {
        const val = this.getDataValue('liveLocation');
        try { return val ? JSON.parse(val) : { lat: null, lng: null }; } catch { return { lat: null, lng: null }; }
      },
      set(val) { this.setDataValue('liveLocation', JSON.stringify(val)); }
    },
    isOnline: { type: DataTypes.BOOLEAN, defaultValue: false },
    isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
    walletBalance: { type: DataTypes.FLOAT, defaultValue: 0 },
    completedDeliveries: { type: DataTypes.INTEGER, defaultValue: 0 },
    currentOrderId: { type: DataTypes.UUID },
    totalEarnings: { type: DataTypes.FLOAT, defaultValue: 0 },
    // C6: cash this rider holds for Zenvy (COD collected minus deposits), integer paise. Changed only by
    // utils/riderCash.applyCashChange together with a RiderCashEntries row. Separate from walletBalance.
    cashHeldPaise: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    zenPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
    // null until the first real customer rating (new riders are not shown invented stars)
    averageRating: { type: DataTypes.FLOAT, allowNull: true, defaultValue: null },
    totalRatings: { type: DataTypes.INTEGER, defaultValue: 0 },
    fcmTokens: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('fcmTokens');
        try { return val ? JSON.parse(val) : []; } catch { return []; }
      },
      set(val) { this.setDataValue('fcmTokens', JSON.stringify(val)); }
    },
    isFcmActive: { type: DataTypes.BOOLEAN, defaultValue: false },
    isSosActive: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Last SOS from the rider app (POST /api/delivery/sos). Nullable; added by addMissingColumns.
    sosAt: { type: DataTypes.DATE, allowNull: true },
    sosLocation: { type: DataTypes.JSON, allowNull: true }, // { lat, lng, accuracy?, at?, stale? } at the time of the SOS
    // The rider's short note from the SOS sheet ("Accident", "Bike broke down", …). Cleared on resolve.
    sosNote: { type: DataTypes.STRING(200), allowNull: true },
    isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Bumped on every password change: sessions signed with an older `tv` are revoked.
    tokenVersion: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    // C4: Terms version accepted at sign-up (null for accounts created before C4, by the admin, or by older builds).
    termsAcceptedVersion: { type: DataTypes.STRING(20), allowNull: true },
    termsAcceptedAt: { type: DataTypes.DATE, allowNull: true },
    // C1-7: set when an APPROVED rider is deactivated by the admin (isApproved true -> false); cleared
    // on approval. While set the rider login is refused. New sign-ups waiting for approval are not
    // suspended (they still log in and see "waiting for approval"). Added on boot by addMissingColumns.
    suspendedAt: { type: DataTypes.DATE, allowNull: true },
    loginStreak: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastLoginDate: { type: DataTypes.DATEONLY, defaultValue: null }
  }, { 
    timestamps: true,
    indexes: [
      { fields: ['phone'] },
      { fields: ['isOnline'] }
    ]
  });

  const hashPassword = async (partner) => {
    if (partner.changed('password')) {
      partner.password = await bcrypt.hash(partner.password, 10);
    }
  };
  
  DeliveryPartner.beforeCreate(hashPassword);
  DeliveryPartner.beforeUpdate((partner) => {
    if (partner.changed('password') && partner.previous('password')) {
      partner.tokenVersion = (Number(partner.tokenVersion) || 0) + 1;
    }
  });
  DeliveryPartner.beforeUpdate(hashPassword);
  // Admin deactivation (C1-7): every session of the rider ends at once, and they go off duty.
  DeliveryPartner.beforeUpdate((partner) => {
    if (!partner.changed('isApproved')) return;
    if (partner.isApproved === false && partner.previous('isApproved') === true) {
      partner.suspendedAt = new Date();
      partner.tokenVersion = (Number(partner.tokenVersion) || 0) + 1;
      partner.isOnline = false;
    } else if (partner.isApproved === true && partner.suspendedAt) {
      partner.suspendedAt = null;
    }
  });
  DeliveryPartner.beforeBulkCreate(async (partners) => {
    for (const partner of partners) {
      partner.password = await bcrypt.hash(partner.password, 10);
    }
  });

  DeliveryPartner.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  return DeliveryPartner;
};

module.exports = { initDeliveryPartnerModel, getDeliveryPartnerModel: () => DeliveryPartner };
