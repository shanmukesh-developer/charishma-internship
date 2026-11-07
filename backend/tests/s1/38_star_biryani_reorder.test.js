const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');
const { runStarDumBiryaniReorder, MARKER } = require('../../scripts/star_dum_biryani_reorder');
const { sortMenuItems } = require('../../utils/menuSort');

before(async () => {
  await H.setup();
});
after(H.teardown);

test('Star Dum Biryani reorder: Biryanis section moves to top, and Chicken / lower price items to top inside Biryanis', async () => {
  const { Restaurant, MenuItem, GlobalConfig } = H.ctx.sequelize.models;

  await GlobalConfig.destroy({ where: { key: MARKER } });

  const restaurant = await Restaurant.create({
    name: 'Star Dum Biryani',
    location: 'Mangalagiri',
    vendorType: 'RESTAURANT',
  });

  // Create Tandoori item (currently order 10)
  await MenuItem.create({
    restaurantId: restaurant.id,
    name: 'Chicken Tandoori Joint',
    price: 150,
    category: 'Tandoori',
    specs: { sortOrder: 10 },
  });

  // Create Mutton Biryani item (currently high price Rs. 500)
  await MenuItem.create({
    restaurantId: restaurant.id,
    name: 'Mutton Dum Biryani',
    price: 500,
    category: 'Biryanis',
    specs: { sortOrder: 250 },
  });

  // Create Chicken Biryani item (price Rs. 260)
  await MenuItem.create({
    restaurantId: restaurant.id,
    name: 'Chicken Dum Andhra Biryani',
    price: 260,
    category: 'Biryanis',
    specs: { sortOrder: 420 },
  });

  // Create Biryani Rice (price Rs. 150)
  await MenuItem.create({
    restaurantId: restaurant.id,
    name: 'Biryani Rice',
    price: 150,
    category: 'Biryanis',
    specs: { sortOrder: 620 },
  });

  // Run reorder
  const res = await runStarDumBiryaniReorder();
  assert.equal(res.ok, true);
  assert.equal(res.updatedCount, 4);

  // Check marker
  const markerRow = await GlobalConfig.findOne({ where: { key: MARKER } });
  assert.ok(markerRow, 'Marker should be set');

  // Verify sortMenuItems ordering
  const items = await MenuItem.findAll({ where: { restaurantId: restaurant.id } });
  const sorted = sortMenuItems(items);

  // 1. Biryanis category items must be before Tandoori
  const biryaniIndices = sorted.map((it, idx) => (it.category === 'Biryanis' ? idx : -1)).filter((idx) => idx !== -1);
  const tandooriIndex = sorted.findIndex((it) => it.category === 'Tandoori');
  assert.ok(Math.max(...biryaniIndices) < tandooriIndex, 'All Biryanis must come before Tandoori');

  // 2. Inside Biryanis, Biryani Rice (150) & Chicken Dum (260) must come before Mutton (500)
  const biryanisSorted = sorted.filter((it) => it.category === 'Biryanis');
  assert.equal(biryanisSorted[0].name, 'Biryani Rice');
  assert.equal(biryanisSorted[1].name, 'Chicken Dum Andhra Biryani');
  assert.equal(biryanisSorted[2].name, 'Mutton Dum Biryani');
});

