import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './auth';
import { API_URL } from '../constants/api';

/**
 * Favourite stores (the hearts on Home and the store page).
 *
 * The list lives in AsyncStorage (`zenvy_favorites`, cleared on sign-out) and, when signed in, on the
 * account (GET / PUT /api/users/favorites), so it survives a reinstall or a new phone. The first sync
 * on a device merges the local hearts into the account; after that the account is the source. A server
 * without the endpoint (or offline) simply leaves the local list working.
 */
const KEY = 'zenvy_favorites';
const URL = `${API_URL}/api/users/favorites`;
const syncedKey = (userId: string) => `zenvy_fav_synced_${userId}`;

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();
let current: string[] | null = null;

const clean = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).map(String) : []);
const emit = (ids: string[]) => { current = ids; listeners.forEach((l) => l(ids)); };

export function onFavoritesChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function getLocalFavorites(): Promise<string[]> {
  // Always read storage: sign-out clears the key (AuthContext), so a memory copy could go stale.
  try {
    const raw = await AsyncStorage.getItem(KEY);
    current = clean(raw ? JSON.parse(raw) : []);
  } catch {
    current = [];
  }
  return current;
}

async function saveLocal(ids: string[]) {
  emit(ids);
  try { await AsyncStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* storage full: memory copy still works */ }
}

async function pushToServer(ids: string[]) {
  try {
    await apiFetch(URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeIds: ids }) });
  } catch { /* offline: the next sync sends it */ }
}

/** Pull the account's list (merging this device's hearts in on its first sync). */
export async function syncFavorites(userId?: string | null): Promise<string[]> {
  const local = await getLocalFavorites();
  if (!userId) return local;
  try {
    const res = await apiFetch(URL);
    if (!res.ok) return local; // older server: local only
    const data = await res.json().catch(() => null);
    const server = clean(data?.storeIds).map((s) => s.toLowerCase());
    let firstSync = false;
    try { firstSync = !(await AsyncStorage.getItem(syncedKey(userId))); } catch {}
    const next = firstSync
      ? Array.from(new Set([...server, ...local.map((s) => s.toLowerCase())]))
      : server;
    if (firstSync) {
      if (next.length !== server.length) await pushToServer(next);
      try { await AsyncStorage.setItem(syncedKey(userId), '1'); } catch {}
    }
    await saveLocal(next);
    return next;
  } catch {
    return local;
  }
}

/** Heart / un-heart a store. Returns the new list. */
export async function toggleFavoriteStore(id: string, signedIn: boolean): Promise<string[]> {
  const key = String(id || '').toLowerCase();
  if (!key) return getLocalFavorites();
  const list = await getLocalFavorites();
  const has = list.some((x) => x.toLowerCase() === key);
  const next = has ? list.filter((x) => x.toLowerCase() !== key) : [...list, key];
  await saveLocal(next);
  if (signedIn) pushToServer(next);
  return next;
}

export const isFavoriteIn = (list: string[], id: any) => {
  const key = String(id || '').toLowerCase();
  return !!key && list.some((x) => x.toLowerCase() === key);
};

/** The last list seen this session (for a first paint before storage is read). */
export const peekFavorites = () => current;
