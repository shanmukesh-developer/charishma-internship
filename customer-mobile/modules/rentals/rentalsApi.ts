/**
 * Zenvy Rentals (Others > Rentals > Student vehicles) API client.
 * Backend: backend/modules/rentals (routes under /api/rentals). Prices always come from the server:
 * the quote endpoint for display and the booking request itself (never cached, never sent by the app).
 */
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';

export type VehicleType = 'BIKE' | 'SCOOTER' | 'CAR';
export type Fuel = 'PETROL' | 'DIESEL' | 'EV' | 'CNG';
export type Transmission = 'MANUAL' | 'AUTOMATIC';
export type PlateType = 'COMMERCIAL_RENTAL' | 'PRIVATE';
/** C7: commercial plate -> RENT (owner / renter); private plate -> BORROW (lender / borrower). From the server. */
export type RentalMode = 'RENT' | 'BORROW';
export type ChargesStatus = 'NONE' | 'PENDING' | 'ACCEPTED' | 'AUTO_ACCEPTED' | 'DISPUTED' | 'UPHELD' | 'REDUCED' | 'VOIDED';
export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DELETED';
export type BookingStatus = 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'ACTIVE' | 'RETURNED' | 'COMPLETED' | 'CANCELLED';
export type LicenceStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type DayHours = { start: string; end: string };
export type WeeklyHours = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', DayHours | null>>;
export type DateRange = { start: string; end: string };

export interface PersonBrief {
  id: string;
  name: string;
  avatar: string | null;
  verified?: boolean;
  rating?: { avg: number | null; count: number; trips?: number } | null;
  phone?: string | null;
}

export interface Listing {
  id: string;
  title: string;
  /** C7: RENT (commercial plate) or BORROW (private plate). Older servers omit it: treat as BORROW. */
  rentalMode?: RentalMode;
  vehicleType: VehicleType;
  make: string | null;
  model: string | null;
  year: number | null;
  fuel: Fuel | null;
  transmission: Transmission | null;
  seats: number | null;
  registrationMasked: string | null;
  photos: string[];
  pricePerHour: number | null;
  pricePerDay: number | null;
  securityDeposit: number;
  minHours: number;
  kmLimitPerDay: number | null;
  extraPerKm: number | null;
  fuelPolicy: string | null;
  pickupLocation: string | null;
  pickupLat: number | null;
  pickupLon: number | null;
  weeklyHours: WeeklyHours;
  blockedDates: DateRange[];
  rules: string | null;
  helmetIncluded: boolean;
  ratingAvg: number;
  ratingCount: number;
  tripCount: number;
  status: ListingStatus;
  isMine: boolean;
  owner?: PersonBrief | null;
  quote?: Quote | null;
  createdAt?: string;
}

/** The owner's own listing (My listings / edit). */
export interface OwnListing extends Listing {
  rejectionReason: string | null;
  registrationNumber: string | null;
  registrationDisplay: string | null;
  plateType: PlateType | null;
  photoRefs: string[];
  documentRefs: { rc?: string; insurance?: string; licence?: string };
  documents: { rc: string | null; insurance: string | null; licence: string | null };
  pendingRequests?: number;
  openBookings?: number;
  missing?: string[];
}

export interface Quote {
  startAt: string;
  endAt: string;
  hours: number;
  rawHours: number;
  minHoursApplied: boolean;
  days: number;
  remHours: number;
  mode: 'HOURLY' | 'DAILY' | 'MIXED';
  pricePerHour: number | null;
  pricePerDay: number | null;
  rent: number;
  deposit: number;
  payAtHandover: number;
  kmAllowance: number | null;
  extraPerKm: number | null;
  paymentNote: string;
}

/** C7: terms + disclaimer shown on the listing detail and the booking review. */
export interface SafetyInfo {
  rentalMode: RentalMode;
  termsVersion: string;
  terms: string[];
  disclaimer: string;
  conditionPhotosRequired: boolean;
  chargesResponseHours: number;
  otherChargesCap: number;
}

export interface ConditionSide { photos: string[]; odometer: number | null; note: string | null; at: string | null }
export interface ConditionRecord { owner: ConditionSide | null; renter: ConditionSide | null }
export interface ChargesInfo {
  status: ChargesStatus;
  claimed: number;
  counted: number;
  note: string | null;
  photos: string[];
  respondBy: string | null;
  respondedAt: string | null;
  disputeNote: string | null;
  disputePhotos: string[];
  resolution: { outcome: 'UPHOLD' | 'REDUCE' | 'VOID' | null; amount: number | null; reason: string | null; at: string | null } | null;
}

export interface Review {
  id: string;
  rating: number;
  text: string;
  reviewer: PersonBrief | null;
  createdAt: string;
}

export interface Booking {
  id: string;
  role: 'RENTER' | 'OWNER' | 'VIEWER';
  status: BookingStatus;
  rentalMode?: RentalMode;
  listingId: string;
  vehicleTitle: string;
  vehicleType: VehicleType | null;
  vehiclePhoto: string | null;
  registration: string | null;
  pickupLocation: string | null;
  pickupLat: number | null;
  pickupLon: number | null;
  fuelPolicy: string | null;
  rules: string | null;
  helmetIncluded: boolean;
  startAt: string;
  endAt: string;
  billableHours: number;
  rentAmount: number;
  depositAmount: number;
  payAtHandover: number;
  kmAllowance: number | null;
  priceBreakdown: Partial<Quote>;
  extraCharges: number;
  extraBreakdown: { extraKm?: number; perKm?: number | null; kmCharge?: number; otherCharges?: number; note?: string | null; auto?: boolean; claimed?: number };
  finalAmount: number | null;
  renterNote: string | null;
  ownerNote: string | null;
  respondBy: string | null;
  acceptedAt: string | null;
  declineReason: string | null;
  handoverAt: string | null;
  returnedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: 'RENTER' | 'OWNER' | null;
  cancelReason: string | null;
  expiredAt: string | null;
  createdAt: string;
  counterpart: PersonBrief | null;
  contactVisible: boolean;
  pinLocked: boolean;
  pickupPin?: string | null;
  returnPin?: string | null;
  renterLicence?: { status: LicenceStatus | 'MISSING'; classes: string[] };
  canRate: boolean;
  rated: boolean;
  canReport: boolean;
  // C7 safety (optional: older servers do not send them)
  termsAcceptedAt?: string | null;
  termsVersion?: string | null;
  termsPending?: boolean;
  pickupCondition?: ConditionRecord | null;
  returnCondition?: ConditionRecord | null;
  charges?: ChargesInfo;
  canRespondToCharges?: boolean;
  conditionPhotosRequired?: boolean;
  otherChargesCap?: number;
  /** Single-booking views only: the terms for this booking's mode + the insurance disclaimer. */
  safety?: { termsVersion: string; terms: string[]; disclaimer: string };
}

export interface Licence {
  id: string;
  status: LicenceStatus;
  licenceNumberMasked: string | null;
  classes: string[];
  verifiedClasses: string[] | null;
  expiresOn: string | null;
  frontImage: string | null;
  backImage: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
}

export interface Eligibility {
  enabled: boolean;
  eligible: boolean;
  reasons: string[];
  message: string | null;
  campus: { id: string; name: string; code: string } | null;
  licence: Licence | null;
  myListings: number;
  openRequests: number;
}

export class RentalsError extends Error {
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

const call = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new RentalsError(NETWORK_ERROR_MESSAGE, 0, 'NETWORK');
  }
  const data = await readJson(res);
  if (!data) throw new RentalsError(SERVER_BUSY_MESSAGE, res.status, 'SERVER_BUSY');
  if (!res.ok) {
    const msg = typeof data.message === 'string' && data.message ? data.message : 'Something went wrong. Please try again.';
    throw new RentalsError(res.status === 401 ? 'Please sign in again.' : msg, res.status, data.code || 'ERROR', data);
  }
  return data as T;
};
const post = <T = any>(path: string, body?: any) => call<T>(path, { method: 'POST', body: JSON.stringify(body || {}) });
const qs = (params: Record<string, string | number | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const R = '/api/rentals';

export const rentalsApi = {
  eligibility: () => call<Eligibility>(`${R}/eligibility`),
  browse: (f: { type?: VehicleType | null; maxPricePerHour?: number | null; maxPricePerDay?: number | null; startAt?: string | null; endAt?: string | null; sort?: string; q?: string }) =>
    call<{ listings: Listing[]; count: number; campus: { id: string; name: string } | null }>(`${R}/listings${qs(f as any)}`),
  listing: (id: string) => call<{ listing: Listing | OwnListing; safety?: SafetyInfo; busy: { startAt: string; endAt: string; pending: boolean }[]; reviews: Review[] }>(`${R}/listings/${encodeURIComponent(id)}`),
  quote: (id: string, startAt: string, endAt: string) =>
    call<{ quote: Quote; available: boolean; reason: { code: string; message: string } | null }>(`${R}/listings/${encodeURIComponent(id)}/quote${qs({ startAt, endAt })}`),
  myListings: () => call<{ listings: OwnListing[] }>(`${R}/my/listings`),
  createListing: (body: any) => post<{ listing: OwnListing }>(`${R}/listings`, body),
  updateListing: (id: string, body: any) => call<{ listing: OwnListing; sentToReview: boolean; message: string }>(`${R}/listings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  submitListing: (id: string) => post<{ listing: OwnListing; message: string }>(`${R}/listings/${encodeURIComponent(id)}/submit`),
  pauseListing: (id: string) => post<{ listing: OwnListing; message: string }>(`${R}/listings/${encodeURIComponent(id)}/pause`),
  resumeListing: (id: string) => post<{ listing: OwnListing; message: string }>(`${R}/listings/${encodeURIComponent(id)}/resume`),
  deleteListing: (id: string) => call<{ ok: boolean; message: string }>(`${R}/listings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  licence: () => call<{ licence: Licence | null }>(`${R}/licence`),
  saveLicence: (body: { licenceNumber: string; classes: string[]; frontImage: string; backImage?: string | null; expiresOn?: string | null }) =>
    call<{ licence: Licence; message: string }>(`${R}/licence`, { method: 'PUT', body: JSON.stringify(body) }),
  requestBooking: (body: { listingId: string; startAt: string; endAt: string; note?: string; acceptTerms: true }) => post<{ booking: Booking }>(`${R}/bookings`, body),
  bookings: (role?: 'renter' | 'owner', scope?: 'open' | 'past') => call<{ bookings: Booking[] }>(`${R}/bookings${qs({ role, scope })}`),
  booking: (id: string) => call<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}`),
  accept: (id: string) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/accept`),
  decline: (id: string, reason?: string) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/decline`, { reason }),
  cancel: (id: string, reason?: string) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/cancel`, { reason }),
  handover: (id: string, pin: string) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/handover`, { pin }),
  markReturned: (id: string, pin: string) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/return`, { pin }),
  complete: (id: string, body: { extraKm?: number; otherCharges?: number; note?: string; photos?: string[] }) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/complete`, body),
  // C7 safety
  acceptTerms: (id: string) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/terms`, { acceptTerms: true }),
  condition: (id: string, body: { stage: 'PICKUP' | 'RETURN'; photos: string[]; odometer?: number; note?: string }) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/condition`, body),
  respondCharges: (id: string, body: { action: 'ACCEPT' | 'DISPUTE'; note?: string; photos?: string[] }) => post<{ booking: Booking }>(`${R}/bookings/${encodeURIComponent(id)}/charges`, body),
  rate: (id: string, rating: number, text?: string) => post<{ booking: Booking; message: string }>(`${R}/bookings/${encodeURIComponent(id)}/rate`, { rating, text }),
  report: (id: string, body: { category: string; description: string; photos?: string[] }) => post<{ report: { id: string }; message: string }>(`${R}/bookings/${encodeURIComponent(id)}/report`, body),
};

// ── Display helpers ─────────────────────────────────────────────────────────
/** C7 wording: RENT -> Rent / owner / renter / rent; BORROW -> Borrow / lender / borrower / cost share. */
export const modeOf = (x?: { rentalMode?: RentalMode | null } | null): RentalMode => (x && x.rentalMode === 'RENT' ? 'RENT' : 'BORROW');
export const MODE_WORDS: Record<RentalMode, { verb: string; giver: string; taker: string; Giver: string; Taker: string; price: string; Price: string; badge: string; color: string; booking: string }> = {
  RENT: { verb: 'Rent', giver: 'owner', taker: 'renter', Giver: 'Owner', Taker: 'Renter', price: 'rent', Price: 'Rent', badge: 'Rent', color: '#F59E0B', booking: 'rental' },
  BORROW: { verb: 'Borrow', giver: 'lender', taker: 'borrower', Giver: 'Lender', Taker: 'Borrower', price: 'cost share', Price: 'Cost share', badge: 'Borrow', color: '#10B981', booking: 'borrowing' },
};
export const wordsOf = (x?: { rentalMode?: RentalMode | null } | null) => MODE_WORDS[modeOf(x)];
/** Booking status label in the right words ("Waiting for lender" / "Waiting for owner"). */
export const bookingStatusLabel = (status: BookingStatus, x?: { rentalMode?: RentalMode | null } | null) =>
  (status === 'REQUESTED' ? `Waiting for ${wordsOf(x).giver}` : (BOOKING_STATUS_META[status] || BOOKING_STATUS_META.REQUESTED).label);
export const CHARGES_STATUS_LABEL: Record<ChargesStatus, string> = {
  NONE: 'No extra charges',
  PENDING: 'Waiting for your answer',
  ACCEPTED: 'Accepted',
  AUTO_ACCEPTED: 'Accepted (no answer in time)',
  DISPUTED: 'Disputed: Zenvy team reviewing',
  UPHELD: 'Upheld by Zenvy',
  REDUCED: 'Reduced by Zenvy',
  VOIDED: 'Cancelled by Zenvy',
};

/** `icon` is an Ionicons glyph name (rendered with <Ionicons />, never as text). */
export const VEHICLE_META: Record<VehicleType, { label: string; icon: string }> = {
  BIKE: { label: 'Bike', icon: 'bicycle-outline' },
  SCOOTER: { label: 'Scooter', icon: 'bicycle-outline' },
  CAR: { label: 'Car', icon: 'car-outline' },
};
export const FUEL_LABEL: Record<Fuel, string> = { PETROL: 'Petrol', DIESEL: 'Diesel', EV: 'Electric', CNG: 'CNG' };
export const LICENCE_CLASSES = [
  { key: 'MCWOG', label: 'MCWOG', hint: 'Scooter (gearless)' },
  { key: 'MCWG', label: 'MCWG', hint: 'Motorcycle with gear' },
  { key: 'LMV', label: 'LMV', hint: 'Car' },
  { key: 'LMV-NT', label: 'LMV-NT', hint: 'Car (non-transport)' },
  { key: 'TRANS', label: 'TRANS', hint: 'Transport vehicle' },
];
/** `icon` is an Ionicons glyph name (the chips show the label only). */
export const REPORT_CATEGORIES = [
  { key: 'DAMAGE', label: 'Damage', icon: 'construct-outline' },
  { key: 'NO_SHOW', label: 'No-show', icon: 'close-circle-outline' },
  { key: 'LATE_RETURN', label: 'Late return', icon: 'time-outline' },
  { key: 'SAFETY', label: 'Safety', icon: 'shield-checkmark-outline' },
  { key: 'PAYMENT', label: 'Payment', icon: 'cash-outline' },
  { key: 'OTHER', label: 'Other', icon: 'chatbubble-outline' },
];

export const LISTING_STATUS_META: Record<ListingStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: '#64748B' },
  PENDING_REVIEW: { label: 'In review', color: '#F59E0B' },
  APPROVED: { label: 'Live', color: '#10B981' },
  REJECTED: { label: 'Needs changes', color: '#EF4444' },
  PAUSED: { label: 'Paused', color: '#6366F1' },
  DELETED: { label: 'Removed', color: '#64748B' },
};
export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; color: string }> = {
  REQUESTED: { label: 'Waiting for the owner or lender', color: '#F59E0B' },
  ACCEPTED: { label: 'Confirmed', color: '#10B981' },
  DECLINED: { label: 'Declined', color: '#EF4444' },
  EXPIRED: { label: 'Expired', color: '#64748B' },
  ACTIVE: { label: 'On trip', color: '#3B82F6' },
  RETURNED: { label: 'Returned', color: '#8B5CF6' },
  COMPLETED: { label: 'Completed', color: '#10B981' },
  CANCELLED: { label: 'Cancelled', color: '#64748B' },
};
export const OPEN_BOOKING_STATUSES: BookingStatus[] = ['REQUESTED', 'ACCEPTED', 'ACTIVE', 'RETURNED'];

export const inr = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const IST_OFFSET_MS = 330 * 60 * 1000;
/** 'Mon, 14 Oct · 10:30 AM' in India time (the app is used in India; rentals are always IST). */
export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} · ${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const fmtHours = (h: number) => (h < 24 ? `${h} hr${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} hr${h % 24 === 1 ? '' : 's'}` : ''}`);

/** 'YYYY-MM-DD' of a day `offset` days from today, India time. */
export const istDate = (offset = 0) => new Date(Date.now() + IST_OFFSET_MS + offset * 86400000).toISOString().slice(0, 10);
/** ISO instant for an IST date + 'HH:MM'. */
export const istInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
export const istDayLabel = (date: string) => {
  const today = istDate(0);
  if (date === today) return 'Today';
  if (date === istDate(1)) return 'Tomorrow';
  const d = new Date(`${date}T12:00:00+05:30`);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[new Date(d.getTime() + IST_OFFSET_MS).getUTCDay()]} ${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]}`;
};
export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "1 trip" / "3 trips". */
export const tripsLabel = (n: number | null | undefined) => {
  const c = Math.max(0, Math.round(Number(n) || 0));
  return `${c} trip${c === 1 ? '' : 's'}`;
};
/** Rating average for display: "4.5" (one decimal), or '' when there is none. */
export const ratingLabel = (avg: number | null | undefined) => (Number.isFinite(Number(avg)) && Number(avg) > 0 ? Number(avg).toFixed(1) : '');
/** 'YYYY-MM-DD' -> "31 May 2034" (date-only, no time zone shift). '' if not a date. */
export const fmtDateOnly = (date?: string | null) => {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = Number(date.slice(5, 7));
  if (!(m >= 1 && m <= 12)) return '';
  return `${Number(date.slice(8, 10))} ${months[m - 1]} ${date.slice(0, 4)}`;
};

/** Short "from" price for cards. */
export const priceLabel = (l: Pick<Listing, 'pricePerHour' | 'pricePerDay'>) => {
  const parts: string[] = [];
  if (l.pricePerHour) parts.push(`${inr(l.pricePerHour)}/hr`);
  if (l.pricePerDay) parts.push(`${inr(l.pricePerDay)}/day`);
  return parts.join(' · ') || 'Amount on request';
};

export const reasonToMessage = (code?: string) => {
  switch (code) {
    case 'VERIFICATION_REQUIRED':
    case 'CAMPUS_REQUIRED':
      return 'Verify your college email or ID to list, rent or borrow vehicles.';
    case 'CAMPUS_INACTIVE':
      return 'Rentals are not open for your campus yet.';
    case 'ACCOUNT_SUSPENDED':
      return 'Your account is suspended.';
    default:
      return null;
  }
};
