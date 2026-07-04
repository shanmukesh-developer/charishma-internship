const { DataTypes } = require('sequelize');

let PGHostel;

const initPGHostelModel = (sequelize) => {
  if (!sequelize) return null;

  PGHostel = sequelize.define('PGHostel', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    ownerId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    address: { type: DataTypes.STRING, allowNull: false },
    distanceFromCollege: { type: DataTypes.FLOAT, allowNull: false }, // in KM
    genderType: { type: DataTypes.STRING, defaultValue: 'Co-ed' }, // 'Boys', 'Girls', 'Co-ed'
    baseRent: { type: DataTypes.FLOAT, allowNull: false }, // Minimum rent
    securityDeposit: { type: DataTypes.FLOAT, defaultValue: 0 },
    totalRooms: { type: DataTypes.INTEGER, defaultValue: 0 },
    amenities: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() { const v = this.getDataValue('amenities'); return v ? JSON.parse(v) : []; },
      set(v) { this.setDataValue('amenities', JSON.stringify(v)); }
    },
    images: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() { const v = this.getDataValue('images'); return v ? JSON.parse(v) : []; },
      set(v) { this.setDataValue('images', JSON.stringify(v)); }
    },
    // Weekly mess menu: { Monday: { breakfast: '', lunch: '', dinner: '' }, ... }
    messMenu: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
      get() { const v = this.getDataValue('messMenu'); return v ? JSON.parse(v) : {}; },
      set(v) { this.setDataValue('messMenu', JSON.stringify(v)); }
    },
    // Daily meal timings: { breakfast: { start, end }, lunch: {...}, dinner: {...} }
    foodTimetable: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
      get() { const v = this.getDataValue('foodTimetable'); return v ? JSON.parse(v) : {}; },
      set(v) { this.setDataValue('foodTimetable', JSON.stringify(v)); }
    },
    // Array of rule strings
    rules: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() { const v = this.getDataValue('rules'); return v ? JSON.parse(v) : []; },
      set(v) { this.setDataValue('rules', JSON.stringify(v)); }
    },
    // { phone, email, ownerName, warden }
    contactInfo: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
      get() { const v = this.getDataValue('contactInfo'); return v ? JSON.parse(v) : {}; },
      set(v) { this.setDataValue('contactInfo', JSON.stringify(v)); }
    },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    description: { type: DataTypes.TEXT, allowNull: true }
  }, { timestamps: true });

  return PGHostel;
};

module.exports = { initPGHostelModel, getPGHostelModel: () => PGHostel };

