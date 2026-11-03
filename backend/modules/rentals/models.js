// Zenvy Rentals tables. Registered on the shared sequelize instance by config/db.js.
// Schema rules (prod is Postgres, created by sync() + addMissingColumns): no column-level unique,
// named indexes only (see migrations.js), every column nullable or defaulted.
const { DataTypes } = require('sequelize');

const json = (dflt) => ({ type: DataTypes.JSON, allowNull: true, defaultValue: dflt });

const initRentalsModels = (sequelize) => {
  if (!sequelize) return {};

  const RentalListing = sequelize.define('RentalListing', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Owner-only test row (utils/testView, scripts/test_data_v2_seed.js): hidden from every non-tester request.
    isTestData: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ownerId: { type: DataTypes.UUID, allowNull: false },
    campusId: { type: DataTypes.UUID, allowNull: true },
    vehicleType: { type: DataTypes.STRING(10), allowNull: false },
    make: { type: DataTypes.STRING(40), allowNull: true },
    model: { type: DataTypes.STRING(60), allowNull: true },
    year: { type: DataTypes.INTEGER, allowNull: true },
    fuel: { type: DataTypes.STRING(10), allowNull: true },
    transmission: { type: DataTypes.STRING(10), allowNull: true },
    seats: { type: DataTypes.INTEGER, allowNull: true },
    // Normalised (upper case, no spaces). Never sent to other students: see services/serialize.js.
    registrationNumber: { type: DataTypes.STRING(16), allowNull: true },
    plateType: { type: DataTypes.STRING(20), allowNull: true },
    // Public media paths (/api/campus/media/<id>, purpose rental_photo).
    photos: json([]),
    // Private media paths { rc, insurance, licence } (purpose rental_doc): owner + admin only.
    documents: json({}),
    pricePerHour: { type: DataTypes.FLOAT, allowNull: true },
    pricePerDay: { type: DataTypes.FLOAT, allowNull: true },
    securityDeposit: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    minHours: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
    kmLimitPerDay: { type: DataTypes.INTEGER, allowNull: true },
    extraPerKm: { type: DataTypes.FLOAT, allowNull: true },
    fuelPolicy: { type: DataTypes.STRING(300), allowNull: true },
    pickupLocation: { type: DataTypes.STRING(200), allowNull: true },
    pickupLat: { type: DataTypes.DOUBLE, allowNull: true },
    pickupLon: { type: DataTypes.DOUBLE, allowNull: true },
    // { "0": { start: "08:00", end: "20:00" } | null, ... "6": ... } (0 = Sunday, IST). Empty = any time.
    weeklyHours: json({}),
    // [{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }] inclusive IST dates the owner is not renting.
    blockedDates: json([]),
    rules: { type: DataTypes.TEXT, allowNull: true },
    helmetIncluded: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'DRAFT' },
    rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedBy: { type: DataTypes.UUID, allowNull: true },
    // Set when an approved listing is first approved (resume after pause goes back to APPROVED).
    approvedAt: { type: DataTypes.DATE, allowNull: true },
    ratingAvg: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    ratingCount: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    tripCount: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'RentalListings',
    timestamps: true,
    indexes: [
      { name: 'rental_listings_owner', fields: ['ownerId'] },
      { name: 'rental_listings_status_campus', fields: ['status', 'campusId'] },
    ],
  });

  const RentalBooking = sequelize.define('RentalBooking', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    listingId: { type: DataTypes.UUID, allowNull: false },
    ownerId: { type: DataTypes.UUID, allowNull: false },
    renterId: { type: DataTypes.UUID, allowNull: false },
    startAt: { type: DataTypes.DATE, allowNull: false },
    endAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'REQUESTED' },
    // Server-computed money (INR). Zenvy never holds it: paid in cash at handover.
    billableHours: { type: DataTypes.INTEGER, allowNull: true },
    rentAmount: { type: DataTypes.FLOAT, allowNull: true },
    depositAmount: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    payAtHandover: { type: DataTypes.FLOAT, allowNull: true },
    kmAllowance: { type: DataTypes.INTEGER, allowNull: true },
    priceBreakdown: json({}),
    // Set by the owner when closing the trip (extra km, fuel, late fee). Cash too.
    extraCharges: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    extraBreakdown: json({}),
    finalAmount: { type: DataTypes.FLOAT, allowNull: true },
    // Vehicle snapshot at request time (title stays readable if the listing changes).
    vehicleTitle: { type: DataTypes.STRING(120), allowNull: true },
    vehicleType: { type: DataTypes.STRING(10), allowNull: true },
    renterNote: { type: DataTypes.STRING(500), allowNull: true },
    // 4-digit codes the renter shows the owner (pickup, then return). Never sent to the owner.
    pickupPin: { type: DataTypes.STRING(6), allowNull: true },
    returnPin: { type: DataTypes.STRING(6), allowNull: true },
    pinAttempts: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    pinLockedUntil: { type: DataTypes.DATE, allowNull: true },
    respondBy: { type: DataTypes.DATE, allowNull: true },
    acceptedAt: { type: DataTypes.DATE, allowNull: true },
    declinedAt: { type: DataTypes.DATE, allowNull: true },
    declineReason: { type: DataTypes.STRING(300), allowNull: true },
    expiredAt: { type: DataTypes.DATE, allowNull: true },
    handoverAt: { type: DataTypes.DATE, allowNull: true },
    returnedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledBy: { type: DataTypes.STRING(10), allowNull: true },
    cancelReason: { type: DataTypes.STRING(300), allowNull: true },
    ownerNote: { type: DataTypes.STRING(300), allowNull: true },
    reminderStartSentAt: { type: DataTypes.DATE, allowNull: true },
    reminderReturnSentAt: { type: DataTypes.DATE, allowNull: true },
    lateNoticeSentAt: { type: DataTypes.DATE, allowNull: true },
    renterRatedAt: { type: DataTypes.DATE, allowNull: true },
    ownerRatedAt: { type: DataTypes.DATE, allowNull: true },
    // ── C7 safety (all nullable / defaulted: added on boot by addMissingColumns) ──
    // RENT (commercial plate) | BORROW (private plate), snapshot at request time (enums.rentalMode).
    rentalMode: { type: DataTypes.STRING(6), allowNull: true },
    // Per-booking terms the renter / borrower ticked. termsPending = an older app build sent no
    // acceptTerms: the booking is stored, but the handover waits until the terms are accepted.
    termsAcceptedAt: { type: DataTypes.DATE, allowNull: true },
    termsVersion: { type: DataTypes.STRING(20), allowNull: true },
    termsPending: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    // { OWNER: { photos[], odometer, note, at }, RENTER: { ... } } photos = private media (rental_condition).
    pickupCondition: json(null),
    returnCondition: json(null),
    // Extra-charges claim: extraCharges / finalAmount only count accepted / upheld charges.
    chargesStatus: { type: DataTypes.STRING(14), allowNull: true },
    chargesClaimed: { type: DataTypes.FLOAT, allowNull: true },
    chargesNote: { type: DataTypes.STRING(500), allowNull: true },
    chargesPhotos: json(null),
    chargesRespondBy: { type: DataTypes.DATE, allowNull: true },
    chargesRespondedAt: { type: DataTypes.DATE, allowNull: true },
    disputeNote: { type: DataTypes.STRING(1000), allowNull: true },
    disputePhotos: json(null),
    // { outcome: UPHOLD|REDUCE|VOID, amount, reason, by, at }
    chargesResolution: json(null),
    chargesResolvedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'RentalBookings',
    timestamps: true,
    indexes: [
      { name: 'rental_bookings_listing_status', fields: ['listingId', 'status'] },
      { name: 'rental_bookings_renter', fields: ['renterId', 'createdAt'] },
      { name: 'rental_bookings_owner', fields: ['ownerId', 'createdAt'] },
      { name: 'rental_bookings_status', fields: ['status'] },
    ],
  });

  const RentalLicence = sequelize.define('RentalLicence', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    licenceNumber: { type: DataTypes.STRING(24), allowNull: true },
    // What the student declared; verifiedClasses is what the admin confirmed on the card.
    classes: json([]),
    verifiedClasses: json(null),
    frontImage: { type: DataTypes.STRING(120), allowNull: true },
    backImage: { type: DataTypes.STRING(120), allowNull: true },
    expiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'PENDING' },
    rejectionReason: { type: DataTypes.STRING(300), allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedBy: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'RentalLicences',
    timestamps: true,
    indexes: [{ name: 'rental_licences_status', fields: ['status'] }],
  });

  const RentalReview = sequelize.define('RentalReview', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    bookingId: { type: DataTypes.UUID, allowNull: false },
    listingId: { type: DataTypes.UUID, allowNull: false },
    reviewerId: { type: DataTypes.UUID, allowNull: false },
    revieweeId: { type: DataTypes.UUID, allowNull: false },
    // RENTER = the renter rating the owner / vehicle; OWNER = the owner rating the renter.
    role: { type: DataTypes.STRING(8), allowNull: false },
    rating: { type: DataTypes.INTEGER, allowNull: false },
    text: { type: DataTypes.STRING(500), allowNull: true },
    isHidden: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
  }, {
    tableName: 'RentalReviews',
    timestamps: true,
    indexes: [
      { name: 'rental_reviews_listing', fields: ['listingId', 'role'] },
      { name: 'rental_reviews_reviewee', fields: ['revieweeId', 'role'] },
    ],
  });

  const RentalReport = sequelize.define('RentalReport', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    bookingId: { type: DataTypes.UUID, allowNull: false },
    listingId: { type: DataTypes.UUID, allowNull: true },
    reporterId: { type: DataTypes.UUID, allowNull: false },
    reporterRole: { type: DataTypes.STRING(8), allowNull: true },
    againstUserId: { type: DataTypes.UUID, allowNull: true },
    category: { type: DataTypes.STRING(16), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    photos: json([]),
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'OPEN' },
    adminNote: { type: DataTypes.STRING(1000), allowNull: true },
    resolvedBy: { type: DataTypes.UUID, allowNull: true },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'RentalReports',
    timestamps: true,
    indexes: [
      { name: 'rental_reports_status', fields: ['status', 'createdAt'] },
      { name: 'rental_reports_booking', fields: ['bookingId'] },
    ],
  });

  return { RentalListing, RentalBooking, RentalLicence, RentalReview, RentalReport };
};

module.exports = { initRentalsModels };
