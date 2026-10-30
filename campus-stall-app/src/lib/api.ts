// ZCS Campus Stall: the shared stall calls (one backend: /c/hostel-bite/backend on Render). Login reuses the
// stall's ZCS Vendor account (POST /api/restaurants/login, app 'vendor': stalls only); the menu reuses the
// restaurant menu routes. In-Campus Booking calls live in ./campusApi.ts.
import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiFetch, ApiError, apiUploadForm, isWakingStatus, NetworkError, probeServer, UPLOAD_MESSAGES, uploadStatusMessage } from './http';
import { normalizeMenuItem } from './model';
import type { MenuItem } from '../types';

const enc = encodeURIComponent;

/** true when the server answered at all (it sleeps on Render's free tier). */
export async function health(): Promise<boolean> {
  try {
    await apiFetch('/api/health', { auth: false, timeoutMs: 8000 });
    return true;
  } catch (e) {
    return e instanceof ApiError && e.status < 500;
  }
}

/** Indian mobile → 10 digits ("+91 98765-43210" → "9876543210"); null when it is not a phone number. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/\D/g, '');
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return null;
}

/**
 * POST /api/restaurants/login. A phone number is sent as `phone` (contract §1); anything else (a stall ID
 * given by Zenvy support) goes as `id`, which the server already accepts today.
 */
export function login(identifier: string, password: string): Promise<{ restaurant: any; token: string }> {
  const phone = normalizePhone(identifier);
  const body = phone ? { phone, password, app: 'vendor' } : { id: identifier.trim(), password, app: 'vendor' };
  return apiFetch('/api/restaurants/login', { method: 'POST', body, auth: false, timeoutMs: 45000 });
}

const LOCAL_TYPES = new Set(['LOCAL_VENDOR', 'LOCAL', 'STALL', 'STALLS']);

/**
 * true = a stall (local vendor) account, false = a restaurant account (rider-delivered orders, belongs in
 * Zenvy Restaurant), null = the profile does not say (older saved session): let it through.
 */
export function isLocalVendorAccount(raw: any): boolean | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.isLocalVendor === 'boolean') return raw.isLocalVendor;
  const t = String(raw.vendorType ?? '').trim().toUpperCase();
  if (!t) return null;
  return LOCAL_TYPES.has(t);
}

/** The stall menu (public route; the stall sees every item, sold out ones too). */
export async function getMenu(id: string): Promise<MenuItem[]> {
  // Signed in: the server skips its public cache for the store's own menu (an Out of stock tap used to flip back).
  const rows = await apiFetch<any[]>(`/api/restaurants/${enc(id)}/menu`);
  return (Array.isArray(rows) ? rows : []).map(normalizeMenuItem).filter((m): m is MenuItem => !!m);
}

/** 404 = item deleted. */
export function setAvailability(itemId: string, isAvailable: boolean) {
  return apiFetch<{ isAvailable?: boolean }>(
    `/api/restaurants/menu/${enc(itemId)}/toggle`, { method: 'PUT', body: { isAvailable } },
  );
}

/** PUT /api/restaurants/:id/open { isOpenNow } → { isOpenNow, isOpen, opensAt, closedReason, operatingHours }. */
// ── Menu items (add / edit / delete) ────────────────────────────────────────
/** Fields the vendor menu routes accept (POST /api/restaurants/menu, PUT /api/restaurants/menu/:id). */
export interface MenuItemBody {
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  isVegetarian: boolean;
  /** veg / nonveg / egg (the server keeps isVegetarian in step). */
  dietType: 'veg' | 'nonveg' | 'egg';
  /** Sent only to drop an old "egg" tag when the dish is no longer egg. */
  tags?: string[];
  /** Create honours it in the same write; on edit sent only when it changed. */
  isAvailable?: boolean;
}

/**
 * `idempotencyKey`: the same key for every retry of one "Add item" tap, so a retry after a timeout (the first
 * request may have been saved) does not create the item twice on a server that honours the header.
 */
export async function createMenuItem(body: MenuItemBody, idempotencyKey?: string): Promise<MenuItem> {
  const raw = await apiFetch('/api/restaurants/menu', {
    method: 'POST', body, no401Logout: true, timeoutMs: 30000,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
  const item = normalizeMenuItem(raw);
  if (!item) throw new ApiError(500, 'The item was saved but the reply was empty. Pull down to refresh your menu.', raw);
  return item;
}

export async function updateMenuItem(itemId: string, body: Partial<MenuItemBody>): Promise<MenuItem | null> {
  const raw = await apiFetch(`/api/restaurants/menu/${enc(itemId)}`, { method: 'PUT', body, no401Logout: true, timeoutMs: 30000 });
  return normalizeMenuItem(raw);
}

/** DELETE /api/restaurants/menu/:itemId → 200 { id }; 404 { code: 'ITEM_NOT_FOUND' } = already gone. */
export async function deleteMenuItem(itemId: string): Promise<void> {
  await apiFetch(`/api/restaurants/menu/${enc(itemId)}`, { method: 'DELETE', no401Logout: true });
}

/** JPEG data URL of a local photo (fallback upload body), or null when it cannot be read. */
async function dataUrlOf(uri: string): Promise<string | null> {
  try {
    const ref = await ImageManipulator.manipulate(uri).renderAsync();
    const out = await ref.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
    return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
  } catch {
    return null;
  }
}

const UPLOAD_TIMEOUT_MS = 90000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** No answer, a timeout, or a "waking up" status (408 / 502-504): worth the one automatic retry. */
const retryable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && isWakingStatus(e.status));
/** Server errors from the JSON transport carry the upload wording too (too large, session expired, ...). */
const asUploadError = (e: unknown) => (e instanceof ApiError ? new ApiError(e.status, uploadStatusMessage(e.status, e.data), e.data) : e);

/**
 * POST /api/upload (multipart field "image", JPEG/PNG/WEBP, max 2 MB). Returns the URL to save on the item.
 * Phone: attempt 1 = multipart through XHR (see apiUploadForm); after no answer, a timeout or a "waking up"
 * status, ONE retry with the same endpoint's JSON { image: dataUrl } form through fetch (a different
 * transport). Web: the browser's fetch sends a Blob part fine (retried once the same way).
 * 90 s per attempt. A final failure says the real cause: waking up / interrupted / couldn't reach Zenvy.
 */
export async function uploadPhoto(uri: string, mimeType = 'image/jpeg'): Promise<string> {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const multipart = async (): Promise<{ imageUrl?: string }> => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('image', blob, `item.${ext}`);
      return apiFetch<{ imageUrl?: string }>('/api/upload', { method: 'POST', form, no401Logout: true, timeoutMs: UPLOAD_TIMEOUT_MS });
    }
    // React Native's FormData file shape.
    form.append('image', { uri, name: `item.${ext}`, type: mimeType } as any);
    return apiUploadForm<{ imageUrl?: string }>('/api/upload', form, UPLOAD_TIMEOUT_MS);
  };
  const json = async (): Promise<{ imageUrl?: string } | null> => {
    const image = await dataUrlOf(uri);
    if (!image) return null;
    return apiFetch<{ imageUrl?: string }>('/api/upload', { method: 'POST', body: { image }, no401Logout: true, timeoutMs: UPLOAD_TIMEOUT_MS });
  };

  let res: { imageUrl?: string } | null = null;
  try {
    res = await multipart();
  } catch (first) {
    if (!retryable(first)) throw asUploadError(first);
    console.warn('[uploadPhoto] attempt 1 failed:', (first as Error)?.message);
    await wait(1500);
    try {
      res = Platform.OS === 'web' ? await multipart() : await json();
      if (!res) throw first; // the photo could not be re-encoded for the JSON form
    } catch (second) {
      console.warn('[uploadPhoto] attempt 2 failed:', (second as Error)?.message);
      if (!(second instanceof NetworkError)) throw asUploadError(second);
      if (second.timeout) throw new NetworkError(UPLOAD_MESSAGES.waking, true);
      const state = await probeServer();
      throw new NetworkError(state === 'waking' ? UPLOAD_MESSAGES.waking : state === 'up' ? UPLOAD_MESSAGES.interrupted : UPLOAD_MESSAGES.unreachable);
    }
  }
  if (!res?.imageUrl) throw new ApiError(500, "The photo didn't upload. Please try again.", res);
  return res.imageUrl;
}

// ── Session refresh (optional server feature) ───────────────────────────────
let refreshUnsupported = false;

/**
 * POST /api/restaurants/refresh-token → { token, restaurant? }: swaps a still-valid session for a fresh one,
 * so a phone that stays logged in for weeks is not suddenly logged out mid-shift. Returns null when the
 * server has no such route (404 / 405, remembered for this launch) or anything else goes wrong; never logs out.
 */
export async function refreshSession(): Promise<{ token: string; restaurant?: any } | null> {
  if (refreshUnsupported) return null;
  try {
    const res = await apiFetch<any>('/api/restaurants/refresh-token', { method: 'POST', body: {}, no401Logout: true, timeoutMs: 15000 });
    const token = typeof res?.token === 'string' && res.token ? res.token : null;
    return token ? { token, restaurant: res?.restaurant ?? res?.vendor ?? undefined } : null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) refreshUnsupported = true;
    return null;
  }
}

// -- Whole category in / out of stock ------------------------------------------
/** PUT /api/restaurants/:id/menu/category-stock: every item of one menu category (this store's own only). */
export function setCategoryStock(id: string, category: string, isAvailable: boolean) {
  return apiFetch<{ updated?: number; total?: number; items?: { id: string; isAvailable: boolean; outOfStockUntil?: string | null }[] }>(
    `/api/restaurants/${enc(id)}/menu/category-stock`, { method: 'PUT', body: { category, isAvailable } },
  );
}

