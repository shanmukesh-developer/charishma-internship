import { useSyncExternalStore } from 'react';

/**
 * The bottom bar wears the colour of the page above it (owner, 3 Nov 2026: a white bar under a night page looks odd).
 * A tab that draws a fixed-colour page of its own (Services > Rentals and Campus events are night pages in every theme,
 * Tech & repairs and Deals light ones) sets its tone here under its tab route name; no tone = the app theme's bar.
 * Kept per tab, so a tab keeps its tone while another one is in front and the bar changes in the same frame as the tab
 * (app/(tabs)/_layout.tsx gives each tab its own bar options and the navigator draws the focused tab's).
 */
export type TabBarTone = { bg: string; dark: boolean };

let tones: Readonly<Record<string, TabBarTone | undefined>> = {};
const listeners = new Set<() => void>();

export function setTabBarTone(tab: string, tone: TabBarTone | null) {
  const cur = tones[tab];
  if (cur ? !!tone && cur.bg === tone.bg && cur.dark === tone.dark : !tone) return;
  tones = { ...tones, [tab]: tone || undefined };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const snapshot = () => tones;

/** Every tab's tone (a new object only when one of them changes). */
export const useTabBarTones = () => useSyncExternalStore(subscribe, snapshot, snapshot);
