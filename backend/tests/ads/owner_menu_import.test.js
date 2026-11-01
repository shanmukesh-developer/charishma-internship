// scripts/owner_menu_import.js on a temp SQLite DB with a temp menu folder: nothing before the store removal
// finished; an incomplete file (missing / non-image photo, bad price, duplicate dish) creates nothing; a complete
// one creates the store and every dish with its photo saved in the media store (never a hot link), the map point and
// hours, and no login; a rerun adds nothing, keeps admin edits and never re-creates what the admin deleted; a name
// already in use is skipped; DISABLE_OWNER_MENUS switches it off.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const H = require('./helpers');

// A real (tiny) JPEG; a different trailing comment makes each photo's bytes unique.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const photo = (tag) => Buffer.concat([JPEG, Buffer.from(`zcs-test-${tag}`)]);

let ctx;
let dir;
const writeMenu = (name, data, photos) => {
  const imgDir = path.join(dir, data.imagesDir);
  fs.mkdirSync(imgDir, { recursive: true });
  for (const [file, buf] of Object.entries(photos)) fs.writeFileSync(path.join(imgDir, file), buf);
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
};
const menu = (over = {}) => ({
  version: 1,
  key: 'owner-menu:test-kitchen',
  imagesDir: 'images/test-kitchen',
  store: { name: 'Owner Test Kitchen', location: 'Food Court, Mangalagiri', lat: 16.41, lon: 80.56, vendorType: 'RESTAURANT', image: 'cover.jpg', tags: ['noodles'], description: 'Noodles and curries.', operatingHours: { start: '12:30', end: '22:30' } },
  items: [
    { slug: 'egg-noodles', name: 'Egg Noodles', price: 90, category: 'Non-Veg Noodles', dietType: 'egg', description: 'Egg noodles.', image: 'egg-noodles.jpg' },
    { slug: 'kaju-masala', name: 'Kaju Masala', price: 150, category: 'Veg Curries', dietType: 'veg', description: 'Cashew curry.', image: 'kaju-masala.jpg' },
  ],
  ...over,
});

before(async () => {
  ctx = await H.setup();
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('CatalogueImportLedger').sync();
  dir = path.join(os.tmpdir(), `owner-menus-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
});
after(async () => {
  delete process.env.DISABLE_OWNER_MENUS;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  await H.teardown();
});

test('menuProblems: missing or non-image photos, bad prices, duplicate dishes and a bad diet mark are caught', () => {
  const { menuProblems } = H.r('scripts/owner_menu_import');
  const d = menu({ imagesDir: 'images/problems' });
  writeMenu('a.json', d, { 'cover.jpg': photo('c'), 'egg-noodles.jpg': photo('e'), 'kaju-masala.jpg': Buffer.from('not an image') });
  const p = menuProblems({ ...d, items: [...d.items, { slug: 'egg-noodles', name: 'Again', price: 0, dietType: 'meat', image: 'none.jpg' }] }, dir);
  assert.ok(p.some((x) => /kaju-masala: not a JPEG/.test(x)), p.join(' | '));
  assert.ok(p.some((x) => /duplicate item egg-noodles/.test(x)));
  assert.ok(p.some((x) => /egg-noodles: price/.test(x)));
  assert.ok(p.some((x) => /dietType/.test(x)));
  assert.ok(p.some((x) => /photo missing: none.jpg/.test(x)));
  fs.unlinkSync(path.join(dir, 'a.json'));
});

test('import: waits for the store removal, refuses an incomplete file, then creates the store and dishes with stored photos', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  writeMenu('kitchen.json', menu(), { 'cover.jpg': photo('cover'), 'egg-noodles.jpg': photo('egg') }); // kaju photo missing
  assert.deepStrictEqual(await runOwnerMenuImport({ dataDir: dir }), { skipped: 'store removal not finished' });
  await ctx.M('GlobalConfig').create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });
  let r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.storesCreated, 0);
  assert.strictEqual(r.invalid.length, 1, JSON.stringify(r));
  assert.match(r.invalid[0].problems.join(' '), /kaju-masala: photo missing/);
  assert.strictEqual(await ctx.M('Restaurant').count({ where: { name: 'Owner Test Kitchen' } }), 0, 'an incomplete menu creates nothing');

  fs.writeFileSync(path.join(dir, 'images/test-kitchen/kaju-masala.jpg'), photo('kaju'));
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.deepStrictEqual([r.storesCreated, r.itemsCreated, r.invalid.length], [1, 2, 0], JSON.stringify(r));
  const store = await ctx.M('Restaurant').findOne({ where: { name: 'Owner Test Kitchen' } });
  assert.match(store.imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}$/, 'cover saved in the media store');
  assert.deepStrictEqual([store.lat, store.lon], [16.41, 80.56]);
  assert.deepStrictEqual(store.operatingHours, { start: '12:30', end: '22:30' });
  assert.deepStrictEqual([store.password, store.phone, store.whatsappNumber, store.rating, store.isActive], [null, null, null, 0, true]);
  const items = await ctx.M('MenuItem').findAll({ where: { restaurantId: store.id }, order: [['price', 'ASC']] });
  assert.deepStrictEqual(items.map((i) => [i.name, i.price, i.dietType, i.isVegetarian]), [['Egg Noodles', 90, 'egg', false], ['Kaju Masala', 150, 'veg', true]]);
  for (const i of items) assert.match(i.imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}$/, `${i.name} photo stored`);
  assert.notStrictEqual(items[0].imageUrl, items[1].imageUrl, 'one photo per dish');
  const media = await ctx.M('CampusMedia').findAll();
  assert.ok(media.length >= 3, 'three photos stored');
});

test('rerun: nothing duplicated, admin edits kept, deleted dishes and stores never come back, taken names skipped', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  const store = await ctx.M('Restaurant').findOne({ where: { name: 'Owner Test Kitchen' } });
  await ctx.M('MenuItem').update({ price: 95 }, { where: { restaurantId: store.id, name: 'Egg Noodles' } });
  await ctx.M('MenuItem').destroy({ where: { restaurantId: store.id, name: 'Kaju Masala' } });
  let r = await runOwnerMenuImport({ dataDir: dir });
  assert.deepStrictEqual([r.storesCreated, r.itemsCreated], [0, 0], JSON.stringify(r));
  assert.strictEqual((await ctx.M('MenuItem').findOne({ where: { name: 'Egg Noodles' } })).price, 95, 'admin edit kept');
  assert.strictEqual(await ctx.M('MenuItem').count({ where: { name: 'Kaju Masala' } }), 0, 'deleted dish stays deleted');
  await ctx.M('MenuItem').destroy({ where: { restaurantId: store.id } });
  await store.destroy();
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.storesDeleted, 1);
  assert.strictEqual(await ctx.M('Restaurant').count({ where: { name: 'Owner Test Kitchen' } }), 0, 'deleted store stays deleted');
  // A second menu whose store name the owner already used by hand: skipped, never filled.
  await H.mkStore({ name: 'owner second kitchen' });
  writeMenu('second.json', menu({ key: 'owner-menu:second', imagesDir: 'images/second', store: { ...menu().store, name: 'Owner Second Kitchen' } }),
    { 'cover.jpg': photo('c2'), 'egg-noodles.jpg': photo('e2'), 'kaju-masala.jpg': photo('k2') });
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.storesSkippedNameTaken, 1, JSON.stringify(r));
  const own = await ctx.M('Restaurant').findOne({ where: { name: 'owner second kitchen' } });
  assert.strictEqual(await ctx.M('MenuItem').count({ where: { restaurantId: own.id, name: 'Kaju Masala' } }), 0);
  process.env.DISABLE_OWNER_MENUS = 'true';
  assert.deepStrictEqual(await runOwnerMenuImport({ dataDir: dir }), { skipped: 'disabled' });
  delete process.env.DISABLE_OWNER_MENUS;
});
