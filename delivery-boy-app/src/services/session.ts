// Session storage for the rider token, cached profile and small offline caches.
// The bearer token lives in expo-secure-store (Android Keystore), not AsyncStorage, so it is not copied
// into backups. A token left in AsyncStorage by an older build is moved over on first read (then deleted).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { KEYS } from '../config';
import type { RiderProfile } from '../types';

const CACHE_PREFIX = KEYS.cachePrefix;
/** SecureStore keys allow only [A-Za-z0-9._-]. */
const SECURE_TOKEN_KEY = 'zenvy_rider_token';

async function secureGet(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** true when the token is now in SecureStore. */
async function secureSet(token: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
    return true;
  } catch {
    return false; // no SecureStore (web) or keystore error
  }
}

async function secureDelete(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** C9: when SecureStore is unavailable (web / keystore error) the token lives in memory only, for this run
 * of the app. It is never written to AsyncStorage (plain text, could reach backups). */
let memoryToken: string | null = null;

async function removeAsyncToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS.token);
  } catch {
    // ignore
  }
}

async function loadToken(): Promise<string | null> {
  const secure = await secureGet();
  if (secure) return secure;
  if (memoryToken) return memoryToken;
  // A token an older build left in AsyncStorage: move it into SecureStore (or memory), then delete it there.
  const legacy = await safeGet(KEYS.token);
  if (legacy) {
    if (!(await secureSet(legacy))) memoryToken = legacy;
    await removeAsyncToken();
  }
  return legacy;
}

async function safeGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function safeSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // storage full or unavailable: the app keeps working from memory
  }
}

export async function loadSession(): Promise<{ token: string | null; profile: RiderProfile | null }> {
  const [token, rawProfile] = await Promise.all([loadToken(), safeGet(KEYS.profile)]);
  let profile: RiderProfile | null = null;
  if (rawProfile) {
    try {
      const p = JSON.parse(rawProfile);
      // Only trust caches written by this app version (they carry an id and isApproved).
      if (p && typeof p.id === 'string' && typeof p.isApproved === 'boolean') profile = p;
    } catch {
      profile = null;
    }
  }
  return { token: token ? token.replace(/['"]+/g, '').trim() || null : null, profile };
}

export async function saveToken(token: string): Promise<void> {
  memoryToken = (await secureSet(token)) ? null : token; // web / keystore failure: memory only
  await removeAsyncToken();
}

export async function saveProfile(profile: RiderProfile): Promise<void> {
  await safeSet(KEYS.profile, JSON.stringify(profile));
}

export async function clearSession(): Promise<void> {
  memoryToken = null;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    // Also drop this phone's skipped-orders list so the next rider who logs in sees the full pool.
    await AsyncStorage.removeMany([KEYS.token, KEYS.profile, KEYS.dismissed, ...ours]);
  } catch {
    // ignore
  }
  await secureDelete();
}

/** Last good server result, shown when offline with a "Last updated" time. */
export interface Cached<T> {
  savedAt: number;
  data: T;
}

export async function readCache<T>(name: string): Promise<Cached<T> | null> {
  const raw = await safeGet(CACHE_PREFIX + name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.savedAt === 'number' ? (parsed as Cached<T>) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(name: string, data: T): Promise<void> {
  await safeSet(CACHE_PREFIX + name, JSON.stringify({ savedAt: Date.now(), data }));
}

export async function getItem(key: string): Promise<string | null> {
  return safeGet(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await safeSet(key, value);
}
