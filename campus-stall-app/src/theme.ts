// Kitchen-first design tokens: light, high contrast, big type, big touch targets.
import type { TextStyle } from 'react-native';

export const color = {
  bg: '#F3F4F6', surface: '#FFFFFF', surfaceAlt: '#ECEEF2', border: '#D5D9E0',
  text: '#0B0D12', textSecondary: '#374151', textMuted: '#5B6472', textInverse: '#FFFFFF',
  open: '#0E9F5B', openDark: '#08743F', openTint: '#E2F6EB',
  closed: '#4B5563', closedTint: '#E5E7EB',
  alert: '#D7263D', alertDark: '#9F1427', alertTint: '#FDECEE',
  primary: '#0B0D12',
  brand: '#C9A84C', brandTint: '#FBF5E6',
  cash: '#A64B00', cashTint: '#FFF2DE', cashBorder: '#F2BE74',
  prepaid: '#08743F', prepaidTint: '#E2F6EB',
  warning: '#9A4A00', warningTint: '#FFF5E3',
  info: '#1D4ED8', infoTint: '#E7EDFD',
  veg: '#0E9F5B', nonVeg: '#B91C1C',
} as const;

export const font = {
  orderId: { fontSize: 22, lineHeight: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  money: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  item: { fontSize: 18, lineHeight: 25, fontWeight: '700' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '800', letterSpacing: 0.4 },
  button: { fontSize: 18, lineHeight: 22, fontWeight: '800' },
} satisfies Record<string, TextStyle>;

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const touch = { primary: 64, secondary: 52, icon: 48, min: 48 } as const;
export const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
} as const;
export const mono = { fontFamily: 'monospace' } as const;
