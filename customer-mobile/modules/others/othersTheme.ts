/**
 * Others design tokens: one place for every Others section's accent and tints (light and dark), the
 * type scale, spacing (4/8 grid: 16 gutters, 12 gaps), radii, icon sizes and shadows.
 * Section palettes (services, PG, Co-Ride, Zenvy Auto, Food, Deals) read their accents from here.
 */
import { useMemo } from 'react';
import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useDietary } from '../../context/DietaryContext';
import { dietFor, fixedDietTokens } from '../../utils/themeNow';

export type OthersSection =
  | 'food' | 'services' | 'repairs' | 'tailoring' | 'print' | 'laundry'
  | 'pg' | 'coride' | 'auto' | 'deals' | 'neutral';

export interface Accent {
  /** Solid fill for buttons, active pills and selected chips (white text on it in both themes). */
  solid: string;
  /** Darker end of hero gradients. */
  deep: string;
  /** Accent text / icons on light and dark surfaces. */
  ink: { light: string; dark: string };
  /** Soft background behind accent icons, selected chips and notes. */
  tint: { light: string; dark: string };
}

// Owner, 10 Nov 2026: one look everywhere. Every Others section (services, repairs, tailoring, print, laundry, PG,
// Co-Ride, Auto, Deals) wears the diet accent - red for Non-veg, green for Veg - instead of its old purple / blue.
// Food keeps its own green (the Groceries header); neutral stays slate. Read at render (the diet can change).
const dietAccent = (): Accent => {
  const l = dietFor(false);
  const d = dietFor(true);
  return { solid: l.acc, deep: l.accDeep, ink: { light: l.acc, dark: d.acc }, tint: { light: l.soft, dark: d.soft } };
};
export const ACCENTS: Record<OthersSection, Accent> = fixedDietTokens(false, (): Record<OthersSection, Accent> => {
  const a = dietAccent();
  return {
    food: { solid: '#1E8E3E', deep: '#146C2E', ink: { light: '#1E8E3E', dark: '#5CCB85' }, tint: { light: '#E7F4EA', dark: 'rgba(76,193,122,0.14)' } },
    services: a, repairs: a, tailoring: a, print: a, laundry: a, pg: a, coride: a, auto: a, deals: a,
    neutral: { solid: '#334155', deep: '#1E293B', ink: { light: '#334155', dark: '#CBD5E1' }, tint: { light: '#F1F3F6', dark: 'rgba(255,255,255,0.07)' } },
  };
});

/** Others section pill key -> its accent. Rentals and Events keep the app accent for now (undefined). */
export const PILL_ACCENT: Record<string, OthersSection | undefined> = {
  food: 'food', services: 'services', pg: 'pg', coride: 'coride', promos: 'deals',
};

// ── Scale ────────────────────────────────────────────────────────────────────

export const SPACE = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, gutter: 16, gap: 12 } as const;
export const RADIUS = { card: 16, sheet: 24, chip: 999, button: 12, tile: 12, input: 12, hero: 20 } as const;
export const ICON = { sm: 16, md: 20, lg: 24 } as const;
/** Minimum touch target. */
export const HIT = 44;

/** Type scale (sentence case everywhere; weights 400 / 600 / 700 / 800 only). */
export const TYPE = {
  display: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.3 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  subheading: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  price: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
} as const satisfies Record<string, TextStyle>;

/** Surfaces shared by every Others screen: light grey page, white cards (light); near-black page, raised cards (dark). */
export const SURFACE = {
  light: { page: '#F4F5F7', card: '#FFFFFF', raised: '#F3F5F8', field: '#F6F7F9', line: 'rgba(15,23,42,0.08)', hairline: 'rgba(15,23,42,0.06)' },
  // Dark matches the Others hub (app bg #09090B, hub cards #1D1D20).
  dark: { page: '#09090B', card: '#1D1D20', raised: '#26262B', field: '#26262B', line: 'rgba(255,255,255,0.09)', hairline: 'rgba(255,255,255,0.07)' },
} as const;

export const STATUS = {
  light: { error: '#B91C1C', errorTint: '#FEECEC', success: '#047857', successTint: '#E8F6EF', warn: '#B45309', warnTint: '#FDF4E3' },
  dark: { error: '#F87171', errorTint: 'rgba(248,113,113,0.14)', success: '#34D399', successTint: 'rgba(16,185,129,0.14)', warn: '#FBBF24', warnTint: 'rgba(245,158,11,0.14)' },
} as const;

/** Soft card shadow (light) or hairline (dark). level 2 = floating bars and sheets. */
export const shadow = (isDark: boolean, level: 1 | 2 = 1): ViewStyle => {
  if (isDark) return { borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' };
  const y = level === 2 ? 8 : 4;
  const r = level === 2 ? 20 : 12;
  const o = level === 2 ? 0.1 : 0.07;
  return Platform.select<ViewStyle>({
    web: { boxShadow: `0 1px 2px rgba(15,23,42,0.05), 0 ${y}px ${r + 2}px rgba(15,23,42,${o - 0.01})` } as any,
    default: { shadowColor: '#0F172A', shadowOpacity: o, shadowRadius: r, shadowOffset: { width: 0, height: y }, elevation: level === 2 ? 6 : 2 },
  }) as ViewStyle;
};

/** Coloured glow under an active accent element (pills, primary buttons). */
export const accentGlow = (color: string, isDark: boolean): ViewStyle => (isDark ? {} : Platform.select<ViewStyle>({
  web: { boxShadow: `0px 2px 8px ${color}47` } as any,
  default: { shadowColor: color, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
}) as ViewStyle);

/** "#RRGGBB" + alpha -> rgba(). */
export const hexAlpha = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** Resolved colours for one section in the current theme. */
export const useOthersTheme = (section: OthersSection = 'neutral') => {
  const { isDark, colors } = useTheme();
  const { dietMode } = useDietary();
  return useMemo(() => {
    const a = ACCENTS[section];
    const sf = isDark ? SURFACE.dark : SURFACE.light;
    const stt = isDark ? STATUS.dark : STATUS.light;
    return {
      isDark,
      section,
      accent: isDark ? a.ink.dark : a.ink.light,
      solid: a.solid,
      deep: a.deep,
      tint: isDark ? a.tint.dark : a.tint.light,
      ...sf,
      ...stt,
      text: colors.text,
      sub: colors.textSecondary,
      muted: colors.textMuted,
      shadow: shadow(isDark),
      shadowHigh: shadow(isDark, 2),
    };
  }, [section, isDark, colors, dietMode]);
};
export type OthersTheme = ReturnType<typeof useOthersTheme>;
