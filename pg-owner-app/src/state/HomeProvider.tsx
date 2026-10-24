// GET /api/pg-owner/home kept fresh while the app is open (poll + push nudges + resume): the dashboard tiles
// and the badges on the tab bar / menu rows (new booking requests, open complaints, rent due) all read it.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { HOME_POLL_MS } from '../config';
import type { HomeResponse } from '../types';

interface HomeCtx {
  home: HomeResponse | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}
const Ctx = createContext<HomeCtx | null>(null);

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async (loud: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (loud) setRefreshing(true);
    try {
      setHome(await ownerApi.home());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      if (loud) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => { if (AppState.currentState === 'active') load(false); }, HOME_POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(false); });
    return () => { clearInterval(t); sub.remove(); };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  const value = useMemo(() => ({ home, error, refreshing, refresh }), [home, error, refreshing, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHome() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHome outside HomeProvider');
  return v;
}
