// Admin side of Auto-Ride (/api/admin/auto-ride, protect + admin): driver + vehicle verification
// (the admin sets approvedCapacity <= RC seating <= platform max and the seat layout), routes and
// pickup points, trips + queues, bookings, private requests, incidents, fares, settings / kill switches,
// live counts from real rows. Every write is audited in VerificationLog (like Rentals).
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUuid, num, ymd, audit, money, pageOpts, paginate, maskPhone } = require('../services/util');
const S = require('../services/serialize');
const notify = require('../services/notify');
const clock = require('../services/clock');
const flag = require('../services/flag');
const actions = require('../services/tripActions');
const alloc = require('../services/allocation');
const payments = require('../services/payments');
const { withTripLock, lockOpt } = require('../services/locks');
const { syncAvailability } = require('../services/stateMachine');
const { defaultLayout, validateLayout } = require('../services/layout');
const { istYmd, istStartOfDay } = require('../../../utils/istTime');

const T = E.TRIP_STATUS;
const B = E.BOOKING_STATUS;
const D = E.DRIVER_STATUS;
const V = E.VEHICLE_STATUS;
const M = () => ({
  Driver: getModel('AutoDriver'), Vehicle: getModel('AutoVehicle'), Route: getModel('AutoRoute'), Pickup: getModel('AutoPickupPoint'),
  Trip: getModel('AutoTrip'), Booking: getModel('AutoBooking'), Private: getModel('AutoPrivateRequest'), Incident: getModel('AutoIncident'),
  Event: getModel('AutoTripEvent'),
});

const byId = async (Model, id, label) => {
  if (!isUuid(String(id || ''))) throw fail(404, 'NOT_FOUND', `${label} not found.`);
  const row = await Model.findByPk(id);
  if (!row) throw fail(404, 'NOT_FOUND', `${label} not found.`);
  return row;
};
const reasonOf = (body, min = 5) => {
  const reason = cleanText(body && body.reason, 500);
  if (reason.length < min) throw fail(400, 'REASON_REQUIRED', `Give a reason the driver will see (at least ${min} characters).`, { field: 'reason' });
  return reason;
};
const usersById = async (ids) => {
  const { getUserModel } = require('../../../models/User');
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const rows = await getUserModel().findAll({ where: { id: { [Op.in]: list } }, attributes: ['id', 'name', 'phone', 'email'] });
  return new Map(rows.map((u) => [String(u.id), u]));
};

const byIdsOf = async (Model, ids, attributes) => {
  const list = [...new Set(ids.filter(Boolean).map(String))].filter(isUuid);
  if (!list.length) return new Map();
  const rows = await Model.findAll({ where: { id: { [Op.in]: list } }, ...(attributes ? { attributes } : {}) });
  return new Map(rows.map((r) => [String(r.id), r]));
};
/** { name: first name, phoneMasked: '•••• 1234' } for lists that only need to tell people apart. */
const personBrief = (u, nameFn = S.firstName) => (u ? { id: u.id, name: nameFn(u.name), phoneMasked: maskPhone(u.phone) } : null);

// GET /api/admin/auto-ride/summary  (live counts from real rows)
const summary = async (req, res) => {
  const { Driver, Vehicle, Trip, Booking, Private, Incident } = M();
  const dayStart = istStartOfDay(clock.now());
  const activeTrips = await Trip.findAll({ where: { status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } }, attributes: ['id'] });
  const [onlineVerifiedDrivers, pendingDrivers, pendingVehicles, openTrips, fullTrips, inProgress, cancelledToday, privateAwaiting, openIncidents, enabled, walletEnabled] = await Promise.all([
    Driver.count({ where: { status: D.VERIFIED, isOnline: true } }),
    Driver.count({ where: { status: D.PENDING_REVIEW } }),
    Vehicle.count({ where: { status: V.PENDING_REVIEW } }),
    Trip.count({ where: { status: { [Op.in]: E.BOOKABLE_STATUSES } } }),
    Trip.count({ where: { status: T.FULL } }),
    Trip.count({ where: { status: T.IN_PROGRESS } }),
    Trip.count({ where: { status: { [Op.in]: E.EXCEPTION_END_STATUSES }, endedAt: { [Op.gte]: dayStart } } }),
    Private.count({ where: { status: E.PRIVATE_STATUS.REQUESTED } }),
    Incident.count({ where: { status: { [Op.in]: ['OPEN', 'REVIEWING'] } } }),
    flag.readFlag({ fresh: true }),
    flag.readWalletFlag({ fresh: true }),
  ]);
  const bookedSeats = activeTrips.length ? await getModel('AutoSeat').count({ where: { tripId: { [Op.in]: activeTrips.map((t) => t.id) }, status: { [Op.in]: [E.SEAT_STATUS.CONFIRMED, E.SEAT_STATUS.BOARDED] } } }) : 0;
  const refundPending = await Booking.count({ where: { status: B.REFUND_PENDING } });
  res.json({ onlineVerifiedDrivers, pendingDrivers, pendingVehicles, openTrips, bookedSeats, fullTrips, privateAwaiting, tripsInProgress: inProgress, cancelledToday, openIncidents, refundPending, enabled, walletEnabled });
};

// ── Drivers ─────────────────────────────────────────────────────────────────
const drivers = async (req, res) => {
  const { Driver } = M();
  const status = String(req.query.status || D.PENDING_REVIEW).toUpperCase();
  const where = {};
  if (status !== 'ALL') {
    if (!Object.values(D).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  const q = cleanText(req.query.q, 40).replace(/[%_\\]/g, '');
  if (q) where[Op.or] = [{ phone: { [Op.like]: `%${q}%` } }, { name: { [Op.like]: `%${q}%` } }];
  const pg = pageOpts(req.query, 200);
  const found = await Driver.findAll({ where, order: [['updatedAt', 'DESC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  res.json({ drivers: rows.map((d) => S.driverAdmin(req, d)), pagination });
};
const driverDetail = async (req, res) => {
  const { Driver, Vehicle, Trip } = M();
  const d = await byId(Driver, req.params.id, 'Driver');
  const [vehicles, trips] = await Promise.all([
    Vehicle.findAll({ where: { driverId: d.id } }),
    Trip.findAll({ where: { driverId: d.id }, order: [['createdAt', 'DESC']], limit: 30 }),
  ]);
  res.json({
    driver: S.driverAdmin(req, d), vehicles: vehicles.map((v) => S.vehicleSelf(req, v)),
    trips: trips.map((t) => ({ id: t.id, ...S.tripStatus(t), routeId: t.routeId })),
    missing: require('./driverProfile').missingForReview(d, vehicles),
  });
};
// POST /api/admin/auto-ride/drivers { name, phone, password }: plan B sign-up (like the Zenvy Rider app). The admin
// creates the account with a temporary password; the driver signs in with phone + password (no SMS needed),
// then uploads documents + submits for review in the app (same PENDING_DOCS start as a self sign-up) and can
// change the password from More -> Change password.
const createDriver = async (req, res) => {
  const { Driver } = M();
  const { checkPassword, MOBILE_RE } = require('./driverAuth');
  const body = req.body || {};
  const phone = require('../../../utils/phoneUtils').normalizePhone(body.phone);
  if (!MOBILE_RE.test(phone)) throw fail(400, 'INVALID_PHONE', 'Enter a valid 10-digit mobile number.', { field: 'phone' });
  const name = cleanText(body.name, 80);
  if (name.length < 2) throw fail(400, 'INVALID_INPUT', "Enter the driver's full name as on the driving licence.", { field: 'name' });
  const password = checkPassword(body.password);
  if (await Driver.findOne({ where: { phone }, attributes: ['id'] })) {
    throw fail(409, 'PHONE_TAKEN', 'A driver account already uses this number.');
  }
  let d;
  try {
    d = await Driver.create({
      name, phone, password: await require('bcryptjs').hash(password, 10), status: D.PENDING_DOCS, tokenVersion: 0,
    });
  } catch (err) {
    if (require('../services/util').isUniqueError(err)) throw fail(409, 'PHONE_TAKEN', 'A driver account already uses this number.');
    throw err;
  }
  await audit(req, d.id, 'AUTO_DRIVER_CREATED_BY_ADMIN', { phoneLast4: phone.slice(-4) });
  notify.admin('auto_driver', 'created', d.id);
  res.status(201).json({ driver: S.driverAdmin(req, d), message: `Account created. The driver can now sign in with ${phone} and the temporary password.` });
};
const verifyDriver = async (req, res) => {
  const { Driver, Vehicle } = M();
  const d = await byId(Driver, req.params.id, 'Driver');
  if (![D.PENDING_REVIEW, D.REJECTED, D.PENDING_DOCS].includes(d.status)) throw fail(409, 'INVALID_STATE', `This driver is ${d.status.toLowerCase().replace('_', ' ')}.`);
  const missing = require('./driverProfile').missingForReview(d, await Vehicle.findAll({ where: { driverId: d.id } })).filter((m) => m !== 'vehicle');
  if (missing.length) throw fail(409, 'INCOMPLETE', `The driver is missing: ${missing.join(', ')}.`, { missing });
  const [n] = await Driver.update({ status: D.VERIFIED, reviewedAt: clock.now(), reviewedBy: req.user.id, rejectionReason: null }, { where: { id: d.id, status: d.status } });
  if (!n) throw fail(409, 'INVALID_STATE', 'Someone else already reviewed this driver.');
  await d.reload();
  await audit(req, d.id, 'AUTO_DRIVER_VERIFIED', { phoneLast4: String(d.phone).slice(-4) });
  notify.toDriver(d.id, 'You are verified ✅', 'Your Zenvy Auto Driver account is verified. Go online and publish your first trip.', { type: 'AUTO_DRIVER_VERIFIED' });
  notify.nudgeDriver(d.id, 'driver', d.id, d.status);
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverAdmin(req, d) });
};
const rejectDriver = async (req, res) => {
  const { Driver } = M();
  const reason = reasonOf(req.body);
  const d = await byId(Driver, req.params.id, 'Driver');
  if (![D.PENDING_REVIEW, D.PENDING_DOCS, D.VERIFIED].includes(d.status)) throw fail(409, 'INVALID_STATE', `This driver is ${d.status.toLowerCase()}.`);
  await d.update({ status: D.REJECTED, rejectionReason: reason, reviewedAt: clock.now(), reviewedBy: req.user.id, isOnline: false });
  await audit(req, d.id, 'AUTO_DRIVER_REJECTED', { reason });
  notify.toDriver(d.id, 'Verification needs changes', reason, { type: 'AUTO_DRIVER_REJECTED' });
  notify.nudgeDriver(d.id, 'driver', d.id, d.status);
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverAdmin(req, d) });
};
const suspendDriver = async (req, res) => {
  const { Driver, Trip } = M();
  const reason = reasonOf(req.body);
  const d = await byId(Driver, req.params.id, 'Driver');
  if (d.status === D.SUSPENDED) throw fail(409, 'INVALID_STATE', 'This driver is already suspended.');
  await d.update({ status: D.SUSPENDED, statusBeforeSuspension: d.status, suspendedReason: reason, isOnline: false, tokenVersion: (Number(d.tokenVersion) || 0) + 1, reviewedBy: req.user.id, reviewedAt: clock.now() });
  try { require('../../../utils/realtime').disconnectRevokedSockets(d.id, null); } catch { /* ignore */ }
  const active = await Trip.findAll({ where: { driverId: d.id, status: { [Op.in]: E.ACTIVE_TRIP_STATUSES.filter((s) => s !== T.IN_PROGRESS) } }, attributes: ['id'] });
  let tripsEnded = 0;
  for (const t of active) {
    try {
      const tr = await Trip.findByPk(t.id, { attributes: ['status'] });
      const to = E.canTransition(tr.status, T.DRIVER_UNAVAILABLE, 'admin') ? T.DRIVER_UNAVAILABLE : T.CANCELLED;
      await actions.endTrip({ tripId: t.id, to, actor: 'admin', actorId: req.user.id, reason: 'Driver unavailable' });
      tripsEnded++;
    } catch (err) { console.warn('[AUTORIDE_SUSPEND_TRIP_WARN]', err.message); }
  }
  await audit(req, d.id, 'AUTO_DRIVER_SUSPENDED', { reason, tripsEnded });
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverAdmin(req, d), tripsEnded });
};
const unsuspendDriver = async (req, res) => {
  const { Driver } = M();
  const d = await byId(Driver, req.params.id, 'Driver');
  if (d.status !== D.SUSPENDED) throw fail(409, 'INVALID_STATE', 'This driver is not suspended.');
  // S1: back to the status the suspension interrupted (a driver whose new documents were waiting for review
  // stays PENDING_REVIEW, never VERIFIED). Rows suspended before S1 have no record: they are re-reviewed.
  const prev = [D.PENDING_DOCS, D.PENDING_REVIEW, D.VERIFIED, D.REJECTED].includes(d.statusBeforeSuspension) ? d.statusBeforeSuspension : (d.submittedAt ? D.PENDING_REVIEW : D.PENDING_DOCS);
  await d.update({ status: prev, statusBeforeSuspension: null, suspendedReason: null, reviewedBy: req.user.id, reviewedAt: clock.now() });
  await audit(req, d.id, 'AUTO_DRIVER_REACTIVATED', { status: prev });
  notify.toDriver(d.id, 'Account reactivated', 'Your Zenvy Auto Driver account is active again. Please sign in.', { type: 'AUTO_DRIVER_REACTIVATED' });
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverAdmin(req, d) });
};

// ── Vehicles ────────────────────────────────────────────────────────────────
const vehicles = async (req, res) => {
  const { Vehicle } = M();
  const status = String(req.query.status || V.PENDING_REVIEW).toUpperCase();
  const where = {};
  if (status !== 'ALL') {
    if (!Object.values(V).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  if (req.query.driverId && isUuid(String(req.query.driverId))) where.driverId = String(req.query.driverId);
  const q = cleanText(req.query.q, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (q) where.registrationNumber = { [Op.like]: `%${q}%` };
  const pg = pageOpts(req.query, 200);
  const found = await Vehicle.findAll({ where, order: [['updatedAt', 'DESC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const settings = await flag.readSettings();
  res.json({
    vehicles: rows.map((v) => ({ ...S.vehicleSelf(req, v), suggestedApprovedCapacity: Math.min(Number(v.rcSeatingCapacity) || 0, settings.platformMaxCapacity) || null })),
    platformMaxCapacity: settings.platformMaxCapacity,
    pagination,
  });
};
// GET /api/admin/auto-ride/vehicles/:id  (vehicle + its driver + recent trips)
const vehicleDetail = async (req, res) => {
  const { Vehicle, Driver, Trip } = M();
  const v = await byId(Vehicle, req.params.id, 'Vehicle');
  const [d, trips, settings] = await Promise.all([
    Driver.findByPk(v.driverId),
    Trip.findAll({ where: { vehicleId: v.id }, order: [['createdAt', 'DESC']], limit: 30 }),
    flag.readSettings(),
  ]);
  res.json({
    vehicle: { ...S.vehicleSelf(req, v), suggestedApprovedCapacity: Math.min(Number(v.rcSeatingCapacity) || 0, settings.platformMaxCapacity) || null },
    driver: d ? { id: d.id, name: d.name, phone: d.phone, status: d.status, isOnline: !!d.isOnline } : null,
    trips: trips.map((t) => ({ id: t.id, ...S.tripStatus(t), routeId: t.routeId })),
    platformMaxCapacity: settings.platformMaxCapacity,
  });
};
// POST /api/admin/auto-ride/vehicles/:id/approve { approvedCapacity?, seatLayout? }
// approvedCapacity defaults to min(RC seating, platform max) (the RC document must be checked by the admin).
const approveVehicle = async (req, res) => {
  const { Vehicle, Driver } = M();
  const v = await byId(Vehicle, req.params.id, 'Vehicle');
  if (![V.PENDING_REVIEW, V.REJECTED, V.SUSPENDED].includes(v.status)) throw fail(409, 'INVALID_STATE', `This vehicle is ${v.status.toLowerCase()}.`);
  const settings = await flag.readSettings({ fresh: true });
  const rc = Number(v.rcSeatingCapacity) || 0;
  if (!rc) throw fail(409, 'INCOMPLETE', 'The RC seating capacity is missing.');
  const maxCap = Math.min(rc, settings.platformMaxCapacity);
  const body = req.body || {};
  const approvedCapacity = num(body.approvedCapacity, { min: 1, max: maxCap, int: true, field: 'approvedCapacity', label: `Approved capacity (RC ${rc}, platform max ${settings.platformMaxCapacity})` }) || maxCap;
  const seatLayout = body.seatLayout !== undefined && body.seatLayout !== null ? validateLayout(body.seatLayout, approvedCapacity) : defaultLayout(approvedCapacity);
  const docs = v.documents || {};
  const missing = E.REQUIRED_VEHICLE_DOCS.filter((k) => !docs[k]);
  if (!v.permitExpiresOn) missing.push('permitExpiresOn');
  if (!v.insuranceExpiresOn) missing.push('insuranceExpiresOn');
  if (missing.length) throw fail(409, 'INCOMPLETE', `The vehicle is missing: ${missing.join(', ')}.`, { missing });
  const today = istYmd(clock.now());
  for (const k of ['permitExpiresOn', 'insuranceExpiresOn', 'fitnessExpiresOn', 'pucExpiresOn']) {
    if (v[k] && String(v[k]).slice(0, 10) < today) throw fail(409, 'VEHICLE_PAPERS_EXPIRED', `${k} is in the past.`, { field: k });
  }
  const [n] = await Vehicle.update({ status: V.APPROVED, approvedCapacity, seatLayout, reviewedAt: clock.now(), reviewedBy: req.user.id, rejectionReason: null }, { where: { id: v.id, status: v.status } });
  if (!n) throw fail(409, 'INVALID_STATE', 'Someone else already reviewed this vehicle.');
  await v.reload();
  await audit(req, v.id, 'AUTO_VEHICLE_APPROVED', { registration: v.registrationNumber, rcSeatingCapacity: rc, approvedCapacity, platformMaxCapacity: settings.platformMaxCapacity });
  const d = await Driver.findByPk(v.driverId, { attributes: ['id'] });
  if (d) notify.toDriver(d.id, 'Auto approved ✅', `${S.prettyReg(v.registrationNumber)} is approved for ${approvedCapacity} passengers.`, { type: 'AUTO_VEHICLE_APPROVED', vehicleId: v.id });
  notify.admin('auto_vehicle', 'updated', v.id);
  res.json({ vehicle: S.vehicleSelf(req, v) });
};
const rejectVehicle = async (req, res) => {
  const { Vehicle } = M();
  const reason = reasonOf(req.body);
  const v = await byId(Vehicle, req.params.id, 'Vehicle');
  if (v.status === V.REJECTED) throw fail(409, 'INVALID_STATE', 'Already rejected.');
  await v.update({ status: V.REJECTED, rejectionReason: reason, approvedCapacity: null, reviewedAt: clock.now(), reviewedBy: req.user.id });
  await audit(req, v.id, 'AUTO_VEHICLE_REJECTED', { reason });
  notify.toDriver(v.driverId, 'Auto needs changes', reason, { type: 'AUTO_VEHICLE_REJECTED', vehicleId: v.id });
  notify.admin('auto_vehicle', 'updated', v.id);
  res.json({ vehicle: S.vehicleSelf(req, v) });
};
const suspendVehicle = async (req, res) => {
  const { Vehicle, Trip } = M();
  const reason = reasonOf(req.body);
  const v = await byId(Vehicle, req.params.id, 'Vehicle');
  if (v.status !== V.APPROVED) throw fail(409, 'INVALID_STATE', 'Only an approved vehicle can be suspended.');
  await v.update({ status: V.SUSPENDED, rejectionReason: reason, reviewedAt: clock.now(), reviewedBy: req.user.id });
  const active = await Trip.findAll({ where: { vehicleId: v.id, status: { [Op.in]: E.ACTIVE_TRIP_STATUSES.filter((s) => s !== T.IN_PROGRESS) } }, attributes: ['id'] });
  for (const t of active) {
    try { await actions.endTrip({ tripId: t.id, to: T.VEHICLE_UNAVAILABLE, actor: 'admin', actorId: req.user.id, reason: 'Vehicle unavailable' }); } catch (err) { console.warn('[AUTORIDE_SUSPEND_TRIP_WARN]', err.message); }
  }
  await audit(req, v.id, 'AUTO_VEHICLE_SUSPENDED', { reason });
  notify.toDriver(v.driverId, 'Auto suspended', reason, { type: 'AUTO_VEHICLE_SUSPENDED', vehicleId: v.id });
  notify.admin('auto_vehicle', 'updated', v.id);
  res.json({ vehicle: S.vehicleSelf(req, v) });
};

// ── Routes + pickup points ──────────────────────────────────────────────────
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const routeInput = (body, current = null) => {
  const out = {};
  const pick = (k) => (body[k] !== undefined ? body[k] : current ? current[k] : undefined);
  for (const [k, label] of [['name', 'Route name'], ['originLabel', 'Origin'], ['destinationLabel', 'Destination']]) {
    const v = cleanText(pick(k), 80);
    if (v.length < 2) throw fail(400, 'INVALID_INPUT', `${label} is required.`, { field: k });
    out[k] = v;
  }
  out.distanceKm = num(pick('distanceKm'), { min: 0, max: 500, field: 'distanceKm' });
  for (const k of ['seatFareMin', 'seatFareMax']) out[k] = num(pick(k), { min: 0, max: E.LIMITS.MAX_FARE, field: k });
  for (const k of ['fullFareMin', 'fullFareMax']) out[k] = num(pick(k), { min: 0, max: E.LIMITS.MAX_FULL_FARE, field: k });
  if (out.seatFareMin !== null && out.seatFareMax !== null && out.seatFareMin > out.seatFareMax) throw fail(400, 'INVALID_INPUT', 'Minimum seat fare is above the maximum.', { field: 'seatFareMin' });
  // Union queue: the seat fare autos put on charge use (null = the minimum, else the maximum seat fare).
  out.seatFareDefault = num(pick('seatFareDefault'), { min: 1, max: E.LIMITS.MAX_FARE, field: 'seatFareDefault', label: 'Default seat fare' });
  if (out.seatFareDefault !== null && out.seatFareMin !== null && out.seatFareDefault < out.seatFareMin) throw fail(400, 'INVALID_INPUT', `The default seat fare must be at least the minimum (₹${out.seatFareMin}).`, { field: 'seatFareDefault' });
  if (out.seatFareDefault !== null && out.seatFareMax !== null && out.seatFareDefault > out.seatFareMax) throw fail(400, 'INVALID_INPUT', `The default seat fare can be at most the maximum (₹${out.seatFareMax}).`, { field: 'seatFareDefault' });
  if (out.fullFareMin !== null && out.fullFareMax !== null && out.fullFareMin > out.fullFareMax) throw fail(400, 'INVALID_INPUT', 'Minimum full-auto fare is above the maximum.', { field: 'fullFareMin' });
  const periods = pick('operatingPeriods');
  if (periods !== undefined && periods !== null) {
    if (!Array.isArray(periods) || periods.length > 6) throw fail(400, 'INVALID_INPUT', 'operatingPeriods must be a list (up to 6).', { field: 'operatingPeriods' });
    out.operatingPeriods = periods.map((p, i) => {
      const key = String((p && p.key) || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20);
      if (!key || !TIME_RE.test(p.start) || !TIME_RE.test(p.end) || p.start === p.end) throw fail(400, 'INVALID_INPUT', `Period ${i + 1}: needs key, start and end (HH:MM, IST).`, { field: 'operatingPeriods' });
      return { key, label: cleanText(p.label, 30) || key, start: p.start, end: p.end };
    });
    if (new Set(out.operatingPeriods.map((p) => p.key)).size !== out.operatingPeriods.length) throw fail(400, 'INVALID_INPUT', 'Period keys must be different.', { field: 'operatingPeriods' });
  } else out.operatingPeriods = [];
  out.minSeatsToDepartDefault = num(pick('minSeatsToDepartDefault'), { min: 1, max: E.LIMITS.ABSOLUTE_MAX_CAPACITY, int: true, field: 'minSeatsToDepartDefault' });
  const stops = pick('permittedStops');
  out.permittedStops = Array.isArray(stops) ? [...new Set(stops.map((s) => cleanText(s, 80)).filter(Boolean))].slice(0, 20) : [];
  out.isActive = pick('isActive') !== false;
  out.sortOrder = num(pick('sortOrder'), { min: 0, max: 10000, int: true, field: 'sortOrder' }) || 0;
  const campusId = pick('campusId');
  out.campusId = campusId && isUuid(String(campusId)) ? String(campusId) : null;
  return out;
};
const listRoutes = async (req, res) => {
  const { Route, Pickup } = M();
  const pg = pageOpts(req.query, null);
  const found = await Route.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC'], ['id', 'ASC']], ...(pg.fetch ? { limit: pg.fetch, offset: pg.offset } : {}) });
  const { rows, pagination } = paginate(found, pg);
  const pickups = rows.length ? await Pickup.findAll({ where: { routeId: { [Op.in]: rows.map((r) => r.id) } }, order: [['sequence', 'ASC']] }) : [];
  res.json({ routes: rows.map((r) => S.routeFull(r, pickups.filter((p) => String(p.routeId) === String(r.id)))), pagination });
};
const createRoute = async (req, res) => {
  const row = await M().Route.create(routeInput(req.body || {}));
  await audit(req, row.id, 'AUTO_ROUTE_CREATED', { name: row.name });
  notify.admin('auto_route', 'created', row.id);
  res.status(201).json({ route: S.routeFull(row, []) });
};
const updateRoute = async (req, res) => {
  const { Route, Pickup } = M();
  const row = await byId(Route, req.params.id, 'Route');
  const data = routeInput(req.body || {}, row.get({ plain: true }));
  await row.update(data);
  await audit(req, row.id, 'AUTO_ROUTE_UPDATED', { fields: Object.keys(req.body || {}) });
  notify.admin('auto_route', 'updated', row.id);
  res.json({ route: S.routeFull(row, await Pickup.findAll({ where: { routeId: row.id }, order: [['sequence', 'ASC']] })) });
};
const pickupInput = (body, current = null) => {
  const pick = (k) => (body[k] !== undefined ? body[k] : current ? current[k] : undefined);
  const name = cleanText(pick('name'), 80);
  if (name.length < 2) throw fail(400, 'INVALID_INPUT', 'Pickup point name is required.', { field: 'name' });
  // Up to 6 decimals (about 0.1 m): 2 decimals would move the stand by up to ~1 km.
  const lat = num(pick('lat'), { min: -90, max: 90, field: 'lat', label: 'Latitude', decimals: 6 });
  const lon = num(pick('lon'), { min: -180, max: 180, field: 'lon', label: 'Longitude', decimals: 6 });
  if ((lat === null) !== (lon === null)) throw fail(400, 'INVALID_INPUT', 'Give both latitude and longitude, or neither.', { field: 'lat' });
  return { name, landmark: cleanText(pick('landmark'), 160) || null, lat, lon, sequence: num(pick('sequence'), { min: 0, max: 1000, int: true, field: 'sequence' }) || 0, isActive: pick('isActive') !== false };
};
const createPickup = async (req, res) => {
  const route = await byId(M().Route, req.params.id, 'Route');
  const row = await M().Pickup.create({ ...pickupInput(req.body || {}), routeId: route.id });
  await audit(req, row.id, 'AUTO_PICKUP_CREATED', { routeId: route.id, name: row.name });
  notify.admin('auto_route', 'updated', route.id);
  res.status(201).json({ pickupPoint: { ...S.pickupBrief(row), routeId: row.routeId, sequence: row.sequence, isActive: row.isActive !== false } });
};
const updatePickup = async (req, res) => {
  const row = await byId(M().Pickup, req.params.id, 'Pickup point');
  await row.update(pickupInput(req.body || {}, row.get({ plain: true })));
  await audit(req, row.id, 'AUTO_PICKUP_UPDATED', { fields: Object.keys(req.body || {}) });
  notify.admin('auto_route', 'updated', row.routeId);
  res.json({ pickupPoint: { ...S.pickupBrief(row), routeId: row.routeId, sequence: row.sequence, isActive: row.isActive !== false } });
};

// ── Trips + queues ──────────────────────────────────────────────────────────
const trips = async (req, res) => {
  const { Trip } = M();
  const where = {};
  const status = String(req.query.status || '').toUpperCase();
  if (status === 'ACTIVE') where.status = { [Op.in]: E.ACTIVE_TRIP_STATUSES };
  else if (status) {
    if (!Object.values(T).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  const date = ymd(req.query.date, 'date');
  if (date) where.operatingDate = date;
  if (req.query.driverId && isUuid(String(req.query.driverId))) where.driverId = String(req.query.driverId);
  for (const k of ['routeId', 'pickupPointId', 'vehicleId']) {
    if (req.query[k] === undefined || req.query[k] === '') continue;
    if (!isUuid(String(req.query[k]))) throw fail(400, 'INVALID_INPUT', `Unknown ${k}.`, { field: k });
    where[k] = String(req.query[k]);
  }
  const pg = pageOpts(req.query, 300);
  const found = await Trip.findAll({ where, order: [['departureAt', 'DESC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const { Route, Pickup, Driver } = M();
  const [routes, pickups, drivers] = await Promise.all([
    byIdsOf(Route, rows.map((t) => t.routeId)), byIdsOf(Pickup, rows.map((t) => t.pickupPointId)), byIdsOf(Driver, rows.map((t) => t.driverId), ['id', 'name']),
  ]);
  res.json({
    trips: rows.map((t) => {
      const route = routes.get(String(t.routeId));
      const pickup = pickups.get(String(t.pickupPointId));
      const d = drivers.get(String(t.driverId));
      return {
        ...S.tripDriver(req, t, { route, pickup }), driverId: t.driverId,
        routeName: route ? route.name : null, pickupName: pickup ? pickup.name : null, driverName: d ? S.shortName(d.name) : null,
      };
    }),
    pagination,
  });
};
const tripDetail = async (req, res) => {
  const { Trip, Booking, Event, Private } = M();
  const t = await byId(Trip, req.params.id, 'Trip');
  const [bks, events, reqs] = await Promise.all([
    Booking.findAll({ where: { tripId: t.id }, order: [['createdAt', 'ASC']] }),
    Event.findAll({ where: { tripId: t.id }, order: [['createdAt', 'ASC']] }),
    Private.findAll({ where: { tripId: t.id }, order: [['createdAt', 'ASC']] }),
  ]);
  const users = await usersById(bks.map((b) => b.userId));
  res.json({
    trip: { ...S.tripDriver(req, t, {}), driverId: t.driverId },
    bookings: bks.map((b) => S.bookingAdmin(b, { user: users.get(String(b.userId)) })),
    privateRequests: reqs.map((r) => ({ ...S.privateRequestCustomer(r), userId: r.userId })),
    events: events.map((e) => ({ id: e.id, from: e.fromStatus, to: e.toStatus, actorType: e.actorType, actorId: e.actorId, note: e.note, at: S.iso(e.createdAt) })),
  });
};
const cancelTrip = async (req, res) => {
  const reason = reasonOf(req.body);
  const t = await byId(M().Trip, req.params.id, 'Trip');
  const out = await actions.endTrip({ tripId: t.id, to: T.CANCELLED, actor: 'admin', actorId: req.user.id, reason });
  await audit(req, t.id, 'AUTO_TRIP_CANCELLED', { reason, bookingsCancelled: out.cancelled.length });
  notify.toDriver(t.driverId, 'Trip cancelled by Zenvy', reason, { type: 'AUTO_TRIP_CANCELLED', tripId: t.id });
  res.json({ trip: { ...S.tripDriver(req, out.trip, {}), driverId: out.trip.driverId }, bookingsCancelled: out.cancelled.length });
};
const queues = async (req, res) => {
  const { Trip, Pickup } = M();
  const date = ymd(req.query.date, 'date') || istYmd(clock.now());
  const where = { operatingDate: date, queueNumber: { [Op.ne]: null } };
  if (req.query.pickupPointId && isUuid(String(req.query.pickupPointId))) where.pickupPointId = String(req.query.pickupPointId);
  if (req.query.routeId && isUuid(String(req.query.routeId))) where.routeId = String(req.query.routeId);
  const pg = pageOpts(req.query, 500);
  const found = await Trip.findAll({ where, order: [['pickupPointId', 'ASC'], ['periodKey', 'ASC'], ['queueNumber', 'ASC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const pickups = rows.length ? await Pickup.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((r) => r.pickupPointId))] } } }) : [];
  const pmap = new Map(pickups.map((p) => [String(p.id), p]));
  res.json({ date, queue: rows.map((t) => ({ id: t.id, pickup: S.pickupBrief(pmap.get(String(t.pickupPointId))), periodKey: t.periodKey, driverId: t.driverId, ...S.tripStatus(t), checkInAt: S.iso(t.publishedAt) })), pagination });
};

// GET /api/admin/auto-ride/lines   union queue: every stand (pickup point + route) with the auto on charge, the
// autos waiting behind it in check-in order, and the seats filled by app bookings vs walk-ins.
const lines = async (req, res) => {
  const { Route, Pickup, Driver, Vehicle } = M();
  const chargeLine = require('../services/chargeLine');
  const routes = await Route.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const pickups = routes.length ? await Pickup.findAll({ where: { routeId: { [Op.in]: routes.map((r) => r.id) } }, order: [['sequence', 'ASC'], ['name', 'ASC']] }) : [];
  const out = [];
  for (const r of routes) {
    for (const p of pickups.filter((x) => String(x.routeId) === String(r.id))) {
      const rows = await chargeLine.lineTrips(p.id, r.id);
      if (!rows.length && (r.isActive === false || p.isActive === false)) continue;
      const [drivers, vehicles] = await Promise.all([
        byIdsOf(Driver, rows.map((t) => t.driverId), ['id', 'name', 'phone']),
        byIdsOf(Vehicle, rows.map((t) => t.vehicleId), ['id', 'registrationNumber']),
      ]);
      const fare = chargeLine.routeSeatFare(r);
      out.push({
        key: `${p.id}:${r.id}`,
        route: { ...S.routeBrief(r), isActive: r.isActive !== false, seatFareDefault: r.seatFareDefault === null || r.seatFareDefault === undefined ? null : Number(r.seatFareDefault), seatFareMin: r.seatFareMin, seatFareMax: r.seatFareMax },
        pickup: { ...S.pickupBrief(p), isActive: p.isActive !== false },
        seatFare: fare ? fare.fare : null,
        fareSource: fare ? fare.source : null,
        autos: rows.map((t, i) => {
          const d = drivers.get(String(t.driverId));
          const v = vehicles.get(String(t.vehicleId));
          const st = S.tripStatus(t);
          return {
            position: i + 1, tripId: t.id, driverId: t.driverId, driverName: d ? d.name : null, driverPhoneMasked: d ? maskPhone(d.phone) : null,
            registration: v ? S.prettyReg(v.registrationNumber) : null, queueState: t.queueState, status: t.status, statusLabel: st.statusLabel,
            capacity: st.capacity, appSeats: st.appSeats, walkInSeats: st.walkInSeats, heldSeats: st.heldSeats, remainingSeats: st.remainingSeats,
            seatFare: Number(t.seatFare), lineSeq: t.lineSeq || null, checkedInAt: S.iso(t.publishedAt), onChargeSince: S.iso(t.chargeStartedAt),
          };
        }),
      });
    }
  }
  res.json({ lines: out, serverTime: clock.now().toISOString() });
};

// ── Bookings ────────────────────────────────────────────────────────────────
const bookings = async (req, res) => {
  const { Booking, Trip } = M();
  const where = {};
  const code = cleanText(req.query.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code) where.bookingCode = code;
  const status = String(req.query.status || '').toUpperCase();
  if (status) {
    if (!Object.values(B).includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  for (const k of ['tripId', 'userId', 'driverId']) if (req.query[k] && isUuid(String(req.query[k]))) where[k] = String(req.query[k]);
  // Customer phone (admin only): the full 10-digit number, or its last 4 digits together with the booking code.
  const phoneQ = String(req.query.phone || '').replace(/\D/g, '');
  if (phoneQ) {
    const { normalizePhone } = require('../../../utils/phoneUtils');
    const { getUserModel } = require('../../../models/User');
    let users;
    if (phoneQ.length === 4) {
      if (!code) throw fail(400, 'INVALID_INPUT', 'Searching by the last 4 digits needs the booking code too.', { field: 'phone' });
      users = await getUserModel().findAll({ where: { phone: { [Op.like]: `%${phoneQ}` } }, attributes: ['id'], limit: 500 });
    } else {
      const full = normalizePhone(phoneQ);
      if (!full || !/^[6-9]\d{9}$/.test(full)) throw fail(400, 'INVALID_INPUT', 'Enter the full 10-digit mobile number, or its last 4 digits with the booking code.', { field: 'phone' });
      users = await getUserModel().findAll({ where: { phone: { [Op.in]: [...new Set([full, `+91${full}`, `91${full}`])] } }, attributes: ['id'], limit: 20 });
    }
    let ids = users.map((u) => String(u.id));
    if (where.userId) ids = ids.filter((x) => x === where.userId);
    where.userId = { [Op.in]: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] };
  }
  const pg = pageOpts(req.query, 300);
  const found = await Booking.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const users = await usersById(rows.map((b) => b.userId));
  const tIds = [...new Set(rows.map((b) => String(b.tripId)))];
  const ts = tIds.length ? await Trip.findAll({ where: { id: { [Op.in]: tIds } } }) : [];
  const tmap = new Map(ts.map((t) => [String(t.id), t]));
  res.json({ bookings: rows.map((b) => S.bookingAdmin(b, { user: users.get(String(b.userId)), trip: tmap.get(String(b.tripId)) })), pagination });
};
const cancelBooking = async (req, res) => {
  const { Booking } = M();
  const reason = reasonOf(req.body);
  const b0 = await byId(Booking, req.params.id, 'Booking');
  const out = await withTripLock(b0.tripId, async (t, trip) => {
    const b = await Booking.findByPk(b0.id, lockOpt(t));
    if (![B.HELD, B.CONFIRMED].includes(b.status)) throw fail(409, 'CANNOT_CANCEL', `This booking is ${b.status.toLowerCase()}.`);
    await alloc.cancelOneInTx(b, trip, { by: 'admin', reason, t, pct: 100 });
    await alloc.recomputeCounters(trip, t);
    await syncAvailability(trip, { t, actor: 'system' });
    return { booking: await Booking.findByPk(b.id, { transaction: t }), trip };
  });
  if (out.booking.status === B.REFUND_PENDING) { await payments.processRefund(out.booking.id); await out.booking.reload(); }
  await audit(req, out.booking.id, 'AUTO_BOOKING_CANCELLED', { reason, refund: money(out.booking.refundAmount) });
  notify.bookingEvent(out.booking, { title: 'Auto booking cancelled by Zenvy', body: reason, type: 'AUTO_BOOKING_CANCELLED', driverTitle: 'Booking cancelled', driverBody: `${out.booking.bookingCode} was cancelled by Zenvy.` });
  notify.tripEvent(out.trip, {});
  res.json({ booking: S.bookingAdmin(out.booking, {}) });
};
const retryRefund = async (req, res) => {
  const b = await byId(M().Booking, req.params.id, 'Booking');
  if (b.status !== B.REFUND_PENDING) throw fail(409, 'INVALID_STATE', 'No refund is pending for this booking.');
  const amount = await payments.processRefund(b.id);
  await b.reload();
  await audit(req, b.id, 'AUTO_REFUND_RETRIED', { amount });
  res.json({ booking: S.bookingAdmin(b, {}), refunded: amount });
};
const privateRequests = async (req, res) => {
  const where = {};
  const st = String(req.query.status || '').toUpperCase();
  if (st) {
    if (!Object.values(E.PRIVATE_STATUS).includes(st)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = st;
  }
  for (const k of ['tripId', 'driverId', 'userId']) if (req.query[k] && isUuid(String(req.query[k]))) where[k] = String(req.query[k]);
  const pg = pageOpts(req.query, 300);
  const found = await M().Private.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const [users, drivers] = await Promise.all([usersById(rows.map((r) => r.userId)), byIdsOf(M().Driver, rows.map((r) => r.driverId), ['id', 'name', 'phone'])]);
  res.json({
    requests: rows.map((r) => ({
      ...S.privateRequestCustomer(r), userId: r.userId, driverId: r.driverId,
      passenger: personBrief(users.get(String(r.userId))), driver: personBrief(drivers.get(String(r.driverId)), S.shortName),
    })),
    pagination,
  });
};

// ── Incidents ───────────────────────────────────────────────────────────────
const incidents = async (req, res) => {
  const status = String(req.query.status || 'OPEN').toUpperCase();
  const where = {};
  if (status === 'ACTIVE') where.status = { [Op.in]: ['OPEN', 'REVIEWING'] };
  else if (status !== 'ALL') {
    if (!E.INCIDENT_STATUS.includes(status)) throw fail(400, 'INVALID_INPUT', 'Unknown status.');
    where.status = status;
  }
  const pr = String(req.query.priority || '').toUpperCase();
  if (pr) {
    if (!Object.values(E.INCIDENT_PRIORITY).includes(pr)) throw fail(400, 'INVALID_INPUT', 'Unknown priority.');
    where.priority = pr;
  }
  const pg = pageOpts(req.query, 300);
  const found = await M().Incident.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'ASC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const [users, drivers] = await Promise.all([
    usersById(rows.filter((i) => i.reporterType === 'CUSTOMER').map((i) => i.reporterId)),
    byIdsOf(M().Driver, rows.filter((i) => i.reporterType === 'DRIVER').map((i) => i.reporterId), ['id', 'name', 'phone']),
  ]);
  res.json({
    incidents: rows.map((i) => ({
      ...S.incident(i), reporterId: i.reporterId,
      reporter: i.reporterType === 'DRIVER' ? personBrief(drivers.get(String(i.reporterId)), S.shortName) : personBrief(users.get(String(i.reporterId))),
    })),
    pagination,
  });
};
const updateIncident = async (req, res) => {
  const row = await byId(M().Incident, req.params.id, 'Incident');
  const status = String((req.body || {}).status || '').toUpperCase();
  if (!E.INCIDENT_STATUS.includes(status)) throw fail(400, 'INVALID_INPUT', `Status must be one of: ${E.INCIDENT_STATUS.join(', ')}.`, { field: 'status' });
  const note = cleanText((req.body || {}).note, 1000) || row.adminNote || null;
  const closed = ['RESOLVED', 'DISMISSED'].includes(status);
  await row.update({ status, adminNote: note, ...(closed ? { resolvedBy: req.user.id, resolvedAt: clock.now() } : { resolvedBy: null, resolvedAt: null }) });
  await audit(req, row.id, 'AUTO_INCIDENT_STATUS', { status });
  if (closed && row.reporterType === 'CUSTOMER') notify.toCustomers([row.reporterId], 'Your auto report was reviewed', note ? `Zenvy team: ${note}` : 'The Zenvy team has reviewed your report.', { type: 'AUTO_INCIDENT_UPDATE', incidentId: row.id });
  if (closed && row.reporterType === 'DRIVER') notify.toDriver(row.reporterId, 'Your report was reviewed', note ? `Zenvy team: ${note}` : 'The Zenvy team has reviewed your report.', { type: 'AUTO_INCIDENT_UPDATE', incidentId: row.id });
  notify.admin('auto_incident', 'updated', row.id);
  res.json({ incident: S.incident(row) });
};

// GET /api/admin/auto-ride/fares  (route bounds + recent trips outside them)
const fares = async (req, res) => {
  const { Route, Trip } = M();
  const routes = await Route.findAll();
  const since = new Date(clock.nowMs() - 30 * 24 * 60 * 60 * 1000);
  const rows = await Trip.findAll({ where: { createdAt: { [Op.gte]: since }, status: { [Op.ne]: T.DRAFT } }, attributes: ['id', 'routeId', 'seatFare', 'fullAutoFare', 'driverId', 'status', 'departureAt'], limit: 2000 });
  const rmap = new Map(routes.map((r) => [String(r.id), r]));
  const outliers = rows.filter((t) => {
    const r = rmap.get(String(t.routeId));
    if (!r) return false;
    const f = Number(t.seatFare);
    return (r.seatFareMin !== null && f < r.seatFareMin) || (r.seatFareMax !== null && f > r.seatFareMax);
  }).map((t) => ({
    id: t.id, routeId: t.routeId, routeName: (rmap.get(String(t.routeId)) || {}).name || null, seatFare: t.seatFare, fullAutoFare: t.fullAutoFare,
    driverId: t.driverId, status: t.status, departureAt: S.iso(t.departureAt),
  }));
  const byRoute = routes.map((r) => {
    const list = rows.filter((t) => String(t.routeId) === String(r.id)).map((t) => Number(t.seatFare));
    return { routeId: r.id, name: r.name, seatFareMin: r.seatFareMin, seatFareMax: r.seatFareMax, fullFareMin: r.fullFareMin, fullFareMax: r.fullFareMax, trips: list.length, avgSeatFare: list.length ? money(list.reduce((a, b) => a + b, 0) / list.length) : null };
  });
  res.json({ routes: byRoute, outliers });
};

// GET/PUT /api/admin/auto-ride/settings { enabled?, walletEnabled?, platformMaxCapacity?, ... }
const getSettings = async (req, res) => res.json({
  enabled: await flag.readFlag({ fresh: true }), walletEnabled: await flag.readWalletFlag({ fresh: true }), ...(await flag.readSettings({ fresh: true })),
  devOverride: flag.devEnabled(),
});
const putSettings = async (req, res) => {
  const body = req.body || {};
  const changed = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw fail(400, 'INVALID_INPUT', 'enabled must be true or false.', { field: 'enabled' });
    changed.enabled = await flag.writeFlag(body.enabled);
  }
  if (body.walletEnabled !== undefined) {
    if (typeof body.walletEnabled !== 'boolean') throw fail(400, 'INVALID_INPUT', 'walletEnabled must be true or false.', { field: 'walletEnabled' });
    changed.walletEnabled = await flag.writeWalletFlag(body.walletEnabled);
  }
  const settingKeys = Object.keys(E.DEFAULT_SETTINGS).filter((k) => body[k] !== undefined);
  if (settingKeys.length) {
    const patch = {};
    for (const k of settingKeys) patch[k] = body[k];
    Object.assign(changed, await flag.writeSettings(patch));
  }
  await audit(req, 'AUTO_RIDE_SETTINGS', 'AUTO_RIDE_SETTINGS_CHANGED', { keys: Object.keys(body), changed });
  notify.tripChanged(null);
  return getSettings(req, res);
};

// GET /api/admin/auto-ride/audit?targetId=
const auditLog = async (req, res) => {
  const { getVerificationLogModel } = require('../../../models/VerificationLog');
  const VL = getVerificationLogModel();
  const where = { action: { [Op.like]: 'AUTO_%' } };
  if (req.query.targetId) where.targetId = cleanText(req.query.targetId, 64);
  const pg = pageOpts(req.query, 300);
  const found = await VL.findAll({ where, order: [['timestamp', 'DESC'], ['id', 'DESC']], limit: pg.fetch, offset: pg.offset });
  const { rows, pagination } = paginate(found, pg);
  const admins = await usersById(rows.map((r) => r.adminId).filter((x) => isUuid(String(x))));
  res.json({
    entries: rows.map((r) => {
      const a = admins.get(String(r.adminId));
      return {
        id: r.id, adminId: r.adminId, actor: { id: r.adminId, name: a ? S.firstName(a.name) : null },
        targetId: r.targetId, action: r.action, details: (() => { try { return JSON.parse(r.details); } catch { return r.details; } })(), at: S.iso(r.timestamp),
      };
    }),
    pagination,
  });
};

module.exports = { createDriver,
  summary, drivers, driverDetail, verifyDriver, rejectDriver, suspendDriver, unsuspendDriver,
  vehicles, vehicleDetail, approveVehicle, rejectVehicle, suspendVehicle, listRoutes, createRoute, updateRoute, createPickup, updatePickup,
  trips, tripDetail, cancelTrip, queues, lines, bookings, cancelBooking, retryRefund, privateRequests, incidents, updateIncident,
  fares, getSettings, putSettings, auditLog,
};
