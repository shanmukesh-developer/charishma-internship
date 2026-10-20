const { DataTypes } = require('sequelize');

// One row per catalogue entry (store or item) that the startup importer has EVER created.
// The importer only creates rows whose importKey is not in this ledger, so anything the
// owner later edits or deletes in the admin dashboard is never re-created or overwritten.
let CatalogueImportLedger;

const initCatalogueImportLedgerModel = (sequelize) => {
  if (!sequelize) return null;

  CatalogueImportLedger = sequelize.define('CatalogueImportLedger', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    importKey: { type: DataTypes.STRING, allowNull: false, unique: true },
    // 'store' | 'item' (catalogue_import) | 'demo-item' | 'demo-skip' (demo_menu_fill_import; a skip's targetId points at nothing)
    kind: { type: DataTypes.STRING, allowNull: false },
    targetId: { type: DataTypes.UUID, allowNull: false }, // Restaurant.id or MenuItem.id
    storeKey: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: true },
    // Ids the old app builds used for this product (e.g. 'groc-1', 'extra-candles'),
    // so orders from not-yet-updated phones can still be priced from the DB.
    legacyIds: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('legacyIds');
        try { return val ? JSON.parse(val) : []; } catch { return []; }
      },
      set(val) { this.setDataValue('legacyIds', JSON.stringify(Array.isArray(val) ? val : [])); }
    }
  }, {
    timestamps: true,
    indexes: [{ fields: ['targetId'] }]
  });

  return CatalogueImportLedger;
};

module.exports = { initCatalogueImportLedgerModel, getCatalogueImportLedgerModel: () => CatalogueImportLedger };
