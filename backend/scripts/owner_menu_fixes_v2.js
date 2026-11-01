// Owner menu fixes, once (GlobalConfig OWNER_MENU_FIXES_V2_DONE). Owner, 1 Nov 2026 night: "amrutham image is not
// original, and restaurant description is not great, and why owner menu key like something showing" and "we have
// licence to keep their original photos as we collaborated with them".
//  1. The importer stored specs.ownerMenuKey on every dish; the customer app lists unknown specs as product details,
//     so "Owner menu key: owner-menu:..." showed on the dish page. The key is removed from every MenuItem (only that
//     key; the import ledger keeps the mapping).
//  2. The Amrutham store photo becomes the restaurant's own storefront photo (the menu file's store.image), only
//     while the store still shows a photo this repo set (its bytes' SHA-256 is known): a photo the admin uploaded
//     meanwhile is never replaced. v1 (1 Nov 23:06) set the uncropped 4:3 storefront, whose centre crop in the
//     store page banner (about 2:1) cut off the AMRUTHAM lettering; v2 sets the banner crop of the same photo.
//  3. Its description becomes the menu file's, only while it is still the importer's first text.
// DISABLE_OWNER_MENU_FIXES=true switches it off.
const fs = require('fs');
const path = require('path');

const MARKER = 'OWNER_MENU_FIXES_V2_DONE';
const STORE_KEY = 'owner-menu:amrutham-mangalagiri';
const MENU_FILE = path.join(__dirname, '..', 'data', 'owner-menus', 'amrutham-mangalagiri-v1-2026-11-01.json');
// Photos this repo set on the store: the stock cover of the first import, then the uncropped storefront (v1).
const REPLACEABLE_PHOTO_SHA256 = [
  'f541e3dfc79be2ca8e63e09dffa57dfc747b87a8f016254c305040024101105e',
  '73a43438502738d80d5af3f30d3c52ded6ec1352749cbe7adc74523c241020c5',
];
const OLD_DESCRIPTION = 'Indo-Chinese noodles and North Indian curries from TKR Food Court, Mangalagiri: veg, egg and chicken.';

const runOwnerMenuFixes = async ({ menuFile = MENU_FILE } = {}) => {
  if (String(process.env.DISABLE_OWNER_MENU_FIXES || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const Restaurant = M('Restaurant');
  const MenuItem = M('MenuItem');
  if (!sequelize || !GlobalConfig || !Restaurant || !MenuItem) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };
  const out = { specKeysRemoved: 0, photo: 'not changed', description: 'not changed' };

  // 1. ownerMenuKey out of every item's specs (read and filtered here: specs is JSON on Postgres, TEXT on SQLite).
  const items = await MenuItem.findAll({ attributes: ['id', 'specs'] });
  for (const it of items) {
    let specs = it.specs;
    if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { continue; } }
    if (!specs || typeof specs !== 'object' || !('ownerMenuKey' in specs)) continue;
    const { ownerMenuKey, ...rest } = specs; // eslint-disable-line no-unused-vars
    await MenuItem.update({ specs: rest }, { where: { id: it.id } });
    out.specKeysRemoved++;
  }

  // 2 + 3. The Amrutham store (found through the import ledger).
  const Ledger = M('CatalogueImportLedger');
  const entry = Ledger ? await Ledger.findOne({ where: { importKey: STORE_KEY, kind: 'owner-store' } }) : null;
  const store = entry ? await Restaurant.findByPk(entry.targetId) : null;
  if (store) {
    const data = JSON.parse(fs.readFileSync(menuFile, 'utf8'));
    const Media = M('CampusMedia');
    const ours = Media ? (await Media.findAll({ where: { sha256: REPLACEABLE_PHOTO_SHA256 }, attributes: ['id'] })).map((m) => String(m.id)) : [];
    const current = String(store.imageUrl || '');
    if (ours.some((id) => current.endsWith(`/api/campus/media/${id}`))) {
      const { saveImageBytes } = require('../utils/imageStore');
      const { apiUrl } = require('../utils/publicUrl');
      const buf = fs.readFileSync(path.join(path.dirname(menuFile), data.imagesDir, data.store.image));
      const saved = await saveImageBytes(buf, { purpose: 'store' });
      await store.update({ imageUrl: apiUrl(null, `/api/campus/media/${saved.id}`, { renderFallback: true }) });
      out.photo = 'storefront';
    } else {
      out.photo = current ? 'kept (changed by the admin)' : 'kept (none)';
    }
    const desc = String(store.stallDescription || '').trim();
    if (desc === OLD_DESCRIPTION && data.store.description) {
      await store.update({ stallDescription: data.store.description });
      out.description = 'updated';
    } else {
      out.description = desc === String(data.store.description || '').trim() ? 'already current' : 'kept (changed by the admin)';
    }
  } else {
    out.photo = out.description = 'no Amrutham store';
  }

  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), ...out }) });
  try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  return out;
};

module.exports = { runOwnerMenuFixes, MARKER, REPLACEABLE_PHOTO_SHA256, OLD_DESCRIPTION };
