/**
 * Campus Events v2 tokens (owner reference, 25 Oct 2026): one night look for the home AND the inner screens.
 * Deep indigo / navy page, the Events violet as the one primary, glossy category tiles in matched muted hues.
 * Weights stay light (titles 600, labels 500, body 400); bold only for the headline and event titles. No italics,
 * script lines or ALL CAPS (owner, 26 Oct: official, not decorative).
 */
import { Platform, type ViewStyle } from 'react-native';
import type { Category } from '../campusEvents/campusEventsApi';

export const NIGHT = {
  page: '#13123A',
  pageTop: '#100F33',
  card: '#1C1A4A',
  card2: '#232158',
  glass: 'rgba(255,255,255,0.07)',
  glass2: 'rgba(255,255,255,0.11)',
  line: 'rgba(255,255,255,0.12)',
  lineSoft: 'rgba(255,255,255,0.07)',
  ink: '#FFFFFF',
  sub: 'rgba(228,226,255,0.76)',
  faint: 'rgba(214,210,255,0.52)',
  violet: '#A78BFA',
  violetDeep: '#7C5CF0',
  /** Second accent = a lighter tint of the Events violet (one palette, no extra hue). */
  pink: '#C9B4F7',
  go: ['#B096FA', '#7B55EA'] as const,
  display: ['#C4A5FF', '#F07AC8'] as const,
  swash: ['#C4B5FD', '#F0ABFC'] as const,
  green: '#4ADE80',
  greenSoft: 'rgba(74,222,128,0.14)',
  amber: '#FBBF24',
  amberSoft: 'rgba(251,191,36,0.14)',
  red: '#FB7185',
  redSoft: 'rgba(251,113,133,0.14)',
  sky: '#7DD3FC',
  sample: '#7A5A12',
  sampleSoft: '#FFF3D6',
  bellDot: '#FF5A7A',
};

/** Category tiles (home): glossy top-left -> bottom-right gradients + the glow behind the 3D icon. */
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

/** Quick-access icon squares. */
export const QUICK = {
  regs: ['#A083E2', '#5B37AE'] as const,
  tickets: ['#E2AF83', '#AE6F37'] as const,
  checkin: ['#78D2B1', '#319A75'] as const,
  create: ['#E283A9', '#AE3767'] as const,
};

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { hero: '700', display: '700', title: '600', label: '500', body: '400' } as const;


/** '#RRGGBB' + alpha -> rgba(). */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Layered night shadow (deep violet glow, not grey). */
export const shadow = (level: 1 | 2 | 3 = 1, color = '#05041A'): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? `0 4px 12px ${hexA(color, 0.35)}` : level === 2 ? `0 10px 24px ${hexA(color, 0.45)}, 0 2px 6px ${hexA(color, 0.3)}` : `0 16px 34px ${hexA(color, 0.55)}, 0 4px 10px ${hexA(color, 0.35)}` } as ViewStyle,
  default: {
    shadowColor: color,
    shadowOpacity: level === 1 ? 0.35 : level === 2 ? 0.45 : 0.55,
    shadowRadius: level === 1 ? 10 : level === 2 ? 18 : 26,
    shadowOffset: { width: 0, height: level === 1 ? 4 : level === 2 ? 8 : 12 },
    elevation: level === 1 ? 3 : level === 2 ? 6 : 10,
  },
}) as ViewStyle;
