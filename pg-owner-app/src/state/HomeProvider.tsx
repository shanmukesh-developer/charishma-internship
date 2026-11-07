// GET /api/pg-owner/home kept fresh while the app is open (poll + push nudges + live socket + resume): the dashboard
// tiles and the badges on the tab bar / menu rows (new booking requests, open complaints, rent due) all read it.
// It also carries the "something changed" counters the lists watch (PF-09): a push or a live `pg:changed` event
// bumps them, so an open Requests / Complaints screen refetches at once instead of on its 30 s timer.
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
  /** Bumped when bookings / complaints changed on the server (push or live event). */
  changes: { bookings: number; complaints: number };
  /** Something changed: refresh the dashboard quietly and bump the matching counter(s). */
  nudge: (kind: 'bookings' | 'complaints' | 'all') => void;
}
const Ctx = createContext<HomeCtx | null>(null);

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const [changes, setChanges] = useState({ bookings: 0, complaints: 0 });

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
  const nudge = useCallback((kind: 'bookings' | 'complaints' | 'all') => {
    load(false);
    setChanges((c) => ({
      bookings: kind === 'complaints' ? c.bookings : c.bookings + 1,
      complaints: kind === 'bookings' ? c.complaints : c.complaints + 1,
    }));
  }, [load]);
  const value = useMemo(() => ({ home, error, refreshing, refresh, changes, nudge }), [home, error, refreshing, refresh, changes, nudge]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHome() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHome outside HomeProvider');
  return v;
}
