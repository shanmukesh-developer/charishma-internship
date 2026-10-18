const { DataTypes } = require('sequelize');

let PGHostel;

// Nullable JSON-in-TEXT column (null when never set).
const jsonCol = (name, fallback) => ({
  type: DataTypes.TEXT,
  allowNull: true,
  get() { const v = this.getDataValue(name); if (v === null || v === undefined || v === '') return fallback; try { return JSON.parse(v); } catch { return fallback; } },
  set(v) { this.setDataValue(name, v === null || v === undefined ? null : JSON.stringify(v)); }
});

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
      get() { const v = this.getDataValue('amenities'); try { return v ? JSON.parse(v) : []; } catch { return []; } },
      set(v) { this.setDataValue('amenities', JSON.stringify(v)); }
    },
    images: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() { const v = this.getDataValue('images'); try { return v ? JSON.parse(v) : []; } catch { return []; } },
      set(v) { this.setDataValue('images', JSON.stringify(v)); }
    },
    // Weekly mess menu: { Monday: { breakfast: '', lunch: '', dinner: '' }, ... }
    messMenu: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
      get() { const v = this.getDataValue('messMenu'); try { return v ? JSON.parse(v) : {}; } catch { return {}; } },
      set(v) { this.setDataValue('messMenu', JSON.stringify(v)); }
    },
    // Daily meal timings: { breakfast: { start, end }, lunch: {...}, dinner: {...} }
    foodTimetable: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
      get() { const v = this.getDataValue('foodTimetable'); try { return v ? JSON.parse(v) : {}; } catch { return {}; } },
      set(v) { this.setDataValue('foodTimetable', JSON.stringify(v)); }
    },
    // Array of rule strings
    rules: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() { const v = this.getDataValue('rules'); try { return v ? JSON.parse(v) : []; } catch { return []; } },
      set(v) { this.setDataValue('rules', JSON.stringify(v)); }
    },
    // { phone, email, ownerName, warden }
    contactInfo: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
      get() { const v = this.getDataValue('contactInfo'); try { return v ? JSON.parse(v) : {}; } catch { return {}; } },
      set(v) { this.setDataValue('contactInfo', JSON.stringify(v)); }
    },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    // Premium listing content (utils/pgContent.js validates every write; nullable, added at startup).
    // Gallery: [{ id, url, category, caption, order, roomType, isCover }] (max 20). `images` mirrors it.
    photos: jsonCol('photos', null),
    // Room tour videos on Zenvy's YouTube channel (admin only): [{ id, youtubeId, title, roomType, order }]
    videos: jsonCol('videos', null),
    // { meals: [{ key, label, start, end }], days: { mon: { <mealKey>: { menu, tag, start?, end? } } }, notes }
    messTimetable: jsonCol('messTimetable', null),
    // { gateOpen, gateClose, visitorFrom, visitorTo, checkIn, checkOut, quietFrom, quietTo, curfewNote }
    timings: jsonCol('timings', null),
    // Locality shown on list cards ("Neerukonda").
    area: { type: DataTypes.STRING(80), allowNull: true },
    // Set by the Zenvy housing team after a site visit.
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { timestamps: true });

  return PGHostel;
};

module.exports = { initPGHostelModel, getPGHostelModel: () => PGHostel };

