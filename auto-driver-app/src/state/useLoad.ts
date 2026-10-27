// Small data hook for screens: first load (loading), refresh (refreshing), error + retry, optional polling
// while the screen is focused and the app is in the foreground.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { errorMessage } from '../lib/http';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const inFlight = useRef(false);
  const alive = useRef(true);
  // Bumped whenever deps change: a reply for the old deps (e.g. the "7 days" earnings arriving after the
  // driver already picked "This month") is dropped instead of overwriting the newer screen.
  const gen = useRef(0);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback(async (mode: 'first' | 'refresh' | 'quiet') => {
    if (inFlight.current && mode === 'quiet') return;
    const myGen = gen.current;
    inFlight.current = true;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const r = await fnRef.current();
      if (!alive.current || myGen !== gen.current) return;
      setData(r);
      setError(null);
    } catch (e) {
      if (!alive.current || myGen !== gen.current) return;
      setError(errorMessage(e));
    } finally {
      if (myGen === gen.current) {
        inFlight.current = false;
        if (alive.current) { setLoading(false); setRefreshing(false); }
      }
    }
  }, []);

  const firstDeps = useRef(true);
  useEffect(() => {
    if (firstDeps.current) firstDeps.current = false;
    else {
      // New deps: the old data belongs to something else (another tab, range or trip), so show loading.
      gen.current += 1;
      inFlight.current = false;
      setData(null);
      setError(null);
      setRefreshing(false);
    }
    setLoading(true);
    run('first');
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const focused = useIsFocused();
  useEffect(() => {
    if (!opts.pollMs || !focused) return;
    const t = setInterval(() => { if (AppState.currentState === 'active') run('quiet'); }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, focused, run]);

  return {
    data, setData, loading, refreshing, error,
    refresh: useCallback(() => run('refresh'), [run]),
    reload: useCallback(() => run('quiet'), [run]),
  };
}
