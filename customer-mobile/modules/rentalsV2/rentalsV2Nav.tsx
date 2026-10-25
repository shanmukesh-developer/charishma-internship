/**
 * Rentals v2 navigation. Screens speak in `Route`s; this maps them onto real expo-router paths so every
 * screen is deep-linkable (same pattern as pgV2Nav / coRideV2Nav):
 *   home     /(tabs)/others?tab=rentals        explore  /rentals/explore?q&focus&near
 *   list     /rentals/list/:category?chip       vehicle  /rentals/vehicle/:id
 *   room     /rentals/room/:id                  flat     /rentals/flat/:id
 *   mine     /rentals/my-rentals?role
 * Old links keep working: /rentals -> explore, /rentals/:id -> vehicle, /rentals/bookings -> mine.
 * Back is one safe rule: router.back() with history, otherwise the Rentals home. Android back closes a sheet first.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { Category } from './rentalsV2Theme';
import type { RItem } from './rentalsV2Data';

export type Route =
  | { name: 'home' }
  | { name: 'explore'; q?: string; focus?: boolean; near?: string }
  | { name: 'list'; category: Category; chip?: string }
  | { name: 'vehicle'; id: string }
  | { name: 'room'; id: string }
  | { name: 'flat'; id: string }
  | { name: 'mine'; role?: 'renter' | 'owner' };
export type ScreenName = Route['name'];

export type Sheet =
  | null
  | { kind: 'book'; item: RItem; duration: Duration }
  | { kind: 'sample'; item: RItem }
  | { kind: 'sent'; title: string; body: string; mine?: boolean };
export type Duration = 'day' | 'week' | 'month';

export const RENTALS_HOME_PATH = '/(tabs)/others?tab=rentals';
const CATS: Category[] = ['bike', 'car', 'room', 'flat'];
const qs = (o: Record<string, string | undefined | false>) => {
  const parts = Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function pathFor(r: Route): string {
  switch (r.name) {
    case 'home': return RENTALS_HOME_PATH;
    case 'explore': return `/rentals/explore${qs({ q: r.q, focus: r.focus ? '1' : undefined, near: r.near })}`;
    case 'list': return `/rentals/list/${r.category}${qs({ chip: r.chip && r.chip !== 'all' ? r.chip : undefined })}`;
    case 'vehicle': return `/rentals/vehicle/${encodeURIComponent(r.id)}`;
    case 'room': return `/rentals/room/${encodeURIComponent(r.id)}`;
    case 'flat': return `/rentals/flat/${encodeURIComponent(r.id)}`;
    case 'mine': return `/rentals/my-rentals${qs({ role: r.role })}`;
  }
}

/** The detail route of an item. */
export const itemRoute = (i: Pick<RItem, 'id' | 'category'>): Route =>
  (i.category === 'room' ? { name: 'room', id: i.id } : i.category === 'flat' ? { name: 'flat', id: i.id } : { name: 'vehicle', id: i.id });

export function useRouteFromParams(name: ScreenName): Route {
  const p = useLocalSearchParams<Record<string, string>>();
  const s = (k: string) => (typeof p[k] === 'string' && p[k] ? String(p[k]) : undefined);
  return useMemo<Route>(() => {
    switch (name) {
      case 'explore': return { name, q: s('q'), focus: s('focus') === '1', near: s('near') };
      case 'list': {
        const c = s('category') as Category | undefined;
        return { name, category: c && CATS.includes(c) ? c : 'bike', chip: s('chip') };
      }
      case 'vehicle': case 'room': case 'flat': return { name, id: s('id') || '' };
      case 'mine': return { name, role: s('role') === 'owner' ? 'owner' : undefined };
      default: return { name: 'home' };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, JSON.stringify(p)]);
}

interface Nav {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  sheet: Sheet;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
  /** Others → section pills (home only). */
  onSection?: (key: string) => void;
}
const NavCtx = createContext<Nav | null>(null);
export const useNav = () => {
  const n = useContext(NavCtx);
  if (!n) throw new Error('useNav outside RentalsV2Nav');
  return n;
};

export function RentalsV2Nav({ children, route, onSection }: { children: React.ReactNode; route: Route; onSection?: (key: string) => void }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const push = useCallback((r: Route) => router.push(pathFor(r) as any), [router]);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(RENTALS_HOME_PATH as any);
  }, [router]);
  const closeSheet = useCallback(() => setSheet(null), []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) { setSheet(null); return true; }
      if (route.name === 'home') return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [sheet, route.name, back]);

  const value = useMemo<Nav>(() => ({ route, push, back, sheet, openSheet: setSheet, closeSheet, onSection }), [route, push, back, sheet, closeSheet, onSection]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
