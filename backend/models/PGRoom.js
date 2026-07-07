const { DataTypes } = require('sequelize');

let PGRoom;

const initPGRoomModel = (sequelize) => {
  if (!sequelize) return null;

  PGRoom = sequelize.define('PGRoom', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    roomNumber: { type: DataTypes.STRING, allowNull: false },
    sharingType: { type: DataTypes.INTEGER, allowNull: false }, // 1, 2, 3, 4 (seater)
    pricePerBed: { type: DataTypes.FLOAT, allowNull: false },
    totalBeds: { type: DataTypes.INTEGER, allowNull: false },
    availableBeds: { type: DataTypes.INTEGER, allowNull: false },
    floorNumber: { type: DataTypes.INTEGER, defaultValue: 1 },
    hasAttachedBathroom: { type: DataTypes.BOOLEAN, defaultValue: true },
    hasAC: { type: DataTypes.BOOLEAN, defaultValue: false },
    hasBalcony: { type: DataTypes.BOOLEAN, defaultValue: false },
    furnishing: { type: DataTypes.STRING, defaultValue: 'Fully Furnished' }, // 'Fully Furnished', 'Semi Furnished', 'Unfurnished'
    images: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() { const v = this.getDataValue('images'); return v ? JSON.parse(v) : []; },
      set(v) { this.setDataValue('images', JSON.stringify(v)); }
    },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { timestamps: true });

  return PGRoom;
};

module.exports = { initPGRoomModel, getPGRoomModel: () => PGRoom };

