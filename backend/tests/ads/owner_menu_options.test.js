// scripts/owner_menu_import.js with dishes the card prices by size (owner, 3 Nov 2026, Club 10 Chicken: popcorn
// S / M / L, momos fried or steamed): a dish's `options` are checked like an admin save (normalizeOptions) and its
// price must be the lowest size, else the file creates nothing; a valid one is stored in specs.options next to
// sortOrder, and the server prices each size from it.
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
const SIZES = [{ name: 'Size', type: 'variant', choices: [{ label: 'Small', price: 130 }, { label: 'Medium', price: 250 }, { label: 'Large', price: 500 }] }];

let ctx;
let dir;
const writeMenu = (name, data, photos) => {
  const imgDir = path.join(dir, data.imagesDir);
  fs.mkdirSync(imgDir, { recursive: true });
  for (const [file, buf] of Object.entries(photos)) fs.writeFileSync(path.join(imgDir, file), buf);
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
};
const menu = (items) => ({
  version: 1,
  key: 'owner-menu:size-kitchen',
  imagesDir: 'images/size-kitchen',
  store: { name: 'Owner Size Kitchen', location: 'Food Court, Mangalagiri', lat: 16.41, lon: 80.56, vendorType: 'RESTAURANT', image: 'cover.jpg', tags: ['chicken'], description: 'Fried chicken.', operatingHours: { start: '12:00', end: '22:30' } },
  items,
});
const popcorn = (over = {}) => ({ slug: 'chicken-popcorn', name: 'Chicken Popcorn', price: 130, category: 'Popcorn', dietType: 'nonveg', description: 'Popcorn chicken.', image: 'chicken-popcorn.jpg', options: SIZES, ...over });

before(async () => {
  ctx = await H.setup();
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('CatalogueImportLedger').sync();
  dir = path.join(os.tmpdir(), `owner-menu-options-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
});
after(async () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  await H.teardown();
});

test('menuProblems: a price that is not the lowest size, or sizes in the wrong format, stop the file', () => {
  const { menuProblems } = H.r('scripts/owner_menu_import');
  const d = menu([
    popcorn({ price: 250 }),
    { slug: 'veg-momo', name: 'Veg Momo', price: 100, category: 'Momos', dietType: 'veg', description: 'Momos.', image: 'veg-momo.jpg', options: [SIZES[0], { ...SIZES[0], name: 'Style' }] },
    { slug: 'paneer-momo', name: 'Paneer Momo', price: 130, category: 'Momos', dietType: 'veg', description: 'Momos.', image: 'paneer-momo.jpg', options: 'Fried or steamed' },
  ]);
  writeMenu('p.json', d, { 'cover.jpg': photo('c'), 'chicken-popcorn.jpg': photo('p'), 'veg-momo.jpg': photo('m'), 'paneer-momo.jpg': photo('pm') });
  const p = menuProblems(d, dir);
  assert.ok(p.some((x) => /chicken-popcorn: price 250 is not the lowest size price 130/.test(x)), p.join(' | '));
  assert.ok(p.some((x) => /veg-momo: options: Only one weight \/ size group/.test(x)), p.join(' | '));
  assert.ok(p.some((x) => /paneer-momo: options: /.test(x)), p.join(' | '));
  assert.deepStrictEqual(menuProblems(menu([popcorn()]), dir), [], 'the same dish at its lowest size is fine');
  fs.unlinkSync(path.join(dir, 'p.json'));
});

test('import: the sizes become the dish options, sortOrder stays, and each size is priced from them', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  const { readOptions, priceWithOptions } = H.r('utils/productOptions');
  await ctx.M('GlobalConfig').create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });
  writeMenu('sizes.json', menu([
    popcorn(),
    { slug: 'corn-salad', name: 'Corn Salad', price: 140, category: 'Salads', dietType: 'veg', description: 'Sweet corn salad.', image: 'corn-salad.jpg' },
  ]), { 'cover.jpg': photo('cover'), 'chicken-popcorn.jpg': photo('pop'), 'corn-salad.jpg': photo('salad') });
  const r = await runOwnerMenuImport({ dataDir: dir });
  assert.deepStrictEqual([r.storesCreated, r.itemsCreated, r.invalid.length], [1, 2, 0], JSON.stringify(r));

  const pop = await ctx.M('MenuItem').findOne({ where: { name: 'Chicken Popcorn' } });
  const specs = typeof pop.specs === 'string' ? JSON.parse(pop.specs) : pop.specs;
  assert.strictEqual(Number(pop.price), 130, 'the dish price is its lowest size');
  assert.strictEqual(specs.sortOrder, 10);
  const groups = readOptions(specs);
  assert.deepStrictEqual(groups.map((g) => [g.name, g.type, g.choices.map((c) => `${c.label} ${c.price}`)]), [['Size', 'variant', ['Small 130', 'Medium 250', 'Large 500']]]);
  assert.strictEqual(priceWithOptions(pop, groups, { Size: 'Large' }).unitPrice, 500);
  assert.strictEqual(priceWithOptions(pop, groups, { Size: 'Small' }).unitPrice, 130);
  assert.throws(() => priceWithOptions(pop, groups, {}), (e) => e.code === 'OPTION_INVALID', 'a size must be chosen');

  const salad = await ctx.M('MenuItem').findOne({ where: { name: 'Corn Salad' } });
  const saladSpecs = typeof salad.specs === 'string' ? JSON.parse(salad.specs) : salad.specs;
  assert.deepStrictEqual(saladSpecs, { sortOrder: 20 }, 'a dish without sizes keeps only its order');
});
