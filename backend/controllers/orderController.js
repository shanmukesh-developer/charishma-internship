const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');
const { getRestaurantModel } = require('../models/Restaurant');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { sendPushToTokens } = require('../utils/push');
const { getMenuItemModel } = require('../models/MenuItem');
const { sendWhatsAppMessage, formatOrderMessage } = require('../utils/whatsappUtil');
const { Op, Transaction } = require('sequelize');
const crypto = require('crypto');
const { computeOrderQuote, PricingError, activeCouponWhere, normalizePaymentMethod, PAYMENT_UNAVAILABLE_MESSAGE, money } = require('../utils/orderPricing');
const { getCampusServiceability } = require('../utils/storeHours');
const { getHaversineDistance } = require('../utils/distance');
const realtime = require('../utils/realtime');
const walletLedger = require('../utils/walletLedger');
const { pushNearestRiders, riderPayout, refreshRiderCurrentOrder } = require('../utils/riderDispatch');
const deliverySlots = require('../utils/deliverySlots');

// Money transactions (wallet debit / refund, coupon claim). IMMEDIATE takes the SQLite write lock up
// front: a DEFERRED transaction that reads then writes fails with SQLITE_BUSY when a parallel request
// (double-tapped cancel, auto-cancel job) holds the lock. PostgreSQL ignores the type (row locks apply).
const MONEY_TX = { type: Transaction.TYPES.IMMEDIATE };

// An order just entered the rider pool by a path other than restaurant-accept: push the nearest riders too.
// Fire-and-forget; never throws.
const pushPoolOrder = (order) => {
  (async () => {
    const restaurant = await getRestaurantModel().findByPk(order.restaurantId);
    await pushNearestRiders({
      restaurant,
      orderId: order.id,
      limit: 20,
      title: '🛵 New Order Ready!',
      body: `${restaurant?.name || 'Restaurant'} has a new order for pickup. Closest to you!`,
      data: { distance: order.distance },
    });
  })().catch((err) => console.error('[POOL_PUSH_ERROR]', err.message));
};
const { sendServerError } = require('../utils/httpErrors');

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

const broadcastOrderStatus = (req, orderOrId, payload) => {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const isObj = orderOrId && typeof orderOrId === 'object';
    const room = String(isObj ? orderOrId.id : orderOrId);
    // Also the customer's own room (joined on every connect): the orders list rejoins order rooms only after
    // it loads, so a status change while the phone slept was missed until a manual refresh. One emit over both
    // rooms, so a socket in both gets it once.
    const userRoom = isObj && orderOrId.userId ? `user_${orderOrId.userId}` : null;
    io.to(userRoom ? [room, userRoom] : room).emit('statusUpdated', payload);
    io.to('admin-room').emit('statusUpdated', payload);
    require('../utils/realtime').notifyAdmin('order', 'updated', room);
    // The restaurant portal joins `restaurant_<id>`; no global broadcast of other people's orders.
    if (isObj && orderOrId.restaurantId) io.to(`restaurant_${orderOrId.restaurantId}`).emit('statusUpdated', payload);
  } catch (err) {
    console.warn('[SOCKET_BROADCAST_WARN]', err.message);
  }
};

const isVendorFulfilled = (order) => !!order && order.fulfilment === 'VENDOR';

/** "₹1,250" / "₹123.50": rupees for customer messages (Indian grouping, paise only when there are paise). */
const inr = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

// Stall (VENDOR) orders are marked Delivered by the stall itself, with no PIN and no customer
// confirmation, and they are COD. To stop a colluding stall + customer farming ZenPoints,
// completedOrders (spins) and badges with fake orders, loyalty for stall orders needs the order
// to have lived a few minutes and is capped per customer per IST day.
const STALL_LOYALTY_DAILY = Math.max(0, parseInt(process.env.STALL_LOYALTY_DAILY, 10) || 2);
const STALL_LOYALTY_MIN_AGE_MS = 5 * 60 * 1000;
const stallLoyaltyAllowed = async (order) => {
  if (!isVendorFulfilled(order)) return true;
  try {
    const created = new Date(order.createdAt).getTime();
    if (!Number.isFinite(created) || Date.now() - created < STALL_LOYALTY_MIN_AGE_MS) return false;
    // The IST day the order was delivered (rating later still counts against that day's cap).
    const delivered = new Date(order.deliveredAt || Date.now()).getTime();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const dayStart = new Date(Math.floor((delivered + istOffset) / 86400000) * 86400000 - istOffset);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const sameDayStallOrders = await getOrderModel().findAll({
      where: { userId: order.userId, fulfilment: 'VENDOR', status: 'Delivered', deliveredAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd } },
      attributes: ['id'],
      order: [['deliveredAt', 'ASC'], ['id', 'ASC']],
      limit: STALL_LOYALTY_DAILY,
    });
    // Only the first STALL_LOYALTY_DAILY stall orders of that day earn loyalty.
    return sameDayStallOrders.some((o) => String(o.id) === String(order.id));
  } catch {
    return false;
  }
};

// Push to the store's partner/vendor app devices (works while the app is closed). Never throws.
// Item count + amount only: no customer name / phone / address in a lock-screen notification.
const pushStoreNewOrder = async (restaurant, order) => {
  try {
    const { pushToStore } = require('../utils/storePush');
    const items = normalizeItems(order.items);
    const count = items.reduce((s, i) => s + (Number(i.quantity) || 1), 0);
    // Tagged per order: the waiting-order reminders (utils/storeOrderReminder) replace it instead of stacking.
    await pushToStore(restaurant, 'New order', `${count} item${count === 1 ? '' : 's'} · ₹${money(order.finalPrice)}${order.paymentMethod === 'COD' ? ' (cash)' : ''}`, { orderId: order.id, type: 'NEW_ORDER' }, { tag: `order-${order.id}` });
  } catch (err) {
    console.warn('[STORE_PUSH_WARN]', err.message);
  }
};
const pushStoreCancelled = async (restaurantId, order, text) => {
  try {
    const { pushToStore } = require('../utils/storePush');
    await pushToStore(restaurantId, 'Order cancelled', text || 'An order was cancelled.', { orderId: order.id, type: 'ORDER_CANCELLED' }, { tag: `order-${order.id}` });
  } catch (err) {
    console.warn('[STORE_PUSH_WARN]', err.message);
  }
};

// Order-status push to the customer who placed the order. Never throws.
const pushCustomer = async (order, title, body) => {
  try {
    const customer = await getUserModel().findByPk(order.userId, { attributes: ['id', 'fcmTokens'] });
    if (customer) await sendPushToTokens(customer.fcmTokens, title, body, { orderId: order.id, type: 'ORDER_UPDATE' }, { recipients: [customer.id] });
  } catch (err) {
    console.warn('[CUSTOMER_PUSH_WARN]', err.message);
  }
};

const isAdminUser = (user) => !!(user && user.role && String(user.role).toLowerCase() === 'admin');

// ── Campus / address resolution ─────────────────────────────────
const CAMPUS_KEYS = { srmap: 'SRM AP', srm: 'SRM AP', vitap: 'VIT AP', vit: 'VIT AP', amrita: 'Amrita' };
const resolveCampus = (campus, address) => {
  const key = String(campus || '').toLowerCase().replace(/[^a-z]/g, '');
  if (CAMPUS_KEYS[key]) return CAMPUS_KEYS[key];
  const a = String(address || '').toLowerCase();
  if (a.includes('srm ap') || a.startsWith('srm')) return 'SRM AP';
  if (a.includes('vit ap') || a.startsWith('vit')) return 'VIT AP';
  if (a.includes('amrita')) return 'Amrita';
  return null;
};
const HUB = { lat: 16.4632, lng: 80.5064 }; // SRM AP central hub
const MAX_RADIUS_KM = 40;

// ── Double-tap protection (per user + client idempotency key, 2 minutes) ──
const IDEMPOTENCY_TTL_MS = 2 * 60 * 1000; // in-flight guard (same process)
const IDEMPOTENCY_DB_WINDOW_MS = 24 * 60 * 60 * 1000; // stored key on the order (any process, 24 h)
const recentOrderKeys = new Map(); // `${userId}:${key}` -> { at, orderId }
const sweepIdempotencyKeys = () => {
  const now = Date.now();
  for (const [k, v] of recentOrderKeys) if (now - v.at > IDEMPOTENCY_TTL_MS) recentOrderKeys.delete(k);
};

const sendPricingError = (res, err) => res.status(err.status || 400).json(err.toBody());

// @desc    Price a basket without placing it (the bill the customer sees = the bill we charge)
// @route   POST /api/orders/quote
const quoteOrder = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(401).json({ message: 'Your session has expired. Please log in again.', code: 'ACCOUNT_NOT_FOUND' });
    const quote = await computeOrderQuote({ user, items: (req.body || {}).items, couponCode: (req.body || {}).couponCode });
    // Colleges: the bill already says when the student's college is paused / not open yet, or the store does not
    // serve it (createOrder refuses the same; only checked when the app sends the college).
    if ((req.body || {}).campus !== undefined) {
      const campuses = require('../utils/campuses');
      const campusKey = campuses.normalizeKey(req.body.campus);
      const canOrder = await campuses.orderingCheck(campusKey);
      if (!canOrder.ok) return res.status(400).json({ code: canOrder.code, message: canOrder.message, campus: campusKey });
      const store = await getRestaurantModel().findByPk(quote.store.id, { attributes: ['id', 'name', 'visibleCampuses'] });
      if (store && !campuses.storeServes(store, campusKey)) {
        const serves = campuses.storeCampuses(store).map(campuses.labelOf).join(' and ');
        return res.status(400).json({ code: 'STORE_NOT_AT_CAMPUS', message: `${store.name} delivers to ${serves} only. Please order from a store at your college.`, campus: campusKey });
      }
    }
    const walletBalance = money(user.walletBalance);
    res.json({
      ...quote,
      serviceability: getCampusServiceability(deliverySlots.now()),
      paymentMethods: quote.paymentMethods || ['COD', 'Wallet'],
      walletBalance,
      // Stalls and rider-purchase stores are COD only (createOrder refuses Wallet for them).
      canPayWithWallet: quote.fulfilment !== 'VENDOR' && (quote.paymentMethods || ['COD', 'Wallet']).includes('Wallet') && walletBalance >= quote.finalPrice
    });
  } catch (err) {
    if (err instanceof PricingError) return sendPricingError(res, err);
    console.error('[ORDER_QUOTE_ERROR]', err);
    res.status(500).json({ message: 'We could not calculate your bill right now. Please try again.' });
  }
};

// @desc    Is campus ordering open right now?
// @route   GET /api/orders/serviceability
const getServiceability = async (req, res) => {
  // storeAcceptTimeoutMin (new key): tracking says how long the store has to accept before the order is
  // cancelled for free.
  await deliverySlots.loadConfig();
  res.json({ ...getCampusServiceability(deliverySlots.now()), paymentMethods: ['COD', 'Wallet'], storeAcceptTimeoutMin: storeAcceptTimeoutMinutes() });
};

// @desc    Delivery slots (today + tomorrow, IST) for a kind of order, before there is a basket to quote
//          (the shopping list, the Home hint). The checkout uses the quote's deliverySlots (items + store hours).
// @route   GET /api/orders/delivery-slots?type=food|store|vendor|list|cake|specialized_cake[&storeId=]
const getDeliverySlots = async (req, res) => {
  try {
    await deliverySlots.loadConfig();
    if (!deliverySlots.slotsEnabled()) return res.json({ enabled: false, slots: [], nextSlot: null, defaultSlotId: null });
    let store = null;
    const storeId = String((req.query || {}).storeId || '').trim();
    if (storeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) {
      store = await getRestaurantModel().findByPk(storeId);
    }
    // Local vendors / stalls deliver themselves while open: no slots for them (owner, 27 Oct).
    if (String((req.query || {}).type || '').toLowerCase() === 'vendor' || (store && require('../utils/vendorTypes').isLocalVendorStore(store))) {
      return res.json({ enabled: false, slots: [], nextSlot: null, defaultSlotId: null });
    }
    const lead = deliverySlots.leadForType((req.query || {}).type);
    res.json({ ...(await deliverySlots.applyCapacity(deliverySlots.slotsForOrder({ store, lead, at: deliverySlots.now() }))), type: String((req.query || {}).type || 'food') });
  } catch (err) {
    console.error('[DELIVERY_SLOTS_ERROR]', err);
    res.status(500).json({ message: 'We could not load the delivery slots right now. Please try again.' });
  }
};

// @desc    Create a new order
// @route   POST /api/orders
const createOrder = async (req, res) => {
  const body = req.body || {};
  const { items, deliverySlot, deliveryAddress, coordinates, couponCode } = body;
  const rawKey = req.get('Idempotency-Key') || body.idempotencyKey;
  const idemRaw = rawKey ? String(rawKey).trim().slice(0, 100) : '';
  const idemKey = idemRaw ? `${req.user.id}:${idemRaw}` : null;
  let idemClaimed = false;

  try {
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Your basket is empty. Add something tasty first!', code: 'EMPTY_BASKET' });
    }

    // ── Payment: Cash on Delivery or Wallet only ──
    if (body.paymentMethod === undefined || body.paymentMethod === null || body.paymentMethod === '') {
      return res.status(400).json({ message: 'Please choose Cash on Delivery or Wallet to pay.', code: 'PAYMENT_METHOD_REQUIRED' });
    }
    const paymentMethod = normalizePaymentMethod(body.paymentMethod);
    if (!paymentMethod) {
      return res.status(400).json({ message: PAYMENT_UNAVAILABLE_MESSAGE, code: 'PAYMENT_METHOD_UNAVAILABLE', allowed: ['COD', 'Wallet'] });
    }

    // ── Campus ordering hours (9 PM – 6 AM IST closed) ──
    await deliverySlots.loadConfig();
    const serviceability = getCampusServiceability(deliverySlots.now());
    if (!serviceability.open) {
      return res.status(403).json({ message: serviceability.message, code: 'ORDERING_CLOSED', reopensAt: serviceability.reopensAt });
    }

    // ── Delivery location ──
    const address = String(deliveryAddress || '').replace(/[<>]/g, '').trim().slice(0, 500);
    if (address.length < 3) {
      return res.status(400).json({ message: 'Please add your delivery address (hostel block and room) so the rider can find you.', code: 'ADDRESS_REQUIRED' });
    }
    const campus = resolveCampus(body.campus, address);
    // Structured delivery notes: up to 6 short strings.
    const deliveryInstructions = (Array.isArray(body.deliveryInstructions) ? body.deliveryInstructions : [])
      .filter((n) => typeof n === 'string')
      .map((n) => n.replace(/[<>]/g, '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 6);
    const lat = coordinates ? Number(coordinates.lat) : NaN;
    const lng = coordinates ? Number(coordinates.lng) : NaN;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    if (!campus && !hasCoords) {
      return res.status(400).json({ message: 'We need your location pin to deliver outside campus. Please allow location access, or pick your campus.', code: 'LOCATION_REQUIRED' });
    }
    if (hasCoords) {
      const km = getHaversineDistance(HUB.lat, HUB.lng, lat, lng);
      if (km > MAX_RADIUS_KM) {
        return res.status(400).json({ message: `Sorry, that location is ${km.toFixed(1)} km away — we deliver within ${MAX_RADIUS_KM} km of campus.`, code: 'OUT_OF_RANGE' });
      }
    }

    // ── Double tap → same order, never two ──
    if (idemKey) {
      sweepIdempotencyKeys();
      const seen = recentOrderKeys.get(idemKey);
      if (seen && seen.orderId) {
        const Order = getOrderModel();
        const existing = await Order.findByPk(seen.orderId);
        if (existing) return res.status(200).json({ ...ownerOrderJson(existing), _id: existing.id, duplicate: true });
      } else if (seen) {
        return res.status(409).json({ message: 'Your order is already being placed — hang tight!', code: 'ORDER_IN_PROGRESS' });
      }
      // Survives restarts / redeploys and lasts 24 h: the key is stored on the order itself.
      const stored = await getOrderModel().findOne({
        where: { userId: req.user.id, idempotencyKey: idemRaw, createdAt: { [Op.gt]: new Date(Date.now() - IDEMPOTENCY_DB_WINDOW_MS) } },
      });
      if (stored) return res.status(200).json({ ...ownerOrderJson(stored), _id: stored.id, duplicate: true });
      recentOrderKeys.set(idemKey, { at: Date.now(), orderId: null });
      idemClaimed = true;
    }

    const User = getUserModel();
    const Order = getOrderModel();
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      return res.status(401).json({ message: 'Your session has expired. Please log in again.', code: 'ACCOUNT_NOT_FOUND' });
    }

    // ── Server prices everything from the DB ──
    let quote;
    try {
      quote = await computeOrderQuote({ user: currentUser, items, couponCode });
    } catch (err) {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      if (err instanceof PricingError) return sendPricingError(res, err);
      // Same key raced in from another process: the transaction rolled back, return the winner.
      if (idemRaw && err && err.name === 'SequelizeUniqueConstraintError') {
        const winner = await Order.findOne({ where: { userId: req.user.id, idempotencyKey: idemRaw } });
        if (winner) return res.status(200).json({ ...ownerOrderJson(winner), _id: winner.id, duplicate: true });
      }
      throw err;
    }

    // ── The bill the customer confirmed must still be the bill we charge ──
    // Optional (older app builds don't send it): a price / fee / coupon change since the customer
    // saw the bill returns the fresh quote so the app can show it and ask again.
    if (body.expectedTotal !== undefined && body.expectedTotal !== null && body.expectedTotal !== '') {
      const expected = Number(body.expectedTotal);
      if (Number.isFinite(expected) && Math.abs(expected - Number(quote.finalPrice)) > 0.5) {
        if (idemClaimed) recentOrderKeys.delete(idemKey);
        const walletBalance = money(currentUser.walletBalance);
        const methods = quote.paymentMethods || ['COD', 'Wallet'];
        return res.status(409).json({
          code: 'PRICE_CHANGED',
          message: `Your bill changed to ₹${money(quote.finalPrice)} (was ₹${money(expected)}). Please check it and confirm again.`,
          quote: {
            ...quote,
            serviceability,
            paymentMethods: methods,
            walletBalance,
            canPayWithWallet: quote.fulfilment !== 'VENDOR' && methods.includes('Wallet') && walletBalance >= quote.finalPrice,
          },
        });
      }
    }

    // ── Delivery slot (utils/deliverySlots): re-checked here against the cutoff + store hours ──
    // New apps send the slot id ('2026-10-27|S1'); a slot that closed meanwhile is refused with the open
    // ones so the app can ask again. Older builds send 'ASAP' / nothing: the earliest open slot is assigned.
    let slotCols = { deliverySlot: String(deliverySlot || 'ASAP').replace(/[<>]/g, '').slice(0, 80) };
    if (quote.deliverySlots) {
      const picked = deliverySlots.resolveSlot(deliverySlot, quote.deliverySlots);
      if (!picked.ok) {
        if (idemClaimed) recentOrderKeys.delete(idemKey);
        return res.status(picked.status).json(picked.body);
      }
      slotCols = deliverySlots.slotColumns(picked.slot);
    }

    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(quote.store.id);
    // Colleges (utils/campuses, owner 31 Oct 2026): ordering paused or not started yet at the student's college, or a
    // store that does not serve that college, is refused here, before any money moves (no cross-college orders).
    const campuses = require('../utils/campuses');
    const campusKey = campuses.normalizeKey(campus);
    const canOrder = await campuses.orderingCheck(campusKey);
    if (!canOrder.ok) {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      return res.status(400).json({ code: canOrder.code, message: canOrder.message, campus: campusKey });
    }
    if (restaurant && !campuses.storeServes(restaurant, campusKey)) {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      const serves = campuses.storeCampuses(restaurant).map(campuses.labelOf).join(' and ');
      return res.status(400).json({ code: 'STORE_NOT_AT_CAMPUS', message: `${restaurant.name} delivers to ${serves} only. Please order from a store at your college.`, campus: campusKey });
    }
    // Rider-purchase store: marked offline, or has no partner login (nobody can tap Accept), so the
    // rider goes there, buys the items and delivers. Its orders skip store acceptance and go to riders.
    const riderBuys = require('../utils/riderPurchase').isRiderPurchaseStore(restaurant, 'createOrder');
    // CampusBites stall: cash to the vendor on delivery, the vendor delivers (no rider, no PIN).
    const isVendorOrder = quote.fulfilment === 'VENDOR';
    if (isVendorOrder && paymentMethod !== 'COD') {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      return res.status(400).json({ code: 'STALL_COD_ONLY', message: `${restaurant.name} takes cash on delivery only.`, allowed: ['COD'] });
    }
    // Rider-purchase store: the rider pays the shop and is repaid by the customer's cash, so these
    // orders are cash on delivery only (same code as stalls so every app build already handles it).
    if (!isVendorOrder && riderBuys && paymentMethod !== 'COD') {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      return res.status(400).json({ code: 'STALL_COD_ONLY', message: `${restaurant.name} is a buy-at-store shop and takes cash on delivery only.`, allowed: ['COD'] });
    }

    let isSurge = false;
    try {
      const serverModule = require('../server');
      if (typeof serverModule.isSurgeActive === 'function') isSurge = !!serverModule.isSurgeActive(restaurant.zone);
    } catch { /* server module not ready — skip surge */ }

    // Real distance only when both ends have real coordinates; never a simulated number.
    let distanceKm = null;
    if (hasCoords && restaurant.lat != null && restaurant.lon != null) {
      distanceKm = Number(getHaversineDistance(Number(restaurant.lat), Number(restaurant.lon), lat, lng).toFixed(2));
    }

    // ── Coupon claim + wallet debit + order row: all or nothing ──
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    let createdOrder;
    // The id is chosen up front so the wallet ledger row can point at the order it paid for.
    const newOrderId = crypto.randomUUID();
    try {
      createdOrder = await sequelize.transaction(MONEY_TX, async (t) => {
        if (quote.coupon) {
          const { getCouponModel } = require('../models/Coupon');
          const Coupon = getCouponModel();
          const [claimed] = await Coupon.update({ isUsed: true }, { where: activeCouponWhere(quote.coupon.code, currentUser.id), transaction: t });
          if (claimed === 0) throw new PricingError(400, 'COUPON_INVALID', 'That coupon was just used or has expired. Remove it to continue.');
        }
        if (paymentMethod === 'Wallet' && quote.finalPrice > 0) {
          const amount = Number(quote.finalPrice);
          // C5: conditional debit + ledger row (ORDER_PAYMENT) in this transaction.
          try {
            await walletLedger.applyWalletChange({
              t, ownerType: 'user', ownerId: currentUser.id, amountPaise: -walletLedger.toPaise(amount),
              type: walletLedger.TYPES.ORDER_PAYMENT, ref: { type: 'ORDER', id: newOrderId },
              actor: { type: 'user', id: currentUser.id }, idempotencyKey: `order-pay:${newOrderId}`,
            });
          } catch (err) {
            if (!walletLedger.isInsufficient(err)) throw err;
            throw new PricingError(400, 'INSUFFICIENT_WALLET',
              `Not enough Wallet balance — this order needs ₹${amount} and you have ₹${money(currentUser.walletBalance)}. Choose Cash on Delivery to place it.`,
              { needed: amount, walletBalance: money(currentUser.walletBalance) });
          }
        }
        return Order.create({
          id: newOrderId,
          userId: currentUser.id,
          restaurantId: quote.store.id,
          // An order from an owner-only test store is a test order too (utils/testView: only testers' riders see it).
          isTestData: !!quote.store.isTestData,
          items: quote.lines,
          totalPrice: quote.subtotal,
          deliveryFee: quote.deliveryFee,
          batchDiscount: quote.batchDiscount,
          gateDiscount: quote.perkDiscount, // badge / ZenPoints perks
          finalPrice: quote.finalPrice,
          priceBreakdown: {
            subtotal: quote.subtotal,
            deliveryFee: quote.deliveryFee,
            packagingFee: quote.packagingFee,
            taxes: quote.taxes,
            discounts: quote.discounts,
            totalDiscount: quote.totalDiscount,
            finalPrice: quote.finalPrice,
            couponCode: quote.coupon ? quote.coupon.code : null
          },
          distance: distanceKm,
          estDuration: null, // set by the restaurant when it accepts
          ...slotCols,
          deliveryAddress: address,
          // Customer's pin for rider navigation (dropCoords, assigned rider only). Null when not sent.
          dropLat: hasCoords ? lat : null,
          dropLng: hasCoords ? lng : null,
          deliveryInstructions: deliveryInstructions.length ? deliveryInstructions : null,
          hostelGateDelivery: false,
          isSurge,
          paymentMethod,
          // Wallet money is taken above inside this transaction; cash is collected at the door.
          paymentStatus: paymentMethod === 'Wallet' ? 'Completed' : 'Pending',
          upiUTR: null,
          upiScreenshot: null,
          upiStatus: null,
          category: isVendorOrder ? 'LOCAL_VENDOR' : ((restaurant.vendorType || 'RESTAURANT').toUpperCase() === 'RESTAURANT' ? 'Food' : restaurant.vendorType),
          // A stall never skips its own acceptance (no rider fallback); an isOffline stall is closed (quote).
          status: !isVendorOrder && riderBuys ? 'Accepted' : 'Pending',
          ...(!isVendorOrder && riderBuys ? { acceptedAt: new Date() } : {}),
          fulfilment: isVendorOrder ? 'VENDOR' : 'ZENVY',
          // C6: commission fixed now from the store's current rate (never recomputed later), and whether the
          // rider pays the shop at the counter (buy-at-store: not paid out by Zenvy, rider cash ledger).
          ...require('../utils/commission').snapshotFields(restaurant, quote.subtotal),
          storePaidByRider: !isVendorOrder && !!riderBuys,
          idempotencyKey: idemRaw || null,
          // The stall hands the order over itself: no delivery PIN.
          deliveryPin: isVendorOrder ? null : String(crypto.randomInt(1000, 10000))
        }, { transaction: t });
      });
    } catch (err) {
      if (idemClaimed) recentOrderKeys.delete(idemKey);
      if (err instanceof PricingError) return sendPricingError(res, err);
      // Same Idempotency-Key raced in from another tab / device / process: this transaction rolled
      // back (nothing charged here) and the first order exists, so return it instead of a 500.
      if (idemRaw && err && err.name === 'SequelizeUniqueConstraintError') {
        const winner = await Order.findOne({ where: { userId: req.user.id, idempotencyKey: idemRaw } });
        if (winner) return res.status(200).json({ ...ownerOrderJson(winner), _id: winner.id, duplicate: true }); // owner: keeps the PIN
      }
      throw err;
    }
    if (idemClaimed) recentOrderKeys.set(idemKey, { at: Date.now(), orderId: createdOrder.id });

    try {
      // The daily streak is credited on delivery (services/BadgeService creditCustomerForDelivery).
      await User.increment('totalOrders', { by: 1, where: { id: currentUser.id } });
    } catch (statsErr) {
      console.warn('[ORDER_STATS] stats update skipped:', statsErr.message);
    }

    const io = req.app.get('io');
    try {
      const { checkSurgeState } = require('../server');
      if (typeof checkSurgeState === 'function') checkSurgeState(io, restaurant.zone || 'Amaravathi_Central');
    } catch { /* surge check not critical */ }

    try {
      if (io && currentUser.hostelBlock) io.emit('blockOrderPulse', { blockName: currentUser.hostelBlock });
    } catch (e) {
      console.warn('[BLOCK_PULSE_WARN] Socket emit failed:', e.message);
    }

    res.status(201).json({ ...ownerOrderJson(createdOrder), _id: createdOrder.id, bill: quote });

    // ── After the response: notifications & dispatch (never affect the order) ──
    // The customer's WhatsApp confirmation runs on its own: awaited here it held back the store's new-order
    // alert and the rider dispatch below by up to WHATSAPP_TIMEOUT_MS (8 s) whenever the provider was slow.
    if (currentUser.phone) {
      Order.findByPk(createdOrder.id, { include: [{ model: Restaurant, as: 'restaurant', attributes: ['name'] }] })
        .then((orderForMsg) => sendWhatsAppMessage(currentUser.phone, formatOrderMessage(orderForMsg, 'CUSTOMER_CONFIRMATION'), 'CONFIRMATION'))
        .catch((waErr) => console.error('[WHATSAPP_ERROR] Customer alert failed:', waErr && waErr.message));
    }

    if (!io) return;
    const riderPayload = {
      id: createdOrder.id,
      restaurant: restaurant.name,
      restaurantAddress: restaurant.location,
      drop: createdOrder.deliveryAddress,
      items: normalizeItems(createdOrder.items),
      totalPrice: createdOrder.totalPrice,
      finalPrice: createdOrder.finalPrice,
      paymentMethod: createdOrder.paymentMethod,
      earnings: `₹${riderPayout(createdOrder)}`,
      distance: createdOrder.distance,
      createdAt: createdOrder.createdAt,
      ...deliverySlots.slotFields(createdOrder),
    };
    io.to('admin-room').emit('admin_newOrder', {
      id: createdOrder.id.toString(),
      restaurant: restaurant.name,
      customer: currentUser.name || 'Customer',
      drop: createdOrder.deliveryAddress,
      totalPrice: createdOrder.totalPrice,
      finalPrice: createdOrder.finalPrice,
      paymentMethod: createdOrder.paymentMethod,
      paymentStatus: createdOrder.paymentStatus,
      createdAt: createdOrder.createdAt,
      ...deliverySlots.slotFields(createdOrder),
    });
    require('../utils/realtime').notifyAdmin('order', 'created', createdOrder.id, { storeId: createdOrder.restaurantId });

    const storeOrderPayload = {
      id: createdOrder.id,
      items: normalizeItems(createdOrder.items),
      totalPrice: createdOrder.totalPrice,
      address: createdOrder.deliveryAddress,
      // Same field names as GET /api/restaurants/:id/orders so the kitchen can render the card at once.
      _id: createdOrder.id,
      status: createdOrder.status,
      createdAt: createdOrder.createdAt,
      finalPrice: createdOrder.finalPrice,
      deliveryFee: createdOrder.deliveryFee,
      paymentMethod: createdOrder.paymentMethod,
      paymentStatus: createdOrder.paymentStatus,
      deliveryAddress: createdOrder.deliveryAddress,
      deliveryInstructions: createdOrder.deliveryInstructions || null,
      estDuration: createdOrder.estDuration || null,
      // Delivery slot: the kitchen gets slot orders at once (to plan) with the slot shown on the card.
      ...deliverySlots.slotFields(createdOrder),
    };

    if (isVendorOrder) {
      // Stall order: ONLY the owning stall's room gets the customer's contact details. Never riders.
      io.to(`restaurant_${restaurant.id}`).emit('restaurant_newOrder', {
        ...storeOrderPayload,
        fulfilment: 'VENDOR',
        customer: {
          name: currentUser.name || 'Customer',
          phone: currentUser.phone || null,
          hostelBlock: currentUser.hostelBlock || null,
          roomNumber: currentUser.roomNumber || null,
        },
      });
      await pushStoreNewOrder(restaurant, createdOrder);
      return;
    }

    if (riderBuys || createdOrder.status === 'Accepted') {
      // Shops without a vendor app go straight to riders.
      io.to('admin-room').emit('newOrder', riderPayload);
      realtime.deliveryRequest(createdOrder.id);
      // Riders with a recent GPS fix first (riders who left the app hours ago go last).
      await pushNearestRiders({
        restaurant,
        orderId: createdOrder.id,
        limit: 20,
        title: riderBuys ? '🛒 Buy & deliver order!' : '🛵 New order ready!',
        body: riderBuys ? `Go to ${restaurant.name}, purchase the items at the counter and deliver.` : `New order from ${restaurant.name} is ready for pickup!`,
      });
    } else {
      // Rider delivers: the kitchen gets the campus label, never the room address (same as the list).
      const { campusLabel, customerFirstName } = require('../utils/publicFields');
      const label = campusLabel(createdOrder.deliveryAddress);
      io.to(`restaurant_${restaurant.id}`).emit('restaurant_newOrder', { ...storeOrderPayload, address: label, deliveryAddress: label, user: { name: customerFirstName(currentUser.name) } });
      await pushStoreNewOrder(restaurant, createdOrder);
    }
  } catch (error) {
    // Once the order row exists the key must keep pointing at it (a retry returns the same order).
    if (idemClaimed && !(recentOrderKeys.get(idemKey) || {}).orderId) recentOrderKeys.delete(idemKey);
    console.error('[ORDER_CREATE_ERROR]', error && (error.stack || error));
    if (!res.headersSent) {
      res.status(500).json({ message: "We couldn't place your order right now. Nothing was charged — please try again in a moment.", code: 'ORDER_FAILED' });
    }
  }
};

// @desc    Restaurant/Admin accepts order & dispatches to Rider
const restaurantAcceptOrder = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    // ── IDOR Protection ──────────────────────
    const isAdmin = req.user && req.user.role && req.user.role.toLowerCase() === 'admin';
    const isVendor = req.user && req.user.role && req.user.role.toLowerCase() === 'restaurant';
    const isOwner = order.restaurantId === req.user.id;
    
    if (!isAdmin && !(isVendor && isOwner)) {
      return res.status(403).json({ message: 'Not authorized to accept this order' });
    }
    if (isVendorFulfilled(order)) {
      req.body = { ...(req.body || {}), status: 'Accepted' };
      return vendorUpdateOrderStatus(req, res, order);
    }

    // A retried / double-tapped accept (the first one landed but the phone lost the reply) is not an
    // error: answer with the order as it is. Only a cancelled order is refused.
    // The refusal says who cancelled: the system timed it out (not accepted in time / no rider), the store itself,
    // or the customer / support (it used to blame the customer for every case).
    const cancelledText = (o) => (o.cancelledBy === 'system'
      ? 'This order was cancelled because it was not accepted in time, so it cannot be accepted now.'
      : o.cancelledBy === 'store'
        ? 'This order was already declined from your store, so it cannot be accepted.'
        : 'This order was cancelled (by the customer or support), so it cannot be accepted.');
    const alreadyAccepted = (o) => (o.status === 'Cancelled'
      ? res.status(400).json({ code: 'ORDER_CANCELLED', message: cancelledText(o) })
      : res.json({ message: 'Order already accepted', orderId: o.id, status: o.status, alreadyAccepted: true }));
    if (order.status !== 'Pending') return alreadyAccepted(order);

    const est = parseInt((req.body || {}).estDuration, 10);
    const acceptFields = { status: 'Accepted', acceptedAt: new Date(), ...(Number.isFinite(est) && est > 0 && est <= 240 ? { estDuration: est } : {}) };
    // Conditional flip: a customer cancel (with Wallet refund) or the auto-cancel job may have
    // won the race since we read the order; never resurrect a cancelled order.
    const [accepted] = await Order.update(acceptFields, { where: { id: order.id, status: 'Pending' } });
    if (accepted === 0) {
      const fresh = await Order.findByPk(order.id, { attributes: ['id', 'status', 'cancelledBy'] });
      if (fresh) return alreadyAccepted(fresh);
      return res.status(404).json({ message: 'Order not found' });
    }
    Object.assign(order, acceptFields);

    const statusPayload = { 
      id: order.id, 
      status: 'Accepted' 
    };
    broadcastOrderStatus(req, order, statusPayload);
    if (!order.deliveryPartnerId) realtime.deliveryRequest(order.id); // live pool for online riders

    // Answer the kitchen first (B28): rider / customer pushes below can take seconds.
    res.json({ message: 'Order picked up/accepted by restaurant', orderId: order.id });

    // Fetch Restaurant to broadcast details to riders
    const Restaurant = getRestaurantModel();
    let restaurant = await Restaurant.findByPk(order.restaurantId);

    // ── Smart Proximity Dispatch ──────────────────────
    try {
      // Notify ALL via socket for real-time race
      const io = req.app.get('io');
      if (io) {
        io.to('admin-room').emit('newOrder', {
          id: order.id,
          restaurant: restaurant ? restaurant.name : 'Unknown',
          restaurantAddress: restaurant ? restaurant.location : '',
          drop: order.deliveryAddress,
          items: normalizeItems(order.items),
          totalPrice: order.totalPrice,
          finalPrice: order.finalPrice,
          earnings: `₹${riderPayout(order)}`,
          distance: order.distance
        });
      }

      // Push the 20 closest riders with a recent GPS fix, plus on-duty riders with no recent position
      // (utils/riderDispatch). Was 5: on a campus fleet the other riders were never told at all.
      await pushNearestRiders({
        restaurant,
        orderId: order.id,
        limit: 20,
        title: '🛵 New Order Ready!',
        body: `${restaurant?.name || 'Restaurant'} is ready for pickup. Closest to you!`,
        data: { distance: order.distance },
      });
    } catch (dispatchErr) {
      console.error('[SMART_DISPATCH_ERROR]', dispatchErr.message);
    }

    // A slot order is delivered in its slot: name the slot, never the kitchen's cooking minutes (the app hides them too).
    const slotWord = order.slotStart && order.slotEnd ? `for ${deliverySlots.rangeLabel(order.slotStart, order.slotEnd)}` : null;
    await pushCustomer(order, 'Order Confirmed! 👍', `${restaurant?.name || 'The store'} accepted your order${slotWord ? ` ${slotWord}` : order.estDuration ? ` (about ${order.estDuration} min)` : ''}.`);
  } catch (error) {
    console.error('[RESTAURANT_ACCEPT_ERROR]', error);
    if (!res.headersSent) res.status(500).json({ message: 'Server error' });
  }
};


// @desc    Get order by ID
// Rider-facing order payloads never carry the customer's delivery PIN.
// S0: bill / item photos / delivery proof are private media; the people who may see the order (customer,
// assigned rider, store, admin) get short-lived signed links in every response / socket payload.
const ORDER_MEDIA_FIELDS = ['proofImage', 'itemPhotoUrl', 'billProofUrl'];
const signOrderMedia = async (req, rows) => {
  const { signMediaFields, ORDER_PURPOSES } = require('../utils/mediaAccess');
  await signMediaFields(req, rows, ORDER_MEDIA_FIELDS, { purposes: ORDER_PURPOSES });
  return rows;
};
const withoutPinSigned = async (req, order) => signOrderMedia(req, withoutPin(order));

const withoutPin = (order) => {
  const json = order && typeof order.toJSON === 'function' ? order.toJSON() : { ...order };
  delete json.deliveryPin;
  delete json.deliveryPinAttempts;
  // UPI proof / payout flags are admin-only (riders, stores and customers get this shape).
  for (const k of ORDER_INTERNAL_FIELDS) delete json[k];
  return json;
};

const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    // Safe check for UUID format to prevent PostgreSQL 500 errors
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    

    if (!uuidRegex.test(id)) {
       return res.status(404).json({ message: 'Invalid Order ID format' });
    }

    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    const order = await Order.findByPk(id, {
      include: [
        { model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'location', 'imageUrl', 'vendorType', 'whatsappNumber', 'fssaiLicenseNumber'] },
        { 
          model: DeliveryPartner, 
          as: 'deliveryPartner', 
          attributes: ['id', 'name', 'phone', 'photoUrl', 'averageRating', 'totalRatings', 'vehicleType', 'vehicleNumber', 'bio', 'isApproved'] 
        }
      ]
    });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // ── IDOR Protection (Access Control Guard) ──────────────────────
    // Ensure the requester is either the owner of the order, an Admin, or the assigned Rider
    const isOwner = order.userId === req.user.id;
    const isAdmin = req.user.role && req.user.role.toLowerCase() === 'admin';
    const isAssignedRider = req.user.role && req.user.role.toLowerCase() === 'rider' && order.deliveryPartnerId === req.user.id;
    
    if (!isOwner && !isAdmin && !isAssignedRider) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to access Order ${id} without permission.`);
      return res.status(403).json({ message: 'Access denied: You do not have permission to view this order.' });
    }

    const orderData = order.toJSON();
    delete orderData.deliveryPinAttempts;
    if (!isAdmin) for (const k of ORDER_INTERNAL_FIELDS) delete orderData[k];
    // The delivery PIN is the customer's secret: the rider asks for it at the door.
    if (!isOwner && !isAdmin) delete orderData.deliveryPin;
    // Map associations for legacy frontend compatibility (+ _id)
    if (orderData.deliveryPartner) {
        orderData.deliveryPartner._id = orderData.deliveryPartner.id;
        // Real track record only: no rating until someone has rated this rider.
        if (!(Number(orderData.deliveryPartner.totalRatings) > 0)) orderData.deliveryPartner.averageRating = null;
        orderData.deliveryPartner.completedDeliveries = await Order.count({
          where: { deliveryPartnerId: order.deliveryPartnerId, status: 'Delivered' }
        });
    }

    
    // ── Rider Batching Transparency ──────────────────────
    if (order.deliveryPartnerId) {
      const otherOrders = await Order.count({
        where: {
          deliveryPartnerId: order.deliveryPartnerId,
          status: { [Op.notIn]: ['Delivered', 'Cancelled'] },
          id: { [Op.ne]: order.id }
        }
      });
      orderData.riderOtherOrders = otherOrders;
    }

    orderData.storeAcceptBy = storeAcceptBy(orderData);
    await signOrderMedia(req, orderData);
    res.json({ ...orderData, _id: order.id });
  } catch (error) {
    console.error('[GET_ORDER_ERROR]', error);
    res.status(500).json({ message: 'We could not load this order right now. Please try again.' });
  }
};

// Fields the customer app reads from GET /api/orders/myorders (orders tab, checkout duplicate
// guard via idempotencyKey, review-store picker). Everything else stays server-side.
const MY_ORDER_FIELDS = [
  'id', 'restaurantId', 'restaurant', 'items', 'totalPrice', 'deliveryFee', 'batchDiscount', 'gateDiscount',
  'finalPrice', 'priceBreakdown', 'status', 'cancellationReason', 'paymentStatus', 'paymentMethod',
  'deliverySlot', 'deliveryAddress', 'deliveryInstructions', 'distance', 'deliveredAt', 'estDuration',
  'acceptedAt', 'readyAt', 'fulfilment', 'outForDeliveryAt', 'idempotencyKey', 'dropLat', 'dropLng',
  'isSurge', 'hostelGateDelivery', 'rating', 'review', 'deliveryPin', 'refundedAt',
  'isPurchasingApprovedByCustomer', 'itemPhotoUrl', 'billProofUrl', 'billAmount', 'isBillApproved',
  'category', 'isMultiRestaurant', 'createdAt', 'updatedAt', 'receiptNumber',
  // Delivery slot window (utils/deliverySlots); deliverySlot above holds its label.
  'slotStart', 'slotEnd',
];
// When the store must have accepted a Pending order (slot orders: counted from an hour before the slot,
// so a night order for tomorrow is not cancelled at night). Null once the order is past Pending.
const storeAcceptBy = (o) => {
  if (!o || o.status !== 'Pending') return null;
  const t = deliverySlots.acceptAnchorMs(o) + storeAcceptTimeoutMinutes() * 60 * 1000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
// Never sent to the customer / rider on the single-order view either (admin only).
const ORDER_INTERNAL_FIELDS = ['deliveryPinAttempts', 'upiUTR', 'upiScreenshot', 'upiStatus', 'payoutSettled', 'riderPayoutSettled',
  // C6 settlement internals (commission snapshot, payout statements).
  'commissionRate', 'commissionType', 'commissionAmountPaise', 'storeNetPaise', 'commissionSource', 'payoutId', 'riderPayoutId',
  // C8: the frozen issuer details (served through GET /api/orders/:id/receipt instead).
  'receiptSnapshot'];
// One row of the customer's order list (whitelist: MY_ORDER_FIELDS).
function customerOrderJson(o) {
  const json = o && typeof o.toJSON === 'function' ? o.toJSON() : { ...(o || {}) };
  const out = {};
  for (const k of MY_ORDER_FIELDS) if (json[k] !== undefined) out[k] = json[k];
  return {
    ...out,
    _id: json.id,
    storeAcceptBy: storeAcceptBy(json),
    restaurantName: json.restaurant ? json.restaurant.name : null,
    restaurantImage: json.restaurant ? json.restaurant.imageUrl : null
  };
}
// The customer's own order (create / duplicate replies): keeps the PIN, drops the internals.
function ownerOrderJson(order) {
  const j = order && typeof order.toJSON === 'function' ? order.toJSON() : { ...(order || {}) };
  for (const k of ORDER_INTERNAL_FIELDS) delete j[k];
  j.storeAcceptBy = storeAcceptBy(j);
  return j;
}

// @desc    Get logged in user orders
const getMyOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    // Optional ?before= / ?limit= / ?q= (utils/myOrdersQuery); none of them = the newest 50 as before.
    const { parseMyOrdersQuery, buildMyOrdersWhere } = require('../utils/myOrdersQuery');
    const { limit, before, q } = parseMyOrdersQuery(req.query);
    const orders = await Order.findAll({
      where: await buildMyOrdersWhere({ userId: req.user.id, before, q, Restaurant }),
      attributes: { exclude: ['upiScreenshot'] }, // never sent to the customer (customerOrderJson drops it)
      include: [{ model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'imageUrl', 'vendorType'] }],
      order: [['createdAt', 'DESC']],
      limit,
    });
    // Customer-facing fields only: PIN attempt counters, UPI proof, payout flags, rider id and
    // pickup internals stayed in this list before.
    res.json(await signOrderMedia(req, orders.map(customerOrderJson)));
  } catch (error) {
    console.error('[MY_ORDERS_ERROR]', error);
    res.status(500).json({ message: 'We could not load your orders right now. Please pull to refresh.' });
  }
};

const MAX_TIP = 500;

// @desc    Rate an order (once), optionally tip the rider from the Wallet
// @route   PUT /api/orders/:id/rate
const walletTipsEnabled = () => /^(1|true|yes|on)$/i.test(String(process.env.WALLET_TIPS_ENABLED || '').trim());

const rateOrder = async (req, res) => {
  const { rating: rawRating, review: rawReview, tipAmount } = req.body || {};
  try {
    const rating = Number(rawRating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Please pick a rating from 1 to 5 stars.', code: 'INVALID_RATING' });
    }
    const tipRaw = tipAmount === undefined || tipAmount === null || tipAmount === '' ? 0 : Number(tipAmount);
    // Rupees and paise only (B24): 10.005 would leave fractions of a paisa in both wallets.
    const tip = Number.isFinite(tipRaw) ? money(tipRaw) : tipRaw;
    if (!Number.isFinite(tip) || tip < 0 || tip > MAX_TIP) {
      return res.status(400).json({ message: `Tips can be from ₹0 to ₹${MAX_TIP}.`, code: 'INVALID_TIP' });
    }
    const review = typeof rawReview === 'string' && rawReview.trim() ? rawReview.trim().replace(/[<>]/g, '').slice(0, 1000) : null;

    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ message: 'Not authorized' });
    if (order.status !== 'Delivered') return res.status(400).json({ message: 'You can rate an order once it has been delivered.', code: 'NOT_DELIVERED' });

    // Rate exactly once: only the request that flips rating from NULL wins (no points farming).
    const [rated] = await Order.update(
      { rating, review },
      { where: { id: order.id, userId: req.user.id, status: 'Delivered', rating: null } }
    );
    if (rated === 0) {
      return res.status(409).json({ message: 'You have already rated this order. Thank you!', code: 'ALREADY_RATED' });
    }

    const User = getUserModel();
    const user = await User.findByPk(req.user.id);

    // ── Reviews for the ordered items (real text only; nothing invented) ──
    try {
      const { getProductReviewModel } = require('../models/ProductReview');
      const ProductReview = getProductReviewModel();
      const MenuItem = getMenuItemModel();
      const firstName = user && user.name ? String(user.name).trim().split(/\s+/)[0] : 'ZenWe customer';
      const seen = new Set();
      for (const item of normalizeItems(order.items)) {
        const pId = item.menuItemId || item.id || item._id;
        if (!pId || seen.has(String(pId)) || item.isAddOn) continue;
        seen.add(String(pId));
        // One review per (user, product) (B25): a later order of the same item updates that review.
        const prior = await ProductReview.findOne({ where: { productId: String(pId), userId: String(req.user.id) } });
        if (prior) {
          await prior.update({ rating, comment: review, orderId: String(order.id), verified: true });
        } else await ProductReview.create({
          productId: String(pId),
          productName: item.name || null,
          orderId: String(order.id),
          userId: String(req.user.id),
          userName: firstName,
          userBlock: null,
          rating,
          comment: review,
          verified: true, // tied to this delivered order
          helpfulCount: 0
        }).catch(async (e) => {
          if (!e || e.name !== 'SequelizeUniqueConstraintError') throw e;
          await ProductReview.update({ rating, comment: review, orderId: String(order.id) }, { where: { productId: String(pId), userId: String(req.user.id) } });
        });
        // Item rating = average of its real reviews.
        if (MenuItem && /^[0-9a-f-]{36}$/i.test(String(pId))) {
          const menuItem = await MenuItem.findByPk(String(pId));
          if (menuItem) {
            const [agg] = await ProductReview.findAll({
              where: { productId: String(pId) },
              attributes: [
                [ProductReview.sequelize.fn('AVG', ProductReview.sequelize.col('rating')), 'avg'],
                [ProductReview.sequelize.fn('COUNT', ProductReview.sequelize.col('id')), 'count']
              ],
              raw: true
            });
            const count = Number(agg && agg.count) || 0;
            const avg = count ? parseFloat(Number(agg.avg).toFixed(1)) : null;
            menuItem.specs = { ...(menuItem.specs || {}), rating: avg, ratingCount: count };
            await menuItem.save();
          }
        }
      }
    } catch (revPropErr) {
      console.warn('[REVIEW_PROPAGATION_WARN]', revPropErr.message);
    }

    // ── +10 ZenPoints for rating (once per order, guaranteed by the update above) ──
    // Stall orders follow the same daily loyalty cap as their delivery credit.
    let zenPointsEarned = 0;
    try {
      if (await stallLoyaltyAllowed(order)) {
        await User.increment('zenPoints', { by: 10, where: { id: req.user.id } });
        zenPointsEarned = 10; // only what was really credited (B24)
      }
    } catch (zpErr) {
      console.warn('[RATING_ZP] ZenPoints award skipped:', zpErr.message);
    }

    // ── Rider rating + optional tip ──
    let tipApplied = false;
    let tipError = null;
    if (order.deliveryPartnerId) {
      const DeliveryPartner = getDeliveryPartnerModel();
      const partner = await DeliveryPartner.findByPk(order.deliveryPartnerId);
      if (partner) {
        // One atomic UPDATE (B24): two ratings landing together both count (was read-modify-write).
        // Both right-hand sides read the row's old values (standard SQL, Postgres and SQLite).
        await DeliveryPartner.update({
          averageRating: DeliveryPartner.sequelize.literal(
            `ROUND(CAST(((CASE WHEN COALESCE("totalRatings", 0) > 0 THEN COALESCE("averageRating", 0) ELSE 0 END) * COALESCE("totalRatings", 0) + ${rating}) * 1.0 / (COALESCE("totalRatings", 0) + 1) AS NUMERIC), 1)`),
          totalRatings: DeliveryPartner.sequelize.literal('COALESCE("totalRatings", 0) + 1'),
        }, { where: { id: partner.id } });

        // Owner (20 Oct 2026): tips are cash only, paid to the rider by hand. Wallet tips move wallet money
        // to a person, which the non-transferable wallet rule does not allow. WALLET_TIPS_ENABLED=true restores them.
        if (tip > 0 && !walletTipsEnabled()) {
          tipError = 'Tips are paid in cash to your rider. Nothing was taken from your ZenWe Wallet.';
        } else if (tip > 0) {
          try {
            const { getSequelize } = require('../config/db');
            const sequelize = getSequelize();
            await sequelize.transaction(MONEY_TX, async (t) => {
              // C5: customer debit (TIP_SENT) + rider credit (TIP_RECEIVED), both recorded, all or nothing.
              const tipPaise = walletLedger.toPaise(tip);
              try {
                await walletLedger.applyWalletChange({
                  t, ownerType: 'user', ownerId: req.user.id, amountPaise: -tipPaise, type: walletLedger.TYPES.TIP_SENT,
                  ref: { type: 'ORDER', id: order.id }, actor: { type: 'user', id: req.user.id }, idempotencyKey: `tip:${order.id}`,
                });
              } catch (e) {
                if (!walletLedger.isInsufficient(e)) throw e;
                const err = new Error(`Not enough Wallet balance for a ₹${tip} tip.`);
                err.userFacing = true;
                throw err;
              }
              await walletLedger.applyWalletChange({
                t, ownerType: 'rider', ownerId: partner.id, amountPaise: tipPaise, type: walletLedger.TYPES.TIP_RECEIVED,
                ref: { type: 'ORDER', id: order.id }, actor: { type: 'user', id: req.user.id }, idempotencyKey: `tip:${order.id}`,
              });
            });
            tipApplied = true;
            const io = req.app.get('io');
            if (io) {
              io.to(`rider_${partner.id}`).emit('rider_tip_received', {
                amount: tip,
                from: user && user.name ? String(user.name).split(' ')[0] : 'A customer',
                orderId: order.id
              });
            }
          } catch (tipErr) {
            tipError = tipErr.userFacing ? tipErr.message : 'Your tip could not be sent. You were not charged.';
            console.warn('[TIP_ERROR]', tipErr.message);
          }
        }
      }
    } else if (tip > 0) {
      tipError = 'No rider was assigned to this order, so no tip was sent.';
    }

    res.json({
      message: tipApplied ? `Thanks for rating. Your ₹${tip} tip is on its way to your rider.` : 'Thanks for rating.',
      rating,
      zenPointsEarned,
      tipApplied,
      tipAmount: tipApplied ? tip : 0,
      tipError
    });
  } catch (error) {
    console.error('[RATE_ORDER_ERROR]', error);
    res.status(500).json({ message: 'We could not save your rating. Please try again.' });
  }
};

// @desc    Get all orders (Admin)
const getAllOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();
    const { status } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const where = {};
    if (status && status !== 'All') where.status = status;
    // ?restaurantId=<uuid>&from=<ISO>&to=<ISO>&fulfilment=VENDOR|ZENVY
    if (req.query.restaurantId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.query.restaurantId))) {
        return res.json({ orders: [], total: 0, pages: 0 });
      }
      where.restaurantId = String(req.query.restaurantId);
    }
    // ?userId=<uuid>: one customer's orders (admin Customers -> a customer -> Orders).
    if (req.query.userId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.query.userId))) {
        return res.json({ orders: [], total: 0, pages: 0 });
      }
      where.userId = String(req.query.userId);
    }
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return res.status(400).json({ message: "'from' and 'to' must be dates (ISO format)." });
    }
    if (from || to) where.createdAt = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lt]: to } : {}) };
    if (req.query.fulfilment === 'VENDOR') where.fulfilment = 'VENDOR';
    else if (req.query.fulfilment === 'ZENVY') where[Op.and] = [{ [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] }];
    // ?stuckHours=N: stall orders still Accepted / OutForDelivery N+ hours after they were placed.
    if (req.query.stuckHours !== undefined) {
      const hours = Number(req.query.stuckHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 72) {
        return res.status(400).json({ message: "'stuckHours' must be a number of hours between 1 and 72." });
      }
      const stuck = require('../utils/stallStuckJob').stuckStallWhere(hours);
      where.fulfilment = stuck.fulfilment;
      if (status && status !== 'All' && !require('../utils/stallStuckJob').STUCK_STATUSES.includes(status)) {
        return res.json({ orders: [], total: 0, pages: 0 });
      }
      if (!status || status === 'All') where.status = stuck.status;
      where.createdAt = { ...(where.createdAt || {}), ...stuck.createdAt };
      delete where[Op.and];
    }
    // ?q=<order id> (admin global search): the full id, or the short reference the admin and the apps
    // show (#A1B2C3 = the id's last characters). Only hex digits and dashes, 4-36 characters; anything
    // else matches nothing. Combines with the other filters.
    if (req.query.q !== undefined && String(req.query.q).trim() !== '') {
      const q = String(req.query.q).trim().replace(/^#/, '').toLowerCase();
      if (!/^[0-9a-f-]{4,36}$/.test(q)) return res.json({ orders: [], total: 0, pages: 0 });
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(q)) {
        where.id = q;
      } else {
        const { where: sqlWhere, cast, col } = require('sequelize');
        // Postgres stores ids as uuid: compare their text form. SQLite already stores text.
        const idText = Order.sequelize.getDialect() === 'postgres' ? cast(col('Order.id'), 'text') : col('Order.id');
        where[Op.and] = [...(where[Op.and] || []), sqlWhere(idText, { [Op.like]: `%${q}` })];
      }
    }

    const { count, rows: orders } = await Order.findAndCountAll({ 
      where,
      // The customer's handover PIN is never shown to admins; legacy inline base64 photos are
      // returned as null (media URLs pass through) so a 500-row page stays small.
      attributes: {
        exclude: ['deliveryPin', 'proofImage', 'itemPhotoUrl', 'billProofUrl', 'upiScreenshot'],
        include: require('../utils/imageStore').dataUrlSafeColumns('Order', ['proofImage', 'itemPhotoUrl', 'billProofUrl']),
      },
      order: [['createdAt', 'DESC']], 
      limit,
      offset,
      include: [
        { model: User, as: 'user', attributes: ['name', 'phone'] },
        { model: Restaurant, as: 'restaurant', attributes: ['id', 'name', 'vendorType', 'whatsappNumber'] }, // admin only: stall contact for VENDOR orders
        // The rider on the order (support answers "where is my order" with the rider's name and phone).
        ...(Order.associations && Order.associations.deliveryPartner
          ? [{ model: Order.associations.deliveryPartner.target, as: 'deliveryPartner', attributes: ['id', 'name', 'phone', 'isOnline'], required: false }]
          : []),
      ]
    });

    res.json({
      orders: orders.map(o => {
        const oJson = o.toJSON();
        return { 
          ...oJson, 
          _id: o.id, 
          userId: oJson.userId || oJson.user?.id || oJson.user,
          user: oJson.user
        };
      }),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    sendServerError(res, error, '[ORDERCONTROLLER_ERROR]');
  }
};

// @desc    Cancel an order
// @route   PUT /api/orders/:id/cancel
// Cancels an order and refunds it exactly once (Wallet amount back, coupon restored).
// `onlyFromStatuses` limits the cancel to orders still in one of those statuses (used by the auto-cancel job).
// Returns { cancelled, refunded }.
const cancelAndRefund = async (order, { reason = null, onlyFromStatuses = null, requireUnclaimed = false, extraWhere = null, by = null } = {}) => {
  const Order = getOrderModel();
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  let refunded = 0;

  // Status flip + refund in one transaction. The conditional update means two parallel
  // cancels can never both pass, so the Wallet is refunded exactly once.
  let riderId = order.deliveryPartnerId || null;
  const cancelled = await sequelize.transaction(MONEY_TX, async (t) => {
    // Lock and re-read the row: the refund must use the price at cancel time (a bill approval
    // may have changed finalPrice after the caller loaded `order`).
    const fresh = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!fresh) return false;
    riderId = fresh.deliveryPartnerId || null; // a claim may have landed after the caller read the order
    const statusWhere = Array.isArray(onlyFromStatuses)
      ? { [Op.in]: onlyFromStatuses }
      : { [Op.notIn]: ['Cancelled', 'Delivered'] };
    const [n] = await Order.update(
      { status: 'Cancelled', ...(reason ? { cancellationReason: reason } : {}), ...(by ? { cancelledBy: by } : {}) },
      { where: { id: order.id, status: statusWhere, ...(requireUnclaimed ? { deliveryPartnerId: null } : {}), ...(extraWhere ? { [Op.and]: [extraWhere] } : {}) }, transaction: t }
    );
    if (n === 0) return false;
    if (fresh.paymentMethod === 'Wallet') {
      const amount = money(fresh.finalPrice != null ? fresh.finalPrice : fresh.totalPrice);
      if (amount > 0) {
        // C5: credit + ORDER_REFUND row in this transaction (the status flip above makes it exactly once).
        await walletLedger.applyWalletChange({
          t, ownerType: 'user', ownerId: order.userId, amountPaise: walletLedger.toPaise(amount), type: walletLedger.TYPES.ORDER_REFUND,
          ref: { type: 'ORDER', id: order.id }, actor: { type: 'system', id: null },
          reason: reason ? String(reason).slice(0, 200) : null, idempotencyKey: `order-refund:${order.id}`,
        });
        refunded = amount;
      }
    }
    // Give back a coupon that was used on this order (if it has not expired).
    let breakdown = fresh.priceBreakdown;
    if (typeof breakdown === 'string') { try { breakdown = JSON.parse(breakdown); } catch { breakdown = null; } }
    if (breakdown && breakdown.couponCode) {
      const { getCouponModel } = require('../models/Coupon');
      await getCouponModel().update(
        { isUsed: false },
        { where: { code: breakdown.couponCode, userId: order.userId, isUsed: true, [Op.or]: [{ expiryDate: null }, { expiryDate: { [Op.gt]: new Date() } }] }, transaction: t }
      );
    }
    return true;
  });
  // Callers notify / free the rider that really holds the order now, not the one they read earlier.
  if (cancelled) order.deliveryPartnerId = riderId;
  // An unclaimed order leaves every online rider's pool (ids only; harmless if it was never listed).
  if (cancelled && !riderId && !isVendorFulfilled(order)) realtime.deliveryRequestGone(order.id);
  if (cancelled && riderId) await refreshRiderCurrentOrder(riderId);
  if (cancelled && refunded > 0) console.log(`[REFUND] ₹${refunded} refunded to wallet for user ${order.userId} (order ${order.id})`);
  return { cancelled, refunded };
};

// Orders nobody moves forward are cancelled (and Wallet-refunded) automatically, so a customer is
// never left waiting (orders-n12). Runs from jobs/index.js every 2 minutes. Two cases, rider never set:
//  • 'Pending' for STORE_ACCEPT_TIMEOUT_MIN (default 7; the older PENDING_ORDER_TIMEOUT_MINUTES is still
//    read when the new one is not set): the store never accepted it.
//  • 'Accepted'/'Preparing'/'ReadyForPickup' for UNCLAIMED_ORDER_TIMEOUT_MINUTES (default 30) since
//    acceptance: no rider claimed it. App-less (catalogue) stores start orders at 'Accepted', so
//    without this an unclaimed order waited forever with the Wallet already debited.
const { storeAcceptTimeoutMinutes } = require('../utils/orderTimeouts');
const UNCLAIMED_TIMEOUT_MINUTES = Math.max(10, parseInt(process.env.UNCLAIMED_ORDER_TIMEOUT_MINUTES, 10) || 30);
const UNCLAIMED_STATUSES = ['Accepted', 'Preparing', 'ReadyForPickup'];
const STORE_TIMEOUT_TEXT = "The store didn't respond, so your order was cancelled.";
// The "no rider" clock starts when the food can actually go: the later of acceptance + the store's own prep
// estimate (capped at 4 h) and the moment it was marked ready. A 40-minute dish used to be cancelled and
// refunded at 30 minutes while it was still cooking, because riders wait until an order is nearly ready.
const unclaimedClockStart = (o) => {
  const accepted = o.acceptedAt ? new Date(o.acceptedAt).getTime() : new Date(o.createdAt).getTime();
  const prepMin = Math.min(240, Math.max(0, Number(o.estDuration) || 0));
  const ready = o.readyAt ? new Date(o.readyAt).getTime() : 0;
  return Math.max(accepted + prepMin * 60 * 1000, ready);
};

// Unclaimed orders are pushed again, wider each time, before the "no rider" cancel: the first push reached
// only the best-placed riders, the socket event only riders whose app was open, and nothing ever retried,
// so an order the first riders ignored reached nobody else and cancelled itself (riders "not getting"
// orders). Rounds by minutes since the order became claimable; the last one also alerts the admins.
const ESCALATION_ROUNDS = [
  { atMin: 4, limit: 30, title: '🛵 Order still waiting for a rider' },
  { atMin: 10, limit: 100, title: '🛵 Order waiting: pick it up?' },
  { atMin: 18, limit: 100, title: '⏰ Order about to be cancelled', alertAdmins: true },
];
const escalated = new Map(); // orderId -> rounds already sent (a restart re-sends at most the current one)
const escalateUnclaimedOrders = async (io) => {
  const Order = getOrderModel();
  const since = new Date(Date.now() - ESCALATION_ROUNDS[0].atMin * 60 * 1000);
  const rows = await Order.findAll({
    where: {
      status: { [Op.in]: UNCLAIMED_STATUSES },
      deliveryPartnerId: null,
      [Op.and]: [
        { [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] },
        { [Op.or]: [{ acceptedAt: null }, { acceptedAt: { [Op.lt]: since } }] },
        { createdAt: { [Op.lt]: since } },
      ],
    },
    attributes: ['id', 'restaurantId', 'acceptedAt', 'createdAt', 'readyAt', 'estDuration', 'slotStart', 'distance'],
    order: [['createdAt', 'ASC']],
    limit: 100,
  });
  const live = new Set(rows.map((o) => String(o.id)));
  for (const id of escalated.keys()) if (!live.has(id)) escalated.delete(id);
  let sent = 0;
  for (const order of rows) {
    try {
      if (!deliverySlots.isDispatchDue(order)) continue;
      // Minutes since riders could first see it (a slot order: since its dispatch window opened).
      const opens = deliverySlots.dispatchOpensAt(order);
      const from = Math.max(order.acceptedAt ? new Date(order.acceptedAt).getTime() : new Date(order.createdAt).getTime(), opens ? opens.getTime() : 0);
      const ageMin = (Date.now() - from) / 60000;
      const done = escalated.get(String(order.id)) || 0;
      let due = 0;
      ESCALATION_ROUNDS.forEach((r, i) => { if (ageMin >= r.atMin) due = i + 1; });
      if (due <= done) continue;
      escalated.set(String(order.id), due);
      const round = ESCALATION_ROUNDS[due - 1];
      const restaurant = await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name', 'location', 'lat', 'lon'] });
      realtime.deliveryRequest(order.id); // riders with the app open see it come back to the top
      await pushNearestRiders({
        restaurant,
        orderId: order.id,
        limit: round.limit,
        title: round.title,
        body: `${restaurant?.name || 'A store'} has an order nobody has picked up yet. Tap to take it.`,
        data: { distance: order.distance, escalation: String(due) },
      });
      if (round.alertAdmins) {
        require('../utils/adminAlert').pushAdmins(
          'No rider for an order',
          `${restaurant?.name || 'A store'}: order ${String(order.id).slice(-6)} has had no rider for ${Math.round(ageMin)} min. Assign one before it cancels.`,
          { orderId: String(order.id), type: 'NO_RIDER' },
          { io }
        ).catch(() => {});
      }
      sent++;
    } catch (e) {
      console.warn('[RIDER_ESCALATION_WARN]', order.id, e.message);
    }
  }
  if (sent) console.log(`[RIDER_ESCALATION] Re-pushed ${sent} unclaimed order(s)`);
  return sent;
};

const autoCancelStalePendingOrders = async (io) => {
  const Order = getOrderModel();
  const PENDING_TIMEOUT_MINUTES = storeAcceptTimeoutMinutes();
  const pendingCutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);
  const unclaimedCutoff = new Date(Date.now() - UNCLAIMED_TIMEOUT_MINUTES * 60 * 1000);
  // Delivery slots: a Pending slot order's clock starts an hour before its slot (or when placed, if later), so
  // a night order for tomorrow waits for the kitchen to open; an unclaimed slot order is cancelled only once
  // its slot started SLOT_UNCLAIMED_GRACE_MIN ago (riders see it from DISPATCH_WINDOW_MIN before the start).
  const stalePending = await Order.findAll({
    where: { status: 'Pending', deliveryPartnerId: null, ...deliverySlots.acceptAnchorBeforeWhere(pendingCutoff) },
    order: [['createdAt', 'ASC']],
    limit: 50,
  });
  const staleUnclaimed = await Order.findAll({
    where: {
      status: { [Op.in]: UNCLAIMED_STATUSES },
      deliveryPartnerId: null,
      // Stall orders are delivered by the stall itself: never "no rider" cancelled.
      createdAt: { [Op.lt]: unclaimedCutoff },
      [Op.and]: [
        { [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] },
        { [Op.or]: [{ acceptedAt: null }, { acceptedAt: { [Op.lt]: unclaimedCutoff } }] },
        deliverySlots.slotGracePassedWhere(new Date()),
      ],
    },
    order: [['createdAt', 'ASC']],
    limit: 200,
  }).then((rows) => rows.filter((o) => Date.now() - unclaimedClockStart(o) >= UNCLAIMED_TIMEOUT_MINUTES * 60 * 1000).slice(0, 50));
  const jobs = [
    ...stalePending.map((order) => ({ order, from: ['Pending'], code: 'STORE_TIMEOUT', why: 'The store did not accept the order in time', text: STORE_TIMEOUT_TEXT })),
    ...staleUnclaimed.map((order) => ({ order, from: UNCLAIMED_STATUSES, code: 'NO_RIDER_TIMEOUT', why: 'No delivery partner was available in time', text: 'No delivery partner could pick up your order in time.' })),
  ];
  let count = 0;
  for (const { order, from, code, why, text } of jobs) {
    try {
      // onlyFromStatuses + rider check inside the conditional update: a rider claim that lands now wins.
      const { cancelled, refunded } = await cancelAndRefund(order, { reason: why, onlyFromStatuses: from, requireUnclaimed: true, by: 'system' });
      if (!cancelled) continue;
      count++;
      const payload = { id: order.id, status: 'Cancelled', reason: code, refundedToWallet: refunded };
      if (io) {
        io.to(String(order.id)).emit('statusUpdated', payload);
        io.to('admin-room').emit('statusUpdated', payload);
        if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', payload);
        if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('orderCancelled', { orderId: order.id, reason: code });
        io.to(String(order.id)).emit('orderCancelled', { orderId: order.id, reason: code });
        io.to('admin-room').emit('orderCancelled', { orderId: order.id, reason: code });
      }
      try {
        const customer = await getUserModel().findByPk(order.userId, { attributes: ['id', 'fcmTokens'] });
        if (customer) {
          await sendPushToTokens(
            customer.fcmTokens,
            code === 'STORE_TIMEOUT' ? "The store didn't respond" : 'Order cancelled',
            refunded > 0
              ? `${text} ₹${refunded} is back in your Wallet.`
              : `${text} Nothing was charged.`,
            { orderId: order.id, type: 'ORDER_UPDATE' },
            { recipients: [customer.id] }
          );
        }
      } catch (pushErr) {
        console.warn('[AUTO_CANCEL_PUSH_WARN]', pushErr.message);
      }
      if (order.restaurantId) pushStoreCancelled(order.restaurantId, order, code === 'STORE_TIMEOUT' ? 'An order was cancelled because it was not accepted in time.' : 'An order was cancelled: no delivery partner was available.');
    } catch (e) {
      console.error('[AUTO_CANCEL_ERROR]', order.id, e.message);
    }
  }
  if (count) console.log(`[AUTO_CANCEL] Cancelled ${count} stale order(s) (store ${PENDING_TIMEOUT_MINUTES} min / rider ${UNCLAIMED_TIMEOUT_MINUTES} min)`);
  return count;
};

// C1-5: a rider claimed the order but never picked it up. Once the store has marked it ready
// (readyAt) and RIDER_PICKUP_TIMEOUT_MIN (default 20) have passed with no change to the order since
// (updatedAt: the claim itself also writes the row, so a late claim gets the full window), the rider
// is taken off it and it goes back to the rider pool through the same code as an admin "Remove rider"
// (adminController.releaseOrderRider: sockets, pool, nearest-rider pushes). Admins are pushed; the
// rider has no counter column, so it is logged per rider. 'Picking' (rider at the counter) is left
// alone. Runs inside the 'orders.autoCancel' job (single runner); the conditional release makes a
// repeat or a pickup that lands meanwhile a no-op.
const RIDER_PICKUP_TIMEOUT_MIN = () => Math.max(5, parseInt(process.env.RIDER_PICKUP_TIMEOUT_MIN, 10) || 20);
const PICKUP_WAIT_STATUSES = ['Accepted', 'Preparing', 'ReadyForPickup'];
const releaseStalledRiderClaims = async (io) => {
  const Order = getOrderModel();
  const minutes = RIDER_PICKUP_TIMEOUT_MIN();
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const stalled = await Order.findAll({
    where: {
      status: { [Op.in]: PICKUP_WAIT_STATUSES },
      deliveryPartnerId: { [Op.ne]: null },
      readyAt: { [Op.ne]: null, [Op.lt]: cutoff },
      updatedAt: { [Op.lt]: cutoff },
      [Op.and]: [{ [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] }],
    },
    order: [['readyAt', 'ASC']],
    limit: 50,
  });
  if (!stalled.length) return 0;
  const { releaseOrderRider } = require('./adminController');
  const released = [];
  for (const order of stalled) {
    const riderId = order.deliveryPartnerId;
    try {
      const ok = await releaseOrderRider(order, {
        io,
        reason: `Rider did not pick up within ${minutes} min of the order being ready`,
        extraWhere: { readyAt: { [Op.lt]: cutoff }, updatedAt: { [Op.lt]: cutoff } },
      });
      if (!ok) continue;
      released.push({ order, riderId });
      console.warn(`[RIDER_PICKUP_TIMEOUT] rider ${riderId} released order ${order.id} (ready ${minutes}+ min, not picked up)`);
      try {
        if (io) io.to(`rider_${riderId}`).emit('orderReleased', { orderId: order.id, reason: 'PICKUP_TIMEOUT' });
        const rider = await getDeliveryPartnerModel().findByPk(riderId, { attributes: ['id', 'fcmTokens'] });
        const tokens = (rider && Array.isArray(rider.fcmTokens) ? rider.fcmTokens : []).map((t) => (typeof t === 'string' ? t : t && t.token)).filter(Boolean);
        if (tokens.length) {
          await sendPushToTokens(tokens, 'Order released', `You did not pick up an order within ${minutes} minutes of it being ready, so it went back to other riders.`, { orderId: String(order.id), type: 'ORDER_RELEASED' }, { persist: false });
        }
      } catch (pushErr) {
        console.warn('[RIDER_PICKUP_TIMEOUT_PUSH_WARN]', pushErr.message);
      }
    } catch (e) {
      console.error('[RIDER_PICKUP_TIMEOUT_ERROR]', order.id, e.message);
    }
  }
  if (released.length) {
    const perRider = released.reduce((m, r) => m.set(r.riderId, (m.get(r.riderId) || 0) + 1), new Map());
    for (const [rid, n] of perRider) console.warn(`[RIDER_PICKUP_TIMEOUT] rider ${rid}: ${n} order(s) released this run`);
    await require('../utils/adminAlert').pushAdmins(
      '⏱️ Rider did not pick up',
      released.length === 1
        ? `An order waited ${minutes}+ min at the store after it was ready; the rider was removed and it is back in the rider pool.`
        : `${released.length} orders waited ${minutes}+ min at the store after they were ready; the riders were removed and they are back in the rider pool.`,
      { type: 'RIDER_PICKUP_TIMEOUT', orderId: String(released[0].order.id) },
      { io }
    );
  }
  return released.length;
};

// Delivery slots: a slot order that became claimable before its rider window (DISPATCH_WINDOW_MIN before the
// slot start) was held back from riders (utils/realtime.deliveryRequest and pushNearestRiders skip it, and the
// pool / claim filter it out). Runs every minute ('orders.slotDispatch', single runner): once the window opens
// the order is marked (slotDispatchedAt, conditional, so a repeat or a second process never pushes twice) and
// the riders are told (live pool event + nearest-rider push). Orders that became claimable inside the window
// were dispatched on the spot (store accept / admin): those are only marked.
const SLOT_DISPATCH_STATUSES = ['Accepted', 'Preparing', 'ReadyForPickup'];
const releaseDueSlotOrders = async ({ now = deliverySlots.now() } = {}) => {
  const Order = getOrderModel();
  if (!Order) return { released: 0, marked: 0 };
  const at = new Date(now);
  const due = await Order.findAll({
    where: {
      status: { [Op.in]: SLOT_DISPATCH_STATUSES },
      deliveryPartnerId: null,
      slotDispatchedAt: null,
      slotStart: {
        [Op.ne]: null,
        [Op.lte]: new Date(at.getTime() + deliverySlots.DISPATCH_WINDOW_MIN * 60 * 1000),
        [Op.gt]: new Date(at.getTime() - 6 * 60 * 60 * 1000),
      },
      [Op.and]: [{ [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] }],
    },
    attributes: ['id', 'restaurantId', 'slotStart', 'acceptedAt', 'createdAt', 'distance', 'deliverySlot'],
    order: [['slotStart', 'ASC']],
    limit: 100,
  });
  let released = 0;
  let marked = 0;
  for (const order of due) {
    const [n] = await Order.update({ slotDispatchedAt: at }, { where: { id: order.id, slotDispatchedAt: null, deliveryPartnerId: null }, silent: true });
    if (!n) continue;
    const opensAt = deliverySlots.dispatchOpensAt(order).getTime();
    const claimableSince = new Date(order.acceptedAt || order.createdAt).getTime();
    if (Number.isFinite(claimableSince) && claimableSince >= opensAt) { marked++; continue; } // dispatched on the spot
    released++;
    realtime.deliveryRequest(order.id);
    try {
      const restaurant = await getRestaurantModel().findByPk(order.restaurantId);
      await pushNearestRiders({
        restaurant,
        orderId: order.id,
        limit: 5,
        title: '🛵 New order ready!',
        body: `${restaurant?.name || 'A store'} has an order for the ${order.deliverySlot || 'next'} slot.`,
        data: { distance: order.distance },
      });
    } catch (err) {
      console.warn('[SLOT_DISPATCH_PUSH_WARN]', order.id, err.message);
    }
  }
  return { released, marked };
};

const cancelOrder = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const isOwner = order.userId === req.user.id;
    const isAdmin = isAdminUser(req.user);
    if (!isOwner && !isAdmin) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to cancel Order ${order.id} owned by ${order.userId}`);
      return res.status(403).json({ message: 'Not authorized to cancel this order' });
    }
    if (order.status === 'Cancelled') {
      return res.status(400).json({ message: 'This order is already cancelled.', code: 'ALREADY_CANCELLED' });
    }
    if (order.status === 'Delivered') {
      return res.status(400).json({ message: 'This order has already been delivered. Need help? Contact support from the order page.', code: 'ALREADY_DELIVERED' });
    }
    // Customers can cancel while the order is Pending, or within 2 minutes of placing it while it is
    // still at the store (never once a rider is picking it up or carrying it). Orders no rider
    // claims are cancelled and refunded by autoCancelStalePendingOrders.
    const OWNER_CANCELLABLE = ['Pending', 'Accepted', 'Preparing'];
    if (isOwner && !isAdmin && order.status !== 'Pending') {
      const elapsed = (Date.now() - new Date(order.createdAt).getTime()) / 1000;
      if (!OWNER_CANCELLABLE.includes(order.status) || elapsed > 120) {
        return res.status(400).json({ message: 'The store has already started on this order, so it can no longer be cancelled. Need help? Contact support from the order page.', code: 'CANCEL_WINDOW_CLOSED' });
      }
    }

    const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.replace(/[<>]/g, '').slice(0, 250) : null;
    // The status guard is part of the conditional update, so a pickup that lands between our read
    // and the cancel wins (the customer cannot cancel food the rider is already carrying).
    const ownerCancel = isOwner && !isAdmin;
    if (ownerCancel && order.deliveryPartnerId) {
      // A rider holds the order (for buy-at-store shops they may already have paid at the counter):
      // only support can cancel now (B13).
      return res.status(400).json({ message: 'A delivery partner is already on this order, so it can no longer be cancelled. Need help? Contact support from the order page.', code: 'CANCEL_WINDOW_CLOSED' });
    }
    // Owner rules are re-checked inside the conditional update (B13/B24): still unclaimed, and either
    // Pending or within 2 minutes of placing, judged at write time (not on the row read above).
    const ownerWhere = ownerCancel ? {
      [Op.or]: [
        { status: 'Pending' },
        { createdAt: { [Op.gte]: new Date(Date.now() - 120 * 1000) } },
      ],
    } : null;
    const { cancelled, refunded } = await cancelAndRefund(order, { reason, by: ownerCancel ? 'customer' : 'support', ...(ownerCancel ? { onlyFromStatuses: OWNER_CANCELLABLE, requireUnclaimed: true, extraWhere: ownerWhere } : {}) });

    if (!cancelled) {
      const fresh = await Order.findByPk(order.id, { attributes: ['id', 'status'] });
      if (fresh && fresh.status !== 'Cancelled') {
        return res.status(400).json({ message: 'Your order is already on its way, so it can no longer be cancelled. Need help? Contact support from the order page.', code: 'CANCEL_WINDOW_CLOSED' });
      }
      return res.status(400).json({ message: 'This order is already cancelled.', code: 'ALREADY_CANCELLED' });
    }
    const cancelCode = ownerCancel ? 'CUSTOMER_CANCELLED' : 'ADMIN_CANCELLED';
    // refundedToWallet: the apps refresh the customer's Wallet balance from it (the bulk cancel already sent it).
    const statusPayload = { id: order.id, status: 'Cancelled', reason: cancelCode, refundedToWallet: refunded };
    broadcastOrderStatus(req, order, statusPayload);
    const io = req.app.get('io');
    if (io) {
      io.to(String(order.id)).emit('orderCancelled', { orderId: order.id, reason: cancelCode });
      io.to('admin-room').emit('orderCancelled', { orderId: order.id, reason: cancelCode });
      // The store / stall app drops the card (and stops ringing) at once.
      if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('orderCancelled', { orderId: order.id, reason: cancelCode });
      // The assigned rider must stop (they may not be in the order room right now).
      if (order.deliveryPartnerId) io.to(`rider_${order.deliveryPartnerId}`).emit('orderCancelled', { orderId: order.id });
    }
    if (order.deliveryPartnerId) {
      const rd = require('../utils/riderDispatch');
      // Already carrying it: the rider must not just drop the items (a buy-at-store rider paid for them).
      const carrying = ['Picking', 'PickedUp', 'ArrivedAtGate', 'OutForDelivery'].includes(order.status);
      rd.pushAssignedRider(order.deliveryPartnerId, 'Order cancelled', `Order #${rd.shortRef(order.id)} was cancelled${ownerCancel ? ' by the customer' : ' by ZenWe support'}. ${carrying ? 'Call ZenWe support about the items you have.' : 'Do not pick it up.'}`, { orderId: order.id, type: 'ORDER_CANCELLED' });
    }
    if (order.restaurantId) pushStoreCancelled(order.restaurantId, order, ownerCancel ? 'The customer cancelled an order.' : 'An order was cancelled by ZenWe support.');
    // Support cancelled it: the customer may not have the app open (the auto-cancel and store-decline paths push too).
    if (!ownerCancel) {
      // ": <reason>." with exactly one full stop ("...your order: Cancelled by ZCS support ₹160 is back" read badly).
      const reasonText = reason ? `: ${String(reason).trim().replace(/[.\s]+$/, '')}.` : '.';
      pushCustomer(order, 'Order cancelled', refunded > 0
        ? `ZenWe support cancelled your order${reasonText} ${inr(refunded)} is back in your Wallet.`
        : `ZenWe support cancelled your order${reasonText} You have not been charged.`);
    }

    // The app shows this under its own "Order cancelled" title: say what happened to the money, not the title again.
    res.json({
      message: refunded > 0
        ? `${inr(refunded)} is back in your ZenWe Wallet.`
        : String(order.paymentMethod || '').toUpperCase() === 'COD' ? 'No payment was taken for this Cash on Delivery order.' : 'You have not been charged.',
      orderId: order.id,
      refundedToWallet: refunded
    });
  } catch (error) {
    console.error('[CANCEL_ORDER_ERROR]', error);
    res.status(500).json({ message: 'We could not cancel the order right now. Please try again.' });
  }
};

// Forward order of statuses for the admin endpoint (equal rank = alternative steps).
const ADMIN_STATUS_RANK = {
  Pending: 0, Accepted: 1, Preparing: 2, ReadyForPickup: 3, Picking: 4,
  PickedUp: 5, OutForDelivery: 5, ArrivedAtGate: 6, Delivered: 7,
};

// @desc    Update order status (Admin)
// @route   PUT /api/orders/:id/status
const updateOrderStatus = async (req, res) => {
  try {
    let { status } = req.body;
    if (status === 'Ready for Pickup') status = 'ReadyForPickup';
    const allowedStatuses = ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'Picking', 'PickedUp', 'ArrivedAtGate', 'OutForDelivery', 'Delivered', 'Cancelled'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    // Cancelling goes through the same path as a customer cancel (exactly-once Wallet refund).
    if (status === 'Cancelled') return cancelOrder(req, res);

    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.status === 'Cancelled') {
      return res.status(400).json({ message: 'This order was cancelled (and refunded if paid by Wallet). It cannot be reopened — ask the customer to order again.' });
    }
    // Stall orders never take rider steps; rider orders never take the stall's OutForDelivery step.
    const RIDER_STEPS = ['Picking', 'PickedUp', 'ArrivedAtGate'];
    if (isVendorFulfilled(order) && RIDER_STEPS.includes(status)) {
      return res.status(400).json({ message: 'This order is delivered by the stall (no rider). Use Accepted, OutForDelivery or Delivered.' });
    }
    if (!isVendorFulfilled(order) && status === 'OutForDelivery') {
      return res.status(400).json({ message: 'OutForDelivery is only for stall-delivered orders. Use PickedUp for rider orders.' });
    }
    // A rider order cannot be picked up / at the gate without a rider: it left the pool with nobody carrying it
    // (no rider could claim it afterwards). Assign a rider first.
    if (!isVendorFulfilled(order) && RIDER_STEPS.includes(status) && !order.deliveryPartnerId) {
      return res.status(409).json({ code: 'NO_RIDER', message: 'Assign a rider to this order first, then mark it picked up.' });
    }

    // Forward-only: a Delivered order is final, and no step may go backwards (re-delivering a
    // regressed order used to credit points and rider earnings a second time).
    if (order.status === 'Delivered' && status !== 'Delivered') {
      return res.status(400).json({ code: 'ORDER_FINAL', message: 'This order is already delivered and cannot be moved back.' });
    }
    const targetRank = ADMIN_STATUS_RANK[status];
    const currentRank = ADMIN_STATUS_RANK[order.status];
    if (targetRank !== undefined && currentRank !== undefined && targetRank < currentRank) {
      return res.status(400).json({ code: 'STATUS_REGRESSION', message: `This order is already ${order.status}; it cannot go back to ${status}.` });
    }

    let justDelivered = false;
    if (status === 'Delivered') {
      // Only the request that actually flips the order to Delivered awards points (no double credit).
      // C6: support completing a rider's COD order records the cash that rider collected, in the same
      // transaction as the flip (exactly once per order; stall orders have no rider and record nothing).
      const n = await Order.sequelize.transaction(MONEY_TX, async (t) => {
        const [flipped] = await Order.update(
          { status: 'Delivered', deliveredAt: new Date(), ...(order.paymentMethod === 'COD' ? { paymentStatus: 'Completed' } : {}) },
          { where: { id: order.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } }, transaction: t }
        );
        if (flipped === 1) {
          await require('../utils/riderCash').recordCodDelivery({ t, orderId: order.id, actor: { type: 'admin', id: req.user && req.user.id ? String(req.user.id) : null } });
        }
        return flipped;
      });
      justDelivered = n === 1;
      if (!justDelivered) {
        // Lost the race: either already delivered (no second push / credit) or cancelled meanwhile.
        const fresh = await Order.findByPk(order.id, { attributes: ['id', 'status'] });
        if (fresh && fresh.status === 'Cancelled') {
          return res.status(400).json({ message: 'This order was cancelled and cannot be marked delivered.' });
        }
        return res.json({ message: 'Order is already delivered', orderId: order.id, status: 'Delivered' });
      }
    }

    if (justDelivered) {
      // Atomic increments (a stale read-modify-save here used to overwrite concurrent spin/redeem points).
      const { creditCustomerForDelivery } = require('../services/BadgeService');
      try {
        const { newBadges } = (await stallLoyaltyAllowed(order)) ? await creditCustomerForDelivery(getUserModel(), order) : { newBadges: [] };
        order.newBadges = newBadges;
      } catch (creditErr) {
        console.error('[DELIVERY_CREDIT_ERROR]', order.id, creditErr.message);
      }
    }

    if (justDelivered && order.deliveryPartnerId) {
      // Support / admin completion counts as a real delivery for the rider too (same credit as
      // the rider app path): lifetime earnings, points, and the rider is free for the next order.
      try {
        const DeliveryPartner = getDeliveryPartnerModel();
        await DeliveryPartner.increment({ totalEarnings: riderPayout(order), zenPoints: 5 }, { where: { id: order.deliveryPartnerId } });
        await refreshRiderCurrentOrder(order.deliveryPartnerId);
      } catch (riderErr) {
        console.error('[DELIVERY_RIDER_CREDIT_ERROR]', order.id, riderErr.message);
      }
    }

    const prevStatus = order.status;
    if (status !== 'Delivered') {
      // Conditional write: never overwrite a cancel (and its refund) that landed after we read the order.
      const extra = status === 'OutForDelivery' ? { outForDeliveryAt: new Date() } : {};
      // Leaving 'Pending' = the store side accepted (by admin): start the no-rider clock now.
      if (order.status === 'Pending' && status !== 'Pending' && !order.acceptedAt) extra.acceptedAt = new Date();
      // Admin marking it ready stamps the kitchen's ready time too, like the partner app does: the rider app's
      // "Food packed" chip (and a release from 'Picking') read readyAt, not only the status.
      if (status === 'ReadyForPickup' && !order.readyAt) extra.readyAt = new Date();
      const allowedFrom = Object.keys(ADMIN_STATUS_RANK).filter((s) => s !== 'Delivered' && ADMIN_STATUS_RANK[s] <= targetRank);
      const [n] = await Order.update({ status, ...extra }, { where: { id: order.id, status: { [Op.in]: allowedFrom } } });
      if (n === 0) return res.status(409).json({ message: 'This order was just updated (cancelled, delivered or moved on). Please refresh.' });
      order.status = status;
    } else {
      order.status = 'Delivered';
    }
    if (!order.deliveryPartnerId && !isVendorFulfilled(order)) {
      const wasClaimable = realtime.CLAIMABLE_STATUSES.includes(prevStatus);
      const isClaimable = realtime.CLAIMABLE_STATUSES.includes(order.status);
      if (isClaimable && !wasClaimable) { realtime.deliveryRequest(order.id); pushPoolOrder(order); }
      else if (!isClaimable && wasClaimable) realtime.deliveryRequestGone(order.id);
    }

    const statusPayload = { 
      id: order.id, 
      status,
      newBadges: status === 'Delivered' ? (order.newBadges || []) : []
    };
    broadcastOrderStatus(req, order, statusPayload);
    // Support marking the food ready (store phone dead) tells the assigned rider like the partner app does:
    // the rider app's "Food packed" alert listens for orderReady on the rider's own room.
    if (status === 'ReadyForPickup' && prevStatus !== 'ReadyForPickup' && order.deliveryPartnerId) {
      const io = req.app.get('io');
      if (io) io.to(`rider_${order.deliveryPartnerId}`).emit('orderReady', { orderId: order.id });
    }
    if (status === 'Delivered') {
      const io = req.app.get('io');
      if (io) io.to('admin-room').emit('admin_delivery_complete', { orderId: order.id });
    }

    // 🟢 Push Notification: Status Update to Customer
    try {
      const User = getUserModel();
      const customer = await User.findByPk(order.userId);
      if (customer) {
        // Store orders (groceries, pickles, bakes: Order.category is the store type) get neutral words, not kitchen ones.
        const storeOrder = require('../utils/vendorTypes').isStoreVendorType(order.category);
        const titles = {
          'Accepted': 'Order Confirmed! 👍',
          'Preparing': storeOrder ? 'Your order is being packed 📦' : 'Kitchen is cooking! 🍳',
          'ReadyForPickup': 'Order ready! 📦',
          'PickedUp': 'Out for Delivery! 🛵',
          'OutForDelivery': 'On the way 🛵',
          'Delivered': storeOrder ? 'Order delivered 🎉' : 'Enjoy your meal! 🎉',
          'Cancelled': 'Order Cancelled 🛑'
        };
        const bodies = {
          'Accepted': 'Your order was accepted by the merchant.',
          'Preparing': storeOrder ? 'The store is packing your order.' : 'Your order has been sent to the kitchen.',
          'ReadyForPickup': 'The merchant prepared your order and is waiting for a rider.',
          'PickedUp': 'Rider has picked up your order and is heading your way.',
          'OutForDelivery': 'The stall is bringing your order. Keep the cash ready.',
          'Delivered': 'Your order has been delivered successfully.',
          'Cancelled': 'Your order was cancelled by the store/system.'
        };
        if (titles[status]) {
          await sendPushToTokens(
            customer.fcmTokens,
            titles[status],
            bodies[status],
            { orderId: order.id, type: 'ORDER_UPDATE' },
            { recipients: [customer.id] }
          );
        }
      }
    } catch (pushStatusErr) {
      console.error('[PUSH_ERROR] Status update notification failed:', pushStatusErr.message);
    }

    // 🟢 WhatsApp Integration: Status Update to Customer
    try {
      const User = getUserModel();
      const user = await User.findByPk(order.userId);
      if (user && user.phone) {
        const orderWithRest = await Order.findByPk(order.id, { 
          include: [{ model: getRestaurantModel(), as: 'restaurant', attributes: ['name'] }] 
        });
        const msg = formatOrderMessage(orderWithRest, 'STATUS_UPDATE');
        await sendWhatsAppMessage(user.phone, msg, 'STATUS_UPDATE');
      }
    } catch (waStatusErr) {
      console.error('[WHATSAPP_ERROR] Status update alert failed:', waStatusErr.message);
    }

    res.json({ message: 'Order status updated', orderId: order.id, status });
  } catch (error) {
    sendServerError(res, error, '[ORDERCONTROLLER_ERROR]');
  }
};

const getSurgeStatus = async (req, res) => {
  try {
    const { isSurgeActive, SURGE_MULTIPLIER } = require('../server');
    const zone = typeof req.query.zone === 'string' && req.query.zone ? req.query.zone : 'Amaravathi_Central';
    res.json({ isSurge: typeof isSurgeActive === 'function' ? !!isSurgeActive(zone) : false, zone, multiplier: SURGE_MULTIPLIER });
  } catch {
    res.json({ isSurge: false });
  }
};
    // @desc    Get spending stats for logged-in user (F12 - Spending Dashboard)
// @route   GET /api/orders/stats
const getOrderStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = getUserModel();
    const Restaurant = getRestaurantModel();
    const { Op } = require('sequelize');

    const orders = await Order.findAll({
      where: { 
        userId: req.user.id,
        status: { [Op.notIn]: ['Cancelled', 'cancelled', 'Rejected', 'rejected'] }
      },
      order: [['createdAt', 'DESC']],
      limit: 200
    });

    const user = await User.findByPk(req.user.id, {
      attributes: ['streakCount', 'completedOrders', 'totalOrders', 'zenPoints']
    });

    // Monthly spend (last 6 months)
    // Months are IST calendar months (the server runs in UTC: an order at 00:30 IST on the 1st
    // belonged to the previous month, and for the first 5.5 h of a month the current month was missing).
    const monthlyMap = {};
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const monthKey = (d) => new Date(d.getTime() + IST_MS).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    const nowIst = new Date(Date.now() + IST_MS);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - i, 1));
      monthlyMap[d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })] = 0;
    }
    orders.forEach(o => {
      const key = monthKey(new Date(o.createdAt));
      if (monthlyMap[key] !== undefined) {
        monthlyMap[key] += (o.finalPrice || o.totalPrice || 0);
      }
    });
    const monthlySpend = Object.entries(monthlyMap).map(([month, total]) => ({ month, total: Math.round(total) }));

    // Top items
    const itemMap = {};
    orders.forEach(o => {
      let itemsList = o.items;
      if (typeof itemsList === 'string') {
        try {
          itemsList = JSON.parse(itemsList);
        } catch {
          itemsList = [];
        }
      }
      const items = Array.isArray(itemsList) ? itemsList : [];
      items.forEach(item => {
        const name = item.name || 'Unknown';
        if (!itemMap[name]) itemMap[name] = { name, count: 0, spend: 0 };
        itemMap[name].count += (item.quantity || 1);
        itemMap[name].spend += (item.priceAtOrder || item.price || 0) * (item.quantity || 1);
      });
    });
    const topItems = Object.values(itemMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(i => ({ ...i, spend: Math.round(i.spend) }));

    const totalSpend = orders.reduce((s, o) => s + (o.finalPrice || o.totalPrice || 0), 0);
    const avgOrderValue = orders.length > 0 ? Math.round(totalSpend / orders.length) : 0;

    // Favourite restaurant by order count
    const restMap = {};
    orders.forEach(o => {
      if (o.restaurantId) {
        restMap[o.restaurantId] = (restMap[o.restaurantId] || 0) + 1;
      }
    });

    const topRestId = Object.entries(restMap).sort((a, b) => b[1] - a[1])[0]?.[0];
    let favoriteRestaurant = '';
    if (topRestId && Restaurant) {
      const rest = await Restaurant.findByPk(topRestId, { attributes: ['id', 'name'] });
      if (rest) favoriteRestaurant = rest.name;
    }

    const calculatedStreak = user?.streakCount || (orders.length > 0 ? 1 : 0);

    res.json({
      monthlySpend,
      topItems,
      avgOrderValue,
      totalOrders: orders.length || user?.completedOrders || user?.totalOrders || 0,
      favoriteRestaurant: favoriteRestaurant || 'N/A',
      currentStreak: calculatedStreak,
      zenPoints: user?.zenPoints || 0
    });
  } catch (error) {
    console.error('[ORDER_STATS_ERROR]', error);
    sendServerError(res, error, '[ORDERCONTROLLER_ERROR]');
  }
};


// @desc    LEGACY ONLY: resolve UPI orders placed before online payments were switched off.
//          New orders can only be COD or Wallet (createOrder rejects UPI), so nothing new reaches this.
const verifyUPIPayment = async (req, res) => {
  const { isVerified } = req.body; // boolean
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.paymentMethod !== 'UPI') return res.status(400).json({ message: 'Not a UPI order' });
    if (order.upiStatus !== 'Pending') return res.status(400).json({ message: `This UPI payment is already ${String(order.upiStatus || 'resolved').toLowerCase()}.` });

    const prevStatus = order.status;
    if (isVerified) {
      // Conditional: only a still-pending UPI order that is not closed can be verified.
      const nextStatus = order.status === 'Pending' ? 'Accepted' : order.status;
      const [n] = await Order.update(
        { upiStatus: 'Verified', paymentStatus: 'Completed', status: nextStatus, ...(nextStatus !== prevStatus ? { acceptedAt: new Date() } : {}) },
        { where: { id: order.id, upiStatus: 'Pending', status: prevStatus } }
      );
      if (!n) return res.status(409).json({ message: 'This order was just updated. Please refresh.' });
      order.upiStatus = 'Verified';
      order.paymentStatus = 'Completed';
      order.status = nextStatus;
    } else {
      // Rejected payment: cancel through the shared path (exactly once, coupon restored).
      const [n] = await Order.update(
        { upiStatus: 'Rejected' },
        { where: { id: order.id, upiStatus: 'Pending', status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } }
      );
      if (!n) return res.status(409).json({ message: 'This order was just updated. Please refresh.' });
      order.upiStatus = 'Rejected';
      const { cancelled } = await cancelAndRefund(order, { reason: 'UPI payment rejected', by: 'support' });
      order.status = cancelled ? 'Cancelled' : order.status;
    }

    if (!order.deliveryPartnerId) {
      if (order.status === 'Accepted' && prevStatus === 'Pending') { realtime.deliveryRequest(order.id); pushPoolOrder(order); }
      else if (order.status === 'Cancelled' && realtime.CLAIMABLE_STATUSES.includes(prevStatus)) realtime.deliveryRequestGone(order.id);
    }

    const statusPayload = { id: order.id, status: order.status };
    broadcastOrderStatus(req, order, statusPayload);

    res.json({ message: `Payment ${isVerified ? 'Verified' : 'Rejected'}`, orderId: order.id, status: order.status });
  } catch (error) {
    sendServerError(res, error, '[ORDERCONTROLLER_ERROR]');
  }
};

// @desc    Restaurant marks food as ready for pickup
const restaurantReadyOrder = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    // ── IDOR Protection ──────────────────────
    const isAdmin = req.user && req.user.role && req.user.role.toLowerCase() === 'admin';
    const isVendor = req.user && req.user.role && req.user.role.toLowerCase() === 'restaurant';
    const isOwner = order.restaurantId === req.user.id;
    
    if (!isAdmin && !(isVendor && isOwner)) {
      return res.status(403).json({ message: 'Not authorized to update this order' });
    }
    if (isVendorFulfilled(order)) {
      return res.status(400).json({ message: 'Stall orders go Accepted, then Out for delivery, then Delivered. Tap "Out for delivery" when you leave with it.' });
    }

    // B7: a rider may already be at the counter ('Picking') while the kitchen is still cooking.
    // Record the ready time and ping the rider, but keep the rider's step.
    if (order.status === 'Picking') {
      if (!order.readyAt) await Order.update({ readyAt: new Date() }, { where: { id: order.id, status: 'Picking' } });
      const pio = req.app.get('io');
      if (pio && order.deliveryPartnerId) pio.to(`rider_${order.deliveryPartnerId}`).emit('orderReady', { orderId: order.id });
      return res.json({ message: 'Rider notified that the food is packed', orderId: order.id, status: 'Picking' });
    }

    // Retry / double tap, or the rider already took the food: not an error, report the real status.
    if (['ReadyForPickup', 'PickedUp', 'ArrivedAtGate', 'Delivered'].includes(order.status)) {
      // An older row marked ready without a time (admin / legacy path): stamp it now so the rider sees "Food packed".
      if (order.status === 'ReadyForPickup' && !order.readyAt) await Order.update({ readyAt: new Date() }, { where: { id: order.id, status: 'ReadyForPickup', readyAt: null } });
      return res.json({ message: order.status === 'ReadyForPickup' ? 'Order is already marked ready' : 'The rider has already picked up this order', orderId: order.id, status: order.status, alreadyApplied: true });
    }
    if (order.status !== 'Accepted' && order.status !== 'Preparing') {
       return res.status(400).json({ message: order.status === 'Cancelled' ? 'This order was cancelled.' : 'Accept the order before marking it ready.' });
    }

    // Conditional flip so a concurrent customer cancel is never overwritten.
    const [ready] = await Order.update({ status: 'ReadyForPickup', readyAt: new Date() }, { where: { id: order.id, status: { [Op.in]: ['Accepted', 'Preparing'] } } });
    if (ready === 0) return res.status(400).json({ message: 'This order was just cancelled or updated. Please refresh.' });
    order.status = 'ReadyForPickup';

    const statusPayload = { id: order.id, status: 'ReadyForPickup' };
    broadcastOrderStatus(req, order, statusPayload);

    const io = req.app.get('io');

    // Also notify the delivery partner if assigned
    if (io && order.deliveryPartnerId) {
      io.to(`rider_${order.deliveryPartnerId}`).emit('orderReady', { orderId: order.id });
    }

    res.json({ message: 'Order marked as Ready for Pickup', orderId: order.id });
    await pushCustomer(order, 'Order ready! 📦', order.deliveryPartnerId
      ? 'Your order is packed. Your rider is picking it up.'
      : order.slotStart && order.slotEnd
        ? `Your order is packed for delivery ${deliverySlots.rangeLabel(order.slotStart, order.slotEnd)}.`
        : 'Your order is packed and waiting for a rider.');
  } catch (error) {
    console.error('[RESTAURANT_READY_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Status changes sent by the restaurant partner app to PUT /api/orders/:id/status.
//          Admins keep the full updateOrderStatus; a restaurant may only move ITS OWN orders
//          through the kitchen steps (accept → preparing → ready) or decline a new order.
const restaurantUpdateOrderStatus = async (req, res) => {
  // Stall (fulfilment VENDOR) orders have their own flow: Pending -> Accepted -> OutForDelivery -> Delivered.
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.restaurantId !== req.user.id) return res.status(403).json({ message: 'Not authorized to update this order' });
    if (isVendorFulfilled(order)) return vendorUpdateOrderStatus(req, res, order);
  } catch (error) {
    console.error('[REST_STATUS_ERROR]', error);
    return res.status(500).json({ message: 'Could not update the order right now. Please try again.' });
  }
  let status = String((req.body || {}).status || '');
  if (status === 'Ready for Pickup' || status === 'Ready') status = 'ReadyForPickup';
  if (status === 'Rejected' || status === 'Declined') status = 'Cancelled';
  if (status === 'Accepted') return restaurantAcceptOrder(req, res);
  if (status === 'ReadyForPickup') return restaurantReadyOrder(req, res);
  try {
    if (!['Preparing', 'Cancelled'].includes(status)) {
      return res.status(400).json({ message: 'A store can accept, start preparing, mark ready or decline an order.' });
    }
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.restaurantId !== req.user.id) return res.status(403).json({ message: 'Not authorized to update this order' });

    if (status === 'Preparing') {
      // A store may skip "Accept" and start cooking: that is when the order enters the rider pool, so
      // acceptedAt is stamped then (the 30-min no-rider auto-cancel counts from acceptedAt).
      let prevStatus = order.status;
      let [n] = prevStatus === 'Pending'
        ? await Order.update({ status: 'Preparing', acceptedAt: new Date() }, { where: { id: order.id, status: 'Pending' } })
        : [0];
      if (n === 0) {
        [n] = await Order.update({ status: 'Preparing' }, { where: { id: order.id, status: 'Accepted' } });
        if (n === 1) prevStatus = 'Accepted';
      }
      if (n === 0) return res.status(400).json({ message: 'This order was just cancelled or updated. Please refresh.' });
      order.status = 'Preparing';
      if (prevStatus === 'Pending' && !order.deliveryPartnerId) { realtime.deliveryRequest(order.id); pushPoolOrder(order); }
      broadcastOrderStatus(req, order, { id: order.id, status: 'Preparing' });
      // Answer the kitchen before the push (B28).
      res.json({ message: 'Order marked as Preparing', orderId: order.id, status: 'Preparing' });
      try {
        const customer = await getUserModel().findByPk(order.userId, { attributes: ['id', 'fcmTokens'] });
        if (customer) {
          const storeOrder = require('../utils/vendorTypes').isStoreVendorType(order.category);
          await sendPushToTokens(customer.fcmTokens, storeOrder ? 'Your order is being packed 📦' : 'Kitchen is cooking! 🍳', 'Your order is being prepared.', { orderId: order.id, type: 'ORDER_UPDATE' }, { recipients: [customer.id] });
        }
      } catch (pushErr) { console.warn('[REST_STATUS_PUSH_WARN]', pushErr.message); }
      return;
    }

    // Decline: only before a rider has picked it up; refunds the Wallet exactly once.
    const reason = typeof (req.body || {}).reason === 'string' && req.body.reason.trim()
      ? req.body.reason.replace(/[<>]/g, '').trim().slice(0, 250)
      : 'The store could not take this order';
    const { cancelled, refunded } = await cancelAndRefund(order, { reason, onlyFromStatuses: ['Pending', 'Accepted', 'Preparing'], by: 'store' });
    if (!cancelled) {
      // A retry of the same decline (the first response was lost): 200, not an error (B28).
      const fresh = await Order.findByPk(order.id, { attributes: ['id', 'status', 'cancellationReason'] });
      if (fresh && fresh.status === 'Cancelled' && String(fresh.cancellationReason || '') === reason) {
        return res.json({ message: 'Order declined', orderId: order.id, status: 'Cancelled', refundedToWallet: 0, alreadyApplied: true });
      }
      return res.status(400).json({ message: 'This order can no longer be declined (it is already cancelled or out for delivery).' });
    }
    const payload = { id: order.id, status: 'Cancelled', reason: 'STORE_DECLINED', refundedToWallet: refunded };
    broadcastOrderStatus(req, order, payload);
    const io = req.app.get('io');
    if (io) {
      io.to(String(order.id)).emit('orderCancelled', { orderId: order.id, reason: 'STORE_DECLINED' });
      io.to('admin-room').emit('orderCancelled', { orderId: order.id, reason: 'STORE_DECLINED' });
      if (order.deliveryPartnerId) io.to(`rider_${order.deliveryPartnerId}`).emit('orderCancelled', { orderId: order.id, reason: 'STORE_DECLINED' });
    }
    if (order.deliveryPartnerId) {
      const rd = require('../utils/riderDispatch');
      rd.pushAssignedRider(order.deliveryPartnerId, 'Order cancelled', `The store could not take order #${rd.shortRef(order.id)}. Do not pick it up.`, { orderId: order.id, type: 'ORDER_CANCELLED', reason: 'STORE_DECLINED' });
    }
    res.json({ message: 'Order declined', orderId: order.id, status: 'Cancelled', refundedToWallet: refunded });
    try {
      const customer = await getUserModel().findByPk(order.userId, { attributes: ['id', 'fcmTokens'] });
      if (customer) {
        await sendPushToTokens(customer.fcmTokens, 'Order cancelled',
          refunded > 0 ? `The store could not take your order. ₹${refunded} is back in your Wallet.` : 'The store could not take your order. You have not been charged.',
          { orderId: order.id, type: 'ORDER_UPDATE' }, { recipients: [customer.id] });
      }
    } catch (pushErr) { console.warn('[REST_DECLINE_PUSH_WARN]', pushErr.message); }
    return;
  } catch (error) {
    console.error('[REST_STATUS_ERROR]', error);
    if (!res.headersSent) res.status(500).json({ message: 'Could not update the order right now. Please try again.' });
  }
};


// @desc    Zenvy Vendor app (CampusBites stall) moves ITS OWN fulfilment='VENDOR' order.
//          Pending -> Accepted -> OutForDelivery -> Delivered, or Cancelled/Rejected with a reason.
//          No rider, no PIN, no rider pool events. Every write is conditional on the current status.
const VENDOR_FLOW = {
  Accepted: { from: ['Pending'], stamp: 'acceptedAt' },
  OutForDelivery: { from: ['Accepted', 'Preparing', 'ReadyForPickup'], stamp: 'outForDeliveryAt' },
  Delivered: { from: ['OutForDelivery', 'Accepted', 'Preparing', 'ReadyForPickup', 'PickedUp', 'ArrivedAtGate'], stamp: 'deliveredAt' },
};
const VENDOR_CANCELLABLE = ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'OutForDelivery'];
const VENDOR_STALE_MSG = 'This order was just cancelled or updated. Please refresh.';

const vendorUpdateOrderStatus = async (req, res, order) => {
  try {
    const Order = getOrderModel();
    let status = String((req.body || {}).status || '').trim();
    if (status === 'Rejected' || status === 'Declined') status = 'Cancelled';
    if (status === 'Out for delivery' || status === 'OnTheWay') status = 'OutForDelivery';
    const store = await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name'] });
    const stall = (store && store.name) || 'The stall';
    const notifyCustomer = async (title, body) => {
      try {
        const customer = await getUserModel().findByPk(order.userId, { attributes: ['id', 'fcmTokens'] });
        if (customer) await sendPushToTokens(customer.fcmTokens, title, body, { orderId: order.id, type: 'ORDER_UPDATE' }, { recipients: [customer.id] });
      } catch (pushErr) { console.warn('[VENDOR_STATUS_PUSH_WARN]', pushErr.message); }
    };

    if (status === 'Cancelled') {
      const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.replace(/[<>]/g, '').trim().slice(0, 250) : '';
      if (!reason) return res.status(400).json({ message: 'Please tell the customer why you are cancelling.' });
      const { cancelled } = await cancelAndRefund(order, { reason, onlyFromStatuses: VENDOR_CANCELLABLE, by: 'store' });
      if (!cancelled) {
        // Retry of the same reject after a lost response: 200 (B28).
        const fresh = await Order.findByPk(order.id, { attributes: ['id', 'status', 'cancellationReason'] });
        if (fresh && fresh.status === 'Cancelled' && String(fresh.cancellationReason || '') === reason) {
          return res.json({ message: 'Order cancelled', orderId: order.id, status: 'Cancelled', alreadyApplied: true });
        }
        return res.status(400).json({ message: VENDOR_STALE_MSG });
      }
      broadcastOrderStatus(req, order, { id: order.id, status: 'Cancelled', reason });
      const io = req.app.get('io');
      if (io) {
        io.to(String(order.id)).emit('orderCancelled', { orderId: order.id, reason: 'STORE_DECLINED' });
        io.to('admin-room').emit('orderCancelled', { orderId: order.id, reason: 'STORE_DECLINED' });
      }
      res.json({ message: 'Order cancelled', orderId: order.id, status: 'Cancelled' });
      await notifyCustomer('Order cancelled', `${stall} cancelled: ${reason}`);
      return;
    }

    const step = VENDOR_FLOW[status];
    if (!step) return res.status(400).json({ message: 'A stall can accept an order, mark it out for delivery, mark it delivered or cancel it.' });
    const fields = { status, [step.stamp]: new Date(), ...(status === 'Delivered' && order.paymentMethod === 'COD' ? { paymentStatus: 'Completed' } : {}) };
    const [n] = await Order.update(fields, { where: { id: order.id, status: { [Op.in]: step.from } } });
    if (n === 0) {
      const fresh = await Order.findByPk(order.id, { attributes: ['id', 'status'] });
      if (fresh && fresh.status === status) {
        return res.json({ message: `Order is already ${status === 'OutForDelivery' ? 'out for delivery' : status.toLowerCase()}`, orderId: order.id, status });
      }
      return res.status(400).json({ message: VENDOR_STALE_MSG });
    }
    Object.assign(order, fields);

    let newBadges = [];
    if (status === 'Delivered') {
      // Exactly once: only the request whose conditional update flipped the order gets here.
      try {
        const { creditCustomerForDelivery } = require('../services/BadgeService');
        const result = (await stallLoyaltyAllowed(order)) ? await creditCustomerForDelivery(getUserModel(), order) : null;
        newBadges = (result && result.newBadges) || [];
      } catch (creditErr) {
        console.error('[DELIVERY_CREDIT_ERROR]', order.id, creditErr.message);
      }
    }
    broadcastOrderStatus(req, order, { id: order.id, status, ...(status === 'Delivered' ? { newBadges } : {}) });
    if (status === 'Delivered') {
      const io = req.app.get('io');
      if (io) io.to('admin-room').emit('admin_delivery_complete', { orderId: order.id });
    }

    // Answer the stall first, then the customer push (B28).
    const labels = { Accepted: 'Order accepted', OutForDelivery: 'Order is out for delivery', Delivered: 'Order delivered' };
    res.json({ message: labels[status], orderId: order.id, status });

    if (status === 'Accepted') await notifyCustomer('Order accepted 👍', `${stall} accepted your order.`);
    else if (status === 'OutForDelivery') await notifyCustomer('On the way 🛵', `${stall} is bringing your order. Keep ₹${money(order.finalPrice)} cash ready.`);
    else await notifyCustomer('Delivered 🎉', `Delivered by ${stall}. Enjoy!`);
    return;
  } catch (error) {
    console.error('[VENDOR_STATUS_ERROR]', error);
    if (!res.headersSent) return res.status(500).json({ message: 'Could not update the order right now. Please try again.' });
  }
};

// ── Kirana pre-purchase / bill approval on an Order ────────────────
// Upload endpoints: the assigned rider (or admin). Approve endpoints: the customer who owns it.
const loadOrderFor = async (req, res, who) => {
  const Order = getOrderModel();
  const order = await Order.findByPk(req.params.id);
  if (!order) { res.status(404).json({ message: 'Order not found' }); return null; }
  const isAdmin = isAdminUser(req.user);
  const allowed = who === 'rider'
    ? (isAdmin || (order.deliveryPartnerId && order.deliveryPartnerId === req.user.id))
    : (isAdmin || order.userId === req.user.id);
  if (!allowed) { res.status(403).json({ message: 'Not authorized for this order' }); return null; }
  if (['Cancelled', 'Delivered'].includes(order.status)) {
    res.status(400).json({ message: `This order is already ${order.status.toLowerCase()}.` });
    return null;
  }
  return order;
};

// Bill / pre-purchase photo flow exists only for buy-for-me orders (the rider shops with cash and
// the bill decides the price). On a normal food / store order the price is fixed by the menu, so
// a rider + customer pair must never be able to "approve" a tiny bill and refund the Wallet.
const BUY_FOR_ME_CATEGORIES = ['mega basket', 'mega_basket', 'megabasket', 'kirana', 'buy_for_me'];
const isBuyForMeOrder = (order) => BUY_FOR_ME_CATEGORIES.includes(String((order && order.category) || '').trim().toLowerCase());
const notBuyForMe = (res) => res.status(400).json({ code: 'NOT_BUY_FOR_ME', message: 'Bills can only be added to Mega Basket orders.' });

// @desc    Rider uploads pre-purchase item photo / estimate for Mega Basket
const uploadItemPhoto = async (req, res) => {
  try {
    const { itemPhotoUrl: rawPhoto } = req.body || {};
    if (!rawPhoto || typeof rawPhoto !== 'string') return res.status(400).json({ message: 'Please attach the item photo.' });
    const order = await loadOrderFor(req, res, 'rider');
    if (!order) return;
    if (!isBuyForMeOrder(order)) return notBuyForMe(res);
    const { storeImageRef, sendImageError } = require('../utils/imageStore');
    const img = await storeImageRef(rawPhoto, { req, ownerId: req.user.id, purpose: 'basket' });
    if (!img.ok || !img.value) return sendImageError(res, img.ok ? { status: 400, message: 'Please attach the item photo.' } : img);
    const itemPhotoUrl = img.value;
    const [saved] = await getOrderModel().update({ itemPhotoUrl }, { where: { id: order.id, status: { [Op.notIn]: ['Cancelled', 'Delivered'] } } });
    if (!saved) return res.status(409).json({ message: 'This order was just updated. Please refresh.' });
    order.itemPhotoUrl = itemPhotoUrl; // status is unchanged ('Shopping' is not an order status)

    broadcastOrderStatus(req, order, await signOrderMedia(req, {
      id: order.id,
      status: order.status,
      itemPhotoUrl,
      isPurchasingApprovedByCustomer: order.isPurchasingApprovedByCustomer
    }));
    res.json({ message: 'Item photo uploaded successfully', order: await withoutPinSigned(req, order) });
  } catch (error) {
    console.error('[UPLOAD_ITEM_PHOTO_ERROR]', error);
    res.status(500).json({ message: 'Could not upload the photo. Please try again.' });
  }
};

// @desc    Customer approves pre-purchase photo & estimate to proceed with purchasing
const approvePurchase = async (req, res) => {
  try {
    const order = await loadOrderFor(req, res, 'customer');
    if (!order) return;
    order.isPurchasingApprovedByCustomer = true;
    await order.save();
    broadcastOrderStatus(req, order, { id: order.id, status: order.status, isPurchasingApprovedByCustomer: true });
    res.json({ message: 'Purchase approved', order: await signOrderMedia(req, ownerOrderJson(order)) });
  } catch (error) {
    console.error('[APPROVE_PURCHASE_ERROR]', error);
    res.status(500).json({ message: 'Could not approve right now. Please try again.' });
  }
};

// @desc    Rider uploads final store bill receipt & bill amount
const uploadBillProof = async (req, res) => {
  try {
    const { billProofUrl: rawBill } = req.body || {};
    const billAmount = Number((req.body || {}).billAmount);
    if (!rawBill || typeof rawBill !== 'string') return res.status(400).json({ message: 'Please attach a photo of the bill.' });
    if (!Number.isFinite(billAmount) || billAmount <= 0 || billAmount > 100000) return res.status(400).json({ message: 'Please enter the bill amount.' });
    const order = await loadOrderFor(req, res, 'rider');
    if (!order) return;
    if (!isBuyForMeOrder(order)) return notBuyForMe(res);
    if (order.isBillApproved) return res.status(400).json({ message: 'The customer has already approved this bill.' });
    // A bill far below what the customer ordered needs support to review it (refund abuse guard).
    const subtotal = Number(order.totalPrice) || 0;
    if (subtotal > 0 && billAmount < subtotal * 0.5) {
      return res.status(400).json({ code: 'BILL_TOO_LOW', message: 'This bill is much lower than the order. Please contact ZenWe support to adjust it.' });
    }
    const { storeImageRef, sendImageError } = require('../utils/imageStore');
    const img = await storeImageRef(rawBill, { req, ownerId: req.user.id, purpose: 'bill' });
    if (!img.ok || !img.value) return sendImageError(res, img.ok ? { status: 400, message: 'Please attach a photo of the bill.' } : img);
    const billProofUrl = img.value;
    const [saved] = await getOrderModel().update(
      { billProofUrl, billAmount: money(billAmount) },
      { where: { id: order.id, status: { [Op.notIn]: ['Cancelled', 'Delivered'] }, isBillApproved: { [Op.not]: true } } }
    );
    if (!saved) return res.status(409).json({ message: 'This order was just updated. Please refresh.' });
    order.billProofUrl = billProofUrl;
    order.billAmount = money(billAmount);

    broadcastOrderStatus(req, order, await signOrderMedia(req, {
      id: order.id,
      status: order.status,
      billProofUrl,
      billAmount: order.billAmount,
      isBillApproved: order.isBillApproved
    }));
    res.json({ message: 'Bill proof uploaded successfully', order: await withoutPinSigned(req, order) });
  } catch (error) {
    console.error('[UPLOAD_BILL_ERROR]', error);
    res.status(500).json({ message: 'Could not upload the bill. Please try again.' });
  }
};

// @desc    Customer approves the final store bill; the order total becomes bill + delivery.
//          Wallet orders are charged/refunded the difference atomically; COD collects it at the door.
const approveBill = async (req, res) => {
  try {
    const order = await loadOrderFor(req, res, 'customer');
    if (!order) return;
    if (!isBuyForMeOrder(order)) return notBuyForMe(res);
    if (!(Number(order.billAmount) > 0)) return res.status(400).json({ message: 'The rider has not uploaded the bill yet.' });
    if (order.isBillApproved) return res.json({ message: 'Bill already approved', order: await withoutPinSigned(req, order), amountPayable: order.finalPrice });

    const Order = getOrderModel();
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    let newFinal = 0;
    let diff = 0;

    try {
      await sequelize.transaction(MONEY_TX, async (t) => {
        // Lock and re-read: a cancel running in parallel either finishes first (we see Cancelled)
        // or waits for us (and then refunds the new finalPrice). Never two refunds on stale data.
        const fresh = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!fresh || ['Cancelled', 'Delivered'].includes(fresh.status)) {
          throw new PricingError(409, 'ORDER_CLOSED', `This order is already ${String(fresh ? fresh.status : 'closed').toLowerCase()}.`);
        }
        if (fresh.isBillApproved) throw new PricingError(409, 'ALREADY_APPROVED', 'Bill already approved.');
        // Bill + every fee and discount of the original quote (B24): packaging / taxes were dropped
        // and the coupon discount was lost when the bill replaced the estimate.
        let pb = fresh.priceBreakdown;
        if (typeof pb === 'string') { try { pb = JSON.parse(pb); } catch { pb = null; } }
        pb = pb && typeof pb === 'object' ? pb : {};
        const legacyDiscount = Number(fresh.batchDiscount || 0) + Number(fresh.gateDiscount || 0);
        const totalDiscount = Number.isFinite(Number(pb.totalDiscount)) && pb.totalDiscount != null ? Number(pb.totalDiscount) : legacyDiscount;
        newFinal = money(Math.max(0, Number(fresh.billAmount) + Number(fresh.deliveryFee || 0) + Number(pb.packagingFee || 0) + Number(pb.taxes || 0) - totalDiscount));
        diff = money(newFinal - Number(fresh.finalPrice || 0));
        const [n] = await Order.update(
          { isBillApproved: true, finalPrice: newFinal },
          { where: { id: order.id, isBillApproved: { [Op.not]: true }, status: { [Op.notIn]: ['Cancelled', 'Delivered'] } }, transaction: t } // older rows may hold NULL
        );
        if (n === 0) throw new PricingError(409, 'ALREADY_APPROVED', 'Bill already approved.');
        // C5: the difference moves through the ledger (BILL_DIFFERENCE, signed), once per order.
        if (order.paymentMethod === 'Wallet' && diff !== 0) {
          try {
            await walletLedger.applyWalletChange({
              t, ownerType: 'user', ownerId: order.userId, amountPaise: -walletLedger.toPaise(diff), type: walletLedger.TYPES.BILL_DIFFERENCE,
              ref: { type: 'ORDER', id: order.id }, actor: { type: 'user', id: req.user.id }, idempotencyKey: `bill:${order.id}`,
            });
          } catch (e) {
            if (!walletLedger.isInsufficient(e)) throw e;
            throw new PricingError(400, 'INSUFFICIENT_WALLET', `The bill is ₹${diff} more than you paid and your Wallet doesn't have enough. Please contact ZenWe support from Help.`, { needed: diff });
          }
        }
      });
    } catch (err) {
      if (err instanceof PricingError) return sendPricingError(res, err);
      throw err;
    }

    order.isBillApproved = true;
    order.finalPrice = newFinal;
    broadcastOrderStatus(req, order, { id: order.id, status: order.status, isBillApproved: true, finalPrice: newFinal });
    const msg = order.paymentMethod === 'Wallet'
      ? (diff > 0 ? `Bill approved. ₹${diff} was taken from your Wallet.` : diff < 0 ? `Bill approved. ₹${-diff} was returned to your Wallet.` : 'Bill approved.')
      : `Bill approved. Pay ₹${newFinal} in cash when your order arrives.`;
    res.json({ message: msg, order: await withoutPinSigned(req, order), amountPayable: newFinal });
  } catch (error) {
    console.error('[APPROVE_BILL_ERROR]', error);
    res.status(500).json({ message: 'Could not approve the bill right now. Please try again.' });
  }
};

module.exports = { pushCustomer, pushStoreCancelled, customerOrderJson, restaurantUpdateOrderStatus, autoCancelStalePendingOrders, escalateUnclaimedOrders, unclaimedClockStart, releaseStalledRiderClaims, releaseDueSlotOrders, cancelAndRefund, createOrder, quoteOrder, getServiceability, getDeliverySlots, getOrderById, getMyOrders, rateOrder, getAllOrders, cancelOrder, updateOrderStatus, getSurgeStatus, restaurantAcceptOrder, verifyUPIPayment, restaurantReadyOrder, getOrderStats, uploadItemPhoto, approvePurchase, uploadBillProof, approveBill };
