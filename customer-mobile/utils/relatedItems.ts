/**
 * "You may also like" / "More from this store" (owner, 5 Nov 2026: "related products are so random, not related to
 * main item"). The list used to be the store's first 10 menu items in menu order. It is now ranked by how related each
 * item is to the dish being viewed, using only real data on the items:
 *   - same category / menu section            +6
 *   - shares a meaningful name word            +4 each (biryani, chicken, paneer, juice, dosa, ...)
 *   - a natural pairing for its kind           +3 (a main gets a drink / dessert / side; a drink gets a snack ...)
 *   - same diet (veg / egg / non-veg)          +1
 * Items with no relation at all are left out; if fewer than `min` related items exist, natural pairings fill the gap,
 * and the section is hidden when nothing fits (better empty than random).
 */
const STOP = new Set(['and', 'with', 'the', 'of', 'in', 'a', 'special', 'sp', 'spl', 'full', 'half', 'plate', 'pack',
  'family', 'combo', 'mourya', 'club', 'fresh', 'homemade', 'classic', 'regular', 'large', 'small', 'medium', 'pcs',
  'pieces', 'piece', 'single', 'double', 'mini', 'jumbo', 'new', 'hot', 'cold', 'masala', 'fry', 'curry', 'style']);

type Kind = 'main' | 'rice' | 'starter' | 'bread' | 'drink' | 'dessert' | 'side' | 'snack' | 'other';

const KIND_WORDS: [Kind, RegExp][] = [
  ['drink', /\b(juice|shake|milkshake|lassi|mojito|soda|coke|cola|pepsi|sprite|water|tea|coffee|chai|smoothie|cooler|mocktail|boba|drink|beverage|buttermilk)\b/],
  ['dessert', /\b(kheer|halwa|jamun|gulab|ice ?cream|brownie|cake|kunafa|dessert|sweet|payasam|rasmalai|pastry|biscoff)\b/],
  ['bread', /\b(naan|roti|kulcha|paratha|parota|chapati|pulka|phulka|bread|puri|poori)\b/],
  ['rice', /\b(biryani|biriyani|pulao|pulav|fried rice|rice|khichdi)\b/],
  ['starter', /\b(65|555|manchurian|chilli|chili|lollipop|tikka|kebab|kabab|majestic|fry|wings|pakora|pakoda|popcorn|strips|nuggets|starter)\b/],
  ['bread', /\b(dosa|idli|vada|uttapam|upma)\b/],
  ['side', /\b(raita|salad|curd|papad|fries|chips|sauce|dip|mayo|cheese|pickle)\b/],
  ['snack', /\b(samosa|puff|sandwich|burger|roll|momo|momos|pizza|pasta|maggi|noodles)\b/],
  ['main', /\b(curry|masala|korma|kurma|butter|paneer|dal|kadai|handi|gravy|thali|meals)\b/],
];

// What naturally goes with what (both directions are listed where it makes sense).
const PAIRS: Record<Kind, Kind[]> = {
  rice: ['main', 'side', 'drink', 'dessert', 'starter'],
  main: ['bread', 'rice', 'side', 'drink'],
  bread: ['main', 'side', 'drink'],
  starter: ['rice', 'drink', 'side'],
  snack: ['drink', 'side', 'dessert'],
  drink: ['snack', 'dessert', 'starter'],
  dessert: ['drink'],
  side: ['rice', 'main', 'snack'],
  other: ['drink', 'dessert'],
};

const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const kindOf = (it: any): Kind => {
  const text = `${norm(it?.name)} ${norm(it?.category)}`;
  for (const [k, re] of KIND_WORDS) if (re.test(text)) return k;
  return 'other';
};
const wordsOf = (it: any) => new Set(norm(it?.name).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)));
const dietOf = (it: any) => String(it?.dietType || (it?.isVegetarian === true ? 'veg' : it?.isVegetarian === false ? 'nonveg' : '')).toLowerCase();
const idOf = (it: any) => String(it?.id || it?._id || '');

export function rankRelated(product: any, items: any[], { max = 10, min = 4 }: { max?: number; min?: number } = {}): any[] {
  const pid = idOf(product);
  const pCat = norm(product?.category);
  const pWords = wordsOf(product);
  const pKind = kindOf(product);
  const pDiet = dietOf(product);
  const pairs = PAIRS[pKind] || [];
  const scored = (items || [])
    .filter((it) => it && idOf(it) && idOf(it) !== pid && it.isAvailable !== false)
    .map((it, i) => {
      let related = 0;
      if (pCat && norm(it.category) === pCat) related += 6;
      const w = wordsOf(it);
      pWords.forEach((x) => { if (w.has(x)) related += 4; });
      const pair = pairs.includes(kindOf(it)) ? 3 : 0;
      // A veg dish never gets non-veg suggestions unless they are the only related ones; same diet first.
      const diet = pDiet && dietOf(it) === pDiet ? 1 : 0;
      return { it, i, related, pair, score: related + pair + diet, vegClash: pDiet === 'veg' && dietOf(it) && dietOf(it) !== 'veg' };
    });
  const byScore = (a: any, b: any) => b.score - a.score || a.i - b.i;
  const strong = scored.filter((x) => x.related > 0 && !x.vegClash).sort(byScore);
  let out = strong.slice(0, max);
  if (out.length < min) {
    const fill = scored.filter((x) => x.related === 0 && x.pair > 0 && !x.vegClash).sort(byScore);
    out = out.concat(fill.slice(0, max - out.length));
  }
  return out.map((x) => x.it);
}
