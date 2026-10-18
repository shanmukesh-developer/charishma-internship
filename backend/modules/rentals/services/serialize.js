// Every Rentals payload is built here, per viewer. Privacy rules:
//  - documents (RC, insurance, owner's licence), licence images / numbers: owner (self) + admin only,
//    as 1-hour signed links.
//  - registration number: full to the owner and admin, and to the renter of an ACCEPTED/ACTIVE/RETURNED
//    booking; masked (AP 07 •• 1234) everywhere else. plateType: owner + admin.
//  - phone numbers: only between the two students of an ACCEPTED/ACTIVE/RETURNED booking.
//  - pickup / return PINs: only to the renter.
const { absolutize, avatarUrlFor } = require('../../campus/campusHelpers');
const { CONTACT_STATUSES, BOOKING_STATUS, CHARGES_STATUS, rentalMode } = require('../enums');

const signed = (req, path) => {
  if (!path) return null;
  try {
    return require('../../campus/controllers/mediaController').signedMediaUrl(req, path);
  } catch {
    return null;
  }
};
const abs = (req, path) => (path ? absolutize(req, path) : null);

/** 'AP07AB1234' -> 'AP 07 •• 1234'. Anything shorter keeps only its last 2 characters. */
const maskReg = (reg) => {
  const r = String(reg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r) return null;
  const m = /^([A-Z]{2})(\d{1,2})[A-Z0-9]*?(\d{1,4})$/.exec(r);
  if (m && r.length >= 6) return `${m[1]} ${m[2].padStart(2, '0')} •• ${m[3]}`;
  if (r.length >= 6) return `${r.slice(0, 2)} •• ${r.slice(-4)}`;
  return `•• ${r.slice(-2)}`;
};
/** Display form of a stored plate: 'AP07AB1234' -> 'AP 07 AB 1234'. */
const prettyReg = (reg) => {
  const r = String(reg || '').toUpperCase();
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(r);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : r || null;
};
const maskLicence = (n) => {
  const s = String(n || '');
  return s.length > 4 ? `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}` : s ? '••••' : null;
};

const firstName = (name) => String(name || 'Student').trim().split(/\s+/)[0].slice(0, 30) || 'Student';
const titleOf = (l) => [l.make, l.model].filter(Boolean).join(' ').trim() || (l.vehicleType === 'CAR' ? 'Car' : l.vehicleType === 'SCOOTER' ? 'Scooter' : 'Bike');
const iso = (d) => (d ? new Date(d).toISOString() : null);
const plain = (row) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : row || {});
const jsonOf = (v) => {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v && typeof v === 'object' ? v : null;
};

/** C7: RENT / BORROW for a booking (its snapshot, else the listing's plate type). */
const modeOfBooking = (b, l) => (b.rentalMode === 'RENT' || b.rentalMode === 'BORROW' ? b.rentalMode : rentalMode(l ? l.plateType : null));

/** C7 pickup / return condition record -> { owner, renter } with 1-hour signed photo links. */
const conditionOut = (req, raw) => {
  const c = jsonOf(raw);
  if (!c) return null;
  const side = (x) => (x && typeof x === 'object' ? {
    photos: (Array.isArray(x.photos) ? x.photos : []).map((p) => signed(req, p)).filter(Boolean),
    odometer: x.odometer === undefined || x.odometer === null ? null : Number(x.odometer),
    note: x.note || null,
    at: x.at || null,
  } : null);
  const out = { owner: side(c.OWNER), renter: side(c.RENTER) };
  return out.owner || out.renter ? out : null;
};

/** C7 extra-charges claim, as both students and the admin see it. */
const chargesOut = (req, b) => {
  const status = b.chargesStatus || CHARGES_STATUS.NONE;
  const signedList = (v) => (Array.isArray(jsonOf(v)) ? jsonOf(v) : []).map((p) => signed(req, p)).filter(Boolean);
  const res = jsonOf(b.chargesResolution);
  return {
    status,
    claimed: Number(b.chargesClaimed) || 0,
    counted: Number(b.extraCharges) || 0,
    note: b.chargesNote || null,
    photos: signedList(b.chargesPhotos),
    respondBy: iso(b.chargesRespondBy),
    respondedAt: iso(b.chargesRespondedAt),
    disputeNote: b.disputeNote || null,
    disputePhotos: signedList(b.disputePhotos),
    resolution: res ? { outcome: res.outcome || null, amount: res.amount != null ? Number(res.amount) : null, reason: res.reason || null, at: res.at || null } : null,
  };
};

const userBrief = (req, user, { full = false } = {}) => (user ? {
  id: user.id,
  name: full ? String(user.name || 'Student').slice(0, 60) : firstName(user.name),
  avatar: avatarUrlFor(req, user),
} : null);

const commonListing = (req, l) => ({
  id: l.id,
  title: titleOf(l),
  // C7: RENT (commercial plate) or BORROW (private plate); the apps label and badge with it.
  rentalMode: rentalMode(l.plateType),
  vehicleType: l.vehicleType,
  make: l.make || null,
  model: l.model || null,
  year: l.year || null,
  fuel: l.fuel || null,
  transmission: l.transmission || null,
  seats: l.seats || null,
  registrationMasked: maskReg(l.registrationNumber),
  photos: (Array.isArray(l.photos) ? l.photos : []).map((p) => abs(req, p)).filter(Boolean),
  pricePerHour: l.pricePerHour || null,
  pricePerDay: l.pricePerDay || null,
  securityDeposit: Number(l.securityDeposit) || 0,
  minHours: Number(l.minHours) || 1,
  kmLimitPerDay: l.kmLimitPerDay || null,
  extraPerKm: l.extraPerKm || null,
  fuelPolicy: l.fuelPolicy || null,
  pickupLocation: l.pickupLocation || null,
  pickupLat: l.pickupLat ?? null,
  pickupLon: l.pickupLon ?? null,
  weeklyHours: l.weeklyHours && typeof l.weeklyHours === 'object' ? l.weeklyHours : {},
  blockedDates: Array.isArray(l.blockedDates) ? l.blockedDates : [],
  rules: l.rules || null,
  helmetIncluded: !!l.helmetIncluded,
  ratingAvg: Math.round((Number(l.ratingAvg) || 0) * 10) / 10,
  ratingCount: Number(l.ratingCount) || 0,
  tripCount: Number(l.tripCount) || 0,
});

/** Any signed-in student browsing. */
const listingPublic = (req, row, { owner, viewerId, ownerRating } = {}) => {
  const l = plain(row);
  return {
    ...commonListing(req, l),
    status: l.status,
    isMine: !!viewerId && String(viewerId) === String(l.ownerId),
    owner: owner ? { ...userBrief(req, owner), verified: true, rating: ownerRating || null } : null,
    createdAt: iso(l.createdAt),
  };
};

const docsFor = (req, docs) => {
  const d = docs && typeof docs === 'object' ? docs : {};
  return { rc: signed(req, d.rc), insurance: signed(req, d.insurance), licence: signed(req, d.licence) };
};

/** The owner's own listing (My listings / edit form). */
const listingOwner = (req, row, extra = {}) => {
  const l = plain(row);
  return {
    ...commonListing(req, l),
    isMine: true,
    status: l.status,
    rejectionReason: l.rejectionReason || null,
    registrationNumber: l.registrationNumber || null,
    registrationDisplay: prettyReg(l.registrationNumber),
    plateType: l.plateType || null,
    // Paths to send back unchanged when editing; signed links to show them.
    photoRefs: Array.isArray(l.photos) ? l.photos : [],
    documentRefs: l.documents && typeof l.documents === 'object' ? l.documents : {},
    documents: docsFor(req, l.documents),
    submittedAt: iso(l.submittedAt),
    reviewedAt: iso(l.reviewedAt),
    createdAt: iso(l.createdAt),
    updatedAt: iso(l.updatedAt),
    ...extra,
  };
};

/** Admin review screen. */
const listingAdmin = (req, row, { owner } = {}) => {
  const l = plain(row);
  return {
    ...listingOwner(req, row),
    isMine: false,
    ownerId: l.ownerId,
    campusId: l.campusId || null,
    reviewedBy: l.reviewedBy || null,
    deletedAt: iso(l.deletedAt),
    owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone || null, email: owner.email || null, isActive: owner.isActive !== false } : null,
  };
};

/**
 * One booking as seen by `viewerId` (the renter or the owner).
 * ctx: { listing, owner, renter, renterLicence, renterRating, myReview, theirReviewExists }
 */
const bookingFor = (req, row, viewerId, ctx = {}) => {
  const b = plain(row);
  const isRenter = String(viewerId) === String(b.renterId);
  const isOwner = String(viewerId) === String(b.ownerId);
  const contact = CONTACT_STATUSES.includes(b.status);
  const other = isRenter ? ctx.owner : ctx.renter;
  const l = ctx.listing ? plain(ctx.listing) : null;
  const mode = modeOfBooking(b, l);
  const charges = chargesOut(req, b);
  const out = {
    id: b.id,
    role: isRenter ? 'RENTER' : isOwner ? 'OWNER' : 'VIEWER',
    status: b.status,
    rentalMode: mode,
    listingId: b.listingId,
    vehicleTitle: b.vehicleTitle || (l ? titleOf(l) : 'Vehicle'),
    vehicleType: b.vehicleType || (l ? l.vehicleType : null),
    vehiclePhoto: l && Array.isArray(l.photos) && l.photos[0] ? abs(req, l.photos[0]) : null,
    registration: l ? (isOwner || (isRenter && contact) ? prettyReg(l.registrationNumber) : maskReg(l.registrationNumber)) : null,
    pickupLocation: l ? l.pickupLocation || null : null,
    pickupLat: l ? l.pickupLat ?? null : null,
    pickupLon: l ? l.pickupLon ?? null : null,
    fuelPolicy: l ? l.fuelPolicy || null : null,
    rules: l ? l.rules || null : null,
    helmetIncluded: l ? !!l.helmetIncluded : false,
    startAt: iso(b.startAt),
    endAt: iso(b.endAt),
    billableHours: b.billableHours,
    rentAmount: Number(b.rentAmount) || 0,
    depositAmount: Number(b.depositAmount) || 0,
    payAtHandover: Number(b.payAtHandover) || 0,
    kmAllowance: b.kmAllowance || null,
    priceBreakdown: b.priceBreakdown || {},
    extraCharges: Number(b.extraCharges) || 0,
    extraBreakdown: b.extraBreakdown || {},
    finalAmount: b.finalAmount != null ? Number(b.finalAmount) : null,
    paymentMode: 'CASH_AT_HANDOVER',
    renterNote: b.renterNote || null,
    ownerNote: b.ownerNote || null,
    respondBy: iso(b.respondBy),
    acceptedAt: iso(b.acceptedAt),
    declinedAt: iso(b.declinedAt),
    declineReason: b.declineReason || null,
    expiredAt: iso(b.expiredAt),
    handoverAt: iso(b.handoverAt),
    returnedAt: iso(b.returnedAt),
    completedAt: iso(b.completedAt),
    cancelledAt: iso(b.cancelledAt),
    cancelledBy: b.cancelledBy || null,
    cancelReason: b.cancelReason || null,
    createdAt: iso(b.createdAt),
    counterpart: other ? {
      ...userBrief(req, other, { full: contact }),
      phone: contact ? other.phone || null : null,
      rating: (isOwner ? ctx.renterRating : ctx.ownerRating) || null,
    } : null,
    contactVisible: contact,
    pinLocked: !!(b.pinLockedUntil && new Date(b.pinLockedUntil).getTime() > Date.now()),
    // C7 safety
    termsAcceptedAt: iso(b.termsAcceptedAt),
    termsVersion: b.termsVersion || null,
    termsPending: !!b.termsPending,
    pickupCondition: conditionOut(req, b.pickupCondition),
    returnCondition: conditionOut(req, b.returnCondition),
    charges,
    canRespondToCharges: isRenter && charges.status === CHARGES_STATUS.PENDING && !!b.chargesRespondBy && new Date(b.chargesRespondBy).getTime() > Date.now(),
  };
  if (ctx.safety) {
    out.conditionPhotosRequired = !!ctx.safety.conditionPhotosRequired;
    if (isOwner) out.otherChargesCap = require('./safety').otherChargesCapFor(ctx.safety, b.depositAmount);
  }
  if (isRenter) {
    out.pickupPin = b.status === BOOKING_STATUS.ACCEPTED ? b.pickupPin || null : null;
    out.returnPin = b.status === BOOKING_STATUS.ACTIVE ? b.returnPin || null : null;
  }
  if (isOwner && ctx.renterLicence !== undefined) {
    const lic = ctx.renterLicence;
    out.renterLicence = lic ? { status: lic.status, classes: lic.status === 'VERIFIED' ? (lic.verifiedClasses || lic.classes || []) : (lic.classes || []) } : { status: 'MISSING', classes: [] };
  }
  const isClosed = b.status === BOOKING_STATUS.COMPLETED;
  out.canRate = isClosed && ((isRenter && !b.renterRatedAt) || (isOwner && !b.ownerRatedAt));
  out.rated = isClosed && ((isRenter && !!b.renterRatedAt) || (isOwner && !!b.ownerRatedAt));
  out.canReport = [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.ACTIVE, BOOKING_STATUS.RETURNED, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.EXPIRED].includes(b.status);
  return out;
};

/** Admin bookings list: both parties, no PINs. */
const bookingAdmin = (req, row, { owner, renter, listing } = {}) => {
  const b = plain(row);
  const l = listing ? plain(listing) : null;
  return {
    id: b.id,
    status: b.status,
    rentalMode: modeOfBooking(b, l),
    listingId: b.listingId,
    vehicleTitle: b.vehicleTitle,
    vehicleType: b.vehicleType,
    registration: l ? prettyReg(l.registrationNumber) : null,
    startAt: iso(b.startAt),
    endAt: iso(b.endAt),
    billableHours: b.billableHours,
    rentAmount: Number(b.rentAmount) || 0,
    depositAmount: Number(b.depositAmount) || 0,
    payAtHandover: Number(b.payAtHandover) || 0,
    extraCharges: Number(b.extraCharges) || 0,
    finalAmount: b.finalAmount != null ? Number(b.finalAmount) : null,
    renterNote: b.renterNote || null,
    declineReason: b.declineReason || null,
    cancelReason: b.cancelReason || null,
    cancelledBy: b.cancelledBy || null,
    respondBy: iso(b.respondBy),
    acceptedAt: iso(b.acceptedAt),
    handoverAt: iso(b.handoverAt),
    returnedAt: iso(b.returnedAt),
    completedAt: iso(b.completedAt),
    cancelledAt: iso(b.cancelledAt),
    expiredAt: iso(b.expiredAt),
    createdAt: iso(b.createdAt),
    owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone || null } : { id: b.ownerId },
    renter: renter ? { id: renter.id, name: renter.name, phone: renter.phone || null } : { id: b.renterId },
    // C7: terms, condition evidence and the extra-charges claim / dispute.
    termsAcceptedAt: iso(b.termsAcceptedAt),
    termsVersion: b.termsVersion || null,
    termsPending: !!b.termsPending,
    pickupCondition: conditionOut(req, b.pickupCondition),
    returnCondition: conditionOut(req, b.returnCondition),
    extraBreakdown: jsonOf(b.extraBreakdown) || {},
    charges: chargesOut(req, b),
    chargesResolvedAt: iso(b.chargesResolvedAt),
  };
};

/** The student's own licence. */
const licenceOwn = (req, row) => {
  if (!row) return null;
  const l = plain(row);
  return {
    id: l.id,
    status: l.status,
    licenceNumberMasked: maskLicence(l.licenceNumber),
    classes: Array.isArray(l.classes) ? l.classes : [],
    verifiedClasses: Array.isArray(l.verifiedClasses) ? l.verifiedClasses : null,
    expiresOn: l.expiresOn || null,
    frontImage: signed(req, l.frontImage),
    backImage: signed(req, l.backImage),
    rejectionReason: l.rejectionReason || null,
    submittedAt: iso(l.submittedAt),
    reviewedAt: iso(l.reviewedAt),
  };
};

const licenceAdmin = (req, row, user) => {
  const l = plain(row);
  return {
    ...licenceOwn(req, row),
    licenceNumber: l.licenceNumber || null,
    userId: l.userId,
    user: user ? { id: user.id, name: user.name, phone: user.phone || null, email: user.email || null } : null,
  };
};

const reportAdmin = (req, row, { reporter, against, booking } = {}) => {
  const r = plain(row);
  return {
    id: r.id,
    bookingId: r.bookingId,
    listingId: r.listingId,
    category: r.category,
    description: r.description || '',
    photos: (Array.isArray(r.photos) ? r.photos : []).map((p) => signed(req, p)).filter(Boolean),
    status: r.status,
    adminNote: r.adminNote || null,
    reporterRole: r.reporterRole,
    reporter: reporter ? { id: reporter.id, name: reporter.name, phone: reporter.phone || null } : { id: r.reporterId },
    against: against ? { id: against.id, name: against.name, phone: against.phone || null } : (r.againstUserId ? { id: r.againstUserId } : null),
    booking: booking ? { id: booking.id, status: booking.status, vehicleTitle: booking.vehicleTitle, startAt: iso(booking.startAt), endAt: iso(booking.endAt) } : null,
    resolvedAt: iso(r.resolvedAt),
    createdAt: iso(r.createdAt),
  };
};

module.exports = {
  maskReg, prettyReg, maskLicence, titleOf, firstName, userBrief,
  listingPublic, listingOwner, listingAdmin, bookingFor, bookingAdmin, licenceOwn, licenceAdmin, reportAdmin, signed,
  modeOfBooking, conditionOut, chargesOut, jsonOf,
};
