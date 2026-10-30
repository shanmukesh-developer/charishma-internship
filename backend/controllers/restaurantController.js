const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getOrderModel } = require('../models/Order');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { getStoreOpenState, normalizeOperatingHours, todayHoursText } = require('../utils/storeHours');
const { isLocalVendorStore, LOCAL_VENDOR_TYPES } = require('../utils/vendorTypes');
const { sortMenuItems } = require('../utils/menuSort');

// Customers' restaurant listing is cached in adminController; any vendor change must clear it.
const realtime = require('../utils/realtime');
const clearPublicRestaurantsCache = () => {
  try { require('./adminController').clearRestaurantsCache(); } catch (e) { console.error('[CACHE_CLEAR_ERROR]', e.message); }
};

// Restaurant row as the partner app may see it (no password hash) + the live open state.
const { stripStoreSecrets, stripItemSecrets, applyFeaturedExpiry } = require('../utils/publicFields');

// Columns that public listings strip anyway (stripStoreSecrets / stripItemSecrets): not selected at all.
const PUBLIC_STORE_EXCLUDE = ['password', 'fcmTokens', 'tokenVersion', 'commissionRate', 'commissionType', 'phone', ...require('../utils/publicFields').STORE_PRIVATE_FIELDS];
const PUBLIC_ITEM_EXCLUDE = ['customCommission', 'ownerName', 'ownerPhone'];
// Menu rows grouped by store id, keeping their (already sorted) order: O(items) instead of a
// per-store filter over every item.
const groupByRestaurant = (items) => {
  const map = new Map();
  for (const m of items) {
    const list = map.get(m.restaurantId);
    if (list) list.push(m); else map.set(m.restaurantId, [m]);
  }
  return map;
};

const publicStoreJson = (restaurant) => {
  const json = restaurant.toJSON();
  const pushDevices = Array.isArray(json.fcmTokens) ? json.fcmTokens.length : 0;
  delete json.password;
  delete json.fcmTokens;
  delete json.tokenVersion;
  // C8: the owner's own compliance details (PAN masked, never the full number).
  const compliance = require('../utils/storeCompliance').privateView(json);
  delete json.pan;
  const state = getStoreOpenState(restaurant);
  return {
    ...json,
    panMasked: compliance.panMasked,
    compliance,
    _id: json.id,
    partnerPhone: json.phone || null,
    pushDevices,
    isLocalVendor: isLocalVendorStore(restaurant),
    isOpen: state.isOpen,
    opensAt: state.opensAt || null,
    closedReason: state.isOpen ? null : (state.message || null),
  };
};

const validPrice = (price) => {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 && n <= 100000;
};

// Last 10 digits of an Indian mobile (+91…, 91…, 0…, spaces). null when it is not one.
const tenDigits = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  const t = d.length === 12 && d.startsWith('91') ? d.slice(2) : (d.length === 11 && d.startsWith('0') ? d.slice(1) : d);
  return /^\d{10}$/.test(t) ? t : null;
};
const PHONE_LIKE = /^[+\d\s()-]{10,16}$/;

// Partner-side changes also leave an audit row (admin Activity tab, source 'partner'). Never throws.
const partnerAudit = async (req, targetId, action, details) => {
  try {
    const { getVerificationLogModel } = require('../models/VerificationLog');
    await getVerificationLogModel().create({
      adminId: req.user && req.user.id ? String(req.user.id) : 'partner',
      targetId: String(targetId),
      action,
      details: JSON.stringify({ ...details, source: String(req.user?.role || '').toLowerCase() === 'admin' ? 'admin' : 'partner' }).slice(0, 4000),
    });
  } catch (err) {
    console.warn('[PARTNER_AUDIT_WARN]', err.message);
  }
};

// @desc    Restaurant / vendor login
// @route   POST /api/restaurants/login
// Body: { phone, password, app? } (login phone; a stall may also use its WhatsApp number)
//    or { id | name | identifier, password, app? } (store UUID, exact store name, or a 10-digit phone)
const { isAccountLocked, recordAccountFailure, clearAccountFailures, syncAccountLock } = require('../middleware/lockoutMiddleware');
// C1-7: admin took a live store down (see Restaurant.suspendedAt).
const isSuspendedStore = (store) => !!store && store.isActive === false && !!store.suspendedAt;
const restaurantLogin = async (req, res) => {
  const body = req.body || {};
  const rawId = body.id || body.email || body.name || body.identifier;
  const id = rawId ? rawId.toString().trim() : '';
  const rawPhone = body.phone || body.partnerPhone;
  const { password } = body;
  const appKind = String(body.app || '').toLowerCase();

  let phone = rawPhone ? tenDigits(rawPhone) : null;
  if (!phone && id && PHONE_LIKE.test(id)) phone = tenDigits(id);

  if ((!id && !rawPhone) || !password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Phone (or Store ID) and password are required' });
  }

  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const Restaurant = getRestaurantModel();
    let restaurant = null;

    if (phone) {
      restaurant = await Restaurant.findOne({ where: { phone } });
      if (!restaurant) {
        // A stall created before login phones existed signs in with its WhatsApp number.
        const stalls = await Restaurant.findAll({
          where: { vendorType: { [Op.in]: LOCAL_VENDOR_TYPES }, whatsappNumber: { [Op.ne]: null } },
        });
        restaurant = stalls.find((s) => tenDigits(s.whatsappNumber) === phone) || null;
      }
    } else if (rawPhone) {
      restaurant = null; // not a phone number: same reply as a wrong password
    } else if (uuidRegex.test(id)) {
      restaurant = await Restaurant.findByPk(id);
    } else {
      // Exact store name, case-insensitive. Never a LIKE pattern: '%' used to log into any store.
      const { fn, col, where: sqlWhere } = require('sequelize');
      restaurant = await Restaurant.findOne({
        where: sqlWhere(fn('lower', col('name')), id.toLowerCase())
      });
    }

    // Same reply for an unknown store and a wrong password (no store-name probing).
    if (!restaurant) return res.status(401).json({ message: 'Invalid credentials' });

    if (!restaurant.password) {
      return res.status(401).json({ message: 'No password set for this account. Contact the admin to configure credentials.' });
    }
    // Lock per store (however it was identified) so rotating body fields cannot bypass the limit.
    const lockKey = `store-login:${restaurant.id}`;
    await syncAccountLock(lockKey); // B1: a lock set on another instance (no-op without REDIS_URL)
    if (isAccountLocked(lockKey)) {
      return res.status(429).json({ message: 'Account locked due to too many failed login attempts. Try again in 15 minutes.' });
    }
    const isMatch = await restaurant.comparePassword(password);
    if (!isMatch) {
      recordAccountFailure(lockKey);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    clearAccountFailures(lockKey);

    // Suspended by Zenvy (C1-7: a live store the admin switched off). Only after the password check,
    // so the status is never revealed to someone guessing. Drafts and the partner's own "closed" /
    // offline switches (isOpenNow / isOffline) never block the login.
    if (isSuspendedStore(restaurant)) {
      return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'This store has been suspended by ZCS. Please contact ZCS support to reactivate it.' });
    }

    if (appKind === 'vendor' && !isLocalVendorStore(restaurant)) {
      return res.status(403).json({ code: 'NOT_A_VENDOR_ACCOUNT', message: 'This is a restaurant account. Use the ZCS Restaurant app.' });
    }
    // Stalls use their own partner app (the restaurant app has no stall flow): In-Campus Booking stalls (pickup only)
    // ZCS Campus Stall, the others ZCS Vendor.
    if (appKind === 'restaurant' && isLocalVendorStore(restaurant)) {
      const message = restaurant.campusBookingEnabled === true
        ? 'This stall takes In-Campus Bookings. Use the ZCS Campus Stall app.'
        : 'This is a stall account. Use the ZCS Vendor app.';
      return res.status(403).json({ code: 'USE_VENDOR_APP', message });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[AUTH_FATAL] JWT_SECRET is not configured.');
      return res.status(500).json({ message: 'Server configuration error' });
    }
    // `tv` = tokenVersion: a password reset bumps it and signs out every older session.
    const token = jwt.sign({ id: restaurant.id, role: 'restaurant', tv: Number(restaurant.tokenVersion) || 0 }, secret, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });
    // Never send the password hash; include the live open/closed state for the partner app header.
    res.json({ restaurant: publicStoreJson(restaurant), token });
  } catch (error) {
    console.error('[RESTAURANT_LOGIN_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Sliding session for the restaurant / vendor apps (B28): a signed-in store swaps its
//          token for a fresh 30-day one. protect() already checked the tokenVersion (a password
//          change still signs every device out).
// @route   POST /api/restaurants/refresh-token
const refreshStoreToken = async (req, res) => {
  try {
    if (!req.user || String(req.user.role || '').toLowerCase() !== 'restaurant') {
      return res.status(403).json({ message: 'Only a store session can be refreshed here.' });
    }
    const Restaurant = getRestaurantModel();
    const store = await Restaurant.findByPk(req.user.id, { attributes: ['id', 'tokenVersion', 'isActive', 'suspendedAt'] });
    if (!store) return res.status(401).json({ message: 'Restaurant not found' });
    if (isSuspendedStore(store)) {
      return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'This store has been suspended by ZCS. Please contact ZCS support to reactivate it.' });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ message: 'Server configuration error' });
    const token = jwt.sign({ id: store.id, role: 'restaurant', tv: Number(store.tokenVersion) || 0 }, secret, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ token, expiresIn: 30 * 24 * 60 * 60, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (error) {
    console.error('[STORE_REFRESH_TOKEN_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Customer contact on a stall order is shown to the owning stall only; it is hidden again 24 h after
// the order finished (Delivered / Cancelled).
const CONTACT_TTL_MS = 24 * 60 * 60 * 1000;
// Rider-delivered orders: the kitchen sees only the customer's first name and the campus.
const { customerFirstName: firstName, campusLabel } = require('../utils/publicFields');

// @desc    Get orders for restaurant
// @route   GET /api/restaurants/:id/orders
const getRestaurantOrders = async (req, res) => {
  try {
    const isOwner = req.user.id === req.params.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to fetch orders for restaurant ${req.params.id}`);
      return res.status(403).json({ message: 'Not authorized to view these orders' });
    }

    const { getUserModel } = require('../models/User');
    const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');

    const Order = getOrderModel();
    const User = getUserModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    // ?scope=active (partner apps, B28): only open orders plus today's (IST) finished ones, so the
    // kitchen poll stays small. Default (no scope) is unchanged: the 200 most recent orders.
    const scopeActive = String(req.query.scope || '') === 'active';
    const where = { restaurantId: req.params.id };
    if (scopeActive) {
      const { Op } = require('sequelize');
      const { istStartOfDay } = require('../utils/istTime');
      where[Op.or] = [
        { status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
        { createdAt: { [Op.gte]: istStartOfDay() } },
      ];
    }
    const orders = await Order.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['name', 'phone', 'hostelBlock', 'roomNumber'] },
        { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['name', 'phone'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 200 // the partner app shows recent orders; an all-time list grows without bound
    });
    const now = Date.now();
    // The delivery PIN is only for the customer (the rider asks for it at the door).
    res.json(orders.map(o => {
      // The customer's exact pin (dropLat/dropLng) is for the assigned rider only, not the kitchen.
      const { deliveryPin, deliveryPinAttempts, dropLat, dropLng, idempotencyKey, user, ...rest } = o.toJSON();
      // Decided per order, never from the store's current type: a store switched between stall and
      // restaurant keeps showing its older orders with the flow they were placed with.
      const isStallOrder = rest.fulfilment === 'VENDOR';
      if (!isStallOrder) {
        // Zenvy rider delivers: the kitchen needs a name for the bag, not the customer's phone or room.
        return {
          ...rest,
          deliveryAddress: campusLabel(rest.deliveryAddress),
          user: user ? { name: firstName(user.name) } : null,
          _id: o.id,
        };
      }
      const finishedAt = ['Delivered', 'Cancelled'].includes(rest.status) ? new Date(rest.deliveredAt || rest.updatedAt).getTime() : null;
      const hidePhone = finishedAt !== null && now - finishedAt > CONTACT_TTL_MS;
      const customer = user ? {
        name: user.name || 'Customer',
        phone: hidePhone ? null : (user.phone || null),
        hostelBlock: user.hostelBlock || null,
        roomNumber: user.roomNumber || null,
      } : null;
      return {
        ...rest,
        fulfilment: 'VENDOR',
        outForDeliveryAt: rest.outForDeliveryAt || null,
        customer,
        user: customer ? { name: customer.name, phone: customer.phone } : null,
        _id: o.id,
      };
    }));
  } catch (error) {
    console.error('[GET_ORDERS_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all active restaurants
// @route   GET /api/restaurants
// Home catalogue cache: the full listing is rebuilt at most every HOME_CACHE_MS, and any store /
// product change (admin, partner app, realtime publish) clears it at once.
const HOME_CACHE_MS = 15 * 1000;
let homeCache = { at: 0, body: null };
try { require('./adminController').onRestaurantsCacheClear(() => { homeCache = { at: 0, body: null }; }); } catch { /* circular load: cache just expires */ }
const getRestaurants = async (req, res) => {
  try {
    if (homeCache.body && Date.now() - homeCache.at < HOME_CACHE_MS) return res.json(homeCache.body);
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    // Legacy inline base64 photos are nulled in SQL (never loaded into memory on the home feed).
    const { dataUrlSafeColumns } = require('../utils/imageStore');
    // Both queries are independent: run them together (one DB round trip of wall time, not two).
    const [restaurants, menuRows] = await Promise.all([
      Restaurant.findAll({
        where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()) },
        attributes: { exclude: ['imageUrl', 'logoUrl', ...PUBLIC_STORE_EXCLUDE], include: dataUrlSafeColumns('Restaurant', ['imageUrl', 'logoUrl']) },
      }),
      // Stitch all valid menu items into the restaurants array for catalog rendering
      MenuItem.findAll({
        where: { isAvailable: true },
        attributes: { exclude: ['imageUrl', ...PUBLIC_ITEM_EXCLUDE], include: dataUrlSafeColumns('MenuItem', ['imageUrl']) },
      }),
    ]);
    const allMenuItems = sortMenuItems(menuRows);
    const menuByStore = groupByRestaurant(allMenuItems);

    const fallbackImage = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
    const cleanImageUrl = (url) => {
      if (!url || typeof url !== 'string') return fallbackImage;
      if (url.startsWith('data:image/') || url.length > 1000) return fallbackImage;
      return url;
    };

    const augmentedRestaurants = restaurants.map(r => {
      const rJson = r.toJSON();
      stripStoreSecrets(rJson);
      applyFeaturedExpiry(rJson);
      rJson._id = rJson.id; // Map UUIDs to expected legacy Mongo _id formats
      rJson.imageUrl = cleanImageUrl(rJson.imageUrl || rJson.image);
      rJson.image = rJson.imageUrl;
      const openState = getStoreOpenState(r);
      rJson.isOpen = openState.isOpen;
      rJson.opensAt = openState.opensAt || null;
      Object.assign(rJson, require('../utils/deliverySlots').slotListingFields(r));
      rJson.menu = (menuByStore.get(r.id) || [])
        .map(m => {
          const item = m.toJSON();
          stripItemSecrets(item);
          // Ensure tags is an array (SQLite might return it as a string)
          if (typeof item.tags === 'string') {
            try { item.tags = JSON.parse(item.tags); } catch { item.tags = []; }
          }
          const cleanedImg = cleanImageUrl(item.imageUrl || item.image);
          return { ...item, _id: item.id, imageUrl: cleanedImg, image: cleanedImg };
        });
      return rJson;
    });

    homeCache = { at: Date.now(), body: augmentedRestaurants };
    res.json(augmentedRestaurants);
  } catch (error) {
    console.error('[RESTAURANT_ERROR]', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get menu for a specific restaurant (admin / partner menu order: specs.sortOrder)
// @route   GET /api/restaurants/:id/menu
const getRestaurantMenu = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const menu = await MenuItem.findAll({ where: { restaurantId: req.params.id }, attributes: { exclude: PUBLIC_ITEM_EXCLUDE } });
    res.json(sortMenuItems(menu).map((m) => stripItemSecrets(m.toJSON())));
  } catch (error) {
    console.error('[MENU_ERROR]', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a new restaurant (Admin only)
// @route   POST /api/restaurants
const createRestaurant = async (req, res) => {
  const { name, location, imageUrl, deliveryTime, commissionRate, isOffline, password } = req.body;
  try {
    const Restaurant = getRestaurantModel();
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ message: 'Store name is required.' });
    const { fn, col, where: sqlWhere } = require('sequelize');
    const clash = await Restaurant.findOne({ where: sqlWhere(fn('lower', col('name')), cleanName.toLowerCase()), attributes: ['id', 'name'] });
    if (clash) return res.status(409).json({ message: `Another store is already called "${clash.name}".`, code: 'CONFLICT' });
    const { storeImageRef } = require('../utils/imageStore');
    const img = await storeImageRef(imageUrl || null, { req, ownerId: req.user && req.user.id, purpose: 'store' });
    if (!img.ok) return res.status(img.status || 400).json({ message: img.message });
    const restaurant = await Restaurant.create({ name: cleanName, location, imageUrl: img.value, deliveryTime, commissionRate, isOffline, password });
    clearPublicRestaurantsCache();
    realtime.publish('store', 'created', restaurant.id, { storeId: restaurant.id });
    res.status(201).json(publicStoreJson(restaurant));
  } catch (error) {
    console.error('[CREATE_RESTAURANT_ERROR]', error);
    res.status(400).json({ message: 'Invalid restaurant data' });
  }
};

// @desc    Toggle menu item availability
// @route   PUT /api/restaurants/menu/:itemId/toggle
const toggleMenuItemAvailability = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'This menu item no longer exists. Pull to refresh your menu.', code: 'ITEM_NOT_FOUND' });

    // Security: Only the restaurant that owns the item or an admin can toggle it
    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to modify menu item ${item.id}`);
       return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    if (req.body.outOfStockUntil) {
      const until = new Date(req.body.outOfStockUntil);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Please choose a time in the future for the item to come back.' });
      }
      item.isAvailable = false;
      item.outOfStockUntil = until;
    } else if (req.body.isAvailable !== undefined) {
      item.isAvailable = req.body.isAvailable === true || req.body.isAvailable === 'true';
      if (item.isAvailable) {
        item.outOfStockUntil = null;
      }
    } else {
      item.isAvailable = !item.isAvailable;
      if (item.isAvailable) {
        item.outOfStockUntil = null;
      }
    }
    await item.save();

    clearPublicRestaurantsCache();
    const io = req.app.get('io');
    if (io) io.emit('inventory_updated', { itemId: item.id, restaurantId: item.restaurantId, isAvailable: item.isAvailable });
    realtime.publish('product', 'updated', item.id, { storeId: item.restaurantId, scope: 'stock' });
    partnerAudit(req, item.id, 'PARTNER_STOCK_TOGGLE', { restaurantId: item.restaurantId, isAvailable: item.isAvailable });

    res.json({ message: 'Item availability updated', _id: item.id, id: item.id, isAvailable: item.isAvailable, outOfStockUntil: item.outOfStockUntil || null });
  } catch (error) {
    console.error('[TOGGLE_MENU_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Whole category in or out of stock in one tap (partner apps' section switch).
// @route   PUT /api/restaurants/:id/menu/category-stock  { category: string, isAvailable: boolean }
//          Only the store's own items change. Category match is the one the partner apps group by:
//          the trimmed category text, and 'Other' also covers items with no category.
//          Back in stock clears any "back at" time; out of stock has no end time (like the single switch).
const CATEGORY_STOCK_MAX = 500;
const setCategoryStock = async (req, res) => {
  try {
    const isOwner = String(req.user.id) === String(req.params.id);
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not authorized to manage this menu' });
    const body = req.body || {};
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!category || category.length > 100) return res.status(400).json({ message: 'Choose a category.', code: 'INVALID_CATEGORY' });
    if (typeof body.isAvailable !== 'boolean') return res.status(400).json({ message: 'isAvailable must be true or false', code: 'INVALID_INPUT' });
    const isAvailable = body.isAvailable;

    const MenuItem = getMenuItemModel();
    const rows = await MenuItem.findAll({ where: { restaurantId: req.params.id }, attributes: ['id', 'category', 'isAvailable', 'outOfStockUntil'], limit: 5000 });
    const wanted = category.toLowerCase() === 'other' ? 'Other' : category;
    const inCategory = rows.filter((m) => {
      const c = typeof m.category === 'string' ? m.category.trim() : '';
      return (c || 'Other') === wanted;
    });
    if (!inCategory.length) return res.status(404).json({ message: 'No items in this category. Pull to refresh your menu.', code: 'CATEGORY_NOT_FOUND' });
    if (inCategory.length > CATEGORY_STOCK_MAX) return res.status(400).json({ message: 'This category is too big to switch at once.', code: 'TOO_MANY_ITEMS' });

    const toChange = inCategory.filter((m) => m.isAvailable !== isAvailable || (isAvailable && m.outOfStockUntil));
    const ids = toChange.map((m) => m.id);
    if (ids.length) {
      await MenuItem.update(
        isAvailable ? { isAvailable: true, outOfStockUntil: null } : { isAvailable: false, outOfStockUntil: null },
        { where: { id: { [Op.in]: ids }, restaurantId: req.params.id } },
      );
      clearPublicRestaurantsCache();
      const io = req.app.get('io');
      for (const id of ids) {
        if (io) io.emit('inventory_updated', { itemId: id, restaurantId: req.params.id, isAvailable });
        realtime.publish('product', 'updated', id, { storeId: req.params.id, scope: 'stock' });
      }
      partnerAudit(req, req.params.id, 'PARTNER_CATEGORY_STOCK', { restaurantId: req.params.id, category: wanted, isAvailable, items: ids.length });
    }
    res.json({
      category: wanted,
      isAvailable,
      updated: ids.length,
      total: inCategory.length,
      items: inCategory.map((m) => ({ id: m.id, _id: m.id, isAvailable, outOfStockUntil: ids.includes(m.id) ? null : (m.outOfStockUntil || null) })),
    });
  } catch (error) {
    console.error('[CATEGORY_STOCK_ERROR]', error);
    res.status(500).json({ message: 'Could not update this category right now. Please try again.' });
  }
};

// @desc    Update menu item tags (Dietary etc)
// @route   PUT /api/restaurants/menu/:itemId/tags
const updateMenuItemTags = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'This menu item no longer exists. Pull to refresh your menu.', code: 'ITEM_NOT_FOUND' });

    // Security check
    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to modify tags for menu item ${item.id}`);
       return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    const tags = cleanItemTags((req.body || {}).tags);
    if (tags === false) return res.status(400).json({ message: 'Tags must be a list of short words.' });
    item.tags = tags;
    // An "egg" tag also sets the food type (older app builds send egg dishes this way).
    if (tags.map((t) => t.toLowerCase()).includes('egg') && !item.dietType) {
      item.dietType = 'egg';
      item.isVegetarian = false;
    }
    await item.save();
    clearPublicRestaurantsCache();
    realtime.publish('product', 'updated', item.id, { storeId: item.restaurantId });

    res.json({ message: 'Item tags updated', _id: item.id, tags: item.tags });
  } catch (error) {
    console.error('[UPDATE_MENU_TAGS_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ── Menu item input (partner app + vendor app) ───────────────────
const DIET_TYPES = ['veg', 'nonveg', 'egg'];
const cleanText = (v) => String(v === null || v === undefined ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
// false = invalid input; otherwise a clean array of up to 20 tags of up to 30 chars.
const cleanItemTags = (tags) => {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags)) return false;
  return [...new Set(tags.filter((t) => typeof t === 'string').map((t) => cleanText(t).slice(0, 30)).filter(Boolean))].slice(0, 20);
};
const readSpecs = (specs) => {
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
};

class ItemInputError extends Error {}
// Item photos: media URL / hosted https kept; inline base64 sniffed and moved to the media table.
// `existing` = the item being edited: its current photo link passes unchanged.
const mediaizeItemImage = async (out, req, existing = null) => {
  if (out.imageUrl === undefined) return out;
  const { storeImageRef } = require('../utils/imageStore');
  const r = await storeImageRef(out.imageUrl, { req, ownerId: req.user && req.user.id, purpose: 'menu', keep: existing ? existing.imageUrl : null });
  if (!r.ok) throw new ItemInputError(r.message);
  out.imageUrl = r.value;
  return out;
};
// Validates and normalises the fields that were sent. `existing` = the row being edited (null on create).
const pickItemInput = (body = {}, existing = null) => {
  const out = {};
  const creating = !existing;
  if (creating || body.name !== undefined) {
    const name = cleanText(body.name);
    if (!name) throw new ItemInputError('Item name is required');
    if (name.length < 2 || name.length > 80) throw new ItemInputError('Item name must be 2 to 80 characters.');
    out.name = name;
  }
  if (creating || body.price !== undefined) {
    if (!validPrice(body.price)) throw new ItemInputError('Please enter a price greater than ₹0');
    out.price = Math.round(Number(body.price) * 100) / 100;
  }
  if (body.category !== undefined) {
    const category = cleanText(body.category);
    if (category.length > 40) throw new ItemInputError('Category must be 40 characters or fewer.');
    out.category = category || null;
  }
  if (body.description !== undefined) {
    const description = String(body.description === null ? '' : body.description).replace(/[<>]/g, '').trim();
    if (description.length > 300) throw new ItemInputError('Description must be 300 characters or fewer.');
    out.description = description || null;
  }
  if (body.imageUrl !== undefined) out.imageUrl = body.imageUrl ? String(body.imageUrl).trim() : null;
  if (body.isVegetarian !== undefined) out.isVegetarian = body.isVegetarian === true || body.isVegetarian === 'true';
  if (body.dietType !== undefined) {
    const d = body.dietType === null || body.dietType === '' ? null : String(body.dietType).toLowerCase().replace(/[^a-z]/g, '');
    const diet = d === 'nonvegetarian' ? 'nonveg' : d;
    if (diet !== null && !DIET_TYPES.includes(diet)) throw new ItemInputError("Food type must be veg, nonveg or egg.");
    out.dietType = diet;
    if (diet) out.isVegetarian = diet === 'veg';
  } else if (out.isVegetarian !== undefined && existing && existing.dietType) {
    // Veg switch from an older app build: keep dietType in step.
    out.dietType = out.isVegetarian ? 'veg' : (existing.dietType === 'veg' ? 'nonveg' : existing.dietType);
  }
  if (body.isAvailable !== undefined) {
    out.isAvailable = body.isAvailable === true || body.isAvailable === 'true';
    if (out.isAvailable) out.outOfStockUntil = null;
  } else if (creating) {
    out.isAvailable = true;
  }
  if (body.isEliteOnly !== undefined) out.isEliteOnly = body.isEliteOnly === true || body.isEliteOnly === 'true';
  // Delivery slots: a specialized (custom / designer) cake books 2½ hours before the slot.
  if (body.isSpecializedCake !== undefined) out.isSpecializedCake = body.isSpecializedCake === true || body.isSpecializedCake === 'true';
  if (body.tags !== undefined) {
    const tags = cleanItemTags(body.tags);
    if (tags === false) throw new ItemInputError('Tags must be a list of short words.');
    out.tags = tags;
    if (tags.map((t) => t.toLowerCase()).includes('egg') && out.dietType === undefined && !(existing && existing.dietType)) {
      out.dietType = 'egg';
      out.isVegetarian = false;
    }
  }
  const mrpSent = body.originalPrice !== undefined ? body.originalPrice : body.mrp;
  if (mrpSent !== undefined) {
    const specs = readSpecs(existing && existing.specs);
    if (mrpSent === null || mrpSent === '' || Number(mrpSent) === 0) {
      out.originalPrice = null;
      delete specs.originalPrice;
    } else {
      const mrp = Number(mrpSent);
      const price = out.price !== undefined ? out.price : Number(existing && existing.price);
      if (!Number.isFinite(mrp) || mrp <= 0 || mrp > 100000) throw new ItemInputError('MRP must be between ₹1 and ₹1,00,000.');
      if (Number.isFinite(price) && mrp < price) throw new ItemInputError('MRP cannot be lower than the selling price.');
      out.originalPrice = Math.round(mrp * 100) / 100;
      specs.originalPrice = out.originalPrice; // older readers use specs.originalPrice
    }
    out.specs = specs;
  } else if (out.price !== undefined && existing && Number(existing.originalPrice) > 0 && Number(existing.originalPrice) < out.price) {
    throw new ItemInputError('The new price is above the MRP. Update the MRP too.');
  }
  return out;
};

// @desc    Create Menu Item (Restaurant Portal / Vendor app)
// @route   POST /api/restaurants/menu
// Idempotency-Key → { at, promise } for POST /api/restaurants/menu (per store; in memory, 10 min).
const createItemIdem = new Map();
const CREATE_IDEM_TTL_MS = 10 * 60 * 1000;
const createMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();

    const restaurantId = req.user.role?.toLowerCase() === 'restaurant' ? req.user.id : req.body.restaurantId;
    if (!restaurantId) return res.status(400).json({ message: 'Restaurant ID required' });

    const isOwner = restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       return res.status(403).json({ message: 'Not authorized to create items for this restaurant' });
    }
    let data;
    try {
      data = await mediaizeItemImage(pickItemInput(req.body || {}), req);
    } catch (err) {
      if (err instanceof ItemInputError) return res.status(400).json({ message: err.message });
      throw err;
    }
    // Idempotency-Key (partner / vendor apps): a retry of the same "Add item" tap after a timeout returns
    // the item the first request created instead of adding it twice. A request still in flight is shared.
    const idemKey = String(req.get('Idempotency-Key') || '').trim().slice(0, 128);
    const cacheKey = idemKey ? `${restaurantId}:${idemKey}` : null;
    const cached = cacheKey ? createItemIdem.get(cacheKey) : null;
    if (cached && Date.now() - cached.at < CREATE_IDEM_TTL_MS) {
      const prior = await cached.promise.catch(() => null);
      if (prior) {
        const still = await MenuItem.findByPk(prior.id);
        if (still) return res.status(200).json({ ...stripItemSecrets(still.toJSON()), idempotentReplay: true });
      }
    }
    // Honour isAvailable / tags / food type in ONE write: an "out of stock" or egg dish is never live for a moment.
    const creating = MenuItem.create({ ...data, restaurantId });
    if (cacheKey) {
      for (const [k, v] of createItemIdem) if (Date.now() - v.at >= CREATE_IDEM_TTL_MS) createItemIdem.delete(k);
      createItemIdem.set(cacheKey, { at: Date.now(), promise: creating });
    }
    let newItem;
    try {
      newItem = await creating;
    } catch (err) {
      if (cacheKey) createItemIdem.delete(cacheKey);
      throw err;
    }

    clearPublicRestaurantsCache();
    realtime.publish('product', 'created', newItem.id, { storeId: newItem.restaurantId });
    res.status(201).json(stripItemSecrets(newItem.toJSON()));
  } catch (error) {
    console.error('[CREATE_MENU_ITEM_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update Menu Item (Restaurant Portal / Vendor app)
// @route   PUT /api/restaurants/menu/:itemId
const updateMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'This menu item no longer exists.', code: 'ITEM_NOT_FOUND' });

    // Security check
    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to update menu item ${item.id}`);
       return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    let updateData;
    try {
      updateData = await mediaizeItemImage(pickItemInput(req.body || {}, item), req, item);
    } catch (err) {
      if (err instanceof ItemInputError) return res.status(400).json({ message: err.message });
      throw err;
    }

    await item.update(updateData);
    clearPublicRestaurantsCache();
    realtime.publish('product', 'updated', item.id, { storeId: item.restaurantId });
    res.json(stripItemSecrets(item.toJSON()));
  } catch (error) {
    console.error('[UPDATE_MENU_ITEM_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// @desc    Delete a menu item (partner / vendor app). Past orders keep their own copy of the
//          item name and price, so a hard delete is safe; a basket holding it gets
//          "no longer available" from the quote.
// @route   DELETE /api/restaurants/menu/:itemId
const deleteMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const item = uuidRegex.test(String(req.params.itemId || '')) ? await MenuItem.findByPk(req.params.itemId) : null;
    // Not 'NOT_FOUND': the apps read that code as "route missing" (the /api catch-all).
    if (!item) return res.status(404).json({ message: 'This menu item no longer exists.', code: 'ITEM_NOT_FOUND' });

    const isOwner = item.restaurantId === req.user.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
      console.warn(`[SECURITY_WARN] User ${req.user.id} attempted to delete menu item ${item.id}`);
      return res.status(403).json({ message: 'Not authorized to manage this asset' });
    }

    const { id, restaurantId, name } = item;
    await item.destroy();
    clearPublicRestaurantsCache();
    realtime.publish('product', 'deleted', id, { storeId: restaurantId });
    const io = req.app.get('io');
    if (io) io.emit('systemUpdate', { type: 'MENU_ITEM_DELETED', data: { id, restaurantId } });
    partnerAudit(req, id, 'DELETE_MENU_ITEM', { id, name: String(name || '').slice(0, 60), restaurantId });
    res.json({ message: 'Item deleted', id });
  } catch (error) {
    console.error('[DELETE_MENU_ITEM_ERROR]', error);
    res.status(500).json({ message: 'Could not delete the item right now. Please try again.' });
  }
};

// ── CampusBites: Get Local Vendors ───────────────────────────
// @desc    Get all LOCAL_VENDOR stalls, optionally filtered by campus. Stalls are ordered inside
//          Zenvy (cash to the stall, the stall delivers it).
// @route   GET /api/restaurants/local-vendors
const getLocalVendors = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const { campus } = req.query;

    const where = { vendorType: { [Op.in]: LOCAL_VENDOR_TYPES }, isActive: true, ...(await require('../utils/receiptSettings').listingWhere()) };
    if (campus) where.campus = String(campus);
    // In-Campus Booking stalls are pickup-only (no delivery): they are listed under In-Campus Booking, not here.
    where[Op.and] = [{ [Op.or]: [{ campusBookingEnabled: false }, { campusBookingEnabled: null }] }];

    // Public list: legacy inline base64 photos are nulled in SQL (media URLs pass through).
    const { dataUrlSafeColumns } = require('../utils/imageStore');
    const vendors = await Restaurant.findAll({
      where,
      attributes: { exclude: ['imageUrl', 'logoUrl', ...PUBLIC_STORE_EXCLUDE], include: dataUrlSafeColumns('Restaurant', ['imageUrl', 'logoUrl']) },
      order: [['subscriptionTier', 'DESC'], ['rating', 'DESC']],
    });
    const vendorIds = vendors.map(v => v.id);

    // Batch-fetch menu items for all local vendors
    const allMenuItems = vendorIds.length > 0
      ? sortMenuItems(await MenuItem.findAll({
        where: { restaurantId: { [Op.in]: vendorIds } },
        attributes: { exclude: ['imageUrl', ...PUBLIC_ITEM_EXCLUDE], include: dataUrlSafeColumns('MenuItem', ['imageUrl']) },
      }))
      : [];
    const menuByVendor = groupByRestaurant(allMenuItems);

    // Ratings come only from real delivered-order ratings (no stored / invented store score).
    const ratingByVendor = await require('../utils/storeRatings').realRatingsFor(vendorIds);

    // Stall campus (free text such as 'SRM') matched to the real campus list (code or name).
    const { getCampusModel } = require('../modules/campus/models/Campus');
    const CampusModel = getCampusModel && getCampusModel();
    const campuses = CampusModel ? await CampusModel.findAll({ where: { isActive: true }, attributes: ['id', 'code', 'name'] }) : [];
    const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const campusFor = (raw) => {
      const k = norm(raw);
      if (!k) return null;
      return campuses.find((c) => norm(c.code) === k || norm(c.name) === k)
        || (k.length >= 3 ? campuses.find((c) => norm(c.code).startsWith(k) || norm(c.name).startsWith(k)) : null)
        || null;
    };

    const augmented = vendors.map(v => {
      const vJson = applyFeaturedExpiry(stripStoreSecrets(v.toJSON()));
      vJson._id = vJson.id;
      const open = getStoreOpenState(v);
      vJson.isOpen = open.isOpen && !v.isOffline;
      vJson.opensAt = open.opensAt || null;
      vJson.closesAt = vJson.isOpen ? (open.closesAt || null) : null;
      vJson.hoursToday = todayHoursText(v);
      vJson.closedReason = vJson.isOpen ? null : (open.message || `${v.name} is not taking orders on ZCS right now.`);
      Object.assign(vJson, require('../utils/deliverySlots').slotListingFields(v, { skip: !!v.isOffline }));
      vJson.fulfilment = 'VENDOR';
      vJson.paymentMethods = ['COD'];
      const rated = ratingByVendor.get(String(v.id));
      vJson.rating = rated ? rated.rating : 0;
      vJson.ratingCount = rated ? rated.ratingCount : 0;
      const campus = campusFor(v.campus);
      vJson.campusCode = campus ? campus.code : null;
      vJson.campusName = campus ? campus.name : null;
      vJson.menu = (menuByVendor.get(v.id) || [])
        .map(m => {
          const item = stripItemSecrets(m.toJSON());
          if (typeof item.tags === 'string') {
            try { item.tags = JSON.parse(item.tags); } catch { item.tags = []; }
          }
          return { ...item, _id: item.id };
        });
      return vJson;
    });
    // Featured (premium) stalls first, then open before closed, then by real rating.
    augmented.sort((a, b) =>
      ((b.subscriptionTier === 'premium') - (a.subscriptionTier === 'premium'))
      || ((b.isOpen === true) - (a.isOpen === true))
      || ((b.rating || 0) - (a.rating || 0))
      || String(a.name || '').localeCompare(String(b.name || '')));

    res.json(augmented);
  } catch (error) {
    console.error('[LOCAL_VENDOR_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// S1: click dedupe (memory, per instance, bounded). Key = IST day + viewer + store; cleared when the day changes.
const CLICK_DEDUPE_MAX = 50000;
const clickDedupe = (() => {
  let day = '';
  let seen = new Set();
  const istDay = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    firstToday(viewer, storeId) {
      const d = istDay();
      if (d !== day) { day = d; seen = new Set(); }
      const k = `${viewer}|${storeId}`;
      if (seen.has(k)) return false;
      if (seen.size >= CLICK_DEDUPE_MAX) seen.delete(seen.values().next().value);
      seen.add(k);
      return true;
    },
    reset() { day = ''; seen = new Set(); },
  };
})();
const clickViewerKey = (req) => {
  try {
    const h = String((req.headers && req.headers.authorization) || '');
    const raw = h.startsWith('Bearer ') ? h.slice(7) : (req.cookies && req.cookies.token) || null;
    if (raw && process.env.JWT_SECRET) {
      const d = require('jsonwebtoken').verify(String(raw).replace(/['"]+/g, '').trim(), process.env.JWT_SECRET);
      if (d && d.id) return `u:${d.role || ''}:${d.id}`;
    }
  } catch { /* signed out / bad token: by IP */ }
  return `ip:${req.ip || 'unknown'}`;
};

// ── CampusBites: Increment Click Counter ─────────────────────
// @desc    Increment visitor click analytics for a stall
// @route   POST /api/restaurants/:id/click
const incrementClickCount = async (req, res) => {
  try {
    // Public route: a non-UUID id made PostgreSQL throw (500 + error log per request).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id || ''))) {
      return res.status(404).json({ message: 'Vendor not found' });
    }
    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id, { attributes: ['id', 'clickCount'] });
    if (!restaurant) return res.status(404).json({ message: 'Vendor not found' });

    // S1: one counted click per store per viewer (signed-in account, else IP) per IST day.
    if (!clickDedupe.firstToday(clickViewerKey(req), restaurant.id)) {
      return res.json({ success: true, clickCount: restaurant.clickCount, counted: false });
    }
    await restaurant.increment('clickCount');
    res.json({ success: true, clickCount: restaurant.clickCount + 1 });
  } catch (error) {
    console.error('[CLICK_COUNT_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Toggle master offline state for restaurant
// @route   PUT /api/restaurants/:id/offline
const toggleRestaurantOffline = async (req, res) => {
  try {
    const isOwner = req.user.id === req.params.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
       return res.status(403).json({ message: 'Not authorized to change store status' });
    }

    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });

    restaurant.isOffline = !restaurant.isOffline;
    await restaurant.save();
    clearPublicRestaurantsCache();

    // Broadcast to riders/customers that the store state changed
    const io = req.app.get('io');
    if (io) io.emit('store_status_changed', { restaurantId: restaurant.id, isOffline: restaurant.isOffline });
    realtime.publish('store', 'updated', restaurant.id, { storeId: restaurant.id, scope: 'status' });

    res.json({ message: 'Store status updated', isOffline: restaurant.isOffline });
  } catch (error) {
    console.error('[TOGGLE_OFFLINE_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Open-state payload shared by /open and /hours (and the store_status_changed socket event).
const storeStatusPayload = (restaurant) => {
  const state = getStoreOpenState(restaurant);
  return {
    restaurantId: restaurant.id,
    isOpenNow: restaurant.isOpenNow,
    isOpen: state.isOpen,
    opensAt: state.opensAt || null,
    closedReason: state.isOpen ? null : (state.message || null),
    operatingHours: restaurant.operatingHours || null,
  };
};
const emitStoreStatus = (req, restaurant, payload) => {
  const io = req.app.get('io');
  if (io) {
    io.to(`restaurant_${restaurant.id}`).emit('store_status_changed', payload);
    io.emit('store_status_changed', { restaurantId: restaurant.id, isOpen: payload.isOpen });
  }
  realtime.publish('store', 'updated', restaurant.id, { storeId: restaurant.id, scope: 'status' });
};

// @desc    Store opens / closes for new orders (partner app header switch). This is NOT the
//          isOffline flag (which means "no phone at the shop" and sends orders straight to riders).
// @route   PUT /api/restaurants/:id/open  { isOpenNow: boolean }
const setRestaurantOpen = async (req, res) => {
  try {
    const isOwner = req.user.id === req.params.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not authorized to change store status' });
    const raw = (req.body || {}).isOpenNow;
    if (typeof raw !== 'boolean') return res.status(400).json({ message: 'isOpenNow must be true or false' });

    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });

    restaurant.isOpenNow = raw;
    await restaurant.save();
    clearPublicRestaurantsCache();

    const payload = storeStatusPayload(restaurant);
    emitStoreStatus(req, restaurant, payload);
    partnerAudit(req, restaurant.id, 'PARTNER_OPEN_SWITCH', { restaurantId: restaurant.id, isOpenNow: raw });
    res.json(payload);
  } catch (error) {
    console.error('[SET_OPEN_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Shop hours from the partner / vendor app.
// @route   PUT /api/restaurants/:id/hours  { operatingHours: { start: 'HH:MM', end: 'HH:MM', weekly? } }
//          start === end = open all day. `weekly` (mon..sun { open, start, end }) is optional.
const setRestaurantHours = async (req, res) => {
  try {
    const isOwner = req.user.id === req.params.id;
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not authorized to change store hours' });
    const input = (req.body || {}).operatingHours || req.body || {};
    const strictHHMM = /^\d{2}:\d{2}$/;
    if (!input.weekly && (!strictHHMM.test(String(input.start || '')) || !strictHHMM.test(String(input.end || '')))) {
      return res.status(400).json({ message: 'Please set opening and closing times like 09:00 and 22:00.' });
    }
    let hours;
    try {
      hours = normalizeOperatingHours(input);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    restaurant.operatingHours = hours;
    await restaurant.save();
    clearPublicRestaurantsCache();

    const payload = storeStatusPayload(restaurant);
    emitStoreStatus(req, restaurant, payload);
    partnerAudit(req, restaurant.id, 'PARTNER_HOURS', { restaurantId: restaurant.id, start: hours.start, end: hours.end, weekly: !!hours.weekly });
    res.json(payload);
  } catch (error) {
    console.error('[SET_HOURS_ERROR]', error);
    res.status(500).json({ message: 'Could not save your hours right now. Please try again.' });
  }
};

// @desc    Register / unregister this phone for new-order pushes while the app is closed.
// @route   POST /api/restaurants/fcm-token  { token | fcmToken, app?: 'restaurant'|'vendor'|'campusstall', remove?: true }
// @route   POST /api/restaurants/fcm-token/remove  { token }
const saveStoreFcmToken = async (req, res) => {
  try {
    if (String(req.user?.role || '').toLowerCase() !== 'restaurant') {
      return res.status(403).json({ message: 'Only a signed-in store can register for order alerts.' });
    }
    const body = req.body || {};
    const token = typeof (body.token || body.fcmToken) === 'string' ? (body.token || body.fcmToken).trim() : '';
    if (!require('../utils/fcmToken').FCM_TOKEN_RE.test(token)) return res.status(400).json({ message: 'A valid push token is required.' });
    const remove = body.remove === true || body.remove === 'true' || /\/remove$/.test(req.path);
    // 'campusstall' = ZCS Campus Stall (In-Campus Booking pushes go only to those devices: utils/storePush).
    const app = ['restaurant', 'vendor', 'campusstall'].includes(String(body.app || '').toLowerCase()) ? String(body.app).toLowerCase() : null;
    const { registerStoreToken } = require('../utils/storePush');
    const devices = await registerStoreToken(req.user.id, token, { app, remove });
    if (devices === null) return res.status(404).json({ message: 'Store not found' });
    res.json({ ok: true, registered: !remove, devices });
  } catch (error) {
    console.error('[STORE_FCM_TOKEN_ERROR]', error);
    res.status(500).json({ message: 'Could not save the push token. Please try again.' });
  }
};

// @desc    Get single menu item by ID
// @route   GET /api/restaurants/menu/item/:itemId
const getMenuItemById = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const Restaurant = getRestaurantModel();
    const item = await MenuItem.findByPk(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Menu item not found', code: 'ITEM_NOT_FOUND' });
    let restaurantName = 'Campus Restaurant';
    if (item.restaurantId) {
      const rest = await Restaurant.findByPk(item.restaurantId, { attributes: ['id', 'name'] });
      if (rest) restaurantName = rest.name;
    }
    const itemData = stripItemSecrets(item.toJSON ? item.toJSON() : { ...item });
    itemData.restaurantName = restaurantName;
    res.json(itemData);
  } catch (error) {
    console.error('[GET_ITEM_BY_ID_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  refreshStoreToken,
  getRestaurants,
  getRestaurantMenu,
  createRestaurant,
  restaurantLogin,
  getRestaurantOrders,
  toggleMenuItemAvailability,
  setCategoryStock,
  updateMenuItemTags,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getLocalVendors,
  incrementClickCount,
  toggleRestaurantOffline,
  setRestaurantOpen,
  setRestaurantHours,
  saveStoreFcmToken,
  getMenuItemById,
  publicStoreJson,
  _clickDedupe: clickDedupe,
};
