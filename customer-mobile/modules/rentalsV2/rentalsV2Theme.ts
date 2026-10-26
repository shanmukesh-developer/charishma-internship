/**
 * Rentals v2 tokens. Two looks from the owner's boards (25 Oct 2026), colours sampled with PIL:
 *  NIGHT  the home: deep indigo / violet night page, dusk-city hero, glossy gradient category cards.
 *  DAY    the inner screens: light page, white cards, violet accent, cut-outs on soft tinted plates.
 * Weights stay light (titles 600, labels 500, body 400). No ALL CAPS anywhere.
 */
import { Platform, type ViewStyle } from 'react-native';

export const NIGHT = {
  page: '#141438',
  pageTop: '#12133F',
  ink: '#FFFFFF',
  sub: 'rgba(226,224,255,0.78)',
  faint: 'rgba(214,210,255,0.55)',
  chip: '#232350',
  chipLine: '#383866',
  glass: 'rgba(255,255,255,0.10)',
  glassLine: 'rgba(255,255,255,0.18)',
  violet: '#A78BFA',
  violetDeep: '#7C5CF0',
  go: ['#A98BF6', '#7B55EA'] as const,
  pin: '#F5A3D7',
  bellDot: '#FF5A7A',
};

/** Category cards (home). One product family (owner, 26 Oct: "official colouring"): the four hues share the same
 * perceptual lightness and chroma (OKLCH L 0.70 → 0.53, C 0.13), so they read as one palette, not a rainbow. */
export const CARD = {
  bike: { grad: ['#A18EE8', '#8673CA', '#6F5BB0'] as const, glow: '#E8E4FF', shadow: '#594496', ink: '#6750AB' },
  car: { grad: ['#64A1EE', '#4985CF', '#316CB5'] as const, glow: '#D7EAFF', shadow: '#17559B', ink: '#2063B0' },
  room: { grad: ['#E47D6D', '#C56153', '#AA493C'] as const, glow: '#FFDFD8', shadow: '#8F3126', ink: '#A43C2F' },
  flat: { grad: ['#2EB88F', '#009B74', '#00835D'] as const, glow: '#CFF1E3', shadow: '#006B47', ink: '#007B53' },
};

export const DAY = {
  page: '#F7F6FD',
  card: '#FFFFFF',
  ink: '#1B1840',
  ink2: '#3D3A63',
  muted: '#7D7F9A',
  faint: '#A8AAC0',
  line: '#ECEAF7',
  lineSoft: '#F3F2FB',
  accent: '#6246D8',
  accentDeep: '#4F35C0',
  accentSoft: '#EFEBFF',
  accentInk: '#6246D8',
  star: '#F5B83A',
  green: '#1F8A55',
  greenSoft: '#E5F6EC',
  amber: '#C9821A',
  amberSoft: '#FFF4E2',
  red: '#E0475F',
  redSoft: '#FDECEF',
  sample: '#8A6A1E',
  sampleSoft: '#FFF6DF',
  hero: ['#7E66E0', '#6246D8', '#4F35C0'] as const,
};

/** Soft tinted plates of the light (inner) screens: the same four hues, very light. */
export const PLATE = {
  bike: { bg: ['#F5F3FF', '#E8E4FF'] as const, ink: '#6750AB', blob: '#DCD5FB' },
  car: { bg: ['#ECF6FF', '#D7EAFF'] as const, ink: '#2063B0', blob: '#C9E0FB' },
  room: { bg: ['#FFF1ED', '#FFDFD8'] as const, ink: '#A43C2F', blob: '#F9D0C7' },
  flat: { bg: ['#E9FAF2', '#CFF1E3'] as const, ink: '#007B53', blob: '#BFE9D6' },
};

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { hero: '700', title: '600', label: '500', body: '400' } as const;

export const shadow = (level: 1 | 2 | 3 = 1, color = '#2A1F7A'): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? `0 4px 14px ${hexA(color, 0.08)}` : level === 2 ? `0 10px 26px ${hexA(color, 0.14)}` : `0 16px 34px ${hexA(color, 0.32)}` } as ViewStyle,
  default: {
    shadowColor: color,
    shadowOpacity: level === 1 ? 0.08 : level === 2 ? 0.14 : 0.3,
    shadowRadius: level === 1 ? 10 : level === 2 ? 18 : 24,
    shadowOffset: { width: 0, height: level === 1 ? 4 : level === 2 ? 8 : 12 },
    elevation: level === 1 ? 2 : level === 2 ? 5 : 9,
  },
}) as ViewStyle;

/** '#RRGGBB' + alpha -> rgba(). */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

export type Category = 'bike' | 'car' | 'room' | 'flat';
export const CATEGORIES: Category[] = ['bike', 'car', 'room', 'flat'];
export const CATEGORY_TITLE: Record<Category, string> = { bike: 'Bike Rentals', car: 'Car Rentals', room: 'Room Rentals', flat: 'Flat Rentals' };
