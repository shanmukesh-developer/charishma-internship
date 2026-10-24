// Seat layouts (top-down, rows front to back) and the front-seat rule.
//   { rows: [[1, 'D', 2], [3, 4, 5], [6, 7, 8]], maleOnlySeats: [1, 2] }
// 'D' = driver seat (never bookable; 'DRIVER' is accepted on input and stored as 'D'), null = gap,
// numbers = passenger seats 1..capacity, each once. maleOnlySeats = seats only boys may book in the app
// (the seats beside the driver on the front bench: "girls can't sit like that"). Walk-ins are not covered:
// the driver decides physically.
// The admin sets / confirms the layout at vehicle approval; trips snapshot it at publish (like capacity).
// Rows stored before this rule (no maleOnlySeats, or the old generated ['D', 1] | 3 | 4 arrangement) are read
// through normalizeLayout(), so every vehicle and trip gets the real layout and the rule.
const { fail } = require('./util');
const { LIMITS } = require('../enums');

const DRIVER = 'D';
const MALE = 'Male';
const FRONT_SEAT_MESSAGE = 'Seats beside the driver are for boys only. Please pick a seat in the back rows.';

/** The real ZCS shared auto: seat 1 | driver | seat 2, then 3 4 5, then 6 7 8. */
const auto8 = () => ({ rows: [[1, DRIVER, 2], [3, 4, 5], [6, 7, 8]], maleOnlySeats: [1, 2] });

/** Generic arrangement for other capacities: driver row (+1 seat beside the driver when capacity >= 4), benches of <= 4. */
const genericRows = (capacity) => {
  const cap = Math.max(1, Math.min(LIMITS.ABSOLUTE_MAX_CAPACITY, Number(capacity) || 1));
  const front = cap >= 4 ? 1 : 0;
  const rows = [front ? [DRIVER, 1] : [DRIVER]];
  const rem = cap - front;
  const benches = Math.max(1, Math.ceil(rem / 4));
  let next = front + 1;
  for (let b = 0; b < benches; b++) {
    const left = cap - next + 1;
    const size = Math.floor(left / (benches - b)) || left;
    const row = [];
    for (let i = 0; i < size && next <= cap; i++) row.push(next++);
    if (row.length) rows.push(row);
  }
  return rows;
};

/** Passenger seats on the same bench as the driver (the seats beside the driver). */
const seatsBesideDriver = (rows) => {
  const row = (rows || []).find((r) => Array.isArray(r) && r.includes(DRIVER));
  return row ? row.filter((c) => typeof c === 'number').sort((a, b) => a - b) : [];
};

const seatsIn = (rows) => rows.flat().filter((c) => typeof c === 'number');

/** Default layout of a capacity: the real 8-seat auto, else the generic benches; seats beside the driver are boys only. */
const defaultLayout = (capacity) => {
  if (Number(capacity) === 8) return auto8();
  const rows = genericRows(capacity);
  return { rows, maleOnlySeats: seatsBesideDriver(rows) };
};

const sameRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The layout as every reader must use it: missing -> the default; 'DRIVER' -> 'D'; a row set stored before the
 * rule (no maleOnlySeats) -> the old generated 8-seat arrangement becomes the real one, any other gets the seats
 * beside the driver as boys only. maleOnlySeats only ever names seats that are in the rows.
 */
const normalizeLayout = (layout, capacity) => {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.rows) || !layout.rows.length) return defaultLayout(capacity);
  const rows = layout.rows.map((r) => (Array.isArray(r) ? r.map((c) => (c === 'DRIVER' ? DRIVER : c)) : []));
  const count = seatsIn(rows).length;
  if (!Array.isArray(layout.maleOnlySeats)) {
    if (sameRows(rows, genericRows(count))) return defaultLayout(count);
    return { rows, maleOnlySeats: seatsBesideDriver(rows) };
  }
  const present = new Set(seatsIn(rows));
  const male = [...new Set(layout.maleOnlySeats.map(Number))].filter((n) => present.has(n)).sort((a, b) => a - b);
  return { rows, maleOnlySeats: male };
};

/** Validates an admin-supplied layout for `capacity` seats; returns a clean copy (with maleOnlySeats). */
const validateLayout = (layout, capacity) => {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.rows)) {
    throw fail(400, 'INVALID_LAYOUT', 'seatLayout must be { rows: [[...], ...] }.', { field: 'seatLayout' });
  }
  const rows = layout.rows;
  if (!rows.length || rows.length > LIMITS.MAX_LAYOUT_ROWS) throw fail(400, 'INVALID_LAYOUT', `A layout has 1 to ${LIMITS.MAX_LAYOUT_ROWS} rows.`, { field: 'seatLayout' });
  const seen = new Set();
  let drivers = 0;
  const clean = rows.map((row) => {
    if (!Array.isArray(row) || !row.length || row.length > LIMITS.MAX_LAYOUT_COLS) {
      throw fail(400, 'INVALID_LAYOUT', `Each row has 1 to ${LIMITS.MAX_LAYOUT_COLS} places.`, { field: 'seatLayout' });
    }
    return row.map((cell) => {
      if (cell === null) return null;
      if (cell === DRIVER || cell === 'DRIVER') { drivers++; return DRIVER; }
      const n = Number(cell);
      if (!Number.isInteger(n) || n < 1 || n > capacity || seen.has(n)) {
        throw fail(400, 'INVALID_LAYOUT', `Seats must be numbered 1 to ${capacity}, each exactly once.`, { field: 'seatLayout' });
      }
      seen.add(n);
      return n;
    });
  });
  if (drivers !== 1) throw fail(400, 'INVALID_LAYOUT', 'The layout needs exactly one driver seat (D).', { field: 'seatLayout' });
  if (seen.size !== capacity) throw fail(400, 'INVALID_LAYOUT', `The layout must show all ${capacity} passenger seats.`, { field: 'seatLayout' });
  let maleOnlySeats = seatsBesideDriver(clean);
  if (layout.maleOnlySeats !== undefined && layout.maleOnlySeats !== null) {
    if (!Array.isArray(layout.maleOnlySeats)) throw fail(400, 'INVALID_LAYOUT', 'maleOnlySeats must be a list of seat numbers.', { field: 'seatLayout.maleOnlySeats' });
    const list = layout.maleOnlySeats.map(Number);
    if (list.some((n) => !seen.has(n)) || new Set(list).size !== list.length) {
      throw fail(400, 'INVALID_LAYOUT', 'Boys-only seats must be seats of this layout, each once.', { field: 'seatLayout.maleOnlySeats' });
    }
    maleOnlySeats = list.sort((a, b) => a - b);
  }
  return { rows: clean, maleOnlySeats };
};

/**
 * Layout for a trip of `capacity` seats taken from a vehicle layout (seats above the trip capacity become gaps).
 * vehicleCapacity: the vehicle's approved capacity (its default layout is used when the vehicle has none).
 */
const layoutForTrip = (vehicleLayout, capacity, vehicleCapacity) => {
  const base = normalizeLayout(vehicleLayout, vehicleCapacity || capacity);
  const rows = base.rows.map((r) => r.map((c) => (typeof c === 'number' && c > capacity ? null : c)));
  if (seatsIn(rows).length !== capacity) return defaultLayout(capacity);
  return { rows, maleOnlySeats: base.maleOnlySeats.filter((n) => n <= capacity) };
};

/** The boys-only seats of a trip (from its snapshot, or the default for its capacity). */
const maleOnlySeatsOf = (trip) => normalizeLayout(trip && trip.seatLayout, trip && trip.capacity).maleOnlySeats;

// ── Rider gender (the front-seat rule) ────────────────────────────────────────

/** 'Male' | 'Female' | 'Other' from a stored profile value; null when unknown ('Prefer not to say', empty, ...). */
const knownGender = (g) => {
  const s = String(g === undefined || g === null ? '' : g).trim().toLowerCase();
  if (s === 'male') return MALE;
  if (s === 'female') return 'Female';
  if (s === 'other') return 'Other';
  return null;
};

/**
 * Who sits in the seat, for the front-seat rule. The profile gender wins when it is known; only an unknown
 * profile gender takes the per-booking answer riderGender ('Male' | 'Female' | 'Other', else 400).
 * Returns { gender: 'Male' | 'Female' | 'Other' | null, source: 'PROFILE' | 'BOOKING' | 'UNKNOWN' }.
 */
const resolveRider = (profileGender, riderGender) => {
  const p = knownGender(profileGender);
  if (p) return { gender: p, source: 'PROFILE' };
  if (riderGender === undefined || riderGender === null || riderGender === '') return { gender: null, source: 'UNKNOWN' };
  const r = knownGender(riderGender);
  if (!r) throw fail(400, 'INVALID_INPUT', 'riderGender must be Male, Female or Other.', { field: 'riderGender' });
  return { gender: r, source: 'BOOKING' };
};

const isMale = (gender) => gender === MALE;

/** 409 FRONT_SEAT_MALE_ONLY for these seats. */
const frontSeatError = (seats, extra = {}) => fail(409, 'FRONT_SEAT_MALE_ONLY', FRONT_SEAT_MESSAGE, { seats, ...extra });

/** Seats of `free` this rider may take (boys: all; anyone else: not the boys-only seats). */
const seatsForRider = (free, maleOnly, gender) => {
  if (isMale(gender)) return free;
  const block = new Set(maleOnly);
  return free.filter((n) => !block.has(n));
};

module.exports = {
  DRIVER, MALE, FRONT_SEAT_MESSAGE, defaultLayout, validateLayout, layoutForTrip, normalizeLayout, maleOnlySeatsOf,
  seatsBesideDriver, knownGender, resolveRider, isMale, frontSeatError, seatsForRider,
};
