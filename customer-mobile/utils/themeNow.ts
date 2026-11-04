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
 * `make` runs once per theme (the tokens it reads answer for that theme), and every style lookup
 * (`s.card`) returns the sheet for the theme in use at render time.
 */
export function themedSheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(make: () => T): T {
  let light: T | null = null;
  let dark: T | null = null;
  const current = (): T => {
    if (darkNow) return (dark ??= StyleSheet.create(make()));
    return (light ??= StyleSheet.create(make()));
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
