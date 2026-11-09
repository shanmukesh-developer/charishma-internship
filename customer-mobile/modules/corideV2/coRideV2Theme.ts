/**
 * Co-Ride v2 tokens (owner reference, 24 Oct 2026). Colours sampled from the reference with PIL:
 * a blue primary (#1D4ED8 to #2563EB), light blue tints, white cards, a mint tint for Shared auto,
 * navy ink. Light and dark (owner, 4 Nov 2026: dark mode had left this section white); CR answers with the palette
 * for the app's current theme (utils/themeNow), the light values unchanged.
 * Weights stay light: titles 600, labels 500, body 400 (never bold, never ALL CAPS).
 */
import { Platform, type ViewStyle } from 'react-native';
import { dietTokens, mixHex, type DietTokens } from '../../utils/themeNow';

const CR_LIGHT = {
  primary: '#1D5FE8',
  primaryDeep: '#1D4ED8',
  primarySoft: '#2563EB',
  primaryLight: '#3B82F6',
  ink: '#0B1A4A',
  ink2: '#33415C',
  muted: '#6E7B96',
  faint: '#A3ADC2',
  line: '#E6EBF4',
  lineSoft: '#EEF2F8',
  page: '#F5F8FD',
  heroTop: '#E3EEFC',
  heroBottom: '#F2F7FE',
  card: '#FFFFFF',
  field: '#F3F5F9',
  tint: '#E7F0FE',
  tint2: '#D8E7FD',
  tintInk: '#1D4ED8',
  mint: '#E3F5EF',
  mintLine: '#CDEBDF',
  mintInk: '#1F8A62',
  green: '#1F8A57',
  greenSoft: '#E3F4EA',
  amber: '#B45309',
  amberSoft: '#FDF3E2',
  red: '#C2413A',
  redSoft: '#FCECEB',
  star: '#F5B83A',
  whatsapp: '#1FA855',
};

type CrPalette = typeof CR_LIGHT;

/** Dark: the same roles on the app's dark page, cards one step up, the blue accent lifted for contrast. */
const CR_DARK: CrPalette = {
  primary: '#3B7BF6',
  primaryDeep: '#2F6BEB',
  primarySoft: '#4A86F7',
  primaryLight: '#6A9DF8',
  ink: '#EEF2FF',
  ink2: '#C3CBE0',
  muted: '#8B95AE',
  faint: '#5F6880',
  line: '#232A3A',
  lineSoft: '#1B2130',
  page: '#0A0C12',
  heroTop: '#13213E',
  heroBottom: '#0D1424',
  card: '#151925',
  field: '#1C2130',
  tint: '#15264A',
  tint2: '#1C3160',
  tintInk: '#8DB3FF',
  mint: '#10281F',
  mintLine: '#1E4434',
  mintInk: '#5FD3A1',
  green: '#4CC48A',
  greenSoft: '#12301F',
  amber: '#F0A945',
  amberSoft: '#33240E',
  red: '#F07A72',
  redSoft: '#3A1717',
  star: '#F5B83A',
  whatsapp: '#25C364',
};

/**
 * Owner, 10 Nov 2026 ("fix one perfect non ai color", chose "Match rest of app"): Co-Ride wears the app's diet look -
 * light red (Non-veg) / light green (Veg) band, white cards, the one diet accent (utils/themeNow dietTokens). The blue
 * brand roles take the diet; meaning colours (mint Shared auto, green, amber, red, star, WhatsApp) keep their values.
 */
function crDiet(d: DietTokens, dark: boolean): CrPalette {
  const base = dark ? CR_DARK : CR_LIGHT;
  // Filled buttons carry white text: in dark mode the bright accent is taken a step deeper so the label reads.
  const fill = dark ? mixHex(d.acc, '#000000', 0.3) : d.acc;
  return {
    ...base,
    primary: fill,
    primaryDeep: dark ? mixHex(fill, '#000000', 0.12) : d.accDeep,
    primarySoft: dark ? mixHex(fill, '#FFFFFF', 0.08) : mixHex(d.acc, '#FFFFFF', 0.1),
    primaryLight: mixHex(fill, '#FFFFFF', 0.25),
    ink: dark ? base.ink : mixHex('#17171F', d.dk, 0.35),
    ink2: dark ? base.ink2 : '#3E404C',
    muted: dark ? base.muted : '#7B7F8E',
    faint: dark ? base.faint : '#A7AAB6',
    line: dark ? mixHex(d.card, '#FFFFFF', 0.08) : d.line,
    lineSoft: dark ? mixHex(d.card, '#FFFFFF', 0.05) : mixHex(d.line, '#FFFFFF', 0.45),
    page: d.page,
    // Starts in the page colour: the selected folder tab above flows straight into it (owner, 10 Nov 2026).
    heroTop: d.page,
    heroBottom: dark ? mixHex(d.top, d.page, 0.5) : d.sel,
    card: d.card,
    field: dark ? mixHex(d.card, '#FFFFFF', 0.05) : '#F4F4F6',
    tint: dark ? mixHex(d.card, d.acc, 0.14) : d.soft,
    tint2: dark ? mixHex(d.card, d.acc, 0.22) : mixHex(d.soft, d.un, 0.6),
    tintInk: dark ? d.acc : d.accDeep,
  };
}

export const CR: CrPalette = dietTokens(crDiet);

export const R = { sm: 10, md: 14, lg: 16, xl: 20, pill: 999 } as const;
export const GUTTER = 16;
export const W = { title: '600', label: '500', body: '400' } as const;

export const shadow = (level: 1 | 2 = 1): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? '0 3px 14px rgba(43,30,34,0.06)' : '0 10px 28px rgba(43,30,34,0.12)' } as ViewStyle,
  default: {
    shadowColor: '#2B1E22',
    shadowOpacity: level === 1 ? 0.07 : 0.13,
    shadowRadius: level === 1 ? 12 : 20,
    shadowOffset: { width: 0, height: level === 1 ? 4 : 8 },
    elevation: level === 1 ? 2 : 5,
  },
}) as ViewStyle;

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';
export const toneColors = (t: Tone) => (
  t === 'blue' ? { bg: CR.tint, fg: CR.tintInk }
    : t === 'green' ? { bg: CR.greenSoft, fg: CR.green }
      : t === 'amber' ? { bg: CR.amberSoft, fg: CR.amber }
        : t === 'red' ? { bg: CR.redSoft, fg: CR.red }
          : { bg: CR.lineSoft, fg: CR.ink2 }
);
