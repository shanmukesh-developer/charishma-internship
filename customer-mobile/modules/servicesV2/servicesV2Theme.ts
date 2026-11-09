/**
 * Tech & repairs v2 tokens (owner reference board, 26 Oct 2026). One palette: a navy / indigo header and hero
 * cards, the Others "services" indigo for buttons and selected chips (the same accent the booking sheet wears,
 * modules/others/othersTheme ACCENTS.services), on a light cool-grey page with white rows.
 * Weights stay light (titles 600, labels 500, body 400). No ALL CAPS. Nothing moves except a one-time fade-in
 * and press feedback.
 */
import { Platform, type ViewStyle } from 'react-native';
import { dietTokens, mixHex, type DietTokens, type Palette } from '../../utils/themeNow';

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
  /** Ink on the header band and the hero cards (owner, 10 Nov 2026: they sit on the light diet band now). */
  onBand: '#FFFFFF',
  onBandSub: 'rgba(226,229,255,0.82)',
  /** Hairlines and icon wells on the band. */
  onBandLine: 'rgba(255,255,255,0.28)',
  onBandWell: 'rgba(255,255,255,0.14)',
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
  onBand: '#FFFFFF',
  onBandSub: 'rgba(226,229,255,0.82)',
  onBandLine: 'rgba(255,255,255,0.28)',
  onBandWell: 'rgba(255,255,255,0.14)',
};

type TvPalette = Palette<typeof TV_LIGHT>;

/**
 * Owner, 10 Nov 2026 ("fix one perfect non ai color", chose "Match rest of app"): Tech & repairs wears the app's diet
 * look - the header and hero cards on the light red (Non-veg) / light green (Veg) band with dark ink, white cards and
 * the one diet accent (utils/themeNow dietTokens). Meaning colours (green, amber, red, unread dot) keep their values.
 */
function tvDiet(d: DietTokens, dark: boolean): TvPalette {
  const base: TvPalette = dark ? TV_DARK : TV_LIGHT;
  // Filled buttons carry white text: in dark mode the bright accent is taken a step deeper so the label reads.
  const fill = dark ? mixHex(d.acc, '#000000', 0.3) : d.acc;
  const deep = dark ? mixHex(fill, '#000000', 0.12) : d.accDeep;
  return {
    ...base,
    header: [d.top, d.top, d.topDeep],
    heroInk: d.top,
    page: d.page,
    card: d.card,
    ink: dark ? base.ink : mixHex('#17171F', d.dk, 0.35),
    ink2: dark ? base.ink2 : '#3E404C',
    sub: dark ? base.sub : '#666979',
    faint: dark ? base.faint : '#9A9DAA',
    line: dark ? 'rgba(255,255,255,0.09)' : hexA(d.dk, 0.09),
    lineSoft: dark ? 'rgba(255,255,255,0.05)' : hexA(d.dk, 0.05),
    accent: fill,
    accentDeep: dark ? d.acc : deep,
    accentSoft: dark ? mixHex(d.card, d.acc, 0.14) : d.soft,
    accentLine: hexA(d.acc, dark ? 0.35 : 0.26),
    go: [mixHex(fill, '#FFFFFF', 0.12), fill, deep],
    plate: dark ? mixHex(d.card, d.acc, 0.12) : d.soft,
    plateInk: dark ? d.acc : d.accDeep,
    onBand: d.dk,
    onBandSub: hexA(d.dk, 0.74),
    onBandLine: hexA(d.dk, 0.18),
    onBandWell: dark ? mixHex(d.top, '#FFFFFF', 0.08) : '#FFFFFF',
  };
}

export const TV: TvPalette = dietTokens(tvDiet);

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { display: '700', title: '600', label: '500', body: '400' } as const;

/** '#RRGGBB' + alpha -> rgba(). */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Soft navy shadow (never flat grey). */
export const shadow = (level: 1 | 2 | 3 = 1, color = '#2B1E22'): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? `0 2px 8px ${hexA(color, 0.07)}` : level === 2 ? `0 8px 22px ${hexA(color, 0.12)}, 0 2px 6px ${hexA(color, 0.06)}` : `0 14px 30px ${hexA(color, 0.24)}` } as ViewStyle,
  default: {
    shadowColor: color,
    shadowOpacity: level === 1 ? 0.07 : level === 2 ? 0.12 : 0.24,
    shadowRadius: level === 1 ? 8 : level === 2 ? 16 : 22,
    shadowOffset: { width: 0, height: level === 1 ? 2 : level === 2 ? 7 : 11 },
    elevation: level === 1 ? 2 : level === 2 ? 5 : 8,
  },
}) as ViewStyle;
