/**
 * Zenvy Friends design tokens.
 *
 * Friends uses the main app's dark palette (constants/theme DARK_THEME: near-black neutrals with the
 * Zenvy gold accent), so it reads as part of the app rather than a separate purple product. Surfaces
 * are flat: gradient stops below are single colours and cards have no glow (21 Oct polish pass).
 *
 * Layers   base (bg) → raised (card) → raisedHi (cardHi, inputs/chips) → overlay (sheets/menus)
 * Text     ink (primary, 17:1) → muted (secondary, 8:1) → faint (tertiary, 5.4:1) — all WCAG AA on bg & card
 * Brand    one lavender→violet accent (Zenvy violet, matches COLORS.primary) with dark ink on fills;
 *          gold is reserved for verified / top-rated marks.
 * Sections each sub-tab has a subtle tint (headers, chips, icons, indicator) — see SectionTints.
 */
import { Platform, StyleSheet } from 'react-native';
import { CampusLayout } from '../../../constants/campusTheme';
import type { FriendsSubTab } from '../../../types/campus';

export const FriendsColors = {
  // ── Layers ────────────────────────────────────────────────────────────────
  /** Screen background (base layer). */
  bg: '#09090B',
  /** Raised surface (cards, list cells). */
  card: '#18181B',
  /** Second-level surface (inputs, chips, pressed rows, skeletons). */
  cardHi: '#222226',
  /** Overlay surface (sheets, menus, dialogs). */
  overlaySurface: '#1C1C1F',
  /** Hairlines. */
  line: '#2A2A2E',
  lineSoft: '#1F1F23',
  lineStrong: '#3A3A40',

  // ── Text ──────────────────────────────────────────────────────────────────
  ink: '#F4F4F5',
  muted: '#A1A1AA',
  /** Tertiary text — lifted from #6F6A7C (3.6:1, failed AA) to 5.4:1. */
  faint: '#8B8B93',

  // ── Brand ─────────────────────────────────────────────────────────────────
  /** The one accent (text, icons, fills with accentInk on top). */
  accent: '#D4AF7A',
  /** Deeper end of the brand gradient (fills only, never small text on bg). */
  accentStrong: '#C9A84C',
  accentInk: '#1A1407',
  accentSoft: 'rgba(212,175,122,0.13)',
  accentLine: 'rgba(212,175,122,0.30)',
  /** Verified / top-rated only. */
  gold: '#E8C47F',
  goldSoft: 'rgba(232,196,127,0.14)',

  // ── Semantic ──────────────────────────────────────────────────────────────
  success: '#8FDCA6',
  successSoft: 'rgba(143,220,166,0.12)',
  warn: '#F2B27E',
  warnSoft: 'rgba(242,178,126,0.10)',
  warnLine: 'rgba(242,178,126,0.26)',
  danger: '#F38B80',
  dangerSoft: 'rgba(243,139,128,0.12)',
  info: '#9DB4FF',
  infoSoft: 'rgba(157,180,255,0.13)',

  overlay: 'rgba(0,0,0,0.72)',
  /** Anonymous identities. */
  mask: '#27272A',
};

/** Per-section accent tints (used subtly: tab indicator, header dot, chips, icons). */
export const SectionTints: Record<FriendsSubTab, { fg: string; soft: string; line: string; gradient: readonly [string, string] }> = {
  pulse: { fg: '#D4AF7A', soft: 'rgba(212,175,122,0.13)', line: 'rgba(212,175,122,0.30)', gradient: ['#D4AF7A', '#D4AF7A'] },
  spaces: { fg: '#7FDEC4', soft: 'rgba(127,222,196,0.12)', line: 'rgba(127,222,196,0.28)', gradient: ['#7FDEC4', '#7FDEC4'] },
  forum: { fg: '#9DB4FF', soft: 'rgba(157,180,255,0.13)', line: 'rgba(157,180,255,0.30)', gradient: ['#9DB4FF', '#9DB4FF'] },
  tasks: { fg: '#F2C07E', soft: 'rgba(242,192,126,0.12)', line: 'rgba(242,192,126,0.28)', gradient: ['#F2C07E', '#F2C07E'] },
  connect: { fg: '#F5A8C4', soft: 'rgba(245,168,196,0.12)', line: 'rgba(245,168,196,0.28)', gradient: ['#F5A8C4', '#F5A8C4'] },
};

/** Gradients (expo-linear-gradient colour stops). */
export const FriendsGradients = {
  /** Primary buttons, active indicators, FABs. */
  brand: ['#D4AF7A', '#D4AF7A', '#D4AF7A'] as const,
  /** Avatar rings for live / highlighted people (gold → lavender → violet). */
  ring: ['#D4AF7A', '#D4AF7A', '#D4AF7A'] as const,
  /** Verified-only gold. */
  gold: ['#E8C47F', '#E8C47F'] as const,
  /** Soft top glow on cards (draw at the top edge, ~48px tall). */
  cardGlow: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)'] as const,
  /** Header wash under the sub-tab bar / stack headers. */
  header: ['#09090B', '#09090B'] as const,
  /** Bottom scrim over images. */
  scrim: ['rgba(9,9,11,0)', 'rgba(9,9,11,0.85)'] as const,
};

export const FS = CampusLayout.spacing;
export const FR = { ...CampusLayout.radius, sheet: 24, input: 14, chip: 999 };

/** Elevation: only for floating things (sheets, FABs, menus) — never on long-list cells (Android cost). */
export const FElevation = {
  floating: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.45, shadowRadius: 22 },
    default: { elevation: 10 },
  }),
  raised: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
    default: { elevation: 3 },
  }),
  accentGlow: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
    default: { elevation: 3 },
  }),
};

/** Motion (ms). Respect reduce-motion via useReduceMotion() in shared/FriendsUi. */
export const FMotion = { fast: 140, base: 220, slow: 360 };

/** Type scale. */
export const FT = StyleSheet.create({
  display: { fontSize: 28, fontWeight: '800', color: FriendsColors.ink, letterSpacing: -0.6 },
  h1: { fontSize: 22, fontWeight: '800', color: FriendsColors.ink, letterSpacing: -0.4 },
  h2: { fontSize: 17, fontWeight: '700', color: FriendsColors.ink, letterSpacing: -0.2 },
  h3: { fontSize: 15, fontWeight: '700', color: FriendsColors.ink, letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, color: FriendsColors.ink },
  muted: { fontSize: 13, lineHeight: 19, color: FriendsColors.muted },
  small: { fontSize: 12, lineHeight: 16, color: FriendsColors.muted },
  caption: { fontSize: 12, lineHeight: 14, color: FriendsColors.faint, fontWeight: '600' },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 0.9, color: FriendsColors.faint, textTransform: 'uppercase' },
});

export const fui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: FriendsColors.bg },
  card: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FriendsColors.line,
    overflow: 'hidden',
  },
  cardPad: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FriendsColors.line,
    padding: FS.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    paddingHorizontal: FS.lg,
    paddingVertical: FS.md,
    minHeight: CampusLayout.touchTargetMin + 8,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: FriendsColors.lineSoft,
  },
  input: {
    backgroundColor: FriendsColors.cardHi,
    borderRadius: FR.input,
    borderWidth: 1,
    borderColor: FriendsColors.line,
    color: FriendsColors.ink,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 46,
    fontSize: 15,
  },
  pill: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: FR.pill,
    borderWidth: 1,
    borderColor: FriendsColors.line,
    backgroundColor: FriendsColors.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  pillActive: { backgroundColor: FriendsColors.accent, borderColor: FriendsColors.accent },
  pillText: { fontSize: 13, fontWeight: '700', color: FriendsColors.muted, letterSpacing: 0.1 },
  pillTextActive: { color: FriendsColors.accentInk },
  primaryBtn: {
    minHeight: 48,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: FriendsColors.accentInk, letterSpacing: 0.1 },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.accentSoft,
    borderWidth: 1,
    borderColor: FriendsColors.accentLine,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '800', color: FriendsColors.accent },
  ghostBtn: {
    minHeight: 44,
    borderRadius: FR.pill,
    borderWidth: 1,
    borderColor: FriendsColors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
  },
  ghostBtnText: { fontSize: 14, fontWeight: '700', color: FriendsColors.ink },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: FriendsColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accentInk },
});

/** Header / bottom-nav colours for the dark tone (Campus hub chrome while Friends is open). */
export const FriendsChrome = {
  bg: FriendsColors.bg,
  surface: FriendsColors.card,
  line: FriendsColors.line,
  ink: FriendsColors.ink,
  muted: FriendsColors.muted,
  accent: FriendsColors.accent,
  accentSoft: FriendsColors.accentSoft,
  accentInk: FriendsColors.accentInk,
};
