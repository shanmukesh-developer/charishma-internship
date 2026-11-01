// scripts/owner_menu_fixes_v1.js (owner, 1 Nov 2026 night: "amrutham image is not original, restaurant description
// is not great, why owner menu key showing"): the internal import key leaves every dish's details (other details
// kept); the Amrutham store gets its own storefront photo, saved in the media store, and the new description, each
// only while the importer's first one is still there (an admin change is kept); it runs once; the switch works.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const H = require('./helpers');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const photo = (tag) => Buffer.concat([JPEG, Buffer.from(`zcs-test-${tag}`)]);
const NEW_DESCRIPTION = 'Amrutham serves noodles and curries.\n\n**On the menu**\n- Noodles: Hakka, Schezwan';

let ctx;
let dir;
let menuFile;
before(async () => {
  ctx = await H.setup();
  H.r('models/CatalogueImportLedger').initCatalogueImportLedgerModel(ctx.sequelize);
  await ctx.M('CatalogueImportLedger').sync();
  dir = path.join(os.tmpdir(), `owner-menu-fixes-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(path.join(dir, 'images', 'amrutham'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', 'amrutham', 'storefront.jpg'), photo('storefront'));
  menuFile = path.join(dir, 'amrutham.json');
  fs.writeFileSync(menuFile, JSON.stringify({ key: 'owner-menu:amrutham-mangalagiri', imagesDir: 'images/amrutham', store: { name: 'Amrutham Restaurant', image: 'storefront.jpg', description: NEW_DESCRIPTION } }));
});
after(async () => {
  delete process.env.DISABLE_OWNER_MENU_FIXES;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  await H.teardown();
});

test('the import key leaves the dishes; the storefront photo and the new description replace the first ones; once', async () => {
  const { runOwnerMenuFixes, MARKER, OLD_COVER_SHA256, OLD_DESCRIPTION } = H.r('scripts/owner_menu_fixes_v1');
  const { saveImageBytes } = H.r('utils/imageStore');
  const { apiUrl } = H.r('utils/publicUrl');
  const M = (n) => ctx.M(n);
  // The importer's first cover: a media row with the old cover's SHA-256.
  const old = await saveImageBytes(photo('old-cover'), { purpose: 'store' });
  await M('CampusMedia').update({ sha256: OLD_COVER_SHA256 }, { where: { id: old.id } });
  const store = await H.mkStore({ name: 'Amrutham Restaurant' });
  await store.update({ imageUrl: apiUrl(null, `/api/campus/media/${old.id}`, { renderFallback: true }), stallDescription: OLD_DESCRIPTION });
  await M('CatalogueImportLedger').create({ importKey: 'owner-menu:amrutham-mangalagiri', kind: 'owner-store', targetId: store.id, storeKey: 'owner-menu:amrutham-mangalagiri', name: 'Amrutham Restaurant' });
  const mk = (name, specs) => M('MenuItem').create({ restaurantId: store.id, name, price: 100, isAvailable: true, specs });
  const a = await mk('Egg Noodles', { ownerMenuKey: 'owner-menu:amrutham-mangalagiri:egg-noodles' });
  const b = await mk('Kaju Masala', { ownerMenuKey: 'owner-menu:amrutham-mangalagiri:kaju-masala', options: ['Half', 'Full'] });
  const c = await mk('Other Dish', { options: ['Small'] });

  const r = await runOwnerMenuFixes({ menuFile });
  assert.deepStrictEqual(r, { specKeysRemoved: 2, photo: 'storefront', description: 'updated' });
  assert.deepStrictEqual((await M('MenuItem').findByPk(a.id)).specs, {});
  assert.deepStrictEqual((await M('MenuItem').findByPk(b.id)).specs, { options: ['Half', 'Full'] }, 'other details kept');
  assert.deepStrictEqual((await M('MenuItem').findByPk(c.id)).specs, { options: ['Small'] });
  await store.reload();
  assert.strictEqual(store.stallDescription, NEW_DESCRIPTION);
  const id = store.imageUrl.match(/\/api\/campus\/media\/([0-9a-f-]{36})$/);
  assert.ok(id && id[1] !== String(old.id), store.imageUrl);
  const saved = await M('CampusMedia').findByPk(id[1]);
  assert.strictEqual(saved.sha256, crypto.createHash('sha256').update(photo('storefront')).digest('hex'), 'the storefront photo, in the media store');
  assert.ok(await M('GlobalConfig').findOne({ where: { key: MARKER } }));
  assert.deepStrictEqual(await runOwnerMenuFixes({ menuFile }), { skipped: 'already done' });
});

test('a photo or description the admin changed is kept; DISABLE_OWNER_MENU_FIXES switches it off', async () => {
  const { runOwnerMenuFixes, MARKER } = H.r('scripts/owner_menu_fixes_v1');
  const M = (n) => ctx.M(n);
  const store = await M('Restaurant').findOne({ where: { name: 'Amrutham Restaurant' } });
  await store.update({ imageUrl: 'https://example.com/admin-photo.jpg', stallDescription: 'Written by the admin.' });
  await M('GlobalConfig').destroy({ where: { key: MARKER } });
  process.env.DISABLE_OWNER_MENU_FIXES = 'true';
  assert.deepStrictEqual(await runOwnerMenuFixes({ menuFile }), { skipped: 'disabled' });
  delete process.env.DISABLE_OWNER_MENU_FIXES;
  const r = await runOwnerMenuFixes({ menuFile });
  assert.deepStrictEqual(r, { specKeysRemoved: 0, photo: 'kept (changed by the admin)', description: 'kept (changed by the admin)' });
  await store.reload();
  assert.deepStrictEqual([store.imageUrl, store.stallDescription], ['https://example.com/admin-photo.jpg', 'Written by the admin.']);
});
