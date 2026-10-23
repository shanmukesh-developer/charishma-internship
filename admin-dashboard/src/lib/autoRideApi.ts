// Zenvy Auto-Ride admin API (backend/modules/autoRide/routes.js adminRouter, mounted at
// /api/admin/auto-ride, protect + admin). Shapes mirror services/serialize.js + controllers/admin.js.
// Errors come back as { code, message, ...extra }; adminRequest turns the message into an Error.
import { adminRequest } from './api';

const BASE = '/api/admin/auto-ride';

export const DRIVER_STATUSES = ['PENDING_DOCS', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const;
export const VEHICLE_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export const TRIP_STATUSES = ['DRAFT', 'PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL', 'DRIVER_CONFIRMED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED', 'CANCELLED', 'NO_SHOW', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'] as const;
export const TERMINAL_TRIP_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'];
/** Statuses an admin may cancel from (enums.js TRANSITIONS: admin -> CANCELLED). */
export const ADMIN_CANCELLABLE = ['DRAFT', 'PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL', 'DRIVER_CONFIRMED', 'BOARDING', 'DELAYED'];
export const BOOKING_STATUSES = ['HELD', 'CONFIRMED', 'BOARDED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'REFUND_PENDING', 'REFUNDED'] as const;
export const PRIVATE_STATUSES = ['REQUESTED', 'ACCEPTED', 'DECLINED', 'CONFLICT', 'EXPIRED', 'CANCELLED'] as const;
export const INCIDENT_STATUSES = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'] as const;
export const DRIVER_DOC_KEYS = ['photo', 'licenceFront', 'licenceBack', 'badge', 'policeVerification'] as const;
export const REQUIRED_DRIVER_DOCS = ['photo', 'licenceFront', 'licenceBack'];
export const VEHICLE_DOC_KEYS = ['rc', 'permit', 'insurance', 'fitness', 'puc'] as const;
export const REQUIRED_VEHICLE_DOCS = ['rc', 'permit', 'insurance'];
export const LIMITS = { ABSOLUTE_MAX_CAPACITY: 12, MAX_LAYOUT_ROWS: 6, MAX_LAYOUT_COLS: 5, MAX_FARE: 5000, MAX_FULL_FARE: 20000 };

/** Every admin list answers { ..., pagination } (page / limit query params; without them the old default size). */
export interface Pagination { page: number; limit: number | null; hasMore: boolean }
export interface PageOpts { page?: number; limit?: number }
/** First name + masked phone ('•••• 3210'). */
export interface PersonBrief { id: string; name: string; phoneMasked: string | null }
export interface ExtraCharges { amount: number; note: string | null }

export interface Summary {
  onlineVerifiedDrivers: number; pendingDrivers: number; pendingVehicles: number; openTrips: number; bookedSeats: number;
  fullTrips: number; privateAwaiting: number; tripsInProgress: number; cancelledToday: number; openIncidents: number;
  refundPending: number; enabled: boolean; walletEnabled: boolean;
}

export interface Driver {
  id: string; name: string; phone: string; status: string; rejectionReason: string | null; suspendedReason: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; licenceNumber: string | null; licenceExpiresOn: string | null;
  badgeNumber: string | null; documents: Record<string, string | null>; documentPreviews: Record<string, string | null>;
  preferredRouteIds: string[]; isOnline: boolean; submittedAt: string | null; reviewedAt: string | null; createdAt: string | null;
  reviewedBy: string | null; lastOnlineAt: string | null; lastLoginAt: string | null;
}

export type LayoutCell = 'D' | number | null;
export interface SeatLayout { rows: LayoutCell[][] }

export interface Vehicle {
  id: string; driverId: string; registration: string | null; registrationNumber: string; make: string | null; model: string | null;
  year: number | null; fuel: string | null; colour: string | null; rcSeatingCapacity: number; requestedCapacity: number | null;
  approvedCapacity: number | null; seatLayout: SeatLayout | null; permitNumber: string | null; permitExpiresOn: string | null;
  insuranceExpiresOn: string | null; fitnessExpiresOn: string | null; pucExpiresOn: string | null; documents: Record<string, string | null>;
  documentPreviews: Record<string, string | null>; photos: string[]; photoPreviews: (string | null)[]; status: string;
  rejectionReason: string | null; reviewedAt: string | null; createdAt: string | null;
  /** Only on the list endpoint: min(RC seating, platform max). */
  suggestedApprovedCapacity?: number | null;
}

export interface TripStatusBlock {
  status: string; statusLabel: string; availability: string; availabilityLabel: string; mode: 'SHARED' | 'PRIVATE'; capacity: number;
  confirmedSeats: number; heldSeats: number; boardedSeats: number; remainingSeats: number; minSeatsToDepart: number;
  queueNumber: number | null; departureAt: string | null; originalDepartureAt: string | null; delayMinutes: number; version: number;
}
export interface Trip extends TripStatusBlock {
  id: string; driverId: string; routeId: string; pickupPointId: string; vehicleId: string; destination: string | null;
  stops: string[]; seatFare: number; fullAutoFare: number | null; seatSelectionEnabled: boolean; privateBookingEnabled: boolean;
  seatLayout: SeatLayout | null; bookingOpensAt: string | null; operatingDate: string | null; periodKey: string | null;
  publishedAt: string | null; confirmedAt: string | null; boardingAt: string | null; startedAt: string | null; arrivedAt: string | null;
  completedAt: string | null; cancelReason: string | null; delayReason: string | null; createdAt: string | null;
  extraCharges?: ExtraCharges | null;
  /** GET /trips list rows only. */
  routeName?: string | null; pickupName?: string | null; driverName?: string | null;
  route?: { id: string; name: string } | null; pickup?: { id: string; name: string } | null;
}
export interface TripEvent { id: string; from: string | null; to: string; actorType: string | null; actorId: string | null; note: string | null; at: string | null }

export interface Booking {
  id: string; bookingCode: string; tripId: string; type: string; seatCount: number; seatNumbers: number[]; status: string;
  paymentMethod: string | null; paymentStatus: string | null; amount: number; holdExpiresAt: string | null; confirmedAt: string | null;
  boardedAt: string | null; cancelledAt: string | null; createdAt: string | null; userId: string; driverId: string;
  passenger: { id: string; name: string; phone: string | null } | null; refundAmount: number; refundedAt: string | null;
  refundAttempts: number; walletDebited: number; cancelledBy: string | null; cancelReason: string | null; pinLocked: boolean;
  trip: (TripStatusBlock & { id: string }) | null;
}

export interface PrivateRequest {
  id: string; tripId: string; status: string; passengers: number; purpose: string | null; fare: number; paymentMethod: string;
  respondBy: string | null; respondedAt: string | null; declineReason: string | null; bookingId: string | null; createdAt: string | null;
  note: string | null; userId: string; driverId?: string;
  baseFare?: number; extraCharges?: ExtraCharges | null;
  passenger?: PersonBrief | null; driver?: PersonBrief | null;
}

export interface Incident {
  id: string; tripId: string | null; bookingId: string | null; reporterType: string; category: string; description: string | null;
  status: string; adminNote: string | null; createdAt: string | null; resolvedAt: string | null; reporterId?: string;
  priority?: 'NORMAL' | 'HIGH'; reporter?: PersonBrief | null;
}

export interface OperatingPeriod { key: string; label: string; start: string; end: string }
export interface PickupPoint {
  id: string; name: string; landmark: string | null; lat: number | null; lon: number | null; mapsUrl: string | null;
  routeId: string; sequence: number; isActive: boolean;
}
export interface Route {
  id: string; name: string; origin: string; destination: string; distanceKm: number | null; campusId: string | null;
  seatFareMin: number | null; seatFareMax: number | null; fullFareMin: number | null; fullFareMax: number | null;
  operatingPeriods: OperatingPeriod[]; minSeatsToDepartDefault: number | null; permittedStops: string[]; isActive: boolean;
  sortOrder: number; pickupPoints: PickupPoint[];
  /** Union queue: the default seat fare autos put on charge use, and the fare in effect (default, else min, else max). */
  seatFareDefault?: number | null; chargeSeatFare?: number | null;
}
/** Body for POST /routes and PATCH /routes/:id (controllers/admin.js routeInput). */
export interface RouteInput {
  name: string; originLabel: string; destinationLabel: string; distanceKm: number | null;
  seatFareMin: number | null; seatFareMax: number | null; fullFareMin: number | null; fullFareMax: number | null;
  operatingPeriods: OperatingPeriod[]; minSeatsToDepartDefault: number | null; permittedStops: string[]; isActive: boolean; sortOrder: number;
  seatFareDefault?: number | null;
}
export interface PickupInput { name: string; landmark: string | null; lat: number | null; lon: number | null; sequence: number; isActive: boolean }

export interface QueueItem extends TripStatusBlock {
  id: string; pickup: { id: string; name: string; landmark: string | null; lat: number | null; lon: number | null; mapsUrl: string | null } | null;
  periodKey: string | null; driverId: string; checkInAt: string | null;
}

/** GET /lines: one auto in a stand's line (position 1 = on charge). */
export interface ChargeLineAuto {
  position: number; tripId: string; driverId: string; driverName: string | null; driverPhoneMasked: string | null; registration: string | null;
  queueState: 'WAITING' | 'ON_CHARGE' | 'DONE' | null; status: string; statusLabel: string; capacity: number; appSeats: number; walkInSeats: number;
  heldSeats: number; remainingSeats: number; seatFare: number; lineSeq: number | null; checkedInAt: string | null; onChargeSince: string | null;
}
/** GET /lines: a stand (pickup point + route) and its live line. */
export interface ChargeLine {
  key: string;
  route: { id: string; name: string; origin: string; destination: string; distanceKm: number | null; isActive: boolean; seatFareDefault: number | null; seatFareMin: number | null; seatFareMax: number | null };
  pickup: { id: string; name: string; landmark: string | null; mapsUrl: string | null; isActive: boolean };
  seatFare: number | null; fareSource: 'DEFAULT' | 'MIN' | 'MAX' | null;
  autos: ChargeLineAuto[];
}

export interface FareRoute { routeId: string; name: string; seatFareMin: number | null; seatFareMax: number | null; fullFareMin: number | null; fullFareMax: number | null; trips: number; avgSeatFare: number | null }
export interface FareOutlier { id: string; routeId: string; routeName?: string | null; seatFare: number | string; fullAutoFare: number | string | null; driverId: string; status: string; departureAt?: string | null }

export interface Settings {
  enabled: boolean; walletEnabled: boolean; devOverride: boolean;
  platformMaxCapacity: number; holdMinutes: number; privateRespondMinutes: number; maxSeatsPerBooking: number; maxAdvanceDays: number;
  reminderMinutes: number; noShowGraceMinutes: number; autoCompleteHours: number;
  customerRefundBeforeConfirmPct: number; customerRefundAfterConfirmPct: number;
  chargeMaxHours: number;
}
export type NumericSettingKey = Exclude<keyof Settings, 'enabled' | 'walletEnabled' | 'devOverride'>;
/** Same ranges as services/flag.js writeSettings (whole numbers). */
export const SETTING_RANGES: Record<NumericSettingKey, [number, number]> = {
  platformMaxCapacity: [1, LIMITS.ABSOLUTE_MAX_CAPACITY], holdMinutes: [1, 30], privateRespondMinutes: [2, 120],
  maxSeatsPerBooking: [1, LIMITS.ABSOLUTE_MAX_CAPACITY], maxAdvanceDays: [0, 30], reminderMinutes: [0, 120],
  noShowGraceMinutes: [5, 240], autoCompleteHours: [1, 48], customerRefundBeforeConfirmPct: [0, 100], customerRefundAfterConfirmPct: [0, 100],
  chargeMaxHours: [1, 24],
};

export interface AuditEntry { id: string | number; adminId: string; actor?: { id: string; name: string | null }; targetId: string; action: string; details: unknown; at: string | null }

const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};
const get = <T>(path: string) => adminRequest<T>(`${BASE}${path}`);
const send = <T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown) =>
  adminRequest<T>(`${BASE}${path}`, { method, body: JSON.stringify(body === undefined ? {} : body) });
const id = (v: string) => encodeURIComponent(v);

export const autoRideApi = {
  summary: () => get<Summary>('/summary'),

  drivers: (status = 'PENDING_REVIEW', q?: string, page: PageOpts = {}) => get<{ drivers: Driver[]; pagination?: Pagination }>(`/drivers${qs({ status, q, ...page })}`),
  driver: (driverId: string) => get<{ driver: Driver; vehicles: Vehicle[]; trips: (TripStatusBlock & { id: string; routeId: string })[]; missing: string[] }>(`/drivers/${id(driverId)}`),
  /** Plan B sign-up: create a driver account with a temporary password (the driver signs in with phone + password). */
  createDriver: (body: { name: string; phone: string; password: string }) => send<{ driver: Driver; message: string }>('POST', '/drivers', body),
  verifyDriver: (driverId: string) => send<{ driver: Driver }>('POST', `/drivers/${id(driverId)}/verify`),
  rejectDriver: (driverId: string, reason: string) => send<{ driver: Driver }>('POST', `/drivers/${id(driverId)}/reject`, { reason }),
  suspendDriver: (driverId: string, reason: string) => send<{ driver: Driver; tripsEnded: number }>('POST', `/drivers/${id(driverId)}/suspend`, { reason }),
  unsuspendDriver: (driverId: string) => send<{ driver: Driver }>('POST', `/drivers/${id(driverId)}/unsuspend`),

  vehicles: (status = 'PENDING_REVIEW', opts: { q?: string; driverId?: string } & PageOpts = {}) => get<{ vehicles: Vehicle[]; platformMaxCapacity: number; pagination?: Pagination }>(`/vehicles${qs({ status, ...opts })}`),
  vehicle: (vehicleId: string) => get<{ vehicle: Vehicle; driver: { id: string; name: string; phone: string; status: string; isOnline: boolean } | null; trips: (TripStatusBlock & { id: string; routeId: string })[]; platformMaxCapacity: number }>(`/vehicles/${id(vehicleId)}`),
  approveVehicle: (vehicleId: string, body: { approvedCapacity?: number; seatLayout?: SeatLayout }) => send<{ vehicle: Vehicle }>('POST', `/vehicles/${id(vehicleId)}/approve`, body),
  rejectVehicle: (vehicleId: string, reason: string) => send<{ vehicle: Vehicle }>('POST', `/vehicles/${id(vehicleId)}/reject`, { reason }),
  suspendVehicle: (vehicleId: string, reason: string) => send<{ vehicle: Vehicle }>('POST', `/vehicles/${id(vehicleId)}/suspend`, { reason }),

  routes: (page: PageOpts = {}) => get<{ routes: Route[]; pagination?: Pagination }>(`/routes${qs({ ...page })}`),
  createRoute: (body: RouteInput) => send<{ route: Route }>('POST', '/routes', body),
  updateRoute: (routeId: string, body: Partial<RouteInput>) => send<{ route: Route }>('PATCH', `/routes/${id(routeId)}`, body),
  createPickup: (routeId: string, body: PickupInput) => send<{ pickupPoint: PickupPoint }>('POST', `/routes/${id(routeId)}/pickup-points`, body),
  updatePickup: (pickupId: string, body: Partial<PickupInput>) => send<{ pickupPoint: PickupPoint }>('PATCH', `/pickup-points/${id(pickupId)}`, body),

  /** status: one trip status, 'ACTIVE', or '' for all. Server filters: status / date / driverId / routeId / pickupPointId / vehicleId. */
  trips: (opts: { status?: string; date?: string; driverId?: string; routeId?: string; pickupPointId?: string; vehicleId?: string } & PageOpts = {}) => get<{ trips: Trip[]; pagination?: Pagination }>(`/trips${qs({ ...opts })}`),
  trip: (tripId: string) => get<{ trip: Trip; bookings: Booking[]; privateRequests: PrivateRequest[]; events: TripEvent[] }>(`/trips/${id(tripId)}`),
  cancelTrip: (tripId: string, reason: string) => send<{ trip: Trip; bookingsCancelled: number }>('POST', `/trips/${id(tripId)}/cancel`, { reason }),
  /** Union queue: every stand with the auto on charge, the autos waiting behind it, app seats and walk-ins. */
  lines: () => get<{ lines: ChargeLine[]; serverTime: string }>('/lines'),
  queues: (opts: { date?: string; pickupPointId?: string; routeId?: string } & PageOpts = {}) => get<{ date: string; queue: QueueItem[]; pagination?: Pagination }>(`/queues${qs({ ...opts })}`),

  /** phone: the full 10-digit number, or its last 4 digits together with code (400 otherwise). */
  bookings: (opts: { code?: string; status?: string; tripId?: string; userId?: string; driverId?: string; phone?: string } & PageOpts = {}) => get<{ bookings: Booking[]; pagination?: Pagination }>(`/bookings${qs({ ...opts })}`),
  cancelBooking: (bookingId: string, reason: string) => send<{ booking: Booking }>('POST', `/bookings/${id(bookingId)}/cancel`, { reason }),
  retryRefund: (bookingId: string) => send<{ booking: Booking; refunded: number }>('POST', `/bookings/${id(bookingId)}/refund`),

  privateRequests: (status?: string, opts: { tripId?: string; driverId?: string; userId?: string } & PageOpts = {}) => get<{ requests: PrivateRequest[]; pagination?: Pagination }>(`/private-requests${qs({ status, ...opts })}`),

  /** status: one incident status, 'ACTIVE' (open + reviewing) or 'ALL'. Default on the server: OPEN. */
  incidents: (status = 'ACTIVE', opts: { priority?: 'NORMAL' | 'HIGH' } & PageOpts = {}) => get<{ incidents: Incident[]; pagination?: Pagination }>(`/incidents${qs({ status, ...opts })}`),
  updateIncident: (incidentId: string, status: string, note?: string) => send<{ incident: Incident }>('POST', `/incidents/${id(incidentId)}/status`, { status, ...(note ? { note } : {}) }),

  fares: () => get<{ routes: FareRoute[]; outliers: FareOutlier[] }>('/fares'),

  settings: () => get<Settings>('/settings'),
  putSettings: (patch: Partial<Omit<Settings, 'devOverride'>>) => send<Settings>('PUT', '/settings', patch),

  audit: (targetId?: string, page: PageOpts = {}) => get<{ entries: AuditEntry[]; pagination?: Pagination }>(`/audit${qs({ targetId, ...page })}`),
};

// ── Seat layout helpers (same rules as backend/modules/autoRide/services/layout.js) ──────────────

/** Default arrangement: driver row (+1 seat beside the driver when capacity >= 4), benches of <= 4. */
export function defaultLayout(capacity: number): SeatLayout {
  const cap = Math.max(1, Math.min(LIMITS.ABSOLUTE_MAX_CAPACITY, Number(capacity) || 1));
  const front = cap >= 4 ? 1 : 0;
  const rows: LayoutCell[][] = [front ? ['D', 1] : ['D']];
  const rem = cap - front;
  const benches = Math.max(1, Math.ceil(rem / 4));
  let next = front + 1;
  for (let b = 0; b < benches; b++) {
    const left = cap - next + 1;
    const size = Math.floor(left / (benches - b)) || left;
    const row: LayoutCell[] = [];
    for (let i = 0; i < size && next <= cap; i++) row.push(next++);
    if (row.length) rows.push(row);
  }
  return { rows };
}

/** Renumbers passenger seats 1..n in reading order (front to back, left to right); 'D' and gaps stay. */
export function renumberLayout(layout: SeatLayout): SeatLayout {
  let n = 0;
  return { rows: layout.rows.map((r) => r.map((c) => (c === 'D' || c === null ? c : ++n))) };
}

/** Client-side mirror of validateLayout; returns a problem or null. */
export function layoutProblem(layout: SeatLayout, capacity: number): string | null {
  const rows = layout.rows;
  if (!rows.length || rows.length > LIMITS.MAX_LAYOUT_ROWS) return `A layout has 1 to ${LIMITS.MAX_LAYOUT_ROWS} rows.`;
  if (rows.some((r) => !r.length || r.length > LIMITS.MAX_LAYOUT_COLS)) return `Each row has 1 to ${LIMITS.MAX_LAYOUT_COLS} places.`;
  const cells = rows.flat();
  if (cells.filter((c) => c === 'D').length !== 1) return 'The layout needs exactly one driver seat.';
  const seats = cells.filter((c): c is number => typeof c === 'number');
  if (seats.length !== capacity || new Set(seats).size !== capacity || seats.some((s) => s < 1 || s > capacity)) {
    return `The layout must show exactly ${capacity} passenger seat${capacity === 1 ? '' : 's'} (it shows ${seats.length}).`;
  }
  return null;
}
