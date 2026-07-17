// ── Zenvy Design System ──────────────────────────────────────────────────────
// Extracted from the live website. Every token matches the production portal.

export const COLORS = {
  // Core Backgrounds
  bgDark: '#0A0A0B',
  bgCard: '#1A1A1C',
  bgCardHover: '#222224',
  bgLight: '#F8F9FA',
  bgLightCard: '#FFFFFF',

  // Primary Accents
  gold: '#C9A84C',
  goldLight: '#E4C875',
  goldMuted: 'rgba(201, 168, 76, 0.15)',
  goldBorder: 'rgba(201, 168, 76, 0.4)',
  red: '#EF4F5F',
  redDark: '#D43F4F',

  // Status Colors
  greenRating: '#24963F',
  blueOffer: '#256FEF',
  emerald: '#10B981',
  amber: '#F59E0B',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textDark: '#111827',
  textDarkSecondary: '#4B5563',

  // Borders
  borderDark: 'rgba(255, 255, 255, 0.05)',
  borderLight: 'rgba(0, 0, 0, 0.08)',
  borderGold: 'rgba(201, 168, 76, 0.3)',

  // Overlays
  overlayDark: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(255, 255, 255, 0.95)',
} as const;

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
};
