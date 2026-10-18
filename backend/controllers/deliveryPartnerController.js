const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');
const { getRestaurantModel } = require('../models/Restaurant');
const { sendPushToTokens } = require('../utils/push');
const { creditCustomerForDelivery } = require('../services/BadgeService');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sendWhatsAppMessage } = require('../utils/whatsappUtil');

const { normalizePhone } = require('../utils/phoneUtils');
const realtime = require('../utils/realtime');
const riderCash = require('../utils/riderCash');
const { Transaction } = require('sequelize');

// ── Constants ────────────────────────────────────────────────────────────
const MAX_PIN_ATTEMPTS = 5; // wrong delivery PINs before the handover is locked for support
const MAX_ACTIVE_ORDERS = Math.max(1, parseInt(process.env.RIDER_MAX_ACTIVE_ORDERS, 10) || 3); // orders one rider may hold

// What the rider earns for an order (shared with the admin/support "mark delivered" path).
const { riderPayout, pushNearestRiders, refreshRiderCurrentOrder } = require('../utils/riderDispatch');
const { sumEarningsPaise } = require('../utils/riderEarnings');

const normalizeItems = (items) => {
  if (typeof items === 'string') {
    try {
      return JSON.parse(items);
    } catch {
      return [];
    }
  }
  return Array.isArray(items) ? items : [];
};

// ── Rider order payload (pending / active / accept) ──────────────────────────
// Real values only: anything we do not know is null (the rider app hides it), never a placeholder.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
// Start of the current IST day as a UTC Date (Render runs in UTC; "today" for riders is IST).
const istStartOfDay = (now = new Date()) => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
};
const istDayKey = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const deliveredAtOf = (order) => order.deliveredAt || order.updatedAt;

const parseInstructions = (raw) => {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = [v]; } }
  if (!Array.isArray(v)) return null;
  const list = v.map(s => String(s || '').trim()).filter(Boolean);
  return list.length ? list : null;
};

const dropText = (order, customer) => {
  if (order.deliveryAddress) return order.deliveryAddress;
  if (customer?.hostelBlock) return `${customer.hostelBlock} (${order.hostelGateDelivery ? 'Gate' : 'Room'})`;
  return null;
};

const paymentFields = (order) => {
  const method = order.paymentMethod || null;
  const finalPrice = Number(order.finalPrice);
  return {
    paymentMethod: method,
    paymentStatus: order.paymentStatus || null,
    amountToCollect: method === 'COD' && order.paymentStatus !== 'Completed' && Number.isFinite(finalPrice) ? finalPrice : 0,
  };
};

// Pool-safe area for an unclaimed order: campus / hostel block / locality only, never a room, flat or
// house number (the pool is visible to every online rider). Null when nothing safe can be derived.
const CAMPUS_AREA_LABELS = [
  [/\bsrm\b/i, 'SRM AP'], [/\bvit\b/i, 'VIT AP'], [/\bamrita\b/i, 'Amrita'], [/\bkl\s*(university|uni)?\b|\bklu\b/i, 'KL University'],
];
const UNSAFE_AREA_PART = /\d|\b(room|rm|flat|door|house|h\.?\s*no|plot|floor|apt|apartment|wing|bed|near|opp|behind|landmark|phone|ph|mob)\b/i;
const cleanAreaPart = (p) => String(p || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
const dropAreaText = (order, customer) => {
  const address = String(order.deliveryAddress || '');
  const parts = address.split(/\s+[-–|]\s+|,|\n|·/).map(cleanAreaPart).filter(Boolean);
  let campus = null;
  for (const [re, label] of CAMPUS_AREA_LABELS) { if (re.test(address)) { campus = label; break; } }
  // Hostel block name (e.g. "Block B", "Vedavathi Hostel") from the address, else the customer's profile.
  const blockRe = /\b(block\s*[a-z0-9]{1,3}|[a-z]+\s+(hostel|block|bhavan|hall))\b/i;
  let block = null;
  for (const p of parts) { const m = p.match(blockRe); if (m) { block = cleanAreaPart(m[0]); break; } }
  if (!block && customer?.hostelBlock) {
    const m = String(customer.hostelBlock).match(blockRe);
    block = m ? cleanAreaPart(m[0]) : (UNSAFE_AREA_PART.test(customer.hostelBlock) ? null : cleanAreaPart(customer.hostelBlock));
  }
  if (block) block = block.replace(/\bblock\s*([a-z0-9]{1,3})\b/i, (_, b) => `Block ${b.toUpperCase()}`);
  if (campus || block) return [campus, block].filter(Boolean).join(' · ').slice(0, 60);
  // Off-campus: the locality is the last address parts without numbers (area, town), never the first (door / street).
  const safe = parts.slice(1).filter((p) => !UNSAFE_AREA_PART.test(p) && p.length <= 40);
  return safe.length ? safe.slice(-2).join(', ').slice(0, 60) : null;
};

const finiteOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const dropCoordsOf = (order) => {
  const lat = finiteOrNull(order.dropLat);
  const lng = finiteOrNull(order.dropLng);
  return lat !== null && lng !== null && !(lat === 0 && lng === 0) ? { lat, lng } : null;
};

// revealCustomer=false → pool card (every online rider): first name, no phone, drop=null + dropArea, no dropCoords.
// revealCustomer=true  → the assigned rider (accept / active): full drop, dropArea and dropCoords.
const riderOrderPayload = (order, restaurant, customer, { revealCustomer }) => {
  const restLat = restaurant ? Number(restaurant.lat) : NaN;
  const restLon = restaurant ? Number(restaurant.lon) : NaN;
  const distance = Number(order.distance);
  return {
    id: order.id,
    restaurant: restaurant?.name || null,
    restaurantAddress: restaurant?.location || null,
    restaurantPhone: restaurant?.whatsappNumber || null,
    pickupCoords: restaurant && restaurant.lat != null && restaurant.lon != null && Number.isFinite(restLat) && Number.isFinite(restLon)
      ? { lat: restLat, lng: restLon } : null,
    customerName: customer?.name ? (revealCustomer ? String(customer.name).trim() : String(customer.name).trim().split(/\s+/)[0]) : null,
    // Unclaimed orders are visible to every online rider: the phone is shared only after a rider claims it.
    customerPhone: revealCustomer ? (customer?.phone || null) : null,
    drop: revealCustomer ? dropText(order, customer) : null,
    dropArea: dropAreaText(order, customer),
    ...(revealCustomer ? { dropCoords: dropCoordsOf(order) } : {}),
    deliveryInstructions: parseInstructions(order.deliveryInstructions),
    items: normalizeItems(order.items),
    totalPrice: order.totalPrice,
    finalPrice: order.finalPrice,
    ...paymentFields(order),
    riderEarning: riderPayout(order),
    earnings: `₹${riderPayout(order)}`,
    distance: Number.isFinite(distance) && distance > 0 ? distance : null,
    status: order.status,
    createdAt: order.createdAt,
    deliverySlot: order.deliverySlot || null,
    // Rider-purchase store (offline, or no partner login): the rider buys the items at the counter.
    buyAtStore: require('../utils/riderPurchase').isRiderPurchaseStore(restaurant, 'riderOrderPayload'),
    // When the kitchen marked the food ready (B28): the rider app shows a "Ready" chip.
    readyAt: order.readyAt || null,
  };
};

// Restaurant columns riderOrderPayload reads (incl. the rider-purchase judgement).
const RIDER_REST_ATTRS = ['id', 'name', 'location', 'whatsappNumber', 'lat', 'lon', 'isOffline', 'password'];

const notApproved = (res) => res.status(403).json({
  code: 'RIDER_NOT_APPROVED',
  message: 'Your account is pending verification by the logistics admin.'
});
const serverError = (res, tag, error) => {
  console.error(tag, error);
  if (!res.headersSent) res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
};

// `tv` = tokenVersion: a password change bumps it and protect() rejects older sessions.
const generateToken = (id, tokenVersion = 0) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[AUTH_FATAL] JWT_SECRET is not configured.');
    return null; // The calling logic should handle this gracefully
  }
  return jwt.sign({ id, role: 'rider', tv: Number(tokenVersion) || 0 }, secret, { expiresIn: '30d' });
};

// @desc    Register a new delivery partner.
//          Admin (dashboard Fleet page): created approved.
//          Self sign-up: must prove the phone (firebaseToken or SMS otp) and waits for admin approval.
const registerPartner = async (req, res) => {
  const { name, phone, password, vehicleType, firebaseToken, otp } = req.body;

  try {
    const cleanPhone = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    }

    // Check if request is made by a live Admin (DB role, not the token claim). Also avoids
    // overwriting their session cookie.
    const skipCookie = await require('../middleware/authMiddleware').isLiveAdminRequest(req);
    const isAdminRequest = skipCookie;

    // Validate before the phone proof so a bad form never burns the customer's OTP (and never 500s).
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({ message: 'Enter your full name.' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const DeliveryPartner = getDeliveryPartnerModel();
    const partnerExists = await DeliveryPartner.findOne({ where: { phone: cleanPhone } });
    if (partnerExists) return res.status(400).json({ message: 'Partner already exists' });

    if (!isAdminRequest) {
      const { verifyPhoneProof } = require('./userController');
      const proof = await verifyPhoneProof({ phone: cleanPhone, firebaseToken, otp, purpose: 'auth' });
      if (!proof.ok) return res.status(proof.status).json(proof.body);
    }

    // ── Create partner ───────────────────────────────────────────────────
    // C4: a self sign-up that sends { acceptTerms: true, termsVersion } is recorded (admin-created riders are not).
    const consent = isAdminRequest ? {} : await require('../utils/legalSettings').consentFromBody(req.body);
    const partner = await DeliveryPartner.create({
      name: cleanName,
      phone: cleanPhone,
      password,
      vehicleType,
      isApproved: isAdminRequest,
      ...consent
    });
    const token = generateToken(partner.id, partner.tokenVersion);

    if (!skipCookie) {
      res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });
    }
    res.status(201).json({ _id: partner.id, name: partner.name, isApproved: partner.isApproved, token });
  } catch (error) {
    console.error('[PARTNER_REGISTER_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// @desc    Auth partner & get token
const authPartner = async (req, res) => {
  const rawInput = req.body.phone || req.body.email || '';
  const { password } = req.body;

  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const cleanPhone = normalizePhone(rawInput);

    const partner = await DeliveryPartner.findOne({ where: { phone: cleanPhone } });
    if (!partner) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    const isMatch = await partner.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    // Deactivated by Zenvy (C1-7: an approved rider the admin switched off). New sign-ups waiting for
    // approval (never approved, no suspendedAt) still log in and see "waiting for approval".
    if (partner.suspendedAt && partner.isApproved !== true) {
      return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'Your Zenvy rider account has been deactivated. Please contact Zenvy support.' });
    }

    // ── 3. Return partner data and JWT token ────────────────────────────────
    const token = generateToken(partner.id, partner.tokenVersion);
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });

    // ── Streak Computation (IST) ───────────────────────────────────────
    const nowUtc = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const todayIST = new Date(nowUtc.getTime() + istOffset).toISOString().slice(0, 10);
    const lastLogin = partner.lastLoginDate ? String(partner.lastLoginDate) : null;

    if (lastLogin !== todayIST) {
      const yesterdayIST = new Date(nowUtc.getTime() + istOffset - 86400000).toISOString().slice(0, 10);
      if (lastLogin === yesterdayIST) {
        partner.loginStreak = (partner.loginStreak || 0) + 1;
      } else if (lastLogin === null || lastLogin < yesterdayIST) {
        partner.loginStreak = 1; // reset — missed a day
      }
      partner.lastLoginDate = todayIST;
      await partner.save();
    }
    // ─────────────────────────────────────────────────────────────────

    res.json({ 
      _id: partner.id, 
      name: partner.name, 
      phone: partner.phone,
      vehicleType: partner.vehicleType,
      vehicleNumber: partner.vehicleNumber,
      emergencyContact: partner.emergencyContact,
      isApproved: partner.isApproved,
      isAvailable: partner.isAvailable,
      walletBalance: partner.walletBalance,
      zenPoints: partner.zenPoints || 0,
      // Live count (the completedDeliveries column is never updated; it always read 0).
      completedDeliveries: await getOrderModel().count({ where: { deliveryPartnerId: partner.id, status: 'Delivered' } }).catch(() => null),
      rating: partner.averageRating ?? null, // null = no ratings yet
      averageRating: partner.averageRating ?? null,
      loginStreak: partner.loginStreak || 0,
      token
    });
  } catch (error) {
    serverError(res, '[PARTNER_AUTH_ERROR]', error);
  }
};

// @desc    Accept an order
// CampusBites stall orders (fulfilment 'VENDOR') are delivered by the stall: never in the rider pool,
// never claimable. Old rows have fulfilment NULL (= Zenvy rider delivery).
const NOT_STALL_ORDER = { [Op.and]: [{ [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] }] };

// One claim at a time per rider (in this process): the active-order count and the claim then
// cannot interleave, so a burst of taps on several cards never takes more than the limit.
// Across processes (Postgres, A2) the count + claim run in one transaction that first locks the
// rider's row FOR UPDATE (claimForRider below); the re-count after the claim stays as a last guard.
const riderClaimChains = new Map();
const withRiderClaimLock = (riderId, fn) => {
  const prev = riderClaimChains.get(riderId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  riderClaimChains.set(riderId, tail);
  tail.then(() => { if (riderClaimChains.get(riderId) === tail) riderClaimChains.delete(riderId); });
  return run;
};

const acceptOrder = (req, res) => withRiderClaimLock(String(req.user.id), () => acceptOrderLocked(req, res));

const CLAIMABLE_STATUSES = ['Accepted', 'Preparing', 'ReadyForPickup'];

/**
 * Count the rider's other active orders and, when under the limit, claim the order (conditional
 * UPDATE). Resolves { activeCount, updatedRows } (updatedRows 0 when the limit was reached, i.e.
 * activeCount >= MAX_ACTIVE_ORDERS, or the order was not claimable).
 * opts.transaction: run both statements in it (after the caller locked the rider row).
 */
const claimForRider = async (riderId, orderId, opts = {}) => {
  const Order = getOrderModel();
  const tx = opts.transaction ? { transaction: opts.transaction } : {};
  // One rider must not hoard the pool: at most RIDER_MAX_ACTIVE_ORDERS (default 3) at a time.
  // (This order itself is not counted, so a retried claim of it still gets its 200 below.)
  const activeCount = await Order.count({
    where: {
      deliveryPartnerId: riderId,
      id: { [Op.ne]: orderId },
      status: { [Op.notIn]: ['Delivered', 'Cancelled'] },
    },
    ...tx,
  });
  if (activeCount >= MAX_ACTIVE_ORDERS) return { activeCount, updatedRows: 0 };
  // C6: a rider holding cash >= RIDER_CASH_LIMIT may not take a NEW COD order (prepaid orders are fine).
  const cashBlocked = await riderCash.claimBlockedByCash({ sequelize: Order.sequelize, riderId, orderId, transaction: opts.transaction || null });
  if (cashBlocked) return { activeCount, updatedRows: 0, cashBlocked };
  // Atomic Claim: Only orders already accepted by restaurant/system can be claimed
  const [updatedRows] = await Order.update(
    { deliveryPartnerId: riderId },
    { where: { id: orderId, deliveryPartnerId: null, status: { [Op.in]: CLAIMABLE_STATUSES }, ...NOT_STALL_ORDER }, ...tx }
  );
  return { activeCount, updatedRows };
};

/**
 * Postgres: count + claim in one transaction holding the rider's row lock (SELECT ... FOR UPDATE),
 * so claims by the same rider on different processes run one after the other. Resolves null when
 * that transaction / lock failed (the caller then does exactly what a single process does).
 * SQLite: null at once (one process: the in-process chain above already serialises the claims).
 */
const claimForRiderLocked = async (riderId, orderId) => {
  const DeliveryPartner = getDeliveryPartnerModel();
  const db = DeliveryPartner && DeliveryPartner.sequelize;
  if (!db || db.getDialect() !== 'postgres') return null;
  try {
    return await db.transaction(async (t) => {
      await DeliveryPartner.findByPk(riderId, { attributes: ['id'], transaction: t, lock: t.LOCK.UPDATE });
      return claimForRider(riderId, orderId, { transaction: t });
    });
  } catch (err) {
    console.warn('[RIDER_CLAIM_LOCK_WARN] claiming without the rider row lock:', err.message);
    return null;
  }
};

const acceptOrderLocked = async (req, res) => {
  try {
    // A non-UUID id made PostgreSQL throw (500) in the count below; answer like any unclaimable order.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.orderId || ''))) {
      return res.status(400).json({ message: 'Order was already claimed by another rider or is not yet accepted by the merchant.' });
    }
    const DeliveryPartner = getDeliveryPartnerModel();
    const Order = getOrderModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) return notApproved(res);

    // Active-order limit + atomic claim (Postgres: under the rider row lock; fail open to the
    // unlocked statements, which is the single-process behaviour).
    const { activeCount, updatedRows, cashBlocked } = (await claimForRiderLocked(req.user.id, req.params.orderId))
      || (await claimForRider(req.user.id, req.params.orderId));
    if (cashBlocked) {
      // Same 409 family as MAX_ACTIVE: older rider apps show the message; newer ones also show the banner.
      return res.status(409).json(cashBlocked);
    }
    if (activeCount >= MAX_ACTIVE_ORDERS) {
      return res.status(409).json({
        code: 'MAX_ACTIVE',
        message: `You already have ${activeCount} active orders. Deliver one before taking another.`,
      });
    }

    if (updatedRows === 0) {
      // A retry of this rider's own claim (first request timed out on the phone but landed here):
      // hand back their order instead of "claimed by another rider".
      const current = await Order.findByPk(req.params.orderId);
      if (current && current.deliveryPartnerId === req.user.id && !['Cancelled', 'Delivered'].includes(current.status)) {
        const [restaurant, customer] = await Promise.all([
          getRestaurantModel().findByPk(current.restaurantId, { attributes: RIDER_REST_ATTRS }),
          getUserModel().findByPk(current.userId, { attributes: ['id', 'name', 'phone', 'hostelBlock'] }),
        ]);
        return res.json({
          ...riderOrderPayload(current, restaurant, customer, { revealCustomer: true }),
          hasDeliveryPin: !!current.deliveryPin,
          alreadyClaimed: true,
        });
      }
      return res.status(400).json({ message: 'Order was already claimed by another rider or is not yet accepted by the merchant.' });
    }

    // The count above and the claim are two statements: parallel claims by the same rider (several
    // taps on different cards) could each pass the check. Re-count now that this claim is in and
    // undo it if the rider went over the limit (only the claim fields are reverted, conditionally).
    const heldNow = await Order.count({
      where: { deliveryPartnerId: req.user.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
    });
    if (heldNow > MAX_ACTIVE_ORDERS) {
      await Order.update(
        { deliveryPartnerId: null },
        { where: { id: req.params.orderId, deliveryPartnerId: req.user.id, status: { [Op.in]: ['Accepted', 'Preparing', 'ReadyForPickup'] } } }
      );
      return res.status(409).json({
        code: 'MAX_ACTIVE',
        message: `You already have ${MAX_ACTIVE_ORDERS} active orders. Deliver one before taking another.`,
      });
    }

    // Since we successfully updated, we fetch the updated order object
    const updatedOrder = await Order.findByPk(req.params.orderId);
    realtime.deliveryRequestGone(updatedOrder.id); // other riders drop it from their pool at once
    
    // (Status advancement is strictly controlled by the Restaurant Portal until picked up)
    
    // Taking an order means the rider is on duty: a rider the presence job had marked offline (socket
    // dropped while the app stayed open) is put back online so dispatch and the admin map see them.
    await DeliveryPartner.update(
      { currentOrderId: updatedOrder.id, ...(partner.isOnline ? {} : { isOnline: true }) },
      { where: { id: partner.id } }
    );
    if (!partner.isOnline) realtime.setRiderOnline(partner.id, true);

    const io = req.app.get('io');
    if (io) {
      // Claiming does not change the order status: report the real one (it may already be Preparing/Ready).
      const claimPayload = { id: updatedOrder.id, status: updatedOrder.status, riderAssigned: true };
      io.to(updatedOrder.id.toString()).emit('statusUpdated', claimPayload);
      io.to('admin-room').emit('statusUpdated', claimPayload);
      if (updatedOrder.restaurantId) io.to(`restaurant_${updatedOrder.restaurantId}`).emit('statusUpdated', claimPayload);
      io.to('admin-room').emit('admin_order_accepted', { orderId: updatedOrder.id, riderName: partner?.name || 'Rider' });
    }

    try {
      const User = getUserModel();
      const Restaurant = getRestaurantModel();
      const customer = await User.findByPk(updatedOrder.userId);
      const restaurant = await Restaurant.findByPk(updatedOrder.restaurantId);

      res.json({
        ...riderOrderPayload(updatedOrder, restaurant, customer, { revealCustomer: true }),
        hasDeliveryPin: !!updatedOrder.deliveryPin,
      });

      const rawCustomerTokens = Array.isArray(customer?.fcmTokens) ? customer.fcmTokens : [];
      const customerTokenList = rawCustomerTokens.map(t => typeof t === 'string' ? t : t?.token).filter(Boolean);
      if (customer) {
        await sendPushToTokens(customerTokenList, 'Order Accepted! 🛵', 'Your Zenvy rider is on the way.', { orderId: updatedOrder.id, type: 'ORDER_UPDATE' }, { recipients: [customer.id] });
      }
    } catch (e) {
      console.error('[ACCEPT_ORDER_ERROR]', e);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
      }
    }
  } catch (error) {
    serverError(res, '[ACCEPT_ORDER_ERROR]', error);
  }
};

// @desc    Get all pending orders
const getPendingOrders = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) return notApproved(res);

    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();
    const orders = await Order.findAll({
      where: { 
        status: { [Op.in]: ['Accepted', 'Preparing', 'ReadyForPickup'] },
        deliveryPartnerId: null,
        ...NOT_STALL_ORDER
      }, 
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    const userIds = [...new Set(orders.map(o => o.userId))];
    const restIds = [...new Set(orders.map(o => o.restaurantId))];
    
    const [users, restaurants] = await Promise.all([
      // Only what the pool card needs (never password hashes or base64 profile photos).
      User.findAll({ where: { id: userIds }, attributes: ['id', 'name', 'hostelBlock', 'roomNumber', 'address'] }),
      Restaurant.findAll({ where: { id: restIds }, attributes: ['id', 'name', 'location', 'whatsappNumber', 'lat', 'lon', 'isOffline', 'password'] })
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

    // Pool cards: first name only and no phone until the rider claims the order.
    const enrichedOrders = orders.map(order => riderOrderPayload(order, restMap[order.restaurantId], userMap[order.userId], { revealCustomer: false }));

    res.json(enrichedOrders);
  } catch (error) {
    serverError(res, '[RIDER_PENDING_ERROR]', error);
  }
};

// @desc    Get order history
const getOrderHistory = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    // Paging (R-4): ?limit=<1..100>&before=<ISO deliveredAt> → { orders, hasMore }.
    // Without either param the response stays the bare array of the newest 100 (older app builds).
    const q = req.query || {};
    const paged = q.limit !== undefined || q.before !== undefined;
    let before = null;
    if (q.before !== undefined && q.before !== '') {
      before = new Date(String(q.before));
      if (Number.isNaN(before.getTime())) return res.status(400).json({ message: 'before must be an ISO date', code: 'BAD_BEFORE' });
    }
    const parsedLimit = parseInt(q.limit, 10);
    const pageSize = paged ? (Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50) : 100;
    // Delivered time = deliveredAt, or updatedAt for rows delivered before deliveredAt existed.
    const sequelize = Order.sequelize;
    const deliveredExpr = sequelize.fn('COALESCE', sequelize.col('deliveredAt'), sequelize.col('updatedAt'));
    const where = { deliveryPartnerId: req.user.id, status: 'Delivered' };
    if (before) {
      where[Op.or] = [
        { deliveredAt: { [Op.lt]: before } },
        { deliveredAt: null, updatedAt: { [Op.lt]: before } },
      ];
    }
    const rows = await Order.findAll({
      where,
      order: [[deliveredExpr, 'DESC'], ['id', 'DESC']],
      limit: pageSize + 1
    });
    const hasMore = rows.length > pageSize;
    const orders = hasMore ? rows.slice(0, pageSize) : rows;

    const restIds = [...new Set(orders.map(o => o.restaurantId))];
    const restaurants = await Restaurant.findAll({ where: { id: restIds } });
    const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

    const enrichedOrders = orders.map(order => {
      const restaurant = restMap[order.restaurantId];
      return {
        id: order.id,
        restaurant: restaurant?.name || null,
        restaurantAddress: restaurant?.location || null,
        drop: order.deliveryAddress || null,
        items: normalizeItems(order.items),
        totalPrice: order.totalPrice,
        finalPrice: order.finalPrice,
        paymentMethod: order.paymentMethod || null,
        paymentStatus: order.paymentStatus || null,
        riderEarning: riderPayout(order),
        earnings: `₹${riderPayout(order)}`,
        status: order.status,
        createdAt: order.createdAt,
        // Real handover time for orders delivered after deliveredAt was added; older rows fall back to updatedAt.
        deliveredAt: deliveredAtOf(order)
      };
    }).sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt));

    res.json(paged ? { orders: enrichedOrders, hasMore } : enrichedOrders);
  } catch (error) {
    serverError(res, '[RIDER_HISTORY_ERROR]', error);
  }
};

// @desc    Update order status
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Picking', 'PickedUp', 'ArrivedAtGate', 'Delivered'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });

    // Replay of a step that already happened (a request that timed out on the phone but landed here,
    // then re-sent from the offline queue): answer 200 with the order as it is, never a false error.
    const RIDER_STEP_RANK = { Picking: 1, PickedUp: 2, ArrivedAtGate: 3 };
    const afterResponse = []; // slow pushes, run once the rider has the answer
    if (status !== 'Delivered' && RIDER_STEP_RANK[order.status] && RIDER_STEP_RANK[order.status] >= RIDER_STEP_RANK[status]) {
      const { deliveryPin, deliveryPinAttempts, upiUTR, upiScreenshot, upiStatus, payoutSettled, riderPayoutSettled, commissionRate, commissionType, commissionAmountPaise, storeNetPaise, commissionSource, payoutId, riderPayoutId, ...safeOrder } = order.toJSON(); // eslint-disable-line no-unused-vars
      return res.json({ ...safeOrder, _id: order.id, riderEarning: riderPayout(order), alreadyApplied: true });
    }

    if (status === 'Picking' &&!['Pending', 'Accepted', 'Preparing', 'ReadyForPickup'].includes(order.status)) {
      return res.status(400).json({ message: 'Order must be Accepted or Ready by restaurant first' });
    }
    if (status === 'PickedUp' && !['Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'Picking'].includes(order.status)) {
      return res.status(400).json({ message: 'Order must be in Picking, Accepted, or Ready stage first' });
    }
    if (status === 'ArrivedAtGate' && !['PickedUp', 'ArrivedAtGate'].includes(order.status)) {
      return res.status(400).json({ message: 'Pick up the order before marking that you have arrived.' });
    }
    if (status === 'Delivered' && order.status === 'Delivered') {
      // Double tap / retry after a lost response: tell the app it is already done.
      return res.status(409).json({ code: 'ALREADY_DELIVERED', message: 'This order is already marked delivered.' });
    }
    if (status === 'Delivered' && !['PickedUp', 'ArrivedAtGate'].includes(order.status)) {
      return res.status(400).json({ message: order.status === 'Cancelled' ? 'This order was cancelled.' : 'Must be PickedUp or ArrivedAtGate first' });
    }

    // ── Delivery PIN Validation ──────────────────────
    if (status === 'Delivered') {
      const pin = String(req.body?.pin ?? '').trim();
      // Every order placed through the app has a PIN (only very old orders may not).
      if (order.deliveryPin && order.deliveryPin.length > 0) {
        // Claim one attempt atomically BEFORE comparing, so parallel requests cannot each see
        // "0 used" and try many PINs at once. A correct PIN gives the attempt back.
        const [claimed] = await Order.update(
          { deliveryPinAttempts: Order.sequelize.literal('COALESCE("deliveryPinAttempts", 0) + 1') },
          { where: { id: order.id, deliveryPinAttempts: { [Op.lt]: MAX_PIN_ATTEMPTS } } }
        );
        if (claimed === 0) {
          return res.status(429).json({
            code: 'PIN_LOCKED',
            message: 'Too many wrong PINs for this order. Please contact Zenvy support to complete the handover.'
          });
        }
        if (pin && pin === order.deliveryPin) {
          await Order.update(
            { deliveryPinAttempts: Order.sequelize.literal('CASE WHEN COALESCE("deliveryPinAttempts", 0) > 0 THEN "deliveryPinAttempts" - 1 ELSE 0 END') },
            { where: { id: order.id } }
          ).catch(() => {});
        } else {
          const fresh = await Order.findByPk(order.id, { attributes: ['id', 'deliveryPinAttempts'] });
          const used = Number(fresh?.deliveryPinAttempts) || MAX_PIN_ATTEMPTS;
          if (used >= MAX_PIN_ATTEMPTS) {
            const io = req.app.get('io');
            if (io) io.to('admin-room').emit('admin_issue_reported', {
              orderId: order.id, senderRole: 'System', senderId: req.user.id,
              issueType: 'Delivery PIN locked', details: `${MAX_PIN_ATTEMPTS} wrong delivery PIN attempts by the rider.`,
              timestamp: new Date()
            });
          }
          const left = Math.max(0, MAX_PIN_ATTEMPTS - used);
          return res.status(400).json({
            code: 'INVALID_PIN',
            attemptsLeft: left,
            message: left > 0
              ? `That PIN doesn't match. Ask the customer for the 4-digit PIN shown in their Zenvy app (${left} ${left === 1 ? 'try' : 'tries'} left).`
              : 'Too many wrong PINs for this order. Please contact Zenvy support to complete the handover.'
          });
        }
      }
    }

    if (status === 'Delivered') {
      // Exactly-once: only the request that flips the order to Delivered credits anyone
      // (a double tap or an offline-queue replay must not pay the rider twice).
      const { Op } = require('sequelize');
      // C6: the flip and the rider's COD cash row commit together (or not at all): exactly one
      // COD_COLLECTED row per order, even under a double tap / parallel requests (only the request that
      // flips the order writes it; the unique keys are the backstop).
      const flipped = await Order.sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
        const [n] = await Order.update(
          { status: 'Delivered', deliveredAt: new Date(), ...(order.paymentMethod === 'COD' ? { paymentStatus: 'Completed' } : {}) },
          { where: { id: order.id, deliveryPartnerId: req.user.id, status: { [Op.in]: ['PickedUp', 'ArrivedAtGate'] } }, transaction: t }
        );
        if (n === 1) await riderCash.recordCodDelivery({ t, orderId: order.id, actor: { type: 'rider', id: String(req.user.id) } });
        return n;
      });
      if (flipped === 0) {
        const now = await Order.findByPk(order.id, { attributes: ['status'] });
        if (now && now.status === 'Delivered') return res.status(409).json({ code: 'ALREADY_DELIVERED', message: 'This order is already marked delivered.' });
        return res.status(409).json({ code: 'ORDER_CHANGED', message: 'This order was just cancelled or updated. Please refresh.' });
      }
      order.status = 'Delivered';
    } else {
      // Conditional flip: never resurrect an order the customer cancelled (and was refunded for)
      // after we read it.
      const prev = { Picking: ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup'], PickedUp: ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'Picking'], ArrivedAtGate: ['PickedUp', 'ArrivedAtGate'] }[status];
      const [moved] = await Order.update({ status }, { where: { id: order.id, deliveryPartnerId: req.user.id, status: { [Op.in]: prev } } });
      if (moved === 0) return res.status(409).json({ message: 'This order was just cancelled or updated. Please refresh.' });
      order.status = status;
    }

    if (status === 'Delivered') {
      // Rider earns the order's delivery fee (₹30 for orders created before fees were stored).
      const earnings = riderPayout(order);
      const DeliveryPartner = getDeliveryPartnerModel();
      const User = getUserModel();
      await DeliveryPartner.increment({ totalEarnings: earnings, zenPoints: 5 }, { where: { id: req.user.id } });
      await refreshRiderCurrentOrder(req.user.id); // may still carry other orders
      // Atomic increments: a stale read-modify-save here used to overwrite concurrent spin/redeem points.
      let customer = null;
      try {
        const credit = await creditCustomerForDelivery(User, order);
        customer = credit.customer;
        order.newBadges = credit.newBadges;
      } catch (creditErr) {
        console.error('[DELIVERY_CREDIT_ERROR]', order.id, creditErr.message);
      }
      // Badge / milestone pushes go out AFTER the response (B28): the rider's "Delivered" tap
      // used to wait for FCM.
      if (customer) afterResponse.push(async () => {
        try {
          for (const badge of order.newBadges || []) {
            await sendPushToTokens(
              customer.fcmTokens,
              'New Achievement Unlocked! 🏆',
              `Congratulations! You've earned the "${badge}" badge.`,
              { type: 'BADGE' },
              { recipients: [customer.id] }
            );
          }
          // --- Milestone Notifications ---
          if (customer.completedOrders % 2 === 0) {
            await sendPushToTokens(
              customer.fcmTokens,
              'Milestone Reached! 🎡',
              `You just completed your ${customer.completedOrders}th order! A Lucky Spin is waiting for you in the Vault.`,
              { type: 'SPIN_EARNED' },
              { recipients: [customer.id] }
            );
          }
        } catch (pushErr) {
          console.warn('[DELIVERY_PUSH_WARN]', pushErr.message);
        }
      });
    }

    const io = req.app.get('io');
    if (io) {
      const payload = { 
        id: order.id,
        status: status,
        newBadges: status === 'Delivered' ? (order.newBadges || []) : [] 
      };
      io.to(order.id.toString()).emit('statusUpdated', payload);
      io.to('admin-room').emit('statusUpdated', payload);
      if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', payload);
      if (status === 'Delivered') {
        io.to('admin-room').emit('admin_delivery_complete', { orderId: order.id });
      }
    }
    {
      // Never hand the customer's delivery PIN to the rider.
      const { deliveryPin, deliveryPinAttempts, upiUTR, upiScreenshot, upiStatus, payoutSettled, riderPayoutSettled, commissionRate, commissionType, commissionAmountPaise, storeNetPaise, commissionSource, payoutId, riderPayoutId, ...safeOrder } = order.toJSON(); // eslint-disable-line no-unused-vars
      res.json({ ...safeOrder, _id: order.id, riderEarning: riderPayout(order) });
    }

    for (const job of afterResponse) await job();
    try {
      const User = getUserModel();
      const customer = await User.findByPk(order.userId);
      const rawTokens = Array.isArray(customer?.fcmTokens) ? customer.fcmTokens : [];
      const customerTokenList = rawTokens.map(t => typeof t === 'string' ? t : t?.token).filter(Boolean);
      if (customer) {
        const titles = {
          Picking: 'Rider Arrived at Store 🏪',
          PickedUp: 'Order Picked Up! 🛵',
          ArrivedAtGate: 'Rider Arrived at Gate 🚪',
          Delivered: 'Order Delivered! 🎉'
        };
        const bodies = {
          Picking: 'Your rider is at the store picking up your items.',
          PickedUp: 'Rider is on the way!',
          ArrivedAtGate: 'Rider is waiting at your gate.',
          Delivered: 'Enjoy your meal!'
        };
        if (titles[status]) {
          await sendPushToTokens(customerTokenList, titles[status], bodies[status], { orderId: order.id, type: 'ORDER_UPDATE' }, { recipients: [customer.id] });
        }
      }
    } catch (e) {
      console.warn('[PUSH_NOTIFY_WARN] Failed to send update:', e.message);
    }
  } catch (error) {
    serverError(res, '[DELIVERY_UPDATE_ERROR]', error);
  }
};

// @desc    Rider emergency-cancels an assigned order
const cancelOrderByRider = async (req, res) => {
  try {
    const Order = getOrderModel();

    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId !== req.user.id) return res.status(403).json({ message: 'Not your order' });
    const RELEASABLE = ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking'];
    if (!RELEASABLE.includes(order.status)) {
      return res.status(400).json({ message: 'Cannot cancel order after food has been picked up. Please contact support.' });
    }

    // Unassign rider so another rider can claim it. The kitchen's progress is kept: only the
    // rider-set 'Picking' step is undone (back to 'Preparing', which the store can still mark Ready).
    // Conditional so a customer cancel that landed after our read is never turned back into a live order.
    // A kitchen that already marked the food ready (readyAt) stays ReadyForPickup.
    const nextStatus = order.status === 'Picking' ? (order.readyAt ? 'ReadyForPickup' : 'Preparing') : order.status;
    const [released] = await Order.update(
      { deliveryPartnerId: null, status: nextStatus },
      { where: { id: order.id, deliveryPartnerId: req.user.id, status: order.status } }
    );
    if (released === 0) return res.status(409).json({ message: 'This order was just cancelled or updated. Please refresh.' });
    order.deliveryPartnerId = null;
    order.status = nextStatus;
    realtime.leaveOrderRoom(req.user.id, order.id); // no more status / chat / GPS for the old rider

    // The rider's current task is one of the orders they still carry (or none).
    await refreshRiderCurrentOrder(req.user.id);

    const io = req.app.get('io');
    if (io) {
      const payload = { id: order.id, status: order.status };
      // Notify customer tracking page
      io.to(order.id.toString()).emit('statusUpdated', payload);
      // Notify admin
      io.to('admin-room').emit('statusUpdated', payload);
      if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', payload);
      io.to('admin-room').emit('order_unassigned', { orderId: order.id, reason: 'Rider emergency cancel' });
      // Re-list for dispatch (riders poll the available-orders list; admins see it live)
      const relisted = { ...order.toJSON(), id: order.id, _id: order.id };
      delete relisted.deliveryPin; delete relisted.deliveryPinAttempts;
      io.to('admin-room').emit('newOrder', relisted);
    }
    realtime.deliveryRequest(order.id); // back in the pool for every online rider
    // Riders with the app in the background only hear about it by push (never the rider who released it).
    try {
      const restaurant = order.restaurantId
        ? await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name', 'location'] })
        : null;
      await pushNearestRiders({
        restaurant,
        orderId: order.id,
        limit: 5,
        excludeRiderId: req.user.id,
        title: '🛵 Order needs a rider',
        body: `${restaurant?.name || 'A store'} has an order waiting for a rider.`,
      });
    } catch (pushErr) {
      console.warn('[RIDER_RELEASE_PUSH_WARN]', pushErr.message);
    }

    // Push notify the customer about reassignment
    try {
      const User = getUserModel();
      const customer = await User.findByPk(order.userId);
      if (customer) {
        await sendPushToTokens(
          customer.fcmTokens,
          'Rider Reassigning 🔄',
          'Your previous rider had to cancel. We\'re assigning a new rider shortly.',
          { orderId: order.id, type: 'ORDER_UPDATE' },
          { recipients: [customer.id] }
        );
      }
    } catch (pushErr) {
      console.warn('[PUSH_NOTIFY_WARN] Failed to notify customer on rider cancel:', pushErr.message);
    }

    res.json({ message: 'Order released. Another rider will pick it up.', status: order.status });
  } catch (error) {
    serverError(res, '[RIDER_CANCEL_ERROR]', error);
  }
};

// @desc    Toggle online status
const toggleOnline = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    const wantOnline = req.body.isOnline === true || req.body.isOnline === 'true';
    // Going offline is always allowed (also for unapproved riders logging out).
    if (wantOnline && !partner.isApproved) return notApproved(res);
    partner.isOnline = wantOnline;
    await partner.save();
    // Join / leave the live dispatch room (delivery_request events) on every socket of this rider.
    realtime.setRiderOnline(partner.id, wantOnline && partner.isApproved);
    res.json({ isOnline: wantOnline });
  } catch (error) {
    serverError(res, '[RIDER_ONLINE_ERROR]', error);
  }
};

// @desc    Save FCM Token for partner
const saveFcmToken = async (req, res) => {
  const { cleanFcmToken, cleanAppVersion, tokenLikePattern } = require('../utils/fcmToken');
  const fcmToken = cleanFcmToken(req.body.fcmToken || req.body.token);
  const appVersion = cleanAppVersion(req.body.appVersion) || 'native-1.0.0';
  if (!fcmToken) {
    return res.status(400).json({ message: 'A valid push token is required' });
  }
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (partner) {
      // One entry per device token (an app update with a new appVersion must not leave a duplicate
      // of the same token behind, or the phone gets every order alert twice).
      const tokens = (Array.isArray(partner.fcmTokens) ? partner.fcmTokens : [])
        .filter(t => t && (typeof t === 'string' ? t : t.token) !== fcmToken);
      // Keyed by token only (B28): two phones on the same app version used to overwrite each other
      // (the second login silenced the first phone). Newest last, at most 5 devices.
      tokens.push({ token: fcmToken, appVersion, at: new Date().toISOString() });
      partner.fcmTokens = tokens.slice(-5);
      partner.changed('fcmTokens', true);
      await partner.save();
      // A shared / handed-over phone: detach this device token from every other rider account,
      // so the previous rider's order alerts stop ringing on this phone.
      try {
        const others = await DeliveryPartner.findAll({
          where: { id: { [Op.ne]: partner.id }, fcmTokens: { [Op.like]: tokenLikePattern(fcmToken) } },
          attributes: ['id', 'fcmTokens']
        });
        for (const other of others) {
          const list = Array.isArray(other.fcmTokens) ? other.fcmTokens : [];
          const filtered = list.filter(t => (typeof t === 'string' ? t : t?.token) !== fcmToken);
          if (filtered.length === list.length) continue; // only rows that really held this token
          other.fcmTokens = filtered;
          other.changed('fcmTokens', true);
          await other.save();
        }
      } catch (dedupeErr) {
        console.warn('[RIDER_FCM_DEDUPE_WARN]', dedupeErr.message);
      }
      res.json({ message: 'FCM Token saved' });
    } else {
      res.status(404).json({ message: 'Partner not found' });
    }
  } catch {
    res.status(500).json({ message: 'Failed to save token' });
  }
};

// @desc    Get all active orders for the logged in partner
const getActiveOrders = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });
    if (!partner.isApproved) return notApproved(res);

    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();

    const orders = await Order.findAll({
      where: { 
        deliveryPartnerId: req.user.id,
        status: { [Op.notIn]: ['Delivered', 'Cancelled'] }
      },
      order: [['createdAt', 'ASC']]
    });

    const userIds = [...new Set(orders.map(o => o.userId))];
    const restIds = [...new Set(orders.map(o => o.restaurantId))];
    
    // Only what the rider payload reads (polled every 12 s by every rider on duty): full rows dragged
    // password hashes, token lists and base64 photos / menus through every poll.
    const [users, restaurants] = await Promise.all([
      User.findAll({ where: { id: userIds }, attributes: ['id', 'name', 'phone', 'hostelBlock'] }),
      Restaurant.findAll({ where: { id: restIds }, attributes: ['id', 'name', 'location', 'whatsappNumber', 'lat', 'lon', ...require('../utils/riderPurchase').RIDER_PURCHASE_ATTRIBUTES] })
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

    const enrichedOrders = orders.map(order => ({
      ...riderOrderPayload(order, restMap[order.restaurantId], userMap[order.userId], { revealCustomer: true }),
      // The delivery PIN is never sent to riders: they ask the customer for it at handover.
      hasDeliveryPin: !!order.deliveryPin,
      pinLocked: (Number(order.deliveryPinAttempts) || 0) >= MAX_PIN_ATTEMPTS,
    }));

    // ── Task Sequencing Logic ──────────────────────
    const tasks = [];
    // 1. Pickups first (every pre-pickup state)
    enrichedOrders.filter(o => ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking'].includes(o.status)).forEach(o => {
      tasks.push({ type: 'PICKUP', orderId: o.id, location: o.restaurant, address: o.restaurantAddress });
    });
    // 2. Deliveries next
    enrichedOrders.filter(o => ['PickedUp', 'ArrivedAtGate'].includes(o.status)).forEach(o => {
      tasks.push({ type: 'DELIVERY', orderId: o.id, location: o.customerName, address: o.drop });
    });

    res.json({ orders: enrichedOrders, taskSequence: tasks });
  } catch (error) {
    serverError(res, '[RIDER_ACTIVE_ERROR]', error);
  }
};

// @desc    Get today's leaderboard (top riders by earnings)
const getLeaderboard = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const Order = getOrderModel();
    const startOfDay = istStartOfDay();

    const deliveries = await Order.findAll({
      where: {
        status: 'Delivered',
        deliveryPartnerId: { [Op.ne]: null },
        [Op.or]: [
          { deliveredAt: { [Op.gte]: startOfDay } },
          { deliveredAt: null, updatedAt: { [Op.gte]: startOfDay } }
        ]
      },
      attributes: ['deliveryPartnerId', 'finalPrice', 'totalPrice', 'deliveryFee']
    });

    const earningsMap = {};
    const countMap = {};
    for (const d of deliveries) {
      const pid = d.deliveryPartnerId;
      const e = riderPayout(d);
      earningsMap[pid] = (earningsMap[pid] || 0) + e;
      countMap[pid] = (countMap[pid] || 0) + 1;
    }

    const partnerIds = Object.keys(earningsMap);
    if (partnerIds.length === 0) return res.json([]);

    const partners = await DeliveryPartner.findAll({
      where: { id: partnerIds },
      attributes: ['id', 'name']
    });

    const board = partners.map(p => ({
      id: p.id,
      name: p.name,
      earnings: earningsMap[p.id] || 0,
      orders: countMap[p.id] || 0,
      isMe: p.id === req.user.id
    })).sort((a, b) => b.earnings - a.earnings).slice(0, 10);

    res.json(board);
  } catch (error) {
    serverError(res, '[RIDER_LEADERBOARD_ERROR]', error);
  }
};

const getRiderProfile = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const Order = getOrderModel();
    const partner = await DeliveryPartner.findByPk(req.user.id, {
      attributes: { exclude: ['password', 'fcmTokens'] }
    });
    if (!partner) return res.status(401).json({ message: 'Rider account not found (Session Expired)' });

    const completedCount = Order ? await Order.count({
      where: { deliveryPartnerId: req.user.id, status: 'Delivered' }
    }).catch(() => 0) : 0;

    res.json({
      ...partner.toJSON(),
      _id: partner.id,
      completedCount,
      completedDeliveries: completedCount,
      averageRating: partner.averageRating ?? null,
      rating: partner.averageRating ?? null, // null = no ratings yet (never an invented 5.0)
      totalRatings: partner.totalRatings || 0,
      totalEarnings: partner.totalEarnings || 0
    });
  } catch (error) {
    serverError(res, '[RIDER_PROFILE_ERROR]', error);
  }
};

// Delivered orders of this rider since `since` (deliveredAt, or updatedAt for rows older than that column).
const deliveredSince = (riderId, since) => getOrderModel().findAll({
  where: {
    deliveryPartnerId: riderId,
    status: 'Delivered',
    [Op.or]: [
      { deliveredAt: { [Op.gte]: since } },
      { deliveredAt: null, updatedAt: { [Op.gte]: since } }
    ]
  },
  attributes: ['id', 'deliveryFee', 'finalPrice', 'paymentMethod', 'fulfilment', 'deliveredAt', 'updatedAt']
});

// @desc    Get today's stats for current rider ("today" = IST calendar day)
const getTodayStats = async (req, res) => {
  try {
    const orders = await deliveredSince(req.user.id, istStartOfDay());

    // C6: one earnings rule (utils/riderEarnings), summed in paise.
    const earnings = sumEarningsPaise(orders) / 100;
    const count = orders.length;
    // Cash the rider collected at the door today (COD orders they delivered).
    const codCollected = orders.filter(o => o.paymentMethod === 'COD').reduce((sum, o) => sum + (Number(o.finalPrice) || 0), 0);
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id, { attributes: ['loginStreak', 'cashHeldPaise'] });
    // C6: cash held for Zenvy (rider cash ledger) and the COD limit, for the "Deposit ₹X" banner.
    const cash = riderCash.cashStatus(partner?.cashHeldPaise || 0, await riderCash.getCashLimitPaise(DeliveryPartner.sequelize));
    res.json({ earnings, orders: count, zenPoints: count * 5, streak: partner?.loginStreak || 0, codCollected, cash });
  } catch (error) {
    serverError(res, '[RIDER_TODAY_ERROR]', error);
  }
};

// @desc    Earnings for the last 7 IST days (today included), one bucket per day.
// @route   GET /api/delivery/stats/week
const getWeekStats = async (req, res) => {
  try {
    const DAY = 24 * 60 * 60 * 1000;
    const todayStart = istStartOfDay();
    const since = new Date(todayStart.getTime() - 6 * DAY);
    const orders = await deliveredSince(req.user.id, since);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      days.push({ date: istDayKey(new Date(todayStart.getTime() - i * DAY + 60 * 1000)), earnings: 0, orders: 0, codCollected: 0 });
    }
    const byDate = Object.fromEntries(days.map(d => [d.date, d]));
    for (const o of orders) {
      const bucket = byDate[istDayKey(deliveredAtOf(o))];
      if (!bucket) continue;
      bucket.earnings += riderPayout(o);
      bucket.orders += 1;
      if (o.paymentMethod === 'COD') bucket.codCollected += Number(o.finalPrice) || 0;
    }
    res.json({
      days,
      totalEarnings: days.reduce((s, d) => s + d.earnings, 0),
      totalOrders: days.reduce((s, d) => s + d.orders, 0),
      timezone: 'Asia/Kolkata'
    });
  } catch (error) {
    serverError(res, '[RIDER_WEEK_ERROR]', error);
  }
};

// @desc    Update rider's own profile
const updateRiderProfile = async (req, res) => {
  try {
    const { name, vehicleType, vehicleNumber, bio, emergencyContact, photoUrl } = req.body;
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) return res.status(401).json({ message: 'Rider account not found (Session Expired)' });

    const clean = (v, max) => (v === null ? '' : String(v).trim().slice(0, max));
    if (name !== undefined) {
      const n = clean(name, 60);
      if (n.length < 2) return res.status(400).json({ code: 'INVALID_NAME', message: 'Enter your name (at least 2 letters).' });
      partner.name = n;
    }
    if (vehicleType !== undefined) partner.vehicleType = clean(vehicleType, 30) || null;
    if (vehicleNumber !== undefined) partner.vehicleNumber = clean(vehicleNumber, 20).toUpperCase() || null;
    if (bio !== undefined) partner.bio = clean(bio, 160) || null;
    if (emergencyContact !== undefined) {
      const ec = emergencyContact ? normalizePhone(emergencyContact) : '';
      if (ec && !/^\d{10}$/.test(ec)) return res.status(400).json({ code: 'INVALID_PHONE', message: 'Enter a 10-digit emergency contact number.' });
      partner.emergencyContact = ec || null;
    }
    if (photoUrl !== undefined) {
      const { storeImageRef, sendImageError } = require('../utils/imageStore');
      const img = await storeImageRef(photoUrl, { req, ownerId: partner.id, purpose: 'avatar', maxBytes: 2 * 1024 * 1024 });
      if (!img.ok) return sendImageError(res, img);
      partner.photoUrl = img.value;
    }

    await partner.save();

    // Broadcast updated profile to admin room for monitoring
    const io = req.app.get('io');
    const updatePayload = {
      riderId: partner.id,
      name: partner.name,
      photoUrl: partner.photoUrl,
      vehicleType: partner.vehicleType,
      vehicleNumber: partner.vehicleNumber,
      averageRating: partner.averageRating
    };
    if (io) {
      io.to('admin-room').emit('rider_profile_updated', updatePayload);

      // Also broadcast to all active orders for this rider so customers see live updates
      const Order = getOrderModel();
      const activeOrders = await Order.findAll({
        where: {
          deliveryPartnerId: partner.id,
          status: ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking', 'PickedUp', 'ArrivedAtGate']
        },
        attributes: ['id']
      });
      activeOrders.forEach(order => {
        io.to(order.id.toString()).emit('rider_profile_updated', updatePayload);
      });
    }

    const { password, fcmTokens, tokenVersion, ...safe } = partner.toJSON(); // eslint-disable-line no-unused-vars
    // Same live count as GET /profile: the stored completedDeliveries column is never updated (always 0) and
    // the app showed "0 deliveries" after every profile save.
    const completedCount = await getOrderModel().count({ where: { deliveryPartnerId: partner.id, status: 'Delivered' } }).catch(() => null);
    res.json({
      ...safe,
      _id: partner.id,
      ...(completedCount !== null ? { completedCount, completedDeliveries: completedCount } : { completedDeliveries: undefined }),
      averageRating: partner.averageRating ?? null,
      rating: partner.averageRating ?? null,
    });
  } catch (error) {
    serverError(res, '[RIDER_PROFILE_UPDATE_ERROR]', error);
  }
};

// @desc    Rider support tickets (riders are DeliveryPartner rows, not Users, so /api/tickets cannot store them)
// @route   POST /api/delivery/support  { subject, description, priority? }
const createRiderTicket = async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim().slice(0, 120);
    const description = String(req.body?.description || '').trim().slice(0, 2000);
    if (!subject || !description) return res.status(400).json({ message: 'Pick a topic and describe the problem.' });
    const priority = ['Low', 'Medium', 'High', 'Critical'].includes(req.body?.priority) ? req.body.priority : 'Medium';
    const slaHours = { Critical: 2, High: 4, Medium: 12, Low: 24 }[priority];
    const { getTicketModel } = require('../models/Ticket');
    const ticket = await getTicketModel().create({
      userId: null,
      riderId: req.user.id,
      orderId: null,
      subject,
      description,
      priority,
      status: 'Open',
      slaBreachAt: new Date(Date.now() + slaHours * 60 * 60 * 1000)
    });
    const io = req.app.get('io');
    if (io) io.to('admin-room').emit('admin_issue_reported', {
      ticketId: ticket.id, senderRole: 'Rider', senderId: req.user.id,
      issueType: subject, details: description.slice(0, 200), timestamp: new Date()
    });
    require('../utils/realtime').notifyAdmin('ticket', 'created', ticket.id, { scope: 'rider' });
    res.status(201).json(ticket);
  } catch (error) {
    serverError(res, '[RIDER_TICKET_CREATE_ERROR]', error);
  }
};

// @route   GET /api/delivery/support
const getRiderTickets = async (req, res) => {
  try {
    const { getTicketModel } = require('../models/Ticket');
    const tickets = await getTicketModel().findAll({
      where: { riderId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    res.json(tickets);
  } catch (error) {
    serverError(res, '[RIDER_TICKET_LIST_ERROR]', error);
  }
};


// @desc    Get public profile of a rider (customer tracking page, no auth)
const getPublicRiderProfile = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.params.id, {
      attributes: ['id', 'name', 'photoUrl', 'vehicleType', 'vehicleNumber', 'averageRating', 'totalRatings', 'bio']
    });
    if (!partner) return res.status(404).json({ message: 'Rider not found' });
    res.json({ ...partner.toJSON(), _id: partner.id });
  } catch (error) {
    serverError(res, '[RIDER_ERROR]', error);
  }
};

// @desc    Change rider's own password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id);
    if (!partner) {
      return res.status(404).json({ message: 'Rider account not found' });
    }
    const isMatch = await partner.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid current password' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    partner.password = newPassword; // model hooks hash it and bump tokenVersion
    await partner.save();
    // Older sessions (other phones, a stolen token) are revoked; this device gets a fresh token.
    require('../middleware/authMiddleware').clearCachedUser(partner.id);
    // Live sockets opened with an older token are closed too (socket auth only checks at connect).
    realtime.disconnectRevokedSockets(partner.id, partner.tokenVersion);
    const token = generateToken(partner.id, partner.tokenVersion);
    if (token) res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Password updated successfully', token });
  } catch (error) {
    serverError(res, '[RIDER_ERROR]', error);
  }
};

// @desc    Notify arrival at gate
const notifyArrivalAtGate = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = getUserModel();
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });
    if (!['PickedUp', 'ArrivedAtGate'].includes(order.status)) {
      return res.status(400).json({ message: order.status === 'Delivered' ? 'This order is already delivered.' : order.status === 'Cancelled' ? 'This order was cancelled.' : 'Mark the order as picked up before you arrive at the gate.' });
    }

    // Conditional flip FIRST: never overwrite a Delivered / Cancelled that landed after our read.
    // Only the request that moves PickedUp -> ArrivedAtGate notifies (B28): a replay / double tap
    // answers 200 without pinging the customer again.
    const [arrived] = await Order.update(
      { status: 'ArrivedAtGate' },
      { where: { id: order.id, deliveryPartnerId: req.user.id, status: 'PickedUp' } }
    );
    if (arrived === 0) {
      const now = await Order.findByPk(order.id, { attributes: ['id', 'status'] });
      if (now && now.status === 'ArrivedAtGate') {
        return res.json({ message: 'Gate arrival notification sent successfully', status: 'ArrivedAtGate', alreadyApplied: true });
      }
      return res.status(409).json({ message: 'This order was just updated. Please refresh.' });
    }

    order.status = 'ArrivedAtGate';

    // Emit socket event to the order room
    const io = req.app.get('io');
    if (io) {
      io.to(order.id.toString()).emit('driverAtGate', {
        orderId: order.id,
        message: 'Your rider is waiting at the hostel gate!'
      });
      const gatePayload = {
        id: order.id,
        status: 'ArrivedAtGate'
      };
      io.to(order.id.toString()).emit('statusUpdated', gatePayload);
      io.to('admin-room').emit('statusUpdated', gatePayload);
      if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', gatePayload);
    }

    // Answer the rider first (B28); the push and WhatsApp messages can take seconds.
    res.json({ message: 'Gate arrival notification sent successfully', status: 'ArrivedAtGate' });

    // Send push notification to the customer
    try {
      const customer = await User.findByPk(order.userId);
      if (customer) {
        await sendPushToTokens(
          customer.fcmTokens,
          'Rider Arrived at Gate! 🛎️',
          'Your rider is waiting at the hostel gate. Please collect your order.',
          { orderId: order.id, type: 'GATE_ARRIVAL' },
          { recipients: [customer.id] }
        );
      }
    } catch (e) {
      console.warn('[PUSH_NOTIFY_WARN] Failed to send gate arrival update:', e.message);
    }

    // Send WhatsApp notification
    try {
      const customer = await User.findByPk(order.userId);
      if (customer && customer.phone) {
        await sendWhatsAppMessage(
          customer.phone,
          `🛎️ *Rider Arrived at Gate!*\n\nYour Zenvy rider is waiting at your hostel gate. Please collect your order.\n\n📍 *Tracking:* ${require('../utils/publicUrl').orderTrackingUrl(order.id)}`,
          'GATE_ARRIVAL'
        );
      }
    } catch (e) {
      console.warn('[WHATSAPP_NOTIFY_WARN] Failed to send WhatsApp gate arrival update:', e.message);
    }

  } catch (error) {
    console.error('[GATE_ARRIVAL_ERROR]', error);
    serverError(res, '[RIDER_ERROR]', error);
  }
};

// @desc    Remove this phone's push token from the signed-in rider (logout / account switch)
// @route   POST /api/delivery/fcm-token/remove   { fcmToken | token }
const removeFcmToken = async (req, res) => {
  const { cleanFcmToken } = require('../utils/fcmToken');
  const fcmToken = cleanFcmToken((req.body || {}).fcmToken || (req.body || {}).token);
  if (!fcmToken) return res.status(400).json({ message: 'A valid push token is required' });
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id, { attributes: ['id', 'fcmTokens'] });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    const list = Array.isArray(partner.fcmTokens) ? partner.fcmTokens : [];
    const filtered = list.filter((t) => (typeof t === 'string' ? t : t && t.token) !== fcmToken);
    if (filtered.length !== list.length) {
      partner.fcmTokens = filtered;
      partner.changed('fcmTokens', true);
      await partner.save();
    }
    // Idempotent: removing a token that is not there is still a success.
    res.json({ removed: list.length - filtered.length, devices: filtered.length });
  } catch (error) {
    serverError(res, '[RIDER_FCM_REMOVE_ERROR]', error);
  }
};

// @desc    Rider SOS: stored on the rider row (so an admin who opens the dashboard later still sees
//          it), sent live to the admin room and pushed to admin devices.
// @route   POST /api/delivery/sos   { lat?, lng?, accuracy?, fixAt?, note? }
//          fixAt = when the phone took that GPS fix (ms epoch): an old fix is marked stale for the admin.
const SOS_REPEAT_MS = 30 * 1000;
const SOS_FRESH_FIX_MS = 2 * 60 * 1000;
const cleanSosNote = (v) => (typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '');
// Where the rider is: the phone's fix, else their last live GPS (stale). Both carry `at` (ISO) when known.
const sosLocationOf = (body, liveLocation, now = Date.now()) => {
  const lat = Number(body.lat ?? body.latitude);
  const lng = Number(body.lng ?? body.longitude);
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (hasFix) {
    const fixAt = Number(body.fixAt);
    // A fix "from the future" (phone clock ahead) counts as now; only a clearly old one is stale.
    const at = Number.isFinite(fixAt) && fixAt > 0 ? Math.min(fixAt, now) : null;
    const accuracy = Number(body.accuracy);
    return {
      lat, lng,
      ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy: Math.round(accuracy) } : {}),
      ...(at ? { at: new Date(at).toISOString() } : {}),
      ...(at && now - at > SOS_FRESH_FIX_MS ? { stale: true } : {}),
    };
  }
  const live = liveLocation && typeof liveLocation === 'object' ? liveLocation : null;
  if (live && Number.isFinite(Number(live.lat)) && Number.isFinite(Number(live.lng))) {
    const ts = live.ts ? Date.parse(live.ts) : NaN;
    return { lat: Number(live.lat), lng: Number(live.lng), stale: true, ...(Number.isFinite(ts) ? { at: new Date(ts).toISOString() } : {}) };
  }
  return null;
};
const triggerSos = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const partner = await DeliveryPartner.findByPk(req.user.id, { attributes: ['id', 'name', 'phone', 'isSosActive', 'sosAt', 'sosNote', 'sosLocation', 'liveLocation', 'currentOrderId'] });
    if (!partner) return res.status(401).json({ message: 'Rider account not found' });

    const body = req.body || {};
    const now = new Date();
    const fresh = sosLocationOf(body, partner.liveLocation, now.getTime());
    const typedNote = cleanSosNote(body.note);

    // A repeated tap within 30 s refreshes the location but does not re-page every admin. A repeat
    // without a new fix / note keeps what the first tap stored. A NEW SOS never shows the location or
    // note of an older (resolved) one.
    const repeat = partner.isSosActive && partner.sosAt && now - new Date(partner.sosAt) < SOS_REPEAT_MS;
    const prevLocation = typeof partner.sosLocation === 'string' ? (() => { try { return JSON.parse(partner.sosLocation); } catch { return null; } })() : partner.sosLocation;
    const location = repeat && (!fresh || (fresh.stale && prevLocation && !prevLocation.stale)) ? (prevLocation || fresh) : fresh;
    const note = typedNote || (repeat ? cleanSosNote(partner.sosNote) : '');
    await DeliveryPartner.update(
      { isSosActive: true, sosAt: repeat ? partner.sosAt : now, sosLocation: location || null, sosNote: note || null },
      { where: { id: partner.id } }
    );

    const payload = {
      riderId: partner.id,
      riderName: partner.name,
      riderPhone: partner.phone || null,
      timestamp: (repeat ? new Date(partner.sosAt) : now).toISOString(),
      lat: location ? location.lat : undefined,
      lng: location ? location.lng : undefined,
      location,
      orderId: partner.currentOrderId || null,
      note: note || undefined,
    };
    const io = req.app.get('io');
    if (io) io.to('admin-room').emit('sos_received', payload);
    console.error(`[CRITICAL SOS] Rider ${partner.id} (${partner.name}) at ${payload.timestamp}${location ? ` ${location.lat},${location.lng}` : ''}`);

    if (!repeat) {
      try {
        const admins = await getUserModel().findAll({ where: { role: 'admin', isActive: { [Op.ne]: false } }, attributes: ['id', 'fcmTokens'] });
        const tokens = admins.flatMap((a) => (Array.isArray(a.fcmTokens) ? a.fcmTokens : []));
        if (tokens.length) {
          await sendPushToTokens(tokens, '🚨 Rider SOS', `${partner.name || 'A rider'} needs help${partner.phone ? ` · ${partner.phone}` : ''}`, { type: 'RIDER_SOS', riderId: String(partner.id) }, { recipients: admins.map((a) => a.id) });
        }
      } catch (pushErr) {
        console.warn('[RIDER_SOS_PUSH_WARN]', pushErr.message);
      }
      try {
        const { getVerificationLogModel } = require('../models/VerificationLog');
        await getVerificationLogModel().create({ adminId: String(partner.id), targetId: String(partner.id), action: 'RIDER_SOS', details: JSON.stringify({ location, orderId: payload.orderId, note: note || undefined }) });
      } catch (logErr) {
        console.warn('[RIDER_SOS_AUDIT_WARN]', logErr.message);
      }
    }
    res.json({ ok: true, sosActive: true, sosAt: payload.timestamp, repeat: !!repeat });
  } catch (error) {
    serverError(res, '[RIDER_SOS_ERROR]', error);
  }
};

module.exports = { 
  registerPartner, authPartner, acceptOrder, getPendingOrders, getActiveOrders, 
  updateOrderStatus, toggleOnline, getOrderHistory, saveFcmToken, getLeaderboard,
  getRiderProfile, updateRiderProfile, getPublicRiderProfile, getTodayStats,
  cancelOrderByRider, changePassword, notifyArrivalAtGate,
  getWeekStats, createRiderTicket, getRiderTickets, removeFcmToken, triggerSos,
  sosLocationOf,
  claimForRider, // A2: the count + claim step (tests run it inside a transaction too)
};
