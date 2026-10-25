/**
 * Campus Events v2 tokens (owner reference, 25 Oct 2026): one night look for the home AND the inner screens.
 * Deep indigo / navy page, violet accents, a violet -> pink display gradient, glossy gradient category tiles.
 * Weights stay light (titles 600, labels 500, body 400); the bold italic display is only for the hero and
 * event-card titles, as in the reference. No ALL CAPS anywhere.
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
  pink: '#F472B6',
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
  { key: 'all', label: 'All Events', grad: ['#B39BFF', '#8B5CF6', '#6234D9'], glow: 'rgba(221,200,255,0.55)' },
  { key: 'cultural', label: 'Cultural', grad: ['#FFC48A', '#FB923C', '#E2581A'], glow: 'rgba(255,214,170,0.55)' },
  { key: 'sports', label: 'Sports', grad: ['#8FD3FF', '#3B8BF6', '#1E50D6'], glow: 'rgba(170,220,255,0.55)' },
  { key: 'workshops', label: 'Workshops', grad: ['#9BEFB4', '#34C46A', '#168A47'], glow: 'rgba(190,255,210,0.5)' },
  { key: 'clubs', label: 'Clubs', grad: ['#FFA8D8', '#EC4899', '#B5175E'], glow: 'rgba(255,190,225,0.55)' },
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
  regs: ['#A78BFA', '#6D3FE6'] as const,
  tickets: ['#FBBF77', '#F0723A'] as const,
  checkin: ['#6EE7B7', '#109A6A'] as const,
  create: ['#F9A8D4', '#D9367F'] as const,
};

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { hero: '700', display: '800', title: '600', label: '500', body: '400' } as const;

/** Handwritten face from the platform (no font download): Android's Dancing Script, iOS Snell Roundhand, web Segoe Print. */
export const SCRIPT = Platform.select({ android: 'cursive', ios: 'SnellRoundhand', default: '"Segoe Print", "Snell Roundhand", "Bradley Hand", cursive' });

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
