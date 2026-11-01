// scripts/owner_menu_fixes_v2.js (owner, 1 Nov 2026 night: "amrutham image is not original, restaurant description
// is not great, why owner menu key showing"): the internal import key leaves every dish's details (other details
// kept); the Amrutham store gets its own storefront photo (banner crop), saved in the media store, in place of the
// stock cover or of v1's uncropped storefront, and the new description, each only while a photo / text this repo set
// is still there (an admin change is kept); it runs once; the switch works.
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
const NEW_DESCRIPTION = 'Amrutham serves noodles and curries.\n\n**On the menu**\n- Noodles: Hakka, Schezwan';

let ctx;
let dir;
let menuFile;
let store;
before(async () => {
  ctx = await H.setup();
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('CatalogueImportLedger').sync();
  dir = path.join(os.tmpdir(), `owner-menu-fixes-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(path.join(dir, 'images', 'amrutham'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', 'amrutham', 'storefront-banner.jpg'), photo('banner'));
  menuFile = path.join(dir, 'amrutham.json');
  fs.writeFileSync(menuFile, JSON.stringify({ key: 'owner-menu:amrutham-mangalagiri', imagesDir: 'images/amrutham', store: { name: 'Amrutham Restaurant', image: 'storefront-banner.jpg', description: NEW_DESCRIPTION } }));
  store = await H.mkStore({ name: 'Amrutham Restaurant' });
  await ctx.M('CatalogueImportLedger').create({ importKey: 'owner-menu:amrutham-mangalagiri', kind: 'owner-store', targetId: store.id, storeKey: 'owner-menu:amrutham-mangalagiri', name: 'Amrutham Restaurant' });
});
after(async () => {
  delete process.env.DISABLE_OWNER_MENU_FIXES;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  await H.teardown();
});

// A media row standing for a photo this repo set earlier (its SHA-256 is one of the known ones).
const earlierPhoto = async (i, tag) => {
  const { saveImageBytes } = H.r('utils/imageStore');
  const { REPLACEABLE_PHOTO_SHA256 } = H.r('scripts/owner_menu_fixes_v2');
  const row = await saveImageBytes(photo(tag), { purpose: 'store' });
  await ctx.M('CampusMedia').update({ sha256: REPLACEABLE_PHOTO_SHA256[i] }, { where: { id: row.id } });
  return H.r('utils/publicUrl').apiUrl(null, `/api/campus/media/${row.id}`, { renderFallback: true });
};
const savedPhotoSha = async () => {
  await store.reload();
  const id = store.imageUrl.match(/\/api\/campus\/media\/([0-9a-f-]{36})$/);
  assert.ok(id, store.imageUrl);
  return (await ctx.M('CampusMedia').findByPk(id[1])).sha256;
};

test('first import still there: the key leaves the dishes, the banner photo and the new description replace the first ones; once', async () => {
  const { runOwnerMenuFixes, MARKER, OLD_DESCRIPTION } = H.r('scripts/owner_menu_fixes_v2');
  const M = (n) => ctx.M(n);
  await store.update({ imageUrl: await earlierPhoto(0, 'stock-cover'), stallDescription: OLD_DESCRIPTION });
  const mk = (name, specs) => M('MenuItem').create({ restaurantId: store.id, name, price: 100, isAvailable: true, specs });
  const a = await mk('Egg Noodles', { ownerMenuKey: 'owner-menu:amrutham-mangalagiri:egg-noodles' });
  const b = await mk('Kaju Masala', { ownerMenuKey: 'owner-menu:amrutham-mangalagiri:kaju-masala', options: ['Half', 'Full'] });
  const c = await mk('Other Dish', { options: ['Small'] });

  const r = await runOwnerMenuFixes({ menuFile });
  assert.deepStrictEqual(r, { specKeysRemoved: 2, photo: 'storefront', description: 'updated' });
  assert.deepStrictEqual((await M('MenuItem').findByPk(a.id)).specs, {});
  assert.deepStrictEqual((await M('MenuItem').findByPk(b.id)).specs, { options: ['Half', 'Full'] }, 'other details kept');
  assert.deepStrictEqual((await M('MenuItem').findByPk(c.id)).specs, { options: ['Small'] });
  assert.strictEqual(await savedPhotoSha(), sha(photo('banner')), 'the banner photo, in the media store');
  assert.strictEqual(store.stallDescription, NEW_DESCRIPTION);
  assert.ok(await M('GlobalConfig').findOne({ where: { key: MARKER } }));
  assert.deepStrictEqual(await runOwnerMenuFixes({ menuFile }), { skipped: 'already done' });
});

test('after v1 (uncropped storefront, new text): the banner replaces it and the text is already current', async () => {
  const { runOwnerMenuFixes, MARKER } = H.r('scripts/owner_menu_fixes_v2');
  await store.update({ imageUrl: await earlierPhoto(1, 'v1-storefront'), stallDescription: NEW_DESCRIPTION });
  await ctx.M('GlobalConfig').destroy({ where: { key: MARKER } });
  const r = await runOwnerMenuFixes({ menuFile });
  assert.deepStrictEqual(r, { specKeysRemoved: 0, photo: 'storefront', description: 'already current' });
  assert.strictEqual(await savedPhotoSha(), sha(photo('banner')));
});

test('a photo or description the admin changed is kept; DISABLE_OWNER_MENU_FIXES switches it off', async () => {
  const { runOwnerMenuFixes, MARKER } = H.r('scripts/owner_menu_fixes_v2');
  await store.update({ imageUrl: 'https://example.com/admin-photo.jpg', stallDescription: 'Written by the admin.' });
  await ctx.M('GlobalConfig').destroy({ where: { key: MARKER } });
  process.env.DISABLE_OWNER_MENU_FIXES = 'true';
  assert.deepStrictEqual(await runOwnerMenuFixes({ menuFile }), { skipped: 'disabled' });
  delete process.env.DISABLE_OWNER_MENU_FIXES;
  const r = await runOwnerMenuFixes({ menuFile });
  assert.deepStrictEqual(r, { specKeysRemoved: 0, photo: 'kept (changed by the admin)', description: 'kept (changed by the admin)' });
  await store.reload();
  assert.deepStrictEqual([store.imageUrl, store.stallDescription], ['https://example.com/admin-photo.jpg', 'Written by the admin.']);
});
