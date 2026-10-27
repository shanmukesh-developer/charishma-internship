/**
 * Food & groceries v2 sample layer (owner, 27 Oct 2026: "mock some items for every category"), same pattern as
 * rentalsV2Demo / eventsV2Demo / dealsV2Demo / pgV2Demo.
 *
 * One switch: FOOD_V2_DEMO_CONTENT. While it is on, a shelf with fewer than THIN_SHELF real products is topped up
 * with the samples written for it, AFTER the real products, so thin aisles (Seeds, Organic, Wellness picks,
 * Fitness, the toy tiles) do not look empty. As soon as the store lists THIN_SHELF real products on a shelf, its
 * samples stop showing by themselves; a sample whose name matches a real product is never shown.
 *
 * Every sample carries `isDemoContent: true`:
 *  - its row shows a "Sample" tag where the add button would be, and has no save heart;
 *  - a tap opens the polite sample sheet (FoodV2SampleSheet), never the product page;
 *  - useFoodV2 refuses to add, save or open it, so it never reaches the basket, the saved list or the server;
 *  - search, the category counts, "From ₹" lines, deals and the home tiles use the real catalogue only.
 * Prices are typical campus-store prices around Mangalagiri / Amaravati (Oct 2026), shown only as a guide.
 * No discounts, ratings or offers on samples.
 * Photos: foodV2SampleArt.ts (Unsplash License, credits listed there).
 */
import { SEARCH, shelfItems, squash, type Item } from './FoodV2Data';
import { SAMPLE_ART, type SampleArtKey } from './foodV2SampleArt';

export const FOOD_V2_DEMO_CONTENT = true;

/** A shelf with fewer real products than this gets its samples. */
export const THIN_SHELF = 6;

type Seed = { key: SampleArtKey; name: string; weight: string; price: number; category: string; vendorType: 'GROCERY' | 'SEEDS' | 'TOYS' };

const SEEDS: Seed[] = [
  // Seeds (Seeds & Gardening store)
  { key: 'coriander', name: 'Coriander (dhaniya) seeds', weight: '50 g', price: 35, category: 'Seeds', vendorType: 'SEEDS' },
  { key: 'spinach', name: 'Palak (spinach) seeds', weight: '20 g', price: 39, category: 'Seeds', vendorType: 'SEEDS' },
  { key: 'basil', name: 'Tulsi (holy basil) seeds', weight: '5 g', price: 45, category: 'Seeds', vendorType: 'SEEDS' },
  { key: 'marigold', name: 'Marigold flower seeds', weight: '10 g', price: 39, category: 'Seeds', vendorType: 'SEEDS' },
  { key: 'microgreens', name: 'Microgreens starter kit', weight: 'Tray, cocopeat and 4 seed mixes', price: 249, category: 'Seeds', vendorType: 'SEEDS' },
  // Organic
  { key: 'jaggery', name: 'Organic jaggery', weight: '500 g', price: 110, category: 'Organic', vendorType: 'GROCERY' },
  { key: 'toorDal', name: 'Organic toor dal', weight: '1 kg', price: 189, category: 'Organic', vendorType: 'GROCERY' },
  { key: 'honey', name: 'Organic raw honey', weight: '250 g', price: 199, category: 'Organic', vendorType: 'GROCERY' },
  { key: 'millet', name: 'Organic foxtail millet', weight: '500 g', price: 89, category: 'Organic', vendorType: 'GROCERY' },
  // Wellness picks
  { key: 'greenTea', name: 'Tulsi green tea', weight: '25 tea bags', price: 149, category: 'Monsoon Wellness Picks', vendorType: 'GROCERY' },
  { key: 'turmericMilk', name: 'Haldi doodh (turmeric milk) mix', weight: '100 g', price: 129, category: 'Monsoon Wellness Picks', vendorType: 'GROCERY' },
  { key: 'kadha', name: 'Herbal kadha mix', weight: '100 g', price: 119, category: 'Monsoon Wellness Picks', vendorType: 'GROCERY' },
  { key: 'gingerTea', name: 'Ginger lemon tea', weight: '20 tea bags', price: 129, category: 'Monsoon Wellness Picks', vendorType: 'GROCERY' },
  // Fitness (Toy Mania, "Fitness ready")
  { key: 'dumbbells', name: 'Rubber hex dumbbells, 5 kg pair', weight: '2 x 5 kg', price: 1499, category: 'Fitness ready', vendorType: 'TOYS' },
  { key: 'shaker', name: 'Protein shaker bottle', weight: '600 ml', price: 249, category: 'Fitness ready', vendorType: 'TOYS' },
  { key: 'gymGloves', name: 'Padded gym gloves', weight: 'Free size', price: 299, category: 'Fitness ready', vendorType: 'TOYS' },
  { key: 'foamRoller', name: 'Foam roller', weight: '33 cm', price: 449, category: 'Fitness ready', vendorType: 'TOYS' },
  // Toy tiles
  { key: 'toyCars', name: 'Pull-back toy cars', weight: 'Pack of 2', price: 249, category: 'Vehicle toys', vendorType: 'TOYS' },
  { key: 'toyBus', name: 'Toy school bus', weight: '1 piece', price: 199, category: 'Vehicle toys', vendorType: 'TOYS' },
  { key: 'alphabetBlocks', name: 'Wooden alphabet blocks', weight: '26 blocks', price: 299, category: 'Learning & education', vendorType: 'TOYS' },
  { key: 'scienceKit', name: 'Junior science kit', weight: '20 experiments', price: 399, category: 'Learning & education', vendorType: 'TOYS' },
  { key: 'volleyball', name: 'Volleyball', weight: 'Size 5', price: 399, category: 'Sports & games', vendorType: 'TOYS' },
  { key: 'tableTennis', name: 'Table tennis bat pair', weight: 'With 3 balls', price: 349, category: 'Sports & games', vendorType: 'TOYS' },
  { key: 'frisbee', name: 'Flying disc', weight: '27 cm', price: 149, category: 'Sports & games', vendorType: 'TOYS' },
  { key: 'ludo', name: 'Ludo and snakes board', weight: '2-in-1 board', price: 149, category: 'Games & plushies', vendorType: 'TOYS' },
  { key: 'carrom', name: 'Carrom board with coins', weight: '26 inch', price: 1299, category: 'Games & plushies', vendorType: 'TOYS' },
];

const SAMPLES: Item[] = SEEDS.map(s => ({
  id: `sample-food-${s.key}`, name: s.name, price: s.price, originalPrice: null, discountPercent: null,
  weight: s.weight, brand: null, category: s.category, image: null, isVegetarian: true,
  // isAvailable keeps the normal row look; orderable false is a second guard (useFoodV2 never adds a sample).
  isAvailable: true, orderable: false, bookingOnly: false,
  restaurantId: 'sample', storeName: null, vendorType: s.vendorType,
  isDemoContent: true, art: SAMPLE_ART[s.key],
}));

export const isSampleItem = (p: Item | null | undefined): boolean => !!p && p.isDemoContent === true;

/**
 * The samples to show after `real` on a shelf: none in search, none when the switch is off or the shelf has
 * THIN_SHELF real products, and none that share a name with a real product. Same shelf rules as the catalogue.
 */
export function samplesFor(shelf: string, real: Item[]): Item[] {
  if (!FOOD_V2_DEMO_CONTENT || shelf === SEARCH || real.length >= THIN_SHELF) return [];
  const names = new Set(real.map(p => squash(p.name)));
  return shelfItems(shelf, SAMPLES).filter(p => !names.has(squash(p.name)));
}
