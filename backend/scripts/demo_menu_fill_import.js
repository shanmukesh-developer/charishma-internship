// Demo-store menu fill (runs on every startup from server.js, idempotent).
//
// The owner keeps the demo restaurants and shops for representation, but many had only 0-3 items.
// data/demo_menu_fill_v1_2026-10-20.json lists extra, store-relevant items for each of them, so every
// demo store shows a believable 8-14 item menu. Rules, same pattern as scripts/catalogue_import.js:
//  - stores are matched by exact id AND exact name; a deleted or renamed store gets nothing;
//  - each item has a stable importKey in CatalogueImportLedger and is inserted at most once, so an
//    admin edit is never overwritten and a deleted item is never re-added;
//  - existing items and stores are never modified;
//  - an item whose name the store already has, or that would take the store past maxItemsPerStore,
//    is skipped and the skip is recorded, so the decision is made once.
// Set DISABLE_DEMO_MENU_FILL=true to switch this off.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'demo_menu_fill_v1_2026-10-20.json');
const KIND_ITEM = 'demo-item';
const KIND_SKIP = 'demo-skip';

const loadData = (dataPath) => {
  if (!fs.existsSync(dataPath)) return null;
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
};

const runDemoMenuFill = async ({ dataPath = DATA_PATH } = {}) => {
  if (String(process.env.DISABLE_DEMO_MENU_FILL || '').toLowerCase() === 'true') return { skipped: 'disabled' };
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
  if (!data) return { skipped: 'no demo menu data' };
  const maxItems = Number(data.maxItemsPerStore) > 0 ? Number(data.maxItemsPerStore) : 14;

  const ledgerRows = await Ledger.findAll({ where: { kind: [KIND_ITEM, KIND_SKIP] }, attributes: ['importKey'] });
  const done = new Set(ledgerRows.map((r) => r.importKey));
  const result = { itemsCreated: 0, skippedDuplicateName: 0, skippedStoreFull: 0, storesMissing: 0, storesRenamed: 0, storesTouched: 0 };

  // Ledger row first (unique importKey), entity in the same transaction: two instances booting at
  // once can never both insert the same item.
  const recordOnce = async (importKey, kind, extra, createEntity) => {
    const targetId = crypto.randomUUID();
    try {
      await sequelize.transaction(async (t) => {
        await Ledger.create({ importKey, kind, targetId, ...extra }, { transaction: t });
        if (createEntity) await createEntity(targetId, t);
      });
      done.add(importKey);
      return true;
    } catch (err) {
      if (err && err.name === 'SequelizeUniqueConstraintError') { done.add(importKey); return false; }
      throw err;
    }
  };

  for (const store of data.stores || []) {
    const pending = (store.items || []).filter((i) => i && i.key && !done.has(i.key));
    if (!pending.length) continue;

    const row = await Restaurant.findByPk(store.id, { attributes: ['id', 'name'] });
    if (!row) { result.storesMissing++; continue; }
    if (String(row.name) !== String(store.name)) { result.storesRenamed++; continue; }

    const existing = await MenuItem.findAll({ where: { restaurantId: store.id }, attributes: ['name'] });
    const names = new Set(existing.map((m) => String(m.name || '').trim().toLowerCase()));
    let count = existing.length;
    let created = 0;

    for (const item of pending) {
      const extra = { storeKey: `demo:${store.id}`, name: item.name };
      const lower = String(item.name).trim().toLowerCase();
      if (names.has(lower) || count >= maxItems) {
        if (await recordOnce(item.key, KIND_SKIP, extra, null)) {
          if (names.has(lower)) result.skippedDuplicateName++;
          else result.skippedStoreFull++;
        }
        continue;
      }
      const diet = item.dietType || null;
      const ok = await recordOnce(item.key, KIND_ITEM, extra, (id, t) => MenuItem.create({
        id,
        restaurantId: store.id,
        name: item.name,
        price: item.price,
        description: item.description || null,
        imageUrl: item.imageUrl || null,
        category: item.category || null,
        tags: [],
        isVegetarian: diet ? diet === 'veg' : true,
        dietType: diet,
        isAvailable: true,
        specs: { demoFillKey: item.key }
      }, { transaction: t }));
      if (ok) { created++; count++; names.add(lower); }
    }
    if (created) { result.itemsCreated += created; result.storesTouched++; }
  }

  if (result.itemsCreated) {
    try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  }
  return result;
};

module.exports = { runDemoMenuFill, DATA_PATH };

// CLI: node scripts/demo_menu_fill_import.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const result = await runDemoMenuFill();
    console.log('[DEMO_MENU_FILL]', result);
    process.exit(0);
  })().catch((err) => { console.error('[DEMO_MENU_FILL_FAILED]', err); process.exit(1); });
}
