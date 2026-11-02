// The Amrutham menu (owner, 1 Nov 2026, from the printed menu card): every printed dish except the circled Indian
// Breads, at the printed price; a full description in the pickles layout; one real photo per dish (valid image, no
// two alike, no camera metadata) and a credit for each; the store photo is the restaurant's own storefront (used with
// its permission, owner 1 Nov night) and the store description's facts match the menu. Data only: no database.
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

test('the store description: a short intro, then the menu and the facts, which match the menu file', () => {
  const d = menu.store.description;
  const [intro, ...rest] = d.split('\n\n');
  assert.ok(intro.length > 80 && intro.length <= 200 && !intro.includes('\n'), `intro: ${intro}`);
  assert.ok(rest.some((p) => p.startsWith('**On the menu**\n- ')) && rest.some((p) => p.startsWith('**Good to know**\n- ')), d);
  const prices = menu.items.map((i) => i.price);
  assert.ok(d.includes(`${menu.items.length} dishes, from ₹${Math.min(...prices)} to ₹${Math.max(...prices)}`), 'count and price range');
  const t12 = (hm) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  assert.ok(d.includes(`${t12(menu.store.operatingHours.start)} to ${t12(menu.store.operatingHours.end)}`), 'hours');
  for (const dish of ['Thecha', 'Paneer Butter Masala', 'Butter Chicken', 'Egg Bhurji']) {
    assert.ok(d.includes(dish) && menu.items.some((i) => i.name.includes(dish)), `${dish} named and on the menu`);
  }
});

// Width and height from a JPEG's start-of-frame marker.
const jpegSize = (buf) => {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
};

test('the store photo is a banner crop: the store page shows it about 2:1, so the whole sign must fit that frame', () => {
  const { w, h } = jpegSize(fs.readFileSync(path.join(IMG, menu.store.image)));
  assert.ok(w >= 800 && w / h >= 1.6 && w / h <= 1.85, `${w}x${h}`);
});

test('one real photo per dish and the store photo: valid JPEG, no two alike, no camera metadata, each credited', () => {
  assert.strictEqual(menu.store.image, 'storefront-banner.jpg');
  const files = [menu.store.image, ...menu.items.map((i) => i.image)];
  // 2 Nov: sharper copies of the same photos (<slug>-v2.jpg, up to 1400 px); a new file name, never an overwrite,
  // and each names the photo it replaces so the live server swaps it (scripts/owner_menu_import photo sync).
  assert.ok(menu.items.every((i) => new RegExp(`^${i.slug}(-v\\d+)?\\.jpg$`).test(i.image)), 'file names');
  for (const i of menu.items.filter((x) => /-v\d+\.jpg$/.test(x.image))) {
    const own = crypto.createHash('sha256').update(fs.readFileSync(path.join(IMG, i.image))).digest('hex');
    assert.ok((i.replacesPhotos || []).length && !i.replacesPhotos.includes(own), `${i.slug} replacesPhotos`);
  }
  const hashes = new Set();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(IMG, f));
    assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${f} is a JPEG`);
    assert.ok(!buf.includes(Buffer.from('Exif\0\0')), `${f} carries no camera metadata`);
    assert.ok(buf.length > 20 * 1024 && buf.length < 700 * 1024, `${f} size ${buf.length}`);
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    assert.ok(!hashes.has(h), `${f} is not a duplicate`);
    hashes.add(h);
  }
  const byFile = new Map(sources.map((s) => [s.file, s]));
  assert.strictEqual(sources.length, files.length);
  const LICENCES = /^(Unsplash License|Pexels License|CC0|Public domain|CC BY(-SA)? [234]\.0)/i;
  // The storefront is the restaurant's own photo (from its EazyDiner listing), used with its permission.
  const own = byFile.get(menu.store.image);
  assert.deepStrictEqual([own.author, own.licence, own.match, own.modified], ['Amrutham Restaurant', 'Used with the permission of Amrutham Restaurant', 'exact', 'cropped']);
  assert.match(own.sourcePage, /^https:\/\/www\.eazydiner\.com\/vijayawada\/amrutham-mangalagiri-vijayawada-711883\//);
  for (const f of files.slice(1)) {
    const s = byFile.get(f);
    assert.ok(s, `${f} has a credit`);
    assert.match(s.licence, LICENCES, `${f} licence ${s.licence}`);
    assert.match(s.sourcePage, /^https:\/\/(commons\.wikimedia\.org|www\.pexels\.com|unsplash\.com)\//, `${f} source page`);
    if (/^CC BY/i.test(s.licence)) assert.ok(s.author && s.author.length > 1, `${f}: a CC BY photo names its author`);
  }
});
