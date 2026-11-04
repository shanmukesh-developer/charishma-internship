// Client mirror of the server rules (backend/modules/autoRide/enums.js TRANSITIONS for the 'driver' actor,
// services/tripActions.js ACTIONS + publishChecks, controllers/driverTrips.js draftInput). Used only to
// decide which buttons to show and to catch form mistakes early; the server checks everything again and
// its answer always wins. The verification script compares ACTION_TARGET against enums.canTransition.
// No React Native imports (runs under Node in the verification script).
import { LIMITS } from '../config';
import type { DriverAction, OperatingPeriod, RouteFull, Trip, TripStatus, Vehicle } from '../types';

export const TERMINAL: TripStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'];
export const ACTIVE: TripStatus[] = ['PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL', 'DRIVER_CONFIRMED', 'BOARDING', 'IN_PROGRESS', 'DELAYED'];

/** The status each driver action moves a trip to (null = no status change, e.g. 'arrive'). */
// 'depart' (union queue) is two steps on the server: DRIVER_CONFIRMED then BOARDING.
export const ACTION_TARGET: Record<Exclude<DriverAction, 'unavailable' | 'resume' | 'depart'>, TripStatus | null> = {
  'confirm-departure': 'DRIVER_CONFIRMED',
  'start-boarding': 'BOARDING',
  start: 'IN_PROGRESS',
  arrive: null,
  complete: 'COMPLETED',
  delay: 'DELAYED',
  cancel: 'CANCELLED',
};

/** Driver-actor rows of enums.js TRANSITIONS (from -> allowed targets). */
const DRIVER_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['OPEN_FOR_BOOKING', 'DELAYED', 'CANCELLED', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'],
  OPEN_FOR_BOOKING: ['DELAYED', 'CANCELLED', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'],
  DEPARTURE_THRESHOLD_REACHED: ['DRIVER_CONFIRMED', 'DELAYED', 'CANCELLED', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'],
  FULL: ['DRIVER_CONFIRMED', 'DELAYED', 'CANCELLED', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'],
  DRIVER_CONFIRMED: ['BOARDING', 'DELAYED', 'CANCELLED', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'],
  BOARDING: ['IN_PROGRESS', 'DELAYED', 'CANCELLED', 'VEHICLE_UNAVAILABLE'],
  DELAYED: ['PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL', 'DRIVER_CONFIRMED', 'BOARDING', 'CANCELLED', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [], DRIVER_UNAVAILABLE: [], VEHICLE_UNAVAILABLE: [],
};
export const driverCan = (from: TripStatus, to: TripStatus) => (DRIVER_TRANSITIONS[from] || []).includes(to);

export interface ActionSet {
  /** The one big next-step button (null = nothing to do but wait). */
  primary: 'confirm-departure' | 'start-boarding' | 'check-in' | 'start' | 'arrive' | 'complete' | 'resume' | null;
  delay: boolean;
  cancel: boolean;
  driverUnavailable: boolean;
  vehicleUnavailable: boolean;
  noShow: boolean;
}

/** Which buttons a trip shows right now (the state machine table + the action preconditions). */
export function actionsFor(t: Pick<Trip, 'status' | 'arrivedAt' | 'boardedSeats' | 'departureAt'>, nowMs: number): ActionSet {
  const s = t.status;
  let primary: ActionSet['primary'] = null;
  if (s === 'DEPARTURE_THRESHOLD_REACHED' || s === 'FULL') primary = 'confirm-departure';
  else if (s === 'DRIVER_CONFIRMED') primary = 'start-boarding';
  else if (s === 'BOARDING') primary = (Number(t.boardedSeats) || 0) > 0 ? 'start' : 'check-in';
  else if (s === 'IN_PROGRESS') primary = t.arrivedAt ? 'complete' : 'arrive';
  else if (s === 'DELAYED') primary = 'resume';
  const departed = !!t.departureAt && new Date(t.departureAt).getTime() <= nowMs;
  return {
    primary,
    delay: driverCan(s, 'DELAYED'),
    cancel: s !== 'DRAFT' && driverCan(s, 'CANCELLED'),
    driverUnavailable: driverCan(s, 'DRIVER_UNAVAILABLE'),
    vehicleUnavailable: driverCan(s, 'VEHICLE_UNAVAILABLE'),
    noShow: (s === 'DRIVER_CONFIRMED' || s === 'BOARDING') && departed,
  };
}

// ── IST helpers (the server keys days and operating periods on IST) ─────────
const IST_MS = 330 * 60 * 1000;
export const istYmd = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const istHhmm = (ms: number) => new Date(ms + IST_MS).toISOString().slice(11, 16);
/** "2026-10-20" + "09:30" (IST) -> epoch ms. NaN when malformed. */
export function istToMs(ymd: string, hhmm: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return NaN;
  return Date.parse(`${ymd}T${hhmm}:00+05:30`);
}
/** Next `days` IST dates starting today. */
export function nextIstDays(nowMs: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => istYmd(nowMs + i * 24 * 60 * 60 * 1000));
}

/** Same matching as services/queue.js periodFor. null = no periods configured (all day). */
export function periodAt(periods: OperatingPeriod[], ms: number): OperatingPeriod | null | undefined {
  const valid = (periods || []).filter((p) => p && p.key && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.end));
  if (!valid.length) return null;
  const t = istHhmm(ms);
  return valid.find((x) => (x.start <= x.end ? t >= x.start && t < x.end : t >= x.start || t < x.end));
}

export interface PublishForm {
  vehicle: Vehicle | null;
  route: RouteFull | null;
  pickupPointId: string | null;
  departureMs: number;
  capacity: number;
  seatFare: number;
  privateBookingEnabled: boolean;
  fullAutoFare: number | null;
  minSeatsToDepart: number;
  stops: string[];
}

export type FormErrors = Partial<Record<'vehicle' | 'route' | 'pickup' | 'departure' | 'capacity' | 'seatFare' | 'fullAutoFare' | 'minSeatsToDepart' | 'stops', string>>;

/** Client-side copy of draftInput + publishChecks. Empty object = looks fine (the server decides). */
export function validatePublish(f: PublishForm, nowMs: number): FormErrors {
  const e: FormErrors = {};
  const v = f.vehicle;
  if (!v) e.vehicle = 'Pick your auto.';
  else if (v.status !== 'APPROVED' || !v.approvedCapacity) e.vehicle = 'This auto is not approved by ZenWe yet.';
  const r = f.route;
  if (!r) e.route = 'Pick a route.';
  else if (!f.pickupPointId || !r.pickupPoints.some((p) => p.id === f.pickupPointId && p.isActive !== false)) e.pickup = 'Pick a pickup point on this route.';
  if (!Number.isFinite(f.departureMs)) e.departure = 'Pick the date and time.';
  else if (f.departureMs < nowMs + LIMITS.MIN_LEAD_MINUTES * 60 * 1000) e.departure = 'Pick a time a few minutes from now.';
  else if (f.departureMs > nowMs + (LIMITS.MAX_ADVANCE_DAYS + 1) * 24 * 60 * 60 * 1000) e.departure = `Trips can be published up to ${LIMITS.MAX_ADVANCE_DAYS} days ahead.`;
  else if (r && periodAt(r.operatingPeriods, f.departureMs) === undefined) {
    e.departure = `This route runs ${r.operatingPeriods.map((p) => `${p.start}-${p.end}`).join(', ')} only.`;
  }
  const maxCap = v && v.approvedCapacity ? v.approvedCapacity : 0;
  if (!Number.isInteger(f.capacity) || f.capacity < 1 || (maxCap && f.capacity > maxCap)) e.capacity = `Seats must be 1 to ${maxCap || '?'} (approved for this auto).`;
  if (!Number.isFinite(f.seatFare) || f.seatFare < 1 || f.seatFare > LIMITS.MAX_FARE) e.seatFare = `Enter the fare per seat (₹1 to ₹${LIMITS.MAX_FARE}).`;
  else if (r && r.seatFareMin != null && f.seatFare < r.seatFareMin) e.seatFare = `Seat fare must be at least ₹${r.seatFareMin} on this route.`;
  else if (r && r.seatFareMax != null && f.seatFare > r.seatFareMax) e.seatFare = `Seat fare can be at most ₹${r.seatFareMax} on this route.`;
  if (f.privateBookingEnabled) {
    const ff = Number(f.fullAutoFare);
    if (!Number.isFinite(ff) || ff < 1 || ff > LIMITS.MAX_FULL_FARE) e.fullAutoFare = `Enter the full-auto fare (₹1 to ₹${LIMITS.MAX_FULL_FARE}).`;
    else if (r && r.fullFareMin != null && ff < r.fullFareMin) e.fullAutoFare = `Full-auto fare must be at least ₹${r.fullFareMin}.`;
    else if (r && r.fullFareMax != null && ff > r.fullFareMax) e.fullAutoFare = `Full-auto fare can be at most ₹${r.fullFareMax}.`;
  }
  if (!Number.isInteger(f.minSeatsToDepart) || f.minSeatsToDepart < 1 || f.minSeatsToDepart > Math.max(1, f.capacity)) e.minSeatsToDepart = `Minimum seats must be 1 to ${f.capacity}.`;
  const permitted = r ? r.permittedStops : [];
  const bad = f.stops.filter((s) => !permitted.includes(s));
  if (bad.length) e.stops = 'Stops must be from the route list.';
  return e;
}

/** Friendly words for server error codes the trip screens can get. */
export const CODE_HINT: Record<string, string> = {
  FEATURE_OFF: 'Auto-Ride is switched off by ZenWe right now. Your account and drafts are safe.',
  DRIVER_OFFLINE: 'Go online first, then publish.',
  INVALID_TRANSITION: 'The trip changed meanwhile. The latest status is shown now.',
};
