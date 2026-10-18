
export interface MealMenu { breakfast: string; lunch: string; dinner: string }

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Day = typeof DAYS[number];

export interface PGHostel {
  id: string;
  name: string;
  address: string;
  distanceFromCollege: number;
  genderType: string;
  baseRent: number;
  securityDeposit?: number;
  isActive: boolean;
  amenities?: string[];
  images?: string[];
  description?: string | null;
  contactInfo?: Record<string, unknown> | null;
  rules?: string[];
  foodTimetable?: Record<string, unknown> | null;
  messMenu?: Record<string, Partial<MealMenu>> | null;
  area?: string | null;
  isVerified?: boolean;
  photos?: PgPhoto[] | null;
  videos?: PgVideo[] | null;
  messTimetable?: MessTimetable | null;
  timings?: PgTimings | null;
}

// ── Listing content (backend/utils/pgContent.js validates; these mirror its shapes) ──
export const PHOTO_CATEGORIES = ['ROOM', 'BATHROOM', 'MESS', 'BUILDING', 'COMMON_AREA', 'OTHER'] as const;
export type PhotoCategory = typeof PHOTO_CATEGORIES[number];
export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = { ROOM: 'Room', BATHROOM: 'Bathroom', MESS: 'Mess', BUILDING: 'Building', COMMON_AREA: 'Common area', OTHER: 'Other' };
export const MAX_PHOTOS = 20;
export const MAX_VIDEOS = 15;
export interface PgPhoto { id?: string; url: string; category: PhotoCategory; caption: string; order?: number; roomType: string | null; isCover: boolean }
export interface PgVideo { id?: string; youtubeId: string; title: string; roomType: string | null; order?: number }
export type FoodTag = 'veg' | 'nonveg' | 'egg' | null;
export interface MessMeal { key: string; label: string; start: string | null; end: string | null }
export interface MessCell { menu: string; tag: FoodTag; start?: string; end?: string }
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABEL: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export interface MessTimetable { meals: MessMeal[]; days: Partial<Record<DayKey, Record<string, MessCell>>>; notes: string }
export interface PgTimings {
  gateOpen?: string; gateClose?: string; visitorFrom?: string; visitorTo?: string;
  checkIn?: string; checkOut?: string; quietFrom?: string; quietTo?: string; curfewNote?: string;
}

/** Same rules as backend parseYouTubeId: youtube.com/watch?v=, youtu.be/ and youtube.com/shorts/ links only. */
export function parseYouTubeId(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 500) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (parts.length === 1) id = parts[0];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (parts.length === 1 && parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts.length === 2 && parts[0] === 'shorts') id = parts[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Room type key, same as backend roomTypeKey (photos and videos link to it). */
export function roomTypeKey(r: Pick<PGRoom, 'sharingType' | 'hasAC' | 'hasAttachedBathroom'> & { roomType?: string | null }): string {
  const label = (r.roomType || '').trim();
  if (label) return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'room';
  const n = Number(r.sharingType);
  return `${Number.isFinite(n) && n > 0 ? n : 1}-sharing-${r.hasAC ? 'ac' : 'non-ac'}-${r.hasAttachedBathroom === false ? 'shared' : 'attached'}`;
}
export function roomTypeOptions(rooms: PGRoom[]): { key: string; label: string }[] {
  const m = new Map<string, string>();
  for (const r of rooms) {
    const key = roomTypeKey(r);
    if (!m.has(key)) m.set(key, (r.roomType || '').trim() || `${r.sharingType}-sharing, ${r.hasAC ? 'AC' : 'non-AC'}, ${r.hasAttachedBathroom === false ? 'shared bath' : 'attached bath'}`);
  }
  return [...m.entries()].map(([key, label]) => ({ key, label }));
}

export interface PGRoom {
  id: string;
  hostelId: string;
  roomNumber: string;
  sharingType: number;
  pricePerBed: number;
  totalBeds: number;
  availableBeds: number;
  floorNumber: number;
  hasAttachedBathroom: boolean;
  hasAC: boolean;
  hasBalcony: boolean;
  furnishing: string;
  isActive: boolean;
  roomType?: string | null;
  securityDeposit?: number | null;
}

export interface PGBooking {
  id: string;
  status: 'Pending' | 'Confirmed' | 'Cancelled' | string;
  checkInDate: string;
  createdAt: string;
  user?: { id: string; name?: string | null; phone?: string | null; email?: string | null } | null;
  hostel?: { id: string; name: string } | null;
  room?: { id: string; roomNumber: string; sharingType: number; availableBeds: number } | null;
}

export const FIELD = 'w-full rounded-lg border border-white/10 bg-[#111318] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-blue-500/50 disabled:opacity-50';
export const LABEL = 'block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400';

/** The customer app expects 'Boys' | 'Girls' | 'Co-ed'. Older rows used 'Co-Ed'. */
export const normalizeGender = (value?: string | null) => {
  const v = String(value || '').toLowerCase();
  if (v.startsWith('boy')) return 'Boys';
  if (v.startsWith('girl')) return 'Girls';
  return 'Co-ed';
};

export const formatDate = (value?: string | null, withTime = false) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return withTime
    ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString('en-IN', { dateStyle: 'medium' });
};

// Shared request helpers live in src/lib/api.ts.
export { adminRequest as pgRequest, uploadImage } from '@/lib/api';
