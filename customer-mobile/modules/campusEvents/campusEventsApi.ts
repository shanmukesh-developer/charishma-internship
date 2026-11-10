/**
 * Zenvy Campus Events (Others > Campus Events) API client.
 * Backend: backend/modules/campusEvents (routes.js; payloads built in services/serialize.js).
 *   /api/campus-events            students (status, sections, browse, detail, register, holds, teams, my, tickets)
 *   /api/campus-events/organizer  organizer workflow (ACTIVE CeOrganizer only, except /me and /apply)
 *   /api/campus-events/check-in   organizer / admin / granted staff
 * Prices, capacity, eligibility, the primary action (cta) and payment state always come from the server;
 * the app only says what the student wants. Writes that create something (register, hold, team submit)
 * carry an Idempotency-Key so a retry after a dropped connection returns the same registration.
 */
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';
import { newIdempotencyKey } from '../../context/CartContext';
import type { Ionicons } from '@expo/vector-icons';

/** Ionicons glyph name (the module shows icons, never emoji). */
export type CeIconName = keyof typeof Ionicons.glyphMap;

export { newIdempotencyKey };

// ── Enums (backend/modules/campusEvents/enums.js) ───────────────────────────
export type Category = 'SPORTS' | 'TOURNAMENT' | 'CLUB' | 'WORKSHOP' | 'SEMINAR' | 'TALK' | 'COMPETITION' | 'HACKATHON' | 'CULTURAL' | 'RECREATION' | 'OTHER';
export type EventFormat = 'INDIVIDUAL' | 'SLOT' | 'TEAM';
export type PriceType = 'FREE' | 'PAID';
export type EventStatus = 'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'APPROVED' | 'PUBLISHED' | 'UNPUBLISHED' | 'CANCELLED' | 'COMPLETED';
export type RegistrationState = 'OPEN' | 'NOT_OPEN' | 'CLOSED' | 'FULL' | 'CANCELLED' | 'COMPLETED';
export type RegStatus = 'HELD' | 'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'WAITLISTED' | 'OFFERED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';
export type RegType = 'INDIVIDUAL' | 'SLOT' | 'TEAM';
export type PaymentMode = 'NONE' | 'VENUE' | 'WALLET' | 'ONLINE';
export type PaymentStatus = 'NONE' | 'DUE_AT_VENUE' | 'PAID_AT_VENUE' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';
export type TeamStatus = 'FORMING' | 'SUBMITTED' | 'CANCELLED';
export type MemberStatus = 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'REMOVED' | 'LEFT' | 'EXPIRED';
export type TicketKind = 'INDIVIDUAL' | 'SLOT' | 'TEAM' | 'MEMBER';
export type TicketStatus = 'ACTIVE' | 'USED' | 'CANCELLED' | 'VOID';
export type CheckInResult = 'VALID' | 'ALREADY_USED' | 'CANCELLED' | 'INVALID' | 'NOT_YET_VALID' | 'EXPIRED' | 'WRONG_EVENT' | 'UNPAID' | 'PENDING' | 'PAYMENT_DUE';
export type OrganizerStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'REJECTED';
export type QuestionType = 'TEXT' | 'LONG_TEXT' | 'CHOICE' | 'MULTI_CHOICE' | 'NUMBER' | 'YES_NO';
export type AnnouncementKind = 'UPDATE' | 'VENUE_CHANGE' | 'SCHEDULE_CHANGE' | 'CANCELLATION';
export type MyTab = 'upcoming' | 'pending' | 'waitlisted' | 'completed' | 'cancelled';
export type CtaAction =
  | 'CANCELLED' | 'VIEW_TICKET' | 'COMPLETE_PAYMENT' | 'CONFIRM_BOOKING' | 'PENDING_APPROVAL' | 'ON_WAITLIST' | 'ACCEPT_OFFER'
  | 'COMPLETED' | 'NOT_OPEN' | 'REGISTRATION_CLOSED' | 'MANAGE_TEAM' | 'VIEW_TEAM' | 'NOT_ELIGIBLE' | 'JOIN_TEAM' | 'JOIN_WAITLIST'
  | 'EVENT_FULL' | 'REGISTER_TEAM' | 'BOOK_SLOT' | 'REGISTER_NOW';

// ── Payloads (services/serialize.js) ─────────────────────────────────────────
export interface StatusResponse {
  enabled: boolean;
  walletEnabled: boolean;
  onlinePayEnabled: boolean;
  ticketsReady: boolean;
  organizer: { status: OrganizerStatus } | null;
  /** ACTIVE organizer (may create / manage events). Older servers: undefined. */
  isOrganizer?: boolean;
  /** May open entry check-in (staff grant, organizer of an approved / live event, admin). Older servers: undefined. */
  isStaff?: boolean;
  settings: { holdMinutes: number; paymentMinutes: number; maxUnpaidVenueReservations: number };
  categories: { key: Category; label: string }[];
}

export interface PriceBlock {
  priceType: PriceType;
  isFree: boolean;
  amount: number;
  extras: number;
  total: number;
  extraCharges: { label: string; amount: number }[];
  label: string;
}

export interface CapacityBlock {
  kind: 'SLOTS' | 'TEAMS' | 'SEATS';
  capacity?: number;
  confirmed?: number;
  remaining?: number;
  waitlistCount?: number;
}

export interface OrganizerBlock {
  name: string;
  club: { id: string; name: string; type: string; verified: boolean } | null;
}

export interface EventCard {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string;
  tags: string[];
  posterUrl: string | null;
  organizer: OrganizerBlock;
  startAt: string | null;
  endAt: string | null;
  venue: string | null;
  format: EventFormat;
  isTeam: boolean;
  price: PriceBlock;
  regOpensAt: string | null;
  regClosesAt: string | null;
  capacity: CapacityBlock;
  /** SLOT events: open future slots with a place left (null when unknown). */
  slotsAvailable?: number | null;
  registrationState: RegistrationState;
  featured: boolean;
  publishedAt: string | null;
  myStatus: RegStatus | null;
}

export interface Question {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  maxLength?: number;
}

export interface Cta {
  action: CtaAction;
  label: string;
  enabled: boolean;
  registrationId?: string;
  teamId?: string;
  invitationId?: string;
  opensAt?: string | null;
  reasons?: string[];
}

export interface CancellationPolicy { userCancelUntilHours?: number | null; refundPct?: number | null; text?: string }
export interface Eligibility { years?: number[]; branches?: string[]; adultOnly?: boolean }

export interface TeamRules {
  min: number | null;
  max: number | null;
  maxTeams: number | null;
  captainRequired: boolean;
  allowSubstitutions: boolean;
  multiTeamAllowed: boolean;
  attendancePerMember: boolean;
}

export interface EventDetail extends EventCard {
  description: string | null;
  gallery: string[];
  venueDirections?: string | null;
  venueLat?: number | null;
  venueLon?: number | null;
  eligibility: Eligibility;
  rules: string;
  rulesVersion: number;
  questions: Question[];
  equipment: string | null;
  contactText: string | null;
  instructions: string | null;
  cancellationPolicy: CancellationPolicy;
  team: TeamRules | null;
  maxBookingsPerStudent: number;
  approvalRequired: boolean;
  waitlistEnabled: boolean;
  /** Minutes a waitlist offer stays open (null = platform default). */
  waitlistOfferMinutes?: number | null;
  /** Minimum participants the organizer needs (null = none). */
  minParticipants?: number | null;
  /** Payment modes the server will accept right now (wallet / online only when switched on). */
  paymentModes: PaymentMode[];
  entryOpensBeforeMin: number;
  status: EventStatus;
  cta?: Cta;
  eligibilityReasons?: string[];
  myRegistration?: { id: string; code: string; status: RegStatus; type: RegType } | null;
  myTeam?: { id: string; name: string; status: TeamStatus; isCaptain: boolean; registrationId: string | null } | null;
}

export interface Slot {
  id: string;
  label: string | null;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  capacity: number;
  confirmed: number;
  remaining: number;
  waitlistCount: number;
  price: PriceBlock;
  state: 'OPEN' | 'CANCELLED' | 'STARTED' | 'FULL';
  myRegistration?: { id: string; status: RegStatus } | null;
  status?: string;
}

export interface SlotsResponse {
  slots: Slot[];
  days: { date: string; slots: Slot[] }[];
  maxBookingsPerStudent: number;
  myBookings: number;
}

export interface PaymentBlock {
  mode: PaymentMode;
  status: PaymentStatus;
  amount: number;
  extras: number;
  total: number;
  paidAt: string | null;
  refundAmount: number;
  refundedAt: string | null;
  payBy?: string | null;
}

/** An answer with the question label it was given under (snapshot at registration time). */
export interface AnswerDetail { id: string; label: string; type: QuestionType | null; value: any }

export interface TicketBrief { id: string; kind: TicketKind; status: TicketStatus; ticketCode: string; usedAt: string | null }

export interface Registration {
  id: string;
  code: string;
  type: RegType;
  status: RegStatus;
  event: { id: string; title: string; startAt: string | null; endAt: string | null; venue: string | null; posterUrl: string | null; status: EventStatus; format: EventFormat } | null;
  slot: { id: string; label: string | null; startAt: string; endAt: string } | null;
  team: { id: string; name: string; isCaptain: boolean } | null;
  isOwner: boolean;
  /** Only for the registrant (team: the captain who registered). */
  payment?: PaymentBlock;
  holdExpiresAt: string | null;
  offerExpiresAt: string | null;
  waitlistAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason?: string | null;
  rejectedReason?: string | null;
  answers?: Record<string, any>;
  answerDetails?: AnswerDetail[];
  tickets: TicketBrief[];
  ticketStatus: 'AVAILABLE' | 'ISSUING' | 'NOT_ISSUED' | TicketStatus;
  canCancel: boolean;
  cancelUntil: string | null;
  createdAt: string | null;
}

export interface RegisterResponse { registration: Registration; replay?: boolean; waitlisted?: boolean; held?: boolean }

export interface Ticket {
  id: string;
  kind: TicketKind;
  status: TicketStatus;
  ticketCode: string;
  /** Signed opaque token for the QR; null unless the ticket is ACTIVE. */
  qrToken: string | null;
  holder: string;
  event: { id: string; title: string; startAt: string | null; endAt: string | null; venue: string | null; posterUrl: string | null; instructions: string | null; entryOpensBeforeMin: number } | null;
  slot: { id: string; label: string | null; startAt: string; endAt: string } | null;
  registration: { id: string; code: string; status: RegStatus; paymentDue: boolean; total: number } | null;
  team: { id: string; name: string } | null;
  usedAt: string | null;
  entryNote: string;
}

export interface TeamMember {
  id: string;
  role: 'CAPTAIN' | 'PLAYER';
  status: MemberStatus;
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
  invitedAt: string | null;
  respondedAt: string | null;
}

export interface Team {
  id: string;
  name: string;
  status: TeamStatus;
  rosterVersion: number;
  isCaptain: boolean;
  event: { id: string; title: string; startAt: string | null; teamMin: number | null; teamMax: number | null; allowSubstitutions: boolean } | null;
  members: TeamMember[];
  acceptedCount: number;
  registration: { id: string; code: string; status: RegStatus } | null;
  /** Captain only. */
  joinLinkActive?: boolean;
}

export interface Invitation {
  id: string;
  status: MemberStatus;
  expiresAt: string | null;
  invitedAt: string | null;
  team: { id: string; name: string; captain: string } | null;
  event: { id: string; title: string; startAt: string | null; venue: string | null; category: Category } | null;
}

export interface Announcement { id: string; kind: AnnouncementKind; title: string; body: string; createdAt: string | null }

export interface PersonResult { userId: string; name: string; avatarUrl: string | null; branch: string | null; year: number | null; verified: boolean }

export interface CheckInTicketView {
  ticketId: string;
  ticketCode: string;
  kind: TicketKind;
  holder: string | null;
  team: string | null;
  slot: { label: string | null; startAt: string; endAt: string } | null;
  event: { id: string; title: string } | null;
  registrationCode: string | null;
  paymentDue: number;
  usedAt: string | null;
}

export interface CheckInReply {
  result: CheckInResult;
  label: string;
  admit: boolean;
  paymentDue?: number;
  entryOpensAt?: string;
  ticket: CheckInTicketView | null;
  admitted?: boolean;
  collected?: number;
}

export interface CheckInEvent { id: string; title: string; startAt: string | null; endAt: string | null; venue: string | null; format: EventFormat; checkedIn: number; confirmed: number; status?: EventStatus; publishAt?: string | null }

export interface ClubOption { id: string; name: string; type: string; verified: boolean; eventCount: number }
export interface CategoryOption { key: Category; label: string; icon: string; section: string | null }
export interface JoinPreview {
  team: { name: string; status: TeamStatus; rosterCount: number; teamMin: number | null; teamMax: number | null; captainFirstName: string };
  event: { id: string; title: string; startAt: string | null; venue: string | null; category: Category };
  expiresAt: string | null;
  alreadyMember: boolean;
  canJoin: boolean;
  reason: string | null;
  message: string | null;
}

export interface OrganizerOwn {
  id: string; status: OrganizerStatus; displayName: string; entityId: string | null; campusId: string | null; reviewNote: string | null; grantedAt: string | null; createdAt: string | null;
}

export interface OrganizerMe {
  organizer: OrganizerOwn | null;
  canApply: boolean;
  eligibilityReasons: string[];
  managedClubs: { id: string; name: string; type: string }[];
}

export interface OrganizerEvent extends EventDetail {
  publishAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote?: string | null;
  rejectionReason?: string | null;
  pendingChanges: { fields?: Record<string, any>; requestedAt?: string } | null;
  cancelReason?: string | null;
  counters: { unitsLive: number; confirmed: number; waitlist: number; checkedIn: number };
  posterPath?: string | null;
  galleryPaths: string[];
  rawPrice: number;
  capacityRaw: number | null;
  paymentModesConfigured: PaymentMode[];
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Participant {
  id: string;
  code: string;
  type: RegType;
  status: RegStatus;
  name: string;
  team: { id: string; name: string } | null;
  slotId: string | null;
  unitNo: number | null;
  answers: Record<string, any>;
  answerDetails?: AnswerDetail[];
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus;
  total: number;
  ticket: TicketBrief | null;
  waitlistAt: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

export interface EventStats {
  eventId: string;
  byStatus: Partial<Record<RegStatus, number>>;
  total: number;
  confirmed: number;
  checkedIn: number;
  teams?: number;
  collected: { VENUE: number; WALLET: number; ONLINE: number };
  dueAtVenue: number;
  refunded: number;
}

export interface StaffGrant { id: string; role: string; name: string; createdAt: string | null }

/** Fields an organizer form sends (validate.js cleanEventInput; only keys present are changed). */
export interface EventInput {
  title?: string;
  category?: Category;
  tags?: string[];
  description?: string;
  venue?: string;
  venueDirections?: string;
  startAt?: string;
  endAt?: string;
  regOpensAt?: string | null;
  regClosesAt?: string | null;
  format?: EventFormat;
  capacity?: number | null;
  maxTeams?: number | null;
  teamMin?: number | null;
  teamMax?: number | null;
  captainRequired?: boolean;
  allowSubstitutions?: boolean;
  multiTeamAllowed?: boolean;
  attendancePerMember?: boolean;
  approvalRequired?: boolean;
  waitlistEnabled?: boolean;
  maxBookingsPerStudent?: number;
  minParticipants?: number | null;
  priceType?: PriceType;
  price?: number;
  extraCharges?: { label: string; amount: number }[];
  paymentModes?: PaymentMode[];
  eligibility?: Eligibility;
  rules?: string;
  questions?: Question[];
  equipment?: string;
  contactText?: string;
  instructions?: string;
  cancellationPolicy?: CancellationPolicy;
  entryOpensBeforeMin?: number;
  posterPath?: string | null;
  gallery?: string[];
  entityId?: string | null;
}

export interface SlotInput { label?: string; startAt: string; endAt: string; capacity: number; price?: number }

/** Body for register / confirm-hold / team submit. */
export interface RegisterBody {
  slotId?: string;
  answers?: Record<string, any>;
  acceptRules?: boolean;
  rulesVersion?: number;
  paymentMode?: PaymentMode;
  joinWaitlist?: boolean;
}

// ── Transport ────────────────────────────────────────────────────────────────
export class CampusEventsError extends Error {
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
  /** Field the server rejected (forms highlight it). */
  get field(): string | null { return this.data && typeof this.data.field === 'string' ? this.data.field : null; }
}

const call = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new CampusEventsError(NETWORK_ERROR_MESSAGE, 0, 'NETWORK');
  }
  const data = await readJson(res);
  if (!data) throw new CampusEventsError(SERVER_BUSY_MESSAGE, res.status, 'SERVER_BUSY');
  if (!res.ok) {
    const msg = typeof data.message === 'string' && data.message ? data.message : 'Something went wrong. Please try again.';
    throw new CampusEventsError(res.status === 401 ? 'Please sign in again.' : msg, res.status, data.code || 'ERROR', data);
  }
  return data as T;
};
const send = <T = any>(method: string, path: string, body?: any, idempotencyKey?: string) =>
  call<T>(path, { method, body: JSON.stringify(body || {}), ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) });
const post = <T = any>(path: string, body?: any, idempotencyKey?: string) => send<T>('POST', path, body, idempotencyKey);
const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};
const enc = encodeURIComponent;

export const CE = '/api/campus-events';
const ORG = `${CE}/organizer`;
const CHK = `${CE}/check-in`;

export interface BrowseFilter {
  q?: string | null;
  category?: string | null; // comma list of Category
  section?: string | null;
  from?: string | null; // ISO
  to?: string | null; // ISO
  price?: 'free' | 'paid' | null;
  format?: 'INDIVIDUAL' | 'SLOT' | 'TEAM' | null;
  available?: boolean | null;
  entityId?: string | null;
  status?: 'open' | 'upcoming' | 'closed' | null;
  featured?: boolean | null;
  /** deadline = open registrations, closing soonest first (server-side). */
  sort?: 'date' | 'recent' | 'deadline' | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface SectionsResponse {
  featured: EventCard[];
  upcoming: EventCard[];
  sections: { key: string; label: string; events: EventCard[] }[];
  my: { registrations: number; tickets: number };
  reason?: string;
}

export const campusEventsApi = {
  // Discovery
  /** No feature gate: the Others chip is shown only when enabled. */
  status: () => call<StatusResponse>(`${CE}/status`),
  sections: () => call<SectionsResponse>(`${CE}/sections`),
  browse: (f: BrowseFilter = {}) => {
    const { sort, ...rest } = f;
    return call<{ events: EventCard[]; nextCursor: string | null; reason?: string; message?: string }>(`${CE}${qs({ ...(rest as any), sort: sort === 'recent' || sort === 'deadline' ? sort : null })}`);
  },
  /** Verified clubs of my campus that have published events (filter options). */
  clubs: () => call<{ clubs: ClubOption[] }>(`${CE}/clubs`),
  categories: () => call<{ categories: CategoryOption[]; sections: { key: string; label: string; categories: Category[] }[] }>(`${CE}/categories`),
  event: (id: string) => call<{ event: EventDetail }>(`${CE}/${enc(id)}`),
  slots: (id: string) => call<SlotsResponse>(`${CE}/${enc(id)}/slots`),
  availability: (id: string) => call<{ eventId: string; registrationState: RegistrationState; capacity: CapacityBlock; slots?: { id: string; remaining: number; capacity: number; state: Slot['state'] }[] }>(`${CE}/${enc(id)}/availability`),
  announcements: (id: string) => call<{ announcements: Announcement[] }>(`${CE}/${enc(id)}/announcements`),

  // Registration
  /** 201 new / 200 replay (same key). Waitlisted when full and the event has a waitlist (unless joinWaitlist false). */
  register: (eventId: string, body: RegisterBody, idempotencyKey: string) =>
    post<RegisterResponse>(`${CE}/${enc(eventId)}/register`, { ...body, idempotencyKey }, idempotencyKey),
  /** Slot picker: holds the place for settings.holdMinutes; answers + payment come with confirm(). */
  hold: (eventId: string, slotId: string, idempotencyKey: string) =>
    post<RegisterResponse>(`${CE}/${enc(eventId)}/slots/${enc(slotId)}/hold`, { joinWaitlist: false, idempotencyKey }, idempotencyKey),
  confirm: (regId: string, body: RegisterBody) => post<RegisterResponse>(`${CE}/registrations/${enc(regId)}/confirm`, body),
  release: (regId: string) => post<{ registration: Registration }>(`${CE}/registrations/${enc(regId)}/release`),
  cancel: (regId: string, reason?: string) => post<{ registration: Registration }>(`${CE}/registrations/${enc(regId)}/cancel`, reason ? { reason } : {}),
  acceptOffer: (regId: string, paymentMode?: PaymentMode) => post<{ registration: Registration }>(`${CE}/registrations/${enc(regId)}/accept-offer`, paymentMode ? { paymentMode } : {}),
  declineOffer: (regId: string) => post<{ registration: Registration }>(`${CE}/registrations/${enc(regId)}/decline-offer`),
  requestRefund: (regId: string) => post<{ registration: Registration; refunded?: number; message?: string }>(`${CE}/registrations/${enc(regId)}/request-refund`),
  razorpayOrder: (regId: string) =>
    post<{ provider: 'RAZORPAY'; keyId: string; orderId: string; amountPaise: number; currency: string; payBy: string | null; registrationId: string; note: string }>(`${CE}/registrations/${enc(regId)}/pay/razorpay-order`),
  paymentStatus: (regId: string) => call<{ registrationId: string; status: RegStatus; payment: PaymentBlock; confirmed: boolean }>(`${CE}/registrations/${enc(regId)}/payment`),
  myRegistrations: (tab: MyTab) => call<{ tab: MyTab; registrations: Registration[] }>(`${CE}/my/registrations${qs({ tab })}`),
  registration: (id: string) => call<{ registration: Registration }>(`${CE}/registrations/${enc(id)}`),
  myTickets: (all = false) => call<{ tickets: Ticket[]; ticketsReady: boolean }>(`${CE}/my/tickets${qs({ status: all ? 'all' : null })}`),
  ticket: (id: string) => call<{ ticket: Ticket }>(`${CE}/tickets/${enc(id)}`),

  // Teams
  myTeams: () => call<{ teams: Team[] }>(`${CE}/my/teams`),
  invitations: () => call<{ invitations: Invitation[] }>(`${CE}/team-invitations`),
  respondInvitation: (id: string, accept: boolean) => post<{ team?: Team; invitation?: { id: string; status: MemberStatus } }>(`${CE}/team-invitations/${enc(id)}/respond`, { accept }),
  /** What a join link joins (team, event, roster count, captain first name) before consenting. 404 INVALID_LINK. */
  joinPreview: (token: string) => call<{ preview: JoinPreview }>(`${CE}/team-join/preview${qs({ t: token })}`),
  joinByLink: (token: string) => post<{ team: Team; already: boolean }>(`${CE}/team-join`, { token }),
  createTeam: (eventId: string, name: string) => post<{ team: Team }>(`${CE}/${enc(eventId)}/teams`, { name }),
  /** Accepted members get { team }; an invitee gets { invitation }. */
  team: (teamId: string) => call<{ team?: Team; invitation?: Invitation }>(`${CE}/teams/${enc(teamId)}`),
  teamHistory: (teamId: string) => call<{ rosterVersion: number; history: { action: string; at: string | null; details: { rosterVersion?: number; role?: string } }[] }>(`${CE}/teams/${enc(teamId)}/history`),
  invite: (teamId: string, userId: string) => post<{ invitation: { id: string; status: MemberStatus; expiresAt: string | null }; team: Team }>(`${CE}/teams/${enc(teamId)}/invitations`, { userId }),
  joinLink: (teamId: string) => post<{ token: string; url: string; expiresAt: string | null; note: string }>(`${CE}/teams/${enc(teamId)}/join-link`),
  revokeJoinLink: (teamId: string) => post<{ ok: boolean }>(`${CE}/teams/${enc(teamId)}/join-link/revoke`),
  removeMember: (teamId: string, memberId: string) => post<{ team: Team; belowMinimum?: boolean }>(`${CE}/teams/${enc(teamId)}/members/${enc(memberId)}/remove`),
  leaveTeam: (teamId: string) => post<{ ok: boolean }>(`${CE}/teams/${enc(teamId)}/leave`),
  transferCaptain: (teamId: string, memberId: string) => post<{ team: Team }>(`${CE}/teams/${enc(teamId)}/captain`, { memberId }),
  submitTeam: (teamId: string, body: RegisterBody, idempotencyKey: string) =>
    post<{ registration: Registration; team: Team; waitlisted: boolean; replay?: boolean }>(`${CE}/teams/${enc(teamId)}/submit`, { ...body, idempotencyKey }, idempotencyKey),
  cancelTeam: (teamId: string) => post<{ team: { id: string; status: TeamStatus } }>(`${CE}/teams/${enc(teamId)}/cancel`),
  /** Existing Campus people search (verified, same campus, blocks excluded, no phones). */
  searchPeople: (q: string) => call<{ people: PersonResult[] }>(`/api/campus/search${qs({ q, type: 'people' })}`),

  // Check-in (organizer / admin / granted staff)
  checkInEvents: () => call<{ events: CheckInEvent[] }>(`${CHK}/events`),
  validate: (eventId: string, ticket: { code?: string; token?: string }) => post<CheckInReply>(`${CHK}/validate`, { eventId, ...ticket }),
  /** 200 admitted; 409 with the same reply shape (code = result) when not admissible. */
  confirmCheckIn: (eventId: string, ticket: { code?: string; token?: string }, collectPayment = false) =>
    post<CheckInReply>(`${CHK}/confirm`, { eventId, ...ticket, ...(collectPayment ? { collectPayment: true } : {}) }),
  recentCheckIns: (eventId: string) => call<{ checkIns: { id: string; action: string; result: CheckInResult; method: string; at: string | null; ticketCode: string | null; collectedPayment: boolean }[]; note: string }>(`${CHK}/events/${enc(eventId)}/recent`),

  // Organizer
  organizerMe: () => call<OrganizerMe>(`${ORG}/me`),
  applyOrganizer: (body: { displayName: string; entityId?: string | null; note?: string; proofText?: string }) => post<{ organizer: OrganizerOwn }>(`${ORG}/apply`, body),
  orgEvents: (status?: EventStatus | null) => call<{ events: OrganizerEvent[] }>(`${ORG}/events${qs({ status })}`),
  orgCreate: (body: EventInput) => post<{ event: OrganizerEvent }>(`${ORG}/events`, body),
  orgEvent: (id: string) => call<{ event: OrganizerEvent }>(`${ORG}/events/${enc(id)}`),
  /** Live events: material changes go to admin review (pendingReview lists those fields). */
  orgUpdate: (id: string, body: EventInput) => send<{ event: OrganizerEvent; pendingReview: string[] }>('PATCH', `${ORG}/events/${enc(id)}`, body),
  orgDelete: (id: string) => send<{ ok: boolean }>('DELETE', `${ORG}/events/${enc(id)}`),
  orgSubmit: (id: string) => post<{ event: OrganizerEvent }>(`${ORG}/events/${enc(id)}/submit`),
  orgWithdraw: (id: string) => post<{ event: OrganizerEvent }>(`${ORG}/events/${enc(id)}/withdraw`),
  orgCancel: (id: string, reason: string) => post<{ event: OrganizerEvent }>(`${ORG}/events/${enc(id)}/cancel`, { reason }),
  orgSlots: (id: string) => call<{ slots: Slot[] }>(`${ORG}/events/${enc(id)}/slots`),
  orgCreateSlots: (id: string, slots: SlotInput[]) => post<{ slots: Slot[] }>(`${ORG}/events/${enc(id)}/slots`, { slots }),
  orgUpdateSlot: (id: string, slotId: string, body: Partial<SlotInput>) => send<{ slot: Slot }>('PATCH', `${ORG}/events/${enc(id)}/slots/${enc(slotId)}`, body),
  orgCancelSlot: (id: string, slotId: string, reason?: string) => post<{ slot: { id: string; status: string } }>(`${ORG}/events/${enc(id)}/slots/${enc(slotId)}/cancel`, reason ? { reason } : {}),
  orgRegistrations: (id: string, status?: RegStatus | null) => call<{ registrations: Participant[]; questions: Question[] }>(`${ORG}/events/${enc(id)}/registrations${qs({ status })}`),
  orgTeams: (id: string) => call<{ teams: { id: string; name: string; status: TeamStatus; rosterVersion: number; registrationId: string | null; members: { id: string; role: string; name: string }[] }[] }>(`${ORG}/events/${enc(id)}/teams`),
  orgApprove: (id: string, regId: string) => post<{ registration: { id: string; status: RegStatus } }>(`${ORG}/events/${enc(id)}/registrations/${enc(regId)}/approve`),
  orgReject: (id: string, regId: string, reason: string) => post<{ registration: { id: string; status: RegStatus } }>(`${ORG}/events/${enc(id)}/registrations/${enc(regId)}/reject`, { reason }),
  orgMarkPaid: (id: string, regId: string) => post<{ registration: { id: string; status: RegStatus; paymentStatus: PaymentStatus } }>(`${ORG}/events/${enc(id)}/registrations/${enc(regId)}/mark-paid`),
  orgMarkRefunded: (id: string, regId: string) => post<{ registration: { id: string; paymentStatus: PaymentStatus } }>(`${ORG}/events/${enc(id)}/registrations/${enc(regId)}/mark-refunded`),
  orgAnnouncements: (id: string) => call<{ announcements: Announcement[] }>(`${ORG}/events/${enc(id)}/announcements`),
  orgAnnounce: (id: string, body: { title: string; body: string; kind?: AnnouncementKind }) => post<{ announcement: Announcement }>(`${ORG}/events/${enc(id)}/announcements`, body),
  orgStats: (id: string) => call<{ stats: EventStats }>(`${ORG}/events/${enc(id)}/stats`),
  orgStaff: (id: string) => call<{ staff: StaffGrant[] }>(`${ORG}/events/${enc(id)}/staff`),
  orgAddStaff: (id: string, userId: string) => post<{ staff: { id: string; status: string } }>(`${ORG}/events/${enc(id)}/staff`, { userId }),
  orgRevokeStaff: (id: string, staffId: string) => post<{ staff: { id: string; status: string } }>(`${ORG}/events/${enc(id)}/staff/${enc(staffId)}/revoke`),
};

// ── Display helpers ─────────────────────────────────────────────────────────
/** Answers as label / text rows: labels from the registration's snapshot (answerDetails), else the given questions, else the id. */
export const answerRows = (r: { answers?: Record<string, any>; answerDetails?: AnswerDetail[] }, questions?: Question[]): { id: string; label: string; text: string }[] => {
  const show = (v: any) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
  if (r.answerDetails && r.answerDetails.length) return r.answerDetails.map((a) => ({ id: a.id, label: a.label, text: show(a.value) }));
  const a = r.answers || {};
  const qs = questions || [];
  const known = qs.filter((q) => a[q.id] !== undefined).map((q) => ({ id: q.id, label: q.label, text: show(a[q.id]) }));
  return [...known, ...Object.keys(a).filter((k) => !qs.some((q) => q.id === k)).map((k) => ({ id: k, label: k, text: show(a[k]) }))];
};

export const inr = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return `₹${(Math.round(v * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ist = (iso: string) => new Date(new Date(iso).getTime() + IST_OFFSET_MS);
/** 'YYYY-MM-DD' of a day `offset` days from today, India time. */
export const istDate = (offset = 0) => new Date(Date.now() + IST_OFFSET_MS + offset * 86400000).toISOString().slice(0, 10);
export const istYmd = (iso?: string | null) => (iso ? ist(iso).toISOString().slice(0, 10) : '');
export const fmtClock = (iso?: string | null) => {
  if (!iso) return '';
  const d = ist(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const dayLabel = (date: string) => {
  if (!date) return '';
  if (date === istDate(0)) return 'Today';
  if (date === istDate(1)) return 'Tomorrow';
  const d = new Date(`${date}T12:00:00+05:30`);
  return `${DAYS[ist(d.toISOString()).getUTCDay()]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
};
/** { dow: 'Tue', day: '21', mon: 'Oct' } for poster date tiles (IST). */
export const dateTile = (iso?: string | null) => {
  if (!iso) return null;
  const d = ist(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { dow: DAYS[d.getUTCDay()], day: String(d.getUTCDate()), mon: MONTHS[d.getUTCMonth()] };
};
/** 'Tue 21 Oct · 9:00 AM' (IST). */
export const fmtWhen = (iso?: string | null) => (iso ? `${dayLabel(istYmd(iso))} · ${fmtClock(iso)}` : 'Time not set');
/** 'Tue 21 Oct · 9:00 AM – 12:00 PM' (end day shown when different). */
export const fmtRange = (start?: string | null, end?: string | null) => {
  if (!start) return 'Time not set';
  if (!end) return fmtWhen(start);
  const sameDay = istYmd(start) === istYmd(end);
  return `${fmtWhen(start)} – ${sameDay ? fmtClock(end) : fmtWhen(end)}`;
};
/** 'in 12 min' / 'in 3 hours' / 'in 2 days' / 'now'. */
export const fromNow = (iso?: string | null, nowMs = Date.now()) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 30000) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? '' : 's'}`;
  return `in ${Math.round(h / 24)} days`;
};
/** Organizer form labels for API field keys (error messages, edits in review). Unknown keys -> null. */
const FIELD_LABEL: Record<string, string> = {
  title: 'Title', category: 'Category', description: 'Description', tags: 'Tags', venue: 'Venue', venueDirections: 'Directions',
  startAt: 'Starts', endAt: 'Ends', regOpensAt: 'Registration opens', regClosesAt: 'Registration closes', format: 'Format',
  capacity: 'Capacity', maxTeams: 'Teams', teamMin: 'Min players', teamMax: 'Max players', captainRequired: 'Captain required',
  allowSubstitutions: 'Substitutions', multiTeamAllowed: 'More than one team', attendancePerMember: 'Check-in per player',
  maxBookingsPerStudent: 'Max bookings per student', approvalRequired: 'Approval', waitlistEnabled: 'Waitlist', priceType: 'Price',
  price: 'Fee', extraCharges: 'Extra charges', paymentModes: 'How students pay', eligibility: 'Who can join', rules: 'Rules',
  questions: 'Questions', equipment: 'What to bring', contactText: 'Contact', instructions: 'Entry instructions',
  cancellationPolicy: 'Cancellation policy', entryOpensBeforeMin: 'Entry opens', posterPath: 'Poster', gallery: 'Gallery',
};
export const fieldLabel = (key?: string | null): string | null => {
  if (!key) return null;
  const base = String(key).split(/[.[]/)[0];
  return FIELD_LABEL[base] || null;
};

/** '2–5 players' / '5 players' / '2 or more players' (no maximum set). */
export const teamSizeLabel = (min?: number | null, max?: number | null) => {
  const lo = min ?? 1;
  if (max == null) return `${lo} or more players`;
  if (lo >= max) return `${max} player${max === 1 ? '' : 's'}`;
  return `${lo}–${max} players`;
};
export const mmss = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export const CATEGORY_META: Record<Category, { label: string; icon: CeIconName; color: string }> = {
  SPORTS: { label: 'Sports', icon: 'football-outline', color: '#16A34A' },
  TOURNAMENT: { label: 'Tournament', icon: 'trophy-outline', color: '#D97706' },
  CLUB: { label: 'Club activity', icon: 'people-outline', color: '#7C3AED' },
  WORKSHOP: { label: 'Workshop', icon: 'construct-outline', color: '#0EA5E9' },
  SEMINAR: { label: 'Seminar', icon: 'mic-outline', color: '#2563EB' },
  TALK: { label: 'Talk', icon: 'chatbubbles-outline', color: '#0891B2' },
  COMPETITION: { label: 'Competition', icon: 'medal-outline', color: '#DC2626' },
  HACKATHON: { label: 'Hackathon', icon: 'code-slash-outline', color: '#9333EA' },
  CULTURAL: { label: 'Cultural', icon: 'color-palette-outline', color: '#DB2777' },
  RECREATION: { label: 'Recreational', icon: 'game-controller-outline', color: '#059669' },
  OTHER: { label: 'Other', icon: 'apps-outline', color: '#64748B' },
};
export const CATEGORIES = Object.keys(CATEGORY_META) as Category[];

export const FORMAT_LABEL: Record<EventFormat, string> = { INDIVIDUAL: 'Individual', SLOT: 'Slot booking', TEAM: 'Team event' };

export const REG_STATUS_META: Record<RegStatus, { label: string; color: string; icon: CeIconName }> = {
  HELD: { label: 'Place held', color: '#F59E0B', icon: 'hourglass-outline' },
  PENDING_PAYMENT: { label: 'Payment pending', color: '#F59E0B', icon: 'time-outline' },
  PENDING_APPROVAL: { label: 'Waiting for approval', color: '#F59E0B', icon: 'time-outline' },
  CONFIRMED: { label: 'Confirmed', color: '#10B981', icon: 'checkmark-circle' },
  WAITLISTED: { label: 'Waitlisted', color: '#6366F1', icon: 'list-outline' },
  OFFERED: { label: 'Place offered', color: '#0EA5E9', icon: 'gift-outline' },
  CANCELLED: { label: 'Cancelled', color: '#64748B', icon: 'close-circle-outline' },
  EXPIRED: { label: 'Expired', color: '#64748B', icon: 'hourglass-outline' },
  REJECTED: { label: 'Not approved', color: '#EF4444', icon: 'close-circle-outline' },
};

export const REG_STATE_META: Record<RegistrationState, { label: string; color: string; icon: CeIconName }> = {
  OPEN: { label: 'Registration open', color: '#10B981', icon: 'radio-button-on' },
  NOT_OPEN: { label: 'Opens soon', color: '#64748B', icon: 'time-outline' },
  CLOSED: { label: 'Registration closed', color: '#64748B', icon: 'lock-closed-outline' },
  FULL: { label: 'Full', color: '#EF4444', icon: 'ban-outline' },
  CANCELLED: { label: 'Cancelled', color: '#EF4444', icon: 'close-circle-outline' },
  COMPLETED: { label: 'Event over', color: '#64748B', icon: 'flag-outline' },
};

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = { NONE: 'Free', VENUE: 'Pay at the venue', WALLET: 'ZenWe Wallet', ONLINE: 'Pay online (UPI / card)' };
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  NONE: 'Nothing to pay',
  DUE_AT_VENUE: 'Pay at the venue desk',
  PAID_AT_VENUE: 'Paid at the venue',
  PENDING: 'Payment pending',
  SUCCESS: 'Paid',
  FAILED: 'Payment failed',
  TIMEOUT: 'Payment timed out',
  CANCELLED: 'Payment cancelled',
  REFUND_PENDING: 'Refund in progress',
  REFUNDED: 'Refunded',
};

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Valid', color: '#10B981' },
  USED: { label: 'Checked in', color: '#3B82F6' },
  CANCELLED: { label: 'Cancelled', color: '#64748B' },
  VOID: { label: 'Void', color: '#EF4444' },
};

export const EVENT_STATUS_META: Record<EventStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: '#64748B' },
  SUBMITTED: { label: 'In review', color: '#F59E0B' },
  CHANGES_REQUESTED: { label: 'Changes requested', color: '#F97316' },
  REJECTED: { label: 'Rejected', color: '#EF4444' },
  APPROVED: { label: 'Approved · scheduled', color: '#0EA5E9' },
  PUBLISHED: { label: 'Published', color: '#10B981' },
  UNPUBLISHED: { label: 'Unpublished', color: '#64748B' },
  CANCELLED: { label: 'Cancelled', color: '#EF4444' },
  COMPLETED: { label: 'Completed', color: '#6366F1' },
};

/** Check-in verdict colours + icon + words (never colour alone). */
export const CHECKIN_META: Record<CheckInResult, { title: string; color: string; icon: CeIconName }> = {
  VALID: { title: 'Valid', color: '#16A34A', icon: 'checkmark-circle' },
  PAYMENT_DUE: { title: 'Collect fee', color: '#D97706', icon: 'cash-outline' },
  ALREADY_USED: { title: 'Already used', color: '#DC2626', icon: 'ban-outline' },
  CANCELLED: { title: 'Cancelled', color: '#DC2626', icon: 'close-circle' },
  INVALID: { title: 'Invalid', color: '#DC2626', icon: 'close-circle' },
  NOT_YET_VALID: { title: 'Not yet valid', color: '#D97706', icon: 'time-outline' },
  EXPIRED: { title: 'Event over', color: '#DC2626', icon: 'flag-outline' },
  WRONG_EVENT: { title: 'Wrong event', color: '#DC2626', icon: 'swap-horizontal-outline' },
  UNPAID: { title: 'Unpaid', color: '#DC2626', icon: 'alert-circle-outline' },
  PENDING: { title: 'Not confirmed', color: '#DC2626', icon: 'time-outline' },
};

/** Lists (organizer form) */
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = { TEXT: 'Short answer', LONG_TEXT: 'Paragraph', CHOICE: 'One choice', MULTI_CHOICE: 'Many choices', NUMBER: 'Number', YES_NO: 'Yes / No' };

/** Capacity line for a card: '12 seats left' / '3 team places left' / '4 slots open' (null when unknown). */
export const capacityLine = (e: Pick<EventCard, 'capacity' | 'format' | 'slotsAvailable'>): string | null => {
  if (e.format === 'SLOT') {
    if (e.slotsAvailable === null || e.slotsAvailable === undefined) return null;
    return e.slotsAvailable > 0 ? `${e.slotsAvailable} slot${e.slotsAvailable === 1 ? '' : 's'} open` : 'All slots full';
  }
  const c = e.capacity;
  if (!c || c.remaining === undefined || !c.capacity) return null;
  const unit = c.kind === 'TEAMS' ? 'team place' : 'seat';
  return c.remaining > 0 ? `${c.remaining} ${unit}${c.remaining === 1 ? '' : 's'} left` : `${c.kind === 'TEAMS' ? 'All team places' : 'All seats'} taken`;
};

/** Friendly copy for known error codes (falls back to the server's own message). */
export const errorCopy = (e: any): { title: string; message: string } => {
  const code = e?.code;
  const msg = e?.message || 'Please try again.';
  const t = (title: string) => ({ title, message: msg });
  switch (code) {
    case 'FEATURE_OFF': return t('Campus Events is not open yet');
    case 'EVENT_FULL': return t('Event full');
    case 'SLOT_FULL': return t('Slot just filled up');
    case 'HOLD_EXPIRED': return t('Hold expired');
    case 'OFFER_EXPIRED': return t('Offer expired');
    case 'BOOKING_LIMIT': return t('Booking limit reached');
    case 'ALREADY_REGISTERED': return t('Already registered');
    case 'REGISTRATION_CLOSED': return t('Registration closed');
    case 'REGISTRATION_NOT_OPEN': return t('Registration not open yet');
    case 'SLOT_CLOSED': return t('Slot unavailable');
    case 'EVENT_CANCELLED': return t('Event cancelled');
    case 'NOT_ELIGIBLE': return t('Not eligible');
    case 'VERIFICATION_REQUIRED': return t('Verify your college first');
    case 'RULES_NOT_ACCEPTED': return t('Accept the rules');
    case 'RULES_CHANGED': return t('Rules updated');
    case 'ANSWER_REQUIRED':
    case 'INVALID_ANSWER': return t('Check your answers');
    case 'TOO_MANY_UNPAID': return t('Too many unpaid reservations');
    case 'PAYMENT_MODE_NOT_OFFERED':
    case 'PAYMENT_METHOD_OFF':
    case 'PAYMENT_NOT_CONFIGURED': return t('Payment option unavailable');
    case 'INSUFFICIENT_WALLET': return t('Not enough wallet balance');
    case 'CANCEL_WINDOW_CLOSED': return t('Cancellation window closed');
    case 'ALREADY_CHECKED_IN': return t('Already checked in');
    case 'TEAM_FULL': return t('Team is full');
    case 'TEAM_TOO_SMALL': return t('Team too small');
    case 'TEAM_TOO_BIG': return t('Team too big');
    case 'TEAM_NAME_TAKEN': return t('Name taken');
    case 'ALREADY_IN_TEAM': return t('Already in a team');
    case 'ALREADY_INVITED': return t('Already invited');
    case 'ALREADY_MEMBER': return t('Already in your team');
    case 'INVITEE_NOT_ELIGIBLE':
    case 'MEMBER_NOT_ELIGIBLE': return t('Player not eligible');
    case 'INVITATION_EXPIRED':
    case 'INVITATION_CLOSED': return t('Invitation closed');
    case 'INVALID_LINK': return t('Link not valid');
    case 'SUBSTITUTIONS_OFF': return t('Roster locked');
    case 'CAPTAIN_MUST_TRANSFER': return t('Hand over captaincy first');
    case 'NOT_CAPTAIN': return t('Captain only');
    case 'TICKETS_NOT_CONFIGURED': return t('Tickets unavailable');
    case 'NOT_ORGANIZER': return t('Organizers only');
    case 'NOT_EVENT_STAFF': return t('Not check-in staff');
    case 'INCOMPLETE': return t('Almost there');
    case 'QUESTION_NOT_ALLOWED': return t('Question not allowed');
    case 'INVALID_MEDIA': return t('Upload the poster again');
    case 'RATE_LIMITED': return { title: 'Too many tries', message: 'Wait a moment and try again.' };
    case 'IDEMPOTENCY_KEY_REUSED': return t('Please try again');
    case 'NETWORK':
    case 'SERVER_BUSY': return t('Connection problem');
    default: return t('Could not complete');
  }
};

/** Reason codes from the server (eligibility.js REASON_MESSAGES) needing the verification screen. */
export const needsVerification = (e: any) => ['VERIFICATION_REQUIRED', 'CAMPUS_REQUIRED'].includes(e?.code) || ['VERIFICATION_REQUIRED', 'CAMPUS_REQUIRED'].includes(e?.data?.reason);
