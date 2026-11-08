// Reorder all menu items in every category from low price to high price, once (ALL_CATEGORIES_PRICE_ASC_V1_DONE).
// Owner, 7 Nov 2026: "for every category of our application start from low price".
//
// Rules:
//  - Keeps category ordering intact (based on lowest sortOrder in category or designated category rank);
//  - Inside each category, sorts all items primarily by price ascending (lowest price first);
//  - If prices match, sorts alphabetically by name;
//  - Re-assigns clean, sequential sortOrders (e.g. 10, 20, 30...) with clear spacing between categories;
//  - Idempotent: sets GlobalConfig marker so it runs once on startup and never overwrites future manual admin edits.
//
// DISABLE_ALL_CATEGORIES_PRICE_ASC=true switches it off.
const MARKER = 'ALL_CATEGORIES_PRICE_ASC_V1_DONE';

const runAllCategoriesPriceAsc = async () => {
  if (String(process.env.DISABLE_ALL_CATEGORIES_PRICE_ASC || '').toLowerCase() === 'true') {
    return { skipped: 'disabled' };
  }
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const MenuItem = M('MenuItem');
  const Restaurant = M('Restaurant');

  if (!sequelize || !GlobalConfig || !MenuItem || !Restaurant) {
    return { skipped: 'models not ready' };
  }

  const existingMarker = await GlobalConfig.findOne({ where: { key: MARKER } });
  if (existingMarker) {
    return { skipped: 'already done' };
  }

  const restaurants = await Restaurant.findAll({ attributes: ['id', 'name'] });
  let totalUpdated = 0;

  for (const r of restaurants) {
    const items = await MenuItem.findAll({ where: { restaurantId: r.id } });
    if (!items.length) continue;

    // Group items by category
    const byCat = new Map();
    for (const it of items) {
      const cat = String(it.category || 'General').trim();
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(it);
    }

    const readSo = (it) => {
      let s = it.specs;
      if (typeof s === 'string') {
        try { s = JSON.parse(s); } catch { s = null; }
      }
      const n = Number(s?.sortOrder);
      return Number.isFinite(n) ? n : Infinity;
    };

    // Keep existing relative category ranking
    const catEntries = Array.from(byCat.entries()).map(([cat, list]) => {
      const minSo = Math.min(...list.map(readSo));
      return { cat, list, minSo };
    });
    catEntries.sort((a, b) => (a.minSo - b.minSo) || a.cat.localeCompare(b.cat));

    let baseOrder = 10;
    for (const { list } of catEntries) {
      // Sort inside category from lowest price to highest price
      list.sort((a, b) => {
        const pa = Number(a.price) || 0;
        const pb = Number(b.price) || 0;
        if (pa !== pb) return pa - pb;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

      for (const it of list) {
        let specs = it.specs;
        if (typeof specs === 'string') {
          try { specs = JSON.parse(specs); } catch { specs = {}; }
        }
        specs = specs && typeof specs === 'object' ? { ...specs } : {};
        specs.sortOrder = baseOrder;
        await it.update({ specs });
        totalUpdated += 1;
        baseOrder += 10;
      }
      baseOrder += 50; // buffer gap between categories
    }
  }

  await GlobalConfig.create({
    key: MARKER,
    value: { totalUpdated, completedAt: new Date().toISOString() },
    description: 'All menu categories sorted from low price to high price ascending',
  });

  return { ok: true, totalUpdated, restaurantsCount: restaurants.length };
};

module.exports = { runAllCategoriesPriceAsc, MARKER };
