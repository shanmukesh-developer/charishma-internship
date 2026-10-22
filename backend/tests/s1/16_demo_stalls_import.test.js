// Demo CampusBites stalls (scripts/demo_stalls_import.js) on a temp SQLite DB: the first run creates the 16
// LOCAL_VENDOR stalls (13 food, 3 product stalls) with their menus, a second run is a no-op, an admin edit is never overwritten, a
// deleted stall or item is never re-created, a stall whose name is already taken is never created or
// filled, no stall gets a partner login, and DISABLE_DEMO_STALLS=true switches it off. Also checks the
// shipped data file (16 categories, 8-12 items, verified images.unsplash.com photos, sane prices).
// Never touches a real database or the network.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.DISABLE_DEMO_STALLS;

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
const { runDemoStallsImport, DATA_PATH } = r('scripts/demo_stalls_import');
const { TEMPLATE_NAMES } = r('scripts/remove_template_menu_items');
const { LOCAL_VENDOR_TYPES } = r('utils/vendorTypes');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const totalItems = data.stalls.reduce((n, s) => n + s.items.length, 0);

test.before(async () => {
  const file = path.join(os.tmpdir(), `demo-stalls-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(sequelize);
  await sequelize.sync();
  ctx = { sequelize, file, M: sequelize.models };
});

test.after(async () => {
  if (!ctx) return;
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  ctx = null;
});

const stallRow = (name) => ctx.M.Restaurant.findOne({ where: { name } });
const countFor = (id) => ctx.M.MenuItem.count({ where: { restaurantId: id } });

test('data file: 16 stalls in 16 categories (13 food, 3 products), 8-12 items each, unique keys, verified Unsplash photos only', () => {
  assert.strictEqual(data.stalls.length, 16);
  assert.strictEqual(new Set(data.stalls.map((s) => s.foodCategory)).size, 16, 'one stall per category');
  assert.strictEqual(data.stalls.filter((s) => s.kind === 'food').length, 13);
  assert.strictEqual(data.stalls.filter((s) => s.kind === 'products').length, 3);
  assert.strictEqual(new Set(data.stalls.map((s) => s.name.toLowerCase())).size, 16, 'unique stall names');
  // Every Home "Popular dishes" category has at least one stall.
  const allTags = data.stalls.flatMap((s) => s.tags);
  for (const t of ['biryani', 'pizza', 'burgers', 'dosa', 'juice', 'shakes', 'chinese', 'momos', 'rolls', 'bakery', 'healthy', 'desserts', 'chaat', 'chai']) {
    assert.ok(allTags.includes(t), `a stall is tagged ${t}`);
  }
  assert.ok(LOCAL_VENDOR_TYPES.includes(data.defaults.vendorType));
  const keys = new Set();
  const photo = /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?w=600&q=70&auto=format&fit=crop$/;
  for (const s of data.stalls) {
    assert.match(s.key, /^demo-stall-v1:[a-z0-9-]+$/, s.name);
    assert.ok(!keys.has(s.key));
    keys.add(s.key);
    assert.ok(s.items.length >= 8 && s.items.length <= 12, `${s.name}: ${s.items.length} items`);
    assert.ok(s.location && s.stallDescription && s.stallDescription.endsWith('.'), `${s.name} fields`);
    assert.match(s.operatingHours.start, /^\d{2}:\d{2}$/);
    assert.match(s.operatingHours.end, /^\d{2}:\d{2}$/);
    assert.ok(Array.isArray(s.tags) && s.tags.length >= 3, `${s.name} tags`);
    assert.match(s.imageUrl, photo, `${s.name} image`);
    assert.ok(!('phone' in s) && !('whatsappNumber' in s) && !('password' in s), `${s.name} has no contact or login`);
    const names = new Set();
    for (const i of s.items) {
      assert.ok(i.key.startsWith(`${s.key}:`), i.key);
      assert.ok(!keys.has(i.key), `unique key ${i.key}`);
      keys.add(i.key);
      assert.ok(!names.has(i.name.toLowerCase()), `${s.name}: ${i.name} listed once`);
      names.add(i.name.toLowerCase());
      assert.ok(Number.isInteger(i.price) && i.price >= 1 && i.price <= 300, `${i.name} price`);
      assert.ok(i.category && i.description && i.description.endsWith('.'), `${i.name} fields`);
      if (s.kind === 'food') assert.ok(['veg', 'nonveg', 'egg'].includes(i.dietType), `${i.name} diet`);
      else assert.ok(i.dietType === null || i.dietType === 'veg', `${i.name}: products are unmarked or veg`);
      assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(i.name + i.description), `${i.name} no emoji`);
      if (i.imageUrl !== null) assert.match(i.imageUrl, photo, `${i.name} image`);
      assert.ok(!/wikimedia/i.test(String(i.imageUrl)), 'never Wikimedia');
      // Stock placeholder the app treats as "no photo" (components/SafeImage STOCK_PLACEHOLDER_IDS).
      assert.ok(!/photo-1601050690|photo-1546069901/.test(String(i.imageUrl)), `${i.name} not a stock placeholder`);
      assert.ok(!TEMPLATE_NAMES.some((t) => i.name.startsWith(`${t} (`)), `${i.name} not a template name`);
    }
  }
});

test('first run creates every stall and item as an orderable LOCAL_VENDOR stall with no partner login', async () => {
  const first = await runDemoStallsImport();
  assert.deepStrictEqual(first, { stallsCreated: data.stalls.length, stallsSkippedNameTaken: 0, stallsDeleted: 0, itemsCreated: totalItems });
  assert.ok(cacheClears >= 1, 'restaurant list cache cleared');

  for (const s of data.stalls) {
    const row = await stallRow(s.name);
    assert.ok(row, s.name);
    assert.strictEqual(row.vendorType, 'LOCAL_VENDOR');
    assert.strictEqual(row.campus, 'SRMAP');
    assert.strictEqual(row.isActive, true);
    assert.strictEqual(row.isOpenNow, true);
    assert.strictEqual(row.isOffline, false);
    assert.strictEqual(row.stallDescription, s.stallDescription);
    assert.strictEqual(row.location, s.location);
    assert.deepStrictEqual(row.tags, s.tags);
    assert.deepStrictEqual(row.operatingHours, s.operatingHours);
    assert.strictEqual(row.imageUrl, s.imageUrl);
    assert.strictEqual(row.rating, 0, 'no invented rating');
    assert.strictEqual(row.promoOffer, null, 'no invented offer');
    assert.strictEqual(row.subscriptionTier, 'free');
    // No partner login of any kind.
    assert.strictEqual(row.password, null);
    assert.strictEqual(row.phone, null);
    assert.strictEqual(row.whatsappNumber, null);
    assert.strictEqual(await row.comparePassword(''), false);
    assert.strictEqual(await countFor(row.id), s.items.length);
  }

  const stall = data.stalls.find((s) => s.items.some((i) => i.dietType === 'nonveg'));
  const src = stall.items.find((i) => i.dietType === 'nonveg');
  const item = await ctx.M.MenuItem.findOne({ where: { name: src.name, restaurantId: (await stallRow(stall.name)).id } });
  assert.strictEqual(item.price, src.price);
  assert.strictEqual(item.category, src.category);
  assert.strictEqual(item.description, src.description);
  assert.strictEqual(item.imageUrl, src.imageUrl);
  assert.strictEqual(item.isVegetarian, false);
  assert.strictEqual(item.dietType, 'nonveg');
  assert.strictEqual(item.isAvailable, true);
  assert.strictEqual(item.specs.demoStallKey, src.key);
  const veg = stall.items.find((i) => i.dietType === 'veg');
  assert.strictEqual((await ctx.M.MenuItem.findOne({ where: { name: veg.name, restaurantId: item.restaurantId } })).isVegetarian, true);

  // A non-food product: no diet mark (and not shown as non-veg).
  const shop = data.stalls.find((s) => s.kind === 'products' && s.items.some((i) => i.dietType === null));
  const prod = shop.items.find((i) => i.dietType === null);
  const prodRow = await ctx.M.MenuItem.findOne({ where: { name: prod.name, restaurantId: (await stallRow(shop.name)).id } });
  assert.strictEqual(prodRow.dietType, null);
  assert.strictEqual(prodRow.isVegetarian, true);

  assert.strictEqual(await ctx.M.CatalogueImportLedger.count({ where: { kind: 'demo-stall' } }), data.stalls.length);
  assert.strictEqual(await ctx.M.CatalogueImportLedger.count({ where: { kind: 'demo-stall-item' } }), totalItems);
});

test('second run is a no-op; admin edits are never overwritten; deleted items and stalls are never re-created', async () => {
  const again = await runDemoStallsImport();
  assert.deepStrictEqual(again, { stallsCreated: 0, stallsSkippedNameTaken: 0, stallsDeleted: 0, itemsCreated: 0 });
  assert.strictEqual(await ctx.M.Restaurant.count(), data.stalls.length);
  assert.strictEqual(await ctx.M.MenuItem.count(), totalItems);

  // Admin renames and edits a stall, edits one item and deletes another.
  const [a, b] = data.stalls;
  const stallA = await stallRow(a.name);
  await stallA.update({ name: 'Admin Renamed Stall', stallDescription: 'Changed by the admin.', isActive: false, operatingHours: { start: '10:00', end: '12:00' } });
  const [editSrc, delSrc] = a.items;
  const edited = await ctx.M.MenuItem.findOne({ where: { restaurantId: stallA.id, name: editSrc.name } });
  await edited.update({ name: 'Admin Renamed Dish', price: 999, isAvailable: false });
  await ctx.M.MenuItem.destroy({ where: { restaurantId: stallA.id, name: delSrc.name } });

  // Admin deletes a whole stall (and its items).
  const stallB = await stallRow(b.name);
  await ctx.M.MenuItem.destroy({ where: { restaurantId: stallB.id } });
  await stallB.destroy();

  const third = await runDemoStallsImport();
  assert.strictEqual(third.stallsCreated, 0);
  assert.strictEqual(third.itemsCreated, 0);
  assert.strictEqual(third.stallsDeleted, 1);

  const keptA = await ctx.M.Restaurant.findByPk(stallA.id);
  assert.strictEqual(keptA.name, 'Admin Renamed Stall');
  assert.strictEqual(keptA.stallDescription, 'Changed by the admin.');
  assert.strictEqual(keptA.isActive, false);
  assert.deepStrictEqual(keptA.operatingHours, { start: '10:00', end: '12:00' });
  assert.strictEqual(await ctx.M.Restaurant.count({ where: { name: a.name } }), 0, 'original stall name not re-created');
  assert.strictEqual(await countFor(stallA.id), a.items.length - 1, 'deleted item stays deleted');
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { restaurantId: stallA.id, name: [editSrc.name, delSrc.name] } }), 0);
  const keptItem = await ctx.M.MenuItem.findByPk(edited.id);
  assert.strictEqual(keptItem.name, 'Admin Renamed Dish');
  assert.strictEqual(keptItem.price, 999);
  assert.strictEqual(keptItem.isAvailable, false);

  assert.strictEqual(await ctx.M.Restaurant.count({ where: { name: b.name } }), 0, 'deleted stall stays deleted');
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { name: b.items[0].name } }), 0, 'its items stay deleted');
  assert.strictEqual(await ctx.M.Restaurant.count(), data.stalls.length - 1);
});

test('a stall whose name is already taken is never created, its items never go into the other store', async () => {
  // Fresh ledger + stores (separate data file with one new stall whose name an admin store already uses).
  const custom = {
    version: 1,
    defaults: { campus: 'SRMAP', vendorType: 'LOCAL_VENDOR' },
    stalls: [{
      key: 'demo-stall-v1:test-name-taken', name: 'Owner Chai Stall', foodCategory: 'Chai', location: 'Gate 1',
      imageUrl: null, tags: ['chai'], stallDescription: 'Test stall.', operatingHours: { start: '06:00', end: '20:00' },
      items: [{ key: 'demo-stall-v1:test-name-taken:tea', name: 'Tea', price: 10, category: 'Tea', description: 'Tea.', dietType: 'veg', imageUrl: null }],
    }],
  };
  const file = path.join(os.tmpdir(), `demo-stalls-data-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(file, JSON.stringify(custom));
  try {
    const owner = await ctx.M.Restaurant.create({ name: 'owner chai stall', location: 'Gate 1', vendorType: 'LOCAL_VENDOR', isActive: true });
    const res = await runDemoStallsImport({ dataPath: file });
    assert.deepStrictEqual(res, { stallsCreated: 0, stallsSkippedNameTaken: 1, stallsDeleted: 0, itemsCreated: 0 });
    assert.strictEqual(await countFor(owner.id), 0);
    assert.strictEqual(await ctx.M.Restaurant.count({ where: { name: 'Owner Chai Stall' } }), 0);

    // The owner later renames their store: the demo stall is still never created (decision recorded once).
    await owner.update({ name: 'Owner Tea Point' });
    const later = await runDemoStallsImport({ dataPath: file });
    assert.deepStrictEqual(later, { stallsCreated: 0, stallsSkippedNameTaken: 0, stallsDeleted: 0, itemsCreated: 0 });
    assert.strictEqual(await ctx.M.Restaurant.count({ where: { name: 'Owner Chai Stall' } }), 0);
  } finally {
    try { fs.unlinkSync(file); } catch { /* gone */ }
  }
});

test('DISABLE_DEMO_STALLS=true switches it off', async () => {
  process.env.DISABLE_DEMO_STALLS = 'true';
  try {
    assert.deepStrictEqual(await runDemoStallsImport(), { skipped: 'disabled' });
  } finally { delete process.env.DISABLE_DEMO_STALLS; }
});
