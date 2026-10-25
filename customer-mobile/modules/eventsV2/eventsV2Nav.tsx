/**
 * Campus Events v2 navigation. Screens speak in `Route`s; this maps them onto the existing expo-router paths so
 * every old link, push notification and inbox tap keeps working (campusEventLinks.ts):
 *   home      /(tabs)/others?tab=events             explore   /campus-events?q&cat&when&price&club&focus
 *   event     /campus-events/:id                     register  /campus-events/register/:id?regId&teamId&waitlist&slotId
 *   mine      /campus-events/my?tab                  tickets   /campus-events/tickets
 *   ticket    /campus-events/ticket/:id
 * Back is one safe rule: router.back() with history, otherwise the Events home. Android back closes a sheet first.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { MyTab } from '../campusEvents/campusEventsApi';
import type { TileKey } from './eventsV2Theme';
import type { EvEvent } from './eventsV2Demo';

export type WhenKey = 'any' | 'today' | 'week' | 'month';
export type PriceKey = 'any' | 'free' | 'paid';
export type Route =
  | { name: 'home' }
  | { name: 'explore'; q?: string; tile?: TileKey; when?: WhenKey; price?: PriceKey; club?: string; focus?: boolean }
  | { name: 'event'; id: string }
  | { name: 'register'; id: string; regId?: string; teamId?: string; waitlist?: boolean; slotId?: string }
  | { name: 'mine'; tab?: MyTab }
  | { name: 'tickets' }
  | { name: 'ticket'; id: string };

export type Sheet = null | { kind: 'sample'; ev: EvEvent };

export const EVENTS_HOME_PATH = '/(tabs)/others?tab=events';
const qs = (o: Record<string, string | undefined | false>) => {
  const parts = Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function pathFor(r: Route): string {
  switch (r.name) {
    case 'home': return EVENTS_HOME_PATH;
    case 'explore': return `/campus-events${qs({ q: r.q, cat: r.tile && r.tile !== 'all' ? r.tile : undefined, when: r.when && r.when !== 'any' ? r.when : undefined, price: r.price && r.price !== 'any' ? r.price : undefined, club: r.club, focus: r.focus ? '1' : undefined })}`;
    case 'event': return `/campus-events/${encodeURIComponent(r.id)}`;
    case 'register': return `/campus-events/register/${encodeURIComponent(r.id)}${qs({ regId: r.regId, teamId: r.teamId, waitlist: r.waitlist ? '1' : undefined, slotId: r.slotId })}`;
    case 'mine': return `/campus-events/my${qs({ tab: r.tab })}`;
    case 'tickets': return '/campus-events/tickets';
    case 'ticket': return `/campus-events/ticket/${encodeURIComponent(r.id)}`;
  }
}

interface Nav {
  push: (r: Route) => void;
  replace: (r: Route) => void;
  /** Any app path (old screens: slots, teams, organizer, check-in, registration details). */
  go: (path: string) => void;
  back: () => void;
  sheet: Sheet;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
  /** Others → section pills (home only). */
  onSection?: (key: string) => void;
  isHome: boolean;
}
const NavCtx = createContext<Nav | null>(null);
export const useNav = () => {
  const n = useContext(NavCtx);
  if (!n) throw new Error('useNav outside EventsV2Nav');
  return n;
};

export function EventsV2Nav({ children, isHome, onSection }: { children: React.ReactNode; isHome?: boolean; onSection?: (key: string) => void }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const push = useCallback((r: Route) => router.push(pathFor(r) as any), [router]);
  const replace = useCallback((r: Route) => router.replace(pathFor(r) as any), [router]);
  const go = useCallback((path: string) => router.push(path as any), [router]);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(EVENTS_HOME_PATH as any);
  }, [router]);
  const closeSheet = useCallback(() => setSheet(null), []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) { setSheet(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [sheet]);

  const value = useMemo<Nav>(() => ({ push, replace, go, back, sheet, openSheet: setSheet, closeSheet, onSection, isHome: !!isHome }), [push, replace, go, back, sheet, closeSheet, onSection, isHome]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
