/**
 * Zenvy Friends — "Night Campus" design system.
 *
 * Friends is always dark: it is the social, after-hours side of Campus Buddy (like Threads / Discord),
 * while the rest of Campus Buddy and Community stay on the warm "paper" palette. The switch is
 * intentional and handled by the shell chrome (header + bottom nav turn dark with the Friends tab).
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
  bg: '#0C0B10',
  /** Raised surface (cards, list cells). */
  card: '#16141C',
  /** Second-level surface (inputs, chips, pressed rows, skeletons). */
  cardHi: '#201D29',
  /** Overlay surface (sheets, menus, dialogs). */
  overlaySurface: '#1A1822',
  /** Hairlines. */
  line: '#2A2734',
  lineSoft: '#1F1C27',
  lineStrong: '#3A3647',

  // ── Text ──────────────────────────────────────────────────────────────────
  ink: '#F5F2EC',
  muted: '#ABA5BA',
  /** Tertiary text — lifted from #6F6A7C (3.6:1, failed AA) to 5.4:1. */
  faint: '#8E889C',

  // ── Brand ─────────────────────────────────────────────────────────────────
  /** The one accent (text, icons, fills with accentInk on top). */
  accent: '#C8B6FF',
  /** Deeper end of the brand gradient (fills only, never small text on bg). */
  accentStrong: '#9F7EFF',
  accentInk: '#150F2B',
  accentSoft: 'rgba(200,182,255,0.13)',
  accentLine: 'rgba(200,182,255,0.30)',
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

  overlay: 'rgba(4,3,8,0.72)',
  /** Anonymous identities. */
  mask: '#2A2740',
};

/** Per-section accent tints (used subtly: tab indicator, header dot, chips, icons). */
export const SectionTints: Record<FriendsSubTab, { fg: string; soft: string; line: string; gradient: readonly [string, string] }> = {
  pulse: { fg: '#C8B6FF', soft: 'rgba(200,182,255,0.13)', line: 'rgba(200,182,255,0.30)', gradient: ['#DCCFFF', '#A584FF'] },
  spaces: { fg: '#7FDEC4', soft: 'rgba(127,222,196,0.12)', line: 'rgba(127,222,196,0.28)', gradient: ['#A8F0DA', '#4FC6A6'] },
  forum: { fg: '#9DB4FF', soft: 'rgba(157,180,255,0.13)', line: 'rgba(157,180,255,0.30)', gradient: ['#C3D1FF', '#7393FF'] },
  tasks: { fg: '#F2C07E', soft: 'rgba(242,192,126,0.12)', line: 'rgba(242,192,126,0.28)', gradient: ['#F8D9A8', '#E9A35A'] },
  connect: { fg: '#F5A8C4', soft: 'rgba(245,168,196,0.12)', line: 'rgba(245,168,196,0.28)', gradient: ['#FBC9DB', '#E97BA4'] },
};

/** Gradients (expo-linear-gradient colour stops). */
export const FriendsGradients = {
  /** Primary buttons, active indicators, FABs. */
  brand: ['#DDD1FF', '#C8B6FF', '#A98BFF'] as const,
  /** Avatar rings for live / highlighted people (gold → lavender → violet). */
  ring: ['#F2D49B', '#C8B6FF', '#8F6BFF'] as const,
  /** Verified-only gold. */
  gold: ['#F6DDA6', '#D9A955'] as const,
  /** Soft top glow on cards (draw at the top edge, ~48px tall). */
  cardGlow: ['rgba(255,255,255,0.045)', 'rgba(255,255,255,0)'] as const,
  /** Header wash under the sub-tab bar / stack headers. */
  header: ['#141220', '#0C0B10'] as const,
  /** Bottom scrim over images. */
  scrim: ['rgba(12,11,16,0)', 'rgba(12,11,16,0.85)'] as const,
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
    ios: { shadowColor: '#A98BFF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14 },
    default: { elevation: 6 },
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
