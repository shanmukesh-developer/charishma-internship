// Zenvy Rentals (peer-to-peer student vehicle rentals): shared enums and limits.

const VEHICLE_TYPES = ['BIKE', 'SCOOTER', 'CAR'];
const FUELS = ['PETROL', 'DIESEL', 'EV', 'CNG'];
const TRANSMISSIONS = ['MANUAL', 'AUTOMATIC'];
const PLATE_TYPES = ['COMMERCIAL_RENTAL', 'PRIVATE'];

/**
 * C7 wording (owner decision 16 Oct): one model, two words. A COMMERCIAL (yellow / black) plate vehicle
 * is RENTED (rent, renter, owner); a PRIVATE (white) plate vehicle is BORROWED between students on a
 * non-commercial basis (borrow, borrower, lender, cost share). Unknown / missing plate type -> BORROW,
 * the non-commercial (more careful) wording.
 */
const RENTAL_MODES = { RENT: 'RENT', BORROW: 'BORROW' };
const rentalMode = (plateType) => (String(plateType || '').toUpperCase() === 'COMMERCIAL_RENTAL' ? RENTAL_MODES.RENT : RENTAL_MODES.BORROW);
const MODE_WORDS = Object.freeze({
  RENT: Object.freeze({ verb: 'Rent', noun: 'rental', giver: 'owner', taker: 'renter', price: 'rent', Giver: 'Owner', Taker: 'Renter', Price: 'Rent', request: 'rental request', Request: 'Rental request', booking: 'rental' }),
  BORROW: Object.freeze({ verb: 'Borrow', noun: 'borrowing', giver: 'lender', taker: 'borrower', price: 'cost share', Giver: 'Lender', Taker: 'Borrower', Price: 'Cost share', request: 'borrow request', Request: 'Borrow request', booking: 'borrowing' }),
});
const wordsFor = (mode) => MODE_WORDS[mode === RENTAL_MODES.RENT ? 'RENT' : 'BORROW'];

/** Version of the per-booking terms (bump when TERMS text in services/safety.js changes). */
const TERMS_VERSION = 'C7-2026-10-18';

/** Extra-charges claim on a completed trip (C7): the renter / borrower accepts or disputes within 48 h. */
const CHARGES_STATUS = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  AUTO_ACCEPTED: 'AUTO_ACCEPTED',
  DISPUTED: 'DISPUTED',
  UPHELD: 'UPHELD',
  REDUCED: 'REDUCED',
  VOIDED: 'VOIDED',
};
const CONDITION_STAGES = ['PICKUP', 'RETURN'];

const LISTING_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DELETED: 'DELETED',
};

const BOOKING_STATUS = {
  REQUESTED: 'REQUESTED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  ACTIVE: 'ACTIVE',
  RETURNED: 'RETURNED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};
// Bookings that hold the vehicle's time slot.
const HOLDING_STATUSES = [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.ACTIVE];
// Bookings in which the two students may see each other's phone number (and the renter the full plate).
const CONTACT_STATUSES = [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.ACTIVE, BOOKING_STATUS.RETURNED];
const OPEN_STATUSES = [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.ACTIVE, BOOKING_STATUS.RETURNED];

const LICENCE_STATUS = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' };
// Indian driving licence classes we understand (Form 7 / Sarathi).
const LICENCE_CLASSES = ['MCWG', 'MCWOG', 'LMV', 'LMV-NT', 'TRANS'];

const REPORT_CATEGORIES = ['DAMAGE', 'NO_SHOW', 'LATE_RETURN', 'SAFETY', 'PAYMENT', 'OTHER'];
const REPORT_STATUS = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'];

const LIMITS = {
  MAX_PHOTOS: 6,
  MIN_PHOTOS: 1,
  MAX_PRICE_PER_HOUR: 5000,
  MAX_PRICE_PER_DAY: 50000,
  MAX_DEPOSIT: 200000,
  MAX_MIN_HOURS: 72,
  MAX_KM_PER_DAY: 2000,
  MAX_EXTRA_PER_KM: 500,
  MAX_BOOKING_DAYS: 30,
  MAX_ADVANCE_DAYS: 60,
  /** A request must start at least this far in the future (minutes). */
  MIN_LEAD_MINUTES: 15,
  /** Owner must answer within this long (or before the start, whichever is first). */
  RESPOND_WINDOW_MS: 2 * 60 * 60 * 1000,
  /** RETURNED bookings the owner never closes are completed automatically after this long. */
  AUTO_COMPLETE_MS: 24 * 60 * 60 * 1000,
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCK_MS: 15 * 60 * 1000,
  MAX_BLOCKED_RANGES: 30,
  MAX_OPEN_REQUESTS_PER_RENTER: 5,
  /** C7 condition photos at pickup / return. */
  MIN_CONDITION_PHOTOS: 2,
  MAX_CONDITION_PHOTOS: 6,
  MAX_ODOMETER: 9999999,
  /** C7 evidence photos for an extra-charges claim / dispute. */
  MAX_EVIDENCE_PHOTOS: 4,
  /** C7 defaults (admin Rentals > Settings can change them). */
  DEFAULT_OTHER_CHARGES_CAP: 5000,
  DEFAULT_CHARGES_RESPONSE_HOURS: 48,
};

module.exports = {
  VEHICLE_TYPES,
  FUELS,
  TRANSMISSIONS,
  PLATE_TYPES,
  RENTAL_MODES,
  rentalMode,
  MODE_WORDS,
  wordsFor,
  TERMS_VERSION,
  CHARGES_STATUS,
  CONDITION_STAGES,
  LISTING_STATUS,
  BOOKING_STATUS,
  HOLDING_STATUSES,
  CONTACT_STATUSES,
  OPEN_STATUSES,
  LICENCE_STATUS,
  LICENCE_CLASSES,
  REPORT_CATEGORIES,
  REPORT_STATUS,
  LIMITS,
};
