/**
 * Rentals v2 tokens. Two looks from the owner's boards (25 Oct 2026), now in the app's one diet look (owner,
 * 10 Nov 2026: "fix one perfect non ai color"): light red page + red accent in Non-veg, light green + green in Veg,
 * white cards; dark mode takes the diet's dark surfaces. Read at render (utils/themeNow dietTokens).
 *  NIGHT  the home (the name stays): the diet page under the dusk-city photo hero, white chips, the one accent.
 *  DAY    the inner screens: diet page, white cards, the diet accent, cut-outs on soft tinted plates.
 * Weights stay light (titles 600, labels 500, body 400). No ALL CAPS anywhere.
 */
import { Platform, type ViewStyle } from 'react-native';
import { dietTokens, mixHex, themedTokens, type Palette } from '../../utils/themeNow';

const NIGHT_BASE = {
  page: '#141438',
  pageTop: '#12133F',
  ink: '#FFFFFF',
  sub: 'rgba(226,224,255,0.78)',
  faint: 'rgba(214,210,255,0.55)',
  chip: '#232350',
  chipLine: '#383866',
  /** Soft accent fill (icon wells, km pill). */
  soft: '#2A2560',
  glass: 'rgba(255,255,255,0.10)',
  glassLine: 'rgba(255,255,255,0.18)',
  violet: '#A78BFA',
  violetDeep: '#7C5CF0',
  go: ['#A98BF6', '#7B55EA'] as readonly [string, string],
  /** Accent-filled cards with white text (List your vehicle). */
  fill: ['#8673CA', '#6F5BB0', '#594496'] as readonly [string, string, string],
  /** Monogram ring and avatar gradients. */
  ring: ['#E8E4FF', '#A18EE8', '#6F5BB0'] as readonly [string, string, string],
  /** Accent that sits on the dusk photo (location pin). */
  pin: '#F5A3D7',
  bellDot: '#FF5A7A',
  /** Card shadow colour (diet-dark, never a navy glow). */
  shadow: '#05051A',
};

/** Accent fill that carries white text: the light accent itself, in dark mode a deeper step of the bright one. */
const fillOf = (acc: string, dark: boolean) => (dark ? mixHex(acc, '#000000', 0.3) : acc);
const solidSoft = (d: { soft: string; card: string; acc: string }, dark: boolean) => (dark ? mixHex(d.card, d.acc, 0.16) : d.soft);

export const NIGHT: typeof NIGHT_BASE = dietTokens((d, dark) => {
  const fill = fillOf(d.acc, dark);
  const fillDeep = dark ? mixHex(d.acc, '#000000', 0.45) : d.accDeep;
  return {
    page: d.pageDeep,
    pageTop: d.pageDeep,
    ink: d.dk,
    sub: hexA(d.dk, 0.7),
    faint: hexA(d.dk, 0.5),
    chip: d.card,
    chipLine: d.line,
    soft: solidSoft(d, dark),
    glass: hexA(d.dk, 0.06),
    glassLine: hexA(d.dk, 0.12),
    violet: d.acc,
    violetDeep: d.accDeep,
    go: [fill, fillDeep] as const,
    fill: [mixHex(fill, '#FFFFFF', 0.14), fill, fillDeep] as const,
    ring: [mixHex(d.acc, '#FFFFFF', dark ? 0.6 : 0.8), mixHex(d.acc, '#FFFFFF', 0.35), fill] as const,
    pin: dark ? d.acc : mixHex(d.acc, '#FFFFFF', 0.45),
    bellDot: '#FF5A7A',
    shadow: dark ? '#000000' : d.dk,
  };
});

/** Category cards (home). One product family (owner, 26 Oct: "official colouring"): the four hues share the same
 * perceptual lightness and chroma (OKLCH L 0.70 → 0.53, C 0.13), so they read as one palette, not a rainbow. */
export const CARD = {
  bike: { grad: ['#A18EE8', '#8673CA', '#6F5BB0'] as const, glow: '#E8E4FF', shadow: '#594496', ink: '#6750AB' },
  car: { grad: ['#64A1EE', '#4985CF', '#316CB5'] as const, glow: '#D7EAFF', shadow: '#17559B', ink: '#2063B0' },
  room: { grad: ['#E47D6D', '#C56153', '#AA493C'] as const, glow: '#FFDFD8', shadow: '#8F3126', ink: '#A43C2F' },
  flat: { grad: ['#2EB88F', '#009B74', '#00835D'] as const, glow: '#CFF1E3', shadow: '#006B47', ink: '#007B53' },
};

const DAY_LIGHT = {
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
  plateGrad: ['#F3EFFF', '#E6DEFF'] as const,
};

/** Inner screens in dark mode (owner, 4 Nov 2026: they stayed white). The night home is unchanged. */
const DAY_DARK: Palette<typeof DAY_LIGHT> = {
  page: '#0C0B1A',
  card: '#17152B',
  ink: '#EEEBFF',
  ink2: '#CBC7EA',
  muted: '#9895B8',
  faint: '#6B6890',
  line: '#29263F',
  lineSoft: '#201D33',
  accent: '#8466F0',
  accentDeep: '#7357EA',
  accentSoft: '#241C48',
  accentInk: '#B5A3FF',
  star: '#F5B83A',
  green: '#4CC48A',
  greenSoft: '#12291D',
  amber: '#E6A447',
  amberSoft: '#33250F',
  red: '#F06A80',
  redSoft: '#3A1820',
  sample: '#E8C46A',
  sampleSoft: '#30260F',
  hero: ['#7E66E0', '#6246D8', '#4F35C0'],
  plateGrad: ['#241C48', '#2E2458'],
};

/** The board's roles in the diet colours: page, lines, the one accent (light: the accent; dark: `accent` is a fill
 * deep enough for white text, `accentInk` the bright accent for text and icons). Ink, star, green, amber, red and the
 * sample tag keep their meaning colours. */
export const DAY: Palette<typeof DAY_LIGHT> = dietTokens((d, dark) => {
  const base = dark ? DAY_DARK : DAY_LIGHT;
  const fill = fillOf(d.acc, dark);
  const fillDeep = dark ? mixHex(d.acc, '#000000', 0.45) : d.accDeep;
  const soft = solidSoft(d, dark);
  return {
    ...base,
    page: d.page,
    card: d.card,
    ink: dark ? base.ink : mixHex(d.dk, '#1B1840', 0.35),
    line: dark ? base.line : d.line,
    lineSoft: dark ? base.lineSoft : mixHex(d.line, '#FFFFFF', 0.4),
    accent: fill,
    accentDeep: fillDeep,
    accentSoft: soft,
    accentInk: d.acc,
    hero: [mixHex(fill, '#FFFFFF', 0.14), fill, fillDeep] as const,
    plateGrad: [soft, mixHex(soft, d.acc, 0.12)] as const,
  };
});


/** Soft tinted plates of the light (inner) screens: the same four hues, very light. */
const PLATE_LIGHT = {
  bike: { bg: ['#F5F3FF', '#E8E4FF'] as const, ink: '#6750AB', blob: '#DCD5FB' },
  car: { bg: ['#ECF6FF', '#D7EAFF'] as const, ink: '#2063B0', blob: '#C9E0FB' },
  room: { bg: ['#FFF1ED', '#FFDFD8'] as const, ink: '#A43C2F', blob: '#F9D0C7' },
  flat: { bg: ['#E9FAF2', '#CFF1E3'] as const, ink: '#007B53', blob: '#BFE9D6' },
};

const PLATE_DARK: Palette<typeof PLATE_LIGHT> = {
  bike: { bg: ['#1E1A3A', '#2A2350'], ink: '#B3A3F5', blob: '#352C66' },
  car: { bg: ['#122238', '#183052'], ink: '#7FB4F2', blob: '#1E3C66' },
  room: { bg: ['#331A16', '#45221D'], ink: '#F29A8A', blob: '#5A2C25' },
  flat: { bg: ['#0F2A20', '#14382B'], ink: '#5FD3A1', blob: '#1B4A38' },
};

export const PLATE: Palette<typeof PLATE_LIGHT> = themedTokens<Palette<typeof PLATE_LIGHT>>(PLATE_LIGHT, PLATE_DARK);

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;
export const W = { hero: '700', title: '600', label: '500', body: '400' } as const;

/** Soft shadow in the diet's dark ink (never a navy glow); category cards pass their own hue. */
export const shadow = (level: 1 | 2 | 3 = 1, color = NIGHT.shadow): ViewStyle => Platform.select({
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
