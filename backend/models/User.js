const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

let User;

const initUserModel = (sequelize) => {
  if (!sequelize) return null;

  User = sequelize.define('User', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: true, unique: true },
    googleId: { type: DataTypes.STRING, allowNull: true, unique: true },
    phone: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    hostelBlock: { type: DataTypes.STRING, allowNull: true },
    roomNumber: { type: DataTypes.STRING, allowNull: true },
    walletBalance: { type: DataTypes.FLOAT, defaultValue: 0 },
    streakCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastOrderDate: { type: DataTypes.DATE },
    totalOrders: { type: DataTypes.INTEGER, defaultValue: 0 },
    completedOrders: { type: DataTypes.INTEGER, defaultValue: 0 },
    spinsUsed: { type: DataTypes.INTEGER, defaultValue: 0 },
    role: { type: DataTypes.STRING, defaultValue: 'student' },
    zenPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
    isElite: { type: DataTypes.BOOLEAN, defaultValue: false },
    address: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, defaultValue: 'Amaravathi' },
    profileImage: { type: DataTypes.TEXT, allowNull: true },
    fcmTokens: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('fcmTokens');
        return val ? JSON.parse(val) : [];
      },
      set(val) {
        this.setDataValue('fcmTokens', JSON.stringify(val));
      }
    },
    badges: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('badges');
        return val ? JSON.parse(val) : [];
      },
      set(val) {
        this.setDataValue('badges', JSON.stringify(val));
      }
    },
    dietaryPreference: { type: DataTypes.STRING, defaultValue: 'None' }, // Veg, Jain, Eggless, etc.
    lateNightOrders: { type: DataTypes.INTEGER, defaultValue: 0 },
    // F1: Referral System
    referralCode: { type: DataTypes.STRING(10), unique: true, allowNull: true },
    referredBy: { type: DataTypes.STRING(10), allowNull: true },
    referralCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    referralRewardClaimed: { type: DataTypes.BOOLEAN, defaultValue: false },
    // F13: Elite Gifting
    eliteGiftsUsedThisMonth: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastGiftResetDate: { type: DataTypes.DATE, allowNull: true },
    // Co-Ride Bike Pooling
    gender: { type: DataTypes.STRING, defaultValue: 'Prefer not to say' },
    genderPreference: { type: DataTypes.STRING, defaultValue: 'Any' }
  }, { timestamps: true });

  // Auto-generate referral code
  const generateReferralCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'ZV-' + code;
  };

  const hashPassword = async (user) => {
    if (user.changed('password')) {
      user.password = await bcrypt.hash(user.password, 10);
    }
  };

  User.beforeCreate(async (user) => {
    await hashPassword(user);
    if (!user.referralCode) {
      user.referralCode = generateReferralCode();
    }
  });
  User.beforeUpdate(hashPassword);
  User.beforeBulkCreate(async (users) => {
    for (const user of users) {
      user.password = await bcrypt.hash(user.password, 10);
      if (!user.referralCode) {
        user.referralCode = generateReferralCode();
      }
    }
  });


  User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  return User;
};

module.exports = { initUserModel, getUserModel: () => User };
