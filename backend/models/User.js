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
    lateNightOrders: { type: DataTypes.INTEGER, defaultValue: 0 }
  }, { timestamps: true });

  const hashPassword = async (user) => {
    if (user.changed('password')) {
      user.password = await bcrypt.hash(user.password, 10);
    }
  };

  User.beforeCreate(hashPassword);
  User.beforeUpdate(hashPassword);
  User.beforeBulkCreate(async (users) => {
    for (const user of users) {
      user.password = await bcrypt.hash(user.password, 10);
    }
  });

  User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  return User;
};

module.exports = { initUserModel, getUserModel: () => User };
