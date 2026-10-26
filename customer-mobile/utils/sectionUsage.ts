import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Which sections this user opens most (owner, 26 Oct): Home's feature cards are ordered by it. The Others section
// pills keep their fixed order (owner, 26 Oct). Kept on the phone only.
//
// Each open adds 1 to the section's score; scores halve every 14 days, so the order follows current habits.
// The order is a snapshot taken once per app launch: the cards never move while the user is looking at them,
// and today's opens reorder them from the next launch.

const KEY = 'zcs.sectionUsage.v1';
const HALF_LIFE_MS = 14 * 24 * 3600 * 1000;
// One open per section per 10 minutes counts (going back and forth between pills is not "regular use").
const REPEAT_GAP_MS = 10 * 60 * 1000;
// A section moves ahead of the standard order only once it has been opened a few times.
const MIN_SCORE = 2;

type Entry = { s: number; t: number };
type Store = Record<string, Entry>;

let store: Store = {};
let snapshot: Store | null = null;
const listeners = new Set<() => void>();

const decayed = (e: Entry | undefined, now: number) => (e ? e.s * Math.pow(0.5, (now - e.t) / HALF_LIFE_MS) : 0);

const loading = AsyncStorage.getItem(KEY)
  .then((raw) => { if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') store = v; } })
  .catch(() => { /* first launch or unreadable: standard order */ })
  .finally(() => {
    snapshot = { ...store };
    listeners.forEach((fn) => fn());
    listeners.clear();
  });

/** Count one deliberate open of a section (a card or pill tap, a link into it). Never for automatic defaults. */
export function recordSectionUse(key: string) {
  void loading.then(() => {
    const now = Date.now();
    const e = store[key];
    if (e && now - e.t < REPEAT_GAP_MS) return;
    store = { ...store, [key]: { s: decayed(e, now) + 1, t: now } };
    AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {});
  });
}

/** This launch's score for an item (several usage keys add up). */
function scoreOf(keys: string[], snap: Store, now: number) {
  return keys.reduce((sum, k) => sum + decayed(snap[k], now), 0);
}

/**
 * Orders items by how often the user opens them: sections with a real habit (score >= MIN_SCORE) first, most
 * used first; everything else keeps the standard order after them. Stable for the whole launch.
 */
export function rankByUsage<T>(items: T[], keysOf: (item: T) => string[], snap: Store | null): T[] {
  if (!snap) return items;
  const now = Date.now();
  const scored = items.map((item, i) => ({ item, i, s: scoreOf(keysOf(item), snap, now) }));
  const used = scored.filter((x) => x.s >= MIN_SCORE).sort((a, b) => b.s - a.s || a.i - b.i);
  const rest = scored.filter((x) => x.s < MIN_SCORE);
  return [...used, ...rest].map((x) => x.item);
}

/** This launch's usage snapshot (null for the few milliseconds before the phone storage is read). */
export function useSectionUsage(): Store | null {
  const [snap, setSnap] = useState<Store | null>(snapshot);
  useEffect(() => {
    if (snapshot) { setSnap(snapshot); return; }
    const fn = () => setSnap(snapshot);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return snap;
}
