/**
 * In-Campus Booking API client (backend/modules/campusBooking, routes under /api/campus-booking).
 * Book a campus stall's items for pickup, pay the stall DIRECTLY by UPI (ZCS never holds the money), send proof,
 * collect at the counter with the pickup code. Prices, totals, open state and every status come from the server;
 * the app only says which items and how many.
 */
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';
import { newIdempotencyKey } from '../../context/CartContext';

export { newIdempotencyKey };

export type CbStatus = 'PAYMENT_PENDING' | 'PAYMENT_REVIEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'REJECTED' | 'CANCELLED';
export type CbCategoryKey = 'food' | 'snacks' | 'stationery' | 'more';

export interface CbCategory { key: CbCategoryKey; label: string }

export interface CbStall {
  id: string;
  name: string;
  location: string | null;
  campus: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
  description: string | null;
  category: CbCategoryKey;
  categoryLabel: string;
  tags: string[];
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  closedReason: string | null;
  hoursToday: string | null;
  prepMinutes: number;
  /** Real order ratings only; null = no rating yet. */
  rating: number | null;
  ratingCount: number;
  itemCount: number | null;
  legalName: string | null;
  fssaiLicenseNumber: string | null;
  matchedItem?: string | null;
  /** Stall list only: up to 3 dishes (mains first) and the first 2 menu categories. */
  preview?: { id: string; name: string; price: number; isVeg: boolean; category: string | null }[];
  menuCategories?: string | null;
}

export interface CbMenuItem {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  description: string | null;
  imageUrl: string | null;
  category: string | null;
  isVeg: boolean;
  dietType: string;
  isAvailable: boolean;
}

export interface CbLine { menuItemId: string | null; name: string; unitPrice: number; quantity: number; lineTotal: number; isVeg: boolean }
export interface CbStep { key: string; label: string; at: string | null; done: boolean }

export interface CbBooking {
  id: string;
  ref: string;
  status: CbStatus;
  statusLabel: string;
  items: CbLine[];
  itemCount: number;
  amount: number;
  prepMinutes: number;
  estimatedReadyAt: string | null;
  timeline: CbStep[];
  proof: { hasImage: boolean; imageUrl: string | null; ref: string | null; submittedAt: string | null; attempts: number; attemptsLeft: number };
  rejection: { code: string | null; reason: string | null; at: string | null } | null;
  cancellation: { by: string | null; code: string | null; reason: string | null; at: string | null } | null;
  paymentVerified: boolean;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  paymentVerifiedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  stall: { id: string; name: string; location: string | null; imageUrl: string | null } | null;
  payee: { upiId: string | null; name: string | null; qrUrl: string | null; upiLink: string | null };
  /** Shown once the stall accepted the booking. */
  pickupCode: string | null;
  paymentDeadline: string | null;
  canSubmitProof: boolean;
  canCancel: boolean;
}

export interface CbHome {
  categories: CbCategory[];
  stalls: CbStall[];
  active: CbBooking[];
  limits: { maxQtyPerLine: number; maxLines: number; proofMaxBytes: number };
  commissionPct: number;
}

export class CbError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(message: string, status = 0, code = 'ERROR', data: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const call = async <T>(path: string, init: RequestInit & { idempotent?: boolean } = {}): Promise<T> => {
  let res: Response;
  try {
    res = await apiFetch(`/api/campus-booking${path}`, init);
  } catch {
    throw new CbError(NETWORK_ERROR_MESSAGE, 0, 'NETWORK');
  }
  const json = await readJson(res);
  if (!res.ok) {
    if (res.status >= 502 && res.status <= 504) throw new CbError(SERVER_BUSY_MESSAGE, res.status, 'SERVER_BUSY');
    if (res.status === 401) throw new CbError('Please sign in to book from campus stalls.', 401, 'AUTH');
    const msg = typeof json?.message === 'string' && json.message.length < 240 ? json.message : 'Something went wrong. Please try again.';
    throw new CbError(msg, res.status, String(json?.code || 'ERROR'), json);
  }
  return json as T;
};

const post = <T>(path: string, body: any = {}, headers: Record<string, string> = {}, idempotent = false) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body), headers, idempotent });

export const cbApi = {
  home: () => call<CbHome>('/home'),
  stalls: (q?: string, category?: string) => {
    const qs = [q ? `q=${encodeURIComponent(q)}` : '', category ? `category=${encodeURIComponent(category)}` : ''].filter(Boolean).join('&');
    return call<{ stalls: CbStall[]; categories: CbCategory[] }>(`/stalls${qs ? `?${qs}` : ''}`);
  },
  stall: (id: string) => call<{ stall: CbStall; menu: CbMenuItem[] }>(`/stalls/${encodeURIComponent(id)}`),
  /** Same key for every retry of one "Proceed to pay" tap: a retry returns the booking made the first time. */
  book: (stallId: string, items: { menuItemId: string; quantity: number }[], key: string, note?: string) =>
    post<{ booking: CbBooking }>('/bookings', { stallId, items, ...(note ? { note } : {}) }, { 'Idempotency-Key': key }, true),
  mine: (scope?: 'active') => call<{ bookings: CbBooking[]; hasMore: boolean }>(`/bookings${scope ? `?scope=${scope}` : ''}`),
  booking: (id: string) => call<{ booking: CbBooking }>(`/bookings/${encodeURIComponent(id)}`),
  submitProof: (id: string, proof: { imageUrl?: string | null; upiRef?: string | null }) =>
    post<{ booking: CbBooking }>(`/bookings/${encodeURIComponent(id)}/proof`, proof),
  cancel: (id: string) => post<{ booking: CbBooking }>(`/bookings/${encodeURIComponent(id)}/cancel`),
};

/** Statuses where the booking still needs something from the student or the stall. */
export const OPEN_STATUSES: CbStatus[] = ['PAYMENT_PENDING', 'PAYMENT_REVIEW', 'REJECTED', 'ACCEPTED', 'PREPARING', 'READY'];
export const isOpenStatus = (s: CbStatus) => OPEN_STATUSES.includes(s);
