/**
 * Deals & spin v2 navigation. Screens speak in `Route`s; this maps them onto expo-router paths:
 *   home     /(tabs)/others?tab=promos       spin     /deals/spin        coupons  /deals/coupons
 *   coupon   /deals/coupon/:code             points   /deals/points      today    /deals/today
 *   refer    /deals/refer
 * Old links keep working: /rewards -> Others → Deals & spin, /rewards?spin=1 -> /deals/spin (app/rewards.tsx).
 * Back is one safe rule: router.back() with history, otherwise the Deals home. Android back closes a sheet first.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { SampleDeal } from './dealsV2Demo';
import type { Coupon } from './dealsV2Data';

export type Route =
  | { name: 'home' } | { name: 'spin' } | { name: 'coupons' } | { name: 'coupon'; code: string }
  | { name: 'points' } | { name: 'today' } | { name: 'refer' };

/** The result payload of POST /api/rewards/use-spin (or a dev-only sample, flagged). */
export type SpinResult = { display: string; type: string; coupon: { code: string; type?: string; expiryDate?: string } | null; zenPoints?: number; spinsAvailable?: number; sample?: boolean };

export type Sheet =
  | null
  | { kind: 'sample'; deal: SampleDeal }
  | { kind: 'deal'; item: any }
  | { kind: 'result'; result: SpinResult }
  | { kind: 'apply'; coupon: Coupon }
  | { kind: 'nospin'; nextIn: number | null };

export const DEALS_HOME_PATH = '/(tabs)/others?tab=promos';

export function pathFor(r: Route): string {
  switch (r.name) {
    case 'home': return DEALS_HOME_PATH;
    case 'spin': return '/deals/spin';
    case 'coupons': return '/deals/coupons';
    case 'coupon': return `/deals/coupon/${encodeURIComponent(r.code)}`;
    case 'points': return '/deals/points';
    case 'today': return '/deals/today';
    case 'refer': return '/deals/refer';
  }
}

interface Nav {
  push: (r: Route) => void;
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
  if (!n) throw new Error('useNav outside DealsV2Nav');
  return n;
};

export function DealsV2Nav({ children, isHome, onSection }: { children: React.ReactNode; isHome?: boolean; onSection?: (key: string) => void }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const push = useCallback((r: Route) => router.push(pathFor(r) as any), [router]);
  const go = useCallback((path: string) => router.push(path as any), [router]);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(DEALS_HOME_PATH as any);
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

  const value = useMemo<Nav>(() => ({ push, go, back, sheet, openSheet: setSheet, closeSheet, onSection, isHome: !!isHome }), [push, go, back, sheet, closeSheet, onSection, isHome]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
