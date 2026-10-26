/**
 * CampusBites ad window (components/CampusBitesAdWindow): the swipeable 16:9 promo cards at the top of
 * the Home "Local vendor stalls" section. Edit this list to change the cards.
 *
 * The backend has no admin promo slot for this section (Home banners in GET /api/config only feed the
 * Home hero carousel), so the cards live here. They only ever point at real data:
 *  - target 'stall': shown only while a listed stall matches one of `match` (stall name, tags,
 *    description or a dish category / name). Tapping opens the best match (open stalls first).
 *  - target 'list': shown only while at least one stall is listed. Tapping jumps to the stall list,
 *    filtered by `searchFor` when set.
 * The "stall of the day" card is added automatically from the live stall list (no config needed).
 * At most 6 'stall' cards show a day (rotated daily), so the list can hold every category.
 * With no stalls listed, no card matches and the ad window is not shown.
 *
 * Photos: images.unsplash.com only, each checked to return 200 (never upload.wikimedia.org).
 */
export type CampusBitesPromoTarget = 'stall' | 'list';

export interface CampusBitesPromo {
  id: string;
  /** Small accent label above the title, sentence case, e.g. 'At the main gate'. */
  tag: string;
  /** About 20 characters at most; longer titles are cut off on small phones. */
  title: string;
  /** One short line under the title (about 30 characters; longer text is cut off). */
  subtitle: string;
  /** Button text, sentence case, no arrow. */
  cta: string;
  imageUrl: string;
  target: CampusBitesPromoTarget;
  /** target 'stall': lower-case keywords matched against stall name / tags / description / dishes. */
  match?: string[];
  /** target 'list': keyword typed into the stall search when the card is tapped. */
  searchFor?: string;
}

const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&q=70&auto=format&fit=crop`;

export const CAMPUS_BITES_PROMOS: CampusBitesPromo[] = [
  {
    id: 'chai-main-gate',
    tag: 'At the main gate',
    title: 'Hot chai and samosa',
    subtitle: 'Kulhad chai and fresh snacks.',
    cta: 'Order chai',
    imageUrl: photo('1630748662359-40a2105640c7'),
    target: 'stall',
    match: ['chai', 'tea'],
  },
  {
    id: 'morning-tiffin',
    tag: 'Morning tiffin',
    title: 'Idli, vada and dosa',
    subtitle: 'With sambar and chutneys.',
    cta: 'See tiffin',
    imageUrl: photo('1630383249896-424e482df921'),
    target: 'stall',
    match: ['tiffin', 'idli', 'dosa'],
  },
  {
    id: 'biryani-lunch',
    tag: 'Lunch and dinner',
    title: 'Biryani and meals',
    subtitle: 'Dum biryani and leaf meals.',
    cta: 'Order meals',
    imageUrl: photo('1631515243349-e0cb75fb8d3a'),
    target: 'stall',
    match: ['biryani', 'meals'],
  },
  {
    id: 'evening-momos',
    tag: 'Evening cravings',
    title: 'Fresh hot momos',
    subtitle: 'With fiery red chutney.',
    cta: 'Get momos',
    imageUrl: photo('1534422298391-e4f8c172dddb'),
    target: 'stall',
    match: ['momos', 'momo'],
  },
  {
    id: 'fresh-juice',
    tag: 'Beat the heat',
    title: 'Fresh juice, shakes',
    subtitle: 'Squeezed on order.',
    cta: 'Cool down',
    imageUrl: photo('1600271886742-f049cd451bba'),
    target: 'stall',
    match: ['juice', 'shakes', 'lassi'],
  },
  {
    id: 'pizza-night',
    tag: 'Pizza night',
    title: 'Hot 7-inch pizzas',
    subtitle: 'Garlic bread and pasta too.',
    cta: 'Order pizza',
    imageUrl: photo('1565299624946-b28f40a0ae38'),
    target: 'stall',
    match: ['pizza'],
  },
  {
    id: 'wok-chinese',
    tag: 'Off the wok',
    title: 'Noodles, fried rice',
    subtitle: 'Indo-Chinese, made hot.',
    cta: 'Get Chinese',
    imageUrl: photo('1585032226651-759b368d7246'),
    target: 'stall',
    match: ['chinese', 'noodles'],
  },
  {
    id: 'sweet-tooth',
    tag: 'Sweet tooth',
    title: 'Kulfi and sundaes',
    subtitle: 'Scoops, falooda, brownies.',
    cta: 'Treat yourself',
    imageUrl: photo('1551024506-0bccd828d307'),
    target: 'stall',
    match: ['desserts', 'ice-cream', 'kulfi'],
  },
  {
    id: 'fresh-fruit',
    tag: 'Fresh from the cart',
    title: 'Fruit and vegetables',
    subtitle: 'Weighed fresh on the cart.',
    cta: 'Shop fresh',
    imageUrl: photo('1619566636858-adf3ef46400b'),
    target: 'stall',
    match: ['fruits', 'vegetables'],
  },
  {
    id: 'xerox-stationery',
    tag: 'Study supplies',
    title: 'Stationery',
    subtitle: 'Notebooks, pens and study supplies.',
    cta: 'Get it done',
    imageUrl: photo('1456735190827-d1262f71b8a3'),
    target: 'stall',
    match: ['stationery'],
  },
  {
    id: 'how-it-works',
    tag: 'How CampusBites works',
    title: 'Order here, pay cash',
    subtitle: 'The stall delivers. Pay cash.',
    cta: 'See all stalls',
    imageUrl: photo('1606491956689-2ea866880c84'),
    target: 'list',
  },
];
