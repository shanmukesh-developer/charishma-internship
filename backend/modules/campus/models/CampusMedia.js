const { DataTypes } = require('sequelize');

// Uploaded campus images (ID cards, chat photos, lost & found, avatars) stored as bytes in the
// main database, so they survive Render deploys without any paid storage. Served by
// GET /api/campus/media/:id with long cache headers.
let CampusMedia;

const initCampusMediaModel = (sequelize) => {
  if (!sequelize) return null;

  CampusMedia = sequelize.define('CampusMedia', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // 'id_card' | 'chat' | 'lost_found' | 'avatar' | 'post' | 'other'
    purpose: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'other',
    },
    mime: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sha256: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    // Only visible to the owner and admins (ID cards). Everything else is public by its unguessable id.
    isPrivate: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    bytes: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
  }, {
    timestamps: true,
    tableName: 'CampusMedia',
    indexes: [{ fields: ['ownerId'] }, { fields: ['ownerId', 'sha256'] }],
  });

  // utils/mediaStorage: rows whose bytes live in R2 (empty `bytes`) take their object with them when they
  // are destroyed (retention sweeps, account deletion, Connect photo removal ...). Only active while R2
  // credentials are set: otherwise these hooks return at once (no query, no behaviour change).
  const storage = () => require('../../../utils/mediaStorage');
  const externalRowsWhere = async (where, transaction) => {
    const { fn, col } = require('sequelize');
    const rows = await CampusMedia.findAll({
      where,
      attributes: ['id', 'isPrivate', 'size', [fn('LENGTH', col('bytes')), 'blen']],
      transaction,
      raw: true,
    });
    return rows.filter((r) => Number(r.blen) === 0 && Number(r.size) > 0).map((r) => ({ id: r.id, isPrivate: !!r.isPrivate }));
  };
  const scheduleDelete = (items, options) => {
    if (!items || !items.length) return;
    const run = () => { storage().deleteObjects(items).catch(() => {}); };
    if (options && options.transaction && typeof options.transaction.afterCommit === 'function') options.transaction.afterCommit(run);
    else run();
  };
  CampusMedia.addHook('beforeBulkDestroy', 'mediaStorageCollect', async (options) => {
    if (!storage().objectStoreConfigured() || !options || !options.where) return;
    try { options.mediaStorageObjects = await externalRowsWhere(options.where, options.transaction); } catch (err) {
      console.warn('[MEDIA_STORAGE] could not list objects to delete:', err.message);
    }
  });
  CampusMedia.addHook('afterBulkDestroy', 'mediaStorageDelete', (options) => {
    if (options && options.mediaStorageObjects) scheduleDelete(options.mediaStorageObjects, options);
  });
  CampusMedia.addHook('beforeDestroy', 'mediaStorageCollectOne', async (instance, options) => {
    if (!storage().objectStoreConfigured() || !instance || !options) return;
    try { options.mediaStorageObjects = await externalRowsWhere({ id: instance.id }, options.transaction); } catch { /* best effort */ }
  });
  CampusMedia.addHook('afterDestroy', 'mediaStorageDeleteOne', (instance, options) => {
    if (options && options.mediaStorageObjects) scheduleDelete(options.mediaStorageObjects, options);
  });

  return CampusMedia;
};

module.exports = {
  initCampusMediaModel,
  getCampusMediaModel: () => CampusMedia,
};
