// Every backend call ZCS PG Partner makes. Paths, bodies and replies are the LIVE owner router
// (backend/modules/pgOwner/routes.js ownerRouter). Counts, statuses and money totals always come from the
// server; the app only says what the owner wants. No React Native imports.
import { OWNER_API } from '../config';
import { apiFetch, apiUploadXhr } from '../lib/http';
import type {
  Booking, Complaint, ComplaintStatus, HomeResponse, ListingDetail, MediaUpload, MessTimetable, OwnerNotification, OwnerSelf,
  Photo, RentMethod, RentRecord, RentResponse, RuleGroup, Tenant,
} from '../types';

const O = OWNER_API;
const enc = encodeURIComponent;

export interface AuthResult { token: string; owner: OwnerSelf }
type ListingReply = { listing: ListingDetail; message?: string };

/** Indian mobile -> 10 digits ("+91 98765-43210" -> "9876543210"); null when it is not one. */
export function normalizePhone(input: string): string | null {
  const d = String(input || '').replace(/\D/g, '');
  const ten = d.length === 10 ? d : d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : null;
  return ten && /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** Same rule as controllers/auth.js checkPassword. null = ok, else the message. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use 8 to 72 characters with letters and numbers.';
  return null;
}

export const ownerApi = {
  // ── Account ─────────────────────────────────────────────────────────────
  /** 401 INVALID_CREDENTIALS, 403 PG_OWNER_SUSPENDED, 429 lockout / RATE_LIMITED. */
  login: (phone: string, password: string) =>
    apiFetch<AuthResult>(`${O}/auth/login`, { method: 'POST', body: { phone, password }, auth: false, timeoutMs: 45000 }),
  refresh: () => apiFetch<AuthResult>(`${O}/auth/refresh`, { method: 'POST' }),
  me: () => apiFetch<{ owner: OwnerSelf }>(`${O}/me`),
  /** Bumps tokenVersion: other phones sign out; the reply carries this phone's new token. 400 SAME_PASSWORD / WEAK_PASSWORD. */
  changePassword: (currentPassword: string, newPassword: string, firstChange = false) =>
    apiFetch<AuthResult & { message: string }>(`${O}/auth/password`, { method: 'POST', body: { currentPassword, newPassword, firstChange } }),
  saveFcmToken: (token: string) => apiFetch<{ ok: boolean }>(`${O}/fcm-token`, { method: 'POST', body: { token } }),
  removeFcmToken: (token: string) => apiFetch<{ ok: boolean }>(`${O}/fcm-token/remove`, { method: 'POST', body: { token }, timeoutMs: 6000 }),
  /** Play account deletion: recorded for the ZCS team (owner accounts are closed by ZCS). 401 WRONG_PASSWORD. */
  requestDeletion: (password: string, reason?: string) =>
    apiFetch<{ owner: OwnerSelf; message: string }>(`${O}/account/deletion-request`, { method: 'POST', body: { password, reason } }),
  notifications: () => apiFetch<{ notifications: OwnerNotification[]; unread: number }>(`${O}/notifications`),
  /** Idempotent (safe to replay). No ids = mark all read. */
  markRead: (ids?: string[]) => apiFetch<{ updated: number }>(`${O}/notifications/read`, { method: 'POST', body: ids ? { ids } : {} }),

  // ── Dashboard + listing ─────────────────────────────────────────────────
  home: () => apiFetch<HomeResponse>(`${O}/home`),
  listing: (id: string) => apiFetch<ListingReply>(`${O}/listings/${enc(id)}`),
  /** Free beds per room (0..totalBeds): what students see as "Available N / Full". */
  saveAvailability: (id: string, rooms: { id: string; availableBeds: number }[]) =>
    apiFetch<ListingReply & { changed: number }>(`${O}/listings/${enc(id)}/availability`, { method: 'PUT', body: { rooms } }),
  saveMess: (id: string, messTimetable: MessTimetable | null) =>
    apiFetch<ListingReply>(`${O}/listings/${enc(id)}/mess`, { method: 'PUT', body: { messTimetable } }),
  saveInfo: (id: string, input: { description?: string; amenities?: string[] }) =>
    apiFetch<ListingReply>(`${O}/listings/${enc(id)}/info`, { method: 'PUT', body: input }),
  saveHouseRules: (id: string, houseRules: RuleGroup[]) =>
    apiFetch<ListingReply>(`${O}/listings/${enc(id)}/house-rules`, { method: 'PUT', body: { houseRules } }),
  savePhotos: (id: string, photos: Photo[]) =>
    apiFetch<ListingReply>(`${O}/listings/${enc(id)}/photos`, { method: 'PUT', body: { photos } }),
  /** PUBLIC listing photo (multipart field 'image', 5 MB). 201 { id, url }. */
  uploadMedia: (form: FormData) => apiUploadXhr<MediaUpload>(`${O}/media`, form, 90000),
  uploadMediaBase64: (image: string) => apiFetch<MediaUpload>(`${O}/media`, { method: 'POST', body: { image }, timeoutMs: 90000 }),

  // ── Booking requests + tenants ──────────────────────────────────────────
  bookings: (status: 'Pending' | 'Confirmed' | 'closed' | 'all', hostelId?: string) =>
    apiFetch<{ bookings: Booking[]; counts: { pending: number; confirmed: number } }>(`${O}/bookings?status=${status}${hostelId ? `&hostelId=${enc(hostelId)}` : ''}`),
  /** 400 NO_BEDS, 409 INVALID_TRANSITION / ALREADY_CONFIRMED, 404. roomId = another room of the same PG. */
  accept: (id: string, roomId?: string) =>
    apiFetch<{ booking: Booking; message: string }>(`${O}/bookings/${enc(id)}/accept`, { method: 'POST', body: roomId ? { roomId } : {} }),
  reject: (id: string, reason: string) =>
    apiFetch<{ booking: Booking; message: string }>(`${O}/bookings/${enc(id)}/reject`, { method: 'POST', body: { reason } }),
  moveOut: (id: string) => apiFetch<{ booking: Booking; message: string }>(`${O}/bookings/${enc(id)}/move-out`, { method: 'POST', body: {} }),
  tenants: (hostelId?: string) =>
    apiFetch<{ month: string; tenants: Tenant[]; past: Booking[] }>(`${O}/tenants${hostelId ? `?hostelId=${enc(hostelId)}` : ''}`),

  // ── Rent ledger (a record only; no money moves through ZCS) ─────────────
  rent: (month?: string, hostelId?: string) => {
    const q = [month ? `month=${enc(month)}` : '', hostelId ? `hostelId=${enc(hostelId)}` : ''].filter(Boolean).join('&');
    return apiFetch<RentResponse>(`${O}/rent${q ? `?${q}` : ''}`);
  },
  /** 409 ALREADY_RECORDED. amount defaults to the room rent. */
  recordRent: (input: { bookingId: string; month: string; amount?: number; method: RentMethod; note?: string }) =>
    apiFetch<{ record: RentRecord; message: string }>(`${O}/rent`, { method: 'POST', body: input }),
  voidRent: (id: string, reason?: string) =>
    apiFetch<{ record: RentRecord; message: string }>(`${O}/rent/${enc(id)}/void`, { method: 'POST', body: reason ? { reason } : {} }),

  // ── Complaints ──────────────────────────────────────────────────────────
  complaints: (status: 'open' | 'resolved' | 'all', hostelId?: string) =>
    apiFetch<{ complaints: Complaint[]; counts: { open: number } }>(`${O}/complaints?status=${status}${hostelId ? `&hostelId=${enc(hostelId)}` : ''}`),
  reply: (id: string, reply: string, status: Exclude<ComplaintStatus, 'OPEN'>) =>
    apiFetch<{ complaint: Complaint; message: string }>(`${O}/complaints/${enc(id)}/reply`, { method: 'POST', body: { reply, status } }),
};

export type OwnerApi = typeof ownerApi;
