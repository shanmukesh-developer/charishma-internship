// Owner menu fixes, once (GlobalConfig OWNER_MENU_FIXES_V1_DONE). Owner, 1 Nov 2026 night: "amrutham image is not
// original, and restaurant description is not great, and why owner menu key like something showing" and "we have
// licence to keep their original photos as we collaborated with them".
//  1. The importer stored specs.ownerMenuKey on every dish; the customer app lists unknown specs as product details,
//     so "Owner menu key: owner-menu:..." showed on the dish page. The key is removed from every MenuItem (only that
//     key; the import ledger keeps the mapping).
//  2. The Amrutham store photo becomes the restaurant's own storefront photo (data/owner-menus images/storefront.jpg),
//     only while the store still shows the stock cover the importer saved (its bytes' SHA-256 is known): a photo
//     the admin uploaded meanwhile is never replaced.
//  3. Its description becomes the new one from the menu file, only while it is still the importer's first text.
// DISABLE_OWNER_MENU_FIXES=true switches it off.
const fs = require('fs');
const path = require('path');

const MARKER = 'OWNER_MENU_FIXES_V1_DONE';
const STORE_KEY = 'owner-menu:amrutham-mangalagiri';
const MENU_FILE = path.join(__dirname, '..', 'data', 'owner-menus', 'amrutham-mangalagiri-v1-2026-11-01.json');
const OLD_COVER_SHA256 = 'f541e3dfc79be2ca8e63e09dffa57dfc747b87a8f016254c305040024101105e';
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
    const oldIds = Media ? (await Media.findAll({ where: { sha256: OLD_COVER_SHA256 }, attributes: ['id'] })).map((m) => String(m.id)) : [];
    const current = String(store.imageUrl || '');
    if (oldIds.some((id) => current.endsWith(`/api/campus/media/${id}`))) {
      const { saveImageBytes } = require('../utils/imageStore');
      const { apiUrl } = require('../utils/publicUrl');
      const buf = fs.readFileSync(path.join(path.dirname(menuFile), data.imagesDir, data.store.image));
      const saved = await saveImageBytes(buf, { purpose: 'store' });
      await store.update({ imageUrl: apiUrl(null, `/api/campus/media/${saved.id}`, { renderFallback: true }) });
      out.photo = 'storefront';
    } else {
      out.photo = current ? 'kept (changed by the admin)' : 'kept (none)';
    }
    if (String(store.stallDescription || '').trim() === OLD_DESCRIPTION && data.store.description) {
      await store.update({ stallDescription: data.store.description });
      out.description = 'updated';
    } else {
      out.description = 'kept (changed by the admin)';
    }
  } else {
    out.photo = out.description = 'no Amrutham store';
  }

  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), ...out }) });
  try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  return out;
};

module.exports = { runOwnerMenuFixes, MARKER, OLD_COVER_SHA256, OLD_DESCRIPTION };
