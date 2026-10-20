"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'zenvy_admin_theme';

/**
 * Inline script for <head>: applies the saved theme before first paint so pages never flash the
 * wrong colours. Kept tiny and dependency free (the CSP allows inline scripts).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

interface ThemeCtx { pref: ThemePref; resolved: 'light' | 'dark'; setPref: (p: ThemePref) => void }
const Ctx = createContext<ThemeCtx>({ pref: 'system', resolved: 'light', setPref: () => {} });
export const useTheme = () => useContext(Ctx);

const apply = (dark: boolean) => {
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') setPrefState(saved);
    } catch { /* storage unavailable */ }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolved: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => { apply(resolved === 'dark'); }, [resolved]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
