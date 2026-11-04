import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './auth';
import { onCollegeChange } from './college';

/**
 * Stale-while-revalidate cache for READ-ONLY listing endpoints (restaurants, store detail,
 * catalogue shelves, product detail...).
 *
 * - The last good response lives in memory and in AsyncStorage, so a screen can paint instantly
 *   (even on a cold app start) and refresh in the background.
 * - Never use it for prices that are charged: checkout always asks the server for a quote.
 * - Never use it for per-user data (orders, wallet, coupons): keys are not scoped to the user.
 */

/** Home restaurant list (with menus); the store screen opens instantly from it. */
export const RESTAURANTS_CACHE_KEY = 'restaurants:list';

const PREFIX = 'zenvy_swr:';
const INDEX_KEY = 'zenvy_swr_index';
/** How many persisted entries to keep (oldest dropped first). */
const MAX_PERSISTED = 40;

type Entry = { data: any; at: number };
const mem = new Map<string, Entry>();
let index: string[] | null = null;
let indexLoad: Promise<string[]> | null = null;

const loadIndex = (): Promise<string[]> => {
  if (index) return Promise.resolve(index);
  if (!indexLoad) {
    indexLoad = AsyncStorage.getItem(INDEX_KEY)
      .then((raw) => {
        const parsed = raw ? JSON.parse(raw) : [];
        index = Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
        return index!;
      })
      .catch(() => (index = []));
  }
  return indexLoad;
};

/** A store from the cached home list (has its menu), for an instant first paint. */
export function peekCachedRestaurant(id: string): any | undefined {
  const list = mem.get(RESTAURANTS_CACHE_KEY)?.data;
  if (!Array.isArray(list) || !id) return undefined;
  return list.find((r: any) => r && String(r.id || r._id) === String(id));
}

/** Synchronous memory lookup (instant first paint when the screen was opened before). */
export function peekCache<T = any>(key: string): T | undefined {
  return mem.get(key)?.data as T | undefined;
}

/** Memory first, then AsyncStorage. Resolves null when nothing is cached. */
export async function readCache<T = any>(key: string): Promise<{ data: T; at: number } | null> {
  const hit = mem.get(key);
  if (hit) return hit as { data: T; at: number };
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null;
    const entry: Entry = { data: parsed.data, at: Number(parsed.at) || 0 };
    // A fresher in-memory write may have landed while we were reading storage
    if (!mem.has(key)) mem.set(key, entry);
    return mem.get(key) as { data: T; at: number };
  } catch {
    return null;
  }
}

/** Store the last good response (memory now, storage in the background). */
export function writeCache(key: string, data: any): void {
  const entry: Entry = { data, at: Date.now() };
  mem.set(key, entry);
  (async () => {
    try {
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry));
      const idx = (await loadIndex()).filter((k) => k !== key);
      idx.push(key);
      const drop = idx.length > MAX_PERSISTED ? idx.splice(0, idx.length - MAX_PERSISTED) : [];
      index = idx;
      if (drop.length) AsyncStorage.multiRemove(drop.map((k) => PREFIX + k)).catch(() => {});
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    } catch {
      // Storage full / unavailable: the memory copy still serves this session
    }
  })();
}

/** Forget every cached answer (memory and storage). */
export async function clearAllCaches(): Promise<void> {
  mem.clear();
  try {
    const keys = await loadIndex();
    if (keys.length) await AsyncStorage.multiRemove(keys.map((k) => PREFIX + k));
    index = [];
    await AsyncStorage.setItem(INDEX_KEY, '[]');
  } catch {
    // storage unavailable: memory is already clear
  }
}

// The student changed college: every cached list belongs to the other college. Forget them, then let open lists
// fetch again (useSWRJson listens through collegeEpoch).
let collegeEpoch = 0;
const epochListeners = new Set<(n: number) => void>();
onCollegeChange(() => {
  collegeEpoch += 1;
  clearAllCaches().finally(() => epochListeners.forEach((cb) => { try { cb(collegeEpoch); } catch { /* ignore */ } }));
});
/** Bumped on every college change: a response to a request started before the change is dropped. */
export const getCollegeEpoch = (): number => collegeEpoch;

/** Re-renders when the student changes college (Home and other screens reload their lists). */
export function useCollegeEpoch(): number {
  const [n, setN] = useState(collegeEpoch);
  useEffect(() => {
    epochListeners.add(setN);
    return () => { epochListeners.delete(setN); };
  }, []);
  return n;
}

export interface SWRResult<T> {
  data: T | undefined;
  /** True only while there is nothing to show yet (no cache and no response). */
  loading: boolean;
  error: string | null;
  /** HTTP status of the last failed request (e.g. 404), if any. */
  status: number | null;
  /** Re-run the request; silent keeps the current data on screen (no loading flag). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
}

interface SWROptions<T> {
  /** Reject a 200 response whose shape is wrong (it is not cached). */
  validate?: (data: any) => boolean;
  /** Turn the raw response into what the screen stores (runs before caching). */
  select?: (data: any) => T;
  /** Skip the network refresh when the cached copy is younger than this (default 0 = always refresh). */
  freshMs?: number;
  enabled?: boolean;
}

/**
 * useSWRJson('/api/users/restaurants/123') → cached data immediately, fresh data a moment later.
 * The cache key is the URL (pass a different `key` to share one entry across URLs).
 */
export function useSWRJson<T = any>(url: string | null, opts: SWROptions<T> & { key?: string } = {}): SWRResult<T> {
  const key = opts.key || url || '';
  const enabled = opts.enabled !== false && !!url;
  const [data, setData] = useState<T | undefined>(() => (key ? peekCache<T>(key) : undefined));
  const [loading, setLoading] = useState<boolean>(() => enabled && !(key && mem.has(key)));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const keyRef = useRef(key);
  keyRef.current = key;
  const epoch = useCollegeEpoch();

  const refresh = useCallback(async ({ silent = true }: { silent?: boolean } = {}) => {
    if (!url) return;
    const requestKey = key;
    const requestEpoch = collegeEpoch;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(url);
      const json = await res.json().catch(() => null);
      // Changed screen, or the student changed college while this was on its way (the other college's list).
      if (keyRef.current !== requestKey || requestEpoch !== collegeEpoch) return;
      const { validate, select } = optsRef.current;
      if (res.ok && json != null && (!validate || validate(json))) {
        const value = select ? select(json) : (json as T);
        writeCache(requestKey, value);
        setData(value);
        setError(null);
        setStatus(null);
      } else {
        setStatus(res.status);
        setError(res.ok ? 'Unexpected response' : `HTTP ${res.status}`);
      }
    } catch (e: any) {
      if (keyRef.current !== requestKey) return;
      setError(e?.message || 'Network error');
    } finally {
      if (keyRef.current === requestKey) setLoading(false);
    }
  }, [url, key]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const cachedNow = peekCache<T>(key);
    setData(cachedNow);
    setError(null);
    setStatus(null);
    setLoading(cachedNow === undefined);
    (async () => {
      const cached = cachedNow === undefined ? await readCache<T>(key) : mem.get(key) || null;
      if (cancelled) return;
      if (cached) {
        setData(cached.data);
        setLoading(false);
        const fresh = optsRef.current.freshMs || 0;
        if (fresh > 0 && Date.now() - cached.at < fresh) return;
      }
      refresh({ silent: true });
    })();
    return () => { cancelled = true; };
  }, [key, enabled, refresh]);

  // The student changed college: ask again quietly, keeping what is on screen until the answer arrives (clearing it
  // made every screen flash empty, including settings that do not depend on the college).
  const epochAtMount = useRef(epoch);
  useEffect(() => {
    if (!enabled || epoch === epochAtMount.current) return;
    epochAtMount.current = epoch;
    refresh({ silent: true });
  }, [epoch, enabled, refresh]);

  return { data, loading, error, status, refresh };
}
