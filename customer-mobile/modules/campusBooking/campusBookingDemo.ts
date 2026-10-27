/**
 * In-Campus Booking sample layer (owner, 27 Oct 2026: "mock some stalls in In-Campus Booking"), same pattern as
 * foodV2Demo / rentalsV2Demo / eventsV2Demo / dealsV2Demo / pgV2Demo.
 *
 * One switch: CAMPUS_BOOKING_DEMO_CONTENT. While it is on and fewer than ENOUGH_REAL_STALLS real stalls take
 * bookings, the stall list shows these sample stalls AFTER the real ones, so the section does not look empty
 * before stalls switch on. As soon as ENOUGH_REAL_STALLS real stalls are live the samples stop showing by
 * themselves; a sample whose name matches a real stall is never shown.
 *
 * Every sample stall and menu item carries `isDemoContent: true`:
 *  - the list card and the stall page show a "Sample" tag (and the page a "Sample" banner);
 *  - where the Add button would be there is a "Sample" tag; a tap opens the polite sample sheet (CbSampleSheet);
 *  - a sample stall page is built from this file only: it never calls a campus-booking endpoint, never listens
 *    for live updates, never adds to the pickup cart (cbCart), never reaches pay / UPI and has no UPI ID or QR;
 *  - the header counts ("N stalls · N open now") use the real stalls only. No ratings, offers or FSSAI numbers.
 * Prices are typical campus-counter prices around Mangalagiri / Amaravati (Oct 2026), shown only as a guide.
 * Photos: campusBookingSampleArt.ts (Unsplash License, credits listed there).
 */
import type { ImageSourcePropType } from 'react-native';
import type { CbCategoryKey, CbMenuItem, CbStall } from './cbApi';
import { CB_SAMPLE_ART, type CbSampleArtKey } from './campusBookingSampleArt';

export const CAMPUS_BOOKING_DEMO_CONTENT = true;

/** With this many real stalls taking bookings, no samples are shown. */
export const ENOUGH_REAL_STALLS = 4;

/** Sample ids start with this, so a sample id can never reach the server (real ids are numbers). */
export const SAMPLE_ID_PREFIX = 'sample-cb-';

export type CbSampleStall = CbStall & { isDemoContent: true; art: ImageSourcePropType };
export type CbSampleMenuItem = CbMenuItem & { isDemoContent: true; art: ImageSourcePropType };

type ItemSeed = { key: CbSampleArtKey; name: string; price: number; category: string; veg?: boolean; diet?: 'veg' | 'egg' | 'nonveg'; description?: string };
type StallSeed = {
  slug: string; art: CbSampleArtKey; name: string; category: CbCategoryKey; menuLine: string; location: string;
  description: string; prepMinutes: number; hours: string; opensAt: string; closesAt: string; tags: string[]; items: ItemSeed[];
};

const LABEL: Record<CbCategoryKey, string> = { food: 'Food & Beverages', snacks: 'Snacks & Bakery', stationery: 'Stationery', more: 'More' };

const SEEDS: StallSeed[] = [
  {
    slug: 'chai-counter', art: 'stallChaiCounter', name: 'Sai Tea and Snacks', category: 'food', menuLine: 'Tea, coffee, snacks',
    location: 'Near the central library', description: 'Fresh tea and hot snacks between classes.', prepMinutes: 5,
    hours: '7:00 AM – 9:00 PM', opensAt: '07:00', closesAt: '21:00', tags: ['tea', 'coffee', 'snacks'],
    items: [
      { key: 'masalaChai', name: 'Masala chai', price: 15, category: 'Tea & coffee', description: 'Ginger and cardamom tea in a clay cup.' },
      { key: 'filterCoffee', name: 'Filter coffee', price: 20, category: 'Tea & coffee', description: 'South Indian filter coffee, served in a davara.' },
      { key: 'samosa', name: 'Samosa (2 pcs)', price: 30, category: 'Snacks', description: 'Potato and peas filling, with green chutney.' },
      { key: 'onionPakoda', name: 'Onion pakoda', price: 30, category: 'Snacks', description: 'Crisp onion fritters, one plate.' },
    ],
  },
  {
    slug: 'juice-bar', art: 'stallJuiceBar', name: 'Fresh Juice Bar', category: 'food', menuLine: 'Fresh juices, shakes',
    location: 'Food court, ground floor', description: 'Juices pressed to order from the day’s fruit.', prepMinutes: 8,
    hours: '9:00 AM – 8:00 PM', opensAt: '09:00', closesAt: '20:00', tags: ['juices', 'shakes'],
    items: [
      { key: 'watermelonJuice', name: 'Watermelon juice', price: 40, category: 'Juices', description: '300 ml, no added sugar.' },
      { key: 'mosambiJuice', name: 'Mosambi juice', price: 45, category: 'Juices', description: 'Sweet lime, 300 ml.' },
      { key: 'pineappleJuice', name: 'Pineapple juice', price: 50, category: 'Juices', description: '300 ml.' },
      { key: 'bananaMilkshake', name: 'Banana milkshake', price: 50, category: 'Shakes', description: 'Banana and chilled milk, 300 ml.' },
      { key: 'lemonSoda', name: 'Lemon soda', price: 25, category: 'Coolers', description: 'Sweet or salted.' },
    ],
  },
  {
    slug: 'dosa-counter', art: 'stallDosaCounter', name: 'Lakshmi Dosa Stall', category: 'food', menuLine: 'Dosa, idli, vada',
    location: 'Hostel road', description: 'Breakfast and evening tiffins with sambar and chutney.', prepMinutes: 12,
    hours: '7:00 AM – 9:30 PM', opensAt: '07:00', closesAt: '21:30', tags: ['tiffins', 'dosa'],
    items: [
      { key: 'plainDosa', name: 'Plain dosa', price: 40, category: 'Dosa', description: 'With sambar and two chutneys.' },
      { key: 'masalaDosa', name: 'Masala dosa', price: 50, category: 'Dosa', description: 'Potato masala, sambar and chutneys.' },
      { key: 'gheeRoastDosa', name: 'Ghee roast dosa', price: 60, category: 'Dosa', description: 'Thin, crisp and roasted in ghee.' },
      { key: 'idli', name: 'Idli (3 pcs)', price: 30, category: 'Tiffins', description: 'With sambar and coconut chutney.' },
      { key: 'meduVada', name: 'Medu vada (2 pcs)', price: 35, category: 'Tiffins', description: 'With sambar and coconut chutney.' },
    ],
  },
  {
    slug: 'bakery-corner', art: 'stallBakeryCorner', name: 'Campus Bakery', category: 'snacks', menuLine: 'Puffs, cakes, biscuits',
    location: 'Academic block, ground floor', description: 'Baked fresh every morning.', prepMinutes: 5,
    hours: '8:00 AM – 8:00 PM', opensAt: '08:00', closesAt: '20:00', tags: ['bakery', 'puffs'],
    items: [
      { key: 'vegPuff', name: 'Veg puff', price: 20, category: 'Puffs', description: 'Spiced vegetable filling.' },
      { key: 'chocolateMuffin', name: 'Chocolate muffin', price: 40, category: 'Cakes', description: 'One muffin.' },
      { key: 'plumCake', name: 'Plum cake slice', price: 30, category: 'Cakes', description: 'With raisins and tutti frutti.' },
      { key: 'creamPuff', name: 'Cream puffs (2 pcs)', price: 40, category: 'Cakes', description: 'Filled with fresh cream.' },
      { key: 'osmaniaBiscuits', name: 'Osmania biscuits (200 g)', price: 60, category: 'Biscuits', description: 'The tea-time classic.' },
    ],
  },
  {
    slug: 'stationery-xerox', art: 'stallStationeryXerox', name: 'Venkat Stationery', category: 'stationery',
    menuLine: 'Notebooks, pens and exam stationery', location: 'Library block, ground floor', description: 'Notebooks, paper, pens and exam stationery.',
    prepMinutes: 10, hours: '8:30 AM – 8:30 PM', opensAt: '08:30', closesAt: '20:30', tags: ['stationery'],
    items: [
      { key: 'xeroxPaper', name: 'A4 paper (100 sheets)', price: 60, category: 'Paper & notebooks', description: '75 gsm, plain white.' },
      { key: 'spiralBinding', name: 'Spiral notebook (A5, 160 pages)', price: 70, category: 'Paper & notebooks', description: 'Ruled, with a hard cover.' },
      { key: 'longNotebook', name: 'Long notebook (200 pages)', price: 60, category: 'Stationery', description: 'Soft cover, A4 size.' },
      { key: 'highlighters', name: 'Highlighters (set of 4)', price: 80, category: 'Stationery', description: 'Pastel colours.' },
    ],
  },
  {
    slug: 'fruit-bowl', art: 'stallFruitBowl', name: 'Daily Fruit Bowl', category: 'more', menuLine: 'Fruit bowls, cut fruit',
    location: 'Near the sports complex', description: 'Cut fresh in front of you.', prepMinutes: 6,
    hours: '7:30 AM – 7:30 PM', opensAt: '07:30', closesAt: '19:30', tags: ['fruits'],
    items: [
      { key: 'mixedFruitBowl', name: 'Mixed fruit bowl', price: 60, category: 'Fruit bowls', description: 'Seasonal fruit, about 300 g.' },
      { key: 'papayaBowl', name: 'Papaya bowl', price: 40, category: 'Fruit bowls', description: 'About 250 g.' },
      { key: 'fruitChaat', name: 'Fruit chaat', price: 50, category: 'Chaat', description: 'With chaat masala and lemon.' },
      { key: 'sproutsSalad', name: 'Sprouts salad', price: 40, category: 'Chaat', description: 'Moong sprouts, onion, tomato and lemon.' },
      { key: 'pomegranateCup', name: 'Pomegranate cup', price: 60, category: 'Fruit bowls', description: 'About 150 g.' },
    ],
  },
  {
    slug: 'sandwich-grill', art: 'stallSandwichGrill', name: 'Grill Sandwiches', category: 'food', menuLine: 'Sandwiches, fries',
    location: 'Food court, ground floor', description: 'Grilled to order.', prepMinutes: 10,
    hours: '11:00 AM – 10:00 PM', opensAt: '11:00', closesAt: '22:00', tags: ['sandwiches'],
    items: [
      { key: 'vegSandwich', name: 'Veg sandwich', price: 40, category: 'Sandwiches', description: 'Cucumber, tomato and mint chutney.' },
      { key: 'grilledCheeseSandwich', name: 'Grilled cheese sandwich', price: 60, category: 'Sandwiches', description: 'Grilled with butter.' },
      { key: 'cornCheeseSandwich', name: 'Corn and cheese sandwich', price: 70, category: 'Sandwiches', description: 'Sweet corn and cheese, grilled.' },
      { key: 'chickenSandwich', name: 'Chicken sandwich', price: 90, category: 'Sandwiches', diet: 'nonveg', description: 'Grilled chicken, lettuce and mayo.' },
      { key: 'frenchFries', name: 'French fries', price: 60, category: 'Sides', description: 'Salted or peri peri.' },
    ],
  },
  {
    slug: 'ice-cream', art: 'stallIceCream', name: 'Cool Corner', category: 'snacks', menuLine: 'Ice cream, falooda',
    location: 'Hostel road', description: 'Scoops, cones and falooda.', prepMinutes: 3,
    hours: '12:00 PM – 10:30 PM', opensAt: '12:00', closesAt: '22:30', tags: ['ice-cream'],
    items: [
      { key: 'vanillaScoop', name: 'Vanilla scoop cup', price: 30, category: 'Scoops', description: 'One scoop.' },
      { key: 'mangoScoop', name: 'Mango scoop cup', price: 40, category: 'Scoops', description: 'One scoop.' },
      { key: 'chocolateCone', name: 'Chocolate cone', price: 40, category: 'Cones', description: 'One scoop in a waffle cone.' },
      { key: 'strawberryCone', name: 'Strawberry cone', price: 40, category: 'Cones', description: 'One scoop in a waffle cone.' },
      { key: 'falooda', name: 'Royal falooda', price: 80, category: 'Falooda', description: 'Rose syrup, sabja, vermicelli and ice cream.' },
    ],
  },
];

const toItem = (stall: string, i: ItemSeed): CbSampleMenuItem => {
  const diet = i.diet || 'veg';
  return {
    id: `${SAMPLE_ID_PREFIX}${stall}-${i.key}`, name: i.name, price: i.price, originalPrice: null, description: i.description || null,
    imageUrl: null, category: i.category, isVeg: diet === 'veg', dietType: diet, isAvailable: true,
    isDemoContent: true, art: CB_SAMPLE_ART[i.key],
  };
};

const MENUS = new Map<string, CbSampleMenuItem[]>();
const STALLS: CbSampleStall[] = SEEDS.map((s) => {
  const id = `${SAMPLE_ID_PREFIX}${s.slug}`;
  const menu = s.items.map((i) => toItem(s.slug, i));
  MENUS.set(id, menu);
  return {
    id, name: s.name, location: s.location, campus: null, imageUrl: null, logoUrl: null, description: s.description,
    category: s.category, categoryLabel: LABEL[s.category], tags: s.tags, isOpen: true, opensAt: s.opensAt, closesAt: s.closesAt,
    closedReason: null, hoursToday: s.hours, prepMinutes: s.prepMinutes, rating: null, ratingCount: 0, itemCount: menu.length,
    legalName: null, fssaiLicenseNumber: null, menuCategories: s.menuLine,
    preview: menu.slice(0, 3).map((m) => ({ id: m.id, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category })),
    isDemoContent: true, art: CB_SAMPLE_ART[s.art],
  };
});

const squash = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const isSampleId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(SAMPLE_ID_PREFIX);
export const isSampleStall = (v: CbStall | null | undefined): v is CbSampleStall => !!v && (v as any).isDemoContent === true;

/** The sample stalls to list after `real`: none when the switch is off or enough real stalls are live, none sharing a real stall's name. */
export function sampleStallsFor(real: CbStall[]): CbSampleStall[] {
  if (!CAMPUS_BOOKING_DEMO_CONTENT || real.length >= ENOUGH_REAL_STALLS) return [];
  const names = new Set(real.map((v) => squash(v.name)));
  return STALLS.filter((v) => !names.has(squash(v.name)));
}

/** A sample stall and its menu by id (null when the switch is off or the id is not a sample). */
export function sampleStallById(id: string): { stall: CbSampleStall; menu: CbSampleMenuItem[] } | null {
  if (!CAMPUS_BOOKING_DEMO_CONTENT || !isSampleId(id)) return null;
  const stall = STALLS.find((v) => v.id === id);
  return stall ? { stall, menu: MENUS.get(id) || [] } : null;
}

/** The photo of a sample menu item, by id (stall list preview rows carry ids only). */
export const sampleItemArt = (stallId: string, itemId: string): ImageSourcePropType | null =>
  (MENUS.get(stallId) || []).find((m) => m.id === itemId)?.art || null;
