import { StyleSheet } from 'react-native';

/**
 * The app's current light/dark choice, readable outside React (owner, 4 Nov 2026: "dark theme errors").
 * ThemeContext writes it on every render, so it is always the value the screens are drawing with.
 *
 * The PG stays and Co-Ride sections were built light-only: their colour tokens (PG2, CR) and their
 * module-level StyleSheets were fixed at import time, so in dark mode they stayed white. Now their tokens
 * read the palette for the current theme, and their sheets are made with themedSheet() below, which
 * builds one sheet per theme on first use and returns the one that matches the theme right now.
 */
let darkNow = false;

export function setThemeNow(isDark: boolean) {
  darkNow = isDark;
}

export function isDarkNow(): boolean {
  return darkNow;
}

/**
 * The Veg / Non-veg choice made on Home, readable outside React (owner, 10 Nov 2026: every Services section wears the
 * app's one diet look - light red band for Non-veg, light green for Veg, white cards, one accent).
 * DietaryContext writes it on every render, the same way ThemeContext writes darkNow.
 */
let vegNow = false;

export function setDietNow(veg: boolean) {
  vegNow = veg;
}

export function isVegNow(): boolean {
  return vegNow;
}

/** The diet tokens (the same values as components/local/dietLightTheme.ts useDietLight(), plus two derived accent
 * shades), so module-level palettes can follow the diet without a hook. Keep the two in step. */
export interface DietTokens {
  top: string; sel: string; un: string; acc: string; soft: string; page: string; pageDeep: string; dk: string;
  line: string; card: string; edge: string; track: string; mute: string; muteInk: string; onAcc: string;
  /** Pressed / deeper accent. */
  accDeep: string;
  /** A second band tone, a step deeper than `top` (gradients that used to run between two brand shades). */
  topDeep: string;
}

/** '#RRGGBB' mixed toward '#RRGGBB' by t (0..1). */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const LIGHT_SURF = { card: '#FFFFFF', edge: 'rgba(17,17,26,0.10)', track: '#ECEEF3', mute: '#F2F3F6', muteInk: '#4B5160', onAcc: '#FFFFFF' };
const DARK_SURF = { card: '#1A1316', edge: 'rgba(255,255,255,0.08)', track: 'rgba(255,255,255,0.12)', mute: 'rgba(255,255,255,0.08)', muteInk: '#B4B4BC', line: 'rgba(255,255,255,0.08)' };
const withShades = (t: Omit<DietTokens, 'accDeep' | 'topDeep'>, dark: boolean): DietTokens => ({
  ...t,
  accDeep: mixHex(t.acc, dark ? '#FFFFFF' : '#000000', dark ? 0.12 : 0.16),
  topDeep: mixHex(t.top, t.un, 0.55),
});
const DIET: Record<'light' | 'dark', Record<'nonveg' | 'veg', DietTokens>> = {
  light: {
    nonveg: withShades({ top: '#FBE1E6', sel: '#FFF5F7', un: '#F4D0D8', acc: '#C8143F', soft: '#FDEEF1', page: '#FFFBFB', dk: '#4C0912', line: '#F4E3E6', pageDeep: '#F7ECEE', ...LIGHT_SURF }, false),
    veg: withShades({ top: '#DCF1E3', sel: '#F3FBF5', un: '#C8E8D2', acc: '#15803D', soft: '#ECF8EF', page: '#FAFEFB', dk: '#08351C', line: '#E0EFE4', pageDeep: '#ECF5EF', ...LIGHT_SURF }, false),
  },
  dark: {
    nonveg: withShades({ top: '#2A1015', sel: '#3A161D', un: '#1C0A0E', acc: '#FF5C7A', soft: 'rgba(255,92,122,0.14)', dk: '#FFE4E9', page: '#0F0A0B', pageDeep: '#0F0A0B', onAcc: '#FFFFFF', ...DARK_SURF, card: '#1C1315' }, true),
    veg: withShades({ top: '#0F2418', sel: '#163322', un: '#0A1910', acc: '#4ADE80', soft: 'rgba(74,222,128,0.14)', dk: '#DCFCE7', page: '#080E0A', pageDeep: '#080E0A', onAcc: '#052E16', ...DARK_SURF, card: '#121C16' }, true),
  },
};

/** The diet tokens for the theme and diet in use right now. */
export function dietNow(): DietTokens {
  return DIET[darkNow ? 'dark' : 'light'][vegNow ? 'veg' : 'nonveg'];
}

/** The diet tokens of one fixed theme (a section always drawn light, or always dark), for the diet in use now. */
export function dietFor(dark: boolean): DietTokens {
  return DIET[dark ? 'dark' : 'light'][vegNow ? 'veg' : 'nonveg'];
}

/**
 * Like dietTokens, for a section drawn in one fixed theme whatever the app theme (Campus is always light, Friends
 * always dark): `make(d)` runs once per diet and every key answers for the diet in use right now.
 */
export function fixedDietTokens<T extends object>(dark: boolean, make: (d: DietTokens) => T): T {
  const cache: (T | undefined)[] = [];
  const current = (): T => {
    const i = vegNow ? 1 : 0;
    return (cache[i] ??= make(dietFor(dark)));
  };
  const first = current();
  return new Proxy(first, {
    get(_t, key) {
      return current()[key as keyof T];
    },
    has(_t, key) {
      return key in current();
    },
    ownKeys() {
      return Reflect.ownKeys(current());
    },
    getOwnPropertyDescriptor(_t, key) {
      const d = Reflect.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/** '#RRGGBB' + alpha -> rgba(). */
export function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Which of the four looks (light/dark x Non-veg/Veg) is current: a cache slot. */
const lookSlot = () => (darkNow ? 2 : 0) + (vegNow ? 1 : 0);

/**
 * A token object built from the current diet: `make(d, dark)` runs once per look (light/dark x Non-veg/Veg) and
 * every key answers from the look in use right now. Same keys and types as `make` returns.
 */
export function dietTokens<T extends object>(make: (d: DietTokens, dark: boolean) => T): T {
  const cache: (T | undefined)[] = [];
  const current = (): T => {
    const i = lookSlot();
    return (cache[i] ??= make(dietNow(), darkNow));
  };
  const first = current();
  return new Proxy(first, {
    get(_t, key) {
      return current()[key as keyof T];
    },
    has(_t, key) {
      return key in current();
    },
    ownKeys() {
      return Reflect.ownKeys(current());
    },
    getOwnPropertyDescriptor(_t, key) {
      const d = Reflect.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/** A palette's shape with its literal colours widened to string (gradient tuples keep their length), so a dark
 * palette can give its own values for the same keys. */
export type Palette<T> = {
  [K in keyof T]: T[K] extends readonly [unknown, unknown, unknown] ? readonly [string, string, string]
    : T[K] extends readonly [unknown, unknown] ? readonly [string, string]
      : T[K] extends string ? string
        : T[K] extends object ? Palette<T[K]> : T[K];
};

/** A token object that answers with the dark or the light palette, whichever is current. Same keys, same types. */
export function themedTokens<T extends object>(light: T, dark: T): T {
  return new Proxy(light, {
    get(_target, key) {
      return (darkNow ? dark : light)[key as keyof T];
    },
    has(_target, key) {
      return key in light;
    },
    ownKeys() {
      return Reflect.ownKeys(light);
    },
    getOwnPropertyDescriptor(_target, key) {
      const src = darkNow ? dark : light;
      const d = Reflect.getOwnPropertyDescriptor(src, key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/**
 * Drop-in for `StyleSheet.create({...})` in a themed section: `themedSheet(() => ({...}))`.
 * `make` runs once per look (light/dark x Non-veg/Veg; the tokens it reads answer for that look), and every
 * style lookup (`s.card`) returns the sheet for the look in use at render time.
 */
export function themedSheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(make: () => T): T {
  // One sheet per look (light/dark x Non-veg/Veg): diet-following sections read the diet tokens in `make`.
  const sheets: (T | undefined)[] = [];
  const current = (): T => {
    const i = lookSlot();
    return (sheets[i] ??= StyleSheet.create(make()));
  };
  return new Proxy({} as T, {
    get(_t, key) {
      return current()[key as keyof T];
    },
    has(_t, key) {
      return key in current();
    },
    ownKeys() {
      return Reflect.ownKeys(current());
    },
    getOwnPropertyDescriptor(_t, key) {
      const d = Reflect.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}
