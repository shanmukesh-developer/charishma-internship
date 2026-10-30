// Every backend call the vendor app makes (one backend: /c/hostel-bite/backend on Render).
// Contract: scratchpad vendor_contract.md. Reuses the restaurant routes; local vendors are Restaurant rows
// with vendorType LOCAL_VENDOR and log in with role "restaurant".
import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiFetch, ApiError, apiUploadForm, isWakingStatus, NetworkError, probeServer, UPLOAD_MESSAGES, uploadStatusMessage } from './http';
import { normalizeMenuItem, normalizeOrder, normalizeStore } from './model';
import type { Compliance, ComplianceEdit, MenuItem, OperatingHours, Order, StoreState } from '../types';

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

/** Shop profile + live open state (public, no-cache on the server). */
export async function getStore(id: string): Promise<{ store: StoreState; raw: any }> {
  const raw = await apiFetch(`/api/users/restaurants/${enc(id)}`);
  return { store: normalizeStore(raw), raw };
}

/**
 * The stall's orders, with the customer's name + phone (owning vendor only, contract §4).
 * `scope: 'active'` (routine polls / socket refreshes): only open orders plus today's (IST) finished ones,
 * so the poll stays small. Without it: the latest 200 orders (Done tab + 7-day numbers).
 */
export async function getOrders(id: string, scope?: 'active'): Promise<Order[]> {
  const rows = await apiFetch<any[]>(`/api/restaurants/${enc(id)}/orders${scope ? `?scope=${scope}` : ''}`);
  return (Array.isArray(rows) ? rows : []).map(normalizeOrder).filter((o): o is Order => !!o);
}

export type VendorStatus = 'Accepted' | 'OutForDelivery' | 'Delivered' | 'Cancelled';

/** PUT /api/orders/:id/status (contract §3). Cancelled needs a reason (shown to the customer). */
export function setOrderStatus(orderId: string, status: VendorStatus, reason?: string): Promise<{ status?: string }> {
  const body: Record<string, unknown> = { status };
  if (reason) body.reason = reason.slice(0, 250);
  return apiFetch(`/api/orders/${enc(orderId)}/status`, { method: 'PUT', body });
}

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
export async function setOpen(id: string, isOpenNow: boolean): Promise<StoreState> {
  const raw = await apiFetch(`/api/restaurants/${enc(id)}/open`, { method: 'PUT', body: { isOpenNow } });
  return normalizeStore(raw);
}

/** PUT /api/restaurants/:id/hours { operatingHours: { start, end } } (start === end = open all day). */
export async function setHours(id: string, hours: OperatingHours): Promise<StoreState> {
  const raw = await apiFetch(`/api/restaurants/${enc(id)}/hours`, { method: 'PUT', body: { operatingHours: hours } });
  return normalizeStore(raw);
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

// ── Push (new orders / cancellations while the app is closed) ───────────────
/** POST /api/restaurants/fcm-token: this phone gets the stall's order pushes (moves off any other store). */
export function registerPushToken(token: string, app: 'restaurant' | 'vendor' = 'vendor') {
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

// -- Whole category in / out of stock ------------------------------------------
/** PUT /api/restaurants/:id/menu/category-stock: every item of one menu category (this store's own only). */
export function setCategoryStock(id: string, category: string, isAvailable: boolean) {
  return apiFetch<{ updated?: number; total?: number; items?: { id: string; isAvailable: boolean; outOfStockUntil?: string | null }[] }>(
    `/api/restaurants/${enc(id)}/menu/category-stock`, { method: 'PUT', body: { category, isAvailable } },
  );
}

// -- Payout statements (read only) ---------------------------------------------
export interface PayoutStatement {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  orderCount: number;
  /** Rupees. net = gross - commission + adjustments (can be negative when the store kept the cash). */
  gross: number;
  commission: number;
  adjustments: number;
  net: number;
  status: string; // PENDING | PAID
  method: string | null;
  utr: string | null;
  paidAt: string | null;
  createdAt: string | null;
}
export interface StorePayouts {
  /** Delivered orders not on a statement yet. */
  pending: { orders: number; net: number };
  payouts: PayoutStatement[];
  hasMore: boolean;
}

const moneyOf = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** GET /api/restaurants/:id/payouts?page= : this store's statements, newest first (cancelled ones left out). */
export async function getPayouts(id: string, page = 1): Promise<StorePayouts> {
  const d: any = await apiFetch(`/api/restaurants/${enc(id)}/payouts?page=${page}&limit=20`);
  const list = Array.isArray(d?.payouts) ? d.payouts : [];
  return {
    pending: { orders: moneyOf(d?.notYetOnStatement?.orders), net: moneyOf(d?.notYetOnStatement?.net) },
    payouts: list.map((p: any) => ({
      id: String(p.id),
      periodStart: strOrNull(p.periodStart),
      periodEnd: strOrNull(p.periodEnd),
      orderCount: moneyOf(p.orderCount),
      gross: moneyOf(p.gross),
      commission: moneyOf(p.commission),
      adjustments: moneyOf(p.adjustments),
      net: moneyOf(p.net),
      status: String(p.status || 'PENDING'),
      method: strOrNull(p.method),
      utr: strOrNull(p.utr),
      paidAt: strOrNull(p.paidAt),
      createdAt: strOrNull(p.createdAt),
    })),
    hasMore: d?.hasMore === true,
  };
}
