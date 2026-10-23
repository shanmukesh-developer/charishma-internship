import { Platform } from 'react-native';

// ── Zenvy Design System ──────────────────────────────────────────────────────
// High-performance, luxury campus dining & services design tokens.

export const COLORS = {
  // Core Backgrounds
  bgDark: '#09090B',
  bgCard: '#18181B',
  bgCardHover: '#27272A',
  bgLight: '#F4F5F7',
  bgLightCard: '#FFFFFF',

  // Primary Accents
  gold: '#D4AF7A',
  goldLight: '#F0D9A8',
  goldMuted: 'rgba(212, 175, 122, 0.15)',
  goldBorder: 'rgba(212, 175, 122, 0.4)',
  red: '#EF4F5F',
  redDark: '#D43F4F',

  // Status Colors
  greenRating: '#24963F',
  blueOffer: '#256FEF',
  emerald: '#10B981',
  amber: '#F59E0B',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textMuted: '#8B8B93',
  textDark: '#111827',
  textDarkSecondary: '#4B5563',

  // Borders
  borderDark: 'rgba(255, 255, 255, 0.08)',
  borderLight: 'rgba(0, 0, 0, 0.06)',
  borderGold: 'rgba(212, 175, 122, 0.3)',

  // Overlays
  overlayDark: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(255, 255, 255, 0.95)',

  // Architect Redesign System Tokens
  bg: '#FFFFFF',
  ink: '#14131F',
  inkMuted: '#7A7887',
  primary: '#6C2BD9',
  primaryDark: '#4C1D9E',
  primarySoft: '#F1E9FE',
  accent: '#FF6B2C',
  accentSoft: '#FFEDE2',
  trust: '#1DA870',
  trustSoft: '#E4F7EE',
} as const;

export const LIGHT_THEME = {
  // A touch off-white so white cards (with LIGHT_SURFACE below) separate from the page.
  bg: '#F4F5F7',
  bgSubtle: '#F1F3F5',
  card: '#FFFFFF',
  cardSecondary: '#F8F9FB',
  cardBorder: 'rgba(0, 0, 0, 0.05)',
  cardHover: '#F1F3F9',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#617088',
  border: 'rgba(0, 0, 0, 0.08)',
  borderSubtle: 'rgba(0, 0, 0, 0.04)',
  borderGold: 'rgba(201, 151, 46, 0.45)',
  gold: '#B8860B',
  goldMuted: 'rgba(184, 134, 11, 0.12)',
  red: '#EF4F5F',
  redMuted: 'rgba(239, 79, 95, 0.1)',
  inputBg: '#F1F4F8',
  inputBorder: 'rgba(0, 0, 0, 0.1)',
  tabBarBg: '#FFFFFF',
  tabBarBorder: 'rgba(0, 0, 0, 0.06)',
  glassBg: 'rgba(255, 255, 255, 0.92)',
  shadowColor: '#000000',
  isDark: false,
};

export const DARK_THEME = {
  bg: '#09090B',
  bgSubtle: '#121215',
  card: '#18181B',
  cardSecondary: '#222226',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  cardHover: '#27272A',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textMuted: '#8B8B93',
  border: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(255, 255, 255, 0.04)',
  borderGold: 'rgba(212, 175, 122, 0.4)',
  gold: '#D4AF7A',
  goldMuted: 'rgba(212, 175, 122, 0.15)',
  red: '#EF4F5F',
  redMuted: 'rgba(239, 79, 95, 0.15)',
  inputBg: 'rgba(255, 255, 255, 0.05)',
  inputBorder: 'rgba(255, 255, 255, 0.12)',
  tabBarBg: '#0D0D10',
  tabBarBorder: 'rgba(255, 255, 255, 0.08)',
  glassBg: 'rgba(24, 24, 27, 0.92)',
  shadowColor: '#000000',
  isDark: true,
};

/**
 * Light mode only: cards, tiles, pills and bars separate from the off-white page with a realistic,
 * layered shadow (a tight contact shadow plus a soft ambient one), not with outlines. `surfaceLift`
 * also makes the light-mode border transparent (the width stays, so nothing moves). Dark mode keeps
 * its own look: both helpers return nothing there.
 */
export const LIGHT_SURFACE: any = Platform.select({
  web: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.06), 0px 6px 16px rgba(0, 0, 0, 0.08)' },
  default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
});
/** Same recipe, a step smaller, for chips and small pills. */
export const LIGHT_SURFACE_SM: any = Platform.select({
  web: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.06), 0px 3px 10px rgba(0, 0, 0, 0.07)' },
  default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
});
/** Light-mode card edge: none (the shadow does the job). */
export const LIGHT_HAIRLINE = 'transparent';
/** Shadow plus a transparent border, light mode only. */
export const surfaceLift = (isDark: boolean, small = false): any =>
  (isDark ? null : { ...(small ? LIGHT_SURFACE_SM : LIGHT_SURFACE), borderColor: 'transparent' });
/** Shadow only (keeps the element's own accent border, e.g. a ring or an active state). */
export const surfaceShadow = (isDark: boolean, small = false): any => (isDark ? null : small ? LIGHT_SURFACE_SM : LIGHT_SURFACE);

export const getThemeColors = (isDark: boolean) => (isDark ? DARK_THEME : LIGHT_THEME);

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
  card: 20,
  hero: 30,
} as const;

export const FONTS = {
  thin: '300' as const,
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  black: '900' as const,
};

/**
 * Typography scale (22 Oct): lighter, more refined weights. Same system font and colours.
 * title 700 · heading 600 · label 600 · body 400/500 · button 600 · price 700.
 * Rule for older styles: weight 900 reads as 700 and 800 as 600 (TYPE_WEIGHT below).
 */
export const TYPE = {
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: 0.1 },
  heading: { fontSize: 15, fontWeight: '600' as const, letterSpacing: 0.1 },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.2 },
  body: { fontSize: 13, fontWeight: '400' as const },
  bodyMedium: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  chip: { fontSize: 12, fontWeight: '500' as const },
  button: { fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.2 },
  price: { fontSize: 15, fontWeight: '700' as const },
} as const;
export const TYPE_WEIGHT = { black: '700' as const, extrabold: '600' as const };
/** Buttons: about 44 high, radius close to the cards'. */
export const BUTTON = { height: 44, radius: 14, paddingHorizontal: 16 } as const;

export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHover: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  goldGlow: {
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  redGlow: {
    shadowColor: COLORS.red,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  cardElevated: {
    shadowColor: '#14131F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
  },
};
