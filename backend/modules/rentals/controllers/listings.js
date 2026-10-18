// Student vehicle listings: browse, detail, quote, and the owner's create / edit / submit / pause / delete.
const { Op } = require('sequelize');
const { getModel, getSequelize } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUuid, num, hit } = require('../services/util');
const { checkRefs, toPath } = require('../services/media');
const { quote, scheduleProblem, validateWindow, parseTime, HHMM_RE } = require('../services/pricing');
const S = require('../services/serialize');
const notify = require('../services/notify');
const { loadContext, readFlag, REASON_MESSAGES } = require('../services/eligibility');
const safety = require('../services/safety');

/**
 * C7 (security P2): a listing is only visible / priceable to students of its own campus (same rule as
 * browse). Viewers without a campus profile see what browse shows them. The owner always sees their own.
 * 404 (not 403) so ids from another campus cannot be probed.
 */
const assertSameCampus = (req, row) => {
  const ctx = req.rentals && req.rentals.ctx;
  const viewerCampus = ctx && ctx.campusId;
  if (row.campusId && viewerCampus && String(row.campusId) !== String(viewerCampus)) {
    throw fail(404, 'NOT_FOUND', 'This vehicle is not available any more.');
  }
};

const M = () => ({
  Listing: getModel('RentalListing'),
  Booking: getModel('RentalBooking'),
  Licence: getModel('RentalLicence'),
  Review: getModel('RentalReview'),
  User: getModel('User'),
});

const USER_ATTRS = ['id', 'name', 'profileImage', 'isActive'];
const KEY_FIELDS = ['vehicleType', 'make', 'model', 'year', 'fuel', 'transmission', 'seats', 'registrationNumber', 'plateType', 'photos', 'documents'];

// Indian plates: AP07AB1234 / AP7A123 / Bharat series 22BH1234AB.
const REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
const BH_RE = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const normReg = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const enumOf = (v, list, field, label) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).toUpperCase().trim();
  if (!list.includes(s)) throw fail(400, 'INVALID_INPUT', `${label} must be one of: ${list.join(', ')}.`, { field });
  return s;
};

const parseWeekly = (v) => {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'INVALID_INPUT', 'Weekly hours are not valid.', { field: 'weeklyHours' });
  const out = {};
  for (const [k, w] of Object.entries(v)) {
    if (!/^[0-6]$/.test(k)) throw fail(400, 'INVALID_INPUT', 'Weekly hours are not valid.', { field: 'weeklyHours' });
    if (w === null || w === false) continue;
    if (typeof w !== 'object' || !HHMM_RE.test(String(w.start)) || !HHMM_RE.test(String(w.end)) || w.start === w.end) {
      throw fail(400, 'INVALID_INPUT', 'Each day needs a start and end time like 08:00 and 20:00.', { field: 'weeklyHours' });
    }
    out[k] = { start: w.start, end: w.end };
  }
  return out;
};

const parseBlocked = (v) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > E.LIMITS.MAX_BLOCKED_RANGES) {
    throw fail(400, 'INVALID_INPUT', `You can block up to ${E.LIMITS.MAX_BLOCKED_RANGES} date ranges.`, { field: 'blockedDates' });
  }
  return v.map((r) => {
    const start = r && String(r.start || '');
    const end = r && String(r.end || r.start || '');
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || start > end) {
      throw fail(400, 'INVALID_INPUT', 'Blocked dates must be ranges like 2026-10-20 to 2026-10-22.', { field: 'blockedDates' });
    }
    return { start, end };
  });
};

/**
 * Validates the editable fields present in `body`. Returns only the fields that were sent.
 * existing: current row (for photo/document refs that are kept unchanged).
 */
const parseInput = async (userId, body, existing = null) => {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (has('vehicleType') || !existing) out.vehicleType = enumOf(b.vehicleType, E.VEHICLE_TYPES, 'vehicleType', 'Vehicle type');
  if (!existing && !out.vehicleType) throw fail(400, 'INVALID_INPUT', 'Pick bike, scooter or car.', { field: 'vehicleType' });
  if (has('make')) out.make = cleanText(b.make, 40) || null;
  if (has('model')) out.model = cleanText(b.model, 60) || null;
  if (has('year')) out.year = num(b.year, { min: 1990, max: new Date().getFullYear() + 1, int: true, field: 'year', label: 'Year' });
  if (has('fuel')) out.fuel = enumOf(b.fuel, E.FUELS, 'fuel', 'Fuel');
  if (has('transmission')) out.transmission = enumOf(b.transmission, E.TRANSMISSIONS, 'transmission', 'Transmission');
  if (has('seats')) out.seats = num(b.seats, { min: 2, max: 9, int: true, field: 'seats', label: 'Seats' });
  if (has('registrationNumber')) {
    const reg = normReg(b.registrationNumber);
    if (reg && !(REG_RE.test(reg) || BH_RE.test(reg))) {
      throw fail(400, 'INVALID_INPUT', 'Enter the registration number as on the RC, e.g. AP 07 AB 1234.', { field: 'registrationNumber' });
    }
    out.registrationNumber = reg || null;
  }
  if (has('plateType')) out.plateType = enumOf(b.plateType, E.PLATE_TYPES, 'plateType', 'Number plate type');
  if (has('photos')) {
    out.photos = await checkRefs(userId, b.photos, {
      purposes: ['rental_photo'], field: 'photos', max: E.LIMITS.MAX_PHOTOS, keep: existing ? existing.photos : [], label: 'photo',
    });
  }
  if (has('documents')) {
    const d = b.documents && typeof b.documents === 'object' && !Array.isArray(b.documents) ? b.documents : null;
    if (!d) throw fail(400, 'INVALID_INPUT', 'Documents are not valid.', { field: 'documents' });
    const prev = existing && existing.documents && typeof existing.documents === 'object' ? existing.documents : {};
    const docs = {};
    for (const key of ['rc', 'insurance', 'licence']) {
      if (d[key] === undefined) { if (prev[key]) docs[key] = prev[key]; continue; }
      if (d[key] === null || d[key] === '') continue;
      const [p] = await checkRefs(userId, [d[key]], { purposes: ['rental_doc'], field: `documents.${key}`, max: 1, keep: prev[key] ? [prev[key]] : [], label: 'document' });
      docs[key] = p;
    }
    out.documents = docs;
  }
  if (has('pricePerHour')) out.pricePerHour = num(b.pricePerHour, { min: 0, max: E.LIMITS.MAX_PRICE_PER_HOUR, field: 'pricePerHour', label: 'Price per hour' }) || null;
  if (has('pricePerDay')) out.pricePerDay = num(b.pricePerDay, { min: 0, max: E.LIMITS.MAX_PRICE_PER_DAY, field: 'pricePerDay', label: 'Price per day' }) || null;
  if (has('securityDeposit')) out.securityDeposit = num(b.securityDeposit, { min: 0, max: E.LIMITS.MAX_DEPOSIT, field: 'securityDeposit', label: 'Security deposit' }) || 0;
  if (has('minHours')) out.minHours = num(b.minHours, { min: 1, max: E.LIMITS.MAX_MIN_HOURS, int: true, field: 'minHours', label: 'Minimum hours' }) || 1;
  if (has('kmLimitPerDay')) out.kmLimitPerDay = num(b.kmLimitPerDay, { min: 0, max: E.LIMITS.MAX_KM_PER_DAY, int: true, field: 'kmLimitPerDay', label: 'Km limit per day' }) || null;
  if (has('extraPerKm')) out.extraPerKm = num(b.extraPerKm, { min: 0, max: E.LIMITS.MAX_EXTRA_PER_KM, field: 'extraPerKm', label: 'Extra charge per km' }) || null;
  if (has('fuelPolicy')) out.fuelPolicy = cleanText(b.fuelPolicy, 300) || null;
  if (has('pickupLocation')) out.pickupLocation = cleanText(b.pickupLocation, 200) || null;
  if (has('pickupLat') || has('pickupLon')) {
    const lat = num(b.pickupLat, { min: -90, max: 90, field: 'pickupLat', label: 'Latitude' });
    const lon = num(b.pickupLon, { min: -180, max: 180, field: 'pickupLon', label: 'Longitude' });
    if ((lat === null) !== (lon === null)) throw fail(400, 'INVALID_INPUT', 'Send both latitude and longitude, or neither.', { field: 'pickupLat' });
    out.pickupLat = lat === null ? null : Number(b.pickupLat);
    out.pickupLon = lon === null ? null : Number(b.pickupLon);
  }
  if (has('weeklyHours')) out.weeklyHours = parseWeekly(b.weeklyHours);
  if (has('blockedDates')) out.blockedDates = parseBlocked(b.blockedDates);
  if (has('rules')) out.rules = cleanText(b.rules, 1000, { multiline: true }) || null;
  if (has('helmetIncluded')) out.helmetIncluded = b.helmetIncluded === true || b.helmetIncluded === 'true';
  return out;
};

/** Field-level normalisation that depends on the vehicle type. */
const normaliseForType = (data) => {
  if (data.vehicleType === 'CAR') {
    data.helmetIncluded = false;
  } else if (data.vehicleType) {
    data.seats = null;
  }
  return data;
};

/** Missing items before a listing can be reviewed (empty = complete). */
const missingFor = (l) => {
  const miss = [];
  if (!l.vehicleType) miss.push('vehicleType');
  if (!l.make) miss.push('make');
  if (!l.model) miss.push('model');
  if (!l.year) miss.push('year');
  if (!l.fuel) miss.push('fuel');
  if (l.vehicleType === 'CAR' && !l.transmission) miss.push('transmission');
  if (l.vehicleType === 'CAR' && !l.seats) miss.push('seats');
  if (!l.registrationNumber) miss.push('registrationNumber');
  if (!l.plateType) miss.push('plateType');
  if (!Array.isArray(l.photos) || l.photos.length < E.LIMITS.MIN_PHOTOS) miss.push('photos');
  const d = l.documents || {};
  if (!d.rc) miss.push('documents.rc');
  if (!d.insurance) miss.push('documents.insurance');
  if (!d.licence) miss.push('documents.licence');
  if (!(Number(l.pricePerHour) > 0) && !(Number(l.pricePerDay) > 0)) miss.push('price');
  if (!l.pickupLocation) miss.push('pickupLocation');
  return miss;
};
const MISSING_LABELS = {
  vehicleType: 'vehicle type', make: 'make', model: 'model', year: 'year', fuel: 'fuel', transmission: 'transmission', seats: 'seats',
  registrationNumber: 'registration number', plateType: 'number plate type', photos: 'at least one photo', 'documents.rc': 'RC photo',
  'documents.insurance': 'insurance photo', 'documents.licence': "your driving licence photo", price: 'a price per hour or per day', pickupLocation: 'pickup location',
};
const assertComplete = (l) => {
  const miss = missingFor(l);
  if (miss.length) {
    throw fail(400, 'INCOMPLETE', `Add ${miss.map((m) => MISSING_LABELS[m] || m).join(', ')} before sending for review.`, { missing: miss });
  }
};

/** The same vehicle (plate) cannot be listed twice. */
const assertUniquePlate = async (reg, exceptId) => {
  if (!reg) return;
  const { Listing } = M();
  const where = { registrationNumber: reg, status: { [Op.ne]: E.LISTING_STATUS.DELETED } };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  const dup = await Listing.findOne({ where, attributes: ['id'] });
  if (dup) throw fail(409, 'DUPLICATE_VEHICLE', 'A vehicle with this registration number is already listed. Contact support if this is your vehicle.');
};

const loadOwned = async (req) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Listing not found.');
  const { Listing } = M();
  const row = await Listing.findByPk(id);
  if (!row || row.status === E.LISTING_STATUS.DELETED || String(row.ownerId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'Listing not found.');
  return row;
};

/** Average rating students gave this owner across all their vehicles. */
const ownerRatingOf = async (ownerId) => {
  const { Review } = M();
  const rows = await Review.findAll({ where: { revieweeId: ownerId, role: 'RENTER', isHidden: { [Op.not]: true } }, attributes: ['rating'] });
  if (!rows.length) return null;
  const avg = rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / rows.length;
  return { avg: Math.round(avg * 10) / 10, count: rows.length };
};

// ── Handlers ────────────────────────────────────────────────────────────────

// GET /api/rentals/eligibility
const eligibility = async (req, res) => {
  const [ctx, enabled] = await Promise.all([loadContext(req.user.id), readFlag()]);
  const { Licence, Listing, Booking } = M();
  const lic = await Licence.findOne({ where: { userId: req.user.id } });
  const [myListings, openRequests] = await Promise.all([
    Listing.count({ where: { ownerId: req.user.id, status: { [Op.ne]: E.LISTING_STATUS.DELETED } } }),
    Booking.count({ where: { ownerId: req.user.id, status: E.BOOKING_STATUS.REQUESTED } }),
  ]);
  res.json({
    enabled,
    eligible: ctx.eligible,
    reasons: ctx.reasons,
    message: ctx.eligible ? null : REASON_MESSAGES[ctx.reasons[0]] || null,
    campus: ctx.campus ? { id: ctx.campus.id, name: ctx.campus.name, code: ctx.campus.code } : null,
    licence: S.licenceOwn(req, lic),
    myListings,
    openRequests,
  });
};

// GET /api/rentals/listings?type=&maxPricePerHour=&maxPricePerDay=&startAt=&endAt=&sort=&q=
const browse = async (req, res) => {
  const { Listing, Booking, User } = M();
  const ctx = req.rentals.ctx;
  const where = { status: E.LISTING_STATUS.APPROVED, deletedAt: null };
  if (ctx.campusId) where.campusId = ctx.campusId;
  const type = req.query.type ? enumOf(req.query.type, E.VEHICLE_TYPES, 'type', 'Type') : null;
  if (type) where.vehicleType = type;
  const maxHour = num(req.query.maxPricePerHour, { min: 0, max: E.LIMITS.MAX_PRICE_PER_HOUR, field: 'maxPricePerHour' });
  const maxDay = num(req.query.maxPricePerDay, { min: 0, max: E.LIMITS.MAX_PRICE_PER_DAY, field: 'maxPricePerDay' });
  if (maxHour !== null) where.pricePerHour = { [Op.ne]: null, [Op.lte]: maxHour };
  if (maxDay !== null) where.pricePerDay = { [Op.ne]: null, [Op.lte]: maxDay };
  const q = cleanText(req.query.q, 40);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '')}%`;
    const LIKE = Listing.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
    where[Op.or] = [{ make: { [LIKE]: like } }, { model: { [LIKE]: like } }];
  }
  const sort = String(req.query.sort || 'recent');
  const order = sort === 'price_low' ? [['pricePerDay', 'ASC'], ['pricePerHour', 'ASC']]
    : sort === 'rating' ? [['ratingAvg', 'DESC'], ['ratingCount', 'DESC']]
      : [['approvedAt', 'DESC'], ['createdAt', 'DESC']];
  let rows = await Listing.findAll({ where, order, limit: 200 });

  // Owners whose accounts were suspended are hidden.
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const owners = ownerIds.length ? await User.findAll({ where: { id: { [Op.in]: ownerIds } }, attributes: USER_ATTRS }) : [];
  const ownerById = new Map(owners.map((u) => [String(u.id), u]));
  rows = rows.filter((r) => { const o = ownerById.get(String(r.ownerId)); return o && o.isActive !== false; });

  // Date filter: only vehicles free (hours, blocked dates, other bookings) for the whole window.
  let window = null;
  if (req.query.startAt || req.query.endAt) {
    const start = parseTime(req.query.startAt, 'startAt');
    const end = parseTime(req.query.endAt, 'endAt');
    validateWindow(start, end);
    window = { start, end };
    rows = rows.filter((r) => !scheduleProblem(r, start, end));
    if (rows.length) {
      const busy = await Booking.findAll({
        where: { listingId: { [Op.in]: rows.map((r) => r.id) }, status: { [Op.in]: E.HOLDING_STATUSES }, startAt: { [Op.lt]: end }, endAt: { [Op.gt]: start } },
        attributes: ['listingId'],
      });
      const busyIds = new Set(busy.map((b) => String(b.listingId)));
      rows = rows.filter((r) => !busyIds.has(String(r.id)));
    }
  }
  const listings = rows.slice(0, 100).map((r) => {
    const item = S.listingPublic(req, r, { owner: ownerById.get(String(r.ownerId)), viewerId: req.user.id });
    if (window) {
      try { item.quote = quote(r, window.start, window.end); } catch { item.quote = null; }
    }
    return item;
  });
  res.json({ listings, count: listings.length, campus: ctx.campus ? { id: ctx.campus.id, name: ctx.campus.name } : null });
};

// GET /api/rentals/listings/:id
const detail = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Listing not found.');
  const { Listing, Booking, Review, User } = M();
  const row = await Listing.findByPk(id);
  const mine = row && String(row.ownerId) === String(req.user.id);
  if (!row || row.status === E.LISTING_STATUS.DELETED || (!mine && row.status !== E.LISTING_STATUS.APPROVED)) {
    throw fail(404, 'NOT_FOUND', 'This vehicle is not available any more.');
  }
  if (!mine) assertSameCampus(req, row);
  const owner = await User.findByPk(row.ownerId, { attributes: USER_ATTRS });
  if (!mine && (!owner || owner.isActive === false)) throw fail(404, 'NOT_FOUND', 'This vehicle is not available any more.');
  const [busy, reviews, ownerRating, safetyInfo] = await Promise.all([
    Booking.findAll({
      where: { listingId: row.id, status: { [Op.in]: E.HOLDING_STATUSES }, endAt: { [Op.gt]: new Date() } },
      attributes: ['startAt', 'endAt', 'status'],
      order: [['startAt', 'ASC']],
      limit: 50,
    }),
    Review.findAll({ where: { listingId: row.id, role: 'RENTER', isHidden: { [Op.not]: true } }, order: [['createdAt', 'DESC']], limit: 10 }),
    ownerRatingOf(row.ownerId),
    safety.safetyInfo(E.rentalMode(row.plateType)),
  ]);
  const reviewers = reviews.length ? await User.findAll({ where: { id: { [Op.in]: reviews.map((r) => r.reviewerId) } }, attributes: ['id', 'name', 'profileImage'] }) : [];
  const byId = new Map(reviewers.map((u) => [String(u.id), u]));
  const listing = mine ? S.listingOwner(req, row) : S.listingPublic(req, row, { owner, viewerId: req.user.id, ownerRating });
  if (mine) listing.owner = { ...S.userBrief(req, owner), verified: true, rating: ownerRating };
  res.json({
    listing,
    // C7: mode-specific booking terms + the insurance / liability disclaimer (listing detail + booking review).
    safety: safetyInfo,
    busy: busy.map((b) => ({ startAt: new Date(b.startAt).toISOString(), endAt: new Date(b.endAt).toISOString(), pending: b.status === E.BOOKING_STATUS.REQUESTED })),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      text: r.text || '',
      reviewer: S.userBrief(req, byId.get(String(r.reviewerId))),
      createdAt: new Date(r.createdAt).toISOString(),
    })),
  });
};

// GET /api/rentals/listings/:id/quote?startAt=&endAt=  (display only; booking re-prices on the server)
const getQuote = async (req, res) => {
  const id = String(req.params.id || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'Listing not found.');
  const { Listing, Booking } = M();
  const row = await Listing.findByPk(id);
  if (!row || row.status !== E.LISTING_STATUS.APPROVED) throw fail(404, 'NOT_FOUND', 'This vehicle is not available any more.');
  if (String(row.ownerId) !== String(req.user.id)) assertSameCampus(req, row);
  const start = parseTime(req.query.startAt, 'startAt');
  const end = parseTime(req.query.endAt, 'endAt');
  validateWindow(start, end);
  const q = quote(row, start, end);
  const problem = scheduleProblem(row, start, end);
  let available = !problem;
  let reason = problem;
  if (available) {
    const clash = await Booking.findOne({
      where: { listingId: row.id, status: { [Op.in]: E.HOLDING_STATUSES }, startAt: { [Op.lt]: end }, endAt: { [Op.gt]: start } },
      attributes: ['id'],
    });
    if (clash) { available = false; reason = { code: 'SLOT_TAKEN', message: 'Someone has already booked or requested this vehicle for part of that time.' }; }
  }
  res.set('Cache-Control', 'no-store');
  res.json({ quote: q, available, reason: reason || null });
};

// GET /api/rentals/my/listings
const myListings = async (req, res) => {
  const { Listing, Booking } = M();
  const rows = await Listing.findAll({
    where: { ownerId: req.user.id, status: { [Op.ne]: E.LISTING_STATUS.DELETED } },
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  const ids = rows.map((r) => r.id);
  const open = ids.length ? await Booking.findAll({
    where: { listingId: { [Op.in]: ids }, status: { [Op.in]: E.OPEN_STATUSES } },
    attributes: ['listingId', 'status'],
  }) : [];
  const counts = {};
  open.forEach((b) => {
    const c = counts[b.listingId] || (counts[b.listingId] = { pendingRequests: 0, upcoming: 0 });
    if (b.status === E.BOOKING_STATUS.REQUESTED) c.pendingRequests++;
    else c.upcoming++;
  });
  res.json({
    listings: rows.map((r) => S.listingOwner(req, r, {
      pendingRequests: (counts[r.id] && counts[r.id].pendingRequests) || 0,
      openBookings: (counts[r.id] && counts[r.id].upcoming) || 0,
      missing: missingFor(r.get({ plain: true })),
    })),
  });
};

// POST /api/rentals/listings  { ...fields, submit?: boolean }
const create = async (req, res) => {
  hit('listing_create', req.user.id);
  const { Listing } = M();
  const data = normaliseForType(await parseInput(req.user.id, req.body));
  await assertUniquePlate(data.registrationNumber);
  const submit = req.body && (req.body.submit === true || req.body.submit === 'true');
  const draft = { ...data, ownerId: req.user.id, campusId: req.rentals.ctx.campusId, status: E.LISTING_STATUS.DRAFT };
  if (submit) {
    assertComplete(draft);
    draft.status = E.LISTING_STATUS.PENDING_REVIEW;
    draft.submittedAt = new Date();
  }
  const row = await Listing.create(draft);
  if (submit) notify.admin('rental_listing', 'created', row.id);
  res.status(201).json({ listing: S.listingOwner(req, row, { missing: missingFor(row.get({ plain: true })) }) });
};

// PATCH /api/rentals/listings/:id
const update = async (req, res) => {
  hit('listing_write', req.user.id);
  const row = await loadOwned(req);
  const before = row.get({ plain: true });
  const data = await parseInput(req.user.id, req.body, before);
  const merged = normaliseForType({ ...before, ...data });
  // Keep the type-dependent clean-up on the stored row too.
  ['seats', 'helmetIncluded'].forEach((k) => { if (k in data || merged[k] !== before[k]) data[k] = merged[k]; });
  if (data.registrationNumber !== undefined && data.registrationNumber !== before.registrationNumber) {
    await assertUniquePlate(data.registrationNumber, row.id);
  }
  const keyChanged = KEY_FIELDS.some((k) => data[k] !== undefined && JSON.stringify(data[k]) !== JSON.stringify(before[k]));
  const visibleBefore = before.status === E.LISTING_STATUS.APPROVED;
  if ([E.LISTING_STATUS.APPROVED, E.LISTING_STATUS.PAUSED, E.LISTING_STATUS.PENDING_REVIEW].includes(before.status)) {
    assertComplete(merged); // a live listing must stay complete
  }
  let sentToReview = false;
  if (keyChanged && [E.LISTING_STATUS.APPROVED, E.LISTING_STATUS.PAUSED].includes(before.status)) {
    data.status = E.LISTING_STATUS.PENDING_REVIEW;
    data.submittedAt = new Date();
    data.rejectionReason = null;
    sentToReview = true;
  } else if (before.status === E.LISTING_STATUS.PENDING_REVIEW && keyChanged) {
    data.submittedAt = new Date();
  }
  await row.update(data);
  if (sentToReview) notify.admin('rental_listing', 'updated', row.id);
  if (visibleBefore) notify.listingChanged(row.id);
  res.json({
    listing: S.listingOwner(req, row, { missing: missingFor(row.get({ plain: true })) }),
    sentToReview,
    message: sentToReview ? 'Your changes need a quick review. The vehicle is hidden until an admin approves them.' : 'Saved.',
  });
};

// POST /api/rentals/listings/:id/submit
const submit = async (req, res) => {
  const row = await loadOwned(req);
  if (![E.LISTING_STATUS.DRAFT, E.LISTING_STATUS.REJECTED].includes(row.status)) {
    throw fail(409, 'INVALID_STATE', row.status === E.LISTING_STATUS.PENDING_REVIEW ? 'This vehicle is already waiting for review.' : 'This vehicle is already reviewed.');
  }
  assertComplete(row.get({ plain: true }));
  await assertUniquePlate(row.registrationNumber, row.id);
  await row.update({ status: E.LISTING_STATUS.PENDING_REVIEW, submittedAt: new Date(), rejectionReason: null });
  notify.admin('rental_listing', 'created', row.id);
  res.json({ listing: S.listingOwner(req, row), message: 'Sent for review. We will notify you when it is live.' });
};

// POST /api/rentals/listings/:id/pause | /resume
const pause = async (req, res) => {
  const row = await loadOwned(req);
  if (row.status !== E.LISTING_STATUS.APPROVED) throw fail(409, 'INVALID_STATE', 'Only a live vehicle can be paused.');
  await row.update({ status: E.LISTING_STATUS.PAUSED });
  notify.listingChanged(row.id);
  res.json({ listing: S.listingOwner(req, row), message: 'Paused. Students cannot send new requests until you resume.' });
};
const resume = async (req, res) => {
  const row = await loadOwned(req);
  if (row.status !== E.LISTING_STATUS.PAUSED) throw fail(409, 'INVALID_STATE', 'Only a paused vehicle can be resumed.');
  await row.update({ status: E.LISTING_STATUS.APPROVED });
  notify.listingChanged(row.id);
  res.json({ listing: S.listingOwner(req, row), message: 'Live again.' });
};

// DELETE /api/rentals/listings/:id  (soft delete)
const remove = async (req, res) => {
  const owned = await loadOwned(req);
  const { Booking, Listing } = M();
  // B22: under the same listing lock + transaction as booking accept / request, so an accept
  // racing the removal either lands first (removal refused) or sees the vehicle gone.
  const { withListingLock } = require('./bookings');
  const { Transaction } = require('sequelize');
  const declined = [];
  let wasVisible = false;
  let alreadyGone = false;
  let row = owned;
  await withListingLock(owned.id, () => getSequelize().transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
    row = await Listing.findByPk(owned.id, { transaction: t });
    if (!row || row.status === E.LISTING_STATUS.DELETED) { alreadyGone = true; return; }
    const live = await Booking.count({ where: { listingId: row.id, status: { [Op.in]: [E.BOOKING_STATUS.ACCEPTED, E.BOOKING_STATUS.ACTIVE, E.BOOKING_STATUS.RETURNED] } }, transaction: t });
    if (live) throw fail(409, 'HAS_ACTIVE_BOOKINGS', 'This vehicle has confirmed or ongoing trips. Finish or cancel them first.');
    const pending = await Booking.findAll({ where: { listingId: row.id, status: E.BOOKING_STATUS.REQUESTED }, transaction: t });
    for (const b of pending) {
      const [n] = await Booking.update(
        { status: E.BOOKING_STATUS.DECLINED, declinedAt: new Date(), declineReason: 'The owner removed this vehicle.' },
        { where: { id: b.id, status: E.BOOKING_STATUS.REQUESTED }, transaction: t },
      );
      if (n) { b.status = E.BOOKING_STATUS.DECLINED; declined.push(b); }
    }
    wasVisible = row.status === E.LISTING_STATUS.APPROVED;
    await row.update({ status: E.LISTING_STATUS.DELETED, deletedAt: new Date() }, { transaction: t });
  }));
  if (alreadyGone) return res.json({ ok: true, message: 'Vehicle removed.' });
  for (const b of declined) {
    notify.booking(b, { to: 'renter', title: `${E.wordsFor(b.rentalMode).Request} declined`, body: `${b.vehicleTitle || 'The vehicle'} is no longer listed.`, type: 'RENTAL_DECLINED' });
  }
  if (wasVisible) notify.listingChanged(row.id);
  notify.admin('rental_listing', 'deleted', row.id);
  res.json({ ok: true, message: 'Vehicle removed.' });
};

module.exports = {
  eligibility, browse, detail, getQuote, myListings, create, update, submit, pause, resume, remove,
  missingFor, assertComplete, toPath, ownerRatingOf, assertSameCampus,
};
