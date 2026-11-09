/**
 * PG v2 tokens (owner reference board, 24 Oct 2026). Colours sampled from the board with PIL:
 * indigo / violet primary, lavender tints, white cards with soft shadows, 16–20 radius, light weights.
 * Light and dark (owner, 4 Nov 2026: dark mode had left this section white). PG2 answers with the palette for the
 * app's current theme (utils/themeNow); the light values are unchanged from the board.
 */
import { Platform, type ViewStyle } from 'react-native';
import { dietTokens, mixHex, type DietTokens } from '../../utils/themeNow';

const PG2_LIGHT = {
  primary: '#5538EE',
  primaryDeep: '#4A2FD9',
  primaryPress: '#4328CC',
  heroTop: '#5A5CEC',
  heroMid: '#6A4FE6',
  heroBottom: '#5340DD',
  ink: '#1E1B4B',
  ink2: '#3B3F66',
  muted: '#878DA5',
  faint: '#A9AEC2',
  line: '#ECEBF6',
  lineSoft: '#F2F1FA',
  page: '#FAFAFE',
  card: '#FFFFFF',
  lavender: '#F1EFFE',
  lavender2: '#E8E4FD',
  lavenderInk: '#5B47D6',
  price: '#178A4C',
  green: '#23804E',
  greenSoft: '#E4F6EC',
  verified: '#2F86E6',
  star: '#F5B83A',
  starOff: '#D9D6EA',
  amber: '#D98A1F',
  amberSoft: '#FFF3E0',
  red: '#E0475F',
  redSoft: '#FDECEF',
  redLine: '#F6C9D2',
  boys: { ink: '#2E7DD1', soft: '#EAF5FD', icon: '#3A9BE3' },
  girls: { ink: '#E0457F', soft: '#FDEEF5', icon: '#F0598F' },
  coed: { ink: '#6E58D8', soft: '#F0ECFD', icon: '#8C74F0' },
  /** Meal row tints on the mess timetable (reference: green, amber, violet, pink). */
  meal: [
    { soft: '#EDF8F1', ink: '#2C9A5B' },
    { soft: '#FFF6E6', ink: '#E2A131' },
    { soft: '#F1EFFE', ink: '#2FA36B' },
    { soft: '#FBEFFA', ink: '#8B5CF6' },
  ],
  /** Today's-menu icon tints (reference: blue, blue, red, red). */
  menuIcon: [
    { soft: '#EAF3FE', ink: '#3A86E0' },
    { soft: '#EAF3FE', ink: '#3A86E0' },
    { soft: '#FDEDEE', ink: '#E05A5A' },
    { soft: '#FDEDEE', ink: '#E05A5A' },
  ],
};

type Pg2Palette = typeof PG2_LIGHT;

/** Dark: the same roles on the app's dark page (#0A0A0B), cards one step up, the violet accent lifted for contrast. */
const PG2_DARK: Pg2Palette = {
  primary: '#6D55F5',
  primaryDeep: '#5B43EA',
  primaryPress: '#4E37D6',
  heroTop: '#4B4CD6',
  heroMid: '#5A40D0',
  heroBottom: '#4434C2',
  ink: '#EEEDFB',
  ink2: '#C9C7E4',
  muted: '#9497B3',
  faint: '#6E7190',
  line: '#2A2840',
  lineSoft: '#211F33',
  page: '#0B0B12',
  card: '#17161F',
  lavender: '#231F3D',
  lavender2: '#2C2650',
  lavenderInk: '#B6A9FF',
  price: '#45C483',
  green: '#4CC48A',
  greenSoft: '#13291D',
  verified: '#62A8F2',
  star: '#F5B83A',
  starOff: '#4A4766',
  amber: '#F0A945',
  amberSoft: '#33240F',
  red: '#F06A80',
  redSoft: '#3A1820',
  redLine: '#5C2533',
  boys: { ink: '#6FB2F2', soft: '#14263A', icon: '#6FB2F2' },
  girls: { ink: '#F27BA7', soft: '#3A1828', icon: '#F27BA7' },
  coed: { ink: '#AA97F7', soft: '#241E44', icon: '#AA97F7' },
  meal: [
    { soft: '#13291D', ink: '#4CC48A' },
    { soft: '#33270F', ink: '#F0B54A' },
    { soft: '#231F3D', ink: '#4CC48A' },
    { soft: '#2E1B33', ink: '#B28BFA' },
  ],
  menuIcon: [
    { soft: '#14263A', ink: '#6FB2F2' },
    { soft: '#14263A', ink: '#6FB2F2' },
    { soft: '#3A1820', ink: '#F07A7A' },
    { soft: '#3A1820', ink: '#F07A7A' },
  ],
};

/**
 * Owner, 10 Nov 2026 ("fix one perfect non ai color", chose "Match rest of app"): PG wears the app's diet look -
 * the light red (Non-veg) / light green (Veg) band, white cards and the one diet accent (utils/themeNow dietTokens).
 * The brand roles (primary, hero, lavender tints, lines, page) take the diet; meaning colours (price green, star,
 * amber, red, boys / girls / co-ed chips, meal and menu tints) keep the board's values.
 */
export function pgDiet(d: DietTokens, dark: boolean): Pg2Palette {
  const base = dark ? PG2_DARK : PG2_LIGHT;
  // Filled buttons carry white text: in dark mode the bright accent is taken a step deeper so the label reads.
  const fill = dark ? mixHex(d.acc, '#000000', 0.3) : d.acc;
  const tint = dark ? mixHex(d.card, d.acc, 0.14) : d.soft;
  return {
    ...base,
    primary: fill,
    primaryDeep: dark ? mixHex(fill, '#000000', 0.12) : d.accDeep,
    primaryPress: mixHex(dark ? fill : d.accDeep, '#000000', 0.12),
    // Starts in the page colour: the selected folder tab above flows straight into it (owner, 10 Nov 2026).
    heroTop: d.page,
    heroMid: d.page,
    heroBottom: dark ? mixHex(d.page, d.top, 0.6) : d.sel,
    ink: dark ? base.ink : mixHex('#17171F', d.dk, 0.35),
    ink2: dark ? base.ink2 : '#3E404C',
    muted: dark ? base.muted : '#7E8190',
    faint: dark ? base.faint : '#A7AAB6',
    line: dark ? mixHex(d.card, '#FFFFFF', 0.08) : d.line,
    lineSoft: dark ? mixHex(d.card, '#FFFFFF', 0.05) : mixHex(d.line, '#FFFFFF', 0.45),
    page: d.page,
    card: d.card,
    lavender: tint,
    lavender2: dark ? mixHex(d.card, d.acc, 0.22) : mixHex(d.soft, d.un, 0.6),
    lavenderInk: d.acc,
    starOff: dark ? base.starOff : '#DEDAE0',
  };
}

export const PG2: Pg2Palette = dietTokens(pgDiet);

export const R = { sm: 10, md: 14, lg: 16, xl: 20, pill: 999 } as const;
export const GUTTER = 16;

/** Weights stay light: titles 600, labels 500, body 400 (never bold, never ALL CAPS). */
export const W = { title: '600', label: '500', body: '400' } as const;

export const shadow = (level: 1 | 2 = 1): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? '0 4px 16px rgba(43,30,34,0.06)' : '0 10px 28px rgba(43,30,34,0.10)' } as ViewStyle,
  default: {
    shadowColor: '#2B1E22',
    shadowOpacity: level === 1 ? 0.07 : 0.12,
    shadowRadius: level === 1 ? 12 : 20,
    shadowOffset: { width: 0, height: level === 1 ? 4 : 8 },
    elevation: level === 1 ? 2 : 5,
  },
}) as ViewStyle;

export type GenderKey = 'Boys' | 'Girls' | 'Co-ed';
export const genderTone = (g: GenderKey) => (g === 'Boys' ? PG2.boys : g === 'Girls' ? PG2.girls : PG2.coed);
