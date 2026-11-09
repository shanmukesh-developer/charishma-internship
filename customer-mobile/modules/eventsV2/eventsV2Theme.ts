/**
 * Campus Events v2 tokens (owner reference, 25 Oct 2026; one look for the home AND the inner screens).
 * Owner, 10 Nov 2026 ("Match rest of app"): the section wears the app's diet look instead of its old night page -
 * a light diet page with white cards, dark ink and the one diet accent in light mode (red for Non-veg, green for
 * Veg), the diet's dark surfaces in dark mode. NIGHT keeps its old key names (so no screen changed shape) and
 * answers from utils/themeNow dietTokens, i.e. for the light/dark theme and Veg/Non-veg choice in use right now.
 * Weights stay light (titles 600, labels 500, body 400); bold only for the headline and event titles. No italics,
 * script lines or ALL CAPS (owner, 26 Oct: official, not decorative).
 */
import { Platform, type ViewStyle } from 'react-native';
import type { Category } from '../campusEvents/campusEventsApi';
import { dietTokens, isDarkNow, mixHex } from '../../utils/themeNow';

/** '#RRGGBB' + alpha -> rgba(). */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

export const NIGHT = dietTokens((d, dark) => ({
  /** Page and the strip behind the status bar. */
  page: dark ? d.page : d.pageDeep,
  pageTop: dark ? d.page : d.pageDeep,
  /** Cards (solid: Android draws elevation under see-through cards as a grey square). */
  card: d.card,
  card2: dark ? mixHex(d.card, '#FFFFFF', 0.05) : d.sel,
  /** Controls that used to be see-through glass on the night page: solid now. */
  glass: dark ? mixHex(d.card, '#FFFFFF', 0.04) : '#FFFFFF',
  glass2: dark ? mixHex(d.card, '#FFFFFF', 0.08) : mixHex(d.soft, '#FFFFFF', 0.3),
  line: dark ? 'rgba(255,255,255,0.10)' : d.line,
  lineSoft: dark ? 'rgba(255,255,255,0.06)' : mixHex(d.line, '#FFFFFF', 0.5),
  /** Control borders (chips, inputs, outline buttons). */
  border: dark ? 'rgba(255,255,255,0.18)' : mixHex(d.line, '#000000', 0.06),
  ink: d.dk,
  sub: d.muteInk,
  faint: dark ? '#85858F' : '#868B97',
  /** The one accent (kept under its old name). */
  violet: d.acc,
  violetDeep: d.accDeep,
  /** Accent as text / thin icons on the page. */
  accInk: dark ? mixHex(d.acc, '#FFFFFF', 0.3) : d.acc,
  /** Accent tint behind icons, selected rows; its border. */
  accSoft: d.soft,
  accLine: dark ? hexA(d.acc, 0.4) : mixHex(d.acc, '#FFFFFF', 0.62),
  /** Second accent = a lighter tint of the one accent (one palette, no extra hue). */
  pink: mixHex(d.acc, '#FFFFFF', dark ? 0.3 : 0.35),
  go: [mixHex(d.acc, '#FFFFFF', 0.15), d.accDeep] as const,
  display: [mixHex(d.acc, '#FFFFFF', 0.1), d.accDeep] as const,
  swash: [mixHex(d.acc, '#FFFFFF', 0.5), mixHex(d.acc, '#FFFFFF', 0.3)] as const,
  /** Neutral status (cancelled, expired, closed). */
  mute: dark ? '#B4B4BC' : '#6B7280',
  track: d.track,
  onAcc: d.onAcc,
  /** Bottom bars and sheets. */
  bar: d.card,
  /** Dark scrim colour over photos (text on photos stays white). */
  scrim: dark ? mixHex(d.page, '#000000', 0.3) : mixHex(d.dk, '#000000', 0.55),
  /** Shadow tint. */
  shadow: dark ? '#000000' : mixHex(d.dk, '#000000', 0.35),
  green: dark ? '#4ADE80' : '#15803D',
  greenSoft: dark ? 'rgba(74,222,128,0.14)' : '#E6F5EB',
  amber: dark ? '#FBBF24' : '#B45309',
  amberSoft: dark ? 'rgba(251,191,36,0.14)' : '#FDF3E2',
  red: dark ? '#FB7185' : '#DC2626',
  redSoft: dark ? 'rgba(251,113,133,0.14)' : '#FDECEC',
  sky: dark ? '#7DD3FC' : '#0369A1',
  sample: dark ? '#E8C46A' : '#7A5A12',
  sampleSoft: dark ? '#30260F' : '#FFF3D6',
  bellDot: d.acc,
}));

/** Category keys + one harmonised hue each (fallback plates, the listing banner, club initials). The home tiles are photos (eventsV2Art CATEGORY_PHOTO). */
export type TileKey = 'all' | 'cultural' | 'sports' | 'workshops' | 'clubs';
export const TILES: { key: TileKey; label: string; grad: readonly [string, string, string]; glow: string }[] = [
  // One harmonised set (owner, 26 Oct: "official colouring"): the same saturation and lightness for every hue,
  // Events violet first; HSL(h, 62/52/52 %, 70/57/45 %).
  { key: 'all', label: 'All events', grad: ['#A083E2', '#7B58CA', '#5B37AE'], glow: 'rgba(209,194,244,0.5)' },
  { key: 'cultural', label: 'Cultural', grad: ['#E2AF83', '#CA8E58', '#AE6F37'], glow: 'rgba(244,218,194,0.5)' },
  { key: 'sports', label: 'Sports', grad: ['#83AFE2', '#588ECA', '#376FAE'], glow: 'rgba(194,218,244,0.5)' },
  { key: 'workshops', label: 'Workshops', grad: ['#78D2B1', '#4BB892', '#319A75'], glow: 'rgba(194,244,226,0.45)' },
  { key: 'clubs', label: 'Clubs', grad: ['#E283A9', '#CA5886', '#AE3767'], glow: 'rgba(244,194,214,0.5)' },
];

/** Which server categories a tile shows (backend enums.js; fests are CULTURAL events tagged "Fest"). */
export const TILE_CATEGORIES: Record<TileKey, Category[] | null> = {
  all: null,
  cultural: ['CULTURAL', 'RECREATION'],
  sports: ['SPORTS', 'TOURNAMENT'],
  workshops: ['WORKSHOP', 'SEMINAR', 'TALK', 'HACKATHON', 'COMPETITION'],
  clubs: ['CLUB'],
};

export const tileOf = (c: Category): TileKey =>
  (Object.keys(TILE_CATEGORIES) as TileKey[]).find((k) => k !== 'all' && TILE_CATEGORIES[k]!.includes(c)) || 'all';

/** Icon squares (info rows, payment methods): the one diet accent (owner, 10 Nov 2026). */
export const QUICK = dietTokens((d) => {
  const g = [mixHex(d.acc, '#FFFFFF', 0.18), d.accDeep] as const;
  return { regs: g, tickets: g, checkin: g, create: g };
});

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { hero: '700', display: '700', title: '600', label: '500', body: '400' } as const;



/** Soft shadow in the diet's dark tint (light mode) or black (dark mode); never a grey square: callers keep solid
 * backgrounds under it. */
export const shadow = (level: 1 | 2 | 3 = 1, color?: string): ViewStyle => {
  const c = color || NIGHT.shadow;
  const dark = isDarkNow();
  const op = dark ? (level === 1 ? 0.35 : level === 2 ? 0.45 : 0.55) : (level === 1 ? 0.07 : level === 2 ? 0.12 : 0.18);
  return Platform.select({
    web: { boxShadow: level === 1 ? `0 4px 12px ${hexA(c, op)}` : level === 2 ? `0 10px 24px ${hexA(c, op)}, 0 2px 6px ${hexA(c, op * 0.6)}` : `0 16px 34px ${hexA(c, op)}, 0 4px 10px ${hexA(c, op * 0.6)}` } as ViewStyle,
    default: {
      shadowColor: c,
      shadowOpacity: op,
      shadowRadius: level === 1 ? 10 : level === 2 ? 18 : 26,
      shadowOffset: { width: 0, height: level === 1 ? 4 : level === 2 ? 8 : 12 },
      elevation: level === 1 ? 3 : level === 2 ? 6 : 10,
    },
  }) as ViewStyle;
};
