/**
 * Food & groceries v2: cut-out art (transparent WebP, about 2x display size).
 * Made locally from Unsplash photos (Unsplash licence: free commercial use, modification allowed,
 * no attribution needed) with the open-source rembg background remover; see scratchpad/cutouts*.py.
 * No branded products. Placeholders until the owner supplies commissioned art.
 *   hero       photo-1690934167884-08c184b6c606  wicker basket of fruit and vegetables (owner-approved hero)
 *   groceries  photo-1652262968340-b735524f9ae4  paper bags with bread, tomatoes, bananas
 *   fresh      photo-1597362925123-77861d3fbac7  pile of vegetables (tile)
 *   oranges    photo-1712330436003-8ccff835a9b7  bowl of oranges (Fruits & vegetables banner)
 *   snacks     photo-1691480213129-106b2c7d1ee8 + photo-1598830853058-3474f6a66003  popcorn and a juice
 *   bakery     photo-1609889132680-4e2ea2befbef  bread rolls in a basket (tile)
 *   croissants photo-1709798288301-719572ca8e98  two croissants (Bakery banner)
 *   health     photo-1771519902689-0a5c7be8efe6  three pump bottles (stray flower removed)
 *   peaches    photo-1661130909677-eebb537ca91d  basket of peaches
 *   cookies    photo-1592065201038-52c9da2a6194  stack of cookies
 *   chocolate  photo-1720029106261-0d0396bb270d  chocolate pieces with almonds (unbranded)
 *   towels     photo-1639298108944-76a403a7c38d  two folded towels
 *   pickles    photo-1601702538934-efffab67ab65  mango pickle in a ceramic pot, lid and a raw mango (tile, 24 Oct)
 *   pickleJar  photo-1617854307432-13950e24ba07  glass jar of mixed pickle under a cloth lid (Pickles banner)
 *   gifts      photo-1602734846297-9299fc2d4703 + photo-1640253621150-d75179c58838  brown teddy in front of a red
 *              gift box tied with twine (tile, 24 Oct; the box's stray tag and a mask drip removed by hand)
 *   giftPair   photo-1633683788767-ac390c4bf988 + photo-1669994814741-fa5a07c97c67  green parcel tied with twine
 *              in front of a navy box with a silver bow (Gifts & toys banner)
 */
export const CUT = {
  hero: require('./assets/food-v2-hero-veg-basket-cutout-2026-10-23.webp'),
  groceries: require('./assets/food-v2-tile-groceries-paper-bags-clean-cutout-2026-10-23.webp'),
  fresh: require('./assets/food-v2-tile-fruits-veg-pile-cutout-2026-10-23.webp'),
  oranges: require('./assets/food-v2-banner-fresh-oranges-bowl-cutout-2026-10-23.webp'),
  snacks: require('./assets/food-v2-banner-snacks-popcorn-juice-cutout-2026-10-23.webp'),
  bakery: require('./assets/food-v2-tile-bakery-bread-basket-cutout-2026-10-23.webp'),
  croissants: require('./assets/food-v2-banner-bakery-croissants-cutout-2026-10-23.webp'),
  health: require('./assets/food-v2-tile-health-care-bottles-clean-cutout-2026-10-23.webp'),
  peaches: require('./assets/food-v2-banner-fresh-peach-basket-cutout-2026-10-23.webp'),
  cookies: require('./assets/food-v2-banner-snacks-cookie-stack-cutout-2026-10-23.webp'),
  chocolate: require('./assets/food-v2-banner-snacks-chocolate-pile-cutout-2026-10-23.webp'),
  towels: require('./assets/food-v2-banner-health-towels-cutout-2026-10-23.webp'),
  pickles: require('./assets/food-v2-tile-pickles-mango-pot-cutout-2026-10-24.webp'),
  pickleJar: require('./assets/food-v2-banner-pickles-mixed-jar-cutout-2026-10-24.webp'),
  gifts: require('./assets/food-v2-tile-gifts-toys-box-teddy-cutout-2026-10-24.webp'),
  giftPair: require('./assets/food-v2-banner-gifts-toys-wrapped-pair-cutout-2026-10-24.webp'),
};

/** Category tile -> cut-out and its soft plate tint (light, dark). */
export const TILE_ART: Record<string, { art: any; tint: [string, string] }> = {
  Grocery: { art: CUT.groceries, tint: ['#E6F6EC', 'rgba(95,208,138,0.12)'] },
  Fresh: { art: CUT.fresh, tint: ['#FDEDE3', 'rgba(251,146,60,0.12)'] },
  'Snacks & beverages': { art: CUT.snacks, tint: ['#FFF6D9', 'rgba(250,204,21,0.11)'] },
  'Bakery & breakfast': { art: CUT.bakery, tint: ['#E6F1FB', 'rgba(96,165,250,0.12)'] },
  'Health & care': { art: CUT.health, tint: ['#F0EAFB', 'rgba(167,139,250,0.13)'] },
  Pickles: { art: CUT.pickles, tint: ['#DFF4EE', 'rgba(45,212,191,0.12)'] },
  'Gifts & toys': { art: CUT.gifts, tint: ['#FCE8EE', 'rgba(244,114,182,0.12)'] },
};

/** Listing banner -> cut-out, drawn in the hero style (large, overflowing right / bottom, glow behind).
 *  The wicker basket stays the home hero only. */
export const BANNER_ART: Record<string, any> = {
  Grocery: CUT.fresh,
  'All Groceries': CUT.groceries,
  Fresh: CUT.oranges,
  'Snacks & beverages': CUT.snacks,
  'Bakery & breakfast': CUT.croissants,
  'Health & care': CUT.health,
  Pickles: CUT.pickles,
  'Gifts & toys': CUT.gifts,
};

/** Listing banner slides (2–4 cut-outs, cross-fading every 3.5 s; no brand logos). */
export const BANNER_SLIDES: Record<string, any[]> = {
  Grocery: [CUT.fresh, CUT.groceries],
  'All Groceries': [CUT.groceries, CUT.fresh],
  Fresh: [CUT.oranges, CUT.fresh, CUT.peaches],
  'Snacks & beverages': [CUT.snacks, CUT.cookies, CUT.chocolate],
  'Bakery & breakfast': [CUT.croissants, CUT.bakery],
  'Health & care': [CUT.health, CUT.towels],
  Pickles: [CUT.pickles, CUT.pickleJar],
  'Gifts & toys': [CUT.gifts, CUT.giftPair],
};
