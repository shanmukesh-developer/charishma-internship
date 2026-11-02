// scripts/owner_menu_import.js photo sync (owner, 2 Nov 2026: "improve quality of images"): after an import, a dish
// whose photo the repo replaces (`replacesPhotos`: the SHA-256 of the photos it set before, null = none) gets the new
// photo, or none when `image` is null; the store likewise (`replacesImages`); a photo the admin changed is never
// touched; a second run changes nothing; a dish taken off can get its photo back later; bad lists are refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const H = require('./helpers');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const photo = (tag) => Buffer.concat([JPEG, Buffer.from(`zcs-test-${tag}`)]);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let ctx;
let dir;
const IMAGES = 'images/sync-kitchen';
const writeMenu = (data, photos = {}) => {
  fs.mkdirSync(path.join(dir, IMAGES), { recursive: true });
  for (const [file, buf] of Object.entries(photos)) fs.writeFileSync(path.join(dir, IMAGES, file), buf);
  fs.writeFileSync(path.join(dir, 'kitchen.json'), JSON.stringify(data));
};
const base = () => ({
  version: 1,
  key: 'owner-menu:sync-kitchen',
  imagesDir: IMAGES,
  store: { name: 'Sync Test Kitchen', location: 'Mangalagiri', image: 'cover.jpg', description: 'Dosas.', operatingHours: { start: '07:00', end: '23:00' } },
  items: ['a', 'b', 'c'].map((s) => ({ slug: `dish-${s}`, name: `Dish ${s.toUpperCase()}`, price: 50, dietType: 'veg', description: 'A dosa.', image: `dish-${s}.jpg` })),
});
const mediaSha = async (url) => {
  const m = String(url || '').match(/\/api\/campus\/media\/([0-9a-f-]{36})$/);
  return m ? (await ctx.M('CampusMedia').findByPk(m[1])).sha256 : null;
};
const item = (name) => ctx.M('MenuItem').findOne({ where: { name } });

before(async () => {
  ctx = await H.setup();
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('CatalogueImportLedger').sync();
  await ctx.M('GlobalConfig').create({ key: 'REMOVE_ALL_STORES_V2_DONE', value: JSON.stringify({ at: 'test' }) });
  dir = path.join(os.tmpdir(), `owner-photo-sync-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
});
after(async () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  await H.teardown();
});

test('replaced, removed and restored photos reach imported dishes; the admin\'s photo is kept; reruns change nothing', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  writeMenu(base(), { 'cover.jpg': photo('cover'), 'dish-a.jpg': photo('a'), 'dish-b.jpg': photo('b'), 'dish-c.jpg': photo('c') });
  let r = await runOwnerMenuImport({ dataDir: dir });
  assert.deepStrictEqual([r.storesCreated, r.itemsCreated, r.photosUpdated], [1, 3, 0], JSON.stringify(r));
  await (await item('Dish C')).update({ imageUrl: 'https://example.com/admin-photo.jpg' }); // the admin's own photo

  // A wrong photo taken off (a), a better one (b), one for a dish the admin changed (c), a better store photo.
  const next = base();
  next.items[0] = { ...next.items[0], image: null, replacesPhotos: [sha(photo('a'))] };
  next.items[1] = { ...next.items[1], image: 'dish-b-better.jpg', replacesPhotos: [sha(photo('b'))] };
  next.items[2] = { ...next.items[2], image: 'dish-c-better.jpg', replacesPhotos: [sha(photo('c'))] };
  next.store = { ...next.store, image: 'cover-better.jpg', replacesImages: [sha(photo('cover'))] };
  writeMenu(next, { 'dish-b-better.jpg': photo('b2'), 'dish-c-better.jpg': photo('c2'), 'cover-better.jpg': photo('cover2') });
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.deepStrictEqual([r.itemsCreated, r.photosUpdated, r.invalid.length], [0, 3, 0], JSON.stringify(r));
  assert.strictEqual((await item('Dish A')).imageUrl, null, 'wrong photo taken off');
  assert.strictEqual(await mediaSha((await item('Dish B')).imageUrl), sha(photo('b2')), 'better photo, in the media store');
  assert.strictEqual((await item('Dish C')).imageUrl, 'https://example.com/admin-photo.jpg', 'the admin\'s photo is kept');
  const store = await ctx.M('Restaurant').findOne({ where: { name: 'Sync Test Kitchen' } });
  assert.strictEqual(await mediaSha(store.imageUrl), sha(photo('cover2')));
  assert.strictEqual((await runOwnerMenuImport({ dataDir: dir })).photosUpdated, 0, 'nothing left to change');

  // Later an exact photo is found for dish A: its list names "no photo" (null) as well.
  next.items[0] = { ...next.items[0], image: 'dish-a-exact.jpg', replacesPhotos: [sha(photo('a')), null] };
  writeMenu(next, { 'dish-a-exact.jpg': photo('a2') });
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.photosUpdated, 1, JSON.stringify(r));
  assert.strictEqual(await mediaSha((await item('Dish A')).imageUrl), sha(photo('a2')));
});

test('a corrected store / dish description replaces the text the repo set; an admin-written text is kept; once', async () => {
  const { runOwnerMenuImport } = H.r('scripts/owner_menu_import');
  const textSha = (t) => crypto.createHash('sha256').update(String(t).trim()).digest('hex');
  const store = await ctx.M('Restaurant').findOne({ where: { name: 'Sync Test Kitchen' } });
  assert.strictEqual(store.stallDescription, 'Dosas.');
  await (await item('Dish C')).update({ description: 'Written by the admin.' });
  const next = JSON.parse(fs.readFileSync(path.join(dir, 'kitchen.json'), 'utf8'));
  next.store = { ...next.store, description: 'Dosas, idlis and egg dishes.', replacesDescriptions: [textSha('Dosas.')] };
  next.items[1] = { ...next.items[1], description: 'A crisp dosa.', replacesDescriptions: [textSha('A dosa.')] };
  next.items[2] = { ...next.items[2], description: 'A cheese dosa.', replacesDescriptions: [textSha('A dosa.')] };
  writeMenu(next);
  let r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.textsUpdated, 2, JSON.stringify(r));
  await store.reload();
  assert.strictEqual(store.stallDescription, 'Dosas, idlis and egg dishes.');
  assert.strictEqual((await item('Dish B')).description, 'A crisp dosa.');
  assert.strictEqual((await item('Dish C')).description, 'Written by the admin.', 'the admin text is kept');
  r = await runOwnerMenuImport({ dataDir: dir });
  assert.strictEqual(r.textsUpdated, 0, 'nothing left to change');
});

test('menuProblems: a photo-less dish must name what it replaces; replace lists hold SHA-256 values', () => {
  const { menuProblems } = H.r('scripts/owner_menu_import');
  const d = base();
  d.items[0] = { ...d.items[0], image: null };
  d.items[1] = { ...d.items[1], replacesPhotos: ['not-a-hash'] };
  d.store = { ...d.store, replacesImages: 'abc', replacesDescriptions: ['x'] };
  d.items[2] = { ...d.items[2], replacesDescriptions: [12] };
  const p = menuProblems(d, dir).join(' | ');
  assert.match(p, /store replacesDescriptions: SHA-256 list/);
  assert.match(p, /dish-c: replacesDescriptions: SHA-256 list/);
  assert.match(p, /dish-a: no photo and nothing it replaces/);
  assert.match(p, /dish-b: replacesPhotos: SHA-256 list/);
  assert.match(p, /store replacesImages: SHA-256 list/);
});
