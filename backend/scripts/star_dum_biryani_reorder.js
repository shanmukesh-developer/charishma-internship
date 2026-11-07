// Star Dum Biryani menu reorder, once (GlobalConfig STAR_DUM_BIRYANI_REORDER_V1_DONE).
//
// Owner, 7 Nov 2026:
//  - "In biryanis section move the small price / Chicken biryani items to top"
//  - "In different sections move the biryanis section to first/ second"
//
// Updates specs.sortOrder for items belonging to "Star Dum Biryani":
//  1. Sets 'Biryanis' category to lowest sortOrder so it appears first among sections.
//  2. Inside 'Biryanis', chicken & budget items (Chicken, Egg, Rice) appear at the top
//     ordered by price ascending (Rs. 150 - Rs. 450), followed by Mutton items (Rs. 300 - Rs. 700).
//
// DISABLE_STAR_DUM_BIRYANI_REORDER=true switches it off.
const MARKER = 'STAR_DUM_BIRYANI_REORDER_V1_DONE';
const RESTAURANT_NAME = 'Star Dum Biryani';

const CAT_ORDER = [
  'Biryanis',
  'Tandoori',
  'Shawarma',
  'Roti Basket',
  'Family Packs',
  'Curries',
  'Starters',
  'Fried Rice',
  'Noodles',
  'Sea Food Biryani',
  'Sea Foods',
  'Veg Biryani',
];

const runStarDumBiryaniReorder = async () => {
  if (String(process.env.DISABLE_STAR_DUM_BIRYANI_REORDER || '').toLowerCase() === 'true') {
    return { skipped: 'disabled' };
  }
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const Restaurant = M('Restaurant');
  const MenuItem = M('MenuItem');

  if (!sequelize || !GlobalConfig || !Restaurant || !MenuItem) {
    return { skipped: 'models not ready' };
  }

  const existingMarker = await GlobalConfig.findOne({ where: { key: MARKER } });
  if (existingMarker) {
    return { skipped: 'already done' };
  }

  const { Op } = require('sequelize');
  const isPostgres = sequelize.getDialect() === 'postgres';
  const likeOp = isPostgres && Op.iLike ? Op.iLike : Op.like;
  const restaurant = await Restaurant.findOne({
    where: {
      name: { [likeOp]: `%${RESTAURANT_NAME}%` },
    },
  });

  if (!restaurant) {
    return { skipped: 'restaurant not found' };
  }

  const items = await MenuItem.findAll({
    where: { restaurantId: restaurant.id },
  });

  if (!items.length) {
    return { skipped: 'no menu items found' };
  }

  const byCat = {};
  for (const it of items) {
    const cat = it.category || 'Other';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(it);
  }

  let baseOrder = 10;
  let updatedCount = 0;

  // Reorder according to CAT_ORDER, followed by any remaining categories
  const allCategories = [...CAT_ORDER];
  for (const c of Object.keys(byCat)) {
    if (!allCategories.includes(c)) allCategories.push(c);
  }

  for (const cat of allCategories) {
    const catItems = byCat[cat] || [];
    if (!catItems.length) continue;

    if (cat.toLowerCase() === 'biryanis') {
      const rank = (it) => {
        const name = String(it.name || '').toLowerCase();
        if (name.includes('mutton')) return 2;
        return 1;
      };
      catItems.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return (Number(a.price) || 0) - (Number(b.price) || 0);
      });
    } else {
      catItems.sort((a, b) => {
        const getSo = (it) => {
          let s = it.specs;
          if (typeof s === 'string') {
            try { s = JSON.parse(s); } catch { s = null; }
          }
          const n = Number(s?.sortOrder);
          return Number.isFinite(n) ? n : 999999;
        };
        return getSo(a) - getSo(b);
      });
    }

    for (const it of catItems) {
      let specs = it.specs;
      if (typeof specs === 'string') {
        try { specs = JSON.parse(specs); } catch { specs = {}; }
      }
      specs = specs && typeof specs === 'object' ? { ...specs } : {};
      specs.sortOrder = baseOrder;

      await it.update({ specs });
      updatedCount += 1;
      baseOrder += 10;
    }
    baseOrder += 50;
  }

  await GlobalConfig.create({
    key: MARKER,
    value: { updatedCount, completedAt: new Date().toISOString() },
    description: 'Star Dum Biryani category and item reorder (Biryanis first, chicken/budget on top)',
  });

  return { ok: true, restaurantId: restaurant.id, updatedCount };
};

module.exports = { runStarDumBiryaniReorder, MARKER, RESTAURANT_NAME, CAT_ORDER };
