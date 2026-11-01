// The Amrutham menu (owner, 1 Nov 2026, from the printed menu card): every printed dish except the circled Indian
// Breads, at the printed price; a full description in the pickles layout; one real photo per dish (valid image, no
// two alike, no camera metadata) and a credit for each. Data only: no database.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const DIR = path.join(B, 'data', 'owner-menus');
const menu = JSON.parse(fs.readFileSync(path.join(DIR, 'amrutham-mangalagiri-v1-2026-11-01.json'), 'utf8'));
const IMG = path.join(DIR, menu.imagesDir);
const sources = JSON.parse(fs.readFileSync(path.join(IMG, 'sources.json'), 'utf8'));

// The printed card, section by section (menu name: price).
const CARD = {
  'Non-Veg Noodles': { 'Egg Noodles': 90, 'Egg Schezwan Noodles': 100, 'Egg Peri Peri Noodles': 100, 'Egg Maggi Masala Noodles': 100, 'Chicken Noodles': 120, 'Chicken Schezwan Noodles': 130, 'Chicken Peri Peri Noodles': 130, 'Chicken Maggi Masala Noodles': 130, 'Mix Non-Veg Noodles Special': 200 },
  'Veg Noodles': { 'Veg Noodles': 80, 'Hakka Noodles': 80, 'Veg Schezwan Noodles': 100, 'Peri Peri Noodles': 100, 'Maggi Masala Noodles': 100, 'Manchurian Noodles': 100, 'Paneer Noodles': 120, 'Kaju Noodles': 120, 'Mushroom Noodles': 120, 'Thecha Noodles (Amrutham Special)': 120, 'Mix Noodles Special': 150 },
  'Veg Curries': { 'Mix Veg Curry': 120, 'Paneer Butter Masala': 150, 'Kadai Paneer': 150, 'Paneer Hyderabadi': 150, 'Paneer Shahi Kurma': 150, 'Shahi Paneer': 150, 'Kaju Masala': 150, 'Kaju Paneer': 170, 'Mushroom Curry': 130, 'Mushroom Masala': 150, 'Babycorn Curry': 130, 'Babycorn Masala': 150 },
  'Non-Veg Curries': { 'Chicken Curry (Bone)': 150, 'Chicken Boneless Curry': 170, 'Butter Chicken': 200, 'Kadai Chicken': 170, 'Andhra Chicken': 200, 'Chicken Hyderabadi': 200, 'Chicken Kali Mirch': 220, 'Afghani Chicken': 230, 'Mughlai Chicken': 230, 'Egg Curry': 120, 'Egg Bhurji': 120, 'Egg Masala': 150, 'Plain Omelette (Double Egg)': 40, 'Masala Omelette': 50 },
};

test('every printed dish (not the circled Indian Breads) at the printed price, in its section, with the right diet mark', () => {
  const want = Object.entries(CARD).flatMap(([cat, dishes]) => Object.entries(dishes).map(([name, price]) => ({ cat, name, price })));
  assert.strictEqual(menu.items.length, 46);
  assert.deepStrictEqual(menu.items.map((i) => [i.category, i.name, i.price]), want.map((w) => [w.cat, w.name, w.price]));
  for (const bread of ['pulka', 'chapati', 'butter chapati']) assert.ok(!menu.items.some((i) => i.name.toLowerCase() === bread), `${bread} left out`);
  for (const i of menu.items) {
    const n = i.name.toLowerCase();
    const want = /chicken|non-veg/.test(n) ? 'nonveg' : /egg|omelette/.test(n) ? 'egg' : 'veg';
    assert.strictEqual(i.dietType, want, `${i.name} diet`);
  }
  assert.strictEqual(menu.store.name, 'Amrutham Restaurant');
  assert.deepStrictEqual(menu.store.operatingHours, { start: '12:30', end: '22:30' });
  assert.ok(Math.abs(menu.store.lat - 16.4185622) < 1e-6 && Math.abs(menu.store.lon - 80.5625065) < 1e-6);
});

test('full descriptions in the pickles layout', () => {
  for (const i of menu.items) {
    const d = i.description;
    for (const part of ['\n\nIngredients (Typical):\n- ', '\n\nSpicy Level: ', '\n\nServing Suggestion: ', '\n\nTaste Profile: ']) assert.ok(d.includes(part), `${i.name}: ${part.trim()}`);
    assert.ok(d.split('\n')[0].length > 40, `${i.name}: opening paragraph`);
    assert.ok(!/scrambled/.test(d) || i.name === 'Egg Bhurji', `${i.name}: egg wording matches the photo`);
  }
});

test('one real photo per dish and a cover: valid JPEG, no two alike, no camera metadata, each credited', () => {
  const files = ['cover.jpg', ...menu.items.map((i) => i.image)];
  assert.deepStrictEqual(menu.items.map((i) => i.image), menu.items.map((i) => `${i.slug}.jpg`));
  const hashes = new Set();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(IMG, f));
    assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${f} is a JPEG`);
    assert.ok(!buf.includes(Buffer.from('Exif\0\0')), `${f} carries no camera metadata`);
    assert.ok(buf.length > 20 * 1024 && buf.length < 450 * 1024, `${f} size ${buf.length}`);
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    assert.ok(!hashes.has(h), `${f} is not a duplicate`);
    hashes.add(h);
  }
  const byFile = new Map(sources.map((s) => [s.file, s]));
  assert.strictEqual(sources.length, files.length);
  const LICENCES = /^(Unsplash License|Pexels License|CC0|Public domain|CC BY(-SA)? [234]\.0)/i;
  for (const f of files) {
    const s = byFile.get(f);
    assert.ok(s, `${f} has a credit`);
    assert.match(s.licence, LICENCES, `${f} licence ${s.licence}`);
    assert.match(s.sourcePage, /^https:\/\/(commons\.wikimedia\.org|www\.pexels\.com|unsplash\.com)\//, `${f} source page`);
    if (/^CC BY/i.test(s.licence)) assert.ok(s.author && s.author.length > 1, `${f}: a CC BY photo names its author`);
  }
});
