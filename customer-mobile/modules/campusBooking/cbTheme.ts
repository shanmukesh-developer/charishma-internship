/**
 * In-Campus Booking look = the app's CURRENT look (owner, 27 Oct): the same colours, type and cards as the Home stall
 * section (components/CampusBitesSection), the store page (app/restaurant/[id]), checkout (app/checkout) and order
 * tracking (app/tracking/[id]). Nothing new is invented here: every token maps to constants/theme.
 */
import { useTheme } from '../../context/ThemeContext';
import { useDietLight } from '../../components/local/dietLightTheme';
import { COLORS, SHADOWS, TYPE, surfaceLift } from '../../constants/theme';

export { COLORS, SHADOWS, TYPE, surfaceLift };

export interface CbPalette {
  isDark: boolean;
  /** Page background (Home / store page). */
  page: string;
  card: string;
  border: string;
  txt: string;
  txtSec: string;
  muted: string;
  /** The one action accent: the app red in light, gold in dark (CampusBitesSection). */
  accent: string;
  accentSoft: string;
  /** Open / closed text (CampusBitesSection). */
  openInk: string;
  closedInk: string;
  chipBg: string;
  /** Progress dots and the PIN card (tracking). */
  gold: string;
  amber: string;
  amberSoft: string;
  red: string;
  redSoft: string;
  veg: string;
  nonVeg: string;
}

export function useCbTheme(): CbPalette {
  const { isDark } = useTheme();
  // Owner, 10 Nov 2026: booking screens follow the diet picked on Home (light page, one accent).
  const d = useDietLight();
  return {
    isDark,
    page: d.page,
    card: d.card,
    border: isDark ? d.edge : COLORS.borderLight,
    txt: isDark ? COLORS.textPrimary : COLORS.textDark,
    txtSec: isDark ? COLORS.textSecondary : COLORS.textDarkSecondary,
    muted: COLORS.textMuted,
    accent: d.acc,
    accentSoft: d.soft,
    openInk: d.acc,
    closedInk: d.muteInk,
    chipBg: isDark ? 'rgba(255,255,255,0.05)' : '#F4F4F5',
    gold: COLORS.gold,
    amber: isDark ? '#F5C451' : '#B45309',
    amberSoft: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)',
    red: isDark ? '#F2777F' : '#C0392B',
    redSoft: isDark ? 'rgba(239,79,95,0.10)' : 'rgba(239,79,95,0.06)',
    veg: '#1E8E3E',
    nonVeg: '#C0392B',
  };
}

/** Rupees: "₹80", "₹22.50" (same as utils/format formatINR for whole rupees). */
export const inr = (n: number | null | undefined): string => {
  const v = Number(n) || 0;
  return `₹${Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** "2:15 PM" in IST. */
export const timeIST = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** "Today, 2:15 PM" / "26 Oct, 2:15 PM" (IST). */
export const whenIST = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dayKey = (x: Date) => new Date(x.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const k = dayKey(d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = k === dayKey(new Date()) ? 'Today' : `${Number(k.slice(8, 10))} ${months[Number(k.slice(5, 7)) - 1]}`;
  return `${label}, ${timeIST(iso)}`;
};

/** "13:30" -> "1:30 PM". */
export const hhmm12 = (v?: string | null): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * Home feature card photo (licensed, Unsplash License, free): "Collect your order here" pickup counter, Canacona,
 * Goa, by Hardik P (unsplash.com/photos/paYqROtx9Is). components/SafeImage asks the CDN for 3x the drawn width.
 */
export const CB_COUNTER_PHOTO = 'https://images.unsplash.com/photo-1769766319375-1c384e4355d6';
