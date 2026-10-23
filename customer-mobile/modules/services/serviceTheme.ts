/**
 * Look of the campus services screens (category page, booking flow, booking tracking).
 * One accent per service family: repairs purple, tailoring green, print teal, laundry blue.
 * Light-first: white cards with a soft shadow on a light grey page; dark mode keeps the layout
 * with dark surfaces and the same accent.
 */
import { useMemo } from 'react';
import { Platform, type ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { ACCENTS as OTHERS_ACCENTS, SURFACE, STATUS, shadow as othersShadow } from '../others/othersTheme';

export type ServiceFamily = 'repairs' | 'tailoring' | 'print' | 'laundry' | 'general';

interface Accent {
  /** Buttons, selected borders, links (light mode). */
  base: string;
  /** Hero gradient, darker end. */
  deep: string;
  /** Accent text / icons on dark surfaces. */
  onDark: string;
  /** Selected chip / icon tile background (light). */
  tint: string;
}

// Accents come from the Others tokens (modules/others/othersTheme.ts).
const fromTokens = (k: 'repairs' | 'tailoring' | 'print' | 'laundry' | 'services'): Accent => {
  const t = OTHERS_ACCENTS[k];
  return { base: t.solid, deep: t.deep, onDark: t.ink.dark, tint: t.tint.light };
};
const ACCENTS: Record<ServiceFamily, Accent> = {
  repairs: fromTokens('repairs'),
  tailoring: fromTokens('tailoring'),
  print: fromTokens('print'),
  laundry: fromTokens('laundry'),
  general: fromTokens('services'),
};

export const familyOf = (shelfOrCategory: string | undefined | null): ServiceFamily => {
  const k = String(shelfOrCategory || '').toLowerCase();
  if (k === 'repairs' || k === 'tailoring' || k === 'print' || k === 'laundry') return k;
  return 'general';
};

/** Family from a booking's serviceType when the shelf is not stored on it. */
export const familyOfBooking = (b: any): ServiceFamily => {
  const spec = b && typeof b.specifications === 'object' && b.specifications ? b.specifications : {};
  const fromShelf = familyOf(spec.category);
  if (fromShelf !== 'general') return fromShelf;
  const t = String(b?.serviceType || '');
  if (/REPAIR/.test(t)) return 'repairs';
  if (t === 'TAILORING') return 'tailoring';
  if (t === 'PRINTOUT') return 'print';
  if (t === 'LAUNDRY') return 'laundry';
  return 'general';
};

export const SERVICE_FAMILY_META: Record<Exclude<ServiceFamily, 'general'>, { title: string; short: string; sub: string; icon: string }> = {
  repairs: { title: 'Laptop & phone repair', short: 'Tech & repairs', sub: 'Laptops, phones', icon: 'laptop-outline' },
  tailoring: { title: 'Tailoring & stitching', short: 'Tailoring', sub: 'Alter and stitch', icon: 'cut-outline' },
  print: { title: 'Print & binding', short: 'Print & xerox', sub: 'Prints, binding', icon: 'print-outline' },
  laundry: { title: 'Laundry & dry cleaning', short: 'Laundry', sub: 'Wash and iron', icon: 'shirt-outline' },
};

export interface ServicePalette {
  isDark: boolean;
  page: string;
  card: string;
  raised: string;
  field: string;
  text: string;
  sub: string;
  muted: string;
  line: string;
  /** Accent for text, icons and selected borders on the current surface. */
  accent: string;
  /** Solid button background (white text on it in both modes). */
  button: string;
  /** Selected chip / icon tile background. */
  tint: string;
  heroFrom: string;
  heroTo: string;
  error: string;
  success: string;
  warn: string;
  warnBg: string;
  shadow: ViewStyle;
}

export const useServicePalette = (family: ServiceFamily): ServicePalette => {
  const { isDark, colors } = useTheme();
  return useMemo(() => {
    const a = ACCENTS[family];
    const sf = isDark ? SURFACE.dark : SURFACE.light;
    const stt = isDark ? STATUS.dark : STATUS.light;
    const shadow: ViewStyle = othersShadow(isDark);
    return {
      isDark,
      page: sf.page,
      card: sf.card,
      raised: sf.raised,
      field: sf.field,
      text: colors.text,
      sub: colors.textSecondary,
      muted: colors.textMuted,
      line: sf.line,
      accent: isDark ? a.onDark : a.base,
      button: a.base,
      tint: isDark ? hexAlpha(a.onDark, 0.15) : a.tint,
      heroFrom: a.deep,
      heroTo: a.base,
      error: stt.error,
      success: stt.success,
      warn: stt.warn,
      warnBg: stt.warnTint,
      shadow,
    };
  }, [family, isDark, colors]);
};

/** "#RRGGBB" + alpha -> rgba(). */
export const hexAlpha = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};
