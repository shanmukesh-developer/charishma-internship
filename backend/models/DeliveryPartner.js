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
    currentOrderId: { type: DataTypes.UUID },
    totalEarnings: { type: DataTypes.FLOAT, defaultValue: 0 },
    zenPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
    averageRating: { type: DataTypes.FLOAT, defaultValue: 5 },
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
    isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
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
  DeliveryPartner.beforeUpdate(hashPassword);
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
