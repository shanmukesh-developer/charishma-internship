// Owner menus keep the printed card's order (2 Nov 2026: the apps listed Manu Dosa Place's and Amrutham's
// categories alphabetically). New dishes get specs.sortOrder 10, 20, ... in file order; a dish imported before
// without one is numbered on the next start; an order the admin set is never changed; utils/menuSort then lists
// the categories in the card's order.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const H = require('./helpers');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const photo = (tag) => Buffer.concat([JPEG, Buffer.from(`zcs-test-${tag}`)]);

let ctx;
let dir;
const IMAGES = 'images/order-kitchen';
const menu = {
  version: 1,
  key: 'owner-menu:order-kitchen',
  imagesDir: IMAGES,
  store: { name: 'Order Test Kitchen', location: 'Mangalagiri', image: 'cover.jpg', description: 'Curries and noodles.', operatingHours: { start: '12:00', end: '22:00' } },
  // The card: curries first, then noodles; not alphabetical.
  items: [
    { slug: 'paneer-curry', name: 'Paneer Curry', price: 150, category: 'Veg Curries', dietType: 'veg', description: 'Paneer.', image: 'paneer-curry.jpg' },
    { slug: 'hakka-noodles', name: 'Hakka Noodles', price: 80, category: 'Noodles', dietType: 'veg', description: 'Noodles.', image: 'hakka-noodles.jpg' },
    { slug: 'aloo-curry', name: 'Aloo Curry', price: 90, category: 'Veg Curries', dietType: 'veg', description: 'Potato.', image: 'aloo-curry.jpg' },
  ],
};

before(async () => {
  ctx = await H.setup();
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('CatalogueImportLedger').sync();
  await ctx.M('GlobalConfig').create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });
  dir = path.join(os.tmpdir(), `owner-menu-order-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(path.join(dir, IMAGES), { recursive: true });
  for (const f of ['cover.jpg', 'paneer-curry.jpg', 'hakka-noodles.jpg', 'aloo-curry.jpg']) fs.writeFileSync(path.join(dir, IMAGES, f), photo(f));
  fs.writeFileSync(path.join(dir, 'kitchen.json'), JSON.stringify(menu));
});
after(async () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  await H.teardown();
});

const listed = async () => {
  const store = await ctx.M('Restaurant').findOne({ where: { name: 'Order Test Kitchen' } });
  const items = await ctx.M('MenuItem').findAll({ where: { restaurantId: store.id } });
  return H.r('utils/menuSort').sortMenuItems(items).map((i) => i.name);
};

test('new dishes keep the card order: categories and dishes as in the file, not alphabetical', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  const r = await runOwnerMenuImport({ dataDir: dir });
  assert.deepStrictEqual([r.storesCreated, r.itemsCreated, r.dishesOrdered], [1, 3, 0], JSON.stringify(r));
  assert.deepStrictEqual(await listed(), ['Paneer Curry', 'Aloo Curry', 'Hakka Noodles']);
});

test('dishes imported before without an order are numbered; an order the admin set is kept; once', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  const M = ctx.M('MenuItem');
  await M.update({ specs: {} }, { where: { name: ['Paneer Curry', 'Aloo Curry'] } }); // imported before sortOrder existed
  await M.update({ specs: { sortOrder: 5 } }, { where: { name: 'Hakka Noodles' } }); // the admin moved noodles to the top
  let r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.dishesOrdered, 2, JSON.stringify(r));
  assert.deepStrictEqual((await M.findOne({ where: { name: 'Aloo Curry' } })).specs, { sortOrder: 30 });
  assert.deepStrictEqual((await M.findOne({ where: { name: 'Hakka Noodles' } })).specs, { sortOrder: 5 }, 'the admin order is kept');
  assert.deepStrictEqual(await listed(), ['Hakka Noodles', 'Paneer Curry', 'Aloo Curry']);
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.dishesOrdered, 0, 'nothing left to number');
});
