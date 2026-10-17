// Zenvy Campus Events: every status / type / limit in one place (server is the only source of truth).
// Table names use the Ce* prefix: the old `CampusEvent` table ("Today on Campus", modules/campus/models/
// Pulse.js) is a different feature and is never touched.

const EVENT_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  REJECTED: 'REJECTED',
  // Approved by an admin, waiting for publishAt (scheduled publish).
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  UNPUBLISHED: 'UNPUBLISHED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
};
const EDITABLE_EVENT_STATUSES = [EVENT_STATUS.DRAFT, EVENT_STATUS.CHANGES_REQUESTED, EVENT_STATUS.REJECTED];
const LIVE_EVENT_STATUSES = [EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED, EVENT_STATUS.UNPUBLISHED];
// Events whose gate can be staffed: approved-but-scheduled (APPROVED, waiting for publishAt), live, and
// just-finished ones (the check-in list keeps them for 24 h after the end).
const CHECKIN_EVENT_STATUSES = [EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED, EVENT_STATUS.UNPUBLISHED, EVENT_STATUS.COMPLETED];

const CATEGORIES = ['SPORTS', 'TOURNAMENT', 'CLUB', 'WORKSHOP', 'SEMINAR', 'TALK', 'COMPETITION', 'HACKATHON', 'CULTURAL', 'RECREATION', 'OTHER'];
const CATEGORY_LABELS = {
  SPORTS: 'Sports', TOURNAMENT: 'Tournament', CLUB: 'Club activity', WORKSHOP: 'Workshop', SEMINAR: 'Seminar', TALK: 'Talk',
  COMPETITION: 'Competition', HACKATHON: 'Hackathon', CULTURAL: 'Cultural', RECREATION: 'Recreational', OTHER: 'Other',
};
const CATEGORY_ICONS = {
  SPORTS: '⚽', TOURNAMENT: '🏆', CLUB: '🎯', WORKSHOP: '🛠️', SEMINAR: '🎤', TALK: '💬',
  COMPETITION: '🥇', HACKATHON: '💻', CULTURAL: '🎭', RECREATION: '🎮', OTHER: '✨',
};
/** Fixed category list for pickers / filters (GET /categories on the student + admin routers). */
const categoryList = () => CATEGORIES.map((key) => {
  const section = SECTIONS.find((s) => s.categories.includes(key));
  return { key, label: CATEGORY_LABELS[key], icon: CATEGORY_ICONS[key], section: section ? section.key : null };
});
// Landing sections (spec §1) -> categories.
const SECTIONS = [
  { key: 'sports', label: 'Sports & tournaments', categories: ['SPORTS', 'TOURNAMENT'] },
  { key: 'clubs', label: 'Club activities', categories: ['CLUB', 'CULTURAL'] },
  { key: 'workshops', label: 'Workshops & seminars', categories: ['WORKSHOP', 'SEMINAR', 'TALK'] },
  { key: 'competitions', label: 'Competitions & hackathons', categories: ['COMPETITION', 'HACKATHON'] },
  { key: 'recreational', label: 'Recreational', categories: ['RECREATION', 'OTHER'] },
];

const FORMAT = { INDIVIDUAL: 'INDIVIDUAL', SLOT: 'SLOT', TEAM: 'TEAM' };
const PRICE_TYPE = { FREE: 'FREE', PAID: 'PAID' };

const REG_STATUS = {
  HELD: 'HELD',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  CONFIRMED: 'CONFIRMED',
  WAITLISTED: 'WAITLISTED',
  OFFERED: 'OFFERED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
};
// Statuses that occupy a capacity unit (unitNo is set and unique per capacityKey).
const LIVE_REG_STATUSES = [REG_STATUS.HELD, REG_STATUS.PENDING_PAYMENT, REG_STATUS.PENDING_APPROVAL, REG_STATUS.CONFIRMED, REG_STATUS.OFFERED];
// Live + waiting: one per student per capacity key (no duplicate same-slot / same-event registration).
const OPEN_REG_STATUSES = [...LIVE_REG_STATUSES, REG_STATUS.WAITLISTED];
const ENDED_REG_STATUSES = [REG_STATUS.CANCELLED, REG_STATUS.EXPIRED, REG_STATUS.REJECTED];
const REG_TYPE = { INDIVIDUAL: 'INDIVIDUAL', SLOT: 'SLOT', TEAM: 'TEAM' };

const PAYMENT_MODE = { NONE: 'NONE', VENUE: 'VENUE', WALLET: 'WALLET', ONLINE: 'ONLINE' };
const PAID_MODES = [PAYMENT_MODE.VENUE, PAYMENT_MODE.WALLET, PAYMENT_MODE.ONLINE];
const PAYMENT_STATUS = {
  NONE: 'NONE',
  DUE_AT_VENUE: 'DUE_AT_VENUE',
  PAID_AT_VENUE: 'PAID_AT_VENUE',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
};

const TEAM_STATUS = { FORMING: 'FORMING', SUBMITTED: 'SUBMITTED', CANCELLED: 'CANCELLED' };
const MEMBER_STATUS = {
  INVITED: 'INVITED', ACCEPTED: 'ACCEPTED', DECLINED: 'DECLINED', REVOKED: 'REVOKED', REMOVED: 'REMOVED', LEFT: 'LEFT', EXPIRED: 'EXPIRED',
};
const OPEN_MEMBER_STATUSES = [MEMBER_STATUS.INVITED, MEMBER_STATUS.ACCEPTED];
const MEMBER_ROLE = { CAPTAIN: 'CAPTAIN', PLAYER: 'PLAYER' };

const TICKET_KIND = { INDIVIDUAL: 'INDIVIDUAL', SLOT: 'SLOT', TEAM: 'TEAM', MEMBER: 'MEMBER' };
const TICKET_STATUS = { ACTIVE: 'ACTIVE', USED: 'USED', CANCELLED: 'CANCELLED', VOID: 'VOID' };
const LIVE_TICKET_STATUSES = [TICKET_STATUS.ACTIVE, TICKET_STATUS.USED];

const CHECKIN_RESULT = {
  VALID: 'VALID', ALREADY_USED: 'ALREADY_USED', CANCELLED: 'CANCELLED', INVALID: 'INVALID', NOT_YET_VALID: 'NOT_YET_VALID',
  EXPIRED: 'EXPIRED', WRONG_EVENT: 'WRONG_EVENT', UNPAID: 'UNPAID', PENDING: 'PENDING', PAYMENT_DUE: 'PAYMENT_DUE',
};
const CHECKIN_LABELS = {
  VALID: 'Valid: admit', ALREADY_USED: 'Already used: do not admit', CANCELLED: 'Cancelled: do not admit', INVALID: 'Invalid ticket: do not admit',
  NOT_YET_VALID: 'Not yet valid: entry has not opened', EXPIRED: 'Event is over: do not admit', WRONG_EVENT: 'Ticket is for another event',
  UNPAID: 'Payment not completed: do not admit', PENDING: 'Registration not confirmed: do not admit', PAYMENT_DUE: 'Collect the fee before admitting',
};

const ORGANIZER_STATUS = { PENDING: 'PENDING', ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', REVOKED: 'REVOKED', REJECTED: 'REJECTED' };
const STAFF_STATUS = { ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' };

const PAYMENT_PROVIDER = { RAZORPAY: 'RAZORPAY', WALLET: 'WALLET', VENUE: 'VENUE' };
const PAY_ROW_STATUS = { CREATED: 'CREATED', SUCCESS: 'SUCCESS', FAILED: 'FAILED', REFUND_PENDING: 'REFUND_PENDING', REFUNDED: 'REFUNDED' };

const ANNOUNCEMENT_KIND = { UPDATE: 'UPDATE', VENUE_CHANGE: 'VENUE_CHANGE', SCHEDULE_CHANGE: 'SCHEDULE_CHANGE', CANCELLATION: 'CANCELLATION' };

const QUESTION_TYPES = ['TEXT', 'LONG_TEXT', 'CHOICE', 'MULTI_CHOICE', 'NUMBER', 'YES_NO'];

// Fields an organizer may change on a live (approved / published) event without a new review.
const COSMETIC_FIELDS = ['description', 'posterPath', 'gallery', 'equipment', 'contactText', 'instructions', 'tags', 'venueDirections'];
// Everything else that matters for registrants goes to pendingChanges for admin approval.
const MATERIAL_FIELDS = ['title', 'category', 'venue', 'venueLat', 'venueLon', 'startAt', 'endAt', 'regOpensAt', 'regClosesAt', 'capacity', 'maxTeams',
  'teamMin', 'teamMax', 'captainRequired', 'allowSubstitutions', 'multiTeamAllowed', 'attendancePerMember', 'approvalRequired',
  'maxBookingsPerStudent', 'minParticipants', 'priceType', 'price', 'extraCharges', 'paymentModes', 'eligibility', 'rules', 'questions',
  'cancellationPolicy', 'entryOpensBeforeMin', 'waitlistEnabled', 'waitlistOfferMinutes'];

const DEFAULT_SETTINGS = {
  holdMinutes: 10,
  paymentMinutes: 15,
  waitlistOfferMinutes: 120,
  maxUnpaidVenueReservations: 3,
  defaultUserCancelUntilHours: 24,
  defaultRefundPct: 100,
  inviteExpiryHours: 72,
  joinLinkDays: 7,
  announcementsPerDay: 5,
  retentionDays: 180,
  maxPrice: 5000,
  maxCapacity: 5000,
  entryOpensBeforeMin: 60,
};

const LIMITS = {
  TITLE: 120, DESCRIPTION: 5000, VENUE: 160, RULES: 5000, TEXT: 1000, QUESTIONS: 10, QUESTION_LABEL: 200, ANSWER: 1000, OPTIONS: 20,
  GALLERY: 6, TAGS: 10, TEAM_NAME: 40, ANNOUNCEMENT_TITLE: 120, ANNOUNCEMENT_BODY: 1500, REASON: 500, ABSOLUTE_MAX_TEAM: 50,
};

const NOTIFY = {
  REGISTRATION_CONFIRMED: 'CE_REGISTRATION_CONFIRMED',
  REGISTRATION_PENDING_APPROVAL: 'CE_REGISTRATION_PENDING',
  REGISTRATION_APPROVED: 'CE_REGISTRATION_APPROVED',
  REGISTRATION_REJECTED: 'CE_REGISTRATION_REJECTED',
  REGISTRATION_CANCELLED: 'CE_REGISTRATION_CANCELLED',
  PAYMENT_CONFIRMED: 'CE_PAYMENT_CONFIRMED',
  PAYMENT_FAILED: 'CE_PAYMENT_FAILED',
  PAYMENT_EXPIRED: 'CE_PAYMENT_EXPIRED',
  HOLD_EXPIRED: 'CE_HOLD_EXPIRED',
  WAITLISTED: 'CE_WAITLISTED',
  WAITLIST_PROMOTED: 'CE_WAITLIST_PROMOTED',
  WAITLIST_OFFER: 'CE_WAITLIST_OFFER',
  OFFER_EXPIRED: 'CE_OFFER_EXPIRED',
  TEAM_INVITATION: 'CE_TEAM_INVITATION',
  TEAM_INVITE_ACCEPTED: 'CE_TEAM_INVITE_ACCEPTED',
  TEAM_INVITE_DECLINED: 'CE_TEAM_INVITE_DECLINED',
  TEAM_REGISTERED: 'CE_TEAM_REGISTERED',
  TEAM_ROSTER_CHANGED: 'CE_TEAM_ROSTER_CHANGED',
  EVENT_APPROVED: 'CE_EVENT_APPROVED',
  EVENT_REJECTED: 'CE_EVENT_REJECTED',
  EVENT_CHANGES_REQUESTED: 'CE_EVENT_CHANGES_REQUESTED',
  EVENT_PUBLISHED: 'CE_EVENT_PUBLISHED',
  EVENT_CANCELLED: 'CE_EVENT_CANCELLED',
  VENUE_CHANGED: 'CE_VENUE_CHANGED',
  SCHEDULE_CHANGED: 'CE_SCHEDULE_CHANGED',
  SLOT_CHANGED: 'CE_SLOT_CHANGED',
  ANNOUNCEMENT: 'CE_ANNOUNCEMENT',
  REMINDER_24H: 'CE_REMINDER_24H',
  REMINDER_1H: 'CE_REMINDER_1H',
  DEADLINE_SOON: 'CE_DEADLINE_SOON',
  REFUND_DONE: 'CE_REFUND_DONE',
  REFUND_PENDING: 'CE_REFUND_PENDING',
  TICKET_AVAILABLE: 'CE_TICKET_AVAILABLE',
  ORGANIZER_APPROVED: 'CE_ORGANIZER_APPROVED',
  ORGANIZER_SUSPENDED: 'CE_ORGANIZER_SUSPENDED',
  CHANGES_APPROVED: 'CE_CHANGES_APPROVED',
};

module.exports = {
  EVENT_STATUS, EDITABLE_EVENT_STATUSES, LIVE_EVENT_STATUSES, CHECKIN_EVENT_STATUSES, CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, categoryList, SECTIONS, FORMAT, PRICE_TYPE,
  REG_STATUS, LIVE_REG_STATUSES, OPEN_REG_STATUSES, ENDED_REG_STATUSES, REG_TYPE, PAYMENT_MODE, PAID_MODES, PAYMENT_STATUS,
  TEAM_STATUS, MEMBER_STATUS, OPEN_MEMBER_STATUSES, MEMBER_ROLE, TICKET_KIND, TICKET_STATUS, LIVE_TICKET_STATUSES,
  CHECKIN_RESULT, CHECKIN_LABELS, ORGANIZER_STATUS, STAFF_STATUS, PAYMENT_PROVIDER, PAY_ROW_STATUS, ANNOUNCEMENT_KIND,
  QUESTION_TYPES, COSMETIC_FIELDS, MATERIAL_FIELDS, DEFAULT_SETTINGS, LIMITS, NOTIFY,
};
