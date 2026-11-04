import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, getThemeColors, DARK_THEME, LIGHT_THEME } from '../constants/theme';
import { setThemeNow } from '../utils/themeNow';

type Theme = 'dark' | 'light';

export type ThemeColors = typeof DARK_THEME;

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
  activeColors: typeof COLORS;
  colors: ThemeColors;
  /** False until the saved theme preference has been read from storage. */
  isThemeReady: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  isDark: true,
  activeColors: COLORS,
  colors: DARK_THEME,
  isThemeReady: true,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Owner rule: light by default, whatever the phone's dark mode. Only the student's own toggle (saved) changes it.
  const [theme, setTheme] = useState<Theme>('light');
  const [isThemeReady, setIsThemeReady] = useState(false);

  useEffect(() => {
    let active = true;
    const loadTheme = async () => {
      try {
        const saved = await AsyncStorage.getItem('zenvy_theme_mode');
        if (active && (saved === 'light' || saved === 'dark')) {
          setTheme(saved);
        }
      } catch (e) {
        // Storage unavailable: keep the default theme.
      } finally {
        if (active) setIsThemeReady(true);
      }
    };
    loadTheme();
    return () => {
      active = false;
    };
  }, []);

  // Stable identity: a fresh function (and value object) on every provider render re-rendered every
  // useTheme() screen in the app even when nothing about the theme changed.
  const toggleTheme = useCallback(() => {
    // Functional update so two quick taps never save a stale value.
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem('zenvy_theme_mode', next).catch(() => {});
      return next;
    });
  }, []);

  const isDark = theme === 'dark';
  // Sections whose colours live outside React (PG stays, Co-Ride: utils/themeNow) read the theme from here.
  setThemeNow(isDark);
  const value = useMemo<ThemeContextType>(
    () => ({ theme, toggleTheme, isDark, activeColors: COLORS, colors: getThemeColors(isDark), isThemeReady }),
    [theme, toggleTheme, isDark, isThemeReady],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

