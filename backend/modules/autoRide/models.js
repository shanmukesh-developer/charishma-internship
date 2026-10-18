// Zenvy Auto-Ride tables. Registered on the shared sequelize instance by config/db.js.
// Schema rules (prod is Postgres, created by sync() + addMissingColumns): no column-level unique,
// named indexes only (unique / partial unique ones in migrations.js), every column nullable or defaulted.
const { DataTypes } = require('sequelize');

const json = (dflt) => ({ type: DataTypes.JSON, allowNull: true, defaultValue: dflt });
const uuidPk = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };

const initAutoRideModels = (sequelize) => {
  if (!sequelize) return {};

  // Driver accounts of the separate "Zenvy Auto Driver" app (own table + JWT role 'auto_driver';
  // never a User / DeliveryPartner row).
  const AutoDriver = sequelize.define('AutoDriver', {
    id: uuidPk,
    name: { type: DataTypes.STRING(80), allowNull: false },
    // Normalised 10-digit mobile, proven by OTP at sign-up. Never sent to customers before a confirmed booking.
    phone: { type: DataTypes.STRING(16), allowNull: false },
    password: { type: DataTypes.STRING(100), allowNull: false },
    tokenVersion: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    // C4: Terms version accepted at sign-up (null for accounts created before C4 / by older app builds).
    termsAcceptedVersion: { type: DataTypes.STRING(20), allowNull: true },
    termsAcceptedAt: { type: DataTypes.DATE, allowNull: true },
    campusId: { type: DataTypes.UUID, allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING_DOCS' },
    rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
    suspendedReason: { type: DataTypes.STRING(500), allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedBy: { type: DataTypes.UUID, allowNull: true },
    emergencyContactName: { type: DataTypes.STRING(80), allowNull: true },
    emergencyContactPhone: { type: DataTypes.STRING(16), allowNull: true },
    licenceNumber: { type: DataTypes.STRING(24), allowNull: true },
    licenceExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    // PSV / driver badge number where the state issues one.
    badgeNumber: { type: DataTypes.STRING(30), allowNull: true },
    // Private media paths { photo, licenceFront, licenceBack, badge?, policeVerification? }.
    documents: json({}),
    preferredRouteIds: json([]),
    isOnline: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    lastOnlineAt: { type: DataTypes.DATE, allowNull: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    fcmTokens: json([]),
    // Only from real ratings (none collected in v1, so customers never see a fabricated rating).
    ratingAvg: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    ratingCount: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
  }, {
    tableName: 'AutoDrivers',
    timestamps: true,
    indexes: [{ name: 'auto_drivers_status', fields: ['status'] }],
  });

  const AutoVehicle = sequelize.define('AutoVehicle', {
    id: uuidPk,
    driverId: { type: DataTypes.UUID, allowNull: false },
    // Normalised (upper case, no spaces). Masked for customers until their booking is confirmed.
    registrationNumber: { type: DataTypes.STRING(16), allowNull: false },
    make: { type: DataTypes.STRING(40), allowNull: true },
    model: { type: DataTypes.STRING(60), allowNull: true },
    year: { type: DataTypes.INTEGER, allowNull: true },
    fuel: { type: DataTypes.STRING(10), allowNull: true },
    colour: { type: DataTypes.STRING(30), allowNull: true },
    // Passenger seats printed on the RC (driver's declaration, checked by the admin on the RC image).
    rcSeatingCapacity: { type: DataTypes.INTEGER, allowNull: true },
    requestedCapacity: { type: DataTypes.INTEGER, allowNull: true },
    // Set ONLY by an admin at approval: <= rcSeatingCapacity and <= the platform max setting.
    approvedCapacity: { type: DataTypes.INTEGER, allowNull: true },
    // { rows: [['D', 1], [2, 3, 4], ...] } 'D' = driver (not bookable), null = gap. Admin-set.
    seatLayout: json(null),
    permitNumber: { type: DataTypes.STRING(40), allowNull: true },
    permitExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    insuranceExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    fitnessExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    pucExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    // Private media paths { rc, permit, insurance, fitness?, puc? } and vehicle photos [].
    documents: json({}),
    photos: json([]),
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING_REVIEW' },
    rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedBy: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'AutoVehicles',
    timestamps: true,
    indexes: [
      { name: 'auto_vehicles_driver', fields: ['driverId'] },
      { name: 'auto_vehicles_status', fields: ['status'] },
    ],
  });

  // Admin-configured routes (never hard-coded): origin -> destination with fare bounds.
  const AutoRoute = sequelize.define('AutoRoute', {
    id: uuidPk,
    campusId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    originLabel: { type: DataTypes.STRING(80), allowNull: false },
    destinationLabel: { type: DataTypes.STRING(80), allowNull: false },
    distanceKm: { type: DataTypes.FLOAT, allowNull: true },
    seatFareMin: { type: DataTypes.FLOAT, allowNull: true },
    seatFareMax: { type: DataTypes.FLOAT, allowNull: true },
    fullFareMin: { type: DataTypes.FLOAT, allowNull: true },
    fullFareMax: { type: DataTypes.FLOAT, allowNull: true },
    // [{ key: 'MORNING', label: 'Morning', start: '06:00', end: '12:00' }] (IST). Empty = one 'DAY' period.
    operatingPeriods: json([]),
    minSeatsToDepartDefault: { type: DataTypes.INTEGER, allowNull: true },
    permittedStops: json([]),
    isActive: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
  }, {
    tableName: 'AutoRoutes',
    timestamps: true,
    indexes: [{ name: 'auto_routes_active', fields: ['isActive', 'sortOrder'] }],
  });

  const AutoPickupPoint = sequelize.define('AutoPickupPoint', {
    id: uuidPk,
    routeId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    landmark: { type: DataTypes.STRING(160), allowNull: true },
    // Admin-entered coordinates of the stand (used for "Open in Maps"; never a live GPS claim).
    lat: { type: DataTypes.DOUBLE, allowNull: true },
    lon: { type: DataTypes.DOUBLE, allowNull: true },
    sequence: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
  }, {
    tableName: 'AutoPickupPoints',
    timestamps: true,
    indexes: [{ name: 'auto_pickup_points_route', fields: ['routeId', 'sequence'] }],
  });

  const AutoTrip = sequelize.define('AutoTrip', {
    id: uuidPk,
    driverId: { type: DataTypes.UUID, allowNull: false },
    vehicleId: { type: DataTypes.UUID, allowNull: false },
    routeId: { type: DataTypes.UUID, allowNull: false },
    pickupPointId: { type: DataTypes.UUID, allowNull: false },
    destinationLabel: { type: DataTypes.STRING(80), allowNull: true },
    stops: json([]),
    departureAt: { type: DataTypes.DATE, allowNull: false },
    originalDepartureAt: { type: DataTypes.DATE, allowNull: true },
    bookingOpensAt: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'DRAFT' },
    statusBeforeDelay: { type: DataTypes.STRING(30), allowNull: true },
    mode: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'SHARED' },
    // Snapshot at publish (<= vehicle.approvedCapacity <= platform max). Never read from the client later.
    capacity: { type: DataTypes.INTEGER, allowNull: false },
    seatLayout: json(null),
    seatSelectionEnabled: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
    privateBookingEnabled: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    // Counters recomputed from AutoSeats rows inside the trip lock (never incremented blindly).
    seatsHeld: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    seatsConfirmed: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    seatsBoarded: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    minSeatsToDepart: { type: DataTypes.INTEGER, allowNull: true },
    seatFare: { type: DataTypes.FLOAT, allowNull: false },
    fullAutoFare: { type: DataTypes.FLOAT, allowNull: true },
    // Optional extra charges on a full-auto booking (e.g. luggage / night / toll), set by the driver at
    // publish, bounded server-side, shown to the customer and added to the private fare by the server.
    extraChargesAmount: { type: DataTypes.FLOAT, allowNull: true },
    extraChargesNote: { type: DataTypes.STRING(120), allowNull: true },
    // IST calendar day of departure + operating period: the queue key with pickupPointId / routeId.
    operatingDate: { type: DataTypes.STRING(10), allowNull: true },
    periodKey: { type: DataTypes.STRING(20), allowNull: true },
    queueNumber: { type: DataTypes.INTEGER, allowNull: true },
    privateBookingId: { type: DataTypes.UUID, allowNull: true },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    openedAt: { type: DataTypes.DATE, allowNull: true },
    fullAt: { type: DataTypes.DATE, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    boardingAt: { type: DataTypes.DATE, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    arrivedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    endedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledBy: { type: DataTypes.STRING(10), allowNull: true },
    cancelReason: { type: DataTypes.STRING(300), allowNull: true },
    delayMinutes: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    delayReason: { type: DataTypes.STRING(300), allowNull: true },
    safetyConfirmedAt: { type: DataTypes.DATE, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    almostFullNotifiedAt: { type: DataTypes.DATE, allowNull: true },
    fullNotifiedAt: { type: DataTypes.DATE, allowNull: true },
    reminderNotifiedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'AutoTrips',
    timestamps: true,
    indexes: [
      { name: 'auto_trips_status_departure', fields: ['status', 'departureAt'] },
      { name: 'auto_trips_route_pickup_day', fields: ['routeId', 'pickupPointId', 'operatingDate'] },
      { name: 'auto_trips_driver', fields: ['driverId', 'createdAt'] },
    ],
  });

  const AutoBooking = sequelize.define('AutoBooking', {
    id: uuidPk,
    // Short human code shown to the passenger and typed / scanned by the driver at boarding.
    bookingCode: { type: DataTypes.STRING(12), allowNull: false },
    tripId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    driverId: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'SHARED' },
    seatCount: { type: DataTypes.INTEGER, allowNull: false },
    seatNumbers: json([]),
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'HELD' },
    holdExpiresAt: { type: DataTypes.DATE, allowNull: true },
    paymentMethod: { type: DataTypes.STRING(10), allowNull: true },
    paymentStatus: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'NONE' },
    // Server-computed (seats x trip.seatFare, or trip.fullAutoFare). Never from the client.
    seatFare: { type: DataTypes.FLOAT, allowNull: true },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    fareBreakdown: json({}),
    walletDebited: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    refundAmount: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    refundedAt: { type: DataTypes.DATE, allowNull: true },
    refundAttempts: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    cashCollectedAt: { type: DataTypes.DATE, allowNull: true },
    // 4-digit boarding PIN: only ever sent to the passenger (never in any driver response).
    boardingPin: { type: DataTypes.STRING(6), allowNull: true },
    pinAttempts: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    pinLockedUntil: { type: DataTypes.DATE, allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: true },
    privateRequestId: { type: DataTypes.UUID, allowNull: true },
    passengerCount: { type: DataTypes.INTEGER, allowNull: true },
    purpose: { type: DataTypes.STRING(200), allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    boardedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledBy: { type: DataTypes.STRING(10), allowNull: true },
    cancelReason: { type: DataTypes.STRING(300), allowNull: true },
    expiredAt: { type: DataTypes.DATE, allowNull: true },
    noShowAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'AutoBookings',
    timestamps: true,
    indexes: [
      { name: 'auto_bookings_trip_status', fields: ['tripId', 'status'] },
      { name: 'auto_bookings_user', fields: ['userId', 'createdAt'] },
      { name: 'auto_bookings_status_hold', fields: ['status', 'holdExpiresAt'] },
      { name: 'auto_bookings_driver', fields: ['driverId', 'createdAt'] },
    ],
  });

  // One row per held / sold seat. A seat number is live in at most one row per trip
  // (partial unique index auto_seats_live_unique): the database refuses a double sale.
  const AutoSeat = sequelize.define('AutoSeat', {
    id: uuidPk,
    tripId: { type: DataTypes.UUID, allowNull: false },
    seatNo: { type: DataTypes.INTEGER, allowNull: false },
    bookingId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'HELD' },
    holdExpiresAt: { type: DataTypes.DATE, allowNull: true },
    releasedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'AutoSeats',
    timestamps: true,
    indexes: [
      { name: 'auto_seats_trip_status', fields: ['tripId', 'status'] },
      { name: 'auto_seats_booking', fields: ['bookingId'] },
    ],
  });

  // "Book the full auto" requests: hold nothing until the driver accepts.
  const AutoPrivateRequest = sequelize.define('AutoPrivateRequest', {
    id: uuidPk,
    userId: { type: DataTypes.UUID, allowNull: false },
    tripId: { type: DataTypes.UUID, allowNull: false },
    driverId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'REQUESTED' },
    passengers: { type: DataTypes.INTEGER, allowNull: true },
    purpose: { type: DataTypes.STRING(200), allowNull: true },
    // fare = baseFare (trip.fullAutoFare) + extraChargesAmount, snapshotted when the request is made.
    fare: { type: DataTypes.FLOAT, allowNull: true },
    baseFare: { type: DataTypes.FLOAT, allowNull: true },
    extraChargesAmount: { type: DataTypes.FLOAT, allowNull: true },
    extraChargesNote: { type: DataTypes.STRING(120), allowNull: true },
    paymentMethod: { type: DataTypes.STRING(10), allowNull: true },
    respondBy: { type: DataTypes.DATE, allowNull: true },
    respondedAt: { type: DataTypes.DATE, allowNull: true },
    declineReason: { type: DataTypes.STRING(300), allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: true },
    bookingId: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'AutoPrivateRequests',
    timestamps: true,
    indexes: [
      { name: 'auto_private_req_trip', fields: ['tripId', 'status'] },
      { name: 'auto_private_req_driver', fields: ['driverId', 'status'] },
      { name: 'auto_private_req_user', fields: ['userId', 'createdAt'] },
      { name: 'auto_private_req_status_respond', fields: ['status', 'respondBy'] },
    ],
  });

  // Queue number source per (pickup point, route, IST day, operating period).
  const AutoQueueCounter = sequelize.define('AutoQueueCounter', {
    id: uuidPk,
    pickupPointId: { type: DataTypes.UUID, allowNull: false },
    routeId: { type: DataTypes.UUID, allowNull: false },
    operatingDate: { type: DataTypes.STRING(10), allowNull: false },
    periodKey: { type: DataTypes.STRING(20), allowNull: false },
    lastNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { tableName: 'AutoQueueCounters', timestamps: true });

  const AutoIncident = sequelize.define('AutoIncident', {
    id: uuidPk,
    tripId: { type: DataTypes.UUID, allowNull: true },
    bookingId: { type: DataTypes.UUID, allowNull: true },
    reporterType: { type: DataTypes.STRING(10), allowNull: false }, // CUSTOMER | DRIVER
    reporterId: { type: DataTypes.UUID, allowNull: false },
    category: { type: DataTypes.STRING(20), allowNull: false },
    // HIGH for SOS and SAFETY / HARASSMENT reports (admin list shows them first), else NORMAL.
    priority: { type: DataTypes.STRING(10), allowNull: true, defaultValue: 'NORMAL' },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'OPEN' },
    adminNote: { type: DataTypes.STRING(1000), allowNull: true },
    resolvedBy: { type: DataTypes.UUID, allowNull: true },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'AutoIncidents',
    timestamps: true,
    indexes: [
      { name: 'auto_incidents_status', fields: ['status', 'createdAt'] },
      { name: 'auto_incidents_trip', fields: ['tripId'] },
    ],
  });

  // Trip state history (one row per transition, written in the same transaction).
  const AutoTripEvent = sequelize.define('AutoTripEvent', {
    id: uuidPk,
    tripId: { type: DataTypes.UUID, allowNull: false },
    fromStatus: { type: DataTypes.STRING(30), allowNull: true },
    toStatus: { type: DataTypes.STRING(30), allowNull: false },
    actorType: { type: DataTypes.STRING(10), allowNull: false }, // driver | system | admin
    actorId: { type: DataTypes.STRING(64), allowNull: true },
    note: { type: DataTypes.STRING(300), allowNull: true },
    meta: json({}),
  }, {
    tableName: 'AutoTripEvents',
    timestamps: true,
    updatedAt: false,
    indexes: [{ name: 'auto_trip_events_trip', fields: ['tripId', 'createdAt'] }],
  });

  return {
    AutoDriver, AutoVehicle, AutoRoute, AutoPickupPoint, AutoTrip, AutoBooking, AutoSeat,
    AutoPrivateRequest, AutoQueueCounter, AutoIncident, AutoTripEvent,
  };
};

module.exports = { initAutoRideModels };
