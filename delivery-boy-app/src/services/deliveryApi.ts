// One function per rider endpoint (base: /api). No invented defaults: missing values stay null.
import { ApiError, apiFetch } from './apiClient';
import { normalizeOrder, normalizeOrders, toNumber } from './orderModel';
import { APP_PUSH_VERSION } from '../config';
import type { CashEntry, CashStatus, RiderCash, RiderOrder, RiderProfile, SupportTicket, TodayStats, WeekStats } from '../types';

export function toProfile(raw: any, prev?: RiderProfile | null): RiderProfile {
  const str = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s && s.toLowerCase() !== 'not registered' ? s : null;
  };
  return {
    id: String(raw?._id ?? raw?.id ?? prev?.id ?? ''),
    name: str(raw?.name) ?? prev?.name ?? '',
    phone: str(raw?.phone) ?? prev?.phone ?? '',
    vehicleType: raw && 'vehicleType' in raw ? str(raw.vehicleType) : prev?.vehicleType ?? null,
    vehicleNumber: raw && 'vehicleNumber' in raw ? str(raw.vehicleNumber) : prev?.vehicleNumber ?? null,
    emergencyContact: raw && 'emergencyContact' in raw ? str(raw.emergencyContact) : prev?.emergencyContact ?? null,
    photoUrl: raw && 'photoUrl' in raw ? str(raw.photoUrl) : prev?.photoUrl ?? null,
    isApproved: typeof raw?.isApproved === 'boolean' ? raw.isApproved : prev?.isApproved ?? false,
    isOnline: typeof raw?.isOnline === 'boolean' ? raw.isOnline : prev?.isOnline ?? false,
    // averageRating only (the old `rating` field fell back to an invented 5.0)
    averageRating: raw && 'averageRating' in raw ? toNumber(raw.averageRating) : prev?.averageRating ?? null,
    totalRatings: toNumber(raw?.totalRatings) ?? prev?.totalRatings ?? 0,
    totalEarnings: toNumber(raw?.totalEarnings) ?? prev?.totalEarnings ?? null,
    completedCount: toNumber(raw?.completedCount ?? raw?.completedDeliveries) ?? prev?.completedCount ?? null,
    walletBalance: toNumber(raw?.walletBalance) ?? prev?.walletBalance ?? null,
  };
}

export async function login(phone: string, password: string): Promise<{ token: string; profile: RiderProfile }> {
  const data = await apiFetch<any>('/delivery/login', { method: 'POST', body: { phone, password }, auth: false });
  if (!data?.token) throw new ApiError(500, 'Login failed. Please try again.', data);
  const profile = toProfile({ ...data, averageRating: null, isOnline: false });
  return { token: String(data.token), profile };
}

export async function fetchProfile(prev?: RiderProfile | null): Promise<RiderProfile> {
  return toProfile(await apiFetch<any>('/delivery/profile'), prev);
}

export async function setOnline(isOnline: boolean, token?: string): Promise<boolean> {
  const data = await apiFetch<{ isOnline?: boolean }>('/delivery/online', { method: 'PUT', body: { isOnline }, token });
  return typeof data?.isOnline === 'boolean' ? data.isOnline : isOnline;
}

export async function saveFcmToken(fcmToken: string): Promise<void> {
  await apiFetch('/delivery/fcm-token', { method: 'POST', body: { fcmToken, appVersion: APP_PUSH_VERSION } });
}

/** Logout: stop this phone's order pushes for this rider (POST /delivery/fcm-token/remove). */
export async function removeFcmToken(fcmToken: string, token?: string): Promise<void> {
  await apiFetch('/delivery/fcm-token/remove', { method: 'POST', body: { fcmToken }, token });
}

/**
 * SOS: pages the Zenvy admins (socket + push) with the rider's location and note. `fixAt` is when the phone took
 * the fix (an old one is shown to the admin as "last known"). No fix: the server uses the last live location.
 */
export async function sendSos(p: { lat?: number; lng?: number; accuracy?: number; fixAt?: number; note?: string }): Promise<void> {
  await apiFetch('/delivery/sos', { method: 'POST', body: p, timeoutMs: 20000 });
}

/**
 * Stall (local vendor) orders are delivered by the stall itself: no rider, no PIN. The server already
 * keeps them out of the pool; this filter makes sure one can never show up in the app either.
 */
const isStallOrder = (raw: any) =>
  String(raw?.fulfilment ?? '').toUpperCase() === 'VENDOR' || String(raw?.category ?? '').toUpperCase() === 'LOCAL_VENDOR';

export async function fetchPending(): Promise<RiderOrder[]> {
  const rows = await apiFetch<any[]>('/delivery/orders/pending');
  return normalizeOrders(Array.isArray(rows) ? rows.filter((r) => !isStallOrder(r)) : rows);
}

export async function fetchActive(): Promise<RiderOrder[]> {
  const data = await apiFetch<any>('/delivery/orders/active');
  return normalizeOrders(Array.isArray(data) ? data : data?.orders);
}

export async function fetchHistory(): Promise<RiderOrder[]> {
  // Bare array (no paging params); { orders, hasMore } when paged.
  const data = await apiFetch<any>('/delivery/orders/history');
  return normalizeOrders(Array.isArray(data) ? data : data?.orders);
}

export async function fetchToday(): Promise<TodayStats> {
  const d = await apiFetch<any>('/delivery/stats/today');
  return {
    earnings: toNumber(d?.earnings) ?? 0,
    orders: toNumber(d?.orders) ?? 0,
    zenPoints: toNumber(d?.zenPoints) ?? undefined,
    streak: toNumber(d?.streak) ?? undefined,
    codCollected: toNumber(d?.codCollected) ?? undefined,
    cash: toCashStatus(d?.cash) ?? undefined,
  };
}

function toCashStatus(c: any): CashStatus | null {
  if (!c || typeof c !== 'object' || toNumber(c.cashHeld) === null) return null;
  return {
    cashHeld: toNumber(c.cashHeld) ?? 0,
    limit: toNumber(c.limit) ?? 0,
    limitEnabled: c.limitEnabled === true,
    overLimit: c.overLimit === true,
    depositNeeded: toNumber(c.depositNeeded) ?? 0,
    message: typeof c.message === 'string' && c.message ? c.message : null,
  };
}

function toCashEntry(e: any): CashEntry {
  return {
    id: String(e?.id ?? ''),
    type: String(e?.type ?? ''),
    label: String(e?.label ?? 'Cash change'),
    amount: toNumber(e?.amount) ?? 0,
    balanceAfter: toNumber(e?.balanceAfter) ?? 0,
    method: e?.method ? String(e.method) : null,
    reference: e?.reference ? String(e.reference) : null,
    note: e?.note ? String(e.note) : null,
    createdAt: String(e?.createdAt ?? ''),
  };
}

/** GET /delivery/cash (C6 servers). Null when the server does not have it yet. */
export async function fetchCash(): Promise<RiderCash | null> {
  try {
    const d = await apiFetch<any>('/delivery/cash');
    const status = toCashStatus(d);
    if (!status) return null;
    const p = d?.position ?? {};
    return {
      status,
      position: {
        cashHeld: toNumber(p.cashHeld) ?? status.cashHeld,
        zenvyOwes: toNumber(p.zenvyOwes) ?? 0,
        earnings: toNumber(p.earnings) ?? 0,
        tips: toNumber(p.tips) ?? 0,
        net: toNumber(p.net) ?? 0,
      },
      recentDeposits: Array.isArray(d?.recentDeposits) ? d.recentDeposits.map(toCashEntry) : [],
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** GET /delivery/stats/week (newer servers). Returns null when the server does not have it yet. */
export async function fetchWeek(): Promise<WeekStats | null> {
  try {
    const d = await apiFetch<any>('/delivery/stats/week');
    if (!d || !Array.isArray(d.days)) return null;
    return {
      days: d.days.map((x: any) => ({
        date: String(x.date),
        earnings: toNumber(x.earnings) ?? 0,
        orders: toNumber(x.orders) ?? 0,
        codCollected: toNumber(x.codCollected) ?? undefined,
      })),
      totalEarnings: toNumber(d.totalEarnings) ?? 0,
      totalOrders: toNumber(d.totalOrders) ?? 0,
      source: 'server',
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function acceptOrder(orderId: string): Promise<RiderOrder | null> {
  const data = await apiFetch<any>(`/delivery/accept/${orderId}`, { method: 'PUT' });
  return data && data.id ? normalizeOrder(data) : null;
}

export async function markAtStore(orderId: string): Promise<void> {
  await apiFetch(`/delivery/status/${orderId}`, { method: 'PUT', body: { status: 'Picking' } });
}

export async function markPickedUp(orderId: string): Promise<void> {
  await apiFetch(`/delivery/status/${orderId}`, { method: 'PUT', body: { status: 'PickedUp' } });
}

export async function markArrived(orderId: string): Promise<void> {
  await apiFetch(`/delivery/arrive/${orderId}`, { method: 'PUT' });
}

export async function markDelivered(orderId: string, pin: string): Promise<{ earning: number | null }> {
  const d = await apiFetch<any>(`/delivery/status/${orderId}`, { method: 'PUT', body: { status: 'Delivered', pin } });
  return { earning: toNumber(d?.riderEarning) };
}

export async function unassignOrder(orderId: string): Promise<string | null> {
  const d = await apiFetch<any>(`/delivery/orders/${orderId}/cancel`, { method: 'POST' });
  return typeof d?.message === 'string' ? d.message : null;
}

export async function updateProfile(payload: {
  name?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  emergencyContact?: string;
}): Promise<any> {
  return apiFetch('/delivery/profile', { method: 'PUT', body: payload });
}

/**
 * The server bumps tokenVersion on a password change (every older token, including this phone's, stops
 * working) and returns a fresh token for this device. Returns it so the caller can keep the session.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
  const d = await apiFetch<any>('/delivery/profile/password', { method: 'PUT', body: { currentPassword, newPassword } });
  return typeof d?.token === 'string' && d.token ? d.token : null;
}

function toTicket(t: any): SupportTicket {
  return {
    id: String(t?.id ?? t?._id ?? ''),
    subject: String(t?.subject ?? ''),
    description: String(t?.description ?? ''),
    status: String(t?.status ?? 'Open'),
    adminResponse: t?.adminResponse ? String(t.adminResponse) : null,
    createdAt: String(t?.createdAt ?? ''),
  };
}

/** Rider tickets: POST /delivery/support (riders are not customer accounts, so /api/tickets cannot store them). */
export async function createTicket(subject: string, description: string, priority: 'Medium' | 'High'): Promise<SupportTicket> {
  return toTicket(await apiFetch<any>('/delivery/support', { method: 'POST', body: { subject, description, priority } }));
}

export async function fetchTickets(): Promise<SupportTicket[]> {
  const list = await apiFetch<any[]>('/delivery/support');
  return Array.isArray(list) ? list.map(toTicket) : [];
}
