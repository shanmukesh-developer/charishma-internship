// Every Auto-Ride payload is built here, per viewer. Privacy rules:
//  - Customers never see a driver's phone unless they hold a CONFIRMED / BOARDED booking on that trip
//    AND the trip has not ended; never the driver's documents; the registration number is masked
//    (AP 07 •• 1234) until their booking is confirmed.
//  - Drivers see passengers as first name + booking code + seat count / numbers only: never a phone,
//    never a user id, never the boarding PIN.
//  - Ratings are shown only when real ratings exist (ratingCount > 0); nothing is ever fabricated.
//  - tripStatus() is the ONE status block both apps get (customer and driver endpoints return the
//    same object for the same trip).
const E = require('../enums');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;

const signed = (req, path) => {
  if (!path) return null;
  try {
    return require('../../campus/controllers/mediaController').signedMediaUrl(req, path);
  } catch {
    return null;
  }
};
const iso = (d) => (d ? new Date(d).toISOString() : null);
const firstName = (name) => String(name || 'Passenger').trim().split(/\s+/)[0].slice(0, 30) || 'Passenger';
const shortName = (name) => {
  const parts = String(name || 'Driver').trim().split(/\s+/);
  return (parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]).slice(0, 40);
};

const maskReg = (reg) => {
  const r = String(reg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r) return null;
  const m = /^([A-Z]{2})(\d{1,2})[A-Z0-9]*?(\d{1,4})$/.exec(r);
  if (m && r.length >= 6) return `${m[1]} ${m[2].padStart(2, '0')} •• ${m[3]}`;
  if (r.length >= 6) return `${r.slice(0, 2)} •• ${r.slice(-4)}`;
  return `•• ${r.slice(-2)}`;
};
const prettyReg = (reg) => {
  const r = String(reg || '').toUpperCase();
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(r);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : r || null;
};

const AVAILABILITY_LABELS = {
  NOT_OPEN: 'Booking opens soon',
  AVAILABLE: 'Seats available',
  FILLING_FAST: 'Filling fast',
  READY_TO_DEPART: 'Ready to depart',
  FULL: 'Full',
  PRIVATE: 'Booked as full auto',
  DEPARTING: 'Driver confirmed departure',
  BOARDING: 'Boarding now',
  DELAYED: 'Delayed',
  IN_PROGRESS: 'On the way',
  CLOSED: 'Closed',
};
const Q = E.QUEUE_STATE;
const isChargeTrip = (trip) => trip.dispatchMode === E.DISPATCH_MODE.ON_CHARGE;

/** The single status block for a trip (same for customers, drivers and admins). */
const tripStatus = (trip) => {
  const capacity = Number(trip.capacity) || 0;
  const confirmed = Number(trip.seatsConfirmed) || 0;
  const held = Number(trip.seatsHeld) || 0;
  const boarded = Number(trip.seatsBoarded) || 0;
  const remaining = Math.max(0, capacity - confirmed - held);
  let availability = 'CLOSED';
  if (trip.mode === E.MODE.PRIVATE && !E.TERMINAL_TRIP_STATUSES.includes(trip.status)) availability = 'PRIVATE';
  else if (trip.status === T.PUBLISHED) availability = 'NOT_OPEN';
  else if (trip.status === T.FULL) availability = 'FULL';
  else if (trip.status === T.DEPARTURE_THRESHOLD_REACHED) availability = remaining ? 'READY_TO_DEPART' : 'FULL';
  else if (trip.status === T.OPEN_FOR_BOOKING) {
    const fast = Math.max(1, Math.ceil(capacity * 0.25));
    availability = remaining === 0 ? 'FULL' : remaining <= fast && confirmed + held > 0 ? 'FILLING_FAST' : 'AVAILABLE';
  } else if (trip.status === T.DRIVER_CONFIRMED) availability = 'DEPARTING';
  else if (trip.status === T.BOARDING) availability = 'BOARDING';
  else if (trip.status === T.DELAYED) availability = 'DELAYED';
  else if (trip.status === T.IN_PROGRESS) availability = 'IN_PROGRESS';
  // Union queue: an auto behind the front is not open yet; one that left the charge takes no more bookings
  // even if a seat frees up later (the next auto is on charge by then).
  let label = AVAILABILITY_LABELS[availability];
  const charge = isChargeTrip(trip);
  if (charge && trip.queueState === Q.WAITING && ['NOT_OPEN', 'AVAILABLE', 'FILLING_FAST', 'READY_TO_DEPART'].includes(availability)) label = 'Waiting in line';
  else if (charge && trip.queueState === Q.DONE && ['AVAILABLE', 'FILLING_FAST', 'READY_TO_DEPART'].includes(availability)) {
    availability = 'CLOSED';
    label = 'Not taking bookings';
  } else if (charge && trip.queueState === Q.ON_CHARGE && ['AVAILABLE', 'FILLING_FAST', 'READY_TO_DEPART'].includes(availability)) label = 'On charge now';
  const walkIn = Number(trip.seatsWalkIn) || 0;
  // An auto on charge (or waiting) has no departure time: it leaves when full or when the driver taps Depart.
  // Its stored departureAt is only the latest time it may stay in line, so it is not shown.
  const leavesWhenFull = charge && [T.PUBLISHED, T.OPEN_FOR_BOOKING, T.DEPARTURE_THRESHOLD_REACHED, T.FULL].includes(trip.status);
  return {
    status: trip.status,
    statusLabel: E.STATUS_LABELS[trip.status] || trip.status,
    availability,
    availabilityLabel: label,
    mode: trip.mode,
    capacity,
    confirmedSeats: confirmed,
    heldSeats: held,
    boardedSeats: boarded,
    remainingSeats: trip.mode === E.MODE.PRIVATE ? 0 : remaining,
    minSeatsToDepart: Number(trip.minSeatsToDepart) || capacity,
    queueNumber: trip.queueNumber || null,
    departureAt: leavesWhenFull ? null : iso(trip.departureAt),
    originalDepartureAt: charge ? null : iso(trip.originalDepartureAt),
    leavesWhenFull,
    delayMinutes: Number(trip.delayMinutes) || 0,
    version: Number(trip.version) || 0,
    // Union queue (null / SCHEDULED for published-departure trips).
    dispatchMode: trip.dispatchMode || E.DISPATCH_MODE.SCHEDULED,
    queueState: charge ? trip.queueState || null : null,
    onCharge: charge && trip.queueState === Q.ON_CHARGE,
    lineSeq: charge ? trip.lineSeq || null : null,
    walkInSeats: walkIn,
    appSeats: Math.max(0, confirmed - walkIn),
  };
};

const routeBrief = (route) => (route ? {
  id: route.id, name: route.name, origin: route.originLabel, destination: route.destinationLabel,
  distanceKm: route.distanceKm === null || route.distanceKm === undefined ? null : Number(route.distanceKm),
} : null);
const pickupBrief = (p) => (p ? {
  id: p.id, name: p.name, landmark: p.landmark || null,
  lat: p.lat === null || p.lat === undefined ? null : Number(p.lat),
  lon: p.lon === null || p.lon === undefined ? null : Number(p.lon),
  mapsUrl: p.lat !== null && p.lat !== undefined && p.lon !== null && p.lon !== undefined ? `https://www.google.com/maps/search/?api=1&query=${Number(p.lat)},${Number(p.lon)}` : null,
} : null);

/** Full-auto extra charges block ({ amount, note }) or null. */
const extraChargesOf = (row) => (Number(row && row.extraChargesAmount) > 0
  ? { amount: Number(row.extraChargesAmount), note: row.extraChargesNote || null } : null);

const bookable = (trip) => E.BOOKABLE_STATUSES.includes(trip.status) && trip.mode === E.MODE.SHARED
  && (!isChargeTrip(trip) || trip.queueState === Q.ON_CHARGE || trip.queueState === Q.WAITING);

/** Trip card / detail for a customer. ctx: { driver, vehicle, route, pickup, myBooking } */
const tripCustomer = (req, trip, ctx = {}) => {
  const st = tripStatus(trip);
  const mine = ctx.myBooking && [B.CONFIRMED, B.BOARDED].includes(ctx.myBooking.status);
  const d = ctx.driver;
  const v = ctx.vehicle;
  return {
    id: trip.id,
    ...st,
    driver: d ? {
      name: shortName(d.name),
      firstName: firstName(d.name),
      verified: d.status === E.DRIVER_STATUS.VERIFIED,
      photo: signed(req, d.documents && d.documents.photo),
      rating: Number(d.ratingCount) > 0 ? { avg: Math.round(Number(d.ratingAvg) * 10) / 10, count: Number(d.ratingCount) } : null,
    } : null,
    vehicle: v ? {
      registration: mine ? prettyReg(v.registrationNumber) : maskReg(v.registrationNumber),
      registrationMasked: !mine,
      make: v.make || null, model: v.model || null, colour: v.colour || null, fuel: v.fuel || null,
    } : null,
    route: routeBrief(ctx.route),
    pickup: pickupBrief(ctx.pickup),
    destination: trip.destinationLabel || (ctx.route && ctx.route.destinationLabel) || null,
    stops: Array.isArray(trip.stops) ? trip.stops : [],
    seatFare: Number(trip.seatFare),
    fullAutoFare: trip.privateBookingEnabled && trip.fullAutoFare ? Number(trip.fullAutoFare) : null,
    // Extra charges the driver set for a full-auto booking (added to the private fare by the server).
    extraCharges: trip.privateBookingEnabled && trip.fullAutoFare ? extraChargesOf(trip) : null,
    fullAutoTotal: trip.privateBookingEnabled && trip.fullAutoFare ? Math.round((Number(trip.fullAutoFare) + (Number(trip.extraChargesAmount) > 0 ? Number(trip.extraChargesAmount) : 0)) * 100) / 100 : null,
    seatSelectionEnabled: !!trip.seatSelectionEnabled,
    sharedBookingAllowed: bookable(trip) && st.remainingSeats > 0,
    privateBookingAllowed: !!trip.privateBookingEnabled && !!trip.fullAutoFare && bookable(trip)
      && (Number(trip.seatsConfirmed) || 0) + (Number(trip.seatsHeld) || 0) === 0,
    queueNote: isChargeTrip(trip)
      ? 'Autos leave the stand in line order. The auto on charge leaves first.'
      : 'Queue order shows when autos checked in; the departure order can differ.',
    myBookingId: ctx.myBooking ? ctx.myBooking.id : null,
    myBookingStatus: ctx.myBooking ? ctx.myBooking.status : null,
  };
};

/** Trip for its own driver. ctx: { route, pickup, vehicle } */
const tripDriver = (req, trip, ctx = {}) => ({
  id: trip.id,
  ...tripStatus(trip),
  route: routeBrief(ctx.route),
  pickup: pickupBrief(ctx.pickup),
  vehicle: ctx.vehicle ? { id: ctx.vehicle.id, registration: prettyReg(ctx.vehicle.registrationNumber), approvedCapacity: ctx.vehicle.approvedCapacity } : null,
  routeId: trip.routeId,
  pickupPointId: trip.pickupPointId,
  vehicleId: trip.vehicleId,
  destination: trip.destinationLabel,
  stops: Array.isArray(trip.stops) ? trip.stops : [],
  seatFare: Number(trip.seatFare),
  fullAutoFare: trip.fullAutoFare === null || trip.fullAutoFare === undefined ? null : Number(trip.fullAutoFare),
  extraCharges: extraChargesOf(trip),
  seatSelectionEnabled: !!trip.seatSelectionEnabled,
  privateBookingEnabled: !!trip.privateBookingEnabled,
  seatLayout: trip.seatLayout || null,
  bookingOpensAt: iso(trip.bookingOpensAt),
  operatingDate: trip.operatingDate || null,
  periodKey: trip.periodKey || null,
  publishedAt: iso(trip.publishedAt),
  confirmedAt: iso(trip.confirmedAt),
  boardingAt: iso(trip.boardingAt),
  startedAt: iso(trip.startedAt),
  arrivedAt: iso(trip.arrivedAt),
  completedAt: iso(trip.completedAt),
  cancelReason: trip.cancelReason || null,
  delayReason: trip.delayReason || null,
  chargeStartedAt: iso(trip.chargeStartedAt),
  chargeEndedAt: iso(trip.chargeEndedAt),
  createdAt: iso(trip.createdAt),
});

const bookingCommon = (b) => ({
  id: b.id,
  bookingCode: b.bookingCode,
  tripId: b.tripId,
  type: b.type,
  seatCount: Number(b.seatCount),
  seatNumbers: Array.isArray(b.seatNumbers) ? b.seatNumbers : [],
  status: b.status,
  paymentMethod: b.paymentMethod || null,
  paymentStatus: b.paymentStatus || null,
  amount: Number(b.amount),
  holdExpiresAt: b.status === B.HELD ? iso(b.holdExpiresAt) : null,
  confirmedAt: iso(b.confirmedAt),
  boardedAt: iso(b.boardedAt),
  cancelledAt: iso(b.cancelledAt),
  createdAt: iso(b.createdAt),
});

/** Booking for its customer. ctx: { trip, driver, vehicle, route, pickup } */
const bookingCustomer = (req, b, ctx = {}) => {
  const trip = ctx.trip;
  const confirmed = [B.CONFIRMED, B.BOARDED].includes(b.status);
  const tripLive = trip && !E.TERMINAL_TRIP_STATUSES.includes(trip.status);
  return {
    ...bookingCommon(b),
    seatFare: b.seatFare === null || b.seatFare === undefined ? null : Number(b.seatFare),
    fareBreakdown: b.fareBreakdown || {},
    refundAmount: Number(b.refundAmount) || 0,
    refundedAt: iso(b.refundedAt),
    cancelledBy: b.cancelledBy || null,
    cancelReason: b.cancelReason || null,
    // Shown to the driver at boarding; only ever in the passenger's own payloads.
    boardingPin: b.status === B.CONFIRMED ? b.boardingPin : null,
    trip: trip ? tripCustomer(req, trip, { ...ctx, myBooking: b }) : null,
    // Driver phone: only while this booking is confirmed / boarded and the trip has not ended.
    driverPhone: confirmed && tripLive && ctx.driver ? ctx.driver.phone : null,
    pickupInstructions: confirmed && ctx.pickup ? `Be at ${ctx.pickup.name}${ctx.pickup.landmark ? ` (${ctx.pickup.landmark})` : ''} before departure and show booking code ${b.bookingCode} + your PIN to the driver.` : null,
  };
};

/** Booking as the driver may see it: first name, code, seats. No phone, no user id, no PIN. */
const bookingDriver = (b, user) => ({
  ...bookingCommon(b),
  passengerName: firstName(user && user.name),
  passengerCount: Number(b.passengerCount) || Number(b.seatCount),
  cashToCollect: b.paymentMethod === E.PAYMENT_METHODS.CASH && [B.CONFIRMED, B.BOARDED].includes(b.status) && !b.cashCollectedAt ? Number(b.amount) : 0,
  cashCollectedAt: iso(b.cashCollectedAt),
});

const bookingAdmin = (b, { user, trip } = {}) => ({
  ...bookingCommon(b),
  userId: b.userId,
  driverId: b.driverId,
  passenger: user ? { id: user.id, name: user.name, phone: user.phone } : null,
  refundAmount: Number(b.refundAmount) || 0,
  refundedAt: iso(b.refundedAt),
  refundAttempts: Number(b.refundAttempts) || 0,
  walletDebited: Number(b.walletDebited) || 0,
  cancelledBy: b.cancelledBy || null,
  cancelReason: b.cancelReason || null,
  pinLocked: !!(b.pinLockedUntil && new Date(b.pinLockedUntil).getTime() > Date.now()),
  trip: trip ? { id: trip.id, ...tripStatus(trip) } : null,
});

const docsSigned = (req, docs) => {
  const out = {};
  for (const [k, v] of Object.entries(docs || {})) if (v) out[k] = signed(req, v);
  return out;
};

/** The driver's own profile. */
const driverSelf = (req, d) => ({
  id: d.id,
  name: d.name,
  phone: d.phone,
  status: d.status,
  rejectionReason: d.status === E.DRIVER_STATUS.REJECTED ? d.rejectionReason || null : null,
  suspendedReason: d.status === E.DRIVER_STATUS.SUSPENDED ? d.suspendedReason || null : null,
  emergencyContactName: d.emergencyContactName || null,
  emergencyContactPhone: d.emergencyContactPhone || null,
  licenceNumber: d.licenceNumber || null,
  licenceExpiresOn: d.licenceExpiresOn || null,
  badgeNumber: d.badgeNumber || null,
  documents: d.documents || {},
  documentPreviews: docsSigned(req, d.documents),
  preferredRouteIds: Array.isArray(d.preferredRouteIds) ? d.preferredRouteIds : [],
  isOnline: !!d.isOnline,
  submittedAt: iso(d.submittedAt),
  reviewedAt: iso(d.reviewedAt),
  createdAt: iso(d.createdAt),
  termsAcceptedVersion: d.termsAcceptedVersion || null,
  termsAcceptedAt: iso(d.termsAcceptedAt),
});
const driverAdmin = (req, d) => ({ ...driverSelf(req, d), reviewedBy: d.reviewedBy || null, lastOnlineAt: iso(d.lastOnlineAt), lastLoginAt: iso(d.lastLoginAt) });

const vehicleSelf = (req, v) => ({
  id: v.id,
  driverId: v.driverId,
  registration: prettyReg(v.registrationNumber),
  registrationNumber: v.registrationNumber,
  make: v.make || null, model: v.model || null, year: v.year || null, fuel: v.fuel || null, colour: v.colour || null,
  rcSeatingCapacity: v.rcSeatingCapacity, requestedCapacity: v.requestedCapacity, approvedCapacity: v.approvedCapacity || null,
  seatLayout: v.seatLayout || null,
  permitNumber: v.permitNumber || null,
  permitExpiresOn: v.permitExpiresOn || null, insuranceExpiresOn: v.insuranceExpiresOn || null,
  fitnessExpiresOn: v.fitnessExpiresOn || null, pucExpiresOn: v.pucExpiresOn || null,
  documents: v.documents || {},
  documentPreviews: docsSigned(req, v.documents),
  photos: Array.isArray(v.photos) ? v.photos : [],
  photoPreviews: (Array.isArray(v.photos) ? v.photos : []).map((p) => signed(req, p)),
  status: v.status,
  rejectionReason: v.rejectionReason || null,
  reviewedAt: iso(v.reviewedAt),
  createdAt: iso(v.createdAt),
});

const routeFull = (r, pickups = []) => ({
  ...routeBrief(r),
  campusId: r.campusId || null,
  seatFareDefault: r.seatFareDefault === null || r.seatFareDefault === undefined ? null : Number(r.seatFareDefault),
  // The fare an auto put on charge uses (default, else min, else max), null when none is set.
  chargeSeatFare: (require('./chargeLine').routeSeatFare(r) || {}).fare || null,
  seatFareMin: r.seatFareMin, seatFareMax: r.seatFareMax, fullFareMin: r.fullFareMin, fullFareMax: r.fullFareMax,
  operatingPeriods: Array.isArray(r.operatingPeriods) ? r.operatingPeriods : [],
  minSeatsToDepartDefault: r.minSeatsToDepartDefault || null,
  permittedStops: Array.isArray(r.permittedStops) ? r.permittedStops : [],
  isActive: r.isActive !== false,
  sortOrder: Number(r.sortOrder) || 0,
  pickupPoints: pickups.map((p) => ({ ...pickupBrief(p), routeId: p.routeId, sequence: Number(p.sequence) || 0, isActive: p.isActive !== false })),
});

const privateRequestCustomer = (r) => ({
  id: r.id, tripId: r.tripId, status: r.status, passengers: r.passengers, purpose: r.purpose || null,
  fare: Number(r.fare), paymentMethod: r.paymentMethod, respondBy: iso(r.respondBy), respondedAt: iso(r.respondedAt),
  baseFare: r.baseFare === null || r.baseFare === undefined ? Number(r.fare) : Number(r.baseFare), extraCharges: extraChargesOf(r),
  declineReason: r.declineReason || null, bookingId: r.bookingId || null, createdAt: iso(r.createdAt),
  note: r.status === E.PRIVATE_STATUS.REQUESTED ? 'Waiting for the driver to accept. Nothing is booked until then.' : null,
});
const privateRequestDriver = (r, user) => ({
  id: r.id, tripId: r.tripId, status: r.status, passengers: r.passengers, purpose: r.purpose || null,
  fare: Number(r.fare), paymentMethod: r.paymentMethod, respondBy: iso(r.respondBy), respondedAt: iso(r.respondedAt),
  baseFare: r.baseFare === null || r.baseFare === undefined ? Number(r.fare) : Number(r.baseFare), extraCharges: extraChargesOf(r),
  passengerName: firstName(user && user.name), bookingId: r.bookingId || null, createdAt: iso(r.createdAt),
});

const incident = (i) => ({
  id: i.id, tripId: i.tripId || null, bookingId: i.bookingId || null, reporterType: i.reporterType, category: i.category,
  priority: i.priority || 'NORMAL',
  description: i.description || null, status: i.status, adminNote: i.adminNote || null, createdAt: iso(i.createdAt), resolvedAt: iso(i.resolvedAt),
});

module.exports = {
  tripStatus, tripCustomer, tripDriver, bookingCustomer, bookingDriver, bookingAdmin, driverSelf, driverAdmin, vehicleSelf,
  routeFull, routeBrief, pickupBrief, privateRequestCustomer, privateRequestDriver, incident, extraChargesOf, maskReg, prettyReg, firstName, shortName, iso, signed,
};
