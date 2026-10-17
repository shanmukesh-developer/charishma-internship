// Zenvy Campus Events admin + check-in API.
//   /api/admin/campus-events      backend/modules/campusEvents/routes.js adminRouter (protect + admin), controllers/admin.js
//   /api/campus-events/check-in   checkInRouter (organizer / admin / granted staff), controllers/checkIn.js
// Shapes mirror services/serialize.js. Errors come back as { code, message, ...extra }; adminRequest turns the
// message into an Error. Check-in calls keep the 409 body (the verdict) instead of throwing it away.
import { adminRequest } from './api';
import { API_URL } from './config';

const BASE = '/api/admin/campus-events';
const CHECKIN = '/api/campus-events/check-in';

// ── Enums (backend/modules/campusEvents/enums.js) ──────────────────────────────────────────────────
export const EVENT_STATUSES = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'COMPLETED'] as const;
export const EDITABLE_EVENT_STATUSES = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'];
export const CATEGORIES = ['SPORTS', 'TOURNAMENT', 'CLUB', 'WORKSHOP', 'SEMINAR', 'TALK', 'COMPETITION', 'HACKATHON', 'CULTURAL', 'RECREATION', 'OTHER'] as const;
export const CATEGORY_LABELS: Record<string, string> = {
  SPORTS: 'Sports', TOURNAMENT: 'Tournament', CLUB: 'Club activity', WORKSHOP: 'Workshop', SEMINAR: 'Seminar', TALK: 'Talk',
  COMPETITION: 'Competition', HACKATHON: 'Hackathon', CULTURAL: 'Cultural', RECREATION: 'Recreational', OTHER: 'Other',
};
export const REG_STATUSES = ['HELD', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'CANCELLED', 'EXPIRED', 'REJECTED'] as const;
/** Live + waitlisted: the statuses an admin can still cancel (OPEN_REG_STATUSES). */
export const OPEN_REG_STATUSES = ['HELD', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLISTED', 'OFFERED'];
export const PAYMENT_MODES = ['NONE', 'VENUE', 'WALLET', 'ONLINE'] as const;
export const PAYMENT_STATUSES = ['NONE', 'DUE_AT_VENUE', 'PAID_AT_VENUE', 'PENDING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'] as const;
export const ORGANIZER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'] as const;
export const PAY_ROW_STATUSES = ['CREATED', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED'] as const;

/** Dashboard buckets (controllers/admin.js BUCKETS + fully_booked). The first nine are the owner's spec §10 list. */
export const BUCKETS: { key: BucketKey; label: string; hint: string }[] = [
  { key: 'pending_approval', label: 'Pending approval', hint: 'Submitted, waiting for review' },
  { key: 'approved_upcoming', label: 'Approved & upcoming', hint: 'Approved, goes live at its publish time' },
  { key: 'published', label: 'Published', hint: 'Visible to students' },
  { key: 'registration_open', label: 'Registration open', hint: 'Published, registration window open now' },
  { key: 'fully_booked', label: 'Fully booked', hint: 'Published, upcoming, no places / slots left' },
  { key: 'registration_closed', label: 'Registration closed', hint: 'Published, closed before the start' },
  { key: 'in_progress', label: 'In progress', hint: 'Running right now' },
  { key: 'completed', label: 'Completed', hint: 'Ended' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Cancelled by an organizer or admin' },
];
export const EXTRA_BUCKETS: { key: BucketKey; label: string }[] = [
  { key: 'changes_pending', label: 'Changes waiting' },
  { key: 'unpublished', label: 'Unpublished' },
  { key: 'drafts', label: 'Drafts / sent back' },
];
export type BucketKey = 'pending_approval' | 'approved_upcoming' | 'published' | 'registration_open' | 'registration_closed' | 'in_progress'
  | 'completed' | 'cancelled' | 'changes_pending' | 'unpublished' | 'drafts' | 'fully_booked';

export const CHECKIN_RESULTS = ['VALID', 'ALREADY_USED', 'CANCELLED', 'INVALID', 'NOT_YET_VALID', 'EXPIRED', 'WRONG_EVENT', 'UNPAID', 'PENDING', 'PAYMENT_DUE'] as const;
export type CheckInResult = typeof CHECKIN_RESULTS[number];

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────
export interface Pagination { page: number; limit: number; hasMore: boolean }
export interface PageOpts { page?: number; limit?: number }

export interface Switches { enabled: boolean; walletEnabled: boolean; onlinePayEnabled: boolean; razorpayKeysPresent: boolean; ticketsReady: boolean }
export interface Summary {
  buckets: Record<BucketKey, number> & { organizers_pending: number; refunds_pending: number; venue_due: number };
  switches: Switches;
}

export interface PriceBlock { priceType: 'FREE' | 'PAID'; isFree: boolean; amount: number; extras: number; total: number; extraCharges: { label: string; amount: number }[]; label: string }
export interface CapacityBlock { kind: 'SEATS' | 'TEAMS' | 'SLOTS'; capacity?: number; confirmed?: number; remaining?: number; waitlistCount?: number }
export interface Question { id: string; label: string; type: string; required: boolean; options?: string[]; maxLength?: number }
export interface Eligibility { years?: number[]; branches?: string[]; adultOnly?: boolean }
export interface CancellationPolicy { userCancelUntilHours?: number | null; refundPct?: number | null; text?: string }
export interface TeamRules { min: number | null; max: number | null; maxTeams: number | null; captainRequired: boolean; allowSubstitutions: boolean; multiTeamAllowed: boolean; attendancePerMember: boolean }
export interface PendingChanges { fields: Record<string, unknown>; requestedAt?: string; requestedBy?: string }

/** serialize.eventAdmin + organizerName (controllers/admin.js eventOut). */
export interface AdminEvent {
  id: string; title: string; category: string; categoryLabel: string; tags: string[]; posterUrl: string | null;
  organizer: { name: string; club: { id: string; name: string; type: string; verified: boolean } | null };
  startAt: string | null; endAt: string | null; venue: string | null; format: 'INDIVIDUAL' | 'SLOT' | 'TEAM'; isTeam: boolean;
  price: PriceBlock; regOpensAt: string | null; regClosesAt: string | null; capacity: CapacityBlock; slotsAvailable?: number | null;
  registrationState: string; featured: boolean; publishedAt: string | null;
  description: string | null; gallery: string[]; venueDirections: string | null; venueLat: number | null; venueLon: number | null;
  eligibility: Eligibility; rules: string; rulesVersion: number; questions: Question[]; equipment: string | null; contactText: string | null;
  instructions: string | null; cancellationPolicy: CancellationPolicy; team: TeamRules | null; maxBookingsPerStudent: number;
  approvalRequired: boolean; waitlistEnabled: boolean; entryOpensBeforeMin: number; status: string;
  /** null = platform default / no minimum (older servers: undefined). */
  minParticipants?: number | null; waitlistOfferMinutes?: number | null;
  publishAt: string | null; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null; rejectionReason: string | null;
  pendingChanges: PendingChanges | null; cancelReason: string | null;
  counters: { unitsLive: number; confirmed: number; waitlist: number; checkedIn: number };
  posterPath: string | null; galleryPaths: string[]; rawPrice: number; capacityRaw: number | null; paymentModesConfigured: string[];
  version: number; createdAt: string | null; updatedAt: string | null;
  campusId: string | null; organizerUserId: string; entityId: string | null; cancelledAt: string | null; completedAt: string | null;
  organizerName: string | null;
}
export interface Slot {
  id: string; label: string | null; startAt: string; endAt: string; durationMinutes: number; capacity: number; confirmed: number;
  remaining: number; waitlistCount: number; price: PriceBlock; state: string; status: string;
}
export interface EventStats {
  eventId: string; byStatus: Record<string, number>; total: number; confirmed: number; checkedIn: number; teams?: number;
  collected: { VENUE: number; WALLET: number; ONLINE: number }; dueAtVenue: number; refunded: number;
}
export interface StaffRow { id: string; role: string; name: string; createdAt: string | null }
export interface EventDetail { event: AdminEvent; slots: Slot[]; stats: EventStats; staff: StaffRow[] }

export interface TicketBrief { id: string; kind: string; status: string; ticketCode: string; usedAt: string | null; /** = ticketCode (admin registrations list). */ code?: string }
export interface AnswerDetail { id: string; label: string; type: string | null; value: unknown }
export interface PaymentBlock { mode: string; status: string; amount: number; extras: number; total: number; paidAt: string | null; refundAmount: number; refundedAt: string | null; payBy?: string | null }
/** serialize.registrationForOrganizer(forAdmin) (+ event/payment on the global list). */
export interface Registration {
  id: string; code: string; type: string; status: string; name: string; userId: string; team: { id: string; name: string } | null;
  slotId: string | null; unitNo: number | null; answers: Record<string, unknown>; answerDetails?: AnswerDetail[]; phoneMasked?: string | null; paymentMode: string; paymentStatus: string; total: number;
  ticket: TicketBrief | null; waitlistAt: string | null; createdAt: string | null; confirmedAt: string | null; cancelledAt: string | null;
  eventId?: string; eventTitle?: string | null; payment?: PaymentBlock; refundAttempts?: number;
}
export interface PaymentRow {
  id: string; registrationId: string; eventId: string; provider: string; amount: number; status: string; providerOrderId: string | null;
  providerPaymentId: string | null; providerRefundId: string | null; failureReason: string | null; createdAt: string | null;
}
export interface Organizer {
  id: string; status: string; displayName: string | null; entityId: string | null; campusId: string | null; reviewNote: string | null;
  grantedAt: string | null; createdAt: string | null; userId: string; name: string | null; applicationNote: string | null; proofText: string | null;
  entity: { id: string; name: string; verified: boolean } | null; reviewedAt: string | null;
}
export interface SettingsValues {
  holdMinutes: number; paymentMinutes: number; waitlistOfferMinutes: number; maxUnpaidVenueReservations: number; defaultUserCancelUntilHours: number;
  defaultRefundPct: number; inviteExpiryHours: number; joinLinkDays: number; announcementsPerDay: number; retentionDays: number;
  maxPrice: number; maxCapacity: number; entryOpensBeforeMin: number;
}
export type SettingKey = keyof SettingsValues;
export interface Settings extends Switches { settings: SettingsValues; categories: string[] }
/** Same whole-number ranges as services/flag.js RANGES (writeSettings refuses anything outside). */
export const SETTING_RANGES: Record<SettingKey, [number, number]> = {
  holdMinutes: [1, 30], paymentMinutes: [5, 60], waitlistOfferMinutes: [10, 1440], maxUnpaidVenueReservations: [1, 20],
  defaultUserCancelUntilHours: [0, 720], defaultRefundPct: [0, 100], inviteExpiryHours: [1, 336], joinLinkDays: [1, 30],
  announcementsPerDay: [1, 50], retentionDays: [30, 3650], maxPrice: [0, 100000], maxCapacity: [1, 100000], entryOpensBeforeMin: [0, 1440],
};
export interface ReportRow extends EventStats { id: string; title: string; status: string; startAt: string | null; category: string; format: string }
export interface Reports {
  from: string; to: string; events: ReportRow[];
  totals: { registrations: number; confirmed: number; checkedIn: number; collected: { VENUE: number; WALLET: number; ONLINE: number }; refunded: number; dueAtVenue: number };
}
export interface AuditRow { id: string; eventId: string | null; teamId: string | null; registrationId: string | null; actorUserId: string | null; actorName?: string | null; actorRole: string | null; action: string; details: unknown; at: string | null }
export const AUDIT_ROLES = ['admin', 'organizer', 'staff', 'user', 'system'] as const;
export const AUDIT_FAMILIES = ['event', 'registration', 'payment', 'ticket', 'team', 'slot', 'staff', 'organizer', 'settings', 'announcement'] as const;
export interface CategoryOption { key: string; label: string; icon: string; section: string | null }

/** Admin user search (GET /api/admin/users?search=). Only id + name + masked contact are ever shown. */
export interface UserHit {
  id: string; name: string | null; phone?: string | null; email?: string | null; role?: string | null;
  /** GET /api/admin/campus-events/users (narrow search): masked contact, campus, verified, organizer status. */
  phoneMasked?: string | null; emailMasked?: string | null; campus?: { id: string; name: string } | null; verified?: boolean; active?: boolean; organizerStatus?: string | null;
}
/** FriendsEntity (GET /api/campus/mod/entities). */
export interface Club { id: string; campusId: string | null; type: string; name: string; handle: string | null; verified: boolean; managerIds: string[]; status: string }

/** Event fields an admin may edit (services/validate.js cleanEventInput keys). */
export interface EventEdit {
  title?: string; category?: string; description?: string; venue?: string; venueDirections?: string; startAt?: string; endAt?: string;
  regOpensAt?: string | null; regClosesAt?: string | null; capacity?: number; maxTeams?: number; teamMin?: number; teamMax?: number;
  maxBookingsPerStudent?: number; priceType?: 'FREE' | 'PAID'; price?: number; rules?: string; instructions?: string; equipment?: string;
  contactText?: string; entryOpensBeforeMin?: number; approvalRequired?: boolean; waitlistEnabled?: boolean;
}

// ── Check-in ───────────────────────────────────────────────────────────────────────────────────────
export interface StaffView {
  ticketId: string; ticketCode: string; kind: string; holder: string | null; team: string | null;
  slot: { label: string | null; startAt: string | null; endAt: string | null } | null; event: { id: string; title: string } | null;
  registrationCode: string | null; paymentDue: number; usedAt: string | null;
}
export interface Verdict {
  result: CheckInResult; label: string; admit: boolean; paymentDue?: number; entryOpensAt?: string; ticket: StaffView | null;
  admitted?: boolean; collected?: number; code?: string; message?: string;
}
export interface CheckInEvent { id: string; title: string; startAt: string | null; endAt: string | null; venue: string | null; format: string; checkedIn: number; confirmed: number; status?: string; publishAt?: string | null }
export interface RecentScan { id: string; action: 'VALIDATE' | 'CONFIRM'; result: string; method: 'QR' | 'CODE'; at: string | null; ticketCode: string | null; collectedPayment: boolean }

/** Thrown when the server cannot be reached: the gate must NOT admit. */
export class CheckInNetworkError extends Error {
  constructor() { super('Cannot verify — do not admit. The server could not be reached.'); this.name = 'CheckInNetworkError'; }
}

/** Check-in request: 200 and the 409 verdicts both return the verdict; anything else throws a readable Error. */
async function checkInRequest(path: string, body: unknown): Promise<Verdict> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${CHECKIN}${path}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new CheckInNetworkError();
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data && typeof data.result === 'string') return data as Verdict;
  if (res.status === 409 && data && typeof data.result === 'string') return data as Verdict;
  const message = data && typeof data.message === 'string' ? data.message : '';
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
  if (res.status >= 500) throw new Error(message && res.status === 503 ? message : `The server could not complete this request (${res.status}). Do not admit; try again.`);
  throw new Error(message || `Request failed (${res.status}).`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────
const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};
const get = <T>(path: string) => adminRequest<T>(`${BASE}${path}`);
const send = <T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown) =>
  adminRequest<T>(`${BASE}${path}`, { method, body: JSON.stringify(body === undefined ? {} : body) });
const id = (v: string) => encodeURIComponent(v);

/**
 * Questions that ask for phone / ID / bank details. The server already refuses the worst of them
 * (services/validate.js FORBIDDEN_QUESTION_RE); this wider net flags look-alikes for the reviewer.
 */
const SENSITIVE_QUESTION_RE = /\b(aadhaa?r|uidai|pan(\s*card|\s*number|\s*no)?|passport|voter|driving\s*licen[cs]e|licen[cs]e\s*(number|no)|id\s*(card\s*)?(number|no)|identity\s*(card|number|proof)|roll\s*(number|no)|registration\s*(number|no)|reg\.?\s*no|enrol{1,2}ment\s*(number|no)|phone|mobile|whats\s*app|contact\s*(number|no)|cell|telephone|password|otp|pin\s*code|bank|account\s*(number|no)|ifsc|upi|card\s*number|cvv|date\s*of\s*birth|dob|home\s*address|parent'?s?\s*(phone|number))\b/i;
export const sensitiveQuestion = (label: string | null | undefined) => SENSITIVE_QUESTION_RE.test(String(label || ''));

/** Current value of a material field on the serialized event (for the pending-changes diff). undefined = not returned by the API. */
export function currentFieldValue(ev: AdminEvent, key: string): unknown {
  switch (key) {
    case 'capacity': return ev.capacityRaw;
    case 'maxTeams': return ev.team ? ev.team.maxTeams : undefined;
    case 'teamMin': return ev.team ? ev.team.min : undefined;
    case 'teamMax': return ev.team ? ev.team.max : undefined;
    case 'captainRequired': case 'allowSubstitutions': case 'multiTeamAllowed': case 'attendancePerMember':
      return ev.team ? ev.team[key] : undefined;
    case 'priceType': return ev.price.priceType;
    case 'price': return ev.rawPrice;
    case 'extraCharges': return ev.price.extraCharges;
    case 'paymentModes': return ev.paymentModesConfigured;
    case 'minParticipants': case 'waitlistOfferMinutes': return undefined;
    default: return (ev as unknown as Record<string, unknown>)[key];
  }
}
/** Normalised comparison (dates by instant, objects by JSON). */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) { const t = Date.parse(v); return Number.isNaN(t) ? v : t; }
    return typeof v === 'object' ? JSON.stringify(v) : v;
  };
  return norm(a) === norm(b);
}

export const campusEventsApi = {
  summary: () => get<Summary>('/summary'),
  reviewQueue: () => get<{ events: AdminEvent[] }>('/review-queue'),

  events: (opts: { bucket?: string; status?: string; q?: string; campusId?: string; category?: string; entityId?: string } & PageOpts = {}) => get<{ events: AdminEvent[]; pagination: Pagination }>(`/events${qs({ ...opts })}`),
  event: (eventId: string) => get<EventDetail>(`/events/${id(eventId)}`),
  editEvent: (eventId: string, body: EventEdit) => send<{ event: AdminEvent }>('PATCH', `/events/${id(eventId)}`, body),
  approve: (eventId: string, body: { publishAt?: string | null; note?: string } = {}) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/approve`, body),
  reject: (eventId: string, reason: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/reject`, { reason }),
  requestChanges: (eventId: string, note: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/request-changes`, { note }),
  unpublish: (eventId: string, reason: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/unpublish`, { reason }),
  republish: (eventId: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/republish`),
  cancelEvent: (eventId: string, reason: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/cancel`, { reason }),
  feature: (eventId: string, featured: boolean) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/feature`, { featured }),
  approveChanges: (eventId: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/changes/approve`),
  rejectChanges: (eventId: string, note: string) => send<{ event: AdminEvent }>('POST', `/events/${id(eventId)}/changes/reject`, { note }),
  eventRegistrations: (eventId: string, opts: { status?: string; slotId?: string } = {}) => get<{ registrations: Registration[] }>(`/events/${id(eventId)}/registrations${qs({ ...opts })}`),

  /** q: registration code, student name or the phone's last 4 digits. */
  registrations: (opts: { eventId?: string; status?: string; paymentStatus?: string; paymentMode?: string; q?: string } & PageOpts = {}) => get<{ registrations: Registration[]; pagination: Pagination }>(`/registrations${qs({ ...opts })}`),
  cancelRegistration: (regId: string, reason: string) => send<{ registration: { id: string; status: string; paymentStatus: string } }>('POST', `/registrations/${id(regId)}/cancel`, { reason }),
  /** Idempotent: a second call answers 409 NO_REFUND_DUE (nothing is paid twice). Pay-at-venue = cash handed back. */
  refund: (regId: string) => send<{ registration: { id: string; paymentStatus: string; refundAmount: number }; refunded: number }>('POST', `/registrations/${id(regId)}/refund`),
  approveRegistration: (regId: string) => send<{ registration: { id: string; status: string; paymentStatus: string } }>('POST', `/registrations/${id(regId)}/approve`),
  rejectRegistration: (regId: string, reason: string) => send<{ registration: { id: string; status: string; paymentStatus: string } }>('POST', `/registrations/${id(regId)}/reject`, { reason }),
  markPaid: (regId: string) => send<{ registration: { id: string; paymentStatus: string } }>('POST', `/registrations/${id(regId)}/mark-paid`),
  payments: (status?: string, page: PageOpts = {}) => get<{ payments: PaymentRow[]; pagination: Pagination }>(`/payments${qs({ status, ...page })}`),

  voidTicket: (ticketId: string, reason: string) => send<{ ticket: TicketBrief }>('POST', `/tickets/${id(ticketId)}/void`, { reason }),
  reissueTicket: (ticketId: string) => send<{ ticket: TicketBrief }>('POST', `/tickets/${id(ticketId)}/reissue`),

  organizers: (status?: string) => get<{ organizers: Organizer[] }>(`/organizers${qs({ status })}`),
  grantOrganizer: (body: { userId: string; entityId?: string | null; displayName?: string }) => send<{ organizer: Organizer }>('POST', '/organizers', body),
  bulkGrant: (body: { entityId?: string; campusId?: string }) => send<{ entities: number; granted: number; skipped: number }>('POST', '/organizers/bulk-grant', body),
  approveOrganizer: (orgId: string, note?: string) => send<{ organizer: Organizer }>('POST', `/organizers/${id(orgId)}/approve`, note ? { note } : {}),
  rejectOrganizer: (orgId: string, reason: string) => send<{ organizer: Organizer }>('POST', `/organizers/${id(orgId)}/reject`, { reason }),
  suspendOrganizer: (orgId: string, reason: string) => send<{ organizer: Organizer }>('POST', `/organizers/${id(orgId)}/suspend`, { reason }),
  reinstateOrganizer: (orgId: string, note?: string) => send<{ organizer: Organizer }>('POST', `/organizers/${id(orgId)}/reinstate`, note ? { note } : {}),
  revokeOrganizer: (orgId: string, reason: string) => send<{ organizer: Organizer }>('POST', `/organizers/${id(orgId)}/revoke`, { reason }),

  staff: (eventId: string) => get<{ staff: StaffRow[] }>(`/staff${qs({ eventId })}`),
  addStaff: (eventId: string, userId: string) => send<{ staff: { id: string; status: string } }>('POST', `/events/${id(eventId)}/staff`, { userId }),
  revokeStaff: (eventId: string, staffId: string) => send<{ staff: { id: string; status: string } }>('POST', `/events/${id(eventId)}/staff/${id(staffId)}/revoke`),

  settings: () => get<Settings>('/settings'),
  putSettings: (body: { enabled?: boolean; walletEnabled?: boolean; onlinePayEnabled?: boolean; settings?: Partial<SettingsValues> }) => send<Settings>('PUT', '/settings', body),

  reports: (from?: string, to?: string) => get<Reports>(`/reports${qs({ from, to })}`),
  audit: (eventId?: string, page: PageOpts & { action?: string; actorRole?: string } = {}) => get<{ audit: AuditRow[]; pagination: Pagination }>(`/audit${qs({ eventId, ...page })}`),
  categories: () => get<{ categories: CategoryOption[] }>('/categories'),

  // Shared admin lookups used by the pickers.
  /** Narrow Campus Events lookup (masked contact, campus, verified); falls back to the general admin search on older servers. */
  searchUsers: async (term: string): Promise<{ users?: UserHit[] }> => {
    try {
      return await get<{ users: UserHit[] }>(`/users${qs({ q: term })}`);
    } catch (e) {
      // Older server without the route: 404 -> the general admin user search.
      if (/\(404\)|not found/i.test(e instanceof Error ? e.message : '')) return adminRequest<{ users?: UserHit[] }>(`/api/admin/users${qs({ limit: 10, search: term })}`);
      throw e;
    }
  },
  clubs: (q?: string) => adminRequest<{ items: Club[] }>(`/api/campus/mod/entities${qs({ q })}`),

  // Check-in (any admin may check in at any event).
  checkInEvents: () => adminRequest<{ events: CheckInEvent[] }>(`${CHECKIN}/events`),
  recentScans: (eventId: string) => adminRequest<{ checkIns: RecentScan[]; note: string }>(`${CHECKIN}/events/${id(eventId)}/recent`),
  validate: (eventId: string, scan: { token?: string; code?: string }) => checkInRequest('/validate', { eventId, ...scan }),
  confirm: (eventId: string, scan: { token?: string; code?: string }, collectPayment = false) => checkInRequest('/confirm', { eventId, ...scan, ...(collectPayment ? { collectPayment: true } : {}) }),
};

/** A scanned string is a signed QR token (ZE1.…) or a typed 10-character ticket code. */
export const scanPayload = (raw: string): { token?: string; code?: string } => {
  const v = String(raw || '').trim();
  return /^ZE1\./i.test(v) ? { token: v } : { code: v };
};
