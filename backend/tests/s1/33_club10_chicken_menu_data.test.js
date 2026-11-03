// The Club 10 Chicken menu (owner, 3 Nov 2026, from two photos of the printed menu card): every printed dish at the
// printed price, the card's sizes (S / M / L, 5 or 10 pieces, fried or steamed) as the dish's choices with its price
// the lowest; the veg / non-veg marks the owner confirmed; a full description in the pickles layout; one real photo
// per dish (valid image, no two alike, no camera metadata) and a credit for each; the store photo is the restaurant's
// own logo on a banner, used with its permission; the store description's facts match the menu. Data only: no database.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const DIR = path.join(B, 'data', 'owner-menus');
const menu = JSON.parse(fs.readFileSync(path.join(DIR, 'club-10-chicken-mangalagiri-v1-2026-11-03.json'), 'utf8'));
const IMG = path.join(DIR, menu.imagesDir);
const sources = JSON.parse(fs.readFileSync(path.join(IMG, 'sources.json'), 'utf8'));
const { normalizeOptions, variantFromPrice } = require(path.join(B, 'utils', 'productOptions'));

// The card, typed again from the photos: one price, or the size / count / style prices in card order.
const PRINTED = {
  'fried-chicken': { Pieces: { '2 pieces': 190, '5 pieces': 400, '10 pieces': 770 } }, 'mixed-bucket': 440,
  'chicken-wings': { Pieces: { '5 pieces': 150, '10 pieces': 280 } }, 'boneless-strips': { Pieces: { '5 pieces': 190, '10 pieces': 340 } },
  'chicken-lollipop': { Pieces: { '5 pieces': 200, '10 pieces': 350 } },
  'paneer-popcorn': { Size: { Small: 150, Medium: 300, Large: 600 } }, 'chicken-popcorn': { Size: { Small: 130, Medium: 250, Large: 500 } },
  'veg-burger': 125, 'crispy-patty-burger': 135, 'paneer-burger': 140, 'fried-chicken-burger': 150, 'tender-chicken-burger': 150,
  'club-10-special-burger': 170, 'club-10-cheesy-tower-burger': 180,
  'sweet-corn-pizza': 170, 'paneer-pizza': 180, 'chicken-pizza': 180, 'tandoori-chicken-pizza': 190, 'special-pizza': 230,
  'veg-pasta': 145, 'corn-pasta': 155, 'chicken-pasta': 180, 'corn-salad': 140, 'chicken-salad': 150,
  'chocolate-sandwich': 120, 'veg-sandwich': 130, 'tender-chicken-sandwich': 140, 'fried-chicken-sandwich': 140, 'paneer-sandwich': 145,
  'tandoori-mayo-sandwich': 145, 'veg-roll': 125, 'paneer-roll': 135, 'chicken-roll': 145,
  'meal-combo-sandwich': 179, 'meal-combo-burger': 179, 'kiddy-combo': 449, 'trendy-combo': 699, 'club-10-family-combo': 899,
  'cheese-slice': 15, 'nashville-sauce': 20, 'spicy-mayo': 20, 'bbq-sauce': 20, 'extra-cheese': 30,
  'mango-boba': 199, 'taro-boba': 199, 'tiramisu-boba': 199,
  'nutto-coffee-loaded': 125, 'strawberry-monster': 125, 'mango-burst': 125, 'bubblegum-blast': 125, 'butterscotch-shake': 125,
  'lychee-milkshake': 125, 'chocolate-oreo-shake': 125, 'chocolate-brownie-shake': 150,
  'mint-mojito': 115, 'blue-curacao': 115, 'green-apple-crush': 115, 'lychee-mojito': 115, 'watermelon-mojito': 115,
  'veg-momo': { Style: { Fried: 100, Steamed: 110 } }, 'paneer-momo': { Style: { Fried: 130, Steamed: 140 } }, 'chicken-momo': { Style: { Fried: 130, Steamed: 140 } },
  'fantasy-4-layer': 90, 'lava-cake': 110, 'vanilla-brownie': 110, 'lotus-biscoff': 115, 'chocolate-brownie': 130, kunafa: 249,
  'corn-samosa': 100, 'salted-french-fries': 100, 'masala-french-fries': 115, 'tandoori-french-fries': 115, 'cheesy-french-fries': 120,
  'chicken-loaded-fries': 180, 'paneer-loaded-fries': 180,
};
// Owner, 3 Nov 2026: Crispy Patty, Cheesy Tower and Tandoori Mayo are chicken; the Meal Combos are veg; desserts and
// the spicy mayo are eggless.
const NONVEG = ['fried-chicken', 'mixed-bucket', 'chicken-wings', 'boneless-strips', 'chicken-lollipop', 'chicken-popcorn',
  'crispy-patty-burger', 'fried-chicken-burger', 'tender-chicken-burger', 'club-10-special-burger', 'club-10-cheesy-tower-burger',
  'chicken-pizza', 'tandoori-chicken-pizza', 'special-pizza', 'chicken-pasta', 'chicken-salad', 'tender-chicken-sandwich',
  'fried-chicken-sandwich', 'tandoori-mayo-sandwich', 'chicken-roll', 'kiddy-combo', 'trendy-combo', 'club-10-family-combo',
  'chicken-momo', 'chicken-loaded-fries'];

test('every printed dish at the printed price, sizes as choices, with the right diet mark, in card order', () => {
  assert.deepStrictEqual(menu.items.map((i) => i.slug), Object.keys(PRINTED), 'dishes and order as on the card');
  for (const i of menu.items) {
    const want = PRINTED[i.slug];
    if (typeof want === 'number') {
      assert.strictEqual(i.price, want, `${i.name} price`);
      assert.strictEqual(i.options, undefined, `${i.name} has no choices`);
    } else {
      const groups = normalizeOptions(i.options);
      assert.strictEqual(groups.length, 1, `${i.name}: one group`);
      const [[name, choices]] = Object.entries(want);
      assert.deepStrictEqual([groups[0].name, groups[0].type], [name, 'variant'], `${i.name} group`);
      assert.deepStrictEqual(Object.fromEntries(groups[0].choices.map((c) => [c.label, c.price])), choices, `${i.name} choices`);
      assert.strictEqual(i.price, variantFromPrice(groups), `${i.name}: price is the lowest choice`);
    }
    assert.strictEqual(i.dietType, NONVEG.includes(i.slug) ? 'nonveg' : 'veg', `${i.name} diet`);
    if (/chicken/i.test(i.name)) assert.strictEqual(i.dietType, 'nonveg', `${i.name} is named chicken`);
  }
  assert.strictEqual(menu.store.name, 'Club 10 Chicken');
  assert.strictEqual(menu.store.vendorType, 'RESTAURANT');
  assert.deepStrictEqual(menu.store.operatingHours, { start: '12:00', end: '22:30' });
  assert.ok(Math.abs(menu.store.lat - 16.4160477) < 1e-6 && Math.abs(menu.store.lon - 80.5605883) < 1e-6);
});

test('full descriptions in the pickles layout for all 75 dishes; combos list what is in them', () => {
  for (const i of menu.items) {
    const d = i.description;
    const list = i.category === 'Combos' ? 'In the combo:' : i.slug === 'mixed-bucket' ? 'In the bucket:' : 'Ingredients (Typical):';
    for (const part of [`\n\n${list}\n- `, '\n\nSpicy Level: ', '\n\nServing Suggestion: ', '\n\nTaste Profile: ']) {
      assert.ok(d.includes(part), `${i.name}: ${part.trim()}`);
    }
    assert.ok(d.split('\n')[0].length > 40, `${i.name}: opening paragraph`);
  }
  const bucket = menu.items.find((i) => i.slug === 'mixed-bucket').description;
  for (const part of ['2 pieces of fried chicken', '2 chicken lollipops', '2 boneless strips', '2 chicken wings']) assert.ok(bucket.includes(part), part);
});

test('the store description: a short intro, then the menu and the facts, which match the menu file', () => {
  const d = menu.store.description;
  const [intro, ...rest] = d.split('\n\n');
  assert.ok(intro.length > 80 && intro.length <= 200 && !intro.includes('\n'), `intro: ${intro}`);
  assert.ok(rest.some((p) => p.startsWith('**On the menu**\n- ')) && rest.some((p) => p.startsWith('**Good to know**\n- ')), d);
  const prices = menu.items.map((i) => i.price);
  assert.ok(d.includes(`${menu.items.length} dishes, from ₹${Math.min(...prices)} to ₹${Math.max(...prices)}`), 'count and price range');
  assert.ok(d.includes('Open every day, 12:00 PM to 10:30 PM'), 'hours');
  for (const dish of ['Lollipop', 'Nashville', 'Cheesy Tower', 'Special Pizza', 'Momo', 'Lotus Biscoff', 'Kunafa', 'Family Combo']) {
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

test('the store photo is a banner the store page (about 2:1) and Home cards (4:3) can both crop', () => {
  const { w, h } = jpegSize(fs.readFileSync(path.join(IMG, menu.store.image)));
  assert.ok(w >= 800 && w / h >= 1.6 && w / h <= 1.85, `${w}x${h}`);
});

test('one real photo per dish and the store photo: valid JPEG, no two alike, no camera metadata, each credited', () => {
  assert.strictEqual(menu.store.image, 'store-logo-banner.jpg');
  const none = menu.items.filter((i) => i.image === null);
  assert.deepStrictEqual(none.map((i) => i.slug), [], 'every dish has its photo');
  const files = [menu.store.image, ...menu.items.map((i) => i.image)];
  assert.ok(menu.items.every((i) => i.image === `${i.slug}.jpg`));
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
  const own = byFile.get(menu.store.image);
  assert.deepStrictEqual([own.author, own.licence, own.match], ['Club 10 Chicken', 'Used with the permission of Club 10 Chicken', 'exact']);
  const LICENCES = /^(Unsplash License|Pexels License|CC0|Public domain|CC BY(-SA)? [234]\.0)/i;
  const pages = new Set();
  for (const f of files.slice(1)) {
    const s = byFile.get(f);
    assert.ok(s, `${f} has a credit`);
    assert.match(s.licence, LICENCES, `${f} licence ${s.licence}`);
    assert.match(s.sourcePage, /^https:\/\/(commons\.wikimedia\.org|www\.pexels\.com|unsplash\.com)\//, `${f} source page`);
    assert.ok(!pages.has(s.sourcePage), `${f}: a source photo used once`);
    pages.add(s.sourcePage);
    assert.ok(['exact', 'closest match'].includes(s.match), `${f} match`);
    assert.ok(s.shows && s.shows.length > 15, `${f} says what it shows`);
    if (/^CC BY/i.test(s.licence)) assert.ok(s.author && s.author.length > 1, `${f}: a CC BY photo names its author`);
  }
});
