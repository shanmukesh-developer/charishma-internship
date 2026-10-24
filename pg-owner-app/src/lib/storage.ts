// Session storage: the bearer token in expo-secure-store (Android Keystore, never in backups), the
// whitelisted owner profile + saved phone + chosen PG in AsyncStorage. Storage failures never crash the app.
// Same rules as auto-driver-app/src/lib/storage.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { STORAGE } from '../config';
import type { ListingBrief, OwnerSelf } from '../types';

export async function safeGet(key: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(key); } catch { return null; }
}
export async function safeSet(key: string, value: string): Promise<void> {
  try { await AsyncStorage.setItem(key, value); } catch { /* keep working from memory */ }
}
export async function safeRemove(keys: string[]): Promise<void> {
  for (const k of keys) {
    try { await AsyncStorage.removeItem(k); } catch { /* ignore */ }
  }
}

/** SecureStore keys allow only [A-Za-z0-9._-]. */
const SECURE_TOKEN_KEY = 'zcs_pgowner_token';

async function secureGetToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(SECURE_TOKEN_KEY); } catch { return null; }
}
/** When SecureStore is unavailable the token is kept in memory only (never AsyncStorage: plain text). */
let memoryToken: string | null = null;
async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
    memoryToken = null;
  } catch {
    memoryToken = token;
  }
  await safeRemove([STORAGE.token]);
}
async function clearToken(): Promise<void> {
  memoryToken = null;
  try { await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY); } catch { /* ignore */ }
}

export type SavedOwner = Pick<OwnerSelf, 'id' | 'name' | 'phone' | 'mustChangePassword'> & { listings: ListingBrief[] };

/** Only what the app needs to draw the first screen; everything else is refetched. */
export function pickOwner(raw: any): SavedOwner | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const listings = Array.isArray(raw.listings)
    ? raw.listings.filter((l: any) => l && typeof l.id === 'string').map((l: any) => ({ id: l.id, name: String(l.name || ''), area: typeof l.area === 'string' ? l.area : null, isActive: l.isActive !== false }))
    : [];
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    mustChangePassword: !!raw.mustChangePassword,
    listings,
  };
}

export async function loadSession(): Promise<{ token: string | null; owner: SavedOwner | null }> {
  const t = (await secureGetToken()) || memoryToken;
  const token = t ? t.replace(/['"]+/g, '').trim() || null : null;
  const raw = await safeGet(STORAGE.owner);
  let owner: SavedOwner | null = null;
  if (raw) {
    try { owner = pickOwner(JSON.parse(raw)); } catch { owner = null; }
  }
  if (!token || !owner) return { token: null, owner: null };
  return { token, owner };
}

export async function saveSession(token: string, owner: SavedOwner): Promise<void> {
  await saveToken(token);
  await safeSet(STORAGE.owner, JSON.stringify(owner));
}
export async function saveOwner(owner: SavedOwner): Promise<void> {
  await safeSet(STORAGE.owner, JSON.stringify(owner));
}
export async function clearSession(): Promise<void> {
  await safeRemove([STORAGE.token, STORAGE.owner, STORAGE.queue, STORAGE.listing]);
  await clearToken();
}

export async function loadSavedPhone(): Promise<string | null> {
  return (await safeGet(STORAGE.savedPhone)) || null;
}
export async function setSavedPhone(v: string | null): Promise<void> {
  if (v) await safeSet(STORAGE.savedPhone, v);
  else await safeRemove([STORAGE.savedPhone]);
}
