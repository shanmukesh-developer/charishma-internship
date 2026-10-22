// Demo CampusBites stalls (runs on every startup from server.js, idempotent).
//
// The owner keeps demo stores for representation, and the CampusBites "Local vendor stalls" section on
// the customer Home screen was empty. data/demo_stalls_v1_2026-10-21.json lists 16 generic LOCAL_VENDOR
// stalls near SRM AP with 10-12 items each: 13 food stalls (chai, tiffin, juice, rolls and shawarma,
// burgers, pizza, Chinese, chaat, biryani and meals, momos, bakery, desserts, healthy bowls) and 3 product
// stalls (fruit and veg cart, stationery and xerox, hostel daily needs). They are ordinary Restaurant /
// MenuItem rows, so the admin portal lists and edits them like any other store (Stores, Catalogue).
// Rules, same pattern as scripts/catalogue_import.js and scripts/demo_menu_fill_import.js:
//  - every stall and every item has a stable importKey in CatalogueImportLedger and is created at most
//    once, so an admin edit is never overwritten and a deleted stall or item is never re-created;
//  - a stall whose name already exists (any store, any case) is not created, and that decision is
//    recorded once (its items are never added to the other store);
//  - existing rows are never modified;
//  - no partner login: no phone, no WhatsApp number and no password, so nobody can sign in to these
//    stalls until the admin sets real credentials (the login refuses a store without a password).
// Ledger kinds: 'demo-stall' (Restaurant.id), 'demo-stall-skip' (name taken; targetId points at nothing),
// 'demo-stall-item' (MenuItem.id).
// Set DISABLE_DEMO_STALLS=true to switch this off.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'demo_stalls_v1_2026-10-21.json');
const KIND_STALL = 'demo-stall';
const KIND_STALL_SKIP = 'demo-stall-skip';
const KIND_ITEM = 'demo-stall-item';

const loadData = (dataPath) => {
  if (!fs.existsSync(dataPath)) return null;
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
};

const runDemoStallsImport = async ({ dataPath = DATA_PATH } = {}) => {
  if (String(process.env.DISABLE_DEMO_STALLS || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const { getRestaurantModel } = require('../models/Restaurant');
  const { getMenuItemModel } = require('../models/MenuItem');
  const { getCatalogueImportLedgerModel } = require('../models/CatalogueImportLedger');
  const sequelize = getSequelize();
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const Ledger = getCatalogueImportLedgerModel();
  if (!sequelize || !Restaurant || !MenuItem || !Ledger) return { skipped: 'models not ready' };

  const data = loadData(dataPath);
  if (!data) return { skipped: 'no demo stall data' };
  const defaults = data.defaults || {};

  const ledgerRows = await Ledger.findAll({ where: { kind: [KIND_STALL, KIND_STALL_SKIP, KIND_ITEM] }, attributes: ['importKey', 'kind', 'targetId'] });
  const done = new Map(ledgerRows.map((r) => [r.importKey, { kind: r.kind, targetId: r.targetId }]));
  const result = { stallsCreated: 0, stallsSkippedNameTaken: 0, stallsDeleted: 0, itemsCreated: 0 };

  // Ledger row first (unique importKey), entity in the same transaction: two instances booting at
  // once can never both create the same stall or item.
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

  for (const stall of data.stalls || []) {
    if (!stall || !stall.key || !stall.name) continue;
    const extra = { storeKey: stall.key, name: stall.name };

    if (!done.has(stall.key)) {
      if (await nameTaken(stall.name)) {
        if (await recordOnce(stall.key, KIND_STALL_SKIP, extra, null)) result.stallsSkippedNameTaken++;
        continue;
      }
      const created = await recordOnce(stall.key, KIND_STALL, extra, (id, t) => Restaurant.create({
        id,
        name: stall.name,
        location: stall.location || 'Near SRM AP campus',
        ...(Number.isFinite(Number(stall.lat)) ? { lat: Number(stall.lat) } : {}),
        ...(Number.isFinite(Number(stall.lon)) ? { lon: Number(stall.lon) } : {}),
        zone: defaults.zone || 'Amaravathi_Central',
        campus: stall.campus || defaults.campus || null,
        imageUrl: stall.imageUrl || null,
        vendorType: stall.vendorType || defaults.vendorType || 'LOCAL_VENDOR',
        rating: 0, // no invented ratings: real ratings come from orders
        deliveryTime: null,
        tags: Array.isArray(stall.tags) ? stall.tags : [],
        stallDescription: stall.stallDescription || null,
        promoOffer: null, // no invented offers
        operatingHours: stall.operatingHours || { start: '09:00', end: '21:00' },
        subscriptionTier: 'free',
        isActive: true,
        isOpenNow: true,
        isOffline: false,
        // No partner login: no phone, no WhatsApp number, no password (restaurantLogin refuses it).
        phone: null,
        whatsappNumber: null,
        password: null,
      }, { transaction: t }));
      if (created) result.stallsCreated++;
    }

    const entry = done.get(stall.key);
    if (!entry || entry.kind !== KIND_STALL) continue; // name was taken: never fill someone else's store
    const storeId = entry.targetId;
    // The owner deleted this stall in the admin dashboard: never re-create it or its items.
    if (!(await Restaurant.count({ where: { id: storeId } }))) { result.stallsDeleted++; continue; }

    for (const item of stall.items || []) {
      if (!item || !item.key || done.has(item.key)) continue;
      // Food: veg / nonveg / egg. Non-food products (stationery, toiletries) carry no diet mark.
      const diet = ['veg', 'nonveg', 'egg'].includes(item.dietType) ? item.dietType : null;
      const ok = await recordOnce(item.key, KIND_ITEM, { storeKey: stall.key, name: item.name }, (id, t) => MenuItem.create({
        id,
        restaurantId: storeId,
        name: item.name,
        price: item.price,
        description: item.description || null,
        imageUrl: item.imageUrl || null,
        category: item.category || null,
        tags: [],
        isVegetarian: diet ? diet === 'veg' : true, // same as catalogue_import products
        dietType: diet,
        isAvailable: true,
        specs: { demoStallKey: item.key }
      }, { transaction: t }));
      if (ok) result.itemsCreated++;
    }
  }

  if (result.stallsCreated || result.itemsCreated) {
    try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  }
  return result;
};

module.exports = { runDemoStallsImport, DATA_PATH };

// CLI: node scripts/demo_stalls_import.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const result = await runDemoStallsImport();
    console.log('[DEMO_STALLS]', result);
    process.exit(0);
  })().catch((err) => { console.error('[DEMO_STALLS_FAILED]', err); process.exit(1); });
}
