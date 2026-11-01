// Test data for trying the apps on the live server (runs once from server.js on startup).
//
// Owner, 1 Nov 2026: "add some mock data for testing things ... in data base not locally". Every store was
// removed on 28 Oct (scripts/remove_all_stores_v1 / _v2), so the customer app had nothing to order from.
// data/test_data_v1_2026-11-01.json lists six invented stores, every name starting with "ZCS Test", one per
// section: Food (restaurant, cafe, bakery), Groceries (mart, stationery) and the Home local vendor stalls.
// They are ordinary Restaurant / MenuItem rows: the admin dashboard lists, edits, hides and deletes them like
// any other store, and can set a partner login on one (Stores > store > Partner login) or accept its orders.
// Rules, same pattern as scripts/demo_stalls_import.js:
//  - every store and item has a stable importKey in CatalogueImportLedger and is created at most once, so an
//    admin edit is never overwritten and a deleted store or item is never re-created;
//  - a store whose name already exists (any case) is not created, and that is recorded once;
//  - existing rows are never modified;
//  - no partner login (no phone, WhatsApp number or password), no UPI ID, no FSSAI number, no rating, no offer;
//  - runs only after the store removal finished (REMOVE_ALL_STORES_V2_DONE), which deletes every store and
//    would otherwise take these with it; the realDataOnly() gate of the old imports is left as it is.
// The GlobalConfig marker TEST_DATA_V1_DONE (with the created ids) is written once everything is in place.
// Ledger kinds: 'test-store' (Restaurant.id), 'test-store-skip' (name taken), 'test-item' (MenuItem.id).
// DISABLE_TEST_DATA=true switches it off.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'test_data_v1_2026-11-01.json');
const MARKER = 'TEST_DATA_V1_DONE';
const REMOVAL_MARKER = 'REMOVE_ALL_STORES_V2_DONE';
const KIND_STORE = 'test-store';
const KIND_STORE_SKIP = 'test-store-skip';
const KIND_ITEM = 'test-item';

const loadData = (dataPath) => (fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : null);

const runTestDataSeed = async ({ dataPath = DATA_PATH } = {}) => {
  if (String(process.env.DISABLE_TEST_DATA || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const { getRestaurantModel } = require('../models/Restaurant');
  const { getMenuItemModel } = require('../models/MenuItem');
  const { getCatalogueImportLedgerModel } = require('../models/CatalogueImportLedger');
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const sequelize = getSequelize();
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const Ledger = getCatalogueImportLedgerModel();
  const GlobalConfig = getGlobalConfigModel();
  if (!sequelize || !Restaurant || !MenuItem || !Ledger || !GlobalConfig) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };
  if (!(await GlobalConfig.findOne({ where: { key: REMOVAL_MARKER } }))) return { skipped: 'store removal not finished' };

  const data = loadData(dataPath);
  if (!data) return { skipped: 'no test data file' };
  const defaults = data.defaults || {};

  const ledgerRows = await Ledger.findAll({ where: { kind: [KIND_STORE, KIND_STORE_SKIP, KIND_ITEM] }, attributes: ['importKey', 'kind', 'targetId'] });
  const done = new Map(ledgerRows.map((r) => [r.importKey, { kind: r.kind, targetId: r.targetId }]));
  const result = { storesCreated: 0, storesSkippedNameTaken: 0, storesDeleted: 0, itemsCreated: 0 };

  // Ledger row first (unique importKey), entity in the same transaction: two instances booting at once can
  // never both create the same store or item.
  const recordOnce = async (importKey, kind, extra, createEntity) => {
    const targetId = crypto.randomUUID();
    try {
      await sequelize.transaction(async (t) => {
        await Ledger.create({ importKey, kind, targetId, ...extra }, { transaction: t });
        if (createEntity) await createEntity(targetId, t);
      });
      done.set(importKey, { kind, targetId });
      return true;
    } catch (err) {
      if (err && err.name === 'SequelizeUniqueConstraintError') {
        const row = await Ledger.findOne({ where: { importKey } });
        if (row) done.set(importKey, { kind: row.kind, targetId: row.targetId });
        return false;
      }
      throw err;
    }
  };

  const nameTaken = async (name) => {
    const { fn, col, where: sqlWhere } = require('sequelize');
    return (await Restaurant.count({ where: sqlWhere(fn('lower', col('name')), String(name).trim().toLowerCase()) })) > 0;
  };

  const storeIds = [];
  for (const store of data.stores || []) {
    if (!store || !store.key || !store.name) continue;
    const extra = { storeKey: store.key, name: store.name };

    if (!done.has(store.key)) {
      if (await nameTaken(store.name)) {
        if (await recordOnce(store.key, KIND_STORE_SKIP, extra, null)) result.storesSkippedNameTaken++;
        continue;
      }
      const created = await recordOnce(store.key, KIND_STORE, extra, (id, t) => Restaurant.create({
        id,
        name: store.name,
        location: store.location || defaults.location || 'ZCS test store (not a real shop)',
        zone: defaults.zone || 'Amaravathi_Central',
        campus: null, // only labels stall cards; visibleCampuses null = every college
        visibleCampuses: null,
        imageUrl: store.imageUrl || null,
        vendorType: store.vendorType || 'RESTAURANT',
        rating: 0, // no invented ratings: real ratings come from orders
        deliveryTime: typeof store.deliveryTime === 'number' ? store.deliveryTime : null,
        tags: Array.isArray(store.tags) ? store.tags : [],
        stallDescription: store.stallDescription || null,
        promoOffer: null, // no invented offers
        operatingHours: store.operatingHours || defaults.operatingHours || { start: '00:00', end: '23:59' },
        subscriptionTier: 'free',
        isActive: true,
        isOpenNow: true,
        isOffline: false,
        // No partner login: no phone, no WhatsApp number, no password (restaurantLogin refuses it).
        phone: null,
        whatsappNumber: null,
        password: null,
      }, { transaction: t }));
      if (created) result.storesCreated++;
    }

    const entry = done.get(store.key);
    if (!entry || entry.kind !== KIND_STORE) continue; // name was taken: never fill someone else's store
    const storeId = entry.targetId;
    // The owner deleted this store in the admin dashboard: never re-create it or its items.
    if (!(await Restaurant.count({ where: { id: storeId } }))) { result.storesDeleted++; continue; }
    storeIds.push(storeId);

    for (const item of store.items || []) {
      if (!item || !item.key || done.has(item.key)) continue;
      // Food: veg / nonveg / egg. Non-food products (detergent, notebooks) carry no diet mark.
      const diet = ['veg', 'nonveg', 'egg'].includes(item.dietType) ? item.dietType : null;
      const ok = await recordOnce(item.key, KIND_ITEM, { storeKey: store.key, name: item.name }, (id, t) => MenuItem.create({
        id,
        restaurantId: storeId,
        name: item.name,
        price: item.price,
        description: item.description || null,
        imageUrl: item.imageUrl || null,
        category: item.category || null,
        tags: [],
        isVegetarian: diet ? diet === 'veg' : true, // same as the catalogue imports
        dietType: diet,
        isAvailable: true,
        specs: { testDataKey: item.key },
      }, { transaction: t }));
      if (ok) result.itemsCreated++;
    }
  }

  if (result.storesCreated || result.itemsCreated) {
    try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  }
  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), storeIds, ...result }) });
  return result;
};

module.exports = { runTestDataSeed, DATA_PATH, MARKER };

// CLI: node scripts/test_data_seed.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const result = await runTestDataSeed();
    console.log('[TEST_DATA]', result);
    process.exit(0);
  })().catch((err) => { console.error('[TEST_DATA_FAILED]', err); process.exit(1); });
}
