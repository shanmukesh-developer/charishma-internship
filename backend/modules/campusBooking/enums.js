// In-Campus Booking (27 Oct 2026): students book a campus stall's items, pay the stall DIRECTLY by UPI
// (ZCS never holds the money: no gateway, no wallet), upload proof, the stall verifies and prepares the
// order, and the student collects it at the counter with a 4-character pickup code.
// Pickup only: delivery slots (utils/deliverySlots) never apply; these orders live in their own table
// (CampusBookings) so no delivery job, rider pool, payout or commission backfill ever sees them.

const STATUS = Object.freeze({
  PAYMENT_PENDING: 'PAYMENT_PENDING', // booked, the student has not sent payment proof yet
  PAYMENT_REVIEW: 'PAYMENT_REVIEW', // proof sent, the stall checks its UPI app
  ACCEPTED: 'ACCEPTED', // payment confirmed by the stall, order accepted
  PREPARING: 'PREPARING',
  READY: 'READY', // ready for pickup at the counter
  COLLECTED: 'COLLECTED', // handed over (pickup code checked by the stall)
  REJECTED: 'REJECTED', // the stall could not find the payment: the student re-sends proof or cancels
  CANCELLED: 'CANCELLED',
});

// Who may move a booking from one status to the next. Everything else is refused (409 BAD_TRANSITION).
// ACCEPTED -> READY is allowed (a quick item is ready at once); preparingAt is stamped on the way.
// ACCEPTED / PREPARING -> COLLECTED: the student is already at the counter with the code; the code is checked first
// (services/bookings.vendorCollect), so a wrong code never marks the order ready or tells the student it is.
const TRANSITIONS = Object.freeze({
  PAYMENT_PENDING: { PAYMENT_REVIEW: ['student'], CANCELLED: ['student', 'system'] },
  PAYMENT_REVIEW: { ACCEPTED: ['vendor'], REJECTED: ['vendor'], CANCELLED: ['vendor'] },
  REJECTED: { PAYMENT_REVIEW: ['student'], CANCELLED: ['student', 'system'] },
  ACCEPTED: { PREPARING: ['vendor'], READY: ['vendor'], COLLECTED: ['vendor'], CANCELLED: ['vendor'] },
  PREPARING: { READY: ['vendor'], COLLECTED: ['vendor'], CANCELLED: ['vendor'] },
  READY: { COLLECTED: ['vendor'], CANCELLED: ['vendor'] },
  COLLECTED: {},
  CANCELLED: {},
});

const canTransition = (from, to, actor) => {
  const next = TRANSITIONS[from] || {};
  return Array.isArray(next[to]) && next[to].includes(actor);
};

const OPEN_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_REVIEW', 'REJECTED', 'ACCEPTED', 'PREPARING', 'READY'];
const FINAL_STATUSES = ['COLLECTED', 'CANCELLED'];
// Payment confirmed by the stall (counts for earnings while not cancelled).
const PAID_STATUSES = ['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'];

// ZCS commission on every booking (owner, 27 Oct): 1.5 % of the item total, recorded per booking.
// The student pays the full item price to the stall; there is no delivery or platform fee.
const COMMISSION_PCT = 1.5;

const LIMITS = Object.freeze({
  maxLines: 20,
  maxQtyPerLine: 10,
  // Stationery / print stalls sell per page: a 60-page print is one line of 60 (owner, 29 Oct: document uploads).
  maxQtyPerLineStationery: 200,
  maxDocuments: 5, // PDFs per booking (stationery / print stalls only)
  maxOpenPerStudent: 3, // open bookings (any stall) at a time
  proofMaxAttempts: 5, // proof submissions per booking (first + re-sends)
  pickupCodeMaxTries: 6, // wrong pickup codes before the stall must wait (per booking, rolling 15 min)
  paymentWindowMin: 20, // PAYMENT_PENDING without proof -> cancelled by the system
  rejectedWindowMin: 120, // REJECTED without a new proof -> cancelled by the system
  defaultPrepMin: 10,
  minPrepMin: 2,
  maxPrepMin: 90,
});

const REJECT_REASONS = Object.freeze({
  NOT_RECEIVED: 'Payment not received in the stall UPI account',
  AMOUNT_MISMATCH: 'The amount paid does not match the order total',
  UNCLEAR: 'The screenshot or reference could not be checked',
  OTHER: 'The stall could not verify this payment',
});
const CANCEL_REASONS = Object.freeze({
  OUT_OF_STOCK: 'An item is out of stock',
  CLOSING: 'The stall is closing',
  TOO_BUSY: 'The stall is too busy right now',
  NOT_COLLECTED: 'The order was not collected',
  OTHER: 'The stall cancelled this order',
});

// Student-facing labels (plain copy, no emoji).
const STATUS_LABEL = Object.freeze({
  PAYMENT_PENDING: 'Waiting for payment',
  PAYMENT_REVIEW: 'Payment under review',
  ACCEPTED: 'Order accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for pickup',
  COLLECTED: 'Collected',
  REJECTED: 'Payment not verified',
  CANCELLED: 'Cancelled',
});

// Category chips on the In-Campus Booking home (owner board: Food & Beverages, Snacks & Bakery, Stationery, More).
const CATEGORIES = Object.freeze([
  { key: 'food', label: 'Food & Beverages' },
  { key: 'snacks', label: 'Snacks & Bakery' },
  { key: 'stationery', label: 'Stationery' },
  { key: 'more', label: 'More' },
]);

module.exports = {
  STATUS, TRANSITIONS, canTransition, OPEN_STATUSES, FINAL_STATUSES, PAID_STATUSES, COMMISSION_PCT, LIMITS,
  REJECT_REASONS, CANCEL_REASONS, STATUS_LABEL, CATEGORIES,
};
