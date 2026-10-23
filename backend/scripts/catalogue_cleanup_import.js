// Catalogue clean-ups (run on startup from server.js, idempotent, each version once).
//
// v1 (data/catalogue_cleanup_v1_2026-10-23.json, marker CATALOGUE_CLEANUP_V1_DONE): a user audit
// (23 Oct 2026) found messy store data in the GROCERY / TOYS / SEEDS / ELECTRONICS catalogue: duplicate
// items with junk name endings, the same product twice in one store, wrong categories (bread, milk, eggs
// and chips under Staples, garlic and ginger under Health), kids' toys at 90% off, prices with paise,
// Amazon-style long names with the size inside, missing or wrong photos.
// v2 (data/catalogue_cleanup_v2_2026-10-24.json, marker CATALOGUE_CLEANUP_V2_DONE): the Others hunt
// (23–24 Oct 2026) found ad copy in repair descriptions ("10x faster with NVMe SSD + Genuine Windows")
// and Today's deals whose names promise more than the claim gives ("₹50 Off Next Order" makes a ₹30
// coupon, "Free Delivery Pass (3 Orders)" makes one free delivery for today).
//
// Each data file lists explicit, reviewed operations keyed by row id, built from a read-only snapshot of
// the live public catalogue. Rules:
//  - a MenuItem is changed only when it still has the snapshot's store, name and price (expect); a
//    VaultItem only when it still has the snapshot's name, price and original price. Otherwise every op
//    of that row is skipped, so a later admin edit is never overwritten;
//  - hide = isAvailable false (and no outOfStockUntil). Nothing is ever deleted;
//  - one transaction per store (and one for the deals); a failed one is rolled back and retried on the
//    next start;
//  - when everything went through, the version's GlobalConfig marker is written and that version never
//    runs again. Versions are independent: v2 runs once whether or not v1 already ran.
// MenuItem ops: rename, setCategory, setPrice, setOriginalPrice, clearOriginalPrice, setWeight
// (specs.weight), setBrand (specs.brand), setImage, setDescription, hide. VaultItem ops: rename.
// Set DISABLE_CATALOGUE_CLEANUP=true to switch all versions off.
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'catalogue_cleanup_v1_2026-10-23.json');
const DEFAULT_MARKER = 'CATALOGUE_CLEANUP_V1_DONE';
const V2_DATA_PATH = path.join(__dirname, '..', 'data', 'catalogue_cleanup_v2_2026-10-24.json');
const V2_MARKER = 'CATALOGUE_CLEANUP_V2_DONE';
/** Every version, oldest first (runCatalogueCleanups runs them in this order). */
const VERSIONS = [DATA_PATH, V2_DATA_PATH];
const OPS = new Set(['rename', 'setCategory', 'setPrice', 'setOriginalPrice', 'clearOriginalPrice', 'setWeight', 'setBrand', 'setImage', 'setDescription', 'hide']);
const VAULT_OPS = new Set(['rename']);
const MAX_DESCRIPTION = 500;

const readSpecs = (row) => {
  let specs = row.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' && !Array.isArray(specs) ? { ...specs } : {};
};

const wholeRupees = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number.isInteger(Number(v));
const sameMoney = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// The changes for one MenuItem, or null when an op is malformed (the item is then skipped).
const buildUpdate = (row, ops, hiddenBy = 'catalogue-cleanup-v1') => {
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
      case 'setDescription':
        if (typeof o.to !== 'string' || !o.to.trim() || o.to.trim().length > MAX_DESCRIPTION) return null;
        update.description = o.to.trim();
        break;
      case 'hide':
        update.isAvailable = false;
        update.outOfStockUntil = null;
        specs.hiddenBy = hiddenBy;
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

// The changes for one VaultItem (a Today's deal), or null when an op is malformed.
const buildVaultUpdate = (ops) => {
  const update = {};
  for (const o of ops) {
    if (!o || !VAULT_OPS.has(o.op)) return null;
    if (o.op === 'rename') {
      if (typeof o.to !== 'string' || !o.to.trim() || o.to.trim().length > 120) return null;
      update.name = o.to.trim();
    }
  }
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
  const version = Number(data.version) || 1;
  const marker = data.marker || DEFAULT_MARKER;
  const hiddenBy = `catalogue-cleanup-v${version}`;
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
            && sameMoney(row.price, expect.price);
          const update = matches ? buildUpdate(row, item.ops || [], hiddenBy) : null;
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
      console.warn(`[CATALOGUE_CLEANUP] v${version} store ${store.storeName || store.storeId} rolled back:`, err.message);
    }
  }

  // Today's deals (VaultItem): guarded on name, price and original price (the claim's coupon value).
  let vaultApplied = 0;
  if (Array.isArray(data.vault) && data.vault.length) {
    const { getVaultItemModel } = require('../models/VaultItem');
    const VaultItem = getVaultItemModel();
    if (!VaultItem) {
      result.storesFailed++;
      console.warn(`[CATALOGUE_CLEANUP] v${version} deals not ready (VaultItem model missing); retried on the next start`);
    } else {
      try {
        const tally = await sequelize.transaction(async (t) => {
          const local = { applied: 0, skipped: 0, ops: 0, skippedIds: [] };
          for (const deal of data.vault) {
            const expect = (deal && deal.expect) || {};
            const row = deal && deal.id ? await VaultItem.findByPk(deal.id, { transaction: t }) : null;
            const matches = row
              && row.name === expect.name
              && sameMoney(row.price, expect.price)
              && sameMoney(row.originalPrice, expect.originalPrice);
            const update = matches ? buildVaultUpdate(deal.ops || []) : null;
            if (!update || !Object.keys(update).length) {
              local.skipped++;
              if (deal && deal.id) local.skippedIds.push(deal.id);
              continue;
            }
            await row.update(update, { transaction: t });
            local.applied++;
            local.ops += deal.ops.length;
          }
          return local;
        });
        result.applied += tally.applied;
        result.skipped += tally.skipped;
        result.ops += tally.ops;
        result.skippedIds.push(...tally.skippedIds);
        vaultApplied = tally.applied;
      } catch (err) {
        result.storesFailed++;
        console.warn(`[CATALOGUE_CLEANUP] v${version} deals rolled back:`, err.message);
      }
    }
  }

  console.log(`[CATALOGUE_CLEANUP] v${version} applied ${result.applied}, skipped ${result.skipped}`);
  if (!result.storesFailed) {
    try {
      await GlobalConfig.create({
        key: marker,
        value: { doneAt: new Date().toISOString(), applied: result.applied, skipped: result.skipped, ops: result.ops, skippedIds: result.skippedIds },
        description: `Catalogue clean-up v${version} ran (scripts/catalogue_cleanup_import.js, ${path.basename(dataPath)}); delete to re-run.`,
      });
    } catch (err) {
      if (!err || err.name !== 'SequelizeUniqueConstraintError') throw err; // another instance finished first
    }
  }
  if (result.applied > vaultApplied) {
    try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  }
  if (vaultApplied) {
    try { require('../utils/responseCache').invalidate('vault'); } catch { /* the 30 s cache just expires */ }
  }
  return result;
};

/** Runs every clean-up version in order (v1, then v2); each one is skipped once its marker exists. */
const runCatalogueCleanups = async () => {
  const out = {};
  for (const dataPath of VERSIONS) {
    const key = path.basename(dataPath).replace(/^catalogue_cleanup_|_\d{4}-\d{2}-\d{2}\.json$/g, '');
    out[key] = await runCatalogueCleanup({ dataPath });
  }
  return out;
};

module.exports = { runCatalogueCleanup, runCatalogueCleanups, buildUpdate, buildVaultUpdate, DATA_PATH, DEFAULT_MARKER, V2_DATA_PATH, V2_MARKER, VERSIONS };

// CLI: node scripts/catalogue_cleanup_import.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const result = await runCatalogueCleanups();
    console.log('[CATALOGUE_CLEANUP]', result);
    process.exit(0);
  })().catch((err) => { console.error('[CATALOGUE_CLEANUP_FAILED]', err); process.exit(1); });
}
