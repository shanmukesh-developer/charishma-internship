/**
 * PG v2 navigation. Screens speak in `Route`s (`nav.push({ name: 'room', pgId, roomKey })`); this file maps
 * them onto expo-router paths under app/pg/ and back, so every screen is a real, deep-linkable route:
 *   building   /pg/:id                  list        /pg/list?gender&budget&q&focus&saved
 *   overview   /pg/overview?pg          rooms       /pg/rooms?pg&gender
 *   room       /pg/room?pg&type         map         /pg/map?pg
 *   facilities /pg/facilities?pg        mess        /pg/mess?pg
 *   booking    /pg/book?pg&type         bookings    /pg/bookings
 *   home       /(tabs)/others?tab=pg  (the Others shell renders the PG v2 home)
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { GenderKey } from './pgV2Theme';

export type ScreenName =
  | 'home' | 'list' | 'building' | 'map' | 'facilities' | 'rooms'
  | 'overview' | 'room' | 'mess' | 'booking' | 'bookings';

/** Budget filter keys for the home search (monthly rent per bed). */
export type BudgetKey = 'any' | 'u6' | '6to10' | 'o10';
export interface Route {
  name: ScreenName; pgId?: string; roomKey?: string; gender?: GenderKey; q?: string;
  budget?: BudgetKey; savedOnly?: boolean; searchFocus?: boolean;
}

export interface Nav {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  canGoBack: boolean;
  /** First PG id from the list (screens opened without an id). */
  defaultPgId: string | null;
}

export const PG_HOME_PATH = '/(tabs)/others?tab=pg';

const qs = (o: Record<string, string | undefined | false>) => {
  const parts = Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const pathFor = (r: Route): string => {
  switch (r.name) {
    case 'home': return PG_HOME_PATH;
    case 'building': return `/pg/${encodeURIComponent(r.pgId || '')}`;
    case 'list': return `/pg/list${qs({ gender: r.gender, budget: r.budget && r.budget !== 'any' ? r.budget : undefined, q: r.q, focus: r.searchFocus ? '1' : undefined, saved: r.savedOnly ? '1' : undefined })}`;
    case 'rooms': return `/pg/rooms${qs({ pg: r.pgId, gender: r.gender })}`;
    case 'room': return `/pg/room${qs({ pg: r.pgId, type: r.roomKey })}`;
    case 'booking': return `/pg/book${qs({ pg: r.pgId, type: r.roomKey })}`;
    case 'bookings': return '/pg/bookings';
    default: return `/pg/${r.name}${qs({ pg: r.pgId })}`;
  }
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const GENDERS: GenderKey[] = ['Boys', 'Girls', 'Co-ed'];
const BUDGET_KEYS: BudgetKey[] = ['any', 'u6', '6to10', 'o10'];

/** The current screen's Route from its URL. */
export function useRouteFromParams(name: ScreenName): Route {
  const p = useLocalSearchParams<Record<string, string>>();
  const gender = one(p.gender) as GenderKey | undefined;
  const budget = one(p.budget) as BudgetKey | undefined;
  return {
    name,
    pgId: one(p.id) || one(p.pg),
    roomKey: one(p.type),
    gender: gender && GENDERS.includes(gender) ? gender : undefined,
    budget: budget && BUDGET_KEYS.includes(budget) ? budget : undefined,
    q: one(p.q),
    searchFocus: one(p.focus) === '1',
    savedOnly: one(p.saved) === '1',
  };
}

export const NavCtx = createContext<Nav | null>(null);
export const useNav = () => {
  const v = useContext(NavCtx);
  if (!v) throw new Error('useNav outside NavCtx');
  return v;
};

/** The PG a screen shows: its route's id, else the first listing. */
export const usePgIdFor = () => {
  const nav = useNav();
  return nav.route.pgId || nav.defaultPgId;
};

/** Router-backed navigator for one screen. */
export function RouterNav({ route, defaultPgId, children }: { route: Route; defaultPgId: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const canGoBack = router.canGoBack();
  const value = useMemo<Nav>(() => ({
    route,
    defaultPgId,
    canGoBack,
    push: (r) => router.push(pathFor(r) as any),
    back: () => (router.canGoBack() ? router.back() : router.replace(PG_HOME_PATH as any)),
  }), [route, defaultPgId, canGoBack, router]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
