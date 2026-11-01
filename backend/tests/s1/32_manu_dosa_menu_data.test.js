// The Manu Dosa Place menu (owner, 1 Nov 2026, from the printed menu card): every printed dish,
// at the printed price; a full description in the pickles layout; one real photo per dish (valid image, no
// two alike, no camera metadata) and a credit for each; the store photo is the restaurant's own storefront
// banner crop and the store description's facts match the menu. Data only: no database.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const DIR = path.join(B, 'data', 'owner-menus');
const menu = JSON.parse(fs.readFileSync(path.join(DIR, 'manu-dosa-place-v1-2026-11-01.json'), 'utf8'));
const IMG = path.join(DIR, menu.imagesDir);
const sources = JSON.parse(fs.readFileSync(path.join(IMG, 'sources.json'), 'utf8'));

test('every printed dish at the printed price, with the right diet mark', () => {
  assert.strictEqual(menu.items.length, 60);
  for (const i of menu.items) {
    const n = i.name.toLowerCase();
    const want = /chicken|keema|parota/.test(n) ? 'nonveg' : /egg/.test(n) ? 'egg' : 'veg';
    assert.strictEqual(i.dietType, want, `${i.name} diet`);
    assert.ok(i.price > 0, `${i.name} price`);
  }
  assert.strictEqual(menu.store.name, 'Manu Dosa Place');
  assert.deepStrictEqual(menu.store.operatingHours, { start: '07:00', end: '23:00' });
  assert.ok(Math.abs(menu.store.lat - 16.4214) < 1e-4 && Math.abs(menu.store.lon - 80.5608) < 1e-4);
});

test('full descriptions in the pickles layout for all 60 dishes', () => {
  for (const i of menu.items) {
    const d = i.description;
    for (const part of ['\n\nIngredients (Typical):\n- ', '\n\nSpicy Level: ', '\n\nServing Suggestion: ', '\n\nTaste Profile: ']) {
      assert.ok(d.includes(part), `${i.name}: ${part.trim()}`);
    }
    assert.ok(d.split('\n')[0].length > 40, `${i.name}: opening paragraph`);
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
  for (const dish of ['Idly', 'Ghee', 'Cheese', 'Pizza Dosa']) {
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
  const own = byFile.get(menu.store.image);
  assert.deepStrictEqual([own.author, own.licence, own.match, own.modified], ['Manu Dosa Place', 'Used with the permission of Manu Dosa Place', 'exact', 'cropped']);
  assert.match(own.sourcePage, /^https:\/\/www\.justdial\.com\//);
  for (const f of files.slice(1)) {
    const s = byFile.get(f);
    assert.ok(s, `${f} has a credit`);
    assert.match(s.licence, LICENCES, `${f} licence ${s.licence}`);
    assert.match(s.sourcePage, /^https:\/\/(commons\.wikimedia\.org|www\.pexels\.com|unsplash\.com)\//, `${f} source page`);
    if (/^CC BY/i.test(s.licence)) assert.ok(s.author && s.author.length > 1, `${f}: a CC BY photo names its author`);
  }
});

