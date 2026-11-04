/**
 * Tech & repairs v2 tokens (owner reference board, 26 Oct 2026). One palette: a navy / indigo header and hero
 * cards, the Others "services" indigo for buttons and selected chips (the same accent the booking sheet wears,
 * modules/others/othersTheme ACCENTS.services), on a light cool-grey page with white rows.
 * Weights stay light (titles 600, labels 500, body 400). No ALL CAPS. Nothing moves except a one-time fade-in
 * and press feedback.
 */
import { Platform, type ViewStyle } from 'react-native';
import { themedTokens, type Palette } from '../../utils/themeNow';

const TV_LIGHT = {
  /** Header (top -> bottom). */
  header: ['#0F1446', '#171D5E', '#222A7C'] as const,
  /** Hero cards: navy at the text side, fading over the photo. */
  heroInk: '#10154A',
  page: '#F4F5FB',
  card: '#FFFFFF',
  ink: '#151938',
  ink2: '#3A3F63',
  sub: '#5F6485',
  faint: '#9195B2',
  line: 'rgba(27,32,90,0.09)',
  lineSoft: 'rgba(27,32,90,0.05)',
  /** Buttons, selected chips, prices (Others services indigo). */
  accent: '#5B4CF0',
  accentDeep: '#3B2FC4',
  accentSoft: '#EFEDFF',
  accentLine: 'rgba(91,76,240,0.26)',
  go: ['#6C5EF6', '#5B4CF0', '#4A3BDB'] as const,
  /** Small icon plates on the quick categories and badges. */
  plate: '#EEF0FB',
  plateInk: '#2E3590',
  green: '#0F8A5F',
  greenSoft: '#E4F6EE',
  amber: '#A76510',
  amberSoft: '#FDF3E1',
  red: '#C23A55',
  redSoft: '#FCE9EE',
  bellDot: '#FF5A7A',
  onDark: '#FFFFFF',
  onDarkSub: 'rgba(226,229,255,0.82)',
  onDarkFaint: 'rgba(214,218,255,0.62)',
};

/** Dark (owner, 4 Nov 2026: dark mode left this section white). Header, hero and buttons keep their colours;
 * the page, rows and text move to the app's dark surfaces. */
const TV_DARK: Palette<typeof TV_LIGHT> = {
  header: ['#0F1446', '#171D5E', '#222A7C'],
  heroInk: '#10154A',
  page: '#0A0B12',
  card: '#151726',
  ink: '#ECEEFF',
  ink2: '#C6C9E6',
  sub: '#9A9EBE',
  faint: '#6B6F8E',
  line: 'rgba(200,205,255,0.10)',
  lineSoft: 'rgba(200,205,255,0.06)',
  accent: '#7B6DF7',
  accentDeep: '#6A5BEF',
  accentSoft: '#221E4A',
  accentLine: 'rgba(123,109,247,0.35)',
  go: ['#6C5EF6', '#5B4CF0', '#4A3BDB'],
  plate: '#1C1F3A',
  plateInk: '#AEB5FF',
  green: '#3FC48F',
  greenSoft: '#11291F',
  amber: '#E6A447',
  amberSoft: '#33250F',
  red: '#F06A85',
  redSoft: '#3A1722',
  bellDot: '#FF5A7A',
  onDark: '#FFFFFF',
  onDarkSub: 'rgba(226,229,255,0.82)',
  onDarkFaint: 'rgba(214,218,255,0.62)',
};

export const TV: Palette<typeof TV_LIGHT> = themedTokens<Palette<typeof TV_LIGHT>>(TV_LIGHT, TV_DARK);

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { display: '700', title: '600', label: '500', body: '400' } as const;

/** '#RRGGBB' + alpha -> rgba(). */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Soft navy shadow (never flat grey). */
export const shadow = (level: 1 | 2 | 3 = 1, color = '#1B2160'): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? `0 2px 8px ${hexA(color, 0.07)}` : level === 2 ? `0 8px 22px ${hexA(color, 0.12)}, 0 2px 6px ${hexA(color, 0.06)}` : `0 14px 30px ${hexA(color, 0.24)}` } as ViewStyle,
  default: {
    shadowColor: color,
    shadowOpacity: level === 1 ? 0.07 : level === 2 ? 0.12 : 0.24,
    shadowRadius: level === 1 ? 8 : level === 2 ? 16 : 22,
    shadowOffset: { width: 0, height: level === 1 ? 2 : level === 2 ? 7 : 11 },
    elevation: level === 1 ? 2 : level === 2 ? 5 : 8,
  },
}) as ViewStyle;
