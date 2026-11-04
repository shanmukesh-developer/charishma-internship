// Rental bookings: request -> accept / decline / expire -> handover (pickup PIN) -> return (return PIN)
// -> complete -> ratings. Money is server-priced and paid in cash between the students.
const crypto = require('crypto');
const { Op, Transaction } = require('sequelize');
const { getModel, getSequelize } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUuid, num, hit, money } = require('../services/util');
const { checkRefs } = require('../services/media');
const { quote, scheduleProblem, validateWindow, parseTime, HOUR } = require('../services/pricing');
const S = require('../services/serialize');
const notify = require('../services/notify');
const safety = require('../services/safety');
const { assertLicenceFor } = require('./licence');

const B = E.BOOKING_STATUS;
const CH = E.CHARGES_STATUS;
/** C7: RENT / BORROW of a booking (snapshot taken at request time; very old rows fall back to BORROW). */
const modeOf = (b) => (b && (b.rentalMode === E.RENTAL_MODES.RENT || b.rentalMode === E.RENTAL_MODES.BORROW) ? b.rentalMode : E.RENTAL_MODES.BORROW);
const Wb = (b) => E.wordsFor(modeOf(b));
const cap1 = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const fmtIst = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const M = () => ({
  Listing: getModel('RentalListing'),
  Booking: getModel('RentalBooking'),
  Licence: getModel('RentalLicence'),
  Review: getModel('RentalReview'),
  Report: getModel('RentalReport'),
  User: getModel('User'),
});
const USER_ATTRS = ['id', 'name', 'phone', 'profileImage', 'isActive'];

// ── Per-listing serialisation ───────────────────────────────────────────────
// In-process queue per listing + a write transaction (SQLite: IMMEDIATE; Postgres: SELECT ... FOR UPDATE
// on the listing row), so two concurrent requests for overlapping times can never both be stored.
const queues = new Map();
const withListingLock = async (listingId, fn) => {
  const key = String(listingId);
  const prev = queues.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const chained = prev.then(() => mine);
  queues.set(key, chained);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (queues.get(key) === chained) queues.delete(key);
  }
};
const tx = (fn) => getSequelize().transaction({ type: Transaction.TYPES.IMMEDIATE }, fn);
const lockOpt = (t) => (getSequelize().getDialect() === 'postgres' ? { transaction: t, lock: t.LOCK.UPDATE } : { transaction: t });

const overlapping = (Booking, listingId, start, end, t, exceptId) => Booking.findOne({
  where: {
    listingId,
    status: { [Op.in]: E.HOLDING_STATUSES },
    startAt: { [Op.lt]: end },
    endAt: { [Op.gt]: start },
    ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
  },
  attributes: ['id', 'status'],
  transaction: t,
});

const newPin = (avoid) => {
  let p;
  do { p = String(crypto.randomInt(0, 10000)).padStart(4, '0'); } while (p === avoid);
  return p;
};

/** Ratings a student received in one role (RENTER = as owner; OWNER = as renter). */
const ratingOf = async (userId, role) => {
  const { Review, Booking } = M();
  const rows = await Review.findAll({ where: { revieweeId: userId, role, isHidden: { [Op.not]: true } }, attributes: ['rating'] });
  const trips = role === 'OWNER'
    ? await Booking.count({ where: { renterId: userId, status: B.COMPLETED } })
    : await Booking.count({ where: { ownerId: userId, status: B.COMPLETED } });
  const avg = rows.length ? Math.round((rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / rows.length) * 10) / 10 : null;
  return { avg, count: rows.length, trips };
};

/** Full payload for one viewer (loads listing / users / licence as needed). */
const present = async (req, booking, viewerId) => {
  const { Listing, User, Licence } = M();
  const [listing, owner, renter] = await Promise.all([
    Listing.findByPk(booking.listingId),
    User.findByPk(booking.ownerId, { attributes: USER_ATTRS }),
    User.findByPk(booking.renterId, { attributes: USER_ATTRS }),
  ]);
  const isOwner = String(viewerId) === String(booking.ownerId);
  const ctx = { listing, owner, renter, safety: await safety.readSettings() };
  if (isOwner) {
    ctx.renterLicence = await Licence.findOne({ where: { userId: booking.renterId } });
    ctx.renterRating = await ratingOf(booking.renterId, 'OWNER');
  } else {
    ctx.ownerRating = await ratingOf(booking.ownerId, 'RENTER');
  }
  const out = S.bookingFor(req, booking, viewerId, ctx);
  // C7: the booking terms (shown again to accept them when an older app skipped it) + the disclaimer.
  const info = await safety.safetyInfo(modeOf(booking));
  out.safety = { termsVersion: info.termsVersion, terms: info.terms, disclaimer: info.disclaimer };
  return out;
};

/** Loads a booking the caller is a party to (404 otherwise, so ids cannot be probed). */
const loadParty = async (req, t) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  const { Booking } = M();
  const row = await Booking.findByPk(id, t ? lockOpt(t) : undefined);
  const uid = String(req.user.id);
  if (!row || (String(row.ownerId) !== uid && String(row.renterId) !== uid)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  return row;
};
const asOwner = (row, req) => {
  if (String(row.ownerId) !== String(req.user.id)) throw fail(403, 'OWNER_ONLY', `Only the vehicle's ${Wb(row).giver} can do this.`);
};
const asRenter = (row, req) => {
  if (String(row.renterId) !== String(req.user.id)) throw fail(403, 'RENTER_ONLY', `Only the ${Wb(row).taker} can do this.`);
};
/** The owner / lender's record of a condition stage (photos + odometer), or null. */
const ownerSide = (raw) => {
  const c = S.jsonOf(raw);
  return c && c.OWNER && typeof c.OWNER === 'object' ? c.OWNER : null;
};

/** Expires a REQUESTED booking whose answer window has passed. Returns true if it did. */
const expireIfStale = async (row, t) => {
  if (row.status !== B.REQUESTED || !row.respondBy || new Date(row.respondBy).getTime() > Date.now()) return false;
  const { Booking } = M();
  const [n] = await Booking.update({ status: B.EXPIRED, expiredAt: new Date() }, { where: { id: row.id, status: B.REQUESTED }, transaction: t });
  if (n) row.status = B.EXPIRED;
  return n > 0;
};

// ── Handlers ────────────────────────────────────────────────────────────────

// POST /api/rentals/bookings { listingId, startAt, endAt, note?, acceptTerms: true }
// C7: acceptTerms must be true. Older app builds that do not send the field at all still create the
// booking, flagged termsPending: the renter / borrower accepts in the app before the handover.
const create = async (req, res) => {
  const body = req.body || {};
  const termsSent = Object.prototype.hasOwnProperty.call(body, 'acceptTerms');
  if (termsSent && body.acceptTerms !== true) {
    throw fail(400, 'TERMS_REQUIRED', 'Tick the box to accept the booking terms before sending the request.', { field: 'acceptTerms' });
  }
  const listingId = String(body.listingId || '');
  if (!isUuid(listingId)) throw fail(400, 'INVALID_INPUT', 'Pick a vehicle to book.', { field: 'listingId' });
  const start = parseTime(body.startAt, 'startAt');
  const end = parseTime(body.endAt, 'endAt');
  validateWindow(start, end, { forBooking: true });
  const note = cleanText(body.note, 500, { multiline: true }) || null;
  hit('booking_request', req.user.id);
  const { Listing, Booking, Licence, User } = M();
  const renterId = req.user.id;
  const ctx = req.rentals.ctx;

  const booking = await withListingLock(listingId, () => tx(async (t) => {
    const listing = await Listing.findByPk(listingId, lockOpt(t));
    if (!listing || listing.status !== E.LISTING_STATUS.APPROVED) throw fail(404, 'NOT_FOUND', 'This vehicle is not available any more.');
    if (String(listing.ownerId) === String(renterId)) throw fail(400, 'OWN_VEHICLE', 'You cannot book your own vehicle.');
    if (listing.campusId && ctx.campusId && String(listing.campusId) !== String(ctx.campusId)) {
      throw fail(403, 'CAMPUS_MISMATCH', 'This vehicle is listed for another campus.');
    }
    const owner = await User.findByPk(listing.ownerId, { attributes: ['id', 'isActive'], transaction: t });
    if (!owner || owner.isActive === false) throw fail(404, 'NOT_FOUND', 'This vehicle is not available any more.');
    const lic = await Licence.findOne({ where: { userId: renterId }, transaction: t });
    assertLicenceFor(lic, listing, { at: end, requireExpiry: true });
    const problem = scheduleProblem(listing, start, end);
    if (problem) throw fail(409, problem.code, problem.message);
    const clash = await overlapping(Booking, listing.id, start, end, t);
    if (clash) throw fail(409, 'SLOT_TAKEN', 'Someone has already booked or requested this vehicle for part of that time. Try other times.');
    const openCount = await Booking.count({ where: { renterId, status: B.REQUESTED }, transaction: t });
    if (openCount >= E.LIMITS.MAX_OPEN_REQUESTS_PER_RENTER) {
      throw fail(429, 'TOO_MANY_OPEN_REQUESTS', `You already have ${openCount} requests waiting for owners. Cancel one or wait for answers.`);
    }
    const q = quote(listing, start, end);
    const respondBy = new Date(Math.min(Date.now() + E.LIMITS.RESPOND_WINDOW_MS, start.getTime()));
    return Booking.create({
      listingId: listing.id,
      ownerId: listing.ownerId,
      renterId,
      startAt: start,
      endAt: end,
      status: B.REQUESTED,
      billableHours: q.hours,
      rentAmount: q.rent,
      depositAmount: q.deposit,
      payAtHandover: q.payAtHandover,
      kmAllowance: q.kmAllowance,
      priceBreakdown: q,
      vehicleTitle: S.titleOf(listing).slice(0, 120),
      vehicleType: listing.vehicleType,
      renterNote: note,
      respondBy,
      rentalMode: E.rentalMode(listing.plateType),
      termsAcceptedAt: termsSent ? new Date() : null,
      termsVersion: termsSent ? E.TERMS_VERSION : null,
      termsPending: !termsSent,
      chargesStatus: CH.NONE,
    }, { transaction: t });
  }));

  const W = Wb(booking);
  notify.booking(booking, {
    to: 'owner',
    title: `New ${W.request} 🚗`,
    body: `${S.firstName(ctx.user && ctx.user.name)} wants to ${W.verb.toLowerCase()} your ${booking.vehicleTitle}. Answer within 2 hours.`,
    type: 'RENTAL_REQUEST',
  });
  notify.admin('rental_booking', 'created', booking.id);
  res.status(201).json({ booking: await present(req, booking, renterId) });
};

// GET /api/rentals/bookings?role=renter|owner&scope=open|past
const list = async (req, res) => {
  const { Booking, Listing, User } = M();
  const role = String(req.query.role || '').toLowerCase();
  const uid = req.user.id;
  const where = role === 'owner' ? { ownerId: uid } : role === 'renter' ? { renterId: uid } : { [Op.or]: [{ ownerId: uid }, { renterId: uid }] };
  const scope = String(req.query.scope || '').toLowerCase();
  if (scope === 'open') where.status = { [Op.in]: E.OPEN_STATUSES };
  else if (scope === 'past') where.status = { [Op.notIn]: E.OPEN_STATUSES };
  const rows = await Booking.findAll({ where, order: [['startAt', scope === 'past' ? 'DESC' : 'ASC']], limit: 100 });
  const listingIds = [...new Set(rows.map((r) => r.listingId))];
  const userIds = [...new Set(rows.flatMap((r) => [r.ownerId, r.renterId]))];
  const [listings, users] = await Promise.all([
    listingIds.length ? Listing.findAll({ where: { id: { [Op.in]: listingIds } } }) : [],
    userIds.length ? User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: USER_ATTRS }) : [],
  ]);
  const lById = new Map(listings.map((l) => [String(l.id), l]));
  const uById = new Map(users.map((u) => [String(u.id), u]));
  const settings = await safety.readSettings();
  res.json({
    bookings: rows.map((r) => S.bookingFor(req, r, uid, {
      listing: lById.get(String(r.listingId)), owner: uById.get(String(r.ownerId)), renter: uById.get(String(r.renterId)), safety: settings,
    })),
  });
};

// GET /api/rentals/bookings/:id
const getOne = async (req, res) => {
  const row = await loadParty(req);
  if (await expireIfStale(row)) notify.booking(row, {});
  res.json({ booking: await present(req, row, req.user.id) });
};

/** Runs a state change on one booking inside the listing lock + a transaction. */
const mutate = (req, fn) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
  return M().Booking.findByPk(id, { attributes: ['id', 'listingId'] }).then((peek) => {
    if (!peek) throw fail(404, 'NOT_FOUND', 'Booking not found.');
    return withListingLock(peek.listingId, () => tx(async (t) => fn(await loadParty(req, t), t)));
  });
};

// POST /api/rentals/bookings/:id/accept
const accept = async (req, res) => {
  const { Booking, Listing, Licence } = M();
  let expired = false;
  const row = await mutate(req, async (b, t) => {
    asOwner(b, req);
    if (await expireIfStale(b, t)) { expired = true; return b; }
    if (b.status !== B.REQUESTED) throw fail(409, 'INVALID_STATE', `This request is already ${b.status.toLowerCase()}.`);
    const listing = await Listing.findByPk(b.listingId, { transaction: t });
    if (!listing || listing.status === E.LISTING_STATUS.DELETED) throw fail(409, 'INVALID_STATE', 'This vehicle was removed.');
    // B22: only a live (APPROVED) vehicle can confirm a trip: a paused / un-approved / rejected
    // listing used to accept requests, and the owner's hours or blocked dates may have changed.
    if (listing.status !== E.LISTING_STATUS.APPROVED) {
      throw fail(409, 'LISTING_NOT_LIVE', 'This vehicle is not live right now. Resume it (or wait for approval) before accepting.');
    }
    const problem = scheduleProblem(listing, new Date(b.startAt), new Date(b.endAt));
    if (problem) throw fail(409, problem.code, problem.message);
    const lic = await Licence.findOne({ where: { userId: b.renterId }, transaction: t });
    assertLicenceFor(lic, listing, { requireVerified: true, at: b.endAt });
    const clash = await overlapping(Booking, b.listingId, new Date(b.startAt), new Date(b.endAt), t, b.id);
    if (clash) throw fail(409, 'SLOT_TAKEN', 'You already have another booking at this time.');
    const pickupPin = newPin();
    await b.update({ status: B.ACCEPTED, acceptedAt: new Date(), pickupPin, returnPin: newPin(pickupPin), pinAttempts: 0 }, { transaction: t });
    return b;
  });
  const W = Wb(row);
  if (expired) {
    notify.booking(row, { to: 'renter', title: `${W.Request} expired`, body: `The ${W.giver} did not answer in time for ${row.vehicleTitle}.`, type: 'RENTAL_EXPIRED' });
    throw fail(409, 'EXPIRED', 'This request expired before you answered.');
  }
  notify.booking(row, {
    to: 'renter',
    title: `${cap1(W.booking)} confirmed ✅`,
    body: `Your ${row.vehicleTitle} booking is confirmed. Pay ₹${row.payAtHandover} in cash at pickup (${W.price} + refundable deposit).${row.termsPending ? ' Open the booking and accept the terms before pickup.' : ''}`,
    type: 'RENTAL_ACCEPTED',
  });
  res.json({ booking: await present(req, row, req.user.id) });
};

// POST /api/rentals/bookings/:id/decline { reason? }
const decline = async (req, res) => {
  const reason = cleanText(req.body && req.body.reason, 300) || null;
  const row = await mutate(req, async (b, t) => {
    asOwner(b, req);
    if (await expireIfStale(b, t)) throw fail(409, 'EXPIRED', 'This request has already expired.');
    if (b.status !== B.REQUESTED) throw fail(409, 'INVALID_STATE', `This request is already ${b.status.toLowerCase()}.`);
    await b.update({ status: B.DECLINED, declinedAt: new Date(), declineReason: reason }, { transaction: t });
    return b;
  });
  const W = Wb(row);
  notify.booking(row, { to: 'renter', title: `${W.Request} declined`, body: `The ${W.giver} could not ${modeOf(row) === E.RENTAL_MODES.RENT ? 'rent out' : 'lend'} ${row.vehicleTitle} for those times${reason ? `: ${reason}` : '.'}`, type: 'RENTAL_DECLINED' });
  res.json({ booking: await present(req, row, req.user.id) });
};

// POST /api/rentals/bookings/:id/cancel { reason? }  renter: before pickup time; owner: confirmed booking, reason required
const cancel = async (req, res) => {
  const reason = cleanText(req.body && req.body.reason, 300) || null;
  let by = null;
  const row = await mutate(req, async (b, t) => {
    const isRenter = String(b.renterId) === String(req.user.id);
    if (isRenter) {
      if (![B.REQUESTED, B.ACCEPTED].includes(b.status)) throw fail(409, 'INVALID_STATE', 'This booking can no longer be cancelled.');
      if (new Date(b.startAt).getTime() <= Date.now()) throw fail(409, 'TOO_LATE', `The pickup time has passed. Ask the ${Wb(b).giver} to cancel, or report a problem.`);
      by = 'RENTER';
    } else {
      if (b.status === B.REQUESTED) throw fail(409, 'USE_DECLINE', 'Decline the request instead.');
      if (b.status !== B.ACCEPTED) throw fail(409, 'INVALID_STATE', b.status === B.ACTIVE ? 'The trip has started. Complete the return instead.' : 'This booking can no longer be cancelled.');
      if (!reason || reason.length < 5) throw fail(400, 'REASON_REQUIRED', `Tell the ${Wb(b).taker} why you are cancelling (at least 5 characters).`, { field: 'reason' });
      by = 'OWNER';
    }
    await b.update({ status: B.CANCELLED, cancelledAt: new Date(), cancelledBy: by, cancelReason: reason }, { transaction: t });
    return b;
  });
  const W = Wb(row);
  notify.booking(row, by === 'RENTER'
    ? { to: 'owner', title: `${cap1(W.booking)} cancelled`, body: `The ${W.taker} cancelled ${row.vehicleTitle}${reason ? `: ${reason}` : '.'}`, type: 'RENTAL_CANCELLED' }
    : { to: 'renter', title: `${cap1(W.booking)} cancelled by the ${W.giver}`, body: `${row.vehicleTitle}: ${reason}`, type: 'RENTAL_CANCELLED' });
  res.json({ booking: await present(req, row, req.user.id) });
};

/** Owner types the renter's PIN. Wrong PINs are counted; 5 misses lock it for 15 minutes. */
const checkPin = async (b, pin, expected, t) => {
  const now = Date.now();
  if (b.pinLockedUntil && new Date(b.pinLockedUntil).getTime() > now) {
    const mins = Math.ceil((new Date(b.pinLockedUntil).getTime() - now) / 60000);
    throw fail(429, 'PIN_LOCKED', `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  const given = String(pin || '').replace(/\D/g, '');
  const ok = given.length === 4 && expected && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(expected)));
  if (ok) return { pinAttempts: 0, pinLockedUntil: null };
  const attempts = (Number(b.pinAttempts) || 0) + 1;
  if (attempts >= E.LIMITS.PIN_MAX_ATTEMPTS) {
    await b.update({ pinAttempts: 0, pinLockedUntil: new Date(now + E.LIMITS.PIN_LOCK_MS) }, { transaction: t });
    return { error: fail(429, 'PIN_LOCKED', 'Too many wrong PINs. Try again in 15 minutes.') };
  }
  await b.update({ pinAttempts: attempts }, { transaction: t });
  return { error: fail(400, 'WRONG_PIN', `That PIN is not right. ${E.LIMITS.PIN_MAX_ATTEMPTS - attempts} tries left.`, { attemptsLeft: E.LIMITS.PIN_MAX_ATTEMPTS - attempts }) };
};

// Wrong-PIN counters must persist even though the request fails: commit first, then throw.
const pinStep = async (req, res, { from, to, pinField, stampField, early, gate, push }) => {
  let pinError = null;
  const settings = await safety.readSettings();
  const row = await mutate(req, async (b, t) => {
    asOwner(b, req);
    if (b.status !== from) throw fail(409, 'INVALID_STATE', from === B.ACCEPTED ? 'This booking is not ready for pickup.' : 'This trip is not in progress.');
    if (early) early(b);
    // C7 gates run before the PIN is checked, so they never use up PIN attempts.
    if (gate) gate(b, settings);
    const r = await checkPin(b, req.body && req.body.pin, b[pinField], t);
    if (r.error) { pinError = r.error; return b; }
    await b.update({ status: to, [stampField]: new Date(), ...r }, { transaction: t });
    return b;
  });
  if (pinError) throw pinError;
  notify.booking(row, push(row));
  res.json({ booking: await present(req, row, req.user.id) });
};

// POST /api/rentals/bookings/:id/handover { pin }  (owner enters the renter's pickup PIN)
const handover = (req, res) => pinStep(req, res, {
  from: B.ACCEPTED,
  to: B.ACTIVE,
  pinField: 'pickupPin',
  stampField: 'handoverAt',
  early: (b) => {
    if (Date.now() < new Date(b.startAt).getTime() - HOUR) throw fail(409, 'TOO_EARLY', 'Pickup opens 1 hour before the booked time.');
    if (Date.now() > new Date(b.endAt).getTime()) throw fail(409, 'TOO_LATE', 'This booking has already ended.');
  },
  gate: (b, settings) => {
    const W = Wb(b);
    if (b.termsPending) {
      throw fail(409, 'TERMS_PENDING', `The ${W.taker} has not accepted the booking terms yet. Ask them to open this booking in the ZenWe app (update the app if needed) and accept the terms before pickup.`);
    }
    if (settings.conditionPhotosRequired && !ownerSide(b.pickupCondition)) {
      throw fail(409, 'CONDITION_REQUIRED', `Add ${E.LIMITS.MIN_CONDITION_PHOTOS}-${E.LIMITS.MAX_CONDITION_PHOTOS} pickup photos of the vehicle and the odometer reading before starting the trip.`, { stage: 'PICKUP' });
    }
  },
  push: (b) => ({ to: 'renter', title: 'Trip started 🔑', body: `Enjoy the ride! Return ${b.vehicleTitle} by ${fmtIst(b.endAt)}.`, type: 'RENTAL_STARTED' }),
});

// POST /api/rentals/bookings/:id/return { pin }  (owner enters the renter's return PIN)
const markReturned = (req, res) => pinStep(req, res, {
  from: B.ACTIVE,
  to: B.RETURNED,
  pinField: 'returnPin',
  stampField: 'returnedAt',
  gate: (b, settings) => {
    if (settings.conditionPhotosRequired && !ownerSide(b.returnCondition)) {
      throw fail(409, 'CONDITION_REQUIRED', `Add ${E.LIMITS.MIN_CONDITION_PHOTOS}-${E.LIMITS.MAX_CONDITION_PHOTOS} return photos of the vehicle and the odometer reading before closing the return.`, { stage: 'RETURN' });
    }
  },
  push: (b) => ({ to: 'renter', title: 'Vehicle returned', body: `Thanks for returning ${b.vehicleTitle}. Collect your ₹${b.depositAmount} deposit in cash.`, type: 'RENTAL_RETURNED' }),
});

/** COMPLETED bookkeeping shared by the owner action and the auto-complete job. */
const bumpTripCount = async (listingId, t) => {
  const { Listing } = M();
  await Listing.increment('tripCount', { by: 1, where: { id: listingId }, transaction: t });
};

// POST /api/rentals/bookings/:id/complete { extraKm?, otherCharges?, note?, photos? }
// C7: other charges are capped (setting, and at most 2 x the deposit), need a note when anything extra is
// claimed, and only count once the renter / borrower accepts them (or does not answer within the window,
// or the admin upholds them on a dispute). finalAmount = rent + the charges that count.
const complete = async (req, res) => {
  const body = req.body || {};
  const extraKm = num(body.extraKm, { min: 0, max: 5000, int: true, field: 'extraKm', label: 'Extra km' }) || 0;
  const otherCharges = num(body.otherCharges, { min: 0, max: 50000, field: 'otherCharges', label: 'Other charges' }) || 0;
  const note = cleanText(body.note, 300) || null;
  const settings = await safety.readSettings();
  const evidence = await checkRefs(req.user.id, body.photos, { purposes: ['rental_condition', 'rental_report'], field: 'photos', max: E.LIMITS.MAX_EVIDENCE_PHOTOS, label: 'photo' });
  const row = await mutate(req, async (b, t) => {
    asOwner(b, req);
    const W = Wb(b);
    if (b.status !== B.RETURNED) throw fail(409, 'INVALID_STATE', 'Mark the vehicle as returned first.');
    const cap = safety.otherChargesCapFor(settings, b.depositAmount);
    if (otherCharges > cap) {
      const viaDeposit = Number(b.depositAmount) > 0 && cap < Number(settings.otherChargesCap);
      throw fail(400, 'CHARGES_OVER_CAP', `Other charges can be at most ₹${cap} for this trip${viaDeposit ? ' (2 × the deposit)' : ''}. For bigger damage, report a problem from the booking.`, { field: 'otherCharges', cap });
    }
    // B22: the per-km rate agreed when the trip was booked (the quote stored on the booking), not
    // whatever the owner set on the listing afterwards. Older bookings without it use the listing.
    let pb = b.priceBreakdown;
    if (typeof pb === 'string') { try { pb = JSON.parse(pb); } catch { pb = null; } }
    const agreed = pb && typeof pb === 'object' && Object.prototype.hasOwnProperty.call(pb, 'extraPerKm') ? Number(pb.extraPerKm) || 0 : null;
    const listing = agreed === null ? await M().Listing.findByPk(b.listingId, { transaction: t }) : null;
    const perKm = agreed !== null ? (agreed > 0 ? agreed : 0) : (listing && Number(listing.extraPerKm) > 0 ? Number(listing.extraPerKm) : 0);
    if (extraKm > 0 && !perKm) throw fail(400, 'NO_KM_RATE', 'This vehicle has no extra-km charge set.', { field: 'extraKm' });
    // C7: with both odometer readings on record, extra km cannot exceed what was really driven.
    const pick = ownerSide(b.pickupCondition);
    const ret = ownerSide(b.returnCondition);
    const odo = (x) => (x && x.odometer !== null && x.odometer !== undefined && Number.isFinite(Number(x.odometer)) ? Number(x.odometer) : null);
    if (extraKm > 0 && odo(pick) !== null && odo(ret) !== null) {
      const driven = Math.max(0, odo(ret) - odo(pick));
      const allowance = Number(b.kmAllowance) || 0;
      const maxExtra = Math.max(0, driven - allowance);
      if (extraKm > maxExtra) {
        throw fail(400, 'EXTRA_KM_TOO_HIGH', `The odometer shows ${driven} km driven${allowance ? ` with ${allowance} km included` : ''}, so at most ${maxExtra} extra km can be charged.`, { field: 'extraKm', maxExtraKm: maxExtra });
      }
    }
    const kmCharge = money(extraKm * perKm);
    const claimed = money(kmCharge + otherCharges);
    if (claimed > 0 && (!note || note.length < 5)) {
      throw fail(400, 'NOTE_REQUIRED', `Explain the extra charges for the ${W.taker} (at least 5 characters).`, { field: 'note' });
    }
    const pending = claimed > 0;
    const now = Date.now();
    await b.update({
      status: B.COMPLETED,
      completedAt: new Date(now),
      extraCharges: 0,
      extraBreakdown: { extraKm, perKm: perKm || null, kmCharge, otherCharges, note, claimed },
      finalAmount: money(Number(b.rentAmount) || 0),
      ownerNote: note,
      chargesStatus: pending ? CH.PENDING : CH.NONE,
      chargesClaimed: claimed,
      chargesNote: pending ? note : null,
      chargesPhotos: pending ? evidence : null,
      chargesRespondBy: pending ? new Date(now + settings.chargesResponseHours * HOUR) : null,
    }, { transaction: t });
    await bumpTripCount(b.listingId, t);
    return b;
  });
  const W = Wb(row);
  if (row.chargesStatus === CH.PENDING) {
    notify.booking(row, {
      to: 'renter',
      title: 'Extra charges to review',
      body: `The ${W.giver} added ₹${row.chargesClaimed} of extra charges for ${row.vehicleTitle}: "${row.chargesNote}". Accept or dispute by ${fmtIst(row.chargesRespondBy)}, otherwise they are accepted automatically.`,
      type: 'RENTAL_CHARGES',
    });
    notify.push(row.ownerId, 'Trip completed', `Your extra charges of ₹${row.chargesClaimed} are waiting for the ${W.taker} to accept.`, { type: 'RENTAL_CHARGES', bookingId: row.id, screen: 'rental_booking' });
  } else {
    notify.booking(row, { to: 'renter', title: 'Trip completed ⭐', body: `How was ${row.vehicleTitle}? Rate your trip.`, type: 'RENTAL_COMPLETED' });
  }
  res.json({ booking: await present(req, row, req.user.id) });
};

/** Charges that count once accepted (by the renter, by the timeout, or upheld / reduced by the admin). */
const chargesFinal = (b, amount) => ({ extraCharges: money(amount), finalAmount: money((Number(b.rentAmount) || 0) + (Number(amount) || 0)) });

/**
 * Auto-accepts PENDING extra charges whose window has passed (lifecycle job + a late answer).
 * Conditional UPDATE: a renter answering at the same moment wins cleanly. Returns true if it changed.
 */
const autoAcceptCharges = async (b, t, now = new Date()) => {
  const { Booking } = M();
  const fin = chargesFinal(b, b.chargesClaimed);
  const [n] = await Booking.update(
    { chargesStatus: CH.AUTO_ACCEPTED, chargesRespondedAt: now, ...fin },
    { where: { id: b.id, chargesStatus: CH.PENDING }, ...(t ? { transaction: t } : {}) },
  );
  if (n) {
    // Keep the in-memory row in step without marking it dirty (it may be saved again by the caller).
    for (const [k, v] of Object.entries({ chargesStatus: CH.AUTO_ACCEPTED, chargesRespondedAt: now, ...fin })) {
      if (typeof b.setDataValue === 'function') b.setDataValue(k, v); else b[k] = v;
    }
  }
  return n > 0;
};

// POST /api/rentals/bookings/:id/charges { action: ACCEPT | DISPUTE, note?, photos? }  (renter / borrower)
const respondCharges = async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').toUpperCase();
  if (!['ACCEPT', 'DISPUTE'].includes(action)) throw fail(400, 'INVALID_INPUT', 'Choose to accept or dispute the charges.', { field: 'action' });
  const note = cleanText(body.note, 1000, { multiline: true }) || null;
  if (action === 'DISPUTE' && (!note || note.length < 10)) {
    throw fail(400, 'NOTE_REQUIRED', 'Explain why you dispute the charges (at least 10 characters).', { field: 'note' });
  }
  const photos = action === 'DISPUTE'
    ? await checkRefs(req.user.id, body.photos, { purposes: ['rental_condition', 'rental_report'], field: 'photos', max: E.LIMITS.MAX_EVIDENCE_PHOTOS, label: 'photo' })
    : [];
  let late = false;
  const row = await mutate(req, async (b, t) => {
    asRenter(b, req);
    if (b.chargesStatus !== CH.PENDING) throw fail(409, 'CHARGES_CLOSED', 'These charges have already been answered.');
    if (!b.chargesRespondBy || new Date(b.chargesRespondBy).getTime() <= Date.now()) {
      late = await autoAcceptCharges(b, t);
      return b;
    }
    const now = new Date();
    if (action === 'ACCEPT') {
      await b.update({ chargesStatus: CH.ACCEPTED, chargesRespondedAt: now, ...chargesFinal(b, b.chargesClaimed) }, { transaction: t });
    } else {
      await b.update({ chargesStatus: CH.DISPUTED, chargesRespondedAt: now, disputeNote: note, disputePhotos: photos }, { transaction: t });
    }
    return b;
  });
  const W = Wb(row);
  if (late) {
    notify.booking(row, { to: 'both', title: 'Extra charges accepted', body: `The answer window passed, so the ₹${row.chargesClaimed} extra charges for ${row.vehicleTitle} were accepted automatically.`, type: 'RENTAL_CHARGES' });
    throw fail(409, 'CHARGES_CLOSED', 'The answer window has passed, so the charges were accepted automatically. Report a problem from the booking if something is wrong.');
  }
  if (row.chargesStatus === CH.ACCEPTED) {
    notify.booking(row, { to: 'owner', title: 'Extra charges accepted ✅', body: `The ${W.taker} accepted ₹${row.chargesClaimed} of extra charges for ${row.vehicleTitle}. Settle them in cash between you.`, type: 'RENTAL_CHARGES' });
  } else {
    notify.booking(row, { to: 'owner', title: 'Extra charges disputed', body: `The ${W.taker} disputed the ₹${row.chargesClaimed} extra charges for ${row.vehicleTitle}. The ZenWe team will review both sides.`, type: 'RENTAL_CHARGES' });
    notify.push(row.renterId, 'Dispute received', `The ZenWe team will review the extra charges for ${row.vehicleTitle} and tell you both the outcome.`, { type: 'RENTAL_CHARGES', bookingId: row.id, screen: 'rental_booking' });
    notify.admin('rental_dispute', 'created', row.id);
  }
  res.json({ booking: await present(req, row, req.user.id) });
};

// POST /api/rentals/bookings/:id/terms { acceptTerms: true }  (renter / borrower; bookings made by older apps)
const acceptTerms = async (req, res) => {
  if (!req.body || req.body.acceptTerms !== true) throw fail(400, 'TERMS_REQUIRED', 'Tick the box to accept the booking terms.', { field: 'acceptTerms' });
  const row = await mutate(req, async (b, t) => {
    asRenter(b, req);
    if (!b.termsPending && b.termsAcceptedAt) return b;
    if (![B.REQUESTED, B.ACCEPTED].includes(b.status)) throw fail(409, 'INVALID_STATE', 'The booking terms can only be accepted before pickup.');
    await b.update({ termsAcceptedAt: new Date(), termsVersion: E.TERMS_VERSION, termsPending: false }, { transaction: t });
    return b;
  });
  notify.booking(row, {});
  res.json({ booking: await present(req, row, req.user.id) });
};

// POST /api/rentals/bookings/:id/condition { stage: PICKUP | RETURN, photos[2-6], odometer, note? }
// Owner / lender: required (when the admin switch is on) before the pickup / return PIN step, odometer
// required. Renter / borrower: optional, their own record. Photos are private media (rental_condition),
// shown to both students and the admin through signed links.
const condition = async (req, res) => {
  const body = req.body || {};
  const stage = String(body.stage || '').toUpperCase();
  if (!E.CONDITION_STAGES.includes(stage)) throw fail(400, 'INVALID_INPUT', 'Stage must be PICKUP or RETURN.', { field: 'stage' });
  const odometer = num(body.odometer, { min: 0, max: E.LIMITS.MAX_ODOMETER, int: true, field: 'odometer', label: 'Odometer reading' });
  const note = cleanText(body.note, 300) || null;
  const photos = await checkRefs(req.user.id, body.photos, {
    purposes: ['rental_condition'], field: 'photos', min: E.LIMITS.MIN_CONDITION_PHOTOS, max: E.LIMITS.MAX_CONDITION_PHOTOS, label: 'photo',
  });
  const row = await mutate(req, async (b, t) => {
    const isOwner = String(b.ownerId) === String(req.user.id);
    const allowed = stage === 'PICKUP'
      ? (isOwner ? [B.ACCEPTED] : [B.ACCEPTED, B.ACTIVE])
      : (isOwner ? [B.ACTIVE] : [B.ACTIVE, B.RETURNED]);
    if (!allowed.includes(b.status)) {
      throw fail(409, 'INVALID_STATE', stage === 'PICKUP' ? 'Pickup photos can be added from confirmation until the trip starts.' : 'Return photos can be added while the vehicle is out, before the return is closed.');
    }
    if (isOwner && odometer === null) throw fail(400, 'INVALID_INPUT', 'Enter the odometer reading (km).', { field: 'odometer' });
    if (stage === 'RETURN' && odometer !== null) {
      const start = ownerSide(b.pickupCondition);
      if (start && start.odometer !== null && start.odometer !== undefined && odometer < Number(start.odometer)) {
        throw fail(400, 'ODOMETER_BACKWARDS', `The return reading must be at least the pickup reading (${start.odometer} km).`, { field: 'odometer' });
      }
    }
    const field = stage === 'PICKUP' ? 'pickupCondition' : 'returnCondition';
    const cur = S.jsonOf(b[field]) || {};
    const next = { ...cur, [isOwner ? 'OWNER' : 'RENTER']: { photos, odometer, note, at: new Date().toISOString() } };
    await b.update({ [field]: next }, { transaction: t });
    return b;
  });
  notify.booking(row, {});
  res.json({ booking: await present(req, row, req.user.id) });
};

const recomputeListingRating = async (listingId) => {
  const { Review, Listing } = M();
  const rows = await Review.findAll({ where: { listingId, role: 'RENTER', isHidden: { [Op.not]: true } }, attributes: ['rating'] });
  const count = rows.length;
  const avg = count ? rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count : 0;
  await Listing.update({ ratingAvg: Math.round(avg * 100) / 100, ratingCount: count }, { where: { id: listingId } });
};

// POST /api/rentals/bookings/:id/rate { rating 1-5, text? }
const rate = async (req, res) => {
  const body = req.body || {};
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, 'INVALID_INPUT', 'Pick a rating from 1 to 5 stars.', { field: 'rating' });
  const text = cleanText(body.text, 500, { multiline: true }) || null;
  const { Booking, Review } = M();
  const b = await loadParty(req);
  if (b.status !== B.COMPLETED) throw fail(409, 'INVALID_STATE', 'You can rate once the trip is completed.');
  const isRenter = String(b.renterId) === String(req.user.id);
  const stamp = isRenter ? 'renterRatedAt' : 'ownerRatedAt';
  // Conditional claim: a double tap can never rate twice.
  const [n] = await Booking.update({ [stamp]: new Date() }, { where: { id: b.id, [stamp]: null } });
  if (!n) throw fail(409, 'ALREADY_RATED', 'You have already rated this trip.');
  try {
    await Review.create({
      bookingId: b.id,
      listingId: b.listingId,
      reviewerId: req.user.id,
      revieweeId: isRenter ? b.ownerId : b.renterId,
      role: isRenter ? 'RENTER' : 'OWNER',
      rating,
      text,
    });
  } catch (err) {
    await Booking.update({ [stamp]: null }, { where: { id: b.id } }).catch(() => {});
    if (/unique|constraint/i.test(String(err && (err.name || err.message)))) throw fail(409, 'ALREADY_RATED', 'You have already rated this trip.');
    throw err;
  }
  if (isRenter) await recomputeListingRating(b.listingId);
  notify.push(isRenter ? b.ownerId : b.renterId, 'New rating', `You received ${rating}★ for ${b.vehicleTitle}.`, { type: 'RENTAL_RATED', bookingId: b.id, screen: 'rental_booking' });
  notify.nudge([b.ownerId, b.renterId], 'booking', b.id, b.status);
  await b.reload();
  res.json({ booking: await present(req, b, req.user.id), message: 'Thanks for rating!' });
};

// POST /api/rentals/bookings/:id/report { category, description, photos? }
const report = async (req, res) => {
  const body = req.body || {};
  const category = String(body.category || '').toUpperCase();
  if (!E.REPORT_CATEGORIES.includes(category)) throw fail(400, 'INVALID_INPUT', 'Pick what went wrong.', { field: 'category' });
  const description = cleanText(body.description, 2000, { multiline: true });
  if (description.length < 10) throw fail(400, 'INVALID_INPUT', 'Describe what happened (at least 10 characters).', { field: 'description' });
  hit('report', req.user.id);
  const { Report } = M();
  const b = await loadParty(req);
  const reportable = [B.ACCEPTED, B.ACTIVE, B.RETURNED, B.COMPLETED, B.CANCELLED, B.EXPIRED];
  if (!reportable.includes(b.status)) throw fail(409, 'INVALID_STATE', 'You can report a problem once the booking is confirmed.');
  const already = await Report.count({ where: { bookingId: b.id, reporterId: req.user.id } });
  if (already >= 3) throw fail(429, 'TOO_MANY_REPORTS', 'You have already reported this booking. Our team will contact you.');
  const photos = await checkRefs(req.user.id, body.photos, { purposes: ['rental_report'], field: 'photos', max: 4, label: 'photo' });
  const isRenter = String(b.renterId) === String(req.user.id);
  const row = await Report.create({
    bookingId: b.id,
    listingId: b.listingId,
    reporterId: req.user.id,
    reporterRole: isRenter ? 'RENTER' : 'OWNER',
    againstUserId: isRenter ? b.ownerId : b.renterId,
    category,
    description,
    photos,
    status: 'OPEN',
  });
  notify.admin('rental_report', 'created', row.id);
  res.status(201).json({ report: { id: row.id, category, status: row.status, createdAt: row.createdAt }, message: 'Reported. The ZenWe team will look into it and contact you.' });
};

module.exports = {
  create, list, getOne, accept, decline, cancel, handover, markReturned, complete, rate, report,
  respondCharges, acceptTerms, condition, autoAcceptCharges, chargesFinal,
  withListingLock, bumpTripCount, recomputeListingRating, expireIfStale, ratingOf, modeOf,
};
