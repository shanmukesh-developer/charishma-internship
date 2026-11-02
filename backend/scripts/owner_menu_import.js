// Owner menus (runs on startup from server.js, idempotent): real restaurants the owner sends as a menu card.
//
// Owner, 1 Nov 2026: "add this restaurant and add this menu ... exact images, not random ... valid descriptions";
// "use real images everywhere". Each data/owner-menus/*.json is one store with its items (prices exactly as on the
// card) and data/owner-menus/<imagesDir>/ holds a real, licensed photo per item plus the store cover, checked by
// eye; sources.json beside them records where each photo comes from and its licence. The photos are saved into the
// server's own media store (CampusMedia, utils/imageStore), never hot-linked, so a stock site deleting a photo can
// never blank a dish.
// Rules, same pattern as scripts/demo_stalls_import.js / scripts/test_data_seed.js:
//  - every store and item has a stable importKey in CatalogueImportLedger and is created at most once: an admin
//    edit is never overwritten, a store or item the admin deleted is never re-created;
//  - a store whose name is already used (any case) is not created (the owner already added it by hand);
//  - nothing is created unless the file is complete (every photo present and a real JPEG / PNG / WEBP);
//  - no partner login, phone, WhatsApp number, UPI ID, FSSAI number, rating or offer is invented: the owner sets
//    the login in Admin > Stores > Partner login;
//  - runs only after the store removal finished (REMOVE_ALL_STORES_V2_DONE), which would take the store with it;
//  - a corrected or better photo reaches dishes imported before through `replacesPhotos` (see syncPhotos), a
//    corrected text through `replacesDescriptions` (syncDescriptions): only what still shows what this repo set is
//    changed.
// Ledger kinds: 'owner-store' (Restaurant.id), 'owner-store-skip' (name taken), 'owner-item' (MenuItem.id).
// DISABLE_OWNER_MENUS=true switches it off.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data', 'owner-menus');
const KIND_STORE = 'owner-store';
const KIND_STORE_SKIP = 'owner-store-skip';
const KIND_ITEM = 'owner-item';
const DIETS = ['veg', 'nonveg', 'egg'];

const loadMenus = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [])
  .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));

/** Problems that stop a menu file from being imported (an incomplete menu is never half-created). */
const menuProblems = (data, dir) => {
  const out = [];
  if (!data || !data.key || !data.store || !data.store.name || !data.store.location) out.push('store key / name / location missing');
  const imgDir = path.join(dir, String((data && data.imagesDir) || ''));
  const photo = (file) => {
    const p = path.join(imgDir, String(file || ''));
    if (!file || !fs.existsSync(p)) return `photo missing: ${file || '(none)'}`;
    const head = fs.readFileSync(p).subarray(0, 12);
    const ok = (head[0] === 0xff && head[1] === 0xd8) || head.subarray(0, 4).toString('hex') === '89504e47' || head.subarray(8, 12).toString() === 'WEBP';
    return ok ? null : `not a JPEG / PNG / WEBP photo: ${file}`;
  };
  if (data && data.store) { const pr = photo(data.store.image); if (pr) out.push(`cover ${pr}`); }
  const history = (list) => list === undefined || (Array.isArray(list) && list.every((h) => h === null || /^[0-9a-f]{64}$/.test(String(h))));
  if (data && data.store && !history(data.store.replacesImages)) out.push('store replacesImages: SHA-256 list');
  if (data && data.store && !history(data.store.replacesDescriptions)) out.push('store replacesDescriptions: SHA-256 list');
  const slugs = new Set();
  for (const it of (data && data.items) || []) {
    if (!it || !it.slug || !it.name) { out.push('item without slug / name'); continue; }
    if (slugs.has(it.slug)) out.push(`duplicate item ${it.slug}`);
    slugs.add(it.slug);
    if (!(Number.isFinite(Number(it.price)) && Number(it.price) > 0)) out.push(`${it.slug}: price`);
    if (!DIETS.includes(it.dietType)) out.push(`${it.slug}: dietType`);
    if (!history(it.replacesPhotos)) out.push(`${it.slug}: replacesPhotos: SHA-256 list`);
    if (!history(it.replacesDescriptions)) out.push(`${it.slug}: replacesDescriptions: SHA-256 list`);
    // image null = no photo for now (a wrong photo was taken off); it must say which photo it replaces.
    if (it.image === null && !(it.replacesPhotos || []).length) out.push(`${it.slug}: no photo and nothing it replaces`);
    const pr = it.image === null ? null : photo(it.image);
    if (pr) out.push(`${it.slug}: ${pr}`);
  }
  if (!slugs.size) out.push('no items');
  return out;
};

const mediaIdOf = (url) => { const m = String(url || '').match(/\/api\/campus\/media\/([0-9a-f-]{36})$/i); return m ? m[1] : null; };
const fileSha = (dir, data, file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, data.imagesDir, file))).digest('hex');

/**
 * Corrected or better photos for a store and dishes imported before (owner, 2 Nov 2026: "improve quality of images").
 * A dish lists the SHA-256 of every photo the repo set for it earlier in `replacesPhotos` (null: it had none), the
 * store in `store.replacesImages`. A dish or store still showing one of those gets the file's photo, or none when
 * `image` is null; a photo the admin uploaded, linked or removed is not in the list and is never touched. Runs on
 * every start and does nothing once everything matches. Returns how many photos it changed.
 */
const syncPhotos = async ({ dataDir, data, storeId, done, Restaurant, MenuItem, savePhoto }) => {
  const targets = [];
  const s = data.store || {};
  if ((s.replacesImages || []).length) targets.push({ key: `store:${storeId}`, store: true, id: storeId, file: s.image || null, history: s.replacesImages });
  for (const it of data.items || []) {
    const entry = (it.replacesPhotos || []).length ? done.get(`${data.key}:${it.slug}`) : null;
    if (entry && entry.kind === KIND_ITEM) targets.push({ key: String(entry.targetId), store: false, id: entry.targetId, file: it.image || null, history: it.replacesPhotos });
  }
  if (!targets.length) return 0;
  const { getCampusMediaModel } = require('../modules/campus/models/CampusMedia');
  const Media = getCampusMediaModel && getCampusMediaModel();
  if (!Media) return 0;
  const rows = new Map();
  const itemIds = targets.filter((t) => !t.store).map((t) => t.id);
  for (const r of itemIds.length ? await MenuItem.findAll({ where: { id: itemIds }, attributes: ['id', 'imageUrl'] }) : []) rows.set(String(r.id), r);
  if (targets.some((t) => t.store)) {
    const st = await Restaurant.findByPk(storeId, { attributes: ['id', 'imageUrl'] });
    if (st) rows.set(`store:${storeId}`, st);
  }
  const mediaIds = [...rows.values()].map((r) => mediaIdOf(r.imageUrl)).filter(Boolean);
  const shaById = new Map((mediaIds.length ? await Media.findAll({ where: { id: mediaIds }, attributes: ['id', 'sha256'] }) : []).map((m) => [String(m.id), m.sha256]));
  let changed = 0;
  for (const t of targets) {
    const row = rows.get(t.key);
    if (!row) continue; // deleted by the admin
    const current = row.imageUrl ? (shaById.get(String(mediaIdOf(row.imageUrl))) || 'not ours') : null;
    const want = t.file ? fileSha(dataDir, data, t.file) : null;
    if (current === want || !t.history.includes(current)) continue;
    const imageUrl = t.file ? await savePhoto(dataDir, data, t.file, t.store ? 'store' : 'menu') : null;
    if (t.store) await Restaurant.update({ imageUrl }, { where: { id: t.id } });
    else await MenuItem.update({ imageUrl }, { where: { id: t.id } });
    changed++;
  }
  return changed;
};

/**
 * Menu order = the menu file's order (the printed card's), 2 Nov 2026: without a sortOrder the apps list categories
 * and dishes alphabetically (utils/menuSort). A dish imported before without specs.sortOrder gets (position + 1) x 10;
 * an order the admin or the store set is never changed. Returns how many dishes it numbered.
 */
const syncSortOrder = async ({ data, done, MenuItem }) => {
  const { sortOrderOf } = require('../utils/menuSort');
  const pos = new Map();
  (data.items || []).forEach((it, i) => {
    const entry = done.get(`${data.key}:${it.slug}`);
    if (entry && entry.kind === KIND_ITEM) pos.set(String(entry.targetId), (i + 1) * 10);
  });
  if (!pos.size) return 0;
  let changed = 0;
  for (const row of await MenuItem.findAll({ where: { id: [...pos.keys()] }, attributes: ['id', 'specs'] })) {
    if (sortOrderOf(row) !== Infinity) continue;
    let specs = row.specs;
    if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
    await MenuItem.update({ specs: { ...(specs && typeof specs === 'object' ? specs : {}), sortOrder: pos.get(String(row.id)) } }, { where: { id: row.id } });
    changed++;
  }
  return changed;
};

/** SHA-256 of a description as stored (trimmed), the key `replacesDescriptions` lists. */
const textSha = (text) => crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');

/**
 * Corrected descriptions for a store and dishes imported before (2 Nov 2026: an unsupported "established in 2017"
 * in Manu Dosa Place's intro). Same rule as syncPhotos: `replacesDescriptions` lists the SHA-256 of each text the repo
 * set before (trimmed); a store / dish still showing one of them gets the file's text, a text the admin wrote is
 * never touched. Returns how many texts it changed.
 */
const syncDescriptions = async ({ data, storeId, done, Restaurant, MenuItem }) => {
  let changed = 0;
  const s = data.store || {};
  if ((s.replacesDescriptions || []).length && s.description) {
    const st = await Restaurant.findByPk(storeId, { attributes: ['id', 'stallDescription'] });
    const cur = st && st.stallDescription ? textSha(st.stallDescription) : null;
    if (st && cur !== textSha(s.description) && s.replacesDescriptions.includes(cur)) {
      await Restaurant.update({ stallDescription: s.description }, { where: { id: storeId } });
      changed++;
    }
  }
  for (const it of data.items || []) {
    if (!(it.replacesDescriptions || []).length || !it.description) continue;
    const entry = done.get(`${data.key}:${it.slug}`);
    if (!entry || entry.kind !== KIND_ITEM) continue;
    const row = await MenuItem.findByPk(entry.targetId, { attributes: ['id', 'description'] });
    const cur = row && row.description ? textSha(row.description) : null;
    if (!row || cur === textSha(it.description) || !it.replacesDescriptions.includes(cur)) continue;
    await MenuItem.update({ description: it.description }, { where: { id: row.id } });
    changed++;
  }
  return changed;
};

const runOwnerMenuImport = async ({ dataDir = DATA_DIR } = {}) => {
  if (String(process.env.DISABLE_OWNER_MENUS || '').toLowerCase() === 'true') return { skipped: 'disabled' };
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
  if (!(await GlobalConfig.findOne({ where: { key: 'REMOVE_ALL_STORES_V2_DONE' } }))) return { skipped: 'store removal not finished' };

  const menus = loadMenus(dataDir);
  if (!menus.length) return { skipped: 'no owner menus' };
  const { saveImageBytes } = require('../utils/imageStore');
  const { apiUrl } = require('../utils/publicUrl');
  const savePhoto = async (dir, data, file, purpose) => {
    const saved = await saveImageBytes(fs.readFileSync(path.join(dir, data.imagesDir, file)), { purpose });
    return apiUrl(null, `/api/campus/media/${saved.id}`, { renderFallback: true });
  };

  const keys = menus.flatMap(({ data }) => [data.key, ...((data.items || []).map((i) => `${data.key}:${i.slug}`))]);
  const ledgerRows = keys.length ? await Ledger.findAll({ where: { importKey: keys }, attributes: ['importKey', 'kind', 'targetId'] }) : [];
  const done = new Map(ledgerRows.map((r) => [r.importKey, { kind: r.kind, targetId: r.targetId }]));

  // Ledger row first (unique importKey), entity in the same transaction: two instances never both create it.
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

  const result = { menus: menus.length, storesCreated: 0, storesSkippedNameTaken: 0, storesDeleted: 0, itemsCreated: 0, photosUpdated: 0, textsUpdated: 0, dishesOrdered: 0, invalid: [] };
  for (const { file, data } of menus) {
    const problems = menuProblems(data, dataDir);
    if (problems.length) { result.invalid.push({ file, problems: problems.slice(0, 5) }); continue; }
    const s = data.store;
    const extra = { storeKey: data.key, name: s.name };

    if (!done.has(data.key)) {
      if (await nameTaken(s.name)) {
        if (await recordOnce(data.key, KIND_STORE_SKIP, extra, null)) result.storesSkippedNameTaken++;
        continue;
      }
      const cover = await savePhoto(dataDir, data, s.image, 'store');
      const created = await recordOnce(data.key, KIND_STORE, extra, (id, t) => Restaurant.create({
        id,
        name: s.name,
        location: s.location,
        ...(Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) ? { lat: Number(s.lat), lon: Number(s.lon) } : {}),
        zone: s.zone || 'Amaravathi_Central',
        campus: null,
        visibleCampuses: Array.isArray(s.visibleCampuses) && s.visibleCampuses.length ? s.visibleCampuses : null,
        imageUrl: cover,
        vendorType: s.vendorType || 'RESTAURANT',
        rating: 0, // real ratings come from orders
        deliveryTime: null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        stallDescription: s.description || null,
        promoOffer: null,
        operatingHours: s.operatingHours || { start: '09:00', end: '22:00' },
        subscriptionTier: 'free',
        isActive: true,
        isOpenNow: true,
        isOffline: false,
        // No partner login: the owner sets phone + password in Admin > Stores > Partner login.
        phone: null,
        whatsappNumber: null,
        password: null,
      }, { transaction: t }));
      if (created) result.storesCreated++;
    }

    const entry = done.get(data.key);
    if (!entry || entry.kind !== KIND_STORE) continue; // name was taken: never fill someone else's store
    const storeId = entry.targetId;
    if (!(await Restaurant.count({ where: { id: storeId } }))) { result.storesDeleted++; continue; } // admin deleted it

    for (const [idx, it] of data.items.entries()) {
      const key = `${data.key}:${it.slug}`;
      if (done.has(key)) continue;
      const imageUrl = it.image ? await savePhoto(dataDir, data, it.image, 'menu') : null;
      const ok = await recordOnce(key, KIND_ITEM, { storeKey: data.key, name: it.name }, (id, t) => MenuItem.create({
        id,
        restaurantId: storeId,
        name: it.name,
        price: Number(it.price),
        description: it.description || null,
        imageUrl,
        category: it.category || null,
        tags: [],
        isVegetarian: it.dietType === 'veg',
        dietType: it.dietType,
        isAvailable: true,
        // Nothing internal in specs: the customer app lists every spec it does not know as a product detail
        // ("Owner menu key: ..." showed on the dish page, 1 Nov). The ledger keeps the import key. sortOrder
        // (hidden by the apps) keeps the menu in the card's order (utils/menuSort).
        specs: { sortOrder: (idx + 1) * 10 },
      }, { transaction: t }));
      if (ok) result.itemsCreated++;
    }
    result.photosUpdated += await syncPhotos({ dataDir, data, storeId, done, Restaurant, MenuItem, savePhoto });
    result.textsUpdated += await syncDescriptions({ data, storeId, done, Restaurant, MenuItem });
    result.dishesOrdered += await syncSortOrder({ data, done, MenuItem });
  }

  if (result.storesCreated || result.itemsCreated || result.photosUpdated || result.textsUpdated || result.dishesOrdered) {
    try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  }
  return result;
};

module.exports = { runOwnerMenuImport, menuProblems, loadMenus, DATA_DIR };

// CLI: node scripts/owner_menu_import.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    console.log('[OWNER_MENUS]', await runOwnerMenuImport());
    process.exit(0);
  })().catch((err) => { console.error('[OWNER_MENUS_FAILED]', err); process.exit(1); });
}
