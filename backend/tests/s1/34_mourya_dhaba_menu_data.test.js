// Sri Lakshmi Mourya Dhaba (owner, 5 Nov 2026, two photos of the printed menu card): 216 dishes in card order with
// the card's sections; veg / egg / non-veg marks that never put meat or egg on a veg dish; a full description in the
// pickles layout; one real photo per dish (valid JPEG, no two alike, none shared with another store, no camera
// metadata) with a licensed credit; the storefront photo used with the restaurant's permission; the store
// description's facts match the menu. Data only: no database.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'data', 'owner-menus');
const menu = JSON.parse(fs.readFileSync(path.join(DIR, 'sri-lakshmi-mourya-dhaba-mangalagiri-v1-2026-11-05.json'), 'utf8'));
const IMG = path.join(DIR, menu.imagesDir);
const sources = JSON.parse(fs.readFileSync(path.join(IMG, 'sources.json'), 'utf8'));
const { menuProblems } = require(path.join(__dirname, '..', '..', 'scripts', 'owner_menu_import'));

const SECTIONS = ['Veg Biryani', 'Non-Veg Biryani', 'Family Pack Biryani', 'Tandoori Starters', 'Fried Rice', 'Veg Starters',
  'Egg Starters', 'Non-Veg Starters', 'Non-Veg Curries', 'Veg Curries', 'Egg Curries', 'Roti & Parota', 'Meals', 'Beverages'];
const LICENCES = /^(CC0|CC BY(-SA)? [0-9.]+|Public domain|Pexels License|Unsplash License|Used with the permission of Sri Lakshmi Mourya Dhaba)$/i;

test('the importer accepts the file', () => {
  assert.deepStrictEqual(menuProblems(menu, DIR), []);
});

test('216 dishes, sections in card order, unique slugs, whole-rupee prices', () => {
  assert.strictEqual(menu.items.length, 216);
  const order = [...new Set(menu.items.map((i) => i.category))];
  assert.deepStrictEqual(order, SECTIONS);
  assert.strictEqual(new Set(menu.items.map((i) => i.slug)).size, 216);
  for (const i of menu.items) assert.ok(Number.isInteger(i.price) && i.price > 0, `${i.name} price`);
});

test('diet marks: no meat or egg on a veg dish, egg dishes marked egg', () => {
  for (const i of menu.items) {
    const n = i.name.toLowerCase();
    if (/chicken|mutton|fish|prawn|non-veg|nonveg/.test(n)) assert.strictEqual(i.dietType, 'nonveg', i.name);
    else if (/\begg\b/.test(n)) assert.strictEqual(i.dietType, 'egg', i.name);
    if (['Veg Biryani', 'Veg Starters', 'Veg Curries', 'Roti & Parota', 'Meals', 'Beverages'].includes(i.category)) {
      assert.ok(!/chicken|mutton|fish|prawn|\begg\b/.test(n), `${i.name} in a veg section`);
    }
  }
});

test('every description has the pickles layout', () => {
  for (const i of menu.items) {
    for (const part of ['Ingredients (Typical):', 'Spicy Level:', 'Serving Suggestion:', 'Taste Profile:']) {
      assert.ok(i.description.includes(part), `${i.name}: ${part}`);
    }
  }
});

test('one photo per dish: valid, no two alike, none from another store, no camera metadata, each credited', () => {
  const seen = new Map();
  for (const i of menu.items) {
    const buf = fs.readFileSync(path.join(IMG, i.image));
    assert.strictEqual(buf.readUInt16BE(0), 0xffd8, `${i.image} is a JPEG`);
    assert.ok(!buf.includes(Buffer.from('Exif\0\0')), `${i.image} has no EXIF`);
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    assert.ok(!seen.has(h), `${i.image} repeats ${seen.get(h)}`);
    seen.set(h, i.image);
  }
  const credited = new Map(sources.map((s) => [s.file, s]));
  for (const i of menu.items) {
    const s = credited.get(i.image);
    assert.ok(s, `${i.image} credited`);
    assert.ok(LICENCES.test(s.licence), `${i.image} licence ${s.licence}`);
    assert.ok(s.shows && s.author, `${i.image} says what it shows and who took it`);
    assert.ok(['exact', 'closest match'].includes(s.match), `${i.image} match`);
  }
  const others = new Set();
  for (const d of fs.readdirSync(path.join(DIR, 'images'))) {
    if (d === path.basename(IMG)) continue;
    const f = path.join(DIR, 'images', d, 'sources.json');
    if (fs.existsSync(f)) for (const s of JSON.parse(fs.readFileSync(f, 'utf8'))) others.add(s.sourcePage || s.imageUrl);
  }
  for (const s of sources) if (s.sourcePage) assert.ok(!others.has(s.sourcePage), `${s.file} is used by another store`);
});

test('store photo is the restaurant\'s own, with permission; description facts match the menu', () => {
  const store = sources.find((s) => s.file === menu.store.image);
  assert.strictEqual(store.licence, 'Used with the permission of Sri Lakshmi Mourya Dhaba');
  const prices = menu.items.map((i) => i.price);
  assert.ok(menu.store.description.includes(`${menu.items.length} dishes, from ₹${Math.min(...prices)} to ₹${Math.max(...prices)}`));
  assert.ok(menu.store.description.includes('12:00 PM to 11:00 PM'));
  assert.deepStrictEqual(menu.store.operatingHours, { start: '12:00', end: '23:00' });
});
