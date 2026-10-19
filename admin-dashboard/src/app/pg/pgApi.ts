
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
  // v2 sections (null / missing when empty; the app then hides the section).
  highlights?: string[] | null;
  houseRules?: HouseRuleGroup[] | null;
  policies?: PgPolicies | null;
  safety?: PgSafety | null;
  moveIn?: PgMoveIn | null;
  locationGuide?: PgLocationGuide | null;
  faq?: PgFaqItem[] | null;
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

// ── v2 sections (backend/utils/pgContent.js validateHighlights … validateFaq; same limits) ──
export const MAX_HIGHLIGHTS = 6;
export const RULE_CATEGORIES = ['visitors', 'overnight', 'gate', 'smoking', 'noise', 'cooking', 'pets', 'cleanliness', 'laundry', 'electricity', 'other'] as const;
export type RuleCategory = typeof RULE_CATEGORIES[number];
export const RULE_CATEGORY_LABEL: Record<RuleCategory, string> = {
  visitors: 'Visitors & guests', overnight: 'Overnight stays', gate: 'Gate & curfew', smoking: 'Smoking & alcohol',
  noise: 'Noise & quiet hours', cooking: 'Cooking & food', pets: 'Pets', cleanliness: 'Cleanliness', laundry: 'Laundry',
  electricity: 'Electricity & appliances', other: 'Other',
};
export const MAX_RULES_PER_GROUP = 10;
/** `label` is only present on the public (read) shape. */
export interface HouseRuleGroup { category: RuleCategory; rules: string[]; label?: string }

export const PAYMENT_METHODS = ['cash', 'upi', 'bank'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' };
export const INCLUDED_KEYS = ['food', 'wifi', 'electricity', 'water', 'housekeeping', 'laundry', 'maintenance'] as const;
export type IncludedKey = typeof INCLUDED_KEYS[number];
export const INCLUDED_LABEL: Record<IncludedKey, string> = { food: 'Food', wifi: 'WiFi', electricity: 'Electricity', water: 'Water', housekeeping: 'Housekeeping', laundry: 'Laundry', maintenance: 'Maintenance' };
export const CHARGE_UNITS = ['month', 'unit', 'use', 'day', 'kg', 'once'] as const;
export type ChargeUnit = typeof CHARGE_UNITS[number];
export const CHARGE_UNIT_LABEL: Record<ChargeUnit, string> = { month: 'per month', unit: 'per unit', use: 'per use', day: 'per day', kg: 'per kg', once: 'one time' };
export const MAX_EXTRA_CHARGES = 12;
export type LateFeeUnit = 'once' | 'day';
export interface ExtraCharge { item: string; amount: number; unit: ChargeUnit }
export interface PgPolicies {
  booking?: { steps?: string; tokenAmount?: number; confirmation?: string };
  rent?: { dueDay?: number; lateFee?: number; lateFeeUnit?: LateFeeUnit; methods?: PaymentMethod[]; notes?: string };
  deposit?: { amount?: number; refundDays?: number; deductions?: string };
  stay?: { noticeMonths?: number; lockInMonths?: number; notes?: string };
  cancellation?: { freeCancelDays?: number; refundPercent?: number; text?: string };
  included?: IncludedKey[];
  extraCharges?: ExtraCharge[];
  maintenance?: { responseHours?: number; notes?: string };
}

export const ENTRY_TYPES = ['biometric', 'keycard', 'key'] as const;
export type EntryType = typeof ENTRY_TYPES[number];
export const ENTRY_LABEL: Record<EntryType, string> = { biometric: 'Biometric', keycard: 'Key card', key: 'Key' };
export const GUARD_MODES = ['24x7', 'night', 'hours'] as const;
export type GuardMode = typeof GUARD_MODES[number];
export const GUARD_LABEL: Record<GuardMode, string> = { '24x7': 'Round the clock', night: 'Night only', hours: 'Set hours' };
export interface PgSafety {
  cctv?: boolean; entry?: EntryType; guard?: GuardMode; guardFrom?: string; guardTo?: string;
  fireExtinguishers?: boolean; firstAid?: boolean; wardenName?: string; wardenAvailability?: string; emergency?: string;
}

export interface PgMoveIn { documents?: string[]; bring?: string[]; provided?: string[]; steps?: string[] }

export const NEARBY_CATEGORIES = ['college', 'hospital', 'pharmacy', 'atm', 'bus_stop', 'supermarket', 'restaurant', 'gym', 'other'] as const;
export type NearbyCategory = typeof NEARBY_CATEGORIES[number];
export const NEARBY_LABEL: Record<NearbyCategory, string> = { college: 'College', hospital: 'Hospital', pharmacy: 'Pharmacy', atm: 'ATM', bus_stop: 'Bus stop', supermarket: 'Supermarket', restaurant: 'Restaurant', gym: 'Gym', other: 'Other' };
export const MAX_NEARBY = 20;
export interface NearbyPlace { name: string; category: NearbyCategory; distanceM: number; walkMinutes?: number }
export interface PgLocationGuide { howToReach?: string; nearby?: NearbyPlace[] }

export const MAX_FAQ = 20;
export interface PgFaqItem { id?: string; q: string; a: string }

// ── Reviews (admin moderation) ──
export interface PgReviewReport { userId: string; reason: string; at: string }
export interface PgReview {
  id: string; hostelId: string; userId: string; bookingId: string; rating: number; text: string; firstName: string;
  status: 'visible' | 'hidden'; hiddenReason: string | null; reports: PgReviewReport[]; reportCount: number;
  createdAt: string; hostelName: string | null;
}
export const REVIEW_REPORT_LABEL: Record<string, string> = { spam: 'Spam', offensive: 'Offensive', fake: 'Fake', personal_info: 'Personal information', other: 'Other' };

// ── Promotions (cards on the PG list page) ──
export type PromoType = 'IMAGE' | 'VIDEO';
export type PromoCta = 'VIEW_PG' | 'WATCH_TOUR' | 'BOOK_VISIT';
export type PromoLabel = 'FEATURED' | 'SPONSORED';
export type PromoState = 'live' | 'scheduled' | 'ended' | 'paused';
export const PROMO_CTA_LABEL: Record<PromoCta, string> = { VIEW_PG: 'View PG', WATCH_TOUR: 'Watch tour', BOOK_VISIT: 'Book a visit' };
export const PROMO_LABEL_TEXT: Record<PromoLabel, string> = { FEATURED: 'Featured', SPONSORED: 'Sponsored' };
export const PROMO_STATE_LABEL: Record<PromoState, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', paused: 'Paused' };
export const MAX_PROMO_DAYS = 366;
export interface PgPromotion {
  id: string; type: PromoType; imageUrl: string | null; youtubeId: string | null; headline: string; subline: string | null;
  hostelId: string; cta: PromoCta; label: PromoLabel; startsAt: string; endsAt: string; priority: number; isActive: boolean;
  state: PromoState; pgName: string | null; ctaLabel: string;
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
