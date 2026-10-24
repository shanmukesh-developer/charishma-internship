// Catalogue clean-up v4: gifts (scripts/catalogue_cleanup_import.js + data/catalogue_cleanup_v4_2026-10-24.json)
// on temp SQLite DBs: the first run creates every reviewed gift (category Gifts) in Toy Mania in one transaction
// and writes GlobalConfig CATALOGUE_CLEANUP_V4_DONE; a re-run (with or without the marker) never makes a
// duplicate; an item that already has the same name in that store (any case, hidden too) is skipped and left
// untouched; the existing toys are never changed; a missing store creates nothing; v4 runs after v3 and never
// touches the v1 / v2 / v3 markers. Never touches a real database or the network.
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
const {
  runCatalogueCleanup, runCatalogueCleanups, buildCreate, DEFAULT_MARKER, V2_MARKER, V3_DATA_PATH, V3_MARKER, V4_DATA_PATH, V4_MARKER, VERSIONS,
} = r('scripts/catalogue_cleanup_import');
const data = JSON.parse(fs.readFileSync(V4_DATA_PATH, 'utf8'));
const [store] = data.stores;
const gifts = store.items.map((i) => i.ops[0].to);
const files = [];
const TOY = { name: 'Soft Plush Teddy Bear', price: 299, category: 'Games & plushies' };

// A fresh temp DB with Toy Mania (and one existing toy in it), or without the store.
const freshDb = async ({ withStore = true } = {}) => {
  if (ctx) await ctx.sequelize.close();
  const file = path.join(os.tmpdir(), `catalogue-cleanup-v4-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  files.push(file);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  await sequelize.sync();
  const M = sequelize.models;
  if (withStore) {
    await M.Restaurant.create({ id: store.storeId, name: store.storeName, location: 'SRM AP', vendorType: 'TOYS', isActive: true });
    await M.MenuItem.create({ restaurantId: store.storeId, ...TOY, isAvailable: true });
  }
  ctx = { sequelize, M };
  return M;
};
const giftRows = (M) => M.MenuItem.findAll({ where: { restaurantId: store.storeId, category: 'Gifts' } });

test.after(async () => {
  if (ctx) await ctx.sequelize.close();
  ctx = null;
  for (const f of files) for (const x of [f, `${f}-journal`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
});

test('v4 data file: own marker, runs after v3, about 12 reviewed gifts in Toy Mania, whole rupees, honest copy', () => {
  assert.strictEqual(data.version, 4);
  assert.strictEqual(data.marker, V4_MARKER);
  assert.strictEqual(V4_MARKER, 'CATALOGUE_CLEANUP_V4_DONE');
  assert.ok(![DEFAULT_MARKER, V2_MARKER, V3_MARKER].includes(V4_MARKER));
  assert.strictEqual(VERSIONS[VERSIONS.length - 1], V4_DATA_PATH, 'v4 runs last');
  assert.strictEqual(VERSIONS.indexOf(V3_DATA_PATH), VERSIONS.indexOf(V4_DATA_PATH) - 1, 'v4 runs right after v3');
  assert.strictEqual(data.stores.length, 1);
  assert.strictEqual(store.storeName, 'Toy Mania');
  assert.strictEqual(store.storeId, 'cf1a41c6-3dac-41c2-a96c-b6eb1d2e522f');
  assert.ok(gifts.length >= 10 && gifts.length <= 14, `${gifts.length} gifts`);
  const names = new Set();
  for (const item of store.items) {
    assert.ok(!item.id && item.ops.length === 1 && item.ops[0].op === 'create' && item.ops[0].reason);
    const p = item.ops[0].to;
    assert.ok(!names.has(p.name.toLowerCase()), `${p.name} listed once`);
    names.add(p.name.toLowerCase());
    assert.strictEqual(p.category, 'Gifts');
    assert.ok(Number.isInteger(p.price) && p.price > 0 && p.price < 1000, `${p.name}: whole rupees, campus price`);
    if (p.originalPrice !== undefined) {
      assert.ok(Number.isInteger(p.originalPrice) && p.originalPrice > p.price, `${p.name}: MRP above price`);
      assert.ok((p.originalPrice - p.price) / p.originalPrice < 0.3, `${p.name}: under 30% off`);
    }
    assert.ok(p.brand && p.brand.length <= 60, `${p.name}: brand`);
    assert.ok(p.weight && p.weight.length <= 30, `${p.name}: size`);
    assert.match(p.imageUrl, /^https:\/\/images\.unsplash\.com\/photo-/);
    assert.ok(p.description.length <= 120, `${p.name}: short description`);
    assert.ok(!/best\b|no\.? ?1|#1|perfect|amazing|premium|luxury|guarantee|healthy|cure|boost/i.test(p.description), `${p.name}: no ad copy or claims`);
    assert.ok(!/flower|rose|bouquet|cake|fresh/i.test(p.name), `${p.name}: nothing perishable`);
    assert.strictEqual(p.isVegetarian, true);
    assert.strictEqual(p.dietType, 'veg');
    assert.ok(buildCreate(store.storeId, item, 'catalogue-cleanup-v4'), `${p.name}: valid create op`);
  }
  for (const kind of [/birthday.*card/i, /thank you.*card/i, /chocolate.*box/i, /dry fruit.*box/i, /hamper/i, /photo frame/i, /mug/i, /keychain/i, /wrap/i, /ribbon/i, /candle/i, /teddy/i]) {
    assert.ok(gifts.some((p) => kind.test(p.name)), `has ${kind}`);
  }
  assert.ok(!gifts.some((p) => p.name.toLowerCase() === TOY.name.toLowerCase()), 'never re-adds the existing teddy');
  const photos = new Set(gifts.map((p) => p.imageUrl));
  assert.strictEqual(photos.size, gifts.length, 'one photo per gift');
});

test('first run creates every gift once in Toy Mania and writes the v4 marker; a re-run is a no-op', async () => {
  const M = await freshDb();
  cacheClears = 0;
  const first = await runCatalogueCleanup({ dataPath: V4_DATA_PATH });
  assert.strictEqual(first.storesFailed, 0);
  assert.strictEqual(first.skipped, 0);
  assert.strictEqual(first.created, gifts.length);
  assert.strictEqual(first.applied, gifts.length);
  assert.ok(cacheClears >= 1, 'store cache cleared');

  const rows = await giftRows(M);
  assert.strictEqual(rows.length, gifts.length);
  for (const p of gifts) {
    const row = rows.find((x) => x.name === p.name);
    assert.ok(row, `${p.name} created`);
    assert.strictEqual(row.price, p.price);
    assert.strictEqual(row.originalPrice, p.originalPrice === undefined ? null : p.originalPrice);
    assert.strictEqual(row.isAvailable, true);
    assert.strictEqual(row.imageUrl, p.imageUrl);
    assert.strictEqual(row.description, p.description);
    assert.deepStrictEqual(row.specs, { brand: p.brand, weight: p.weight, addedBy: 'catalogue-cleanup-v4' });
  }
  const toy = await M.MenuItem.findOne({ where: { restaurantId: store.storeId, name: TOY.name } });
  assert.ok(toy && toy.price === TOY.price && toy.category === TOY.category, 'the existing toy is untouched');
  assert.strictEqual(await M.MenuItem.count({ where: { restaurantId: store.storeId } }), gifts.length + 1);
  const mark = await M.GlobalConfig.findOne({ where: { key: V4_MARKER } });
  assert.ok(mark && mark.value.created === gifts.length);
  for (const other of [DEFAULT_MARKER, V2_MARKER, V3_MARKER]) assert.strictEqual(await M.GlobalConfig.findOne({ where: { key: other } }), null);

  assert.deepStrictEqual(await runCatalogueCleanup({ dataPath: V4_DATA_PATH }), { skipped: 'already done' });
  // Even without the marker, the name guard keeps it idempotent: nothing is created twice.
  await mark.destroy();
  const again = await runCatalogueCleanup({ dataPath: V4_DATA_PATH });
  assert.strictEqual(again.created, 0);
  assert.strictEqual(again.skipped, gifts.length);
  assert.strictEqual((await giftRows(M)).length, gifts.length);
});

test('an item with the same name already in Toy Mania (any case, even hidden) is skipped and left as it was', async () => {
  const M = await freshDb();
  const [a, b] = gifts;
  const mine = await M.MenuItem.create({ restaurantId: store.storeId, name: `  ${a.name.toUpperCase()} `, price: 55, category: 'Cards', isAvailable: true });
  const hidden = await M.MenuItem.create({ restaurantId: store.storeId, name: b.name, price: 10, category: 'Old', isAvailable: false });
  await M.MenuItem.create({ restaurantId: crypto.randomUUID(), name: gifts[2].name, price: 1, category: 'Gifts' });

  const res = await runCatalogueCleanup({ dataPath: V4_DATA_PATH });
  assert.strictEqual(res.storesFailed, 0);
  assert.strictEqual(res.created, gifts.length - 2);
  assert.strictEqual(res.skipped, 2);
  assert.deepStrictEqual(new Set(res.skippedNames), new Set([a.name, b.name]));
  const m = await M.MenuItem.findByPk(mine.id);
  assert.strictEqual(m.price, 55);
  assert.strictEqual(m.category, 'Cards');
  const h = await M.MenuItem.findByPk(hidden.id);
  assert.strictEqual(h.isAvailable, false);
  assert.strictEqual(await M.MenuItem.count({ where: { restaurantId: store.storeId, name: b.name } }), 1);
  assert.ok(await M.MenuItem.findOne({ where: { restaurantId: store.storeId, name: gifts[2].name } }), 'a name in another store does not block it');
});

test('a missing store creates nothing; runCatalogueCleanups runs v4 after v3 and both only once', async () => {
  let M = await freshDb({ withStore: false });
  const res = await runCatalogueCleanup({ dataPath: V4_DATA_PATH });
  assert.strictEqual(res.created, 0);
  assert.strictEqual(res.skipped, gifts.length);
  assert.strictEqual(await M.MenuItem.count(), 0);

  M = await freshDb();
  for (const key of [DEFAULT_MARKER, V2_MARKER]) await M.GlobalConfig.create({ key, value: { doneAt: 'earlier' }, description: 'done' });
  const all = await runCatalogueCleanups();
  assert.deepStrictEqual(Object.keys(all), ['v1', 'v2', 'v3', 'v4']);
  assert.strictEqual(all.v4.created, gifts.length);
  assert.ok(await M.GlobalConfig.findOne({ where: { key: V4_MARKER } }));
  const again = await runCatalogueCleanups();
  assert.deepStrictEqual(again.v4, { skipped: 'already done' });
  assert.strictEqual((await giftRows(M)).length, gifts.length);
});
