import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// The student's college (owner, 31 Oct 2026): picked on onboarding or at checkout, it is the default for delivery and
// decides which stores they see. The server keeps each store to its colleges (backend utils/campuses): every store /
// product list the app reads carries ?college=<key> (apiFetch adds it through withCollege), and an order is refused
// when its store does not serve the college. Same storage key as onboarding and checkout always used.
export type CollegeKey = 'srmap' | 'vitap' | 'amrita';
export const COLLEGE_STORAGE_KEY = 'zenvy_checkout_campus';
const KEYS: CollegeKey[] = ['srmap', 'vitap', 'amrita'];
export const isCollegeKey = (v: unknown): v is CollegeKey => typeof v === 'string' && (KEYS as string[]).includes(v);

let current: CollegeKey | null = null;
const listeners = new Set<(key: CollegeKey | null) => void>();
// Read once at start; every scoped request waits for it (a few milliseconds), so the first lists are already scoped.
const ready: Promise<void> = AsyncStorage.getItem(COLLEGE_STORAGE_KEY)
  .then((v) => { if (current === null && isCollegeKey(v)) current = v; })
  .catch(() => {});

export const getCollege = (): CollegeKey | null => current;

export async function collegeReady(): Promise<CollegeKey | null> {
  await ready;
  return current;
}

/** The student picked their college (onboarding, checkout): saved, and every open list refreshes for it. */
export function setCollege(key: CollegeKey): void {
  if (!isCollegeKey(key)) return;
  const changed = key !== current;
  current = key;
  AsyncStorage.setItem(COLLEGE_STORAGE_KEY, key).catch(() => {});
  if (changed) listeners.forEach((cb) => { try { cb(key); } catch { /* a listener never breaks the others */ } });
}

/** Forget the college (e.g. a saved one that is not open yet): lists show every store until the student picks one. */
export function clearCollege(): void {
  const changed = current !== null;
  current = null;
  AsyncStorage.removeItem(COLLEGE_STORAGE_KEY).catch(() => {});
  if (changed) listeners.forEach((cb) => { try { cb(null); } catch { /* a listener never breaks the others */ } });
}

export function onCollegeChange(cb: (key: CollegeKey | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The current college, re-rendering when it changes. */
export function useCollege(): CollegeKey | null {
  const [key, setKey] = useState<CollegeKey | null>(current);
  useEffect(() => {
    let alive = true;
    ready.then(() => { if (alive) setKey(current); });
    const off = onCollegeChange((k) => setKey(k));
    return () => { alive = false; off(); };
  }, []);
  return key;
}

// The store / product lists the server scopes by college. Single stores, orders and everything else are untouched.
const SCOPED: RegExp[] = [
  /\/api\/users\/restaurants(\?|$)/,
  /\/api\/users\/search(\?|$)/,
  /\/api\/catalogue\/(items|stores|types|min-prices)(\?|$)/,
  /\/api\/restaurants\/local-vendors(\?|$)/,
  /\/api\/ads\/splash(\?|$)/,
  /\/api\/campus-booking\/(home|stalls)(\?|$)/,
];

/** `url` with ?college=<key> when it is a scoped list and a college is known (an explicit college= is kept). */
export function withCollege(url: string, college: CollegeKey | null = current): string {
  if (!college || /[?&]college=/.test(url) || !SCOPED.some((re) => re.test(url))) return url;
  return `${url}${url.includes('?') ? '&' : '?'}college=${college}`;
}
