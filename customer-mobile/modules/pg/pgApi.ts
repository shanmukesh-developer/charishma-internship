/**
 * Zenvy PG (paying-guest stays) client types and formatters.
 * Backend: backend/routes/pgRoutes.js; read shapes from backend/utils/pgContent.js (publicPg / publicPgListItem).
 * Everything shown comes from the server; when a section has no data the screen leaves it out or shows a
 * calm empty line. Times are stored as 24-hour "HH:MM" (IST) and shown 12-hour ("7:30 AM"), like the rest
 * of the app.
 */

export type PhotoCategory = 'ROOM' | 'BATHROOM' | 'MESS' | 'BUILDING' | 'COMMON_AREA' | 'OTHER';
export type FoodTag = 'veg' | 'nonveg' | 'egg' | null;
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface PgPhoto { id: string; url: string; category: PhotoCategory; caption: string; order: number; roomType: string | null; isCover: boolean }
export interface PgVideo { id: string; youtubeId: string; title: string; roomType: string | null; order: number; thumbnailUrl: string; embedUrl: string; watchUrl: string }
export interface MessMeal { key: string; label: string; start: string | null; end: string | null }
export interface MessCell { menu: string; tag: FoodTag; start?: string; end?: string }
export interface MessTimetable { meals: MessMeal[]; days: Partial<Record<DayKey, Record<string, MessCell>>>; notes: string; legacy?: boolean }
export interface PgTimings {
  gateOpen?: string; gateClose?: string; visitorFrom?: string; visitorTo?: string;
  checkIn?: string; checkOut?: string; quietFrom?: string; quietTo?: string; curfewNote?: string;
}
export interface PgRoom {
  id: string; roomNumber: string; roomType: string | null; roomTypeKey: string; sharingType: number; pricePerBed: number;
  securityDeposit: number | null; totalBeds: number; availableBeds: number; floorNumber: number;
  hasAttachedBathroom: boolean; hasAC: boolean; hasBalcony: boolean; furnishing: string;
}
export interface PgRoomType {
  key: string; label: string; sharingType: number; hasAC: boolean; hasAttachedBathroom: boolean; hasBalcony: boolean;
  furnishing: string | null; rentFrom: number | null; rentTo: number | null; deposit: number | null;
  availableBeds: number; totalBeds: number; roomCount: number; bookRoomId: string | null; roomIds: string[];
}
export interface PgDetail {
  id: string; name: string; address: string; area: string | null; description: string;
  distanceFromCollege: number; genderType: string; baseRent: number; rentFrom: number | null; securityDeposit: number;
  isActive: boolean; isVerified: boolean; amenities: string[]; rules: string[];
  images: string[]; photos: PgPhoto[]; coverPhoto: string | null; videos: PgVideo[];
  messTimetable: MessTimetable | null; timings: PgTimings | null;
  contactInfo: { ownerName?: string; wardenName?: string; lat?: number; lng?: number };
  location: { lat: number; lng: number } | null;
  rooms: PgRoom[]; roomTypes: PgRoomType[]; bedsAvailable: number;
  // v2 sections (older servers omit them: treat as empty).
  highlights?: string[]; houseRules?: PgRuleGroup[]; policies?: PgPolicies | null; safety?: PgSafety | null;
  moveIn?: PgMoveIn | null; locationGuide?: PgLocationGuide | null; faq?: PgFaq[]; reviewSummary?: ReviewSummary;
  sections?: SectionKey[]; createdAt?: string | null;
}
export interface PgListItem {
  id: string; name: string; address: string; area?: string | null; distanceFromCollege: number; genderType: string;
  baseRent: number; rentFrom?: number | null; isVerified?: boolean; amenities?: string[]; coverPhoto?: string | null;
  images?: string[]; photoCount?: number; videoCount?: number; hasMess?: boolean; bedsAvailable?: number; hasRooms?: boolean;
  hasAC?: boolean; foodIncluded?: boolean; highlights?: string[]; reviewSummary?: ReviewSummary; createdAt?: string | null;
}
export interface MyPgBooking {
  id: string; status: 'Pending' | 'Confirmed' | 'Cancelled'; checkInDate: string; hostelId?: string;
  hostel?: { id: string; name: string } | null;
  room?: { id: string; roomNumber: string; sharingType: number; pricePerBed: number } | null;
}

export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  ROOM: 'Rooms', BATHROOM: 'Bathrooms', MESS: 'Mess', BUILDING: 'Building', COMMON_AREA: 'Common areas', OTHER: 'Other',
};
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_SHORT: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const DAY_LONG: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const FOOD_TAG_LABEL: Record<'veg' | 'nonveg' | 'egg', string> = { veg: 'Veg', nonveg: 'Non-veg', egg: 'Egg' };

/** "₹8,500" (Indian grouping). */
export const inr = (n: number | null | undefined) => {
  const v = Number(n);
  return Number.isFinite(v) ? `₹${Math.round(v).toLocaleString('en-IN')}` : '';
};

/** "07:30" -> "7:30 AM". */
export const fmtTime = (hhmm?: string | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
export const fmtRange = (a?: string | null, b?: string | null) => (a && b ? `${fmtTime(a)} – ${fmtTime(b)}` : a ? fmtTime(a) : '');
const toMin = (hhmm?: string | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Current IST day + minutes since midnight (the timetable is in IST whatever the phone's zone). */
export const istNow = (now = Date.now()) => {
  const d = new Date(now + 330 * 60 * 1000);
  const dow = d.getUTCDay(); // 0 = Sunday
  const day = DAY_KEYS[(dow + 6) % 7];
  return { day, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

export interface MealSlot { meal: MessMeal; cell: MessCell | null; start: string | null; end: string | null }
/** Meals of a day with that day's times (a day may move a meal, e.g. a later Sunday lunch). */
export const mealsForDay = (t: MessTimetable, day: DayKey): MealSlot[] => {
  const row = t.days[day] || {};
  return t.meals.map((meal) => {
    const cell = row[meal.key] || null;
    return { meal, cell, start: cell?.start || meal.start, end: cell?.end || meal.end };
  });
};

export type MealStatus = { key: string; kind: 'now'; label: string } | { key: string; kind: 'next'; label: string } | null;
const inMinutes = (mins: number) => {
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
};
/**
 * The meal being served now ("Serving now · until 9:30 AM") or the next one today ("in 25 min").
 * Only for today; null after the last meal or when meals have no times.
 */
export const mealStatus = (slots: MealSlot[], minutesNow: number): MealStatus => {
  let next: { slot: MealSlot; starts: number } | null = null;
  for (const s of slots) {
    const a = toMin(s.start);
    const b = toMin(s.end);
    if (a === null || b === null) continue;
    if (minutesNow >= a && minutesNow < b) return { key: s.meal.key, kind: 'now', label: `Serving now · until ${fmtTime(s.end)}` };
    if (a > minutesNow && (!next || a < next.starts)) next = { slot: s, starts: a };
  }
  if (next) return { key: next.slot.meal.key, kind: 'next', label: `Starts ${inMinutes(next.starts - minutesNow)}` };
  return null;
};

/** "Boys" / "Girls" / "Co-living" from the stored gender type. */
export const genderLabel = (g?: string | null) => {
  const v = String(g || '').toLowerCase();
  if (v.startsWith('boy')) return 'Boys';
  if (v.startsWith('girl')) return 'Girls';
  return 'Co-living';
};
export const genderKey = (g?: string | null) => {
  const v = String(g || '').toLowerCase();
  return v.startsWith('boy') ? 'Boys' : v.startsWith('girl') ? 'Girls' : 'Co-ed';
};

export const distanceLabel = (km?: number | null) => {
  const v = Number(km);
  if (!Number.isFinite(v)) return '';
  if (v < 1) return `${Math.round(v * 1000)} m from campus`;
  return `${v % 1 === 0 ? v : v.toFixed(1)} km from campus`;
};

export const sharingLabel = (n: number) => {
  const v = Number(n);
  if (v === 1) return 'Single room';
  if (Number.isFinite(v) && v > 1) return `${v}-sharing`;
  return 'Room';
};

/** Google Maps link: exact pin when coordinates exist, else a search for the name + address. */
export const mapsUrl = (pg: Pick<PgDetail, 'name' | 'address' | 'location'>) => {
  if (pg.location) return `https://www.google.com/maps/search/?api=1&query=${pg.location.lat},${pg.location.lng}`;
  if (pg.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pg.name}, ${pg.address}`)}`;
  return null;
};

// ── v2 sections (backend/utils/pgContent.js validates every field) ─────────────────────────────
export type SectionKey = 'overview' | 'rooms' | 'mess' | 'rules' | 'policies' | 'safety' | 'location' | 'faq' | 'reviews';
export const SECTION_LABEL: Record<SectionKey, string> = {
  overview: 'Overview', rooms: 'Rooms', mess: 'Mess', rules: 'Rules', policies: 'Policies',
  safety: 'Safety', location: 'Location', faq: 'FAQ', reviews: 'Reviews',
};
export type RuleCategory = 'visitors' | 'overnight' | 'gate' | 'smoking' | 'noise' | 'cooking' | 'pets' | 'cleanliness' | 'laundry' | 'electricity' | 'other';
export interface PgRuleGroup { category: RuleCategory; label: string; rules: string[] }
export type IncludedKey = 'food' | 'wifi' | 'electricity' | 'water' | 'housekeeping' | 'laundry' | 'maintenance';
export const INCLUDED_LABEL: Record<IncludedKey, string> = {
  food: 'Food', wifi: 'WiFi', electricity: 'Electricity', water: 'Water', housekeeping: 'Housekeeping', laundry: 'Laundry', maintenance: 'Maintenance',
};
export const INCLUDED_KEYS = Object.keys(INCLUDED_LABEL) as IncludedKey[];
export type ChargeUnit = 'month' | 'unit' | 'use' | 'day' | 'kg' | 'once';
export interface PgExtraCharge { item: string; amount: number; unit: ChargeUnit }
export interface PgPolicies {
  booking?: { steps?: string; tokenAmount?: number; confirmation?: string };
  rent?: { dueDay?: number; lateFee?: number; lateFeeUnit?: 'once' | 'day'; methods?: ('cash' | 'upi' | 'bank')[]; notes?: string };
  deposit?: { amount?: number; refundDays?: number; deductions?: string };
  stay?: { noticeMonths?: number; lockInMonths?: number; notes?: string };
  cancellation?: { freeCancelDays?: number; refundPercent?: number; text?: string };
  included?: IncludedKey[];
  extraCharges?: PgExtraCharge[];
  maintenance?: { responseHours?: number; notes?: string };
}
export interface PgSafety {
  cctv?: boolean; entry?: 'biometric' | 'keycard' | 'key'; guard?: '24x7' | 'night' | 'hours'; guardFrom?: string; guardTo?: string;
  fireExtinguishers?: boolean; firstAid?: boolean; wardenName?: string; wardenAvailability?: string; emergency?: string;
}
export interface PgMoveIn { documents?: string[]; bring?: string[]; provided?: string[]; steps?: string[] }
export type NearbyCategory = 'college' | 'hospital' | 'pharmacy' | 'atm' | 'bus_stop' | 'supermarket' | 'restaurant' | 'gym' | 'other';
export const NEARBY_LABEL: Record<NearbyCategory, string> = {
  college: 'College', hospital: 'Hospital', pharmacy: 'Pharmacy', atm: 'ATM', bus_stop: 'Bus stop',
  supermarket: 'Supermarket', restaurant: 'Restaurant', gym: 'Gym', other: 'Place',
};
export interface PgNearby { name: string; category: NearbyCategory; distanceM: number; walkMinutes?: number }
export interface PgLocationGuide { howToReach?: string; nearby?: PgNearby[] }
export interface PgFaq { id: string; q: string; a: string }
export interface ReviewSummary { average: number | null; count: number }
export interface PgReview { id: string; rating: number; text: string; firstName: string; createdAt: string }
export interface PgReviewPage { summary: ReviewSummary & { distribution: Record<string, number> }; items: PgReview[]; page: number; hasMore: boolean }
export interface PgReviewEligibility { canReview: boolean; reason: string | null; myReviews: (PgReview & { status: string })[] }

/** Sections to show: the server's list when present, else worked out from the data (older servers). */
export const sectionsOf = (pg: PgDetail): SectionKey[] => {
  if (Array.isArray(pg.sections) && pg.sections.length) return pg.sections;
  return [
    'overview',
    pg.roomTypes.length ? 'rooms' : null,
    pg.messTimetable && pg.messTimetable.meals.length ? 'mess' : null,
    pg.rules.length || pg.timings ? 'rules' : null,
    pg.location ? 'location' : null,
  ].filter(Boolean) as SectionKey[];
};

/** 1 -> "1st", 22 -> "22nd". */
export const ordinal = (n: number) => {
  const v = Math.abs(Math.round(n));
  const t = v % 100;
  const sfx = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] || 'th';
  return `${v}${sfx}`;
};
/** 350 -> "350 m", 1200 -> "1.2 km". */
export const metres = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10 || m} m` : `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`);
export const CHARGE_UNIT_LABEL: Record<ChargeUnit, string> = { month: '/month', unit: '/unit', use: '/use', day: '/day', kg: '/kg', once: ' one time' };
/** "₹10/unit", "₹500 one time". */
export const chargeText = (c: PgExtraCharge) => `${inr(c.amount)}${CHARGE_UNIT_LABEL[c.unit] || ''}`;
export const months = (n: number) => (n === 0 ? 'None' : `${n} month${n === 1 ? '' : 's'}`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Oct 2026". */
export const monthYear = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
/** One decimal, "4.0" kept so ratings line up. */
export const ratingText = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '');

// ── List page (GET /api/pg/home) ────────────────────────────────────────────────────────────────
export interface PgPromotion {
  id: string; type: 'IMAGE' | 'VIDEO'; headline: string; subline: string; label: 'FEATURED' | 'SPONSORED'; labelText: string;
  cta: 'VIEW_PG' | 'WATCH_TOUR' | 'BOOK_VISIT'; ctaLabel: string; imageUrl: string;
  video: { youtubeId: string; thumbnailUrl: string; embedUrl: string; watchUrl: string } | null;
  pg: { id: string; name: string; area: string | null; rentFrom: number | null; genderType: string; isVerified: boolean } | null;
}
export interface PgTour { pgId: string; pgName: string; area: string | null; rentFrom: number | null; video: PgVideo }
export interface PgRail { key: string; title: string; ids: string[] }
export interface PgHome { promotions: PgPromotion[]; tours: PgTour[]; rails: PgRail[]; pgs: PgListItem[] }

/** Deep link that opens a PG in the app (app.json scheme "zenvy"). */
export const pgLink = (id: string) => `zenvy://pg/${encodeURIComponent(id)}`;
