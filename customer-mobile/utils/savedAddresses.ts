import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './auth';
import { API_URL } from '../constants/api';

/**
 * Saved delivery places ("Hostel", "Library", "Block B lab"...), picked at checkout.
 *
 * Kept in AsyncStorage (`zenvy_saved_addresses`, cleared on sign-out) and on the account
 * (GET / PUT /api/users/addresses), so they follow the user to a new phone. The first sync on a device
 * merges the local places in; after that the account is the source. A server without the endpoint (or
 * offline) leaves the local list working.
 */
export type SavedPlace = { id: string; label: string; block: string; room: string; landmark: string };

export const PLACE_LABELS = ['Hostel', 'Library', 'Lab', 'Friend', 'Other'] as const;
export const MAX_PLACES = 10;

const KEY = 'zenvy_saved_addresses';
const URL = `${API_URL}/api/users/addresses`;
const syncedKey = (userId: string) => `zenvy_addr_synced_${userId}`;

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const clean = (v: any): SavedPlace[] => (Array.isArray(v) ? v : [])
  .filter((p) => p && typeof p === 'object')
  .map((p) => ({
    id: String(p.id || newId()),
    label: String(p.label || 'Saved place').slice(0, 24),
    block: String(p.block || '').slice(0, 60),
    room: String(p.room || '').slice(0, 30),
    landmark: String(p.landmark || '').slice(0, 120),
  }))
  .filter((p) => p.block || p.room || p.landmark)
  .slice(0, MAX_PLACES);

/** The text that goes into the checkout address box. */
export const placeText = (p: SavedPlace): string => {
  const main = p.block && p.room ? `${p.block}, Room ${p.room}` : (p.block || (p.room ? `Room ${p.room}` : ''));
  return [main, p.landmark].filter(Boolean).join(', ');
};

/** A place from the typed address (block + room when it reads like one, else the whole text). */
export const placeFromText = (text: string, label: string, parsed?: { block: string; room: string } | null): SavedPlace => {
  const t = String(text || '').trim();
  if (parsed && parsed.block && parsed.room) {
    const rest = t.replace(new RegExp(`^\\s*${parsed.block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?\\s*(room\\s*#?\\s*)?${parsed.room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?\\s*`, 'i'), '');
    return { id: newId(), label, block: parsed.block, room: parsed.room, landmark: rest === t ? '' : rest.slice(0, 120) };
  }
  return { id: newId(), label, block: '', room: '', landmark: t.slice(0, 120) };
};

export async function getLocalPlaces(): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return clean(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

async function saveLocal(list: SavedPlace[]) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch { /* memory state still holds it */ }
}

async function pushToServer(list: SavedPlace[]) {
  try {
    await apiFetch(URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses: list }) });
  } catch { /* offline: the next sync sends it */ }
}

const sameText = (a: SavedPlace, b: SavedPlace) => placeText(a).toLowerCase() === placeText(b).toLowerCase();

export async function syncPlaces(userId?: string | null): Promise<SavedPlace[]> {
  const local = await getLocalPlaces();
  if (!userId) return local;
  try {
    const res = await apiFetch(URL);
    if (!res.ok) return local; // older server: local only
    const data = await res.json().catch(() => null);
    const server = clean(data?.addresses);
    let firstSync = false;
    try { firstSync = !(await AsyncStorage.getItem(syncedKey(userId))); } catch {}
    let next = server;
    if (firstSync) {
      next = [...server];
      for (const p of local) if (!next.some((q) => sameText(p, q))) next.push(p);
      next = next.slice(0, MAX_PLACES);
      if (next.length !== server.length) await pushToServer(next);
      try { await AsyncStorage.setItem(syncedKey(userId), '1'); } catch {}
    }
    await saveLocal(next);
    return next;
  } catch {
    return local;
  }
}

/** Adds (or relabels the same address) and returns the new list. */
export async function addPlace(place: SavedPlace, signedIn: boolean): Promise<SavedPlace[]> {
  const list = await getLocalPlaces();
  const i = list.findIndex((p) => sameText(p, place));
  const next = i >= 0
    ? list.map((p, j) => (j === i ? { ...p, label: place.label } : p))
    : [place, ...list].slice(0, MAX_PLACES);
  await saveLocal(next);
  if (signedIn) await pushToServer(next);
  return next;
}

export async function removePlace(id: string, signedIn: boolean): Promise<SavedPlace[]> {
  const next = (await getLocalPlaces()).filter((p) => p.id !== id);
  await saveLocal(next);
  if (signedIn) await pushToServer(next);
  return next;
}
