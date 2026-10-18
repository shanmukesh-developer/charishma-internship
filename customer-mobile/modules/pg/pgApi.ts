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
  contactInfo: { ownerName?: string; phone?: string; email?: string; wardenName?: string; emergencyContact?: string; lat?: number; lng?: number };
  location: { lat: number; lng: number } | null;
  rooms: PgRoom[]; roomTypes: PgRoomType[]; bedsAvailable: number;
}
export interface PgListItem {
  id: string; name: string; address: string; area?: string | null; distanceFromCollege: number; genderType: string;
  baseRent: number; rentFrom?: number | null; isVerified?: boolean; amenities?: string[]; coverPhoto?: string | null;
  images?: string[]; photoCount?: number; videoCount?: number; hasMess?: boolean; bedsAvailable?: number; hasRooms?: boolean;
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
