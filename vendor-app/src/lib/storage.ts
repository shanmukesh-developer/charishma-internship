// AsyncStorage wrappers: session (JWT + whitelisted stall profile), saved login phone, voice settings.
// Every read/write is guarded: storage failures never crash the app (it keeps working from memory).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { STORAGE } from '../config';
import type { StoreProfile } from '../types';

const PROFILE_FIELDS = [
  'id', 'name', 'location', 'imageUrl', 'campus', 'operatingHours', 'isOpenNow', 'vendorType', 'whatsappNumber', 'phone',
] as const;

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

/** The bearer token lives in expo-secure-store (Android Keystore), not AsyncStorage, so it is never copied
 * into Google auto-backup / adb backup. SecureStore keys allow only [A-Za-z0-9._-]. */
const SECURE_TOKEN_KEY = 'zenvy_vendor_token';

async function secureGetToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(SECURE_TOKEN_KEY); } catch { return null; }
}
/** C9: when SecureStore is unavailable (web / keystore error) the token is kept in memory only, for this
 * run of the app. It is never written to AsyncStorage (which is plain text and could reach backups). */
let memoryToken: string | null = null;
/** Stores the token in SecureStore, or in memory when that fails; always removes an AsyncStorage copy. */
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

/** Only the fields the app needs; never the password hash. */
export function pickProfile(raw: any): StoreProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw._id;
  if (typeof id !== 'string' || !id) return null;
  const out: any = {};
  for (const f of PROFILE_FIELDS) if (raw[f] !== undefined && raw[f] !== null) out[f] = raw[f];
  out.id = id;
  out.name = typeof raw.name === 'string' ? raw.name : '';
  if (typeof out.operatingHours === 'string') {
    try { out.operatingHours = JSON.parse(out.operatingHours); } catch { out.operatingHours = null; }
  }
  return out as StoreProfile;
}

export async function loadSession(): Promise<{ token: string | null; restaurant: StoreProfile | null }> {
  const secure = await secureGetToken();
  // A token an older build left in AsyncStorage is moved into SecureStore (or memory) and deleted there.
  const legacy = secure || memoryToken ? null : await safeGet(STORAGE.token);
  const t = secure || memoryToken || legacy;
  const token = t ? t.replace(/['"]+/g, '').trim() || null : null;
  if (legacy) {
    if (token) await saveToken(token);
    else await safeRemove([STORAGE.token]);
  }
  const raw = await safeGet(STORAGE.vendor);
  let restaurant: StoreProfile | null = null;
  if (raw) {
    try { restaurant = pickProfile(JSON.parse(raw)); } catch { restaurant = null; }
  }
  if (!token || !restaurant) return { token: null, restaurant: null };
  return { token, restaurant };
}

export async function saveSession(token: string, restaurant: StoreProfile): Promise<void> {
  await saveToken(token);
  await safeSet(STORAGE.vendor, JSON.stringify(restaurant));
}

export async function saveProfile(restaurant: StoreProfile): Promise<void> {
  await safeSet(STORAGE.vendor, JSON.stringify(restaurant));
}

export async function clearSession(): Promise<void> {
  await safeRemove([STORAGE.token, STORAGE.vendor]);
  await clearToken();
}

export async function loadSavedPhone(): Promise<string | null> {
  return (await safeGet(STORAGE.savedPhone)) || null;
}
export async function setSavedPhone(v: string | null): Promise<void> {
  if (v) await safeSet(STORAGE.savedPhone, v);
  else await safeRemove([STORAGE.savedPhone]);
}
