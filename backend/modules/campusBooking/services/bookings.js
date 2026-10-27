// Booking writes: create (server-priced, stall must be open), status transitions with an optimistic version
// check (two taps / two phones can never both move a booking), pickup code check.
const { Op } = require('sequelize');
const { STATUS, canTransition, OPEN_STATUSES, COMMISSION_PCT, LIMITS, REJECT_REASONS, CANCEL_REASONS } = require('../enums');
const { fail, cleanText, isUuid, randomCode, pickupCode, normalizeRef, normalizePickupCode } = require('./util');
const stalls = require('./stalls');
const { computeCommission } = require('../../../utils/commission');
const { getModel } = require('../index');

const Booking = () => {
  const M = getModel('CampusBooking');
  if (!M) throw fail(503, 'STARTING', 'In-Campus Booking is starting up. Please try again in a moment.');
  return M;
};

const isUniqueErr = (err) => err && (err.name === 'SequelizeUniqueConstraintError' || /unique/i.test(String(err.message || '')));

/** Commission snapshot (1.5 % of the item total, round half up in paise). */
const commissionFor = (amountPaise) => {
  const c = computeCommission({ subtotal: amountPaise / 100, rate: COMMISSION_PCT, type: 'percentage' });
  return { commissionPct: COMMISSION_PCT, commissionPaise: c.commissionAmountPaise, vendorNetPaise: c.storeNetPaise };
};

/** Normalised lines [{ menuItemId, quantity }] (same item twice = one line). */
const parseLines = (raw) => {
  if (!Array.isArray(raw) || !raw.length) throw fail(400, 'EMPTY_CART', 'Add at least one item to book.');
  const map = new Map();
  for (const l of raw) {
    const id = l && (l.menuItemId || l.id);
    const q = Number(l && l.quantity);
    if (!isUuid(String(id || ''))) throw fail(400, 'INVALID_ITEM', 'One of the items is not on this stall menu any more. Please refresh.');
    if (!Number.isInteger(q) || q < 1 || q > LIMITS.maxQtyPerLine) throw fail(400, 'INVALID_QUANTITY', `Each item can be booked 1 to ${LIMITS.maxQtyPerLine} at a time.`);
    map.set(String(id), Math.min(LIMITS.maxQtyPerLine, (map.get(String(id)) || 0) + q));
  }
  if (map.size > LIMITS.maxLines) throw fail(400, 'TOO_MANY_ITEMS', `A booking can have up to ${LIMITS.maxLines} different items.`);
  return [...map.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
};

/** A pickup code no other open booking of this stall is using. */
const freshPickupCode = async (restaurantId) => {
  for (let i = 0; i < 8; i++) {
    const code = pickupCode();
    const clash = await Booking().count({ where: { restaurantId, pickupCode: code, status: { [Op.in]: OPEN_STATUSES } } });
    if (!clash) return code;
  }
  return pickupCode();
};

/**
 * POST /bookings. Returns { booking, store, created }. A retry with the same Idempotency-Key returns the
 * booking it created the first time (created false).
 */
const createBooking = async ({ userId, stallId, items, note, idempotencyKey, now = new Date() }) => {
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
  const { getRestaurantModel } = require('../../../models/Restaurant');
  const Restaurant = getRestaurantModel();
  if (key) {
    const prior = await Booking().findOne({ where: { userId, idempotencyKey: key } });
    if (prior) return { booking: prior, store: await Restaurant.findByPk(prior.restaurantId, { attributes: ['id', 'name', 'location', 'imageUrl'] }), created: false };
  }
  if (!isUuid(String(stallId || ''))) throw fail(404, 'STALL_NOT_FOUND', 'This stall is not taking bookings on ZCS.');
  const lines = parseLines(items);
  const store = await Restaurant.findByPk(stallId, { attributes: [...stalls.STORE_ATTRS, 'imageUrl'] });
  if (!stalls.takesBookings(store)) throw fail(409, 'NOT_TAKING_BOOKINGS', `${store ? store.name : 'This stall'} is not taking In-Campus Bookings right now.`);
  const open = stalls.openStateOf(store, now);
  if (!open.isOpen) throw fail(409, 'STALL_CLOSED', open.closedReason || `${store.name} is closed right now.`, { opensAt: open.opensAt });

  const openCount = await Booking().count({ where: { userId, status: { [Op.in]: OPEN_STATUSES } } });
  if (openCount >= LIMITS.maxOpenPerStudent) {
    throw fail(409, 'TOO_MANY_OPEN', `You already have ${openCount} bookings in progress. Collect or cancel one before booking again.`);
  }

  const { getMenuItemModel } = require('../../../models/MenuItem');
  const rows = await getMenuItemModel().findAll({ where: { id: { [Op.in]: lines.map((l) => l.menuItemId) }, restaurantId: store.id } });
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const missing = lines.filter((l) => !byId.has(l.menuItemId));
  if (missing.length) throw fail(409, 'ITEM_GONE', 'An item in your cart is no longer on this stall menu. Please review your cart.', { itemIds: missing.map((l) => l.menuItemId) });
  const unavailable = lines.filter((l) => byId.get(l.menuItemId).isAvailable === false);
  if (unavailable.length) {
    const names = unavailable.map((l) => byId.get(l.menuItemId).name).slice(0, 3).join(', ');
    throw fail(409, 'ITEM_UNAVAILABLE', `${names} ${unavailable.length === 1 ? 'is' : 'are'} sold out right now. Remove ${unavailable.length === 1 ? 'it' : 'them'} to continue.`, { itemIds: unavailable.map((l) => l.menuItemId) });
  }

  let amountPaise = 0;
  let itemCount = 0;
  const priced = lines.map((l) => {
    const m = byId.get(l.menuItemId);
    const unitPaise = Math.round((Number(m.price) || 0) * 100);
    if (unitPaise <= 0) throw fail(409, 'ITEM_UNAVAILABLE', `${m.name} has no price yet. Please pick another item.`, { itemIds: [l.menuItemId] });
    const linePaise = unitPaise * l.quantity;
    amountPaise += linePaise;
    itemCount += l.quantity;
    return { menuItemId: l.menuItemId, name: String(m.name).slice(0, 120), unitPrice: unitPaise / 100, quantity: l.quantity, lineTotal: linePaise / 100, isVeg: stalls.isVegOf(m) };
  });
  if (amountPaise > 1000000) throw fail(400, 'TOO_LARGE', 'A booking can be up to ₹10,000. Please split it into smaller bookings.');

  const prepMinutes = stalls.prepMinutesOf(store);
  const base = {
    userId,
    restaurantId: store.id,
    items: priced,
    itemCount,
    amountPaise,
    ...commissionFor(amountPaise),
    status: STATUS.PAYMENT_PENDING,
    pickupCode: await freshPickupCode(store.id),
    payeeUpiId: store.campusUpiId,
    payeeName: cleanText(store.campusUpiName || store.legalName || store.name, 120) || null,
    payeeQrUrl: store.campusUpiQrUrl || null,
    prepMinutes,
    note: cleanText(note, 200) || null,
    idempotencyKey: key,
    proofAttempts: 0,
    pickupCodeFails: 0,
    version: 0,
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const booking = await Booking().create({ ...base, ref: `CB${randomCode(4)}` });
      return { booking, store, created: true };
    } catch (err) {
      if (!isUniqueErr(err)) throw err;
      if (key) {
        const prior = await Booking().findOne({ where: { userId, idempotencyKey: key } });
        if (prior) return { booking: prior, store, created: false };
      }
    }
  }
  throw fail(503, 'BUSY', 'Could not create the booking. Please try again.');
};

/**
 * Moves a booking `from` its current status `to` the next one for `actor` (student | vendor | system), with
 * extra column changes. Refuses transitions the status machine does not allow (409 BAD_TRANSITION) and
 * concurrent changes (409 CHANGED). Returns the fresh row.
 */
const transition = async (booking, to, actor, patch = {}) => {
  if (!canTransition(booking.status, to, actor)) {
    throw fail(409, 'BAD_TRANSITION', transitionMessage(booking.status, to), { status: booking.status });
  }
  const [n] = await Booking().update(
    { ...patch, status: to, version: (Number(booking.version) || 0) + 1 },
    { where: { id: booking.id, version: Number(booking.version) || 0, status: booking.status } },
  );
  if (!n) {
    const fresh = await Booking().findByPk(booking.id);
    throw fail(409, 'CHANGED', 'This booking was just updated. Showing the latest.', { status: fresh ? fresh.status : null });
  }
  return Booking().findByPk(booking.id);
};

const transitionMessage = (from, to) => {
  if (from === 'CANCELLED') return 'This booking was cancelled.';
  if (from === 'COLLECTED') return 'This booking was already collected.';
  if (to === 'PAYMENT_REVIEW') return 'Payment proof can only be sent before the stall accepts the booking.';
  if (to === 'CANCELLED' && ['ACCEPTED', 'PREPARING', 'READY'].includes(from)) return 'The stall already accepted this booking. Talk to the stall to cancel it.';
  if (to === 'CANCELLED' && from === 'PAYMENT_REVIEW') return 'The stall is checking your payment. Wait for it to confirm or reject it.';
  if (to === 'ACCEPTED' || to === 'REJECTED') return 'This payment was already reviewed.';
  if (to === 'COLLECTED') return 'Mark the order ready before handing it over.';
  return 'This booking cannot be changed that way now.';
};

/** Proof references (screenshot media path + / or UPI ref) checked for the student. */
const checkProof = async ({ userId, bookingId, imageUrl, upiRef }) => {
  const { toPath, idOf } = require('../../rentals/services/media');
  let path = null;
  if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '') {
    path = toPath(String(imageUrl));
    if (!path) throw fail(400, 'INVALID_MEDIA', 'Upload the payment screenshot through the app first.');
    const { getCampusMediaModel } = require('../../campus/models/CampusMedia');
    const row = await getCampusMediaModel().findByPk(idOf(path), { attributes: ['id', 'ownerId', 'purpose', 'isPrivate'] });
    if (!row || String(row.ownerId) !== String(userId) || row.purpose !== 'campus_payment') {
      throw fail(400, 'INVALID_MEDIA', 'The screenshot was not uploaded from your account. Please upload it again.');
    }
  }
  let ref = null;
  if (upiRef !== undefined && upiRef !== null && String(upiRef).trim() !== '') {
    ref = normalizeRef(upiRef);
    if (!ref) throw fail(400, 'INVALID_REF', 'Enter the UPI reference number exactly as your UPI app shows it (6 to 35 letters or digits).');
  }
  if (!path && !ref) throw fail(400, 'PROOF_REQUIRED', 'Upload the payment screenshot or enter the UPI reference number.');
  const others = { id: { [Op.ne]: bookingId } };
  if (ref && await Booking().count({ where: { ...others, proofRef: ref } })) {
    throw fail(409, 'REF_ALREADY_USED', 'This UPI reference was already used for another booking. Check the number in your UPI app.');
  }
  if (path && await Booking().count({ where: { ...others, proofImageUrl: path } })) {
    throw fail(409, 'SCREENSHOT_ALREADY_USED', 'This screenshot was already sent for another booking. Upload the screenshot of this payment.');
  }
  return { path, ref };
};

const submitProof = async (booking, { userId, imageUrl, upiRef, now = new Date() }) => {
  if (!['PAYMENT_PENDING', 'REJECTED'].includes(booking.status)) {
    throw fail(409, 'BAD_TRANSITION', transitionMessage(booking.status, 'PAYMENT_REVIEW'), { status: booking.status });
  }
  if ((Number(booking.proofAttempts) || 0) >= LIMITS.proofMaxAttempts) {
    throw fail(409, 'PROOF_LIMIT', 'Payment proof was sent too many times for this booking. Please cancel it and book again, or talk to the stall.');
  }
  const { path, ref } = await checkProof({ userId, bookingId: booking.id, imageUrl, upiRef });
  try {
    return await transition(booking, STATUS.PAYMENT_REVIEW, 'student', {
      proofImageUrl: path,
      proofRef: ref,
      proofSubmittedAt: now,
      proofAttempts: (Number(booking.proofAttempts) || 0) + 1,
      rejectCode: null,
      rejectReason: null,
      rejectedAt: null,
    });
  } catch (err) {
    // The same proof sent for another booking at the same moment: checkProof above could not see it yet, the
    // unique indexes (migrations.js campus_bookings_proof_*_unique) refuse the second write.
    if (!isUniqueErr(err)) throw err;
    const where = `${err.message || ''} ${(err.parent && (err.parent.constraint || err.parent.detail)) || ''} ${JSON.stringify(err.fields || {})}`;
    const refClash = ref && (/proofRef|proof_ref/i.test(where) || !path);
    throw refClash
      ? fail(409, 'REF_ALREADY_USED', 'This UPI reference was already used for another booking. Check the number in your UPI app.')
      : fail(409, 'SCREENSHOT_ALREADY_USED', 'This screenshot was already sent for another booking. Upload the screenshot of this payment.');
  }
};

const reasonFrom = (table, code, note) => {
  const c = String(code || 'OTHER').toUpperCase();
  const key = Object.prototype.hasOwnProperty.call(table, c) ? c : 'OTHER';
  const extra = cleanText(note, 160);
  return { code: key, reason: (key === 'OTHER' && extra ? extra : table[key]).slice(0, 250) };
};

const vendorConfirm = (booking, now = new Date()) => transition(booking, STATUS.ACCEPTED, 'vendor', {
  paymentVerifiedAt: now,
  acceptedAt: now,
  estimatedReadyAt: new Date(now.getTime() + (Number(booking.prepMinutes) || LIMITS.defaultPrepMin) * 60000),
});
const vendorReject = (booking, { code, note }, now = new Date()) => {
  const r = reasonFrom(REJECT_REASONS, code, note);
  return transition(booking, STATUS.REJECTED, 'vendor', { rejectCode: r.code, rejectReason: r.reason, rejectedAt: now });
};
const vendorPreparing = (booking, now = new Date()) => transition(booking, STATUS.PREPARING, 'vendor', { preparingAt: booking.preparingAt || now });
const vendorReady = (booking, now = new Date()) => transition(booking, STATUS.READY, 'vendor', { preparingAt: booking.preparingAt || now, readyAt: now });
const cancel = (booking, actor, { code, note } = {}, now = new Date()) => {
  const r = actor === 'vendor' ? reasonFrom(CANCEL_REASONS, code, note)
    : actor === 'system' ? { code: 'NO_PAYMENT', reason: booking.status === 'REJECTED' ? 'No new payment proof arrived in time.' : 'No payment proof arrived in time.' }
      : { code: 'BY_STUDENT', reason: 'Cancelled by the student.' };
  return transition(booking, STATUS.CANCELLED, actor, { cancelledAt: now, cancelledBy: actor, cancelCode: r.code, cancelReason: r.reason });
};

/** The stall types the student's pickup code. Wrong codes are counted; 6 wrong in a row lock it for 15 min. */
const vendorCollect = async (booking, { code }, now = new Date()) => {
  if (booking.status !== STATUS.READY) throw fail(409, 'BAD_TRANSITION', transitionMessage(booking.status, 'COLLECTED'), { status: booking.status });
  if (booking.pickupCodeLockedUntil && new Date(booking.pickupCodeLockedUntil) > now) {
    throw fail(429, 'CODE_LOCKED', 'Too many wrong codes. Wait a few minutes, then ask the student for the code again.', { retryAfter: Math.ceil((new Date(booking.pickupCodeLockedUntil) - now) / 1000) });
  }
  const typed = normalizePickupCode(code);
  if (typed.length !== 4) throw fail(400, 'CODE_REQUIRED', 'Enter the 4-character pickup code the student shows you.');
  // Claim one attempt atomically BEFORE comparing (same pattern as the delivery PIN): parallel guesses each
  // read "0 wrong so far" from the row above and used to write fails = 1, so the 15-minute pause never came.
  const M = Booking();
  const max = LIMITS.pickupCodeMaxTries;
  const [claimed] = await M.update(
    { pickupCodeFails: M.sequelize.literal('COALESCE("pickupCodeFails", 0) + 1') },
    {
      where: {
        id: booking.id,
        status: STATUS.READY,
        [Op.and]: [
          { [Op.or]: [{ pickupCodeFails: null }, { pickupCodeFails: { [Op.lt]: max } }] },
          { [Op.or]: [{ pickupCodeLockedUntil: null }, { pickupCodeLockedUntil: { [Op.lte]: now } }] },
        ],
      },
    },
  );
  if (!claimed) {
    const fresh = await M.findByPk(booking.id, { attributes: ['id', 'status', 'pickupCodeLockedUntil'] });
    if (!fresh || fresh.status !== STATUS.READY) throw fail(409, 'CHANGED', 'This booking was just updated. Showing the latest.', { status: fresh ? fresh.status : null });
    const until = fresh.pickupCodeLockedUntil && new Date(fresh.pickupCodeLockedUntil) > now ? new Date(fresh.pickupCodeLockedUntil) : new Date(now.getTime() + 15 * 60000);
    throw fail(429, 'CODE_LOCKED', 'Too many wrong codes. Wait a few minutes, then ask the student for the code again.', { retryAfter: Math.ceil((until - now) / 1000) });
  }
  if (typed !== String(booking.pickupCode).toUpperCase()) {
    const fresh = await M.findByPk(booking.id, { attributes: ['id', 'pickupCodeFails'] });
    const fails = Number(fresh && fresh.pickupCodeFails) || max;
    const lock = fails >= max;
    if (lock) {
      await M.update(
        { pickupCodeFails: 0, pickupCodeLockedUntil: new Date(now.getTime() + 15 * 60000) },
        { where: { id: booking.id, pickupCodeFails: { [Op.gte]: max } } },
      );
    }
    throw fail(400, 'WRONG_CODE', lock ? 'Wrong code again. Checking is paused for 15 minutes.' : `That code does not match booking ${booking.ref}. Check it with the student.`, { triesLeft: lock ? 0 : max - fails });
  }
  return transition(booking, STATUS.COLLECTED, 'vendor', { collectedAt: now, pickupCodeFails: 0, pickupCodeLockedUntil: null });
};

module.exports = {
  Booking, commissionFor, parseLines, createBooking, transition, submitProof, checkProof, vendorConfirm, vendorReject,
  vendorPreparing, vendorReady, vendorCollect, cancel, transitionMessage,
};
