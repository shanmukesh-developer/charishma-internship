/**
 * PG v2 tokens (owner reference board, 24 Oct 2026). Colours sampled from the board with PIL:
 * indigo / violet primary, lavender tints, white cards with soft shadows, 16–20 radius, light weights.
 * Light theme only for now (the app's default); dark mode comes after the owner's OK.
 */
import { Platform, type ViewStyle } from 'react-native';

export const PG2 = {
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
} as const;

export const R = { sm: 10, md: 14, lg: 16, xl: 20, pill: 999 } as const;
export const GUTTER = 16;

/** Weights stay light: titles 600, labels 500, body 400 (never bold, never ALL CAPS). */
export const W = { title: '600', label: '500', body: '400' } as const;

export const shadow = (level: 1 | 2 = 1): ViewStyle => Platform.select({
  web: { boxShadow: level === 1 ? '0 4px 16px rgba(40,32,110,0.06)' : '0 10px 28px rgba(40,32,110,0.10)' } as ViewStyle,
  default: {
    shadowColor: '#28206E',
    shadowOpacity: level === 1 ? 0.07 : 0.12,
    shadowRadius: level === 1 ? 12 : 20,
    shadowOffset: { width: 0, height: level === 1 ? 4 : 8 },
    elevation: level === 1 ? 2 : 5,
  },
}) as ViewStyle;

export type GenderKey = 'Boys' | 'Girls' | 'Co-ed';
export const genderTone = (g: GenderKey) => (g === 'Boys' ? PG2.boys : g === 'Girls' ? PG2.girls : PG2.coed);
