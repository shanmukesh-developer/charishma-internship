// Every backend call the Zenvy Auto Driver app makes. Paths, bodies and replies are the LIVE driver router
// (backend/modules/autoRide/routes.js driverRouter, controllers/driverAuth.js / driverProfile.js /
// driverTrips.js) plus POST /api/users/send-otp for the sign-up OTP fallback (Firebase phone auth is primary). Fares, seats, queue numbers,
// earnings and statuses always come from the server; the app only says what the driver wants.
// No React Native imports: scratchpad verify script runs this file under Node against the real routers.
import { DRIVER_API } from '../config';
import { apiFetch, apiUploadXhr } from '../lib/http';
import type {
  BookingDriver, DriverAction, DriverNotification, DriverSelf, DriverSettings, Earnings, HomeResponse, Incident, IncidentCategory,
  MeResponse, MediaUpload, PrivateRequest, ProfileInput, QueueResponse, RouteFull, SeatMapResponse, Trip, TripInput, TripStatusBlock,
  Vehicle, VehicleInput, ChargeSetup, LineEntry,
} from '../types';

const D = DRIVER_API;
const enc = encodeURIComponent;

export interface AuthResult { token: string; driver: DriverSelf }

/** Indian mobile -> 10 digits ("+91 98765-43210" -> "9876543210"); null when it is not one. */
export function normalizePhone(input: string): string | null {
  const d = String(input || '').replace(/\D/g, '');
  const ten = d.length === 10 ? d : d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : null;
  return ten && /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** Same rule as controllers/driverAuth.js checkPassword. null = ok, else the message. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use 8 to 72 characters with letters and numbers.';
  return null;
}

export const driverApi = {
  // ── Sign-up / sign-in ───────────────────────────────────────────────────
  /** POST /api/users/send-otp { phone, purpose: 'auth' } -> { message, expiresIn, resendAfter } (429 OTP_COOLDOWN { retryAfter }). */
  sendOtp: (phone: string) =>
    apiFetch<{ success: boolean; message: string; expiresIn: number; resendAfter: number }>('/api/users/send-otp', { method: 'POST', body: { phone, purpose: 'auth' }, auth: false, timeoutMs: 45000 }),
  /**
   * POST /auth/register { name, phone, password, firebaseToken | otp } -> 201 { token, driver }.
   * firebaseToken = Firebase phone-auth ID token (primary, free; src/lib/phoneVerify.ts); otp = Fast2SMS code (fallback).
   * 409 PHONE_TAKEN, 401 PHONE_MISMATCH / VERIFICATION_EXPIRED, 400 OTP_INVALID { attemptsLeft } / WEAK_PASSWORD, 429 OTP_LOCKED { attemptsLeft: 0 }.
   */
  register: (input: { name: string; phone: string; password: string; otp?: string; firebaseToken?: string; acceptTerms?: boolean; termsVersion?: string }) =>
    apiFetch<AuthResult>(`${D}/auth/register`, { method: 'POST', body: input, auth: false, timeoutMs: 45000 }),
  /** POST /auth/login { phone, password } (401 INVALID_CREDENTIALS, 403 DRIVER_SUSPENDED, 429 lockout). */
  login: (phone: string, password: string) =>
    apiFetch<AuthResult>(`${D}/auth/login`, { method: 'POST', body: { phone, password }, auth: false, timeoutMs: 45000 }),
  refresh: () => apiFetch<AuthResult>(`${D}/auth/refresh`, { method: 'POST' }),
  /** Bumps tokenVersion server-side: other devices sign out; the reply carries this phone's new token. */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ token: string; message: string }>(`${D}/auth/password`, { method: 'POST', body: { currentPassword, newPassword } }),
  saveFcmToken: (token: string) => apiFetch<{ ok: boolean }>(`${D}/fcm-token`, { method: 'POST', body: { token } }),
  removeFcmToken: (token: string) => apiFetch<{ ok: boolean }>(`${D}/fcm-token/remove`, { method: 'POST', body: { token }, timeoutMs: 6000 }),

  // ── C9: delete account (Play requirement) ─────────────────────────────
  /** GET /account/deletion-check -> { canDelete, blockers: [{ code, message }], phoneMasked }. */
  deletionCheck: () => apiFetch<{ canDelete: boolean; blockers: { code: string; message: string }[]; phoneMasked: string }>(`${D}/account/deletion-check`),
  /** POST /account/delete-otp: SMS code to this account's own number (429 OTP_COOLDOWN { retryAfter }, 409 blocker). */
  sendDeleteOtp: () => apiFetch<{ success: boolean; message: string; resendAfter?: number }>(`${D}/account/delete-otp`, { method: 'POST', timeoutMs: 45000 }),
  /** POST /account/delete { confirm: 'DELETE', password | otp | firebaseToken } (401 WRONG_PASSWORD / PHONE_MISMATCH, 400 OTP_INVALID, 409 blocker). */
  deleteAccount: (input: { password?: string; otp?: string; firebaseToken?: string; reason?: string }) =>
    apiFetch<{ success: boolean; message: string }>(`${D}/account/delete`, { method: 'POST', body: { confirm: 'DELETE', ...input }, timeoutMs: 45000 }),

  // ── Account, documents, review ─────────────────────────────────────────
  me: () => apiFetch<MeResponse>(`${D}/me`),
  updateProfile: (input: ProfileInput) => apiFetch<{ driver: DriverSelf }>(`${D}/me/profile`, { method: 'PATCH', body: input }),
  /** PUT /me/documents { documents: { photo, licenceFront, ... } } values = media paths from uploadMedia (null removes). */
  putDocuments: (documents: Record<string, string | null>) =>
    apiFetch<{ driver: DriverSelf }>(`${D}/me/documents`, { method: 'PUT', body: { documents } }),
  /** -> PENDING_REVIEW (409 INCOMPLETE { missing }). */
  submit: () => apiFetch<{ driver: DriverSelf; message: string }>(`${D}/me/submit`, { method: 'POST' }),
  /** Private upload (multipart field 'image', or JSON { image: base64 }). 201 { id, url, previewUrl (1-hour signed) }. */
  uploadMedia: (form: FormData) => apiUploadXhr<MediaUpload>(`${D}/media`, form, 90000),
  uploadMediaBase64: (image: string) => apiFetch<MediaUpload>(`${D}/media`, { method: 'POST', body: { image }, timeoutMs: 90000 }),

  // ── Duty ───────────────────────────────────────────────────────────────
  /** POST /online { online } (403 DRIVER_NOT_VERIFIED). Idempotent: safe to replay offline -> false. */
  setOnline: (online: boolean) => apiFetch<{ isOnline: boolean }>(`${D}/online`, { method: 'POST', body: { online } }),
  home: () => apiFetch<HomeResponse>(`${D}/home`),
  /** platformMaxCapacity, maxAdvanceDays, holdMinutes, ... (read-only; the server enforces them). */
  settings: () => apiFetch<{ settings: DriverSettings }>(`${D}/settings`),
  /** The queue at a pickup point for an IST day (default today). Same trips as the customer queue; mine = your trip. */
  pickupQueue: (pickupPointId: string, date?: string) =>
    apiFetch<QueueResponse>(`${D}/pickup-points/${enc(pickupPointId)}/queue${date ? `?date=${enc(date)}` : ''}`),
  /** IST days inclusive, YYYY-MM-DD (defaults: today). */
  earnings: (from?: string, to?: string) => {
    const q = [from ? `from=${enc(from)}` : '', to ? `to=${enc(to)}` : ''].filter(Boolean).join('&');
    return apiFetch<Earnings & { from: string; to: string }>(`${D}/earnings${q ? `?${q}` : ''}`);
  },

  // ── Vehicles + routes ──────────────────────────────────────────────────
  vehicles: () => apiFetch<{ vehicles: Vehicle[] }>(`${D}/vehicles`),
  /** 201 { vehicle } PENDING_REVIEW (409 REGISTRATION_TAKEN / TOO_MANY_VEHICLES, 400 INVALID_INPUT { field }). */
  createVehicle: (input: VehicleInput) => apiFetch<{ vehicle: Vehicle }>(`${D}/vehicles`, { method: 'POST', body: input }),
  /** Any change sends it back to review (approved capacity cleared). 409 ACTIVE_TRIP_EXISTS / VEHICLE_SUSPENDED. */
  updateVehicle: (id: string, input: VehicleInput) => apiFetch<{ vehicle: Vehicle }>(`${D}/vehicles/${enc(id)}`, { method: 'PATCH', body: input }),
  routes: () => apiFetch<{ routes: RouteFull[] }>(`${D}/routes`),

  // ── Union queue (put on charge at a stand) ─────────────────────────────
  /** GET /charge/setup -> stands (one per destination, fare, line length), approved autos, current trip. */
  chargeSetup: () => apiFetch<ChargeSetup>(`${D}/charge/setup`),
  /**
   * POST /charge { pickupPointId, vehicleId, seatFare? } -> 201 { trip, line }. The trip is on charge (front) or waiting;
   * both take bookings. seatFare: inside the route range (default = the route's set fare).
   * 403 FEATURE_OFF / DRIVER_NOT_VERIFIED / VEHICLE_NOT_APPROVED, 400 FARE_OUT_OF_RANGE { min, max }, 409 DRIVER_OFFLINE /
   * ACTIVE_TRIP_EXISTS / FARE_NOT_SET / VEHICLE_PAPERS_EXPIRED / LICENCE_EXPIRED.
   */
  putOnCharge: (pickupPointId: string, vehicleId: string, seatFare?: number) =>
    apiFetch<{ trip: Trip; line: LineEntry[] }>(`${D}/charge`, { method: 'POST', body: { pickupPointId, vehicleId, ...(seatFare ? { seatFare } : {}) } }),
  /** POST /trips/:id/fare { seatFare } -> { trip }. 409 FARE_LOCKED once a student booked, 400 FARE_OUT_OF_RANGE { min, max }. */
  changeFare: (id: string, seatFare: number) =>
    apiFetch<{ trip: Trip }>(`${D}/trips/${enc(id)}/fare`, { method: 'POST', body: { seatFare } }),
  /** GET /trips/:id/line -> { trip, line } (409 NOT_ON_CHARGE_TRIP for a scheduled trip). */
  tripLine: (id: string) => apiFetch<{ trip: Trip; line: LineEntry[] }>(`${D}/trips/${enc(id)}/line`),
  /**
   * POST /trips/:id/walk-ins { action, seatNo? } -> { trip, seatNo, action, layout, seats }. add takes the lowest free seat,
   * remove frees the highest walk-in seat. 409 SEAT_BOOKED_IN_APP / SEAT_BEING_BOOKED / APP_BOOKING_SEAT / NO_FREE_SEAT /
   * NO_WALK_IN / WALK_IN_CLOSED.
   */
  walkIn: (id: string, action: 'add' | 'remove', seatNo?: number) =>
    apiFetch<{ trip: Trip; seatNo: number; action: 'add' | 'remove' } & Pick<SeatMapResponse, 'layout' | 'seats' | 'legend'>>(`${D}/trips/${enc(id)}/walk-ins`, { method: 'POST', body: { action, ...(seatNo ? { seatNo } : {}) } }),

  // ── Trips ──────────────────────────────────────────────────────────────
  trips: (scope?: 'active' | 'past' | 'draft') => apiFetch<{ trips: Trip[] }>(`${D}/trips${scope ? `?scope=${scope}` : ''}`),
  createDraft: (input: TripInput) => apiFetch<{ trip: Trip }>(`${D}/trips`, { method: 'POST', body: input }),
  trip: (id: string) => apiFetch<{ trip: Trip }>(`${D}/trips/${enc(id)}`),
  /** Drafts only (409 TRIP_LOCKED). */
  updateDraft: (id: string, input: Partial<TripInput>) => apiFetch<{ trip: Trip }>(`${D}/trips/${enc(id)}`, { method: 'PATCH', body: input }),
  deleteDraft: (id: string) => apiFetch<{ trip: Trip }>(`${D}/trips/${enc(id)}`, { method: 'DELETE' }),
  /** DRAFT -> PUBLISHED (+ queue number) -> OPEN_FOR_BOOKING. 403 FEATURE_OFF / DRIVER_NOT_VERIFIED / VEHICLE_NOT_APPROVED,
   *  409 DRIVER_OFFLINE / ACTIVE_TRIP_EXISTS / VEHICLE_PAPERS_EXPIRED / LICENCE_EXPIRED, 400 FARE_OUT_OF_RANGE /
   *  CAPACITY_NOT_ALLOWED / DEPARTURE_TOO_SOON / DEPARTURE_TOO_FAR / OUTSIDE_OPERATING_HOURS. */
  publish: (id: string) => apiFetch<{ trip: Trip }>(`${D}/trips/${enc(id)}/publish`, { method: 'POST' }),
  /**
   * POST /trips/:id/actions/:action. Bodies: confirm-departure { ready: true },
   * start { safetyConfirmed: true, noShowConfirmed: [bookingId...] } (409 PASSENGERS_NOT_CHECKED_IN { passengers }
   * while a booked passenger not named in noShowConfirmed is not checked in),
   * delay { minutes 5..120, reason? }, cancel { reason >= 3 chars }, unavailable { kind: DRIVER|VEHICLE, reason },
   * depart {} (union queue: leave the stand now; 409 AUTO_EMPTY / WAITING_IN_LINE).
   * 409 INVALID_TRANSITION { from, to } for anything the state machine does not allow.
   */
  action: (id: string, action: DriverAction, body: Record<string, unknown> = {}) =>
    apiFetch<{ trip: Trip; bookingsCancelled?: number; bookingsMoved?: number }>(`${D}/trips/${enc(id)}/actions/${action}`, { method: 'POST', body }),
  bookings: (id: string) => apiFetch<{ trip: TripStatusBlock & { id: string }; bookings: BookingDriver[] }>(`${D}/trips/${enc(id)}/bookings`),
  seats: (id: string) => apiFetch<SeatMapResponse>(`${D}/trips/${enc(id)}/seats`),
  /**
   * 400 WRONG_PIN { attemptsLeft }, 429 PIN_LOCKED { attemptsLeft: 0, lockedUntil } (15 min), 404 NOT_FOUND, 409 NOT_BOARDING /
   * NOT_CONFIRMED. Also works on the way (IN_PROGRESS) and for a passenger marked not here less than 30 minutes ago
   * (late: true; seatsChanged when their seat had been given away), else 409 LATE_CHECK_IN_CLOSED / SEAT_NOW_TAKEN.
   */
  checkIn: (id: string, bookingCode: string, pin: string, cashCollected: boolean) =>
    apiFetch<{ booking: BookingDriver; trip: TripStatusBlock & { id: string }; duplicate: boolean; late?: boolean; seatsChanged?: boolean }>(`${D}/trips/${enc(id)}/check-in`, { method: 'POST', body: { bookingCode, pin, cashCollected } }),
  /** 409 TOO_EARLY before departure, INVALID_STATE before confirm-departure. */
  noShow: (tripId: string, bookingId: string) =>
    apiFetch<{ booking: BookingDriver; trip: TripStatusBlock & { id: string } }>(`${D}/trips/${enc(tripId)}/bookings/${enc(bookingId)}/no-show`, { method: 'POST' }),

  // ── Full-auto (private) requests ───────────────────────────────────────
  privateRequests: (status?: 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'CONFLICT' | 'EXPIRED' | 'CANCELLED') =>
    apiFetch<{ requests: PrivateRequest[] }>(`${D}/private-requests${status ? `?status=${status}` : ''}`),
  /** 409 SEATS_ALREADY_BOOKED / PAYMENT_FAILED / REQUEST_CLOSED, 410 REQUEST_EXPIRED, 403 FEATURE_OFF. */
  acceptPrivate: (id: string) =>
    apiFetch<{ request: PrivateRequest; booking: BookingDriver | null; trip: TripStatusBlock & { id: string } }>(`${D}/private-requests/${enc(id)}/accept`, { method: 'POST' }),
  declinePrivate: (id: string, reason?: string) =>
    apiFetch<{ request: PrivateRequest }>(`${D}/private-requests/${enc(id)}/decline`, { method: 'POST', body: reason ? { reason } : {} }),

  // ── Inbox + incidents ──────────────────────────────────────────────────
  notifications: () => apiFetch<{ notifications: DriverNotification[]; unread: number }>(`${D}/notifications`),
  /** Idempotent (safe to replay). No ids = mark all read. */
  markRead: (ids?: string[]) => apiFetch<{ updated: number }>(`${D}/notifications/read`, { method: 'POST', body: ids ? { ids } : {} }),
  reportIncident: (input: { category: IncidentCategory; description: string; tripId?: string; bookingId?: string }) =>
    apiFetch<{ incident: Incident; message: string }>(`${D}/incidents`, { method: 'POST', body: input }),
  /** SOS: HIGH-priority SAFETY incident (current trip when tripId is omitted) + push to every Zenvy admin. */
  sos: (input: { tripId?: string; note?: string; lat?: number; lon?: number } = {}) =>
    apiFetch<{ incident: Incident; message: string; emergencyNumber: string }>(`${D}/sos`, { method: 'POST', body: input }),
};

export type DriverApi = typeof driverApi;
