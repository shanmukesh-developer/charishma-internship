// Campus store catalogue clean-up v1 (scripts/catalogue_cleanup_import.js) on temp SQLite DBs seeded
// from the data file's own "expect" + "current" snapshot: the first run applies every reviewed op in one
// transaction per store and writes GlobalConfig CATALOGUE_CLEANUP_V1_DONE, a re-run is a no-op, an
// item an admin edited (name, price or store) is skipped untouched, duplicates are hidden and never
// deleted, prices end in whole rupees, no MRP implies more than 60% off, an MRP kept in specs is cleared
// too, and DISABLE_CATALOGUE_CLEANUP=true switches it off. Never touches a real database or the network.
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

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const { runCatalogueCleanup, DATA_PATH, DEFAULT_MARKER } = r('scripts/catalogue_cleanup_import');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const allItems = data.stores.flatMap((s) => s.items.map((i) => ({ ...i, storeId: s.storeId, storeName: s.storeName })));
const files = [];

// A fresh temp DB with the stores and every listed item as it was in the snapshot.
const freshDb = async ({ mrpInSpecsFor = null } = {}) => {
  if (ctx) await ctx.sequelize.close();
  const file = path.join(os.tmpdir(), `catalogue-cleanup-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  files.push(file);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  await sequelize.sync();
  const M = sequelize.models;
  for (const s of data.stores) {
    await M.Restaurant.create({ id: s.storeId, name: s.storeName, location: 'SRM AP', vendorType: 'GROCERY', isActive: true });
  }
  for (const i of allItems) {
    const mrpInSpecs = i.id === mrpInSpecsFor;
    await M.MenuItem.create({
      id: i.id,
      restaurantId: i.storeId,
      name: i.expect.name,
      price: i.expect.price,
      category: i.current.category,
      imageUrl: i.current.imageUrl,
      originalPrice: mrpInSpecs ? null : i.current.originalPrice,
      isAvailable: true,
      specs: { ...(i.current.weight ? { weight: i.current.weight } : {}), ...(i.current.brand ? { brand: i.current.brand } : {}), ...(mrpInSpecs ? { originalPrice: i.current.originalPrice } : {}), keep: 'me' },
    });
  }
  ctx = { sequelize, M };
  return M;
};

test.after(async () => {
  if (ctx) await ctx.sequelize.close();
  ctx = null;
  for (const f of files) for (const x of [f, `${f}-journal`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
});

const opsOf = (i, op) => i.ops.filter((o) => o.op === op);
// The item as the app would see it after the clean-up (from the data file alone).
const after = (i) => {
  const out = { name: i.expect.name, price: i.expect.price, originalPrice: i.current.originalPrice, weight: i.current.weight, hidden: false, imageUrl: i.current.imageUrl };
  for (const o of i.ops) {
    if (o.op === 'rename') out.name = o.to;
    if (o.op === 'setPrice') out.price = o.to;
    if (o.op === 'setOriginalPrice') out.originalPrice = o.to;
    if (o.op === 'clearOriginalPrice') out.originalPrice = null;
    if (o.op === 'setWeight') out.weight = o.to;
    if (o.op === 'setImage') out.imageUrl = o.to;
    if (o.op === 'hide') out.hidden = true;
  }
  return out;
};

test('data file: known ops with reasons, id + name + price guards, whole rupees, free stock photos, clean names', () => {
  assert.strictEqual(data.marker, DEFAULT_MARKER);
  const known = new Set(['rename', 'setCategory', 'setPrice', 'setOriginalPrice', 'clearOriginalPrice', 'setWeight', 'setBrand', 'setImage', 'hide']);
  const ids = new Set();
  for (const i of allItems) {
    assert.match(i.id, /^[0-9a-f-]{36}$/);
    assert.ok(!ids.has(i.id), `${i.id} listed once`);
    ids.add(i.id);
    assert.ok(i.expect.name && Number.isFinite(i.expect.price), `${i.id} guard`);
    assert.ok(i.ops.length > 0);
    for (const o of i.ops) {
      assert.ok(known.has(o.op), o.op);
      assert.ok(o.reason, `${i.expect.name} ${o.op} has a reason`);
      if (o.op === 'setPrice' || o.op === 'setOriginalPrice') assert.ok(Number.isInteger(o.to) && o.to > 0, `${i.expect.name} whole rupees`);
      if (o.op === 'setImage') assert.match(o.to, /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?w=600&q=70&auto=format&fit=crop$/);
    }
    const a = after(i);
    assert.ok(Number.isInteger(a.price), `${a.name} price in whole rupees`);
    if (a.originalPrice) {
      assert.ok(Number.isInteger(a.originalPrice), `${a.name} MRP in whole rupees`);
      assert.ok((1 - a.price / a.originalPrice) * 100 <= 60, `${a.name} at most 60% off`);
    }
    assert.ok(!/\((Campus|Fresh|The)\)/.test(a.name), `${a.name} no junk ending`);
    assert.ok(!/\(\s*\d|\b\d+\s?(g|kg|ml|l|litres?|pcs?)\b/i.test(a.name), `${a.name} no size in the name`);
    assert.ok(a.name === a.name.trim() && !/\b[A-Z]{4,}\b/.test(a.name.replace(/\bANC\b|\bUSB\b|\bLCD\b|\bLED\b|\bGaN\b/g, '')), `${a.name} not ALL CAPS`);
    assert.ok(!/Cadbury Oreo/.test(a.name));
  }
  // One store never lists the same product (name + size) twice for sale.
  for (const s of data.stores) {
    const seen = new Set();
    for (const i of s.items) {
      const a = after(i);
      if (a.hidden) continue;
      const k = `${a.name.toLowerCase()}|${String(a.weight || '').toLowerCase()}`;
      assert.ok(!seen.has(k), `${s.storeName}: ${a.name} ${a.weight || ''} once`);
      seen.add(k);
    }
  }
  assert.ok(allItems.filter((i) => opsOf(i, 'hide').length).length >= 1);
});

test('first run applies every op once, hides duplicates without deleting, writes the marker; a re-run is a no-op', async () => {
  const M = await freshDb();
  const before = await M.MenuItem.count();
  const first = await runCatalogueCleanup();
  assert.strictEqual(first.applied, allItems.length);
  assert.strictEqual(first.skipped, 0);
  assert.strictEqual(first.storesFailed, 0);
  assert.strictEqual(first.ops, allItems.reduce((n, i) => n + i.ops.length, 0));
  assert.ok(cacheClears >= 1);
  assert.strictEqual(await M.MenuItem.count(), before, 'nothing deleted');

  for (const i of allItems) {
    const row = await M.MenuItem.findByPk(i.id);
    const a = after(i);
    assert.strictEqual(row.name, a.name);
    assert.strictEqual(row.price, a.price);
    assert.ok(Number.isInteger(row.price), `${row.name} whole rupees`);
    assert.strictEqual(row.originalPrice === null ? null : row.originalPrice, a.originalPrice || null, `${row.name} MRP`);
    assert.strictEqual(row.isAvailable, !a.hidden, `${row.name} availability`);
    assert.strictEqual(row.imageUrl, a.imageUrl);
    assert.strictEqual(row.specs.keep, 'me', 'other specs kept');
    assert.strictEqual(row.specs.weight || null, a.weight || null);
    const cat = opsOf(i, 'setCategory')[0];
    assert.strictEqual(row.category, cat ? cat.to : i.current.category);
    const brand = opsOf(i, 'setBrand')[0];
    if (brand) assert.strictEqual(row.specs.brand, brand.to);
    if (a.hidden) {
      assert.strictEqual(row.outOfStockUntil, null, 'hidden for good, not until a date');
      assert.strictEqual(row.specs.hiddenBy, 'catalogue-cleanup-v1');
    }
  }
  const mark = await M.GlobalConfig.findOne({ where: { key: DEFAULT_MARKER } });
  assert.ok(mark && mark.value.applied === allItems.length);

  // Re-run: the marker stops it; even without the marker every guard now skips (names changed).
  assert.deepStrictEqual(await runCatalogueCleanup(), { skipped: 'already done' });
  const snapshot = JSON.stringify(await M.MenuItem.findAll({ order: [['id', 'ASC']], raw: true }));
  await mark.destroy();
  const again = await runCatalogueCleanup();
  assert.strictEqual(again.storesFailed, 0);
  const renamedOrRepriced = allItems.filter((i) => opsOf(i, 'rename').length || opsOf(i, 'setPrice').length).length;
  assert.strictEqual(again.skipped, renamedOrRepriced, 'renamed / repriced items no longer match their guard');
  assert.strictEqual(JSON.stringify(await M.MenuItem.findAll({ order: [['id', 'ASC']], raw: true })).replace(/"updatedAt":"[^"]*"/g, ''), snapshot.replace(/"updatedAt":"[^"]*"/g, ''), 'same end state');
});

test('guards: an item the admin renamed, repriced or moved is skipped and left exactly as the admin set it', async () => {
  const M = await freshDb();
  const [a, b, c] = allItems.filter((i) => opsOf(i, 'rename').length && opsOf(i, 'setCategory').length);
  await M.MenuItem.update({ name: 'Admin Name' }, { where: { id: a.id } });
  await M.MenuItem.update({ price: b.expect.price + 7 }, { where: { id: b.id } });
  const other = data.stores.find((s) => s.storeId !== c.storeId);
  await M.MenuItem.update({ restaurantId: other.storeId }, { where: { id: c.id } });
  const hideItem = allItems.find((i) => opsOf(i, 'hide').length);
  await M.MenuItem.destroy({ where: { id: hideItem.id } }); // admin deleted it: never re-created

  const res = await runCatalogueCleanup();
  assert.strictEqual(res.skipped, 4);
  assert.strictEqual(res.applied, allItems.length - 4);
  assert.deepStrictEqual(new Set(res.skippedIds), new Set([a.id, b.id, c.id, hideItem.id]));
  const ra = await M.MenuItem.findByPk(a.id);
  assert.strictEqual(ra.name, 'Admin Name');
  assert.strictEqual(ra.category, a.current.category, 'no op of a skipped item runs');
  const rb = await M.MenuItem.findByPk(b.id);
  assert.strictEqual(rb.price, b.expect.price + 7);
  assert.strictEqual(rb.name, b.expect.name);
  const rc = await M.MenuItem.findByPk(c.id);
  assert.strictEqual(rc.name, c.expect.name);
  assert.strictEqual(rc.restaurantId, other.storeId);
  assert.strictEqual(await M.MenuItem.findByPk(hideItem.id), null);
});

test('an MRP kept in specs.originalPrice is cleared too; DISABLE_CATALOGUE_CLEANUP=true switches it off', async () => {
  const capped = allItems.find((i) => opsOf(i, 'clearOriginalPrice').length);
  const M = await freshDb({ mrpInSpecsFor: capped.id });
  process.env.DISABLE_CATALOGUE_CLEANUP = 'true';
  try {
    assert.deepStrictEqual(await runCatalogueCleanup(), { skipped: 'disabled' });
    assert.strictEqual((await M.MenuItem.findByPk(capped.id)).name, capped.expect.name);
  } finally { delete process.env.DISABLE_CATALOGUE_CLEANUP; }
  await runCatalogueCleanup();
  const row = await M.MenuItem.findByPk(capped.id);
  assert.strictEqual(row.originalPrice, null);
  assert.strictEqual(row.specs.originalPrice, undefined);
});
