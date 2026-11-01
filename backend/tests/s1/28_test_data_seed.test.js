// Test data (scripts/test_data_seed.js) on a temp SQLite DB: nothing happens before the store removal finished
// (REMOVE_ALL_STORES_V2_DONE); the first run creates the six "ZCS Test" stores with their menus and writes the
// TEST_DATA_V1_DONE marker; with the marker it never runs again; without it a rerun creates no duplicates,
// never overwrites an admin edit and never re-creates a deleted store or item; a store whose name is taken is
// never created or filled; no store gets a partner login, UPI ID, FSSAI number, rating or offer; and
// DISABLE_TEST_DATA=true switches it off. Also checks the shipped data file. Never touches a real database or
// the network.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.DISABLE_TEST_DATA;

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

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const { runTestDataSeed, DATA_PATH, MARKER } = r('scripts/test_data_seed');
const { LOCAL_VENDOR_TYPES } = r('utils/vendorTypes');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const totalItems = data.stores.reduce((n, s) => n + s.items.length, 0);

test.before(async () => {
  const file = path.join(os.tmpdir(), `test-data-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  await sequelize.sync();
  ctx = { sequelize, file, M: sequelize.models };
});

test.after(async () => {
  if (!ctx) return;
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
});

const storeRow = (name) => ctx.M.Restaurant.findOne({ where: { name } });
const countFor = (id) => ctx.M.MenuItem.count({ where: { restaurantId: id } });
const dropMarker = () => ctx.M.GlobalConfig.destroy({ where: { key: MARKER } });

test('data file: six invented "ZCS Test" stores, one per section, unique keys, working-format Unsplash photos, sane items', () => {
  assert.strictEqual(data.stores.length, 6);
  assert.deepStrictEqual(data.stores.map((s) => s.vendorType).sort(), ['BAKERY', 'CAFE', 'GROCERY', 'LOCAL_VENDOR', 'RESTAURANT', 'STATIONERY']);
  assert.ok(LOCAL_VENDOR_TYPES.includes('LOCAL_VENDOR'));
  const photo = /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?w=600&q=70&auto=format&fit=crop$/;
  const keys = new Set();
  for (const s of data.stores) {
    assert.match(s.name, /^ZCS Test /, 'every store name says it is a test store');
    assert.match(s.key, /^test-data-v1:[a-z0-9-]+$/, s.name);
    assert.ok(!keys.has(s.key));
    keys.add(s.key);
    assert.match(s.imageUrl, photo, `${s.name} image`);
    assert.ok(/testing only\.$/.test(s.stallDescription), `${s.name} says orders are for testing`);
    assert.ok(Array.isArray(s.tags) && s.tags.includes('test'), `${s.name} tags`);
    assert.ok(s.items.length >= 4 && s.items.length <= 15, `${s.name}: ${s.items.length} items`);
    for (const i of s.items) {
      assert.ok(i.key.startsWith(`${s.key}:`), i.key);
      assert.ok(!keys.has(i.key), `duplicate key ${i.key}`);
      keys.add(i.key);
      assert.ok(Number.isInteger(i.price) && i.price >= 10 && i.price <= 1000, `${i.name} price ${i.price}`);
      assert.ok(i.dietType === null || ['veg', 'nonveg', 'egg'].includes(i.dietType), `${i.name} diet`);
      assert.match(i.imageUrl, photo, `${i.name} image`);
      assert.ok(i.description.endsWith('Test item.'), `${i.name} description`);
      assert.ok(i.category, `${i.name} category`);
    }
  }
  assert.strictEqual(data.defaults.operatingHours.start, '00:00');
  assert.strictEqual(data.defaults.operatingHours.end, '23:59');
});

test('waits for the store removal: nothing is created before REMOVE_ALL_STORES_V2_DONE exists', async () => {
  const res = await runTestDataSeed();
  assert.deepStrictEqual(res, { skipped: 'store removal not finished' });
  assert.strictEqual(await ctx.M.Restaurant.count(), 0);
  await ctx.M.GlobalConfig.create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });
});

test('first run creates every store and item, live and open, with no login, UPI, FSSAI, rating or offer, then writes the marker', async () => {
  const res = await runTestDataSeed();
  assert.deepStrictEqual(res, { storesCreated: 6, storesSkippedNameTaken: 0, storesDeleted: 0, itemsCreated: totalItems });
  assert.ok(cacheClears >= 1, 'the store list cache is cleared');
  const stores = await ctx.M.Restaurant.findAll();
  assert.strictEqual(stores.length, 6);
  for (const s of stores) {
    assert.strictEqual(s.password, null, `${s.name} has no partner password`);
    assert.strictEqual(s.phone, null);
    assert.strictEqual(s.whatsappNumber, null);
    assert.ok(!s.campusUpiId && !s.campusBookingEnabled, `${s.name} has no UPI / In-Campus Booking`);
    assert.strictEqual(s.fssaiLicenseNumber == null, true, `${s.name} has no invented FSSAI number`);
    assert.strictEqual(s.rating, 0);
    assert.strictEqual(s.promoOffer, null);
    assert.strictEqual(s.visibleCampuses, null, 'serves every college');
    assert.strictEqual(s.isActive, true);
    assert.strictEqual(s.isOpenNow, true);
    assert.deepStrictEqual(s.operatingHours, { start: '00:00', end: '23:59' });
    assert.ok(s.publishedAt, `${s.name} counts as published`);
  }
  const kitchen = await storeRow('ZCS Test Kitchen');
  assert.strictEqual(await countFor(kitchen.id), data.stores.find((s) => s.name === 'ZCS Test Kitchen').items.length);
  const biryani = await ctx.M.MenuItem.findOne({ where: { name: 'Chicken Dum Biryani' } });
  assert.strictEqual(biryani.dietType, 'nonveg');
  assert.strictEqual(biryani.isVegetarian, false);
  const detergent = await ctx.M.MenuItem.findOne({ where: { name: 'Detergent Powder (1 kg)' } });
  assert.strictEqual(detergent.dietType, null, 'non-food items carry no diet mark');
  const marker = await ctx.M.GlobalConfig.findOne({ where: { key: MARKER } });
  assert.ok(marker, 'marker written');
  assert.strictEqual(JSON.parse(marker.value).storeIds.length, 6);
});

test('with the marker it never runs again', async () => {
  assert.deepStrictEqual(await runTestDataSeed(), { skipped: 'already done' });
  assert.strictEqual(await ctx.M.Restaurant.count(), 6);
});

test('without the marker a rerun adds nothing, keeps admin edits and never re-creates deleted stores or items', async () => {
  const cafe = await storeRow('ZCS Test Cafe');
  const edited = await ctx.M.MenuItem.findOne({ where: { restaurantId: cafe.id, name: 'Lemon Tea' } });
  await edited.update({ name: 'Lemon Ice Tea', price: 35 });
  const removedItem = await ctx.M.MenuItem.findOne({ where: { restaurantId: cafe.id, name: 'Hot Coffee' } });
  await removedItem.destroy();
  const bakery = await storeRow('ZCS Test Bakery');
  await ctx.M.MenuItem.destroy({ where: { restaurantId: bakery.id } });
  await bakery.destroy();
  await dropMarker();

  const res = await runTestDataSeed();
  assert.deepStrictEqual(res, { storesCreated: 0, storesSkippedNameTaken: 0, storesDeleted: 1, itemsCreated: 0 });
  assert.strictEqual(await ctx.M.Restaurant.count(), 5, 'the deleted bakery stays deleted');
  assert.ok(await ctx.M.MenuItem.findOne({ where: { name: 'Lemon Ice Tea', price: 35 } }), 'admin edit kept');
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { name: 'Lemon Tea' } }), 0);
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { name: 'Hot Coffee' } }), 0, 'deleted item stays deleted');
  assert.strictEqual(JSON.parse((await ctx.M.GlobalConfig.findOne({ where: { key: MARKER } })).value).storeIds.length, 5);
});

test('a store name already in use is never created or filled', async () => {
  // Fresh ledger + stores, then an owner store that happens to use a test name (any case).
  await ctx.M.MenuItem.destroy({ where: {} });
  await ctx.M.Restaurant.destroy({ where: {} });
  await ctx.M.CatalogueImportLedger.destroy({ where: {} });
  await dropMarker();
  const own = await ctx.M.Restaurant.create({ name: 'zcs test mart', location: 'Owner store', vendorType: 'GROCERY' });
  const res = await runTestDataSeed();
  assert.strictEqual(res.storesSkippedNameTaken, 1);
  assert.strictEqual(res.storesCreated, 5);
  assert.strictEqual(await countFor(own.id), 0, "the owner's store gets no test items");
  assert.strictEqual(await ctx.M.Restaurant.count({ where: { location: 'Owner store' } }), 1);
});

test('DISABLE_TEST_DATA=true switches it off', async () => {
  await dropMarker();
  process.env.DISABLE_TEST_DATA = 'true';
  try {
    assert.deepStrictEqual(await runTestDataSeed(), { skipped: 'disabled' });
  } finally {
    delete process.env.DISABLE_TEST_DATA;
  }
});
