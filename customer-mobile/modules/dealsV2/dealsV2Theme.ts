/**
 * Deals & spin v2 tokens (owner reference + official look, 26 Oct 2026): one palette, the Deals indigo (header,
 * hero, buttons, tickets, wallet card) with gold used only for ZenPoints and reward accents (the Z coin, the
 * ZenPoints card, the wheel's pointer and hub ring). Light lavender page. Weights stay light (titles 600, labels
 * 500, body 400). No ALL CAPS except the one small "ZCS REWARDS" eyebrow the reference shows. Nothing loops.
 */
import { Platform, type ViewStyle } from 'react-native';

export const DV = {
  /** Header (top -> bottom). */
  header: ['#1C0E5A', '#2A1670', '#36208E'] as const,
  page: '#F5F3FF',
  pageDeep: '#EDE9FE',
  card: '#FFFFFF',
  line: 'rgba(76,52,170,0.10)',
  lineSoft: 'rgba(76,52,170,0.06)',
  ink: '#1A1340',
  sub: '#5F5A80',
  faint: '#8E89AD',
  violet: '#6D3FE6',
  violetDeep: '#4B2BC8',
  violetSoft: '#EFEAFF',
  violetLine: 'rgba(109,63,230,0.28)',
  /** Hero card (top-left -> bottom-right). */
  hero: ['#7B4DF2', '#5A2FD6', '#3A1A9E'] as const,
  /** Gold: the Z coin, "Win.", the pill button. */
  gold: '#F6C453',
  goldDeep: '#D99A1E',
  goldPill: ['#FFE08A', '#F6C453', '#E8A92A'] as const,
  goldInk: '#4A2A00',
  /** ZenPoints card (cream) and wallet card (lavender). */
  cream: ['#FFF8E6', '#FFEFC7'] as const,
  creamLine: 'rgba(217,154,30,0.28)',
  creamInk: '#7A4B00',
  lavender: ['#F1ECFF', '#E2D8FF'] as const,
  lavenderLine: 'rgba(109,63,230,0.22)',
  /** CTA (violet). */
  go: ['#8D63F7', '#6D3FE6', '#5528CF'] as const,
  green: '#0E9F6E',
  greenSoft: '#E3F8EF',
  amber: '#B7791F',
  amberSoft: '#FFF4DB',
  red: '#D63B5C',
  redSoft: '#FDE8EE',
  sample: '#7A5A12',
  sampleSoft: '#FFF3D6',
  bellDot: '#FF5A7A',
  /** Spin page (night). */
  night: ['#2A1677', '#1B0F52', '#120A3A'] as const,
  nightInk: '#FFFFFF',
  nightSub: 'rgba(232,226,255,0.78)',
};

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { display: '700', title: '600', label: '500', body: '400' } as const;

/** '#RRGGBB' + alpha -> rgba(). */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Layered violet shadow (never flat grey). */
export const shadow = (level: 1 | 2 | 3 = 1, color = '#3A1C9E'): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? `0 3px 10px ${hexA(color, 0.12)}` : level === 2 ? `0 10px 24px ${hexA(color, 0.16)}, 0 2px 6px ${hexA(color, 0.08)}` : `0 18px 36px ${hexA(color, 0.28)}, 0 4px 10px ${hexA(color, 0.14)}` } as ViewStyle,
  default: {
    shadowColor: color,
    shadowOpacity: level === 1 ? 0.12 : level === 2 ? 0.16 : 0.28,
    shadowRadius: level === 1 ? 8 : level === 2 ? 16 : 24,
    shadowOffset: { width: 0, height: level === 1 ? 3 : level === 2 ? 8 : 12 },
    elevation: level === 1 ? 2 : level === 2 ? 5 : 9,
  },
}) as ViewStyle;

/** ₹1,234 (no decimals when whole). */
export const rupees = (n: number) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;

/** "30 Sep" in IST. */
export const shortDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
};
