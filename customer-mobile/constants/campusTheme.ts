/**
 * Campus Buddy Design System — Exact Tokens (Section 1)
 * Scoped strictly to Campus Buddy screens.
 */

import { Platform } from 'react-native';
import { fixedDietTokens, mixHex } from '../utils/themeNow';

const CAMPUS_BASE = {
  // Light Theme (Default)
  paper: '#F4F1EA',
  card: '#FFFFFF',
  ink: '#1B1A17',
  muted: '#5E5A52',
  line: '#E3DED3',
  chipBorder: '#D6D0C4',
  placeholderFill: '#E9E4D8',
  accent: '#2F5BEA',
  accentDeep: '#1E3FB0',
  accentSoft: '#E4EAFD',
  accentText: '#2F5BEA',
  warm: '#B4561A',
  warmDeep: '#8A3F10',
  warmSoft: '#F8E6D6',
  rose: '#B03A5B',
  roseDeep: '#7A1F3A',
  roseSoft: '#F5DCE3',
  violet: '#7A3FD1',
  sos: '#A3321A',
  successBg: '#2A3A2A',
  successText: '#B7E4B7',

  // Dark Surfaces (always dark even on light mode)
  inkCard: '#1B1A17',
  inkBorder: '#4A463F',
  inkTrack: '#3A3730',
  inkMuted: '#C9C3B6',
  accentOnDark: '#9DB4FF',
  amberOnDark: '#F2B27E',
  roseOnDark: '#F5B8CA',
  secretBg: '#121110',
  secretCard: '#1E1C19',
  secretBubble: '#24211D',
  secretLine: '#2A2824',
  secretMuted: '#B8B2A5',
  nightBg: '#14131F',
  nightCard: '#211F30',
  nightLine: '#3A3650',
  nightFill: '#2A2740',
  lavender: '#C8B6FF',
  nightMuted: '#B9B4CC',
};

/**
 * Owner, 10 Nov 2026: one look everywhere. Campus (always drawn light) wears the diet look: the light red (Non-veg) or
 * light green (Veg) page and the diet accent replace the old paper + royal blue. Warm / rose / violet stay as the
 * section's meaning tints; ink, lines and the dark "night" / "secret" surfaces are unchanged. Read at render.
 */
export const CampusColors: typeof CAMPUS_BASE = fixedDietTokens(false, (d) => ({
  ...CAMPUS_BASE,
  paper: d.pageDeep,
  line: d.line,
  placeholderFill: mixHex(d.pageDeep, d.un, 0.4),
  accent: d.acc,
  accentDeep: d.accDeep,
  accentSoft: d.soft,
  accentText: d.acc,
  accentOnDark: mixHex(d.acc, '#FFFFFF', 0.55),
}));

export const CampusDarkColors = {
  // Full Dark Mode Mapping
  paper: '#121110',
  card: '#1E1C19',
  ink: '#F4F1EA',
  muted: '#B8B2A5',
  line: '#2A2824',
  chipBorder: '#3A3730',
  placeholderFill: '#24211D',
  accent: '#2F5BEA',
  accentDeep: '#9DB4FF',
  accentSoft: '#1A2342',
  accentText: '#9DB4FF',
  warm: '#D6712F',
  warmDeep: '#F2B27E',
  warmSoft: '#332014',
  rose: '#D45076',
  roseDeep: '#F5B8CA',
  roseSoft: '#351620',
  violet: '#9D6BF0',
  sos: '#C93F22',
  successBg: '#1A291A',
  successText: '#B7E4B7',

  // Dark Surfaces
  inkCard: '#1B1A17',
  inkBorder: '#4A463F',
  inkTrack: '#3A3730',
  inkMuted: '#C9C3B6',
  accentOnDark: '#9DB4FF',
  amberOnDark: '#F2B27E',
  roseOnDark: '#F5B8CA',
  secretBg: '#121110',
  secretCard: '#1E1C19',
  secretBubble: '#24211D',
  secretLine: '#2A2824',
  secretMuted: '#B8B2A5',
  nightBg: '#14131F',
  nightCard: '#211F30',
  nightLine: '#3A3650',
  nightFill: '#2A2740',
  lavender: '#C8B6FF',
  nightMuted: '#B9B4CC',
};

export type CampusThemeColors = typeof CampusColors;

export const CampusTypography = {
  displayFamily: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'Georgia, serif',
  }),
  bodyFamily: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'system-ui, sans-serif',
  }),
  displayLarge: {
    fontSize: 34,
    fontWeight: '800' as const,
    letterSpacing: -0.68, // -0.02em
  },
  displayMedium: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.56,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 21,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20,
  },
  secondary: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.6, // 0.05em tracking
    textTransform: 'uppercase' as const,
  },
  bigNumber: {
    fontSize: 48,
    fontWeight: '800' as const,
  },
};

export const CampusLayout = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    roundedSquare: 13,
    card: 18,
    hero: 26,
    pill: 999,
  },
  touchTargetMin: 44,
  primaryCtaHeight: 52,
};
