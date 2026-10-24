// ZCS PG Partner design tokens: calm indigo / violet on a soft lavender canvas (the reference "Owner Dashboard"),
// navy text, white cards with hairline borders, one accent colour. Light only (userInterfaceStyle light).
import type { TextStyle } from 'react-native';

export const color = {
  bg: '#F6F5FD', surface: '#FFFFFF', surfaceAlt: '#EFEDFB', border: '#E3E0F5', borderStrong: '#CFCAEE',
  text: '#1B1846', textSecondary: '#3F3B6B', textMuted: '#6E6A93', textInverse: '#FFFFFF',
  primary: '#4F46E5', primaryDark: '#3730A3', primaryTint: '#EEF0FF', primarySoft: '#E0E2FF',
  violet: '#7C3AED', violetTint: '#F3EEFF',
  ok: '#0F8A5F', okTint: '#E3F6EE',
  warn: '#A15C07', warnTint: '#FFF4E0',
  alert: '#D23153', alertDark: '#A01D3D', alertTint: '#FDECF0',
  info: '#2563EB', infoTint: '#E8EFFE',
  veg: '#138A36', nonveg: '#B42318', egg: '#B7791F',
  gold: '#C9A84C',
} as const;

export const font = {
  big: { fontSize: 30, lineHeight: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600', letterSpacing: 0.1 },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  num: { fontSize: 22, lineHeight: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const touch = { primary: 52, secondary: 44, icon: 44, min: 44 } as const;
export const shadow = {
  card: { shadowColor: '#1B1846', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
} as const;
