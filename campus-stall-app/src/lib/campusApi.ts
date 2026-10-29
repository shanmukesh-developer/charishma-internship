// In-Campus Booking for the stall (backend/modules/campusBooking, routes /api/campus-booking/vendor/*).
// Students book this stall's items for pickup and pay the stall DIRECTLY by UPI; the stall checks the payment in
// its own UPI app, confirms it, prepares the order and hands it over when the student shows the pickup code.
// The server never sends the pickup code here: the stall types the code the student shows.
import { apiFetch } from './http';

const enc = encodeURIComponent;
const BASE = '/api/campus-booking/vendor';

export type CbStatus = 'PAYMENT_PENDING' | 'PAYMENT_REVIEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'REJECTED' | 'CANCELLED';
export type CbTab = 'pending' | 'accepted' | 'history';

export interface CbLine { menuItemId: string | null; name: string; unitPrice: number; quantity: number; lineTotal: number; isVeg: boolean }
export interface CbStep { key: string; label: string; at: string | null; done: boolean }

export interface CbVendorBooking {
  id: string;
  ref: string;
  status: CbStatus;
  statusLabel: string;
  items: CbLine[];
  itemCount: number;
  amount: number;
  commissionPct: number;
  commission: number;
  net: number;
  paid: boolean;
  prepMinutes: number;
  estimatedReadyAt: string | null;
  timeline: CbStep[];
  proof: { hasImage: boolean; imageUrl: string | null; ref: string | null; submittedAt: string | null; attempts: number; attemptsLeft: number };
  rejection: { code: string | null; reason: string | null; at: string | null } | null;
  cancellation: { by: string | null; code: string | null; reason: string | null; at: string | null } | null;
  customer: { firstName: string };
  payeeUpiId: string | null;
  note: string | null;
  /** Stationery / print bookings: the student's PDFs (url: a signed link, about an hour; detail view only). */
  documents?: { id: string; name: string; size: number; url: string | null }[];
  pickupLocked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  paymentVerifiedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
}

export interface CbReason { code: string; label: string }
export interface CbSettings {
  enabled: boolean;
  upiId: string | null;
  upiName: string | null;
  qrUrl: string | null;
  prepMinutes: number | null;
  effectivePrepMinutes: number;
  defaultPrepMinutes: number;
  isLocalVendor: boolean;
  takingBookings: boolean;
  commissionPct: number;
  rejectReasons: CbReason[];
  cancelReasons: CbReason[];
}

export interface CbSummary {
  today: { orders: number; paidOrders: number; earnings: number; commission: number };
  pendingReview: number;
  inProgress: number;
  settings: CbSettings;
}

export interface CbEarnings {
  range: 'today' | '7d' | '30d' | 'all';
  total: number;
  orders: number;
  collected: number;
  commission: number;
  net: number;
  commissionPct: number;
  recent: CbVendorBooking[];
}

export const campusApi = {
  summary: () => apiFetch<CbSummary>(`${BASE}/summary`),
  list: (tab: CbTab) => apiFetch<{ tab: CbTab; bookings: CbVendorBooking[]; counts: { pending: number; accepted: number }; hasMore: boolean }>(`${BASE}/bookings?tab=${tab}`),
  get: (id: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}`),
  confirmPayment: (id: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}/confirm-payment`, { method: 'POST', body: {} }),
  rejectPayment: (id: string, code: string, note?: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}/reject-payment`, { method: 'POST', body: { code, ...(note ? { note } : {}) } }),
  preparing: (id: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}/preparing`, { method: 'POST', body: {} }),
  ready: (id: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}/ready`, { method: 'POST', body: {} }),
  collect: (id: string, code: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}/collect`, { method: 'POST', body: { code } }),
  cancel: (id: string, code: string, note?: string) => apiFetch<{ booking: CbVendorBooking }>(`${BASE}/bookings/${enc(id)}/cancel`, { method: 'POST', body: { code, ...(note ? { note } : {}) } }),
  earnings: (range: CbEarnings['range']) => apiFetch<CbEarnings>(`${BASE}/earnings?range=${range}`),
  settings: () => apiFetch<{ settings: CbSettings }>(`${BASE}/settings`),
  saveSettings: (body: Partial<{ upiId: string | null; upiName: string | null; qrUrl: string | null; prepMinutes: number | null }>) =>
    apiFetch<{ settings: CbSettings }>(`${BASE}/settings`, { method: 'PUT', body, no401Logout: true, timeoutMs: 30000 }),
};

/** "2:15 PM" (IST). */
export const timeIST = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const h = ist.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** Rupees with paise only when there are some: "₹80", "₹1.20". */
export const inr = (n: number | null | undefined): string => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `₹${Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(2)}`;
};
