// Zenvy Auto-Ride (shared autos, seat booking, separate driver app): shared enums, the trip state
// machine table and limits. Capacity is NEVER assumed: every trip snapshots the capacity the admin
// approved for its vehicle (<= RC seating <= platform max, a setting that defaults to 8).

const DRIVER_STATUS = {
  PENDING_DOCS: 'PENDING_DOCS',
  PENDING_REVIEW: 'PENDING_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
};

const VEHICLE_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
};
// Registration numbers stay unique among these (a rejected row does not block a fresh submission).
const VEHICLE_LIVE_STATUSES = [VEHICLE_STATUS.PENDING_REVIEW, VEHICLE_STATUS.APPROVED, VEHICLE_STATUS.SUSPENDED];

const FUELS = ['CNG', 'PETROL', 'DIESEL', 'LPG', 'EV'];

const TRIP_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  OPEN_FOR_BOOKING: 'OPEN_FOR_BOOKING',
  DEPARTURE_THRESHOLD_REACHED: 'DEPARTURE_THRESHOLD_REACHED',
  FULL: 'FULL',
  DRIVER_CONFIRMED: 'DRIVER_CONFIRMED',
  BOARDING: 'BOARDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  DELAYED: 'DELAYED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  DRIVER_UNAVAILABLE: 'DRIVER_UNAVAILABLE',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
};
const T = TRIP_STATUS;

// Statuses that keep the vehicle (and the driver) busy: at most one such trip per vehicle / driver
// (partial unique indexes auto_trips_vehicle_one_active / auto_trips_driver_one_active).
const ACTIVE_TRIP_STATUSES = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL, T.DRIVER_CONFIRMED, T.BOARDING, T.IN_PROGRESS, T.DELAYED];
// New seat holds / private requests are accepted only here.
const BOOKABLE_STATUSES = [T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED];
// Shown to customers in browse / queue lists.
const LISTED_STATUSES = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL, T.DRIVER_CONFIRMED, T.BOARDING, T.DELAYED];
// Seat availability statuses the system moves between on its own (as seats are confirmed / freed).
const AVAILABILITY_STATUSES = [T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL];
// Before the driver has confirmed departure (customer cancellation with a full refund, driver no-show).
const PRE_DEPARTURE_STATUSES = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL, T.DELAYED];
const TERMINAL_TRIP_STATUSES = [T.COMPLETED, T.CANCELLED, T.NO_SHOW, T.DRIVER_UNAVAILABLE, T.VEHICLE_UNAVAILABLE];
const EXCEPTION_END_STATUSES = [T.CANCELLED, T.NO_SHOW, T.DRIVER_UNAVAILABLE, T.VEHICLE_UNAVAILABLE];

/**
 * The full transition table: from -> { to: [actors allowed] }. Actors: driver, system, admin.
 * Anything not listed is impossible and answered 409 INVALID_TRANSITION. DELAYED -> <resume> goes back
 * to the status stored in statusBeforeDelay (checked against this table too).
 */
const TRANSITIONS = {
  [T.DRAFT]: { [T.PUBLISHED]: ['driver'], [T.CANCELLED]: ['driver', 'admin'] },
  [T.PUBLISHED]: {
    [T.OPEN_FOR_BOOKING]: ['system', 'driver'],
    [T.DELAYED]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin', 'system'],
    [T.DRIVER_UNAVAILABLE]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
    [T.NO_SHOW]: ['system'],
  },
  [T.OPEN_FOR_BOOKING]: {
    [T.DEPARTURE_THRESHOLD_REACHED]: ['system'],
    [T.FULL]: ['system'],
    [T.DELAYED]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin', 'system'],
    [T.DRIVER_UNAVAILABLE]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
    [T.NO_SHOW]: ['system'],
  },
  [T.DEPARTURE_THRESHOLD_REACHED]: {
    [T.OPEN_FOR_BOOKING]: ['system'],
    [T.FULL]: ['system'],
    [T.DRIVER_CONFIRMED]: ['driver'],
    [T.DELAYED]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin', 'system'],
    [T.DRIVER_UNAVAILABLE]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
    [T.NO_SHOW]: ['system'],
  },
  [T.FULL]: {
    [T.OPEN_FOR_BOOKING]: ['system'],
    [T.DEPARTURE_THRESHOLD_REACHED]: ['system'],
    [T.DRIVER_CONFIRMED]: ['driver'],
    [T.DELAYED]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin', 'system'],
    [T.DRIVER_UNAVAILABLE]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
    [T.NO_SHOW]: ['system'],
  },
  [T.DRIVER_CONFIRMED]: {
    [T.BOARDING]: ['driver'],
    [T.DELAYED]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin'],
    [T.DRIVER_UNAVAILABLE]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
    [T.NO_SHOW]: ['system'],
  },
  [T.BOARDING]: {
    [T.IN_PROGRESS]: ['driver'],
    [T.DELAYED]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
  },
  [T.DELAYED]: {
    // resume targets (only the stored statusBeforeDelay is used)
    [T.PUBLISHED]: ['driver', 'system'],
    [T.OPEN_FOR_BOOKING]: ['driver', 'system'],
    [T.DEPARTURE_THRESHOLD_REACHED]: ['driver', 'system'],
    [T.FULL]: ['driver', 'system'],
    [T.DRIVER_CONFIRMED]: ['driver'],
    [T.BOARDING]: ['driver'],
    [T.CANCELLED]: ['driver', 'admin', 'system'],
    [T.DRIVER_UNAVAILABLE]: ['driver', 'admin'],
    [T.VEHICLE_UNAVAILABLE]: ['driver', 'admin'],
    [T.NO_SHOW]: ['system'],
  },
  [T.IN_PROGRESS]: { [T.COMPLETED]: ['driver', 'system', 'admin'] },
  [T.COMPLETED]: {},
  [T.CANCELLED]: {},
  [T.NO_SHOW]: {},
  [T.DRIVER_UNAVAILABLE]: {},
  [T.VEHICLE_UNAVAILABLE]: {},
};

const canTransition = (from, to, actor) => {
  const row = TRANSITIONS[from];
  if (!row || !row[to]) return false;
  return actor ? row[to].includes(actor) : true;
};

const STATUS_LABELS = {
  [T.DRAFT]: 'Draft',
  [T.PUBLISHED]: 'Published (booking opens soon)',
  [T.OPEN_FOR_BOOKING]: 'Open for booking',
  [T.DEPARTURE_THRESHOLD_REACHED]: 'Ready to depart (seats still open)',
  [T.FULL]: 'Full, waiting for driver confirmation',
  [T.DRIVER_CONFIRMED]: 'Driver confirmed departure',
  [T.BOARDING]: 'Boarding',
  [T.IN_PROGRESS]: 'Trip in progress',
  [T.COMPLETED]: 'Completed',
  [T.DELAYED]: 'Delayed',
  [T.CANCELLED]: 'Cancelled',
  [T.NO_SHOW]: 'Driver did not depart',
  [T.DRIVER_UNAVAILABLE]: 'Driver unavailable',
  [T.VEHICLE_UNAVAILABLE]: 'Vehicle unavailable',
};

const MODE = { SHARED: 'SHARED', PRIVATE: 'PRIVATE' };

const BOOKING_STATUS = {
  HELD: 'HELD',
  CONFIRMED: 'CONFIRMED',
  BOARDED: 'BOARDED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  NO_SHOW: 'NO_SHOW',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
};
const B = BOOKING_STATUS;
// Bookings that occupy seats.
const LIVE_BOOKING_STATUSES = [B.HELD, B.CONFIRMED, B.BOARDED];
// Seats that count as confirmed (FULL / threshold / earnings).
const CONFIRMED_BOOKING_STATUSES = [B.CONFIRMED, B.BOARDED];
// WALK_IN: one row per trip for people who sat in at the stand without the app. The driver adds / frees
// these seats (real AutoSeats rows, so an app student can never be sold a seat that is physically taken).
// userId is the driver's id (never a customer), amount 0 (the fare is paid to the driver directly).
const BOOKING_TYPE = { SHARED: 'SHARED', PRIVATE: 'PRIVATE', WALK_IN: 'WALK_IN' };

// Union queue ("on charge"). SCHEDULED (or null on older rows) = the published-departure trips.
// ON_CHARGE = the driver put the auto in line at a stand: autos at one pickup point (= one route) form a
// line in check-in order, only the FRONT auto is ON_CHARGE and takes bookings, the rest are WAITING.
// When the front fills, departs, is cancelled or unavailable it becomes DONE and the next auto moves up.
const DISPATCH_MODE = { SCHEDULED: 'SCHEDULED', ON_CHARGE: 'ON_CHARGE' };
const QUEUE_STATE = { WAITING: 'WAITING', ON_CHARGE: 'ON_CHARGE', DONE: 'DONE' };
// Walk-in seats can be changed while the auto is at the stand (waiting, on charge, departing, boarding).

const WALK_IN_STATUSES = [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL, T.DRIVER_CONFIRMED, T.BOARDING];

const SEAT_STATUS = { HELD: 'HELD', CONFIRMED: 'CONFIRMED', BOARDED: 'BOARDED', RELEASED: 'RELEASED' };
const LIVE_SEAT_STATUSES = [SEAT_STATUS.HELD, SEAT_STATUS.CONFIRMED, SEAT_STATUS.BOARDED];

const PAYMENT_METHODS = { CASH: 'CASH', WALLET: 'WALLET' };
const PAYMENT_STATUS = {
  NONE: 'NONE', // hold, nothing paid
  CASH_DUE: 'CASH_DUE', // pay the driver in cash at boarding
  CASH_COLLECTED: 'CASH_COLLECTED', // driver recorded the cash at check-in
  PAID: 'PAID', // Zenvy Wallet debited at confirmation
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  NOT_REFUNDED: 'NOT_REFUNDED', // cancelled under a 0 % refund rule
};

const PRIVATE_STATUS = {
  REQUESTED: 'REQUESTED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CONFLICT: 'CONFLICT',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

const INCIDENT_CATEGORIES = ['SAFETY', 'HARASSMENT', 'OVERCHARGE', 'RASH_DRIVING', 'NO_SHOW', 'VEHICLE_ISSUE', 'PAYMENT', 'LOST_ITEM', 'OTHER'];
const INCIDENT_STATUS = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'];
const INCIDENT_PRIORITY = { NORMAL: 'NORMAL', HIGH: 'HIGH' };
const HIGH_PRIORITY_CATEGORIES = ['SAFETY', 'HARASSMENT'];

// Driver documents (private media, purpose auto_driver_doc). No Aadhaar images are ever collected.
const DRIVER_DOC_KEYS = ['photo', 'licenceFront', 'licenceBack', 'badge', 'policeVerification'];
const REQUIRED_DRIVER_DOCS = ['photo', 'licenceFront', 'licenceBack'];
const VEHICLE_DOC_KEYS = ['rc', 'permit', 'insurance', 'fitness', 'puc'];
const REQUIRED_VEHICLE_DOCS = ['rc', 'permit', 'insurance'];

const LIMITS = {
  /** Hard ceiling for the admin-set platform max (the setting itself defaults to 8). */
  ABSOLUTE_MAX_CAPACITY: 12,
  MAX_SEATS_PER_BOOKING_DEFAULT: 4,
  MAX_FARE: 5000,
  MAX_FULL_FARE: 20000,
  /** Full-auto extra charges: at most this, and never more than the full-auto fare itself. */
  MAX_EXTRA_CHARGES: 2000,
  MAX_DELAY_MINUTES: 120,
  MIN_LEAD_MINUTES: 2,
  MAX_VEHICLE_PHOTOS: 4,
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCK_MS: 15 * 60 * 1000,
  MAX_OPEN_HOLDS_PER_USER: 3,
  MAX_OPEN_PRIVATE_REQUESTS_PER_USER: 3,
  MAX_LAYOUT_ROWS: 6,
  MAX_LAYOUT_COLS: 5,
};

const DEFAULT_SETTINGS = {
  platformMaxCapacity: 8,
  holdMinutes: 5,
  privateRespondMinutes: 10,
  maxSeatsPerBooking: LIMITS.MAX_SEATS_PER_BOOKING_DEFAULT,
  maxAdvanceDays: 7,
  reminderMinutes: 15,
  noShowGraceMinutes: 30,
  autoCompleteHours: 6,
  // Refund policy (WALLET bookings): driver / admin / system cancellations are always 100 %.
  customerRefundBeforeConfirmPct: 100,
  customerRefundAfterConfirmPct: 0,
  // Union queue: an auto on charge (or waiting in line) that has not left after this many hours is closed by
  // the lifecycle job (every booking refunded in full), so a forgotten auto never blocks the line.
  chargeMaxHours: 6,
};

module.exports = {
  DRIVER_STATUS,
  VEHICLE_STATUS,
  VEHICLE_LIVE_STATUSES,
  FUELS,
  TRIP_STATUS,
  ACTIVE_TRIP_STATUSES,
  BOOKABLE_STATUSES,
  LISTED_STATUSES,
  AVAILABILITY_STATUSES,
  PRE_DEPARTURE_STATUSES,
  TERMINAL_TRIP_STATUSES,
  EXCEPTION_END_STATUSES,
  TRANSITIONS,
  canTransition,
  STATUS_LABELS,
  MODE,
  BOOKING_STATUS,
  LIVE_BOOKING_STATUSES,
  CONFIRMED_BOOKING_STATUSES,
  BOOKING_TYPE,
  DISPATCH_MODE,
  QUEUE_STATE,
  WALK_IN_STATUSES,
  SEAT_STATUS,
  LIVE_SEAT_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PRIVATE_STATUS,
  INCIDENT_CATEGORIES,
  INCIDENT_STATUS,
  INCIDENT_PRIORITY,
  HIGH_PRIORITY_CATEGORIES,
  DRIVER_DOC_KEYS,
  REQUIRED_DRIVER_DOCS,
  VEHICLE_DOC_KEYS,
  REQUIRED_VEHICLE_DOCS,
  LIMITS,
  DEFAULT_SETTINGS,
};
