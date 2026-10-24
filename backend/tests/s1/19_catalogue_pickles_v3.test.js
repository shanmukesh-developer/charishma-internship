// Catalogue clean-up v3: pickles (scripts/catalogue_cleanup_import.js + data/catalogue_cleanup_v3_2026-10-24.json)
// on temp SQLite DBs: the first run creates every reviewed pickle in the campus grocery store in one
// transaction and writes GlobalConfig CATALOGUE_CLEANUP_V3_DONE; a re-run (with or without the marker) never
// makes a duplicate; an item that already has the same name in that store (any case, hidden too) is skipped
// and left untouched; a missing store creates nothing; malformed create ops are refused; v3 never touches the
// v1 / v2 markers. Never touches a real database or the network.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.DISABLE_CATALOGUE_CLEANUP;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const r = (rel) => require(path.join(B, rel));
const stub = (rel, exports) => {
  const p = require.resolve(path.join(B, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

let ctx = null;
stub('config/db.js', { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {} });
let cacheClears = 0;
stub('controllers/adminController.js', { clearRestaurantsCache: () => { cacheClears++; } });
stub('utils/responseCache.js', { invalidate: () => {} });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const { runCatalogueCleanup, buildCreate, DEFAULT_MARKER, V2_MARKER, V3_DATA_PATH, V3_MARKER, VERSIONS } = r('scripts/catalogue_cleanup_import');
const data = JSON.parse(fs.readFileSync(V3_DATA_PATH, 'utf8'));
const [store] = data.stores;
const picks = store.items.map((i) => i.ops[0].to);
const files = [];

// A fresh temp DB with the campus grocery store (and one staple already in it), or without the store.
const freshDb = async ({ withStore = true } = {}) => {
  if (ctx) await ctx.sequelize.close();
  const file = path.join(os.tmpdir(), `catalogue-cleanup-v3-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  files.push(file);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  await sequelize.sync();
  const M = sequelize.models;
  if (withStore) {
    await M.Restaurant.create({ id: store.storeId, name: store.storeName, location: 'SRM AP', vendorType: 'GROCERY', isActive: true });
    await M.MenuItem.create({ restaurantId: store.storeId, name: 'Aashirvaad Shudh Chakki Atta', price: 260, category: 'Atta & Flours', isAvailable: true });
  }
  ctx = { sequelize, M };
  return M;
};
const pickleRows = (M) => M.MenuItem.findAll({ where: { restaurantId: store.storeId, category: 'Pickles' } });

test.after(async () => {
  if (ctx) await ctx.sequelize.close();
  ctx = null;
  for (const f of files) for (const x of [f, `${f}-journal`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
});

test('v3 data file: own marker, about 12 reviewed pickles, whole-rupee prices, MRP under 30% off, honest copy', () => {
  assert.strictEqual(data.version, 3);
  assert.strictEqual(data.marker, V3_MARKER);
  assert.ok(![DEFAULT_MARKER, V2_MARKER].includes(V3_MARKER));
  assert.strictEqual(VERSIONS[VERSIONS.length - 1], V3_DATA_PATH, 'v3 runs last');
  assert.strictEqual(data.stores.length, 1);
  assert.strictEqual(store.storeName, 'Kirana & Late-Night Mart');
  assert.ok(picks.length >= 10 && picks.length <= 14, `${picks.length} pickles`);
  const names = new Set();
  for (const item of store.items) {
    assert.ok(!item.id && item.ops.length === 1 && item.ops[0].op === 'create' && item.ops[0].reason);
    const p = item.ops[0].to;
    assert.ok(!names.has(p.name.toLowerCase()), `${p.name} listed once`);
    names.add(p.name.toLowerCase());
    assert.strictEqual(p.category, 'Pickles');
    assert.ok(Number.isInteger(p.price) && p.price > 0, `${p.name}: whole rupees`);
    if (p.originalPrice !== undefined) {
      assert.ok(Number.isInteger(p.originalPrice) && p.originalPrice > p.price, `${p.name}: MRP above price`);
      assert.ok((p.originalPrice - p.price) / p.originalPrice < 0.3, `${p.name}: under 30% off`);
    }
    assert.ok(['Priya', "Mother's Recipe", "Nilon's", 'Ruchi', 'Campus kitchen'].includes(p.brand), p.brand);
    assert.match(p.weight, /^\d+ g$/);
    assert.match(p.imageUrl, /^https:\/\/images\.unsplash\.com\/photo-/);
    assert.ok(p.description.length <= 120, `${p.name}: short description`);
    assert.ok(!/healthy|health|immun|digest|vitamin|cure|boost|detox|best\b|no\.? ?1|#1/i.test(p.description), `${p.name}: no health claims or ad copy`);
    assert.strictEqual(p.isVegetarian, p.dietType === 'veg');
    assert.ok(buildCreate(store.storeId, item), `${p.name}: valid create op`);
  }
  const nonVeg = picks.filter((p) => !p.isVegetarian);
  assert.ok(nonVeg.length <= 2 && nonVeg.every((p) => /chicken|prawn|mutton|fish/i.test(p.name)), 'at most 2 non-veg, clearly named');
  for (const kind of [/avakaya|mango/i, /gongura/i, /lemon/i, /tomato/i, /garlic/i, /mixed/i, /ginger/i, /amla/i, /red chilli/i]) {
    assert.ok(picks.some((p) => kind.test(p.name)), `has ${kind}`);
  }
  const photos = new Set(picks.map((p) => p.imageUrl));
  assert.ok(photos.size >= 2 && photos.size <= 4, `${photos.size} different photos`);
});

test('first run creates every pickle once in the store and writes the v3 marker; a re-run is a no-op', async () => {
  const M = await freshDb();
  cacheClears = 0;
  const first = await runCatalogueCleanup({ dataPath: V3_DATA_PATH });
  assert.strictEqual(first.storesFailed, 0);
  assert.strictEqual(first.skipped, 0);
  assert.strictEqual(first.created, picks.length);
  assert.strictEqual(first.applied, picks.length);
  assert.ok(cacheClears >= 1, 'store cache cleared');

  const rows = await pickleRows(M);
  assert.strictEqual(rows.length, picks.length);
  for (const p of picks) {
    const row = rows.find((x) => x.name === p.name);
    assert.ok(row, `${p.name} created`);
    assert.strictEqual(row.price, p.price);
    assert.strictEqual(row.originalPrice, p.originalPrice === undefined ? null : p.originalPrice);
    assert.strictEqual(row.isVegetarian, p.isVegetarian);
    assert.strictEqual(row.dietType, p.dietType);
    assert.strictEqual(row.isAvailable, true);
    assert.strictEqual(row.imageUrl, p.imageUrl);
    assert.strictEqual(row.description, p.description);
    assert.deepStrictEqual(row.specs, { brand: p.brand, weight: p.weight, addedBy: 'catalogue-cleanup-v3' });
  }
  assert.strictEqual(await M.MenuItem.count({ where: { restaurantId: store.storeId } }), picks.length + 1, 'the staple is still there');
  const mark = await M.GlobalConfig.findOne({ where: { key: V3_MARKER } });
  assert.ok(mark && mark.value.created === picks.length);
  assert.strictEqual(await M.GlobalConfig.findOne({ where: { key: DEFAULT_MARKER } }), null);
  assert.strictEqual(await M.GlobalConfig.findOne({ where: { key: V2_MARKER } }), null);

  assert.deepStrictEqual(await runCatalogueCleanup({ dataPath: V3_DATA_PATH }), { skipped: 'already done' });
  // Even without the marker, the name guard keeps it idempotent: nothing is created twice.
  await mark.destroy();
  const again = await runCatalogueCleanup({ dataPath: V3_DATA_PATH });
  assert.strictEqual(again.created, 0);
  assert.strictEqual(again.skipped, picks.length);
  assert.strictEqual((await pickleRows(M)).length, picks.length);
});

test('an item with the same name already in the store (any case, even hidden) is skipped and left as it was', async () => {
  const M = await freshDb();
  const [a, b] = picks;
  const mine = await M.MenuItem.create({ restaurantId: store.storeId, name: `  ${a.name.toUpperCase()} `, price: 99, category: 'Gourmet', isAvailable: true });
  const hidden = await M.MenuItem.create({ restaurantId: store.storeId, name: b.name, price: 10, category: 'Old', isAvailable: false });
  // the same name in ANOTHER store does not block it
  await M.MenuItem.create({ restaurantId: crypto.randomUUID(), name: picks[2].name, price: 1, category: 'Pickles' });

  const res = await runCatalogueCleanup({ dataPath: V3_DATA_PATH });
  assert.strictEqual(res.storesFailed, 0);
  assert.strictEqual(res.created, picks.length - 2);
  assert.strictEqual(res.skipped, 2);
  assert.deepStrictEqual(new Set(res.skippedNames), new Set([a.name, b.name]));
  const m = await M.MenuItem.findByPk(mine.id);
  assert.strictEqual(m.price, 99);
  assert.strictEqual(m.category, 'Gourmet');
  const h = await M.MenuItem.findByPk(hidden.id);
  assert.strictEqual(h.isAvailable, false);
  assert.strictEqual(h.price, 10);
  assert.strictEqual(await M.MenuItem.count({ where: { restaurantId: store.storeId, name: b.name } }), 1);
  assert.ok(await M.MenuItem.findOne({ where: { restaurantId: store.storeId, name: picks[2].name } }));
});

test('a missing store creates nothing; malformed create ops are refused', async () => {
  const M = await freshDb({ withStore: false });
  const res = await runCatalogueCleanup({ dataPath: V3_DATA_PATH });
  assert.strictEqual(res.created, 0);
  assert.strictEqual(res.skipped, picks.length);
  assert.strictEqual(await M.MenuItem.count(), 0);

  const good = store.items[0];
  const withTo = (patch) => ({ ops: [{ op: 'create', to: { ...good.ops[0].to, ...patch } }] });
  assert.ok(buildCreate(store.storeId, good));
  assert.strictEqual(buildCreate(store.storeId, { ...good, id: crypto.randomUUID() }), null, 'create never takes an id');
  assert.strictEqual(buildCreate(store.storeId, { ops: [...good.ops, { op: 'hide' }] }), null, 'create is the only op');
  assert.strictEqual(buildCreate(store.storeId, withTo({ price: 99.5 })), null, 'whole rupees');
  assert.strictEqual(buildCreate(store.storeId, withTo({ name: ' ' })), null);
  assert.strictEqual(buildCreate(store.storeId, withTo({ imageUrl: 'https://example.com/a.jpg' })), null, 'Unsplash / Pexels only');
  assert.strictEqual(buildCreate(store.storeId, withTo({ isVegetarian: true, dietType: 'nonveg' })), null, 'diet must agree');
  assert.strictEqual(buildCreate(store.storeId, withTo({ originalPrice: 12.5 })), null);
  assert.strictEqual(buildCreate(store.storeId, withTo({ originalPrice: 100 })).originalPrice, null, 'an MRP below the price is dropped');
  assert.strictEqual(buildCreate(store.storeId, withTo({ description: 'x'.repeat(501) })), null);
  assert.strictEqual(buildCreate(null, good), null);
});
