/**
 * Food & groceries v2: curated listing chips. Raw store categories (and brand names
 * used as categories, like "Cadbury" or "Coca Cola") map into a short, clean set per shelf.
 * A product belongs to the first chip it matches (category first, then name), chips without
 * products are hidden, and labels stay short so they never truncate.
 * FILTER_CHIPS shelves (Pickles, Gifts & toys) use overlapping filters instead: a product can sit under several
 * (Veg and Mango), and a chip that would show nothing, or exactly what All shows, is hidden.
 * Others → Food & groceries (modules/foodV2).
 */
import type { Item } from './FoodV2Data';

type ChipDef = { label: string; cat: RegExp; name?: RegExp };
type FilterChip = { label: string; test: (p: Item) => boolean };

/** Overlapping filter chips (diet + kind), in the order shown. */
export const FILTER_CHIPS: Record<string, FilterChip[]> = {
  Pickles: [
    { label: 'Veg', test: p => p.isVegetarian },
    { label: 'Non-veg', test: p => !p.isVegetarian },
    { label: 'Mango', test: p => /mango|ava?kaa?ya|avakai|maavidi/i.test(p.name) },
    { label: 'Gongura', test: p => /gongura/i.test(p.name) },
    { label: 'Lemon', test: p => /lemon|\blime\b|nimbu|nimmakaya/i.test(p.name) },
    { label: 'Mixed', test: p => /\bmixed\b|mix veg/i.test(p.name) },
  ],
  // A chocolate gift box is under both Gift boxes and Chocolates.
  'Gifts & toys': [
    { label: 'Soft toys', test: p => /teddy|plush|soft toy|stuffed/i.test(p.name) },
    { label: 'Games & puzzles', test: p => /\bgames?\b|chess|\buno\b|puzzle|jigsaw|\bcube\b|ludo|carrom|abacus/i.test(p.name) },
    { label: 'Gift boxes', test: p => /gift box|hamper|gift set/i.test(p.name) },
    { label: 'Cards & wrap', test: p => /greeting card|gift wrap|wrapping|ribbon|gift bag|gift tag/i.test(p.name) },
    { label: 'Chocolates', test: p => /chocolate|truffle/i.test(p.name) },
  ],
};

export const CHIP_MAP: Record<string, ChipDef[]> = {
  'Snacks & beverages': [
    { label: 'Chips', cat: /chip|namkeen|lays|snack/i, name: /chip|crisp|bhujia|kurkure|nacho|mixture|namkeen/i },
    { label: 'Biscuits', cat: /biscuit|cookie/i, name: /biscuit|cookie|oreo|cracker/i },
    { label: 'Chocolates', cat: /chocolate|cadbury|sweet/i, name: /chocolate|dairy milk|kitkat|silk/i },
    { label: 'Drinks', cat: /drink|juice|cup|cola|tea|coffee|nescafe|beverage/i, name: /drink|juice|cola|soda|sprite|coffee|tea|red bull|water|beverage/i },
    { label: 'Instant food', cat: /instant|frozen|noodle/i, name: /noodle|maggi|soup|frozen|ready to/i },
  ],
  Fresh: [
    { label: 'Fruits', cat: /fruit/i, name: /apple|banana|orange|mango|grape|pomegranate|papaya|guava|lemon|melon|kiwi/i },
    { label: 'Vegetables', cat: /vegetable/i, name: /tomato|onion|potato|carrot|garlic|ginger|chilli|capsicum|peas|beans|cucumber|cabbage|brinjal/i },
    { label: 'Leafy greens', cat: /leafy|greens/i, name: /spinach|palak|coriander|methi|mint|lettuce/i },
  ],
  Grocery: [
    { label: 'Rice & grains', cat: /rice|grain/i, name: /rice|poha|oats|rava|suji|millet/i },
    { label: 'Atta & flour', cat: /atta|flour/i, name: /atta|flour|maida|besan|ragi/i },
    { label: 'Dals', cat: /dal|pulse/i, name: /\bdals?\b|lentil|chana|rajma|moong|toor|urad/i },
    { label: 'Oils & ghee', cat: /oil|ghee/i, name: /\boil\b|ghee/i },
    { label: 'Masalas', cat: /masala|spice|salt|sugar|jaggery/i, name: /masala|turmeric|chilli powder|salt|sugar|jaggery/i },
    { label: 'Dairy', cat: /dairy|milk/i, name: /milk|curd|paneer|butter|cheese|egg/i },
    { label: 'Dry fruits', cat: /dry fruit|nut/i, name: /almond|cashew|raisin|walnut|pista/i },
  ],
  'Health & care': [
    { label: 'Bath & body', cat: /bath|body/i, name: /soap|shower|handwash|body wash|deo/i },
    { label: 'Skincare', cat: /skin|beauty/i, name: /face|cream|lotion|sunscreen|serum/i },
    { label: 'Hair care', cat: /hair/i, name: /shampoo|conditioner|hair/i },
    { label: 'Wellness', cat: /health|wellness/i, name: /honey|vitamin|immun|tulsi|chyawan|ginger|lemon/i },
  ],
  'Bakery & breakfast': [
    { label: 'Bread', cat: /bakery|bread/i, name: /bread|bun|pav|loaf/i },
    { label: 'Biscuits & cakes', cat: /biscuit|cake/i, name: /biscuit|cake|cookie|rusk|muffin/i },
    { label: 'Breakfast', cat: /breakfast/i, name: /cornflakes|muesli|oats|jam|peanut butter|spread/i },
  ],
  Toys: [
    { label: 'Vehicles', cat: /vehicle/i, name: /car|truck|bike|vehicle/i },
    { label: 'Learning', cat: /learning|education/i, name: /puzzle|blocks|learning/i },
    { label: 'Sports', cat: /sport|fitness/i, name: /ball|bat|racket|skipping/i },
    { label: 'Plushies', cat: /plush|games/i, name: /teddy|plush|soft toy/i },
    { label: 'Baby', cat: /baby|toddler/i, name: /baby|toddler|rattle/i },
  ],
};

/** The curated chip for a product on a shelf ('' when none fits or the shelf has no curated chips). */
export function chipOf(shelf: string, p: Item): string {
  const defs = CHIP_MAP[shelf];
  if (!defs) return '';
  const cat = p.category || '';
  const byCat = defs.find(d => d.cat.test(cat));
  if (byCat) return byCat.label;
  const byName = defs.find(d => d.name && d.name.test(p.name));
  return byName ? byName.label : '';
}

/** Is the product under this chip on this shelf ('All' holds everything). */
export function inChip(shelf: string, p: Item, label: string): boolean {
  if (label === 'All') return true;
  const filters = FILTER_CHIPS[shelf];
  if (filters) {
    const f = filters.find(d => d.label === label);
    return !!f && f.test(p);
  }
  return chipOf(shelf, p) === label;
}

/** Curated chips that have products, in the curated order. */
export function chipsFor(shelf: string, items: Item[]): string[] {
  const filters = FILTER_CHIPS[shelf];
  if (filters) {
    return filters.filter(f => {
      const n = items.filter(f.test).length;
      return n > 0 && n < items.length;
    }).map(f => f.label);
  }
  const defs = CHIP_MAP[shelf];
  if (!defs) return [];
  const used = new Set(items.map(p => chipOf(shelf, p)).filter(Boolean));
  return defs.map(d => d.label).filter(l => used.has(l));
}
