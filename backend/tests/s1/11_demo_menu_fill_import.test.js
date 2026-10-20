// Demo-store menu fill (scripts/demo_menu_fill_import.js) on a temp SQLite DB: idempotent across runs,
// stores matched by id + name, an edited item is never overwritten, a deleted item is never re-added,
// existing items are never touched, names a store already has are skipped, and the 14-item cap holds.
// Also checks the shipped data file (only verified images.unsplash.com photos, sane prices and flags).
// Never touches a real database or the network.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.DISABLE_DEMO_MENU_FILL;

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
const { runDemoMenuFill, DATA_PATH } = r('scripts/demo_menu_fill_import');
const { TEMPLATE_NAMES } = r('scripts/remove_template_menu_items');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const byName = (n) => data.stores.find((s) => s.name === n);

test.before(async () => {
  const file = path.join(os.tmpdir(), `demo-fill-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
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

const mkStore = (id, name) => ctx.M.Restaurant.create({ id, name, location: 'Test block', isActive: true });
const countFor = (id) => ctx.M.MenuItem.count({ where: { restaurantId: id } });
const silent = async (fn) => { const o = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = o; } };

test('data file: every item is relevant-shaped, uniquely keyed, and uses only verified Unsplash photo URLs', () => {
  assert.ok(data.stores.length >= 50, 'covers the demo stores');
  const keys = new Set();
  const ids = new Set();
  for (const s of data.stores) {
    assert.match(s.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `${s.name} id`);
    assert.ok(!ids.has(s.id), `store listed once: ${s.name}`);
    ids.add(s.id);
    assert.ok(s.name && s.items.length > 0, s.id);
    for (const i of s.items) {
      assert.ok(i.key.startsWith(`demo-fill-v1:${s.id}:`), i.key);
      assert.ok(!keys.has(i.key), `unique key ${i.key}`);
      keys.add(i.key);
      assert.ok(Number.isInteger(i.price) && i.price > 0 && i.price < 2000, `${i.name} price`);
      assert.ok(i.category && i.description && i.description.endsWith('.'), `${i.name} fields`);
      assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(i.name + i.description), `${i.name} no emoji`);
      if (i.dietType !== undefined) assert.ok(['veg', 'nonveg', 'egg'].includes(i.dietType), `${i.name} diet`);
      if (i.imageUrl !== null) {
        assert.match(i.imageUrl, /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?w=600&q=70&auto=format&fit=crop$/, `${i.name} image`);
      }
      assert.ok(!/wikimedia/i.test(String(i.imageUrl)), 'never Wikimedia');
      // The template-menu cleanup deletes "<template name> (..." rows: never ship one.
      assert.ok(!TEMPLATE_NAMES.some((t) => i.name.startsWith(`${t} (`)), `${i.name} not a template name`);
    }
  }
  // Real partner stores and the catalogue shelves are never targeted.
  for (const n of ['punnam biryani', 'Nawabi Biryani House', 'Amrutham', 'Habibi Arabian Mandi', 'Apollo Pharmacy (Mangalagiri II)', 'Kirana & Late-Night Mart', 'Campus Rentals', 'Add-ons & Extras', '1234', 'new store']) {
    assert.strictEqual(byName(n), undefined, `${n} is not in the fill list`);
  }
});

test('first run fills matched stores; renamed or missing stores get nothing; existing items untouched', async () => {
  const tandoori = byName('Tandoori Nights');
  const paradise = byName('Paradise Biryani Express');
  const renamed = byName('Burger Bunker');
  await mkStore(tandoori.id, tandoori.name);
  await mkStore(paradise.id, paradise.name);
  await mkStore(renamed.id, 'Burger Bunker (renamed by admin)');
  // Paradise already sells a "Veg Biryani" (owner's own row): ours is skipped, theirs untouched.
  const own = await ctx.M.MenuItem.create({ restaurantId: paradise.id, name: 'Veg Biryani', price: 199, category: 'Mine', isVegetarian: true });
  const ownOther = await ctx.M.MenuItem.create({ restaurantId: paradise.id, name: 'Egg Masala Biryani', price: 210, category: 'Biryani', isVegetarian: false });

  const first = await silent(() => runDemoMenuFill());
  assert.strictEqual(first.itemsCreated, tandoori.items.length + paradise.items.length - 1);
  assert.strictEqual(first.skippedDuplicateName, 1);
  assert.strictEqual(first.storesRenamed, 1);
  assert.strictEqual(first.storesTouched, 2);
  assert.ok(first.storesMissing >= data.stores.length - 3);
  assert.ok(cacheClears >= 1, 'restaurant list cache cleared');

  assert.strictEqual(await countFor(tandoori.id), tandoori.items.length);
  assert.strictEqual(await countFor(paradise.id), paradise.items.length + 1);
  assert.strictEqual(await countFor(renamed.id), 0);

  const ownAfter = await ctx.M.MenuItem.findByPk(own.id);
  assert.strictEqual(ownAfter.price, 199);
  assert.strictEqual(ownAfter.category, 'Mine');
  assert.strictEqual((await ctx.M.MenuItem.findByPk(ownOther.id)).price, 210);
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { restaurantId: paradise.id, name: 'Veg Biryani' } }), 1);

  // Fields and flags come straight from the data file.
  const src = tandoori.items.find((i) => i.dietType === 'nonveg');
  const row = await ctx.M.MenuItem.findOne({ where: { restaurantId: tandoori.id, name: src.name } });
  assert.strictEqual(row.price, src.price);
  assert.strictEqual(row.category, src.category);
  assert.strictEqual(row.description, src.description);
  assert.strictEqual(row.imageUrl, src.imageUrl);
  assert.strictEqual(row.isVegetarian, false);
  assert.strictEqual(row.dietType, 'nonveg');
  assert.strictEqual(row.isAvailable, true);
  assert.strictEqual(row.specs.demoFillKey, src.key);
  const veg = tandoori.items.find((i) => i.dietType === 'veg');
  assert.strictEqual((await ctx.M.MenuItem.findOne({ where: { restaurantId: tandoori.id, name: veg.name } })).isVegetarian, true);
});

test('second run is a no-op; an edited item is never overwritten and a deleted item is never re-added', async () => {
  const tandoori = byName('Tandoori Nights');
  const before = await countFor(tandoori.id);

  const again = await silent(() => runDemoMenuFill());
  assert.strictEqual(again.itemsCreated, 0);
  assert.strictEqual(again.skippedDuplicateName, 0);
  assert.strictEqual(await countFor(tandoori.id), before);

  const [editSrc, delSrc] = tandoori.items;
  const edited = await ctx.M.MenuItem.findOne({ where: { restaurantId: tandoori.id, name: editSrc.name } });
  await edited.update({ name: 'Admin Renamed Dish', price: 999, description: 'Changed by the admin.', imageUrl: null });
  await ctx.M.MenuItem.destroy({ where: { restaurantId: tandoori.id, name: delSrc.name } });

  const third = await silent(() => runDemoMenuFill());
  assert.strictEqual(third.itemsCreated, 0);
  assert.strictEqual(await countFor(tandoori.id), before - 1, 'deleted item stays deleted');
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { restaurantId: tandoori.id, name: delSrc.name } }), 0);
  assert.strictEqual(await ctx.M.MenuItem.count({ where: { restaurantId: tandoori.id, name: editSrc.name } }), 0, 'original name not re-added');
  const kept = await ctx.M.MenuItem.findByPk(edited.id);
  assert.strictEqual(kept.name, 'Admin Renamed Dish');
  assert.strictEqual(kept.price, 999);
  assert.strictEqual(kept.description, 'Changed by the admin.');
  assert.strictEqual(kept.imageUrl, null);

  // Exactly one ledger row per data item of a filled store, all created once.
  const keys = tandoori.items.map((i) => i.key);
  assert.strictEqual(await ctx.M.CatalogueImportLedger.count({ where: { importKey: keys } }), keys.length);
});

test('a store that later appears or is renamed back is filled once; the 14-item cap is respected', async () => {
  // Renamed store gets its name back: filled now (still once).
  const bunker = byName('Burger Bunker');
  await ctx.M.Restaurant.update({ name: bunker.name }, { where: { id: bunker.id } });
  const res = await silent(() => runDemoMenuFill());
  assert.strictEqual(res.itemsCreated, bunker.items.length);
  assert.strictEqual(await countFor(bunker.id), bunker.items.length);

  // A store the admin already filled to 13 items: only one of ours goes in, the rest are skipped for good.
  const mandarin = byName('Mandarin Magic');
  await mkStore(mandarin.id, mandarin.name);
  for (let n = 1; n <= 13; n++) await ctx.M.MenuItem.create({ restaurantId: mandarin.id, name: `Owner Dish ${n}`, price: 100 + n, isVegetarian: true });
  const capped = await silent(() => runDemoMenuFill());
  assert.strictEqual(capped.itemsCreated, 1);
  assert.strictEqual(capped.skippedStoreFull, mandarin.items.length - 1);
  assert.strictEqual(await countFor(mandarin.id), 14);

  // Making room later does not bring the skipped items back.
  await ctx.M.MenuItem.destroy({ where: { restaurantId: mandarin.id, name: ['Owner Dish 1', 'Owner Dish 2'] } });
  const after = await silent(() => runDemoMenuFill());
  assert.strictEqual(after.itemsCreated, 0);
  assert.strictEqual(await countFor(mandarin.id), 12);
});

test('DISABLE_DEMO_MENU_FILL=true switches it off', async () => {
  process.env.DISABLE_DEMO_MENU_FILL = 'true';
  try {
    assert.deepStrictEqual(await runDemoMenuFill(), { skipped: 'disabled' });
  } finally { delete process.env.DISABLE_DEMO_MENU_FILL; }
});
