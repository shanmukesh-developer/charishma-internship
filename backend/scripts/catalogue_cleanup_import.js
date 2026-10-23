// Campus store catalogue clean-up v1 (runs on startup from server.js, idempotent, once).
//
// A user audit (23 Oct 2026) found messy store data in the GROCERY / TOYS / SEEDS / ELECTRONICS
// catalogue: duplicate items with junk name endings, the same product twice in one store, wrong
// categories (bread, milk, eggs and chips under Staples, garlic and ginger under Health), kids' toys at
// 90% off, prices with paise, Amazon-style long names with the size inside, missing or wrong photos.
// data/catalogue_cleanup_v1_2026-10-23.json lists explicit, reviewed operations keyed by MenuItem id,
// built from a read-only snapshot of the live public catalogue. Rules:
//  - an item is changed only when it still has the snapshot's store, name and price (expect); otherwise
//    every op of that item is skipped, so a later admin edit is never overwritten;
//  - hide = isAvailable false (and no outOfStockUntil). Nothing is ever deleted;
//  - one transaction per store; a failed store is rolled back and retried on the next start;
//  - when every store went through, GlobalConfig CATALOGUE_CLEANUP_V1_DONE is written and the clean-up
//    never runs again.
// Ops: rename, setCategory, setPrice, setOriginalPrice, clearOriginalPrice, setWeight (specs.weight),
// setBrand (specs.brand), setImage, hide.
// Set DISABLE_CATALOGUE_CLEANUP=true to switch this off.
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'catalogue_cleanup_v1_2026-10-23.json');
const DEFAULT_MARKER = 'CATALOGUE_CLEANUP_V1_DONE';
const OPS = new Set(['rename', 'setCategory', 'setPrice', 'setOriginalPrice', 'clearOriginalPrice', 'setWeight', 'setBrand', 'setImage', 'hide']);

const readSpecs = (row) => {
  let specs = row.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' && !Array.isArray(specs) ? { ...specs } : {};
};

const wholeRupees = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number.isInteger(Number(v));

// The changes for one item, or null when an op is malformed (the item is then skipped).
const buildUpdate = (row, ops) => {
  const specs = readSpecs(row);
  const update = {};
  let specsChanged = false;
  for (const o of ops) {
    if (!o || !OPS.has(o.op)) return null;
    switch (o.op) {
      case 'rename':
        if (typeof o.to !== 'string' || !o.to.trim()) return null;
        update.name = o.to.trim();
        break;
      case 'setCategory':
        if (typeof o.to !== 'string' || !o.to.trim()) return null;
        update.category = o.to.trim();
        break;
      case 'setPrice':
        if (!wholeRupees(o.to)) return null;
        update.price = Number(o.to);
        break;
      case 'setOriginalPrice':
        if (!wholeRupees(o.to)) return null;
        update.originalPrice = Number(o.to);
        if (specs.originalPrice !== undefined) { specs.originalPrice = Number(o.to); specsChanged = true; }
        break;
      case 'clearOriginalPrice':
        update.originalPrice = null;
        if (specs.originalPrice !== undefined) { delete specs.originalPrice; specsChanged = true; }
        break;
      case 'setWeight':
      case 'setBrand':
        if (typeof o.to !== 'string' || !o.to.trim()) return null;
        specs[o.op === 'setWeight' ? 'weight' : 'brand'] = o.to.trim();
        specsChanged = true;
        break;
      case 'setImage':
        if (typeof o.to !== 'string' || !/^https:\/\/images\.(unsplash|pexels)\.com\//.test(o.to)) return null;
        update.imageUrl = o.to;
        break;
      case 'hide':
        update.isAvailable = false;
        update.outOfStockUntil = null;
        specs.hiddenBy = 'catalogue-cleanup-v1';
        specsChanged = true;
        break;
      default:
        return null;
    }
  }
  // An MRP below the selling price is never shown; keep it out of the data too.
  const price = update.price !== undefined ? update.price : Number(row.price);
  if (update.originalPrice && update.originalPrice <= price) update.originalPrice = null;
  if (specsChanged) update.specs = specs;
  return update;
};

const runCatalogueCleanup = async ({ dataPath = DATA_PATH } = {}) => {
  if (String(process.env.DISABLE_CATALOGUE_CLEANUP || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const { getMenuItemModel } = require('../models/MenuItem');
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const sequelize = getSequelize();
  const MenuItem = getMenuItemModel();
  const GlobalConfig = getGlobalConfigModel();
  if (!sequelize || !MenuItem || !GlobalConfig) return { skipped: 'models not ready' };
  if (!fs.existsSync(dataPath)) return { skipped: 'no clean-up data' };
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const marker = data.marker || DEFAULT_MARKER;
  if (await GlobalConfig.findOne({ where: { key: marker } })) return { skipped: 'already done' };

  const result = { applied: 0, skipped: 0, ops: 0, storesFailed: 0, skippedIds: [] };
  for (const store of data.stores || []) {
    if (!store || !store.storeId || !Array.isArray(store.items)) continue;
    try {
      const tally = await sequelize.transaction(async (t) => {
        const local = { applied: 0, skipped: 0, ops: 0, skippedIds: [] };
        for (const item of store.items) {
          const expect = (item && item.expect) || {};
          const row = item && item.id ? await MenuItem.findByPk(item.id, { transaction: t }) : null;
          const matches = row
            && row.restaurantId === store.storeId
            && row.name === expect.name
            && Math.abs(Number(row.price) - Number(expect.price)) < 0.005;
          const update = matches ? buildUpdate(row, item.ops || []) : null;
          if (!update || !Object.keys(update).length) {
            local.skipped++;
            if (item && item.id) local.skippedIds.push(item.id);
            continue;
          }
          await row.update(update, { transaction: t });
          local.applied++;
          local.ops += item.ops.length;
        }
        return local;
      });
      result.applied += tally.applied;
      result.skipped += tally.skipped;
      result.ops += tally.ops;
      result.skippedIds.push(...tally.skippedIds);
    } catch (err) {
      result.storesFailed++;
      console.warn(`[CATALOGUE_CLEANUP] store ${store.storeName || store.storeId} rolled back:`, err.message);
    }
  }

  console.log(`[CATALOGUE_CLEANUP] applied ${result.applied}, skipped ${result.skipped}`);
  if (!result.storesFailed) {
    try {
      await GlobalConfig.create({
        key: marker,
        value: { doneAt: new Date().toISOString(), applied: result.applied, skipped: result.skipped, ops: result.ops, skippedIds: result.skippedIds },
        description: 'Campus store catalogue clean-up v1 ran (scripts/catalogue_cleanup_import.js); delete to re-run.',
      });
    } catch (err) {
      if (!err || err.name !== 'SequelizeUniqueConstraintError') throw err; // another instance finished first
    }
  }
  if (result.applied) {
    try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  }
  return result;
};

module.exports = { runCatalogueCleanup, buildUpdate, DATA_PATH, DEFAULT_MARKER };

// CLI: node scripts/catalogue_cleanup_import.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const result = await runCatalogueCleanup();
    console.log('[CATALOGUE_CLEANUP]', result);
    process.exit(0);
  })().catch((err) => { console.error('[CATALOGUE_CLEANUP_FAILED]', err); process.exit(1); });
}
