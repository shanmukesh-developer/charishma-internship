/**
 * Co-Ride v2 navigation. Screens speak in `Route`s; this maps them onto real expo-router paths, so every
 * screen is deep-linkable (like pgV2Nav):
 *   home     /(tabs)/others?tab=coride       find     /coride/find?from&to&kind&women&focus
 *   ride     /coride/ride/:id                 post     /coride/post?role&repeat&to&weekend
 *   mine     /coride/my-rides?as              regular  /coride/regular
 *   auto     /coride/auto?key                 (more ZCS Auto: /coride/auto-more?seg)
 * Back is ONE safe rule everywhere (header arrows and Android back): router.back() when there is history,
 * otherwise the Co-Ride home. A sheet can be handed to the next screen (e.g. "Ride posted" on My rides).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { Ride } from './coRideV2Data';

export type When = 'any' | 'now' | 'today' | 'tomorrow';
export type Route =
  | { name: 'home' }
  | { name: 'find'; from?: string; to?: string; kind?: 'lift' | 'give'; women?: boolean; focus?: boolean }
  | { name: 'ride'; id: string }
  | { name: 'post'; role: 'rider' | 'passenger'; repeatId?: string; prefillTo?: string; weekend?: boolean }
  | { name: 'mine'; as?: 'rider' | 'driver' }
  | { name: 'auto'; key?: string }
  | { name: 'regular'; base?: { origin: string; destination: string; time: string; vehicle: 'Bike' | 'Car'; seats: number; fuel: number } };
export type ScreenName = Route['name'];

export type Sheet =
  | null
  | { kind: 'request'; ride: Ride }
  | { kind: 'requested'; ride: Ride; known?: boolean }
  | { kind: 'posted'; summary: { from: string; to: string; when: string; vehicle: string; seats: number; share: string | null; role: 'rider' | 'passenger' }; base?: { origin: string; destination: string; time: string; vehicle: 'Bike' | 'Car'; seats: number; fuel: number } }
  | { kind: 'karma' }
  | { kind: 'sos'; rideId?: string }
  | { kind: 'done'; title: string; body: string };

export const CORIDE_HOME_PATH = '/(tabs)/services?tab=coride';
const qs = (o: Record<string, string | undefined | false>) => {
  const parts = Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};
export function pathFor(r: Route): string {
  switch (r.name) {
    case 'home': return CORIDE_HOME_PATH;
    case 'find': return `/coride/find${qs({ from: r.from, to: r.to, kind: r.kind, women: r.women ? '1' : undefined, focus: r.focus ? '1' : undefined })}`;
    case 'ride': return `/coride/ride/${encodeURIComponent(r.id)}`;
    case 'post': return `/coride/post${qs({ role: r.role, repeat: r.repeatId, to: r.prefillTo, weekend: r.weekend ? '1' : undefined })}`;
    case 'mine': return `/coride/my-rides${qs({ as: r.as })}`;
    case 'auto': return `/coride/auto${qs({ key: r.key })}`;
    case 'regular': return `/coride/regular${r.base ? qs({ new: '1', from: r.base.origin, to: r.base.destination, time: r.base.time, vehicle: r.base.vehicle, seats: String(r.base.seats), fuel: String(r.base.fuel) }) : ''}`;
  }
}

/** The Route a screen file stands for, read from its URL params. */
export function useRouteFromParams(name: ScreenName): Route {
  const p = useLocalSearchParams<Record<string, string>>();
  const s = (k: string) => (typeof p[k] === 'string' && p[k] ? String(p[k]) : undefined);
  return useMemo<Route>(() => {
    switch (name) {
      case 'find': return { name, from: s('from'), to: s('to'), kind: s('kind') === 'give' ? 'give' : 'lift', women: s('women') === '1', focus: s('focus') === '1' };
      case 'ride': return { name, id: s('id') || '' };
      case 'post': return { name, role: s('role') === 'passenger' ? 'passenger' : 'rider', repeatId: s('repeat'), prefillTo: s('to'), weekend: s('weekend') === '1' };
      case 'mine': return { name, as: s('as') === 'driver' ? 'driver' : s('as') === 'rider' ? 'rider' : undefined };
      case 'auto': return { name, key: s('key') };
      case 'regular': return s('new') === '1' ? { name, base: { origin: s('from') || '', destination: s('to') || '', time: s('time') || '17:30', vehicle: s('vehicle') === 'Car' ? 'Car' : 'Bike', seats: Number(s('seats')) || 1, fuel: Number(s('fuel')) || 0 } } : { name };
      default: return { name: 'home' };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, JSON.stringify(p)]);
}

// A sheet handed over to the next screen that mounts (router.replace unmounts the current one).
let pendingSheet: Sheet = null;

interface Nav {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  /** Replace this screen with `r` (after posting: My rides), optionally opening `sheet` there. */
  replace: (r: Route, sheet?: Sheet) => void;
  sheet: Sheet;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
}
const NavCtx = createContext<Nav | null>(null);
export const useNav = () => {
  const n = useContext(NavCtx);
  if (!n) throw new Error('useNav outside CoRideV2Nav');
  return n;
};

export function CoRideV2Nav({ children, route }: { children: React.ReactNode; route: Route }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(() => { const s = pendingSheet; pendingSheet = null; return s; });
  const push = useCallback((r: Route) => router.push(pathFor(r) as any), [router]);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(CORIDE_HOME_PATH as any);
  }, [router]);
  const replace = useCallback((r: Route, s?: Sheet) => { pendingSheet = s || null; router.replace(pathFor(r) as any); }, [router]);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Android back: close the sheet first; inner screens use the same safe back. The home lives in the
  // Others tab, whose own back handling stays as it is.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) { setSheet(null); return true; }
      if (route.name === 'home') return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [sheet, route.name, back]);

  const value = useMemo<Nav>(() => ({ route, push, back, replace, sheet, openSheet: setSheet, closeSheet }), [route, push, back, replace, sheet, closeSheet]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
