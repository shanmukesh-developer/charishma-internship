// Driver onboarding + account (/api/auto-ride/driver): profile, private documents, vehicles, review
// submission, online switch, notifications, incidents, home summary, earnings. Works while the feature
// switch is OFF (only publishing a trip needs it on).
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, cleanText, isUuid, num, ymd, hit, normalizeReg, REG_RE, isUniqueError } = require('../services/util');
const { checkDocMap, checkOwn, PURPOSE } = require('../services/media');
const S = require('../services/serialize');
const notify = require('../services/notify');
const clock = require('../services/clock');
const { normalizePhone } = require('../../../utils/phoneUtils');
const { istStartOfDay } = require('../../../utils/istTime');

const D = E.DRIVER_STATUS;
const V = E.VEHICLE_STATUS;
const M = () => ({
  Driver: getModel('AutoDriver'), Vehicle: getModel('AutoVehicle'), Route: getModel('AutoRoute'), Pickup: getModel('AutoPickupPoint'),
  Trip: getModel('AutoTrip'), Booking: getModel('AutoBooking'), Incident: getModel('AutoIncident'), Private: getModel('AutoPrivateRequest'),
});
const MAX_VEHICLES = 3;

// GET /api/auto-ride/driver/me
const me = async (req, res) => {
  const { Vehicle } = M();
  const vehicles = await Vehicle.findAll({ where: { driverId: req.driver.id }, order: [['createdAt', 'ASC']] });
  const enabled = await require('../services/flag').readFlag();
  res.json({
    driver: S.driverSelf(req, req.driver),
    vehicles: vehicles.map((v) => S.vehicleSelf(req, v)),
    canPublish: enabled && req.driver.status === D.VERIFIED && vehicles.some((v) => v.status === V.APPROVED),
    featureEnabled: enabled,
    missing: missingForReview(req.driver, vehicles),
  });
};

const missingForReview = (d, vehicles) => {
  const miss = [];
  const docs = d.documents || {};
  for (const k of E.REQUIRED_DRIVER_DOCS) if (!docs[k]) miss.push(`document:${k}`);
  if (!d.licenceNumber) miss.push('licenceNumber');
  if (!d.licenceExpiresOn) miss.push('licenceExpiresOn');
  if (!d.emergencyContactPhone) miss.push('emergencyContactPhone');
  if (!vehicles.some((v) => v.status !== V.REJECTED)) miss.push('vehicle');
  return miss;
};

/** Profile / document edits after verification send the account back to review. */
const backToReviewIfVerified = (d, changes) => {
  if (d.status === D.VERIFIED) {
    changes.status = D.PENDING_REVIEW;
    changes.isOnline = false;
    changes.submittedAt = clock.now();
  }
};

// PATCH /api/auto-ride/driver/me/profile
const updateProfile = async (req, res) => {
  hit('driver_write', req.driver.id);
  const body = req.body || {};
  const d = req.driver;
  const changes = {};
  let sensitive = false;
  if (body.name !== undefined) {
    const n = cleanText(body.name, 80);
    if (n.length < 2) throw fail(400, 'INVALID_INPUT', 'Enter your full name.', { field: 'name' });
    if (n !== d.name) { changes.name = n; sensitive = true; }
  }
  if (body.emergencyContactName !== undefined) changes.emergencyContactName = cleanText(body.emergencyContactName, 80) || null;
  if (body.emergencyContactPhone !== undefined) {
    const p = normalizePhone(body.emergencyContactPhone);
    if (p && !/^[6-9]\d{9}$/.test(p)) throw fail(400, 'INVALID_PHONE', 'Enter a valid 10-digit emergency contact number.', { field: 'emergencyContactPhone' });
    changes.emergencyContactPhone = p || null;
  }
  if (body.licenceNumber !== undefined) {
    const l = String(body.licenceNumber || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
    if (l && l.length < 8) throw fail(400, 'INVALID_INPUT', 'Enter the full driving licence number.', { field: 'licenceNumber' });
    if (l !== (d.licenceNumber || '')) { changes.licenceNumber = l || null; sensitive = true; }
  }
  if (body.licenceExpiresOn !== undefined) {
    const v = ymd(body.licenceExpiresOn, 'licenceExpiresOn');
    if (v && v < require('../../../utils/istTime').istYmd(clock.now())) throw fail(400, 'LICENCE_EXPIRED', 'This licence has already expired.', { field: 'licenceExpiresOn' });
    if (v !== (d.licenceExpiresOn || null)) { changes.licenceExpiresOn = v; sensitive = true; }
  }
  if (body.badgeNumber !== undefined) changes.badgeNumber = cleanText(body.badgeNumber, 30) || null;
  if (body.preferredRouteIds !== undefined) {
    const ids = Array.isArray(body.preferredRouteIds) ? [...new Set(body.preferredRouteIds.map(String))].filter(isUuid).slice(0, 10) : [];
    const found = ids.length ? await M().Route.count({ where: { id: { [Op.in]: ids } } }) : 0;
    if (found !== ids.length) throw fail(400, 'INVALID_INPUT', 'One of the routes does not exist.', { field: 'preferredRouteIds' });
    changes.preferredRouteIds = ids;
  }
  if (sensitive) backToReviewIfVerified(d, changes);
  await d.update(changes);
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverSelf(req, d) });
};

// POST /api/auto-ride/driver/media { image: base64 | dataUrl } or multipart 'image' -> private upload
const uploadMedia = async (req, res) => {
  hit('driver_write', req.driver.id);
  const store = require('../../../utils/imageStore');
  let buf = req.file && req.file.buffer ? req.file.buffer : null;
  if (!buf && req.body && typeof req.body.image === 'string') buf = store.decodeBase64Image(req.body.image, 5 * 1024 * 1024);
  if (buf === 'too_large') throw fail(413, 'FILE_TOO_LARGE', 'That photo is larger than 5 MB. Please pick a smaller one.');
  if (!buf || !buf.length) throw fail(400, 'NO_IMAGE', 'No photo received.');
  let saved;
  try {
    saved = await store.saveImageBytes(buf, { ownerId: req.driver.id, purpose: PURPOSE, isPrivate: true });
  } catch (err) {
    throw fail(err.status || 400, err.code || 'UPLOAD_FAILED', err.message);
  }
  const path = `/api/campus/media/${saved.id}`;
  res.status(201).json({ id: saved.id, url: path, previewUrl: S.signed(req, path), mime: saved.mime, size: saved.size, isPrivate: true });
};

// PUT /api/auto-ride/driver/me/documents { photo, licenceFront, licenceBack, badge?, policeVerification? }
const putDocuments = async (req, res) => {
  hit('driver_write', req.driver.id);
  const d = req.driver;
  const docs = await checkDocMap(d.id, (req.body || {}).documents || req.body || {}, E.DRIVER_DOC_KEYS, d.documents || {});
  const changes = { documents: docs };
  if (JSON.stringify(docs) !== JSON.stringify(d.documents || {})) backToReviewIfVerified(d, changes);
  await d.update(changes);
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverSelf(req, d) });
};

// POST /api/auto-ride/driver/me/submit   -> PENDING_REVIEW (admin verifies)
const submit = async (req, res) => {
  const d = req.driver;
  if (d.status === D.VERIFIED) return res.json({ driver: S.driverSelf(req, d), message: 'Your account is already verified.' });
  if (d.status === D.PENDING_REVIEW) return res.json({ driver: S.driverSelf(req, d), message: 'Already waiting for review.' });
  const vehicles = await M().Vehicle.findAll({ where: { driverId: d.id } });
  const missing = missingForReview(d, vehicles);
  if (missing.length) throw fail(409, 'INCOMPLETE', `Add these first: ${missing.join(', ')}.`, { missing });
  await d.update({ status: D.PENDING_REVIEW, submittedAt: clock.now(), rejectionReason: null });
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ driver: S.driverSelf(req, d), message: 'Sent for review. Zenvy checks your documents before you can take bookings.' });
};

// POST /api/auto-ride/driver/online { online }
const setOnline = async (req, res) => {
  const online = (req.body || {}).online;
  if (typeof online !== 'boolean') throw fail(400, 'INVALID_INPUT', 'online must be true or false.', { field: 'online' });
  const d = req.driver;
  if (online && d.status !== D.VERIFIED) throw fail(403, 'DRIVER_NOT_VERIFIED', 'Your account must be verified before you go online.');
  await d.update({ isOnline: online, ...(online ? { lastOnlineAt: clock.now() } : {}) });
  notify.admin('auto_driver', 'updated', d.id);
  res.json({ isOnline: !!d.isOnline });
};

const vehicleInput = async (driverId, body, current = null) => {
  const out = {};
  const reg = body.registrationNumber !== undefined ? normalizeReg(body.registrationNumber) : (current ? current.registrationNumber : '');
  if (!REG_RE.test(reg)) throw fail(400, 'INVALID_INPUT', 'Enter the registration number as on the RC (e.g. AP 07 TA 1234).', { field: 'registrationNumber' });
  out.registrationNumber = reg;
  if (body.make !== undefined) out.make = cleanText(body.make, 40) || null;
  if (body.model !== undefined) out.model = cleanText(body.model, 60) || null;
  if (body.colour !== undefined) out.colour = cleanText(body.colour, 30) || null;
  if (body.year !== undefined) out.year = num(body.year, { min: 1990, max: new Date().getFullYear() + 1, int: true, field: 'year' });
  if (body.fuel !== undefined) {
    const f = String(body.fuel || '').toUpperCase();
    if (f && !E.FUELS.includes(f)) throw fail(400, 'INVALID_INPUT', `Fuel must be one of ${E.FUELS.join(', ')}.`, { field: 'fuel' });
    out.fuel = f || null;
  }
  const rc = body.rcSeatingCapacity !== undefined ? num(body.rcSeatingCapacity, { min: 1, max: E.LIMITS.ABSOLUTE_MAX_CAPACITY, int: true, field: 'rcSeatingCapacity', label: 'RC seating capacity' }) : (current ? current.rcSeatingCapacity : null);
  if (!rc) throw fail(400, 'INVALID_INPUT', 'Enter the passenger seating capacity printed on the RC.', { field: 'rcSeatingCapacity' });
  out.rcSeatingCapacity = rc;
  const reqCap = body.requestedCapacity !== undefined ? num(body.requestedCapacity, { min: 1, max: rc, int: true, field: 'requestedCapacity', label: 'Requested capacity' }) : (current ? current.requestedCapacity : null);
  out.requestedCapacity = Math.min(reqCap || rc, rc);
  if (body.permitNumber !== undefined) out.permitNumber = cleanText(body.permitNumber, 40) || null;
  for (const k of ['permitExpiresOn', 'insuranceExpiresOn', 'fitnessExpiresOn', 'pucExpiresOn']) if (body[k] !== undefined) out[k] = ymd(body[k], k);
  if (body.documents !== undefined) out.documents = await checkDocMap(driverId, body.documents, E.VEHICLE_DOC_KEYS, current ? current.documents || {} : {});
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > E.LIMITS.MAX_VEHICLE_PHOTOS) throw fail(400, 'INVALID_INPUT', `Add up to ${E.LIMITS.MAX_VEHICLE_PHOTOS} vehicle photos.`, { field: 'photos' });
    out.photos = await checkOwn(driverId, body.photos, { field: 'photos', keep: current ? current.photos || [] : [] });
  }
  return out;
};

// GET/POST/PATCH /api/auto-ride/driver/vehicles
const listVehicles = async (req, res) => {
  const rows = await M().Vehicle.findAll({ where: { driverId: req.driver.id }, order: [['createdAt', 'ASC']] });
  res.json({ vehicles: rows.map((v) => S.vehicleSelf(req, v)) });
};
const createVehicle = async (req, res) => {
  hit('driver_write', req.driver.id);
  const { Vehicle } = M();
  const count = await Vehicle.count({ where: { driverId: req.driver.id, status: { [Op.ne]: V.REJECTED } } });
  if (count >= MAX_VEHICLES) throw fail(409, 'TOO_MANY_VEHICLES', `You can register up to ${MAX_VEHICLES} autos.`);
  const data = await vehicleInput(req.driver.id, req.body || {});
  const clash = await Vehicle.findOne({ where: { registrationNumber: data.registrationNumber, status: { [Op.in]: E.VEHICLE_LIVE_STATUSES } }, attributes: ['id'] });
  if (clash) throw fail(409, 'REGISTRATION_TAKEN', 'This registration number is already registered on Zenvy. Contact support if it is your auto.');
  let v;
  try {
    v = await Vehicle.create({ ...data, driverId: req.driver.id, status: V.PENDING_REVIEW });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'REGISTRATION_TAKEN', 'This registration number is already registered on Zenvy.');
    throw err;
  }
  notify.admin('auto_vehicle', 'created', v.id);
  res.status(201).json({ vehicle: S.vehicleSelf(req, v) });
};
const updateVehicle = async (req, res) => {
  hit('driver_write', req.driver.id);
  const { Vehicle, Trip } = M();
  const id = String(req.params.id || '');
  const v = isUuid(id) ? await Vehicle.findByPk(id) : null;
  if (!v || String(v.driverId) !== String(req.driver.id)) throw fail(404, 'NOT_FOUND', 'Vehicle not found.');
  if (v.status === V.SUSPENDED) throw fail(409, 'VEHICLE_SUSPENDED', 'This auto is suspended. Contact Zenvy support.');
  const active = await Trip.findOne({ where: { vehicleId: v.id, status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } }, attributes: ['id'] });
  if (active) throw fail(409, 'ACTIVE_TRIP_EXISTS', 'Finish or cancel the current trip before editing this auto.');
  const data = await vehicleInput(req.driver.id, req.body || {}, v);
  if (data.registrationNumber !== v.registrationNumber) {
    const clash = await Vehicle.findOne({ where: { registrationNumber: data.registrationNumber, status: { [Op.in]: E.VEHICLE_LIVE_STATUSES }, id: { [Op.ne]: v.id } }, attributes: ['id'] });
    if (clash) throw fail(409, 'REGISTRATION_TAKEN', 'This registration number is already registered on Zenvy.');
  }
  // Any change goes back to review; the admin sets the approved capacity again.
  await v.update({ ...data, status: V.PENDING_REVIEW, approvedCapacity: null, rejectionReason: null });
  notify.admin('auto_vehicle', 'updated', v.id);
  res.json({ vehicle: S.vehicleSelf(req, v) });
};

// GET /api/auto-ride/driver/routes  (active routes + pickup points, for publishing / preferences)
const routes = async (req, res) => {
  const { Route, Pickup } = M();
  const rows = await Route.findAll({ where: { isActive: { [Op.not]: false } }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const pickups = rows.length ? await Pickup.findAll({ where: { routeId: { [Op.in]: rows.map((r) => r.id) }, isActive: { [Op.not]: false } }, order: [['sequence', 'ASC']] }) : [];
  res.json({ routes: rows.map((r) => S.routeFull(r, pickups.filter((p) => String(p.routeId) === String(r.id)))) });
};

// GET /api/auto-ride/driver/notifications  /  POST /notifications/read { ids? }
const notifications = async (req, res) => {
  const { getNotificationModel } = require('../../../models/Notification');
  const N = getNotificationModel();
  const rows = await N.findAll({ where: { userId: req.driver.id }, order: [['createdAt', 'DESC']], limit: 100 });
  res.json({
    notifications: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, type: n.type, data: n.data, readAt: S.iso(n.readAt), createdAt: S.iso(n.createdAt) })),
    unread: rows.filter((n) => !n.readAt).length,
  });
};
const markRead = async (req, res) => {
  const { getNotificationModel } = require('../../../models/Notification');
  const N = getNotificationModel();
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(isUuid).slice(0, 200) : null;
  const where = { userId: req.driver.id, readAt: null, ...(ids ? { id: { [Op.in]: ids } } : {}) };
  const [n] = await N.update({ readAt: clock.now() }, { where });
  res.json({ updated: n });
};

// POST /api/auto-ride/driver/incidents { tripId?, bookingId?, category, description }
const reportIncident = async (req, res) => {
  const body = req.body || {};
  const { Trip, Booking, Incident } = M();
  const category = String(body.category || '').toUpperCase();
  if (!E.INCIDENT_CATEGORIES.includes(category)) throw fail(400, 'INVALID_INPUT', `Category must be one of: ${E.INCIDENT_CATEGORIES.join(', ')}.`, { field: 'category' });
  const description = cleanText(body.description, 2000, { multiline: true });
  if (description.length < 5) throw fail(400, 'INVALID_INPUT', 'Describe what happened (at least 5 characters).', { field: 'description' });
  let tripId = null;
  let bookingId = null;
  if (body.tripId) {
    const t = isUuid(String(body.tripId)) ? await Trip.findByPk(body.tripId) : null;
    if (!t || String(t.driverId) !== String(req.driver.id)) throw fail(404, 'NOT_FOUND', 'Trip not found.');
    tripId = t.id;
  }
  if (body.bookingId) {
    const b = isUuid(String(body.bookingId)) ? await Booking.findByPk(body.bookingId) : null;
    if (!b || String(b.driverId) !== String(req.driver.id)) throw fail(404, 'NOT_FOUND', 'Booking not found.');
    bookingId = b.id;
    tripId = tripId || b.tripId;
  }
  hit('incident', `driver:${req.driver.id}`);
  const priority = E.HIGH_PRIORITY_CATEGORIES.includes(category) ? E.INCIDENT_PRIORITY.HIGH : E.INCIDENT_PRIORITY.NORMAL;
  const row = await Incident.create({ tripId, bookingId, reporterType: 'DRIVER', reporterId: req.driver.id, category, priority, description });
  notify.admin('auto_incident', 'created', row.id);
  res.status(201).json({ incident: S.incident(row), message: category === 'SAFETY' ? 'Reported. If anyone is in danger call 112 now.' : 'Reported to the Zenvy team.' });
};

// POST /api/auto-ride/driver/sos { tripId?, note?, lat?, lon? }
// A SAFETY incident with HIGH priority (linked to the given trip, else the driver's current trip), the admin
// panel told live (admin:changed auto_incident) and every admin device pushed (utils/adminAlert.pushAdmins).
// Works while the feature switch is off. Location: lat / lon when the app sends them, otherwise the trip's
// pickup stand as the last known spot (locationSource 'gps' | 'pickupPoint' | null in the reply).
const sos = async (req, res) => {
  const body = req.body || {};
  const { Trip, Incident, Pickup } = M();
  hit('sos', req.driver.id);
  let trip = null;
  if (body.tripId) {
    trip = isUuid(String(body.tripId)) ? await Trip.findByPk(body.tripId) : null;
    if (!trip || String(trip.driverId) !== String(req.driver.id)) throw fail(404, 'NOT_FOUND', 'Trip not found.');
  } else {
    trip = await Trip.findOne({ where: { driverId: req.driver.id, status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } }, order: [['departureAt', 'ASC']] });
  }
  const lat = num(body.lat, { min: -90, max: 90, field: 'lat', label: 'Latitude', decimals: 6 });
  const lon = num(body.lon, { min: -180, max: 180, field: 'lon', label: 'Longitude', decimals: 6 });
  const note = cleanText(body.note, 300, { multiline: true });
  let where = lat !== null && lon !== null ? ` Location: ${lat},${lon} (https://www.google.com/maps/search/?api=1&query=${lat},${lon}).` : '';
  let locationSource = where ? 'gps' : null;
  // No live GPS from this app: the trip's pickup stand (admin-entered coordinates) is the last known spot,
  // clearly labelled as such so nobody mistakes it for a live position.
  let spotName = null;
  if (!where && trip && trip.pickupPointId) {
    try {
      const p = await Pickup.findByPk(trip.pickupPointId, { attributes: ['id', 'name', 'landmark', 'lat', 'lon'] });
      if (p) {
        spotName = p.name;
        const plat = Number(p.lat);
        const plon = Number(p.lon);
        const coords = p.lat !== null && p.lon !== null && Number.isFinite(plat) && Number.isFinite(plon)
          ? ` ${plat},${plon} (https://www.google.com/maps/search/?api=1&query=${plat},${plon})` : '';
        where = ` Last known spot (trip pickup stand, not live GPS): ${p.name}${p.landmark ? `, ${p.landmark}` : ''}.${coords ? `${coords}.` : ''}`;
        locationSource = 'pickupPoint';
      }
    } catch { /* the SOS itself must never fail on this */ }
  }
  const description = `SOS from the Zenvy Auto Driver app${note ? `: ${note}` : '.'}${where}`.slice(0, 2000);
  const row = await Incident.create({
    tripId: trip ? trip.id : null, bookingId: null, reporterType: 'DRIVER', reporterId: req.driver.id,
    category: 'SAFETY', priority: E.INCIDENT_PRIORITY.HIGH, description,
  });
  notify.admin('auto_incident', 'created', row.id);
  const d = req.driver;
  const io = req.app && typeof req.app.get === 'function' ? req.app.get('io') : null;
  // Fire-and-forget (never blocks the reply); pushAdmins never throws.
  Promise.resolve(require('../../../utils/adminAlert').pushAdmins(
    '🚨 Auto driver SOS',
    `${S.shortName(d.name)} (${d.phone}) pressed SOS${trip ? ` on trip queue #${trip.queueNumber || '-'}` : ''}${spotName ? ` near ${spotName}` : ''}${note ? `: ${note}` : ''}. Call them now.`,
    { type: 'AUTO_DRIVER_SOS', incidentId: String(row.id), ...(trip ? { tripId: String(trip.id) } : {}), driverId: String(d.id) },
    { io },
  )).catch(() => {});
  res.status(201).json({
    incident: S.incident(row), emergencyNumber: '112', locationSource,
    message: 'Zenvy has been alerted and will call you back. If anyone is in danger call 112 now.',
  });
};

// GET /api/auto-ride/driver/settings  (the limits publish / booking use; read-only)
const settings = async (req, res) => {
  res.json({ settings: await require('../services/flag').publicSettings() });
};

// GET /api/auto-ride/driver/pickup-points/:id/queue?date=YYYY-MM-DD  (same data as the customer queue; no passenger data)
const pickupQueue = async (req, res) => {
  res.json(await require('./customer').queueFor(req, req.params.id, req.query.date, { driverId: req.driver.id }));
};

// GET /api/auto-ride/driver/home
const home = async (req, res) => {
  const { Trip, Private, Vehicle, Route, Pickup } = M();
  const d = req.driver;
  const current = await Trip.findOne({ where: { driverId: d.id, status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } }, order: [['departureAt', 'ASC']] });
  const dayStart = istStartOfDay(clock.now());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const todays = await Trip.findAll({ where: { driverId: d.id, departureAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd }, status: { [Op.ne]: E.TRIP_STATUS.DRAFT } }, order: [['departureAt', 'ASC']], limit: 50 });
  const pending = await Private.count({ where: { driverId: d.id, status: E.PRIVATE_STATUS.REQUESTED } });
  const earn = await require('../services/tripActions').earnings(d.id, dayStart, dayEnd);
  let cur = null;
  if (current) {
    const [route, pickup, vehicle] = await Promise.all([Route.findByPk(current.routeId), Pickup.findByPk(current.pickupPointId), Vehicle.findByPk(current.vehicleId)]);
    cur = S.tripDriver(req, current, { route, pickup, vehicle });
  }
  res.json({
    driver: { id: d.id, name: d.name, status: d.status, isOnline: !!d.isOnline },
    currentTrip: cur,
    todayTrips: todays.map((t) => ({ id: t.id, ...S.tripStatus(t) })),
    todayEarnings: earn,
    pendingPrivateRequests: pending,
    // Limits the publish form must respect (also enforced by the server).
    settings: await require('../services/flag').publicSettings(),
    alerts: [
      ...(d.status !== D.VERIFIED ? [{ type: 'VERIFICATION', message: d.status === D.REJECTED ? `Verification needs changes: ${d.rejectionReason || ''}` : 'Your account is waiting for verification.' }] : []),
      ...(pending ? [{ type: 'PRIVATE_REQUESTS', message: `${pending} full-auto request${pending === 1 ? '' : 's'} waiting for you.` }] : []),
    ],
  });
};

// GET /api/auto-ride/driver/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD (IST days, inclusive)
const earningsRoute = async (req, res) => {
  const { istDayStartOf, istYmd } = require('../../../utils/istTime');
  const today = istYmd(clock.now());
  const from = ymd(req.query.from, 'from') || today;
  const to = ymd(req.query.to, 'to') || today;
  if (to < from) throw fail(400, 'INVALID_INPUT', '"to" must be on or after "from".');
  const out = await require('../services/tripActions').earnings(req.driver.id, istDayStartOf(from), new Date(istDayStartOf(to).getTime() + 24 * 60 * 60 * 1000));
  res.json({ from, to, ...out });
};

module.exports = {
  me, updateProfile, uploadMedia, putDocuments, submit, setOnline, listVehicles, createVehicle, updateVehicle, routes,
  notifications, markRead, reportIncident, home, earningsRoute, missingForReview, sos, settings, pickupQueue,
};
