// Every backend call the partner app makes (one backend: /c/hostel-bite/backend on Render).
import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiFetch, ApiError, apiUploadForm, NetworkError } from './http';
import { normalizeMenuItem, normalizeOrder, normalizeStore } from './model';
import type { Compliance, ComplianceEdit, MenuItem, Order, StoreState } from '../types';

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

export function login(id: string, password: string): Promise<{ restaurant: any; token: string }> {
  // app:'restaurant' lets the server refuse stall (local vendor) accounts, which belong in Zenvy Vendor.
  return apiFetch('/api/restaurants/login', { method: 'POST', body: { id, password, app: 'restaurant' }, auth: false, timeoutMs: 45000 });
}

const STALL_TYPES = new Set(['LOCAL_VENDOR', 'LOCAL', 'STALL', 'STALLS']);

/**
 * Stall accounts deliver their own orders (Out for delivery / Delivered), which this app cannot do, so their
 * orders would get stuck here. They must use the Zenvy Vendor app.
 */
export function isStallAccount(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.isLocalVendor === true) return true;
  return STALL_TYPES.has(String(raw.vendorType ?? '').trim().toUpperCase());
}

/** Store profile + live open state (public, no-cache on the server). */
export async function getStore(id: string): Promise<{ store: StoreState; raw: any }> {
  const raw = await apiFetch(`/api/users/restaurants/${enc(id)}`);
  return { store: normalizeStore(raw), raw };
}

/**
 * `scope: 'active'` (routine polls / socket refreshes): only open orders plus today's (IST) finished ones,
 * so the kitchen poll stays small. Without it: the latest 200 orders (Past tab + 7-day history).
 */
export async function getOrders(id: string, scope?: 'active'): Promise<Order[]> {
  const rows = await apiFetch<any[]>(`/api/restaurants/${enc(id)}/orders${scope ? `?scope=${scope}` : ''}`);
  return (Array.isArray(rows) ? rows : []).map(normalizeOrder).filter((o): o is Order => !!o);
}

export function acceptOrder(orderId: string, estDuration: number) {
  return apiFetch(`/api/orders/${enc(orderId)}/status`, { method: 'PUT', body: { status: 'Accepted', estDuration } });
}

export function rejectOrder(orderId: string, reason: string): Promise<{ status?: string; refundedToWallet?: number }> {
  return apiFetch(`/api/orders/${enc(orderId)}/status`, { method: 'PUT', body: { status: 'Rejected', reason: reason.slice(0, 250) } });
}

/** 200 `{ status: 'Picking' }` when the rider is already at the counter (status stays Picking). */
export function markReady(orderId: string): Promise<{ status?: string }> {
  return apiFetch(`/api/orders/${enc(orderId)}/status`, { method: 'PUT', body: { status: 'ReadyForPickup' } });
}

export async function getMenu(id: string): Promise<MenuItem[]> {
  const rows = await apiFetch<any[]>(`/api/restaurants/${enc(id)}/menu`, { auth: false });
  return (Array.isArray(rows) ? rows : []).map(normalizeMenuItem).filter((m): m is MenuItem => !!m);
}

/** Always an explicit value: { isAvailable } or { outOfStockUntil: ISO }. 404 = item deleted; 401 logs out. */
export function setAvailability(itemId: string, body: { isAvailable: boolean } | { outOfStockUntil: string }) {
  return apiFetch<{ isAvailable?: boolean; outOfStockUntil?: string | null }>(
    `/api/restaurants/menu/${enc(itemId)}/toggle`, { method: 'PUT', body },
  );
}

export function setPrice(itemId: string, price: number) {
  return apiFetch(`/api/restaurants/menu/${enc(itemId)}`, { method: 'PUT', body: { price } });
}

/** Thrown when the server has no open/close route yet. */
export class OpenToggleUnsupported extends Error {}

export async function setOpen(id: string, isOpenNow: boolean): Promise<StoreState> {
  try {
    const raw = await apiFetch(`/api/restaurants/${enc(id)}/open`, { method: 'PUT', body: { isOpenNow } });
    return normalizeStore(raw);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && !/restaurant not found/i.test(e.message)) {
      throw new OpenToggleUnsupported('Store open/close is not available yet');
    }
    throw e;
  }
}

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
  /** MRP >= price; null clears it. */
  originalPrice: number | null;
  /** Create honours it in the same write (an out-of-stock dish is never live for a moment). */
  isAvailable?: boolean;
  /** Sent only to drop an old "egg" tag when the dish is no longer egg. */
  tags?: string[];
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

/**
 * POST /api/upload (multipart field "image", JPEG/PNG/WEBP, max 2 MB). Returns the URL to save on the item.
 * Phone: multipart through XHR (see apiUploadForm); if that cannot reach the server, the same endpoint's
 * JSON { image: dataUrl } form through fetch. Web: the browser's fetch sends a Blob part fine.
 */
export async function uploadPhoto(uri: string, mimeType = 'image/jpeg'): Promise<string> {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  let res: { imageUrl?: string } | null = null;
  if (Platform.OS === 'web') {
    const form = new FormData();
    const blob = await (await fetch(uri)).blob();
    form.append('image', blob, `item.${ext}`);
    res = await apiFetch<{ imageUrl?: string }>('/api/upload', { method: 'POST', form, no401Logout: true, timeoutMs: 60000 });
  } else {
    const form = new FormData();
    // React Native's FormData file shape.
    form.append('image', { uri, name: `item.${ext}`, type: mimeType } as any);
    try {
      res = await apiUploadForm<{ imageUrl?: string }>('/api/upload', form, 60000);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      const image = await dataUrlOf(uri);
      if (!image) throw e;
      res = await apiFetch<{ imageUrl?: string }>('/api/upload', { method: 'POST', body: { image }, no401Logout: true, timeoutMs: 60000 });
    }
  }
  if (!res?.imageUrl) throw new ApiError(500, "The photo didn't upload. Please try again.", res);
  return res.imageUrl;
}

// ── Push (new orders / cancellations while the app is closed) ───────────────
/** POST /api/restaurants/fcm-token: this phone gets the store's order pushes (moves off any other store). */
export function registerPushToken(token: string, app: 'restaurant' | 'vendor' = 'restaurant') {
  return apiFetch<{ ok: boolean; registered: boolean; devices: number }>(
    '/api/restaurants/fcm-token', { method: 'POST', body: { token, app }, no401Logout: true },
  );
}

/** POST /api/restaurants/fcm-token/remove (on logout, while the token is still valid). */
export function removePushToken(token: string) {
  return apiFetch('/api/restaurants/fcm-token/remove', { method: 'POST', body: { token }, no401Logout: true, timeoutMs: 8000 });
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

// ── Compliance (FSSAI licence, legal name, GSTIN; payout details are read-only) ──
export interface ComplianceReply { compliance: Compliance; changed?: string[] }

/** GET /api/restaurants/:id/compliance (own store only). */
export async function getCompliance(id: string): Promise<Compliance> {
  const res = await apiFetch<any>(`/api/restaurants/${enc(id)}/compliance`, { no401Logout: true });
  if (!res?.compliance) throw new ApiError(500, 'Could not load your licence details. Please try again.', res);
  return res.compliance as Compliance;
}

/**
 * PUT /api/restaurants/:id/compliance. null / '' clears a field. 400 { code: 'INVALID_COMPLIANCE', field, message }
 * is thrown as ApiError (read e.data.field). A new licence number / type / expiry goes back to PENDING.
 */
export async function saveCompliance(id: string, body: ComplianceEdit): Promise<ComplianceReply> {
  const res = await apiFetch<any>(`/api/restaurants/${enc(id)}/compliance`, { method: 'PUT', body, no401Logout: true, timeoutMs: 30000 });
  if (!res?.compliance) throw new ApiError(500, 'Saved, but the reply was empty. Pull down to refresh.', res);
  return { compliance: res.compliance as Compliance, changed: Array.isArray(res.changed) ? res.changed : undefined };
}
