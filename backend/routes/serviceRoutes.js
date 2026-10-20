const express = require('express');
const router = express.Router();
const { getServiceBookingModel } = require('../models/ServiceBooking');
const { getUserModel } = require('../models/User');
const { protect, admin } = require('../middleware/authMiddleware');

const { getMenuItemModel } = require('../models/MenuItem');
const { getRestaurantModel } = require('../models/Restaurant');

// Store types whose products are services (booked here, never ordered). A product in one of these
// stores is bookable even if it was added without specs.bookingOnly (admin-added / older rows).
const SERVICE_VENDOR_TYPES = ['REPAIRS', 'PRINT', 'LAUNDRY', 'TAILORING'];
// Laundry (per kg / per piece) and tailoring (per piece): the student's quantity multiplies the card
// price. Tailoring forms allow up to 20 pieces; the tailor can still confirm or adjust the total.
const MAX_SERVICE_QTY = 50;
const PER_UNIT_CATEGORIES = ['laundry', 'tailoring'];
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[<>]/g, '').trim().slice(0, max) : '');
// S1: PATCH /:id/status driverDetails -> { name, phone, vehicleNumber, vehicleType, eta } (strings, capped).
const DRIVER_DETAIL_FIELDS = { name: 60, phone: 16, vehicleNumber: 20, vehicleType: 30, eta: 40 };
const cleanDriverDetails = (raw) => {
  const out = {};
  for (const [k, max] of Object.entries(DRIVER_DETAIL_FIELDS)) {
    const v = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : undefined;
    const s = typeof v === 'number' ? String(v) : v;
    const c = k === 'phone' ? cleanText(s, 32).replace(/[^\d+]/g, '').slice(0, max) : cleanText(s, max);
    if (c) out[k] = c;
  }
  return out;
};

// specifications.details: the booking form's answers as [{ key, label, value }] (customer-mobile
// modules/services/serviceForms.ts). Bounded: at most 25 rows of short plain text; anything else is dropped.
const MAX_DETAIL_ROWS = 25;
const cleanBookingDetails = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(0, MAX_DETAIL_ROWS)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const key = cleanText(row.key, 40).replace(/[^A-Za-z0-9_.-]/g, '');
    const label = cleanText(row.label, 60);
    const value = typeof row.value === 'number' && Number.isFinite(row.value) ? String(row.value) : cleanText(row.value, 500);
    if (key && label && value) out.push({ key, label, value });
  }
  return out;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SERVICE_TYPES = [
  'LAPTOP_REPAIR', 'PHONE_REPAIR', 'TAILORING', 'PRINTOUT', 'LAUNDRY', 'ROOM_SHIFTING',
  'AUTO_RIDE', 'BIKE_TAXI', 'STATION_CAB', 'PG_BOOKING', 'MATTRESS_DELIVERY',
  'ELECTRONICS_DELIVERY', 'GROCERY_DELIVERY', 'PHARMACY_DELIVERY', 'GENERAL',
];
// A catalogue item from a service store books only its own kind of service (B27): a cheap print
// item can no longer be used to price a laptop repair.
const SERVICE_TYPES_FOR_STORE = {
  PRINT: ['PRINTOUT'],
  LAUNDRY: ['LAUNDRY'],
  TAILORING: ['TAILORING'],
  REPAIRS: ['LAPTOP_REPAIR', 'PHONE_REPAIR', 'GENERAL'],
};
const toInt = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};
const specsOf = (item) => {
  let specs = item && item.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' ? specs : {};
};

// Server-side price of a service booking, from the same catalogue rows the app shows (M11 / ordering-n15).
// Print: per-page rate (B&W or colour) × pages × copies + binding, exactly like the print sheet.
// Others: the service card price. Returns { amount, item } or { error }.
const priceServiceBooking = async (specifications, serviceType = null) => {
  const spec = specifications && typeof specifications === 'object' ? specifications : {};
  const itemId = String(spec.catalogueItemId || '');
  if (!UUID_RE.test(itemId)) return { amount: 0, item: null }; // older app: the partner sends a quote
  const MenuItem = getMenuItemModel();
  const item = await MenuItem.findByPk(itemId);
  const Restaurant = getRestaurantModel();
  const store = item && Restaurant ? await Restaurant.findByPk(item.restaurantId) : null;
  const isServiceStore = !!store && SERVICE_VENDOR_TYPES.includes(String(store.vendorType || '').toUpperCase());
  if (!item || !(specsOf(item).bookingOnly || isServiceStore) || (store && store.isActive === false)) {
    return { error: 'This service is no longer available. Please pick another one.' };
  }
  const inStock = item.isAvailable !== false || !!(item.outOfStockUntil && new Date(item.outOfStockUntil) <= new Date());
  if (!inStock) return { error: `${item.name} is not taking bookings right now.` };

  const storeKind = String((store && store.vendorType) || '').toUpperCase();
  if (serviceType && SERVICE_TYPES_FOR_STORE[storeKind] && !SERVICE_TYPES_FOR_STORE[storeKind].includes(serviceType)) {
    return { error: `${item.name} cannot be booked as ${String(serviceType).toLowerCase().replace(/_/g, ' ')}. Please pick the matching service.` };
  }

  const isPrint = String(spec.category || '').toLowerCase() === 'print';
  if (!isPrint) {
    // Laundry and tailoring: price x quantity. Other services: the card price.
    const qty = PER_UNIT_CATEGORIES.includes(String(spec.category || '').toLowerCase()) ? toInt(spec.quantity, 1, MAX_SERVICE_QTY, 1) : 1;
    return { amount: Math.round((Number(item.price) || 0) * qty * 100) / 100, item, quantity: qty };
  }

  const storeItems = await MenuItem.findAll({ where: { restaurantId: item.restaurantId } });
  const RATE_RES = {
    bw: /black|b\s*&\s*w|b\/w/i,
    color: /colou?r/i,
    spiral: /spiral/i,
    hardbound: /hard\s*bound|thesis/i,
  };
  const rate = (re) => {
    const hit = storeItems.find((i) => re.test(String(i.name || '')));
    return hit ? Number(hit.price) || 0 : null;
  };
  const rates = { bw: rate(RATE_RES.bw), color: rate(RATE_RES.color), spiral: rate(RATE_RES.spiral), hardbound: rate(RATE_RES.hardbound) };
  const pages = toInt(spec.pageCount, 1, 5000, 1);
  const copies = toInt(spec.copies, 1, 500, 1);
  // A print item that is not one of the rate rows (e.g. "Engineering Drawing A3 Prints") is its own
  // per-page price; it used to be charged at the A4 black-and-white rate. Same rule in the app
  // (customer-mobile/modules/services/serviceForms.ts, pricing ownRate).
  const itemName = String(item.name || '');
  const ownRate = !Object.values(RATE_RES).some((re) => re.test(itemName));
  const perPage = ownRate
    ? (Number(item.price) || 0)
    : ((spec.printColor === 'color' ? rates.color : rates.bw) ?? (Number(item.price) || 0));
  const binding = spec.bindingType === 'spiral' ? (rates.spiral ?? 0) : spec.bindingType === 'hardbound' ? (rates.hardbound ?? 0) : 0;
  const amount = Math.round((pages * perPage * copies + binding) * 100) / 100;
  if (amount > 100000) return { error: 'That print job is too large to book in the app. Please contact support.' };
  return { amount, item };
};

const isAdminUser = (user) => !!(user && typeof user.role === 'string' && user.role.toLowerCase() === 'admin');
// Only the customer who booked, the assigned partner, or an admin may see a booking.
const canViewBooking = (booking, user) => !!user && (
  booking.userId === user.id || isAdminUser(user) || (booking.assignedPartnerId && booking.assignedPartnerId === user.id)
);

// Non-UUID ids would make Postgres throw: answer 404 instead of a 500.
router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(String(id || ''))) return res.status(404).json({ success: false, message: 'Booking not found' });
  next();
});

const BOOKING_STATUSES = ['REQUESTED', 'DIAGNOSED_QUOTED', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];

// Allowed partner/admin moves. COMPLETED and CANCELLED are final. Going back to
// DIAGNOSED_QUOTED means "the student must approve a new price".
const BOOKING_TRANSITIONS = {
  REQUESTED: ['DIAGNOSED_QUOTED', 'CONFIRMED', 'IN_PROGRESS', 'CANCELLED'],
  DIAGNOSED_QUOTED: ['DIAGNOSED_QUOTED', 'CANCELLED'],
  CONFIRMED: ['DIAGNOSED_QUOTED', 'IN_PROGRESS', 'READY_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['DIAGNOSED_QUOTED', 'READY_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
  READY_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
const PRICE_LOCKED_AFTER_APPROVAL = ['CONFIRMED', 'IN_PROGRESS', 'READY_FOR_DELIVERY'];

/**
 * Writes `changes` only if the booking is still in the status we read (and matches
 * `extraWhere`), so a cancel, a quote answer and a partner update can never overwrite each
 * other. Returns the fresh row, or null when someone else changed the booking first.
 */
const saveIfUnchanged = async (ServiceBooking, booking, changes, extraWhere = {}) => {
  const [n] = await ServiceBooking.update(changes, { where: { id: booking.id, status: booking.status, ...extraWhere } });
  if (!n) return null;
  return ServiceBooking.findByPk(booking.id);
};
const staleBooking = (res) => res.status(409).json({ success: false, message: 'This booking was just updated. Please refresh and try again.' });

// Create a new Service Booking (Laptop Repair, Printout, Laundry, Auto Ride, Room Shift)
// Retry key (customer-2): Idempotency-Key header or specifications.clientRequestId. A repeat
// returns the first booking (duplicate: true); 409 only while the first one is still being saved.
const BOOKING_KEY_WINDOW_MS = 24 * 60 * 60 * 1000;
router.post('/book', protect, async (req, res) => {
  const { readIdempotencyKey, claim } = require('../utils/idempotency');
  const rawSpecs = (req.body || {}).specifications;
  const bookingKey = readIdempotencyKey(req, rawSpecs && typeof rawSpecs === 'object' ? rawSpecs.clientRequestId : undefined, (req.body || {}).idempotencyKey);
  const slot = await claim('service-book', req.user.id, bookingKey);
  if (slot.state === 'busy') {
    return res.status(409).json({ success: false, code: 'BOOKING_IN_PROGRESS', message: 'Your booking is still being saved. Hang tight.' });
  }
  if (slot.state === 'done') return res.status(slot.status).json({ ...slot.body, duplicate: true });
  try {
    const ServiceBooking = getServiceBookingModel();
    if (!ServiceBooking) {
      return res.status(500).json({ success: false, message: 'ServiceBooking model not initialized' });
    }
    const replayBooking = (booking) => res.status(200).json({
      success: true,
      duplicate: true,
      message: 'Service booked successfully! Our executive will connect with you.',
      booking,
    });
    // Survives restarts: the key is stored on the booking itself.
    if (bookingKey) {
      const { Op } = require('sequelize');
      const existing = await ServiceBooking.findOne({
        where: { userId: req.user.id, idempotencyKey: bookingKey, createdAt: { [Op.gt]: new Date(Date.now() - BOOKING_KEY_WINDOW_MS) } },
      });
      if (existing) return replayBooking(existing);
    }

    const {
      serviceType,
      title,
      description,
      specifications,
      attachmentUrl,
      quotedAmount,
      pickupSlot,
      hostelBlock,
      roomNumber,
      deliveryAddress,
      contactPhone,
      paymentMethod,
    } = req.body;

    if (!serviceType || !title) {
      return res.status(400).json({ success: false, message: 'serviceType and title are required' });
    }

    if (!VALID_SERVICE_TYPES.includes(serviceType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid serviceType. Valid types: ${VALID_SERVICE_TYPES.join(', ')}`,
      });
    }

    if (typeof title !== 'string' || typeof serviceType !== 'string' || (description != null && typeof description !== 'string')) {
      return res.status(400).json({ success: false, message: 'serviceType, title and description must be text.' });
    }
    if (title.length > 200) {
      return res.status(400).json({ success: false, message: 'Title must be under 200 characters' });
    }

    if (description && description.length > 2000) {
      return res.status(400).json({ success: false, message: 'Description must be under 2000 characters' });
    }

    // The client's quotedAmount is ignored: the price comes from the catalogue (see priceServiceBooking).
    const priced = await priceServiceBooking(specifications, serviceType);
    if (priced.error) {
      return res.status(400).json({ success: false, code: 'SERVICE_UNAVAILABLE', message: priced.error });
    }

    const sanitizedPhone = String(contactPhone || req.user.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
    if (sanitizedPhone && sanitizedPhone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number so the partner can call you.' });
    }

    // Store the quantity the server actually priced (not whatever the client sent).
    const specs = specifications && typeof specifications === 'object' && !Array.isArray(specifications) ? { ...specifications } : {};
    delete specs.clientRequestId; // kept in the idempotencyKey column instead
    delete specs.document; // only ever set below, from a validated upload
    delete specs.documentName;
    if (priced.quantity) specs.quantity = priced.quantity;
    if (specs.unit !== undefined && !['kg', 'pcs'].includes(specs.unit)) delete specs.unit;
    if (priced.item) specs.serviceName = priced.item.name;
    if (specs.details !== undefined) {
      const details = cleanBookingDetails(specs.details);
      if (details.length) specs.details = details; else delete specs.details;
    }
    if (specs.formId !== undefined) {
      const formId = cleanText(specs.formId, 40).replace(/[^A-Za-z0-9_.-]/g, '');
      if (formId) specs.formId = formId; else delete specs.formId;
    }
    const block = cleanText(hostelBlock, 100) || cleanText(req.user.hostelBlock, 100);
    const room = cleanText(roomNumber, 30) || cleanText(req.user.roomNumber, 30);

    const initialTracking = [
      {
        stage: 'REQUESTED',
        timestamp: new Date().toISOString(),
        note: `Service request received for ${title}. Partner assignment in progress.`,
      }
    ];

    const finalAmt = priced.amount || 0;

    // Photos go to the media table; the booking keeps only the short URL.
    let cleanAttachment = null;
    if (attachmentUrl) {
      const { storeImageRef } = require('../utils/imageStore');
      const img = await storeImageRef(attachmentUrl, { req, ownerId: req.user.id, purpose: 'service' });
      if (!img.ok) return res.status(img.status || 400).json({ success: false, code: img.code, message: img.message });
      cleanAttachment = img.value;
    }

    // A PDF for a print job (utils/serviceDocuments): private, served only by GET /:id/document.
    const rawDocument = (req.body || {}).attachmentDocument;
    if (rawDocument) {
      if (String(specs.category || '').toLowerCase() !== 'print') {
        return res.status(400).json({ success: false, code: 'BAD_DOCUMENT', message: 'PDF files can be attached to print bookings only.' });
      }
      const { storeServiceDocument } = require('../utils/serviceDocuments');
      const doc = await storeServiceDocument(rawDocument, { ownerId: req.user.id });
      if (!doc.ok) return res.status(doc.status || 400).json({ success: false, code: doc.code, message: doc.message });
      if (doc.value) {
        specs.document = doc.value;
        specs.documentName = doc.value.name; // plain field, so the admin dashboard lists it
      }
    }

    let booking;
    try {
      booking = await ServiceBooking.create({
      userId: req.user.id,
      idempotencyKey: bookingKey || null,
      serviceType,
      title: cleanText(title, 200) || title,
      description: typeof description === 'string' ? description.replace(/[<>]/g, '') : description,
      specifications: specs,
      attachmentUrl: cleanAttachment,
      status: 'REQUESTED',
      quotedAmount: finalAmt,
      finalAmount: finalAmt,
      paymentStatus: 'Pending',
      paymentMethod: 'COD', // services are paid in cash when the job is done

      pickupSlot: cleanText(pickupSlot, 100) || 'Immediate / 30 Mins',
      hostelBlock: block,
      roomNumber: room,
      deliveryAddress: cleanText(deliveryAddress, 300) || [block, room ? `Room ${room}` : ''].filter(Boolean).join(', '),
      contactPhone: sanitizedPhone,
      trackingHistory: initialTracking,
      });
    } catch (createErr) {
      // Same key raced in from another process: the unique index kept one row, return it.
      if (bookingKey && createErr && createErr.name === 'SequelizeUniqueConstraintError') {
        const winner = await ServiceBooking.findOne({ where: { userId: req.user.id, idempotencyKey: bookingKey } });
        if (winner) return replayBooking(winner);
      }
      throw createErr;
    }

    // If socket.io is available, broadcast new service notification to admins/partners
    if (req.app.get('io')) {
      const io = req.app.get('io');
      // Admins only: the payload includes the customer's room.
      io.to('admin-room').emit('newServiceBooking', {
        id: booking.id,
        serviceType: booking.serviceType,
        title: booking.title,
        hostelBlock: booking.hostelBlock,
        roomNumber: booking.roomNumber,
      });
    }
    require('../utils/realtime').notifyAdmin('service_booking', 'created', booking.id);

    const body = {
      success: true,
      message: 'Service booked successfully! Our executive will connect with you.',
      booking: booking.toJSON(),
    };
    await slot.finish(200, body); // a repeat is answered 200 + duplicate:true
    return res.status(201).json(body);
  } catch (error) {
    console.error('Error creating service booking:', error);
    return res.status(500).json({ success: false, message: 'We could not book this service right now. Please try again.' });
  } finally {
    await slot.release(); // no-op after finish(); frees the key after a refusal so a retry can run
  }
});

// Get all service bookings for the authenticated user
router.get('/my-bookings', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    if (!ServiceBooking) {
      return res.status(500).json({ success: false, message: 'ServiceBooking model not initialized' });
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const bookings = await ServiceBooking.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit,
    });

    return res.json({ success: true, count: bookings.length, bookings });
  } catch (error) {
    console.error('Error fetching user service bookings:', error);
    return res.status(500).json({ success: false, message: 'We could not load your bookings right now. Please try again.' });
  }
});

// Get a single booking by ID
router.get('/:id', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    const booking = await ServiceBooking.findByPk(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (!canViewBooking(booking, req.user)) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    return res.json({ success: true, booking });
  } catch (error) {
    console.error('Error fetching service booking:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// The PDF attached to a print booking, as a download: the student, the assigned partner or an admin.
router.get('/:id/document', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    const booking = await ServiceBooking.findByPk(req.params.id);
    if (!booking || !canViewBooking(booking, req.user)) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    let specs = booking.specifications;
    if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
    return await require('../utils/serviceDocuments').sendServiceDocument(res, booking, (specs || {}).document);
  } catch (error) {
    console.error('Error sending service booking document:', error);
    return res.status(500).json({ success: false, message: 'Could not load the file right now. Please try again.' });
  }
});

// Update quotation or diagnostic confirmation by user
router.post('/:id/confirm-quote', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    let booking = await ServiceBooking.findByPk(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // A quote can only be answered while the booking is still waiting on the student.
    if (!['REQUESTED', 'DIAGNOSED_QUOTED'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: booking.status === 'CANCELLED' ? 'This booking was cancelled.' : 'This quote was already answered.',
        booking,
      });
    }

    const { acceptQuote } = req.body || {};
    // The student approves the price they saw: optional body.quotedAmount must match, and the
    // write below also requires the stored quote to be the one we just read.
    const seenQuote = (req.body || {}).quotedAmount;
    if (acceptQuote && seenQuote !== undefined && seenQuote !== null && Math.abs(Number(seenQuote) - Number(booking.quotedAmount)) > 0.009) {
      return res.status(409).json({ success: false, code: 'QUOTE_CHANGED', message: 'The quote changed. Please check the new amount and approve again.', booking });
    }
    const history = Array.isArray(booking.trackingHistory) ? [...booking.trackingHistory] : [];
    let nextStatus;

    if (acceptQuote) {
      nextStatus = 'CONFIRMED';
      history.push({
        stage: 'CONFIRMED',
        timestamp: new Date().toISOString(),
        note: `Student accepted estimated quotation of ₹${booking.quotedAmount}. Repair/Service scheduled.`,
      });
    } else {
      nextStatus = 'CANCELLED';
      history.push({
        stage: 'CANCELLED',
        timestamp: new Date().toISOString(),
        note: 'Student declined quotation. Device returned/Booking closed.',
      });
    }

    const saved = await saveIfUnchanged(ServiceBooking, booking, { status: nextStatus, trackingHistory: history }, { quotedAmount: booking.quotedAmount });
    if (!saved) return staleBooking(res);
    booking = saved;

    if (req.app.get('io')) {
      req.app.get('io').to('admin-room').emit(acceptQuote ? 'serviceQuoteAccepted' : 'serviceCancelled', { id: booking.id, serviceType: booking.serviceType });
    }
    require('../utils/realtime').notifyAdmin('service_booking', acceptQuote ? 'updated' : 'cancelled', booking.id);

    return res.json({ success: true, message: acceptQuote ? 'Quotation approved' : 'Booking cancelled', booking });
  } catch (error) {
    console.error('Error confirming quote:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update booking status (Admin / Partner / Driver)
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    let booking = await ServiceBooking.findByPk(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Only an admin or the partner assigned to this booking may change its status or price.
    const isAdmin = isAdminUser(req.user);
    const isAssignedPartner = !!(booking.assignedPartnerId && booking.assignedPartnerId === req.user.id);
    if (!isAdmin && !isAssignedPartner) {
      return res.status(403).json({ success: false, message: 'Only the Zenvy team or the assigned partner can update this booking.' });
    }

    const { status, quotedAmount, finalAmount, driverDetails, assignedPartnerId } = req.body || {};
    const note = cleanText((req.body || {}).note, 300);
    const badAmount = (v) => v !== undefined && v !== null && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100000);
    if (badAmount(quotedAmount) || badAmount(finalAmount)) {
      return res.status(400).json({ success: false, message: 'Amounts must be between ₹0 and ₹100000.' });
    }

    if (status && !BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${BOOKING_STATUSES.join(', ')}` });
    }

    const current = booking.status;
    if (['COMPLETED', 'CANCELLED'].includes(current)) {
      // B27: Zenvy support may still correct the final amount or add a note on a closed booking
      // (refund / settlement follow-ups). Nobody can reopen it or change anything else.
      const statusChange = status && status !== current;
      const otherFields = quotedAmount != null || driverDetails != null || assignedPartnerId != null;
      if (isAdmin && !statusChange && !otherFields && (finalAmount != null || note)) {
        const closedChanges = {};
        if (finalAmount != null) closedChanges.finalAmount = Number(finalAmount);
        const history = Array.isArray(booking.trackingHistory) ? [...booking.trackingHistory] : [];
        history.push({ stage: current, timestamp: new Date().toISOString(), note: note || `Final amount corrected to Rs ${closedChanges.finalAmount}` });
        closedChanges.trackingHistory = history;
        const saved = await saveIfUnchanged(ServiceBooking, booking, closedChanges);
        if (!saved) return staleBooking(res);
        require('../utils/realtime').notifyAdmin('service_booking', 'updated', saved.id);
        return res.json({ success: true, message: 'Booking updated successfully', booking: saved });
      }
      return res.status(400).json({ success: false, code: 'BOOKING_CLOSED', message: `This booking is already ${current.toLowerCase()} and cannot be changed.` });
    }
    let nextStatus = status && status !== current ? status : current;
    if (nextStatus !== current && !(BOOKING_TRANSITIONS[current] || []).includes(nextStatus)) {
      return res.status(400).json({ success: false, code: 'BAD_TRANSITION', message: `A booking that is ${current} cannot move to ${nextStatus}.` });
    }

    const changes = {};
    if (quotedAmount !== undefined && quotedAmount !== null) {
      changes.quotedAmount = Number(quotedAmount);
      // A new quote replaces the booking-time estimate, unless a final amount is set in the same update.
      if (finalAmount === undefined || finalAmount === null) changes.finalAmount = Number(quotedAmount);
    }
    if (finalAmount !== undefined && finalAmount !== null) changes.finalAmount = Number(finalAmount);
    // After the student approved a price, any increase needs their approval again.
    const raises = (changes.quotedAmount !== undefined && changes.quotedAmount > Number(booking.quotedAmount || 0) + 0.009)
      || (changes.finalAmount !== undefined && changes.finalAmount > Number(booking.finalAmount || 0) + 0.009);
    let needsReapproval = false;
    // B21: also when this same update moves the booking INTO an approved state (REQUESTED ->
    // CONFIRMED / IN_PROGRESS / READY with a higher price), which used to skip the student's approval.
    if (raises && (PRICE_LOCKED_AFTER_APPROVAL.includes(current) || PRICE_LOCKED_AFTER_APPROVAL.includes(nextStatus))) {
      if (current === 'READY_FOR_DELIVERY') {
        return res.status(400).json({ success: false, code: 'PRICE_LOCKED', message: 'The price cannot be raised after the job is ready. Contact Zenvy support.' });
      }
      nextStatus = 'DIAGNOSED_QUOTED';
      needsReapproval = true;
      if (changes.quotedAmount === undefined) changes.quotedAmount = changes.finalAmount;
    }
    if (nextStatus !== current) changes.status = nextStatus;
    // S1: bounded shape (was any object stored as-is): known string fields only, each length-capped.
    if (driverDetails && typeof driverDetails === 'object' && !Array.isArray(driverDetails)) {
      const dd = cleanDriverDetails(driverDetails);
      if (Object.keys(dd).length) changes.driverDetails = dd;
    }
    if (assignedPartnerId && isAdmin) {
      if (!UUID_RE.test(String(assignedPartnerId))) return res.status(400).json({ success: false, message: 'assignedPartnerId is not valid.' });
      changes.assignedPartnerId = assignedPartnerId;
    }

    if (status || note || needsReapproval) {
      const history = Array.isArray(booking.trackingHistory) ? [...booking.trackingHistory] : [];
      history.push({
        stage: nextStatus,
        timestamp: new Date().toISOString(),
        note: needsReapproval
          ? `New price Rs ${changes.quotedAmount} needs the student's approval.${note ? ` ${note}` : ''}`
          : (note || `Status updated to ${nextStatus}`),
      });
      changes.trackingHistory = history;
    }

    if (Object.keys(changes).length) {
      const saved = await saveIfUnchanged(ServiceBooking, booking, changes);
      if (!saved) return staleBooking(res);
      booking = saved;
    }

    // Socket notification
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`user_${booking.userId}`).emit('serviceStatusUpdate', {
        id: booking.id,
        status: booking.status,
        quotedAmount: booking.quotedAmount,
        finalAmount: booking.finalAmount,
        note: note || `Status updated to ${booking.status}`,
      });
    }

    return res.json({ success: true, message: 'Booking updated successfully', booking });
  } catch (error) {
    console.error('Error updating service booking:', error);
    return res.status(500).json({ success: false, message: 'Could not update the booking right now. Please try again.' });
  }
});

// Cancel a booking (by the user)
router.post('/:id/cancel', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    let booking = await ServiceBooking.findByPk(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const NON_CANCELLABLE = ['COMPLETED', 'DELIVERED', 'CANCELLED'];
    if (NON_CANCELLABLE.includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: booking.status === 'CANCELLED' ? 'This booking is already cancelled.' : 'This booking is already completed, so it can no longer be cancelled.',
        booking,
      });
    }
    // Once picked up, the partner has the student's things (clothes, laptop…): support handles it.
    if (['IN_PROGRESS', 'READY_FOR_DELIVERY'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_PICKED_UP',
        message: 'The partner already has your items, so this booking can no longer be cancelled in the app. Please contact support.',
        booking,
      });
    }

    const history = Array.isArray(booking.trackingHistory) ? [...booking.trackingHistory] : [];
    history.push({
      stage: 'CANCELLED',
      timestamp: new Date().toISOString(),
      note: (typeof (req.body || {}).reason === 'string' && req.body.reason.trim()) ? req.body.reason.replace(/[<>]/g, '').trim().slice(0, 250) : 'Cancelled by user',
    });

    const saved = await saveIfUnchanged(ServiceBooking, booking, { status: 'CANCELLED', trackingHistory: history });
    if (!saved) return staleBooking(res);
    booking = saved;

    // Notify partner/admin via socket
    if (req.app.get('io')) {
      // Admins (and the assigned partner) only — not a broadcast to every connected socket.
      const io = req.app.get('io');
      io.to('admin-room').emit('serviceCancelled', { id: booking.id, serviceType: booking.serviceType });
      if (booking.assignedPartnerId) io.to(`rider_${booking.assignedPartnerId}`).emit('serviceCancelled', { id: booking.id, serviceType: booking.serviceType });
    }
    require('../utils/realtime').notifyAdmin('service_booking', 'cancelled', booking.id);

    return res.json({ success: true, message: 'Booking cancelled successfully', booking });
  } catch (error) {
    console.error('Error cancelling service booking:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Rate a completed booking
router.post('/:id/rate', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    const booking = await ServiceBooking.findByPk(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!['COMPLETED', 'DELIVERED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Can only rate completed bookings' });
    }

    const rating = Number((req.body || {}).rating);
    const review = typeof (req.body || {}).review === 'string' ? req.body.review.replace(/[<>]/g, '').trim().substring(0, 500) : '';
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Please pick a rating from 1 to 5 stars.' });
    }
    if ((booking.specifications || {}).userRating) {
      return res.status(409).json({ success: false, code: 'ALREADY_RATED', message: 'You have already rated this booking. Thank you!' });
    }

    // Store rating in specifications JSON (a NEW object: mutating the stored one in place is
    // not detected as a change on Postgres, so the rating would silently never save).
    booking.specifications = {
      ...(booking.specifications || {}),
      userRating: rating,
      userReview: review,
      ratedAt: new Date().toISOString(),
    };

    const history = Array.isArray(booking.trackingHistory) ? [...booking.trackingHistory] : [];
    history.push({
      stage: 'RATED',
      timestamp: new Date().toISOString(),
      note: `User rated ${rating}/5 stars. ${review ? `Review: ${review}` : ''}`,
    });
    booking.trackingHistory = history;
    await booking.save();

    return res.json({ success: true, message: 'Thank you for your feedback!', booking });
  } catch (error) {
    console.error('Error rating service booking:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Get service stats for the dashboard
router.get('/stats/overview', protect, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    if (!ServiceBooking) {
      return res.status(500).json({ success: false, message: 'ServiceBooking model not initialized' });
    }

    const { Op } = require('sequelize');
    const userId = req.user.id;

    const totalBookings = await ServiceBooking.count({ where: { userId } });
    const activeBookings = await ServiceBooking.count({
      where: { userId, status: { [Op.notIn]: ['COMPLETED', 'DELIVERED', 'CANCELLED'] } },
    });
    const completedBookings = await ServiceBooking.count({
      where: { userId, status: { [Op.in]: ['COMPLETED', 'DELIVERED'] } },
    });

    return res.json({
      success: true,
      stats: {
        total: totalBookings,
        active: activeBookings,
        completed: completedBookings,
      },
    });
  } catch (error) {
    console.error('Error fetching service stats:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Admin: Get all service bookings with optional filtering
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const ServiceBooking = getServiceBookingModel();
    if (!ServiceBooking) {
      return res.status(500).json({ success: false, message: 'ServiceBooking model not initialized' });
    }

    const { status, serviceType, hostelBlock } = req.query;
    // Unknown filter values answer 400 instead of a database error on Postgres enums (B27).
    if (status && !BOOKING_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${BOOKING_STATUSES.join(', ')}` });
    if (serviceType && !VALID_SERVICE_TYPES.includes(serviceType)) return res.status(400).json({ success: false, message: 'Unknown serviceType.' });
    const where = {};
    if (status) where.status = status;
    if (serviceType) where.serviceType = serviceType;
    if (hostelBlock) where.hostelBlock = String(hostelBlock).slice(0, 60);

    const bookings = await ServiceBooking.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 100,
    });

    return res.json({ success: true, count: bookings.length, bookings });
  } catch (error) {
    console.error('Error fetching admin service bookings:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
