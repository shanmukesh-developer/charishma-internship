/**
 * Zenvy Auto-Ride (Others > Co-Ride > AUTO) API client: shared autos run by verified Zenvy Auto drivers.
 * Backend: backend/modules/autoRide (customer routes under /api/auto-ride, see routes.js + controllers/customer.js).
 * Fares, seat numbers, availability and totals always come from the server; the app only says what it wants.
 * Writes that create something (holds, confirmations, full-auto requests) carry an Idempotency-Key so a retry
 * after a dropped connection returns the same booking instead of a second one.
 */
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';
import { newIdempotencyKey } from '../../context/CartContext';

export { newIdempotencyKey };

export type TripStatus =
  | 'DRAFT' | 'PUBLISHED' | 'OPEN_FOR_BOOKING' | 'DEPARTURE_THRESHOLD_REACHED' | 'FULL' | 'DRIVER_CONFIRMED'
  | 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED' | 'CANCELLED' | 'NO_SHOW' | 'DRIVER_UNAVAILABLE' | 'VEHICLE_UNAVAILABLE';
export type Availability =
  | 'NOT_OPEN' | 'AVAILABLE' | 'FILLING_FAST' | 'READY_TO_DEPART' | 'FULL' | 'PRIVATE' | 'DEPARTING' | 'BOARDING'
  | 'DELAYED' | 'IN_PROGRESS' | 'CLOSED';
export type BookingStatus = 'HELD' | 'CONFIRMED' | 'BOARDED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'NO_SHOW' | 'REFUND_PENDING' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'WALLET';
export type PaymentStatus = 'NONE' | 'CASH_DUE' | 'CASH_COLLECTED' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'NOT_REFUNDED';
export type PrivateStatus = 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'CONFLICT' | 'EXPIRED' | 'CANCELLED';
/** Seat states from GET /trips/:id/seats (MINE / MINE_HELD = this passenger's own seats). */
export type SeatState = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'MINE' | 'MINE_HELD';
/** Layout cell: 'D' = driver seat (never bookable), null = gap, number = passenger seat. */
export type LayoutCell = 'D' | number | null;
/** Who is looking at a seat map (front-seat rule): MALE, NOT_MALE, or UNKNOWN ('Prefer not to say' in the profile). */
export type SeatViewer = 'MALE' | 'NOT_MALE' | 'UNKNOWN';
/** "Are you booking for a boy?" answer sent with a hold when the profile gender is unknown. */
export type RiderGender = 'Male' | 'Female' | 'Other';
/** Server layout: rows front to back + the seats beside the driver only boys may book. */
export interface SeatLayoutData { rows: LayoutCell[][]; maleOnlySeats?: number[] }

export interface ExtraCharges { amount: number; note: string | null }

/** GET /status settings (also GET /settings/public): the limits the server enforces. */
export interface PublicSettings {
  maxSeatsPerBooking: number;
  holdMinutes: number;
  /** Zenvy Wallet refund % when the passenger cancels before / after the driver confirms departure. */
  refundBeforeDriverConfirmPct: number;
  refundAfterDriverConfirmPct: number;
  maxAdvanceDays: number;
  platformMaxCapacity: number;
  privateRespondMinutes?: number;
  walletEnabled: boolean;
}

export interface RouteBrief { id: string; name: string; origin: string | null; destination: string | null; distanceKm: number | null }
export interface PickupBrief { id: string; name: string; landmark: string | null; lat: number | null; lon: number | null; mapsUrl: string | null }

/** serialize.tripStatus(): the one status block both apps see for a trip. */
export interface TripStatusBlock {
  status: TripStatus;
  statusLabel: string;
  availability: Availability;
  availabilityLabel: string;
  mode: 'SHARED' | 'PRIVATE';
  capacity: number;
  confirmedSeats: number;
  heldSeats: number;
  boardedSeats: number;
  remainingSeats: number;
  minSeatsToDepart: number;
  queueNumber: number | null;
  departureAt: string | null;
  originalDepartureAt: string | null;
  delayMinutes: number;
  version: number;
  /** ZCS Auto union queue: ON_CHARGE autos line up at a stand; only the front one (onCharge) takes bookings. */
  dispatchMode?: 'SCHEDULED' | 'ON_CHARGE';
  queueState?: 'WAITING' | 'ON_CHARGE' | 'DONE' | null;
  onCharge?: boolean;
  /** No departure time: the auto leaves when full or when the driver departs (departureAt is null then). */
  leavesWhenFull?: boolean;
  walkInSeats?: number;
  appSeats?: number;
}

/** serialize.tripCustomer() */
export interface Trip extends TripStatusBlock {
  id: string;
  driver: { name: string; firstName?: string; verified: boolean; photo: string | null; rating: { avg: number; count: number } | null } | null;
  vehicle: { registration: string | null; registrationMasked: boolean; make: string | null; model: string | null; colour: string | null; fuel: string | null } | null;
  route: RouteBrief | null;
  pickup: PickupBrief | null;
  destination: string | null;
  stops: string[];
  seatFare: number;
  fullAutoFare: number | null;
  /** Driver-set full-auto extra charges (added to the private fare by the server); null when none. */
  extraCharges?: ExtraCharges | null;
  /** fullAutoFare + extra charges: what a full-auto request will cost. */
  fullAutoTotal?: number | null;
  seatSelectionEnabled: boolean;
  sharedBookingAllowed: boolean;
  privateBookingAllowed: boolean;
  queueNote: string;
  myBookingId: string | null;
  myBookingStatus: BookingStatus | null;
  /** Journey steps on the booking screen: boarding started, trip started, arrived at the destination. */
  boardingAt?: string | null;
  startedAt?: string | null;
  arrivedAt?: string | null;
}

export interface SeatMap extends TripStatusBlock {
  tripId: string;
  seatSelectionEnabled: boolean;
  seatFare: number;
  layout: SeatLayoutData;
  /** maleOnly = beside the driver (boys only); forYou = this passenger can book this free seat. */
  seats: { seatNo: number; state: SeatState; maleOnly?: boolean; forYou?: boolean }[];
  legend: SeatState[];
  viewer?: SeatViewer;
  summary?: { available: number; availableForYou: number; heldByYou?: number; onlyFrontSeatsLeft: boolean };
}

/** serialize.bookingCustomer() */
export interface Booking {
  id: string;
  bookingCode: string;
  tripId: string;
  type: 'SHARED' | 'PRIVATE';
  seatCount: number;
  seatNumbers: number[];
  status: BookingStatus;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus | null;
  amount: number;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  boardedAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
  seatFare: number | null;
  fareBreakdown: { seats?: number; seatFare?: number; total?: number; fullAuto?: boolean; fare?: number; baseFare?: number; extraCharges?: ExtraCharges };
  refundAmount: number;
  refundedAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  boardingPin: string | null;
  /** When the booking was marked not here (NO_SHOW). */
  noShowAt?: string | null;
  /** Marked not here, but the driver can still check them in with the code + PIN until this time. */
  lateCheckInUntil?: string | null;
  trip: Trip | null;
  /** ZCS Auto at the stand: reach the auto and check in before this, or the seat is released (null = no clock). */
  arriveBy?: string | null;
  arrivalWindowMinutes?: number | null;
  driverPhone: string | null;
  pickupInstructions: string | null;
}

/** serialize.privateRequestCustomer() */
export interface PrivateRequest {
  id: string;
  tripId: string;
  status: PrivateStatus;
  passengers: number;
  purpose: string | null;
  fare: number;
  /** fare = baseFare + extraCharges.amount (server-computed). */
  baseFare?: number;
  extraCharges?: ExtraCharges | null;
  paymentMethod: PaymentMethod;
  respondBy: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  bookingId: string | null;
  createdAt: string | null;
  note: string | null;
}

/** serialize.routeFull() */
export interface RouteFull extends RouteBrief {
  campusId: string | null;
  seatFareMin: number | null;
  seatFareMax: number | null;
  fullFareMin: number | null;
  fullFareMax: number | null;
  operatingPeriods: any[];
  minSeatsToDepartDefault: number | null;
  permittedStops: string[];
  isActive: boolean;
  sortOrder: number;
  pickupPoints: (PickupBrief & { routeId: string; sequence: number; isActive: boolean })[];
}

/** One auto in a stand's line on the board (position 1 = on charge); every one of them takes bookings. */
export type ChargeAuto = Trip & {
  position: number;
  seatMap: Pick<SeatMap, 'layout' | 'seats' | 'legend' | 'viewer' | 'summary'>;
  /** Free seats THIS passenger can book (the seats beside the driver are for boys only). */
  seatsForYou?: number;
  /** Free seats are left, but only the boys-only front seats. */
  onlyFrontSeatsLeft?: boolean;
  /** Seats this passenger is holding on this auto right now (not counted in remainingSeats; Book confirms them). */
  heldByYou?: number;
};
/** GET /on-charge: one stand (pickup point + destination) with the auto on charge and the autos waiting behind. */
export interface ChargeLine {
  key: string;
  route: RouteBrief | null;
  pickup: PickupBrief | null;
  destination: string | null;
  seatFare: number | null;
  onCharge: ChargeAuto | null;
  waitingCount: number;
  waiting: { position: number; lineSeq: number | null }[];
  /** The waiting autos in line order (#2, #3 ...), each bookable. */
  waitingAutos?: ChargeAuto[];
}

export interface QueueEntry extends Trip { periodKey: string | null; checkInAt: string | null }

export const INCIDENT_CATEGORIES = [
  { key: 'SAFETY', label: 'Safety', icon: '🛡️' },
  { key: 'HARASSMENT', label: 'Harassment', icon: '🚨' },
  { key: 'OVERCHARGE', label: 'Overcharged', icon: '💸' },
  { key: 'RASH_DRIVING', label: 'Rash driving', icon: '⚠️' },
  { key: 'NO_SHOW', label: 'Driver no-show', icon: '🚫' },
  { key: 'VEHICLE_ISSUE', label: 'Vehicle issue', icon: '🔧' },
  { key: 'PAYMENT', label: 'Payment', icon: '💵' },
  { key: 'LOST_ITEM', label: 'Lost item', icon: '🎒' },
  { key: 'OTHER', label: 'Other', icon: '💬' },
] as const;

export class AutoRideError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(message: string, status = 0, code = 'ERROR', data: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
  /** The request may not have reached the server: retry with the SAME idempotency key. */
  get isNetwork() { return this.code === 'NETWORK' || this.code === 'SERVER_BUSY'; }
}

const call = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new AutoRideError(NETWORK_ERROR_MESSAGE, 0, 'NETWORK');
  }
  const data = await readJson(res);
  if (!data) throw new AutoRideError(SERVER_BUSY_MESSAGE, res.status, 'SERVER_BUSY');
  if (!res.ok) {
    const msg = typeof data.message === 'string' && data.message ? data.message : 'Something went wrong. Please try again.';
    throw new AutoRideError(res.status === 401 ? 'Please sign in again.' : msg, res.status, data.code || 'ERROR', data);
  }
  return data as T;
};
const post = <T = any>(path: string, body?: any, idempotencyKey?: string) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body || {}), ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) });
const qs = (params: Record<string, string | number | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};
const enc = encodeURIComponent;

export const AR = '/api/auto-ride';

export interface BrowseFilter {
  routeId?: string | null;
  pickupPointId?: string | null;
  destination?: string | null;
  date?: string | null; // YYYY-MM-DD (IST)
  time?: string | null; // HH:MM, only used with date
  passengers?: number | null;
  mode?: 'private' | null;
}

export const autoRideApi = {
  /** No feature gate: { enabled, paymentMethods } (paymentMethods is [] while off). */
  status: () => call<{ enabled: boolean; paymentMethods: PaymentMethod[]; settings?: PublicSettings }>(`${AR}/status`),
  settings: () => call<{ settings: PublicSettings }>(`${AR}/settings/public`),
  routes: () => call<{ routes: RouteFull[] }>(`${AR}/routes`),
  pickupPoints: (routeId?: string | null) => call<{ pickupPoints: (PickupBrief & { route: RouteBrief | null })[]; note: string }>(`${AR}/pickup-points${qs({ routeId })}`),
  queue: (pickupPointId: string, date?: string | null) =>
    call<{ pickupPoint: PickupBrief; date: string; queue: QueueEntry[]; note: string }>(`${AR}/pickup-points/${enc(pickupPointId)}/queue${qs({ date })}`),
  /** ZCS Auto union queue board: per stand the auto on charge (live seats + seat map) and how many wait behind. */
  onCharge: (f: { routeId?: string | null; pickupPointId?: string | null } = {}) =>
    call<{ lines: ChargeLine[]; maxSeatsPerBooking: number; serverTime: string; note: string }>(`${AR}/on-charge${qs(f)}`),
  browse: (f: BrowseFilter = {}) => call<{ trips: Trip[]; serverTime: string }>(`${AR}/trips${qs(f as any)}`),
  trip: (id: string) => call<{ trip: Trip; serverTime: string }>(`${AR}/trips/${enc(id)}`),
  seats: (id: string) => call<SeatMap>(`${AR}/trips/${enc(id)}/seats`),
  /** 201 created / 200 duplicate (same key, or an existing hold of mine on this trip). */
  hold: (tripId: string, body: { seatCount: number; seatNumbers?: number[]; riderGender?: RiderGender }, idempotencyKey: string) =>
    post<{ booking: Booking; created: boolean; duplicate: boolean }>(`${AR}/trips/${enc(tripId)}/holds`, { ...body, idempotencyKey }, idempotencyKey),
  /** Confirming an already-confirmed booking answers 200 duplicate: safe to retry. */
  confirm: (bookingId: string, paymentMethod: PaymentMethod, idempotencyKey?: string) =>
    post<{ booking: Booking; duplicate: boolean }>(`${AR}/bookings/${enc(bookingId)}/confirm`, { paymentMethod }, idempotencyKey),
  release: (bookingId: string) => post<{ booking: Booking }>(`${AR}/bookings/${enc(bookingId)}/release`),
  cancel: (bookingId: string, reason?: string) => post<{ booking: Booking }>(`${AR}/bookings/${enc(bookingId)}/cancel`, { reason }),
  incident: (bookingId: string, category: string, description: string) =>
    post<{ incident: { id: string; status: string }; message: string }>(`${AR}/bookings/${enc(bookingId)}/incident`, { category, description }),
  bookings: (scope?: 'upcoming' | 'past') => call<{ bookings: Booking[] }>(`${AR}/bookings${qs({ scope })}`),
  booking: (id: string) => call<{ booking: Booking }>(`${AR}/bookings/${enc(id)}`),
  requestPrivate: (tripId: string, body: { passengers: number; purpose?: string; paymentMethod?: PaymentMethod }, idempotencyKey: string) =>
    post<{ request: PrivateRequest; duplicate: boolean }>(`${AR}/trips/${enc(tripId)}/private-requests`, { ...body, idempotencyKey }, idempotencyKey),
  privateRequests: () => call<{ requests: PrivateRequest[] }>(`${AR}/private-requests`),
  privateRequest: (id: string) => call<{ request: PrivateRequest }>(`${AR}/private-requests/${enc(id)}`),
  cancelPrivate: (id: string) => post<{ request: PrivateRequest }>(`${AR}/private-requests/${enc(id)}/cancel`),
};

// ── Display helpers ─────────────────────────────────────────────────────────
export const inr = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return `₹${(Math.round(v * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' of a day `offset` days from today, India time. */
export const istDate = (offset = 0) => new Date(Date.now() + IST_OFFSET_MS + offset * 86400000).toISOString().slice(0, 10);
const ist = (iso: string) => new Date(new Date(iso).getTime() + IST_OFFSET_MS);
export const fmtClock = (iso?: string | null) => {
  if (!iso) return '';
  const d = ist(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const istDayLabel = (date: string) => {
  if (date === istDate(0)) return 'Today';
  if (date === istDate(1)) return 'Tomorrow';
  const d = new Date(`${date}T12:00:00+05:30`);
  return `${DAYS[ist(d.toISOString()).getUTCDay()]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
};
/** 'Today · 5:30 PM' / 'Tue 21 Oct · 9:00 AM' (IST). */
export const fmtDeparture = (iso?: string | null) => {
  // Only an auto on charge has no departure time (scheduled trips always have one).
  if (!iso) return 'Leaves when full';
  const d = ist(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${istDayLabel(d.toISOString().slice(0, 10))} · ${fmtClock(iso)}`;
};
export const fmtHHMM = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
/** 'in 12 min' / 'in 1 h 5 min' / 'now'. */
export const fromNow = (iso?: string | null, nowMs = Date.now()) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 30000) return 'now';
  const m = Math.round(ms / 60000);
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const queueLabel = (n: number | null | undefined) => (n ? `Auto ${String(n).padStart(2, '0')}` : 'Auto');

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: 'Cash to driver', WALLET: 'ZenWe Wallet' };
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  NONE: 'Nothing paid',
  CASH_DUE: 'Pay the driver in cash at boarding',
  CASH_COLLECTED: 'Cash paid to the driver',
  PAID: 'Paid from ZenWe Wallet',
  REFUND_PENDING: 'Refund in progress',
  REFUNDED: 'Refunded to ZenWe Wallet',
  NOT_REFUNDED: 'Not refunded (cancellation policy)',
};

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; color: string; icon: string }> = {
  HELD: { label: 'Seats held', color: '#F59E0B', icon: '⏳' },
  CONFIRMED: { label: 'Confirmed', color: '#10B981', icon: '✅' },
  BOARDED: { label: 'Boarded', color: '#3B82F6', icon: '🛺' },
  COMPLETED: { label: 'Completed', color: '#10B981', icon: '🏁' },
  CANCELLED: { label: 'Cancelled', color: '#64748B', icon: '✕' },
  EXPIRED: { label: 'Hold expired', color: '#64748B', icon: '⌛' },
  NO_SHOW: { label: 'Not checked in', color: '#EF4444', icon: '🚫' },
  REFUND_PENDING: { label: 'Refund pending', color: '#F59E0B', icon: '↺' },
  REFUNDED: { label: 'Refunded', color: '#6366F1', icon: '↺' },
};
export const LIVE_BOOKING: BookingStatus[] = ['HELD', 'CONFIRMED', 'BOARDED'];

export const PRIVATE_STATUS_META: Record<PrivateStatus, { label: string; color: string; icon: string }> = {
  REQUESTED: { label: 'Waiting for driver', color: '#F59E0B', icon: '⏳' },
  ACCEPTED: { label: 'Accepted · booked', color: '#10B981', icon: '✅' },
  DECLINED: { label: 'Declined', color: '#EF4444', icon: '✕' },
  CONFLICT: { label: 'Could not be booked', color: '#EF4444', icon: '⚠️' },
  EXPIRED: { label: 'Expired', color: '#64748B', icon: '⌛' },
  CANCELLED: { label: 'Cancelled', color: '#64748B', icon: '✕' },
};

/**
 * Card / header chip for a trip, from the server's availability + real counts. Never invents a state:
 * 'Departure soon' is only added for a bookable trip whose server departure time is within 15 minutes.
 */
export const availabilityChip = (t: Pick<TripStatusBlock, 'availability' | 'availabilityLabel' | 'delayMinutes' | 'departureAt' | 'remainingSeats'>, nowMs = Date.now()) => {
  const soon = !!t.departureAt && new Date(t.departureAt).getTime() - nowMs <= 15 * 60000 && new Date(t.departureAt).getTime() > nowMs;
  switch (t.availability) {
    case 'AVAILABLE': return soon ? { label: `Departure soon · ${t.remainingSeats} left`, color: '#F59E0B', icon: '⏱️' } : { label: `${t.remainingSeats} seat${t.remainingSeats === 1 ? '' : 's'} available`, color: '#10B981', icon: '🟢' };
    case 'FILLING_FAST': return { label: `Filling fast · ${t.remainingSeats} left`, color: '#F97316', icon: '🔥' };
    case 'READY_TO_DEPART': return { label: `Ready to depart · ${t.remainingSeats} left`, color: '#0EA5E9', icon: '🚦' };
    case 'FULL': return { label: 'FULL – ready for driver', color: '#EF4444', icon: '⛔' };
    case 'PRIVATE': return { label: 'Booked as full auto', color: '#8B5CF6', icon: '🔒' };
    case 'NOT_OPEN': return { label: 'Booking opens soon', color: '#64748B', icon: '🕒' };
    case 'DEPARTING': return { label: 'Departure soon · driver confirmed', color: '#0EA5E9', icon: '⏱️' };
    case 'BOARDING': return { label: 'Boarding now', color: '#3B82F6', icon: '🚏' };
    case 'DELAYED': return { label: t.delayMinutes ? `Delayed ${t.delayMinutes} min` : 'Delayed', color: '#F59E0B', icon: '⚠️' };
    case 'IN_PROGRESS': return { label: 'On the way', color: '#3B82F6', icon: '🛺' };
    default: return { label: t.availabilityLabel || 'Closed', color: '#64748B', icon: '•' };
  }
};

/** Trip states for the booking timeline (the exceptions are shown as a separate banner). */
export const TIMELINE: { key: string; label: string; statuses: TripStatus[] }[] = [
  { key: 'booked', label: 'Booked', statuses: ['PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL'] },
  { key: 'confirmed', label: 'Driver confirmed departure', statuses: ['DRIVER_CONFIRMED'] },
  { key: 'boarding', label: 'Boarding', statuses: ['BOARDING'] },
  { key: 'progress', label: 'On the way', statuses: ['IN_PROGRESS'] },
  { key: 'done', label: 'Completed', statuses: ['COMPLETED'] },
];
export const EXCEPTION_STATUSES: TripStatus[] = ['CANCELLED', 'NO_SHOW', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'];

/** Friendly copy for known error codes (falls back to the server's own message). */
export const errorCopy = (e: any): { title: string; message: string } => {
  const code = e?.code;
  const msg = e?.message || 'Please try again.';
  switch (code) {
    case 'FEATURE_OFF': return { title: 'ZenWe Auto is not open yet', message: msg };
    case 'SEAT_TAKEN': return { title: 'Seat just taken', message: msg };
    case 'FRONT_SEAT_MALE_ONLY': return { title: 'Boys only', message: msg };
    case 'NO_SUITABLE_SEAT': return { title: 'Only front seats left', message: msg };
    case 'HOLD_EXPIRED': return { title: 'Hold expired', message: msg };
    case 'TRIP_PRIVATE': return { title: 'Booked as a full auto', message: msg };
    case 'TRIP_FULL': return { title: 'This auto is full', message: msg };
    case 'AUTO_JUST_FILLED': return { title: 'This auto just filled', message: msg };
    case 'AUTO_OFF_CHARGE': return { title: 'No longer taking bookings', message: msg };
    case 'WAITING_IN_LINE': return { title: 'Waiting in line', message: msg };
    case 'NOT_ENOUGH_SEATS': return { title: 'Not enough seats', message: msg };
    case 'BOOKING_CLOSED': return { title: 'Booking closed', message: msg };
    case 'ALREADY_BOOKED': return { title: 'Already booked', message: msg };
    case 'TOO_MANY_HOLDS': return { title: 'Too many holds', message: msg };
    case 'TOO_MANY_REQUESTS': return { title: 'Requests waiting', message: msg };
    case 'RATE_LIMITED': return { title: 'Slow down', message: msg };
    case 'PHONE_REQUIRED': return { title: 'Add your mobile number', message: msg };
    case 'PAYMENT_METHOD_OFF': return { title: 'Payment method unavailable', message: msg };
    case 'INSUFFICIENT_WALLET': return { title: 'Not enough wallet balance', message: msg };
    case 'SEATS_ALREADY_BOOKED': return { title: 'Seats already booked', message: msg };
    case 'PRIVATE_OFF': return { title: 'Full auto not offered', message: msg };
    case 'NETWORK':
    case 'SERVER_BUSY': return { title: 'Connection problem', message: msg };
    default: return { title: 'Could not complete', message: msg };
  }
};
