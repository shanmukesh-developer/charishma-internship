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
  possibilities: '#B28CFF',
  swash: ['#C4B5FD', '#F0ABFC'] as const,
  pin: '#F5A3D7',
  bellDot: '#FF5A7A',
};

/** Category cards (home): top-left -> bottom-right glossy gradients, sampled from the board. */
export const CARD = {
  bike: { grad: ['#A68CF8', '#9173ED', '#7F5FE3'] as const, glow: 'rgba(240,120,220,0.55)', ink: '#5B3FD9' },
  car: { grad: ['#56B8FB', '#3890F1', '#2C6FE6'] as const, glow: 'rgba(120,200,255,0.55)', ink: '#2563EB' },
  room: { grad: ['#FBA98E', '#EF8888', '#E2667F'] as const, glow: 'rgba(255,200,150,0.55)', ink: '#E05A6E' },
  flat: { grad: ['#93D7BA', '#73BC9E', '#5AAE84'] as const, glow: 'rgba(200,255,220,0.5)', ink: '#2F9467' },
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
  accent: '#5B3FE0',
  accentDeep: '#4A2FCF',
  accentSoft: '#EFEBFF',
  accentInk: '#5B3FE0',
  star: '#F5B83A',
  green: '#1F8A55',
  greenSoft: '#E5F6EC',
  amber: '#C9821A',
  amberSoft: '#FFF4E2',
  red: '#E0475F',
  redSoft: '#FDECEF',
  sample: '#8A6A1E',
  sampleSoft: '#FFF6DF',
  hero: ['#6D4BF2', '#5B3FE0', '#4528C9'] as const,
};

/** Soft tinted plates of the light category cards (explore board). */
export const PLATE = {
  bike: { bg: ['#F1ECFF', '#E6DEFF'] as const, ink: '#5B3FE0', blob: '#D9CCFF' },
  car: { bg: ['#EAF4FF', '#DCEBFF'] as const, ink: '#2569D9', blob: '#C7DFFF' },
  room: { bg: ['#FFF0EA', '#FFE3D9'] as const, ink: '#D9643F', blob: '#FFD2C2' },
  flat: { bg: ['#E8F8F0', '#D8F1E5'] as const, ink: '#23875A', blob: '#BFE8D3' },
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
