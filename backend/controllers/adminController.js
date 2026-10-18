const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getUserModel } = require('../models/User');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { getOrderModel } = require('../models/Order');
const { getVaultItemModel } = require('../models/VaultItem');
const { getGlobalConfigModel } = require('../models/GlobalConfig');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { Op } = require('sequelize');

const { getStoreOpenState, normalizeOperatingHours } = require('../utils/storeHours');
const { STORE_VENDOR_TYPES, isLocalVendorStore, isServiceVendorType } = require('../utils/vendorTypes');
const { sortMenuItems } = require('../utils/menuSort');

// Public restaurant listing cache: short TTL + cleared on every admin/vendor menu or status change.
let cachedRestaurantsResponse = null;
let cachedRestaurantsAt = 0;
const RESTAURANTS_CACHE_TTL_MS = 60 * 1000;
const extraCacheClears = [];
const responseCache = require('../utils/responseCache');
const clearRestaurantsCacheLocal = () => {
  cachedRestaurantsResponse = null;
  cachedRestaurantsAt = 0;
  try { responseCache.invalidate('catalog'); } catch { /* never break a write */ }
  for (const fn of extraCacheClears) { try { fn(); } catch { /* never break a write */ } }
};
// B1: with REDIS_URL set every other instance clears its listing caches too (utils/cacheBus).
const clearRestaurantsCache = require('../utils/cacheBus').wrap('restaurants.list', clearRestaurantsCacheLocal, { resync: clearRestaurantsCacheLocal });
exports.clearRestaurantsCache = clearRestaurantsCache;
// Other listing caches (GET /api/restaurants) register here so every store/product change clears them.
exports.onRestaurantsCacheClear = (fn) => { if (typeof fn === 'function') extraCacheClears.push(fn); };

// Columns public store / menu reads never return (stripStoreSecrets / stripItemSecrets drop them
// after the fact): leaving them out of the SELECT saves the DB round-trip payload and parsing.
const STORE_LISTING_EXCLUDE = ['password', 'fcmTokens', 'tokenVersion', 'commissionRate', 'commissionType', 'phone'];
const ITEM_LISTING_EXCLUDE = ['customCommission', 'ownerName', 'ownerPhone'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const realtime = require('../utils/realtime');
const { stripStoreSecrets, stripItemSecrets, applyFeaturedExpiry } = require('../utils/publicFields');
const { clearCachedUser } = require('../middleware/authMiddleware');
const { sendServerError } = require('../utils/httpErrors');

// Model rows in admin responses: never send password hashes to the browser.
const withoutPassword = (row) => {
  const json = row && typeof row.toJSON === 'function' ? row.toJSON() : { ...(row || {}) };
  delete json.password;
  return json;
};

// `systemUpdate` used to go to EVERY socket with full rows (rider rows with password hashes, wallet
// balances, coupons). Catalogue/config types still reach everyone (the customer home listens for them)
// but with IDs only; everything else goes to the admin room only, with secrets stripped.
const PUBLIC_SYSTEM_UPDATE_TYPES = new Set([
  'RESTAURANT_CREATED', 'RESTAURANT_UPDATED', 'RESTAURANT_DELETED', 'MENU_UPDATED', 'MENU_ITEM_DELETED',
  'GLOBAL_CONFIG_UPDATED', 'DATABASE_SEEDED', 'VAULT_UPDATED', 'VAULT_DELETED'
]);
const SECRET_KEYS = ['password', 'otp', 'otpHash', 'token', 'fcmToken', 'pushToken', 'resetToken', 'deliveryPin', 'pin'];
const stripSecrets = (data) => {
  if (!data || typeof data !== 'object') return data;
  const plain = typeof data.toJSON === 'function' ? data.toJSON() : { ...data };
  for (const k of SECRET_KEYS) delete plain[k];
  return plain;
};
const broadcastSystemUpdate = (req, type, data) => {
  const io = req.app.get('io');
  if (!io) return;
  if (PUBLIC_SYSTEM_UPDATE_TYPES.has(type)) {
    const d = data || {};
    io.emit('systemUpdate', { type, data: { id: d.id ?? null, restaurantId: d.restaurantId ?? null } });
  } else {
    io.to('admin-room').emit('systemUpdate', { type, data: stripSecrets(data) });
  }
};

exports.getSystemHealth = async (req, res) => {
  try {
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    const dialect = sequelize.getDialect();
    res.json({
      database: dialect.toUpperCase(),
      persistence: dialect === 'postgres' ? 'PERSISTENT' : 'VOLATILE',
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({ message: 'Health Check Failed' });
  }
};

// Order columns that may hold inline base64 photos or secrets: never needed in admin lists.
const HEAVY_ORDER_COLUMNS = ['proofImage', 'itemPhotoUrl', 'billProofUrl', 'upiScreenshot', 'deliveryPin'];

const logAuditAction = async (req, targetId, action, details) => {
  try {
    const VerificationLog = getVerificationLogModel();
    await VerificationLog.create({
      adminId: req.user?.id ? req.user.id.toString() : 'admin_default',
      targetId: targetId ? targetId.toString() : 'global',
      action,
      details: String(typeof details === 'string' ? details : JSON.stringify(details) ?? '').slice(0, 8000),
    });
  } catch (error) {
    console.error('[AUDIT_LOG_ERROR]', error);
  }
};

// ─── Public Endpoints ─────────────────────────────────────────
exports.getRestaurants = async (req, res) => {
  try {
    // Stores (grocery, pharmacy, add-ons, …) are browsed via /api/catalogue; ?includeStores=true lists them too.
    const includeStores = String(req.query.includeStores || '').toLowerCase() === 'true';
    const fresh = cachedRestaurantsResponse && (Date.now() - cachedRestaurantsAt) < RESTAURANTS_CACHE_TTL_MS;
    if (fresh) {
      const list = includeStores ? cachedRestaurantsResponse : cachedRestaurantsResponse.filter(r => !STORE_VENDOR_TYPES.includes(String(r.vendorType || '').toUpperCase()));
      return res.json(list);
    }

    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const { Op } = require('sequelize');

    // Batch-fetch all restaurants and their menu items in 2 queries (eliminates N+1)
    // Secrets are stripped from the response anyway: never read them (or push tokens) per listing.
    const restaurants = await Restaurant.findAll({ where: { isActive: true }, attributes: { exclude: STORE_LISTING_EXCLUDE } });
    const restaurantIds = restaurants.map(r => r.id);

    const allMenuItems = restaurantIds.length > 0
      ? await MenuItem.findAll({ where: { restaurantId: { [Op.in]: restaurantIds } }, attributes: { exclude: ITEM_LISTING_EXCLUDE } })
      : [];

    // Index menu items by restaurantId for O(1) lookup
    const fallbackImage = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
    const cleanImageUrl = (url) => {
      if (!url || typeof url !== 'string') return fallbackImage;
      if (url.startsWith('data:image/') || url.length > 1000) return fallbackImage;
      return url;
    };

    const menuByRestaurant = {};
    for (const m of allMenuItems) {
      const mObj = stripItemSecrets(m.toJSON());
      let mTags = mObj.tags || [];
      if (typeof mTags === 'string') {
        try { mTags = JSON.parse(mTags); } catch { mTags = []; }
      }
      const cleanedImg = cleanImageUrl(mObj.imageUrl || mObj.image);
      const item = { ...mObj, tags: mTags, _id: m.id, id: m.id, image: cleanedImg, imageUrl: cleanedImg };
      if (!menuByRestaurant[m.restaurantId]) menuByRestaurant[m.restaurantId] = [];
      menuByRestaurant[m.restaurantId].push(item);
    }

    for (const id of Object.keys(menuByRestaurant)) menuByRestaurant[id] = sortMenuItems(menuByRestaurant[id]);

    const result = restaurants.map(r => {
      const rObj = r.toJSON();
      stripStoreSecrets(rObj);
      applyFeaturedExpiry(rObj);
      const openState = getStoreOpenState(r);
      let tags = rObj.tags || [];
      if (typeof tags === 'string') {
        try { tags = JSON.parse(tags); } catch { tags = []; }
      }
      const cleanedImg = cleanImageUrl(rObj.imageUrl || rObj.image);
      return {
        ...rObj,
        _id: r.id,
        id: r.id,
        imageUrl: cleanedImg,
        image: cleanedImg,
        tags,
        categories: tags,
        // Real delivery time only when the restaurant has set one (no invented ETA)
        time: rObj.deliveryTime ? `${rObj.deliveryTime} min` : null,
        rating: rObj.rating > 0 ? rObj.rating : null,
        isOpen: openState.isOpen,
        opensAt: openState.opensAt || null,
        closedReason: openState.isOpen ? null : (openState.message || null),
        menu: menuByRestaurant[r.id] || []
      };
    });

    cachedRestaurantsResponse = result;
    cachedRestaurantsAt = Date.now();
    res.json(includeStores ? result : result.filter(r => !STORE_VENDOR_TYPES.includes(String(r.vendorType || '').toUpperCase())));
  } catch (error) {
    console.error('[RESTAURANTS_ERROR]', error);
    res.status(500).json({ message: 'Could not load restaurants right now. Pull down to refresh.' });
  }
};

exports.getRestaurantById = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(404).json({ message: 'Restaurant not found' });
    // Store and its menu in parallel (one DB round trip of wall time, not two); the menu of an unknown
    // id is simply empty and discarded.
    const [restaurant, menu] = await Promise.all([
      Restaurant.findByPk(req.params.id, { attributes: { exclude: STORE_LISTING_EXCLUDE } }),
      MenuItem.findAll({ where: { restaurantId: req.params.id }, attributes: { exclude: ITEM_LISTING_EXCLUDE } }),
    ]);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    const resObj = restaurant.toJSON();
    stripStoreSecrets(resObj);
    applyFeaturedExpiry(resObj);
    let tags = resObj.tags || [];
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }

    const openState = getStoreOpenState(restaurant);
    // CampusBites stalls: rating only from real order ratings, plus today's hours for the stall page.
    const stallExtra = {};
    if (isLocalVendorStore(restaurant)) {
      const rated = (await require('../utils/storeRatings').realRatingsFor([restaurant.id])).get(String(restaurant.id));
      stallExtra.rating = rated ? rated.rating : null;
      stallExtra.ratingCount = rated ? rated.ratingCount : 0;
      stallExtra.hoursToday = require('../utils/storeHours').todayHoursText(restaurant);
      stallExtra.fulfilment = 'VENDOR';
      stallExtra.paymentMethods = ['COD'];
    }
    res.json({ 
      ...resObj, 
      _id: restaurant.id, 
      id: restaurant.id,
      tags,
      categories: tags,
      time: resObj.deliveryTime ? `${resObj.deliveryTime} min` : null,
      rating: resObj.rating > 0 ? resObj.rating : null,
      isOpen: openState.isOpen,
      opensAt: openState.opensAt || null,
      closedReason: openState.isOpen ? null : (openState.message || null),
      ...stallExtra,
      menu: sortMenuItems(menu).map(m => {
        const mObj = stripItemSecrets(m.toJSON());
        let mTags = mObj.tags || [];
        if (typeof mTags === 'string') {
          try { mTags = JSON.parse(mTags); } catch { mTags = []; }
        }
        return { ...mObj, tags: mTags, _id: m.id, id: m.id, image: mObj.imageUrl || mObj.image };
      })
    });
  } catch (error) {
    console.error('[GET_RESTAURANT_BY_ID_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getMenuItemById = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const Restaurant = getRestaurantModel();
    const VaultItem = getVaultItemModel();
    const id = String(req.params.id || '').trim();
    if (!UUID_RE.test(id)) return res.status(404).json({ message: 'This product is not available any more.', code: 'PRODUCT_NOT_FOUND' });

    const item = await MenuItem.findByPk(id);
    if (!item) {
      // Daily-deal (vault) items are claimed through POST /api/vault/claim/:id, never added to a basket.
      const vault = await VaultItem.findByPk(id);
      if (!vault) return res.status(404).json({ message: 'This product is not available any more.', code: 'PRODUCT_NOT_FOUND' });
      const v = vault.toJSON();
      return res.json({
        ...v,
        _id: vault.id,
        id: vault.id,
        image: v.imageUrl || v.image,
        isVaultItem: true,
        orderable: false,
        restaurantName: 'Zenvy Daily Deals',
        restaurantId: null
      });
    }

    const restaurant = await Restaurant.findByPk(item.restaurantId, { attributes: { exclude: STORE_LISTING_EXCLUDE } });
    const itemObj = stripItemSecrets(item.toJSON());
    let tags = itemObj.tags || [];
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }
    const specs = readItemSpecs(itemObj.specs);
    const now = new Date();
    const inStock = !!itemObj.isAvailable || !!(itemObj.outOfStockUntil && new Date(itemObj.outOfStockUntil) <= now);
    const openState = restaurant ? getStoreOpenState(restaurant) : { isOpen: false };
    // Service stores (laundry, print, repairs, tailoring) are booked, never ordered, flag or not.
    const bookingOnly = !!specs.bookingOnly || (!!restaurant && isServiceVendorType(restaurant.vendorType));
    const stall = isLocalVendorStore(restaurant);
    res.json({
      ...itemObj,
      _id: item.id,
      id: item.id,
      tags,
      image: itemObj.imageUrl || itemObj.image,
      originalPrice: itemObj.originalPrice || specs.originalPrice || null,
      dietType: itemObj.dietType || (itemObj.isVegetarian === false ? 'nonveg' : 'veg'),
      weight: specs.weight || null,
      rating: specs.rating || null,
      ratingCount: specs.ratingCount || 0,
      isAvailable: inStock,
      bookingOnly,
      // CampusBites stalls are ordered in Zenvy: cash to the stall, the stall delivers it.
      orderable: inStock && !bookingOnly && !!restaurant && restaurant.isActive !== false && !(stall && restaurant.isOffline) && openState.isOpen,
      directOrderOnly: false,
      ...(stall ? { fulfilment: 'VENDOR', paymentMethods: ['COD'], whatsappNumber: restaurant.whatsappNumber || null } : {}),
      restaurantName: restaurant ? restaurant.name : null,
      restaurantId: restaurant ? restaurant.id : null,
      vendorType: restaurant ? restaurant.vendorType : null,
      storeIsOpen: openState.isOpen,
      storeClosedReason: openState.isOpen ? null : (openState.message || null)
    });
  } catch (error) {
    console.error('[GET_PRODUCT_ERROR]', error);
    res.status(500).json({ message: 'Could not load this product right now. Please try again.' });
  }
};

exports.searchAll = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ restaurants: [], items: [] });
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();

    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    const isPostgres = sequelize && typeof sequelize.getDialect === 'function' && sequelize.getDialect() === 'postgres';
    const matchOp = isPostgres ? Op.iLike : Op.like;

    const matchedRestaurants = await Restaurant.findAll({
      where: {
        name: { [matchOp]: `%${q}%` },
        isActive: true
      }
    });

    const matchedItems = await MenuItem.findAll({
      where: {
        [Op.or]: [
          { name: { [matchOp]: `%${q}%` } },
          { category: { [matchOp]: `%${q}%` } }
        ],
        isAvailable: true
      }
    });

    res.json({
      restaurants: matchedRestaurants.map(r => ({ ...r.toJSON(), _id: r.id })),
      items: matchedItems.map(m => ({ ...m.toJSON(), _id: m.id }))
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── Restaurant & Menu Control ────────────────────────────────
// Stores (restaurants, non-food stores, CampusBites stalls) are Restaurant rows; their products are MenuItem rows.
// Admin writes go through explicit field lists: rating / clickCount are never set by hand (they come from
// real reviews and taps), and the portal password hash is never sent back or broadcast.

class AdminInputError extends Error {}

// Image fields from the dashboard (imageUrl / logoUrl): a media URL or hosted https image is
// kept; inline base64 is sniffed and moved to the media table (short URL stored); anything else
// (data:text/html, SVG, huge strings) is rejected.
const mediaizeImageFields = async (out, req, keys, purpose) => {
  const { storeImageRef } = require('../utils/imageStore');
  for (const key of keys) {
    if (out[key] === undefined) continue;
    const r = await storeImageRef(out[key], { req, ownerId: req.user && req.user.id, purpose });
    if (!r.ok) throw new AdminInputError(`${key === 'logoUrl' ? 'Logo' : 'Photo'}: ${r.message}`);
    out[key] = r.value;
  }
  return out;
};

// brandTheme can carry photos too (logo / banner): never store them inline (see healStoreImages).
const mediaizeBrandTheme = async (out, req) => {
  const brand = out.brandTheme;
  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) return out;
  const { storeImageRef, isDataUrl } = require('../utils/imageStore');
  const next = { ...brand };
  for (const [k, v] of Object.entries(next)) {
    if (!isDataUrl(v)) continue;
    const r = await storeImageRef(v, { req, ownerId: req.user && req.user.id, purpose: 'store' });
    if (!r.ok) throw new AdminInputError(`Brand image: ${r.message}`);
    next[k] = r.value;
  }
  out.brandTheme = next;
  return out;
};

const RESTAURANT_FIELDS = [
  'name', 'location', 'imageUrl', 'vendorType', 'deliveryTime', 'commissionRate', 'commissionType',
  'tags', 'operatingHours', 'isActive', 'isOffline', 'isOpenNow', 'zone', 'lat', 'lon',
  'isFeatured', 'featuredUntil', 'featuredBadge', 'promoOffer', 'campus', 'whatsappNumber',
  'subscriptionTier', 'stallDescription', 'brandTheme',
  // 2026-10-12: partner login phone (alias partnerPhone), per-store fees, logo without brand theme
  'phone', 'packagingFee', 'minOrderValue', 'logoUrl'
];
const MENU_ITEM_FIELDS = [
  'name', 'price', 'description', 'imageUrl', 'category', 'tags', 'isVegetarian', 'isAvailable',
  'outOfStockUntil', 'isEliteOnly', 'customCommission', 'specs', 'ownerName', 'ownerPhone',
  'dietType', 'originalPrice'
];
const DIET_TYPES = ['veg', 'nonveg', 'egg'];
// 10-digit Indian mobile from any common spelling (+91…, 91…, spaces). null when empty; false when invalid.
const tenDigitPhone = (v) => {
  const digits = String(v || '').replace(/\D/g, '');
  if (!digits) return null;
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : (digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits);
  return /^[6-9]\d{9}$/.test(ten) ? ten : false;
};
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const cleanTags = (tags) => (Array.isArray(tags) ? tags : String(tags || '').split(','))
  .map((t) => String(t).trim()).filter(Boolean).slice(0, 30);

const publicRestaurant = (r) => {
  const json = r && typeof r.toJSON === 'function' ? r.toJSON() : { ...(r || {}) };
  const hasPassword = !!json.password;
  const pushDevices = Array.isArray(json.fcmTokens) ? json.fcmTokens.length : 0;
  delete json.password;
  delete json.fcmTokens;
  delete json.tokenVersion;
  return {
    ...json,
    _id: json.id,
    partnerPhone: json.phone || null, // admin UI name for the same login phone
    hasPassword,
    pushDevices,
    // Older live stores were published before publishedAt existed.
    publishedAt: json.publishedAt || (json.isActive ? json.createdAt : null) || null,
  };
};

const pickRestaurantFields = (body = {}, { creating = false } = {}) => {
  const out = {};
  for (const key of RESTAURANT_FIELDS) if (body[key] !== undefined) out[key] = body[key];
  if (out.phone === undefined && body.partnerPhone !== undefined) out.phone = body.partnerPhone;
  if (out.phone !== undefined) {
    const ten = tenDigitPhone(out.phone);
    if (ten === false) throw new AdminInputError('Login phone must be a 10-digit Indian mobile number.');
    out.phone = ten; // null clears it
  }
  for (const [key, max, label] of [['packagingFee', 500, 'Packaging fee'], ['minOrderValue', 5000, 'Minimum order']]) {
    if (out[key] === undefined) continue;
    if (out[key] === null || out[key] === '') { out[key] = 0; continue; }
    const n = Number(out[key]);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new AdminInputError(`${label} must be between ₹0 and ₹${max}.`);
    out[key] = Math.round(n * 100) / 100;
  }
  if (out.logoUrl !== undefined) out.logoUrl = String(out.logoUrl || '').trim() || null;

  if (creating || out.name !== undefined) {
    out.name = String(out.name || '').trim();
    if (!out.name) throw new AdminInputError('Store name is required.');
    if (out.name.length > 120) throw new AdminInputError('Store name must be 120 characters or fewer.');
  }
  if (creating || out.location !== undefined) out.location = String(out.location || '').trim() || 'Main Campus';
  if (out.vendorType !== undefined) {
    out.vendorType = String(out.vendorType || '').trim().toUpperCase().replace(/[^A-Z_]/g, '');
    if (!out.vendorType) throw new AdminInputError('Pick a store type.');
  }
  if (out.deliveryTime !== undefined) {
    if (out.deliveryTime === null || out.deliveryTime === '') out.deliveryTime = null;
    else {
      const n = Number(out.deliveryTime);
      if (!Number.isInteger(n) || n < 5 || n > 240) throw new AdminInputError('Delivery time must be a whole number of minutes between 5 and 240.');
      out.deliveryTime = n;
    }
  }
  if (out.commissionType !== undefined && !['percentage', 'flat'].includes(out.commissionType)) {
    throw new AdminInputError("Commission type must be 'percentage' or 'flat'.");
  }
  if (out.commissionRate !== undefined) {
    const n = Number(out.commissionRate);
    const max = (out.commissionType || body.commissionType) === 'flat' ? 1000 : 100;
    if (!Number.isFinite(n) || n < 0 || n > max) throw new AdminInputError(`Commission must be between 0 and ${max}.`);
    out.commissionRate = n;
  }
  if (out.operatingHours !== undefined) {
    // { start, end } plus optional per-day `weekly: { mon: { open, start, end }, … }` (kept, validated).
    try {
      out.operatingHours = normalizeOperatingHours(out.operatingHours);
    } catch (err) {
      throw new AdminInputError(err.message);
    }
  }
  if (out.whatsappNumber !== undefined) {
    const digits = String(out.whatsappNumber || '').replace(/\D/g, '');
    const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
    if (!ten) out.whatsappNumber = null;
    else if (!/^[6-9]\d{9}$/.test(ten)) throw new AdminInputError('WhatsApp number must be a 10-digit Indian mobile number.');
    else out.whatsappNumber = `91${ten}`; // same format as wa.me links and the existing rows
  }
  if (out.tags !== undefined) out.tags = cleanTags(out.tags);
  for (const key of ['isActive', 'isOffline', 'isOpenNow', 'isFeatured']) if (out[key] !== undefined) out[key] = toBool(out[key]);
  if (out.featuredUntil === '') out.featuredUntil = null;
  for (const key of ['lat', 'lon']) {
    if (out[key] === undefined) continue;
    if (out[key] === null || out[key] === '') { out[key] = null; continue; }
    const n = Number(out[key]);
    if (!Number.isFinite(n)) throw new AdminInputError('Latitude and longitude must be numbers.');
    out[key] = n;
  }
  return out;
};

const readItemSpecs = (specs) => {
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
};

// specs are merged into the stored ones (bookingOnly, weight, brand, extraFor... are kept); a key sent as null is removed.
const pickMenuItemFields = (body = {}, existing = null) => {
  const out = {};
  for (const key of MENU_ITEM_FIELDS) if (body[key] !== undefined) out[key] = body[key];
  if (out.imageUrl === undefined && body.image !== undefined) out.imageUrl = body.image;

  if (!existing || out.name !== undefined) {
    out.name = String(out.name || '').trim();
    if (!out.name) throw new AdminInputError('Product name is required.');
    if (out.name.length > 200) throw new AdminInputError('Product name must be 200 characters or fewer.');
  }
  if (!existing || out.price !== undefined) {
    const price = Number(out.price);
    if (!Number.isFinite(price) || price < 0 || price > 100000) throw new AdminInputError('Price must be between ₹0 and ₹1,00,000.');
    out.price = Math.round(price * 100) / 100;
  }
  if (out.imageUrl !== undefined) out.imageUrl = String(out.imageUrl || '').trim() || null;
  if (out.category !== undefined) out.category = String(out.category || '').trim() || null;
  if (out.tags !== undefined) out.tags = cleanTags(out.tags);
  for (const key of ['isVegetarian', 'isAvailable', 'isEliteOnly']) if (out[key] !== undefined) out[key] = toBool(out[key]);
  if (out.outOfStockUntil === '') out.outOfStockUntil = null;
  if (out.isAvailable === true) out.outOfStockUntil = null;
  if (out.dietType !== undefined) {
    out.dietType = out.dietType === null || out.dietType === '' ? null : String(out.dietType).toLowerCase().replace(/[^a-z]/g, '');
    if (out.dietType === 'nonvegetarian') out.dietType = 'nonveg';
    if (out.dietType !== null && !DIET_TYPES.includes(out.dietType)) throw new AdminInputError("Food type must be 'veg', 'nonveg' or 'egg'.");
    if (out.dietType) out.isVegetarian = out.dietType === 'veg';
  }
  if (out.originalPrice !== undefined) {
    // Column + specs.originalPrice are kept in step (older readers use specs).
    const mrpRaw = out.originalPrice;
    delete out.originalPrice;
    out.specs = { ...readItemSpecs(out.specs), originalPrice: mrpRaw === null || mrpRaw === '' ? null : mrpRaw };
  }

  if (out.specs !== undefined) {
    const incoming = readItemSpecs(out.specs);
    const merged = { ...readItemSpecs(existing && existing.specs) };
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null || value === '') delete merged[key];
      else merged[key] = value;
    }
    if (merged.originalPrice !== undefined) {
      const mrp = Number(merged.originalPrice);
      const price = out.price !== undefined ? out.price : Number(existing && existing.price);
      if (!Number.isFinite(mrp) || mrp <= 0 || mrp > 100000) throw new AdminInputError('MRP must be a positive amount.');
      if (Number.isFinite(price) && mrp < price) throw new AdminInputError('MRP cannot be lower than the selling price.');
      merged.originalPrice = Math.round(mrp * 100) / 100;
    }
    out.specs = merged;
    out.originalPrice = merged.originalPrice !== undefined ? merged.originalPrice : null;
  }
  return out;
};

// Partner sign-in uses the exact store name and the login phone, so both must be unique.
// Throws a 409-style AdminConflictError. `selfId` is excluded (edits).
class AdminConflictError extends Error {}
const assertUniqueStore = async ({ name, phone }, selfId = null) => {
  const Restaurant = getRestaurantModel();
  const { fn, col, where: sqlWhere } = require('sequelize');
  const notSelf = selfId ? { id: { [Op.ne]: selfId } } : {};
  if (name) {
    const clash = await Restaurant.findOne({ where: { [Op.and]: [sqlWhere(fn('lower', col('name')), String(name).trim().toLowerCase()), notSelf] }, attributes: ['id', 'name'] });
    if (clash) throw new AdminConflictError(`Another store is already called "${clash.name}". Partners sign in with the store name, so pick a different one.`);
  }
  if (phone) {
    const clash = await Restaurant.findOne({ where: { phone, ...notSelf }, attributes: ['id', 'name'] });
    if (clash) throw new AdminConflictError(`This phone number already signs in to ${clash.name}.`);
  }
};

const sendAdminError = (res, error, fallback) => {
  if (error instanceof AdminInputError) return res.status(400).json({ message: error.message });
  if (error instanceof AdminConflictError) return res.status(409).json({ message: error.message, code: 'CONFLICT' });
  if (error && error.name === 'SequelizeValidationError') return res.status(400).json({ message: error.errors?.[0]?.message || fallback });
  console.error('[ADMIN_CATALOGUE_ERROR]', error);
  return res.status(500).json({ message: fallback });
};

// ── Legacy inline photos in admin lists ──────────────────────────────────────
// Old rows can still hold inline base64 photos (data:image/...;base64, several MB each) in imageUrl /
// logoUrl / brandTheme.*: the startup migration skips values it cannot move and the public lists hide
// them, but the admin lists shipped them raw. With a few dozen such stores GET /api/admin/restaurants
// was hundreds of MB and the /restaurants page crashed the browser tab (renderer out of memory), again
// on every live refresh. Now each inline photo is moved to the media table the first time a list sees
// it (conditional write: a concurrent edit wins) and the short URL is returned; a value that cannot be
// moved is left in the row but never sent in a list (null in the payload).
const LIST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const BRAND_IMAGE_KEYS = ['logoUrl', 'bannerUrl', 'coverUrl', 'imageUrl', 'heroImage', 'backgroundImage', 'backgroundUrl'];
const healInlineImage = async (Model, row, column, value, req, ownerId, purpose) => {
  const { storeImageRef, isDataUrl } = require('../utils/imageStore');
  if (!isDataUrl(value)) return value;
  try {
    const r = await storeImageRef(value, { req, ownerId, purpose, maxBytes: LIST_IMAGE_MAX_BYTES });
    if (!r.ok || !r.value || isDataUrl(r.value)) return null;
    if (column) await Model.update({ [column]: r.value }, { where: { id: row.id, [column]: value } });
    return r.value;
  } catch (err) {
    console.warn('[ADMIN_INLINE_IMAGE_WARN]', Model.name, row.id, column, err.message);
    return null;
  }
};
// Returns the row's JSON with every inline photo replaced (moved) or removed.
const healStoreImages = async (restaurant, req) => {
  const { isDataUrl } = require('../utils/imageStore');
  const json = restaurant.toJSON();
  const Restaurant = getRestaurantModel();
  let changed = false;
  for (const col of ['imageUrl', 'logoUrl']) {
    if (!isDataUrl(json[col])) continue;
    json[col] = await healInlineImage(Restaurant, restaurant, col, json[col], req, restaurant.id, 'store');
    changed = true;
  }
  const brand = json.brandTheme && typeof json.brandTheme === 'object' ? { ...json.brandTheme } : null;
  if (brand && BRAND_IMAGE_KEYS.some((k) => isDataUrl(brand[k]))) {
    let allMoved = true;
    for (const k of BRAND_IMAGE_KEYS) {
      if (!isDataUrl(brand[k])) continue;
      const moved = await healInlineImage(Restaurant, restaurant, null, brand[k], req, restaurant.id, 'store');
      if (moved) brand[k] = moved; else { delete brand[k]; allMoved = false; }
    }
    if (allMoved) {
      try { await Restaurant.update({ brandTheme: JSON.stringify(brand) }, { where: { id: restaurant.id }, validate: false }); /* static update skips the JSON setter: write the text (an object became "[object Object]") */ } catch (err) { console.warn('[ADMIN_INLINE_IMAGE_WARN] brandTheme', restaurant.id, err.message); }
    }
    json.brandTheme = brand;
    changed = true;
  }
  if (changed) {
    // Keep publicRestaurant's input shape (toJSON) without the heavy values.
    return { toJSON: () => json };
  }
  return restaurant;
};

exports.getAllRestaurants = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const { fn, col } = require('sequelize');
    const [restaurants, counts] = await Promise.all([
      // password is read only to report hasPassword (never sent).
      Restaurant.findAll({ order: [['name', 'ASC']] }),
      MenuItem.findAll({ attributes: ['restaurantId', [fn('COUNT', col('id')), 'count']], group: ['restaurantId'], raw: true })
    ]);
    const countBy = new Map(counts.map((c) => [c.restaurantId, Number(c.count) || 0]));
    let healed = false;
    const rows = [];
    for (const r of restaurants) {
      const h = await healStoreImages(r, req);
      if (h !== r) healed = true;
      rows.push([r, h]);
    }
    if (healed) clearRestaurantsCache();
    res.json(rows.map(([r, h]) => {
      const open = getStoreOpenState(r);
      return {
        ...publicRestaurant(h),
        itemCount: countBy.get(r.id) || 0,
        isOpen: !!open.isOpen,
        opensAt: open.opensAt || null,
        closedReason: open.isOpen ? null : (open.message || null)
      };
    }));
  } catch (error) {
    sendAdminError(res, error, 'Could not load stores.');
  }
};

exports.getAllMenuItems = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const where = {};
    if (req.query.restaurantId) {
      if (!UUID_RE.test(String(req.query.restaurantId))) return res.status(404).json({ message: 'Store not found.' });
      where.restaurantId = req.query.restaurantId;
    }
    const items = await MenuItem.findAll({ where, order: [['category', 'ASC'], ['name', 'ASC']] });
    const { isDataUrl } = require('../utils/imageStore');
    const out = [];
    let healed = false;
    for (const i of sortMenuItems(items)) {
      const json = i.toJSON();
      if (isDataUrl(json.imageUrl)) {
        json.imageUrl = await healInlineImage(MenuItem, i, 'imageUrl', json.imageUrl, req, i.restaurantId, 'menu');
        healed = true;
      }
      out.push({ ...json, _id: i.id });
    }
    if (healed) clearRestaurantsCache();
    res.json(out);
  } catch (error) {
    sendAdminError(res, error, 'Could not load products.');
  }
};

exports.createRestaurant = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const data = await mediaizeBrandTheme(await mediaizeImageFields(pickRestaurantFields(req.body, { creating: true }), req, ['imageUrl', 'logoUrl'], 'store'), req);
    if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim().length >= 6) {
      data.password = req.body.password.trim(); // hashed by the model hook
    }
    await assertUniqueStore({ name: data.name, phone: data.phone });
    const restaurant = await Restaurant.create(data);
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'RESTAURANT_CREATED', publicRestaurant(restaurant));
    realtime.publish('store', 'created', restaurant.id, { storeId: restaurant.id });
    await logAuditAction(req, restaurant.id, 'CREATE_RESTAURANT', { name: restaurant.name });
    res.status(201).json(publicRestaurant(restaurant));
  } catch (error) {
    sendAdminError(res, error, 'Could not create the store.');
  }
};

exports.updateRestaurant = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Store not found.' });
    const Restaurant = getRestaurantModel();
    const restaurant = await Restaurant.findByPk(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Store not found.' });

    const updateData = await mediaizeBrandTheme(await mediaizeImageFields(pickRestaurantFields(req.body), req, ['imageUrl', 'logoUrl'], 'store'), req);
    if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim().length >= 6) {
      updateData.password = req.body.password.trim(); // hashed by the model hook
    }
    await assertUniqueStore({
      name: updateData.name !== undefined && updateData.name.toLowerCase() !== String(restaurant.name || '').toLowerCase() ? updateData.name : null,
      phone: updateData.phone && updateData.phone !== restaurant.phone ? updateData.phone : null,
    }, restaurant.id);
    // Switching a store between stall (Zenvy Vendor app, vendor-delivered) and restaurant / shop
    // (Zenvy Restaurant app, rider-delivered) changes which app and which order flow it uses.
    // Refuse while orders are still open, and sign the old partner app out after the switch.
    let stallSwitched = false;
    if (updateData.vendorType !== undefined) {
      const wasStall = isLocalVendorStore(restaurant);
      const willBeStall = isLocalVendorStore({ vendorType: updateData.vendorType, isLocalVendor: restaurant.isLocalVendor });
      if (wasStall !== willBeStall) {
        const open = await getOrderModel().count({ where: { restaurantId: restaurant.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } });
        if (open > 0) {
          return res.status(409).json({
            code: 'STORE_TYPE_HAS_OPEN_ORDERS',
            openOrders: open,
            message: `This store has ${open} open order${open === 1 ? '' : 's'}. Finish or cancel them before changing it ${willBeStall ? 'to a stall' : 'from a stall'}.`,
          });
        }
        stallSwitched = true;
      }
    }
    if (stallSwitched && !updateData.password) updateData.tokenVersion = (Number(restaurant.tokenVersion) || 0) + 1;
    // A password change bumps tokenVersion (model hook): signed-in partner apps are signed out.
    // So does switching a live store off (C1-7 suspension, model hook sets suspendedAt).
    const tvBefore = Number(restaurant.tokenVersion) || 0;
    await restaurant.update(updateData);
    if (updateData.password || stallSwitched || (Number(restaurant.tokenVersion) || 0) !== tvBefore) {
      clearCachedUser(restaurant.id);
      // Partner sockets opened with the revoked token stop getting this store's orders now.
      realtime.disconnectRevokedSockets(restaurant.id, restaurant.tokenVersion);
    }
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'RESTAURANT_UPDATED', publicRestaurant(restaurant));
    realtime.publish('store', 'updated', restaurant.id, { storeId: restaurant.id });
    await logAuditAction(req, restaurant.id, 'UPDATE_RESTAURANT', { name: restaurant.name, fields: Object.keys(updateData).filter(k => k !== 'password') });
    res.json(publicRestaurant(restaurant));
  } catch (error) {
    sendAdminError(res, error, 'Could not update the store.');
  }
};

exports.upsertMenuItem = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const Restaurant = getRestaurantModel();
    const { id } = req.params;
    let menuItem;
    if (id && id !== 'new') {
      if (!UUID_RE.test(String(id))) return res.status(404).json({ message: 'Product not found.' });
      menuItem = await MenuItem.findByPk(id);
      if (!menuItem) return res.status(404).json({ message: 'Product not found.' });
      await menuItem.update(await mediaizeImageFields(pickMenuItemFields(req.body, menuItem), req, ['imageUrl'], 'menu'));
    } else {
      const restaurantId = String(req.body.restaurantId || '');
      if (!UUID_RE.test(restaurantId) || !(await Restaurant.findByPk(restaurantId, { attributes: ['id'] }))) {
        return res.status(400).json({ message: 'Pick the store this product belongs to.' });
      }
      menuItem = await MenuItem.create({ ...(await mediaizeImageFields(pickMenuItemFields(req.body), req, ['imageUrl'], 'menu')), restaurantId });
    }
    clearRestaurantsCache();
    realtime.publish('product', id && id !== 'new' ? 'updated' : 'created', menuItem.id, { storeId: menuItem.restaurantId });
    broadcastSystemUpdate(req, 'MENU_UPDATED', { id: menuItem.id, restaurantId: menuItem.restaurantId });
    const io = req.app.get('io');
    if (io) {
      io.emit('inventory_updated', { itemId: menuItem.id, restaurantId: menuItem.restaurantId, isAvailable: menuItem.isAvailable });
    }
    await logAuditAction(req, menuItem.id, 'UPSERT_MENU_ITEM', { name: menuItem.name, price: menuItem.price, restaurantId: menuItem.restaurantId });
    res.json({ ...menuItem.toJSON(), _id: menuItem.id });
  } catch (error) {
    sendAdminError(res, error, 'Could not save the product.');
  }
};

exports.deleteMenuItem = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Product not found.' });
    const MenuItem = getMenuItemModel();
    const item = await MenuItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ message: 'Product not found.' });
    await item.destroy();
    clearRestaurantsCache();
    broadcastSystemUpdate(req, 'MENU_ITEM_DELETED', { id: req.params.id, restaurantId: item.restaurantId });
    realtime.publish('product', 'deleted', req.params.id, { storeId: item.restaurantId });
    await logAuditAction(req, req.params.id, 'DELETE_MENU_ITEM', { id: req.params.id, name: item.name, restaurantId: item.restaurantId });
    res.json({ message: 'Product deleted.' });
  } catch (error) {
    sendAdminError(res, error, 'Could not delete the product.');
  }
};


// ─── Fleet Management ──────────────────────────────────────────
exports.getAllRiders = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    // Clamped like getAllUsers: a huge or negative limit / page can never dump or break the query.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    // Optional filters (the dashboard SOS modal only needs riders with an active SOS; the fleet map
    // only approved riders), so callers no longer page through the whole fleet to find a few rows.
    const where = {};
    if (req.query.sosActive === '1' || req.query.sosActive === 'true') where.isSosActive = true;
    if (req.query.approved === '1' || req.query.approved === 'true') where.isApproved = true;

    const { count, rows: riders } = await DeliveryPartner.findAndCountAll({
      where,
      attributes: { exclude: ['password', 'tokenVersion', 'fcmTokens'] },
      limit,
      offset,
      order: [['createdAt', 'DESC'], ['id', 'ASC']]
    });

    res.json({
      riders: riders.map(r => ({ ...r.toJSON(), _id: r.id })),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.approveRider = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const isApproved = req.body ? req.body.isApproved : undefined;
    if (typeof isApproved !== 'boolean') return res.status(400).json({ message: 'isApproved must be true or false.', code: 'INVALID_INPUT' });
    const rider = await DeliveryPartner.findByPk(req.params.id);
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    if (!isApproved && rider.isApproved) {
      // Deactivating a rider mid-delivery strands the customer's order: finish or reassign it first.
      const active = rider.currentOrderId ? 1 : await getOrderModel().count({
        where: { deliveryPartnerId: rider.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
      });
      if (active > 0) {
        return res.status(409).json({ code: 'RIDER_HAS_ACTIVE_ORDER', message: `${rider.name || 'This rider'} is carrying an order. Reassign or finish it before deactivating.` });
      }
    }
    const tvBefore = Number(rider.tokenVersion) || 0;
    await rider.update(isApproved ? { isApproved } : { isApproved, isOnline: false });
    if ((Number(rider.tokenVersion) || 0) !== tvBefore) {
      // Deactivated (C1-7, model hook): every rider session / socket ends now.
      try { const io = req.app.get('io'); if (io) io.in(`rider_${rider.id}`).disconnectSockets(true); } catch (e) { console.warn('[RIDER_REVOKE_SOCKET_WARN]', e.message); }
      realtime.disconnectRevokedSockets(rider.id, rider.tokenVersion);
    }
    await logAuditAction(req, rider.id, isApproved ? 'FLEET_RIDER_APPROVED' : 'FLEET_RIDER_DEACTIVATED', { name: rider.name });
    broadcastSystemUpdate(req, 'RIDER_STATUS_CHANGED', { id: req.params.id, isApproved });
    realtime.notifyAdmin('rider', 'updated', rider.id);
    // Live dispatch room: an unapproved rider stops receiving delivery_request at once.
    realtime.setRiderOnline(rider.id, !!(rider.isApproved && rider.isOnline));
    clearCachedUser(rider.id);
    res.json({ ...withoutPassword(rider), _id: rider.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.resetRiderSos = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const rider = await DeliveryPartner.findByPk(req.params.id);
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    await rider.update({ isSosActive: false, sosNote: null });
    broadcastSystemUpdate(req, 'RIDER_SOS_RESET', { id: req.params.id });
    await logAuditAction(req, rider.id, 'FLEET_SOS_RESET', { name: rider.name });
    res.json({ message: 'SOS reset successful' });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.updateRider = async (req, res) => {
  try {
    const DeliveryPartner = getDeliveryPartnerModel();
    const rider = await DeliveryPartner.findByPk(req.params.id);
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    
    // Prevent mass assignment of sensitive/calculated metrics
    const allowedFields = [
      'name', 'phone', 'vehicleType', 'vehicleNumber', 'photoUrl', 'bio',
      'emergencyContact', 'isOnline', 'isAvailable', 'isApproved'
    ];
    const updateData = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }
    if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim().length >= 6) {
      // Plain text: the DeliveryPartner beforeUpdate hook hashes it (hashing here too stored
      // bcrypt(bcrypt(pw)) and locked the rider out).
      updateData.password = req.body.password.trim();
      // Every session of this rider is revoked: take them off duty so the pool stops ringing a
      // phone that can no longer accept (they go online again after signing in).
      updateData.isOnline = false;
    }
    const tvBefore = Number(rider.tokenVersion) || 0;
    await rider.update(updateData);
    if (updateData.password || (Number(rider.tokenVersion) || 0) !== tvBefore) {
      clearCachedUser(rider.id); // tokenVersion was bumped: old sessions end now
      realtime.setRiderOnline(rider.id, false);
      // Old sockets were authenticated with the revoked token: drop them (they cannot reconnect).
      try { const io = req.app.get('io'); if (io) io.in(`rider_${rider.id}`).disconnectSockets(true); } catch (e) { console.warn('[RIDER_REVOKE_SOCKET_WARN]', e.message); }
    } else if (updateData.isOnline !== undefined) {
      realtime.setRiderOnline(rider.id, rider.isOnline === true && rider.isApproved === true);
    }
    broadcastSystemUpdate(req, 'RIDER_UPDATED', rider);
    realtime.notifyAdmin('rider', 'updated', rider.id);
    const riderData = rider.toJSON();
    delete riderData.password;
    res.json({ ...riderData, _id: rider.id });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── User & Elite Tiering ──────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const User = getUserModel();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    // Optional ?search= matches name, phone or email.
    const search = String(req.query.search || '').trim().slice(0, 64);
    let where;
    if (search) {
      const { getSequelize } = require('../config/db');
      const sequelize = getSequelize();
      const isPostgres = sequelize && typeof sequelize.getDialect === 'function' && sequelize.getDialect() === 'postgres';
      const matchOp = isPostgres ? Op.iLike : Op.like;
      const pattern = `%${search.replace(/[%_\\]/g, '')}%`; // wildcards stripped from user input
      where = {
        [Op.or]: [
          { name: { [matchOp]: pattern } },
          { phone: { [matchOp]: pattern } },
          { email: { [matchOp]: pattern } },
        ],
      };
    }

    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      users: users.map(u => ({ ...u.toJSON(), _id: u.id })),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.setEliteStatus = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const isElite = req.body ? req.body.isElite : undefined;
    if (typeof isElite !== 'boolean') return res.status(400).json({ message: 'isElite must be true or false.', code: 'INVALID_INPUT' });
    await user.update({ isElite });
    broadcastSystemUpdate(req, 'USER_ELITE_STATUS', { userId: req.params.userId, isElite });
    realtime.notifyAdmin('user', 'updated', user.id);
    await logAuditAction(req, user.id, 'ELITE_STATUS_CHANGE', { email: user.email, isElite });
    clearCachedUser(user.id);
    res.json({ ...withoutPassword(user), _id: user.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateUserWallet = async (req, res) => {
  try {
    const User = getUserModel();
    const { amount } = req.body;
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
 
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ message: 'Invalid amount value' });
    }
    // Atomic, conditional adjustment: an order debit, tip or refund landing at the same moment is
    // never overwritten (the old read-modify-write could wipe it out).
    const [changed] = await User.update(
      { walletBalance: User.sequelize.literal(`COALESCE("walletBalance", 0) + ${delta}`) },
      { where: { id: user.id, ...(delta < 0 ? { walletBalance: { [Op.gte]: -delta } } : {}) } }
    );
    if (changed === 0) {
      return res.status(400).json({ message: 'Wallet balance cannot be negative' });
    }
    await user.reload({ attributes: ['id', 'walletBalance', 'email'] });
    const newBalance = Number(user.walletBalance) || 0;
    
    await logAuditAction(req, user.id, 'WALLET_UPDATE', { email: user.email, added: amount, newBalance });
    broadcastSystemUpdate(req, 'USER_UPDATED', { userId: user.id, walletBalance: newBalance });
    realtime.notifyAdmin('user', 'updated', user.id);
    
    res.json({ message: 'Wallet updated', walletBalance: newBalance });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const VerificationLog = getVerificationLogModel();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    // ?targetId=a,b,c  and/or  ?storeId=<uuid> (the store, its current menu items, and deleted items
    // whose audit details carry the store id).
    const where = {};
    const targetIds = String(req.query.targetId || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 200);
    const or = [];
    if (targetIds.length) or.push({ targetId: { [Op.in]: targetIds } });
    const storeId = String(req.query.storeId || '').trim();
    if (storeId) {
      if (!UUID_RE.test(storeId)) return res.json({ logs: [], total: 0, pages: 0 });
      const itemIds = (await getMenuItemModel().findAll({ where: { restaurantId: storeId }, attributes: ['id'], raw: true })).map((i) => i.id);
      or.push({ targetId: { [Op.in]: [storeId, ...itemIds] } });
      or.push({ details: { [Op.like]: `%"restaurantId":"${storeId}"%` } });
    }
    if (or.length) where[Op.or] = or;
    const { count, rows: logs } = await VerificationLog.findAndCountAll({
      where,
      order: [['timestamp', 'DESC']],
      limit,
      offset
    });

    res.json({
      logs: logs.map(l => ({ ...l.toJSON(), _id: l.id })),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.updateGlobalConfig = async (req, res) => {
  try {
    const GlobalConfig = getGlobalConfigModel();
    const { value, description } = req.body || {};
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key || key.length > 100) return res.status(400).json({ message: 'Config key is required (up to 100 characters).' });
    if (value === undefined) return res.status(400).json({ message: 'Config value is required.' });
    // C3: the force-update policy is only written through PUT /api/admin/app-versions (validated + audited).
    if (key === require('../utils/appVersionPolicy').POLICY_KEY) {
      return res.status(400).json({ message: 'App versions are edited on Config → App versions (PUT /api/admin/app-versions).' });
    }
    // C4: legal settings are only written through PUT /api/admin/legal-settings (validated + audited).
    if (key === require('../utils/legalSettings').KEY) {
      return res.status(400).json({ message: 'Legal settings are edited on Config → Legal (PUT /api/admin/legal-settings).' });
    }
    // Retention windows (cron/retentionCron.js): whole days, at least 1.
    const retention = require('../cron/retentionCron');
    if (key === retention.KEYS.chat || key === retention.KEYS.pulse) {
      const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
      if (!Number.isInteger(n) || n < retention.MIN_DAYS || n > retention.MAX_DAYS) {
        return res.status(400).json({ message: `${key} must be a whole number of days from ${retention.MIN_DAYS} to ${retention.MAX_DAYS}.` });
      }
      const [, createdR] = await GlobalConfig.upsert({ key, value: n, description: description || (key === retention.KEYS.chat ? 'Days chat messages are kept before deletion' : 'Days Pulse posts are kept before deletion') });
      retention.clearRetentionCache();
      broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value: n });
      realtime.publish('config', 'updated', key, { scope: 'retention' });
      return res.json({ key, value: n, created: createdR });
    }
    const [_config, created] = await GlobalConfig.upsert({ key, value, description });
    broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value });
    realtime.publish('config', 'updated', key, { scope: 'global' });
    res.json({ key, value, description, created });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getGlobalConfig = async (req, res) => {
  try {
    const GlobalConfig = getGlobalConfigModel();
    const configs = await GlobalConfig.findAll();
    res.json(configs.map(c => ({ ...c.toJSON(), _id: c.id })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── Dashboard Stats ──────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const DeliveryPartner = getDeliveryPartnerModel();
    const Restaurant = getRestaurantModel();
    
    const { fn, col } = require('sequelize');
    // Every number is one SQL aggregate, all in parallel (the active pipeline used to load every open
    // order row and sum it in JS, after two sequential round trips).
    const [totalOrders, activeFleet, localVendorCount, deliveredStats, activeStats] = await Promise.all([
      Order.count(),
      DeliveryPartner.count({ where: { isApproved: true } }),
      Restaurant.count({ where: { vendorType: 'LOCAL_VENDOR', isActive: true } }),
      Order.findOne({
        where: { status: 'Delivered' },
        attributes: [[fn('SUM', col('totalPrice')), 'revenue']],
        raw: true
      }),
      Order.findOne({
        where: { status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
        attributes: [[fn('SUM', col('totalPrice')), 'revenue'], [fn('COUNT', col('id')), 'count']],
        raw: true
      })
    ]);

    const totalRevenue = Number(deliveredStats?.revenue || 0);
    const activeRevenue = Number(activeStats?.revenue || 0);
    const activeOrdersCount = Number(activeStats?.count || 0);

    res.json({
      revenue: `₹${totalRevenue.toLocaleString()}`,
      activeRevenue: `₹${activeRevenue.toLocaleString()}`,
      orderActivity: totalOrders.toString(),
      activeFleet: activeFleet.toString(),
      commission: `₹${Math.round(totalRevenue * 0.1).toLocaleString()}`,
      activeOrders: activeOrdersCount.toString(),
      localVendorCount: localVendorCount.toString()
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.getFinanceReport = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get total stats (non-paginated)
    const allDelivered = await Order.findAll({ 
      where: { status: 'Delivered' },
      attributes: ['totalPrice', 'finalPrice', 'restaurantId', 'deliveryFee']
    });

    const restaurants = await Restaurant.findAll();
    const restaurantMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r }), {});

    // Commission uses each store's own rate/type; orders without a known store earn none.
    const orderAmount = (o) => Number(o.finalPrice ?? o.totalPrice) || 0;
    const commissionFor = (o) => {
      const rest = restaurantMap[o.restaurantId];
      if (!rest) return 0;
      const rate = Number(rest.commissionRate) || 0;
      return rest.commissionType === 'flat' ? rate : orderAmount(o) * (rate / 100);
    };

    const totalRevenue = allDelivered.reduce((s, o) => s + orderAmount(o), 0);
    const totalDeliveryFees = allDelivered.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    const totalCommission = allDelivered.reduce((s, o) => s + commissionFor(o), 0);

    // Get paginated transactions
    const { count, rows: orders } = await Order.findAndCountAll({
      where: { status: 'Delivered' },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const transactions = orders.map(order => {
      const restaurant = restaurantMap[order.restaurantId];
      return {
        _id: order.id,
        orderId: order.id.slice(-6),
        restaurantName: restaurant ? restaurant.name : 'Unknown store',
        totalAmount: orderAmount(order),
        commissionEarned: Math.round(commissionFor(order)),
        deliveryFee: Number(order.deliveryFee) || 0,
        timestamp: order.createdAt
      };
    });

    res.json({
      transactions,
      totalRevenue: Math.round(totalRevenue),
      totalCommission: Math.round(totalCommission),
      totalDeliveryFees: Math.round(totalDeliveryFees),
      total: count,
      pages: Math.ceil(count / limit)
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── Seed Database ─────────────────────────────────────────────
exports.seedDatabase = async (req, res) => {
  try {
    clearRestaurantsCache();
    let { restaurants } = req.body;
    
    if (!restaurants || !Array.isArray(restaurants) || restaurants.length === 0) {
      // No built-in sample restaurants: only real partner data sent by the admin is imported.
      return res.status(400).json({ message: 'Send the restaurants to import as { restaurants: [...] }.' });
    }

    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();

    console.log(`[SEED] Processing ${restaurants.length} nodes...`);

    for (const restData of restaurants) {
      // Use UPSERT by name to avoid foreign key violations with Orders
      // PostgreSQL requires a unique constraint for true upsert, 
      // but we'll do 1: Find/Delete-Item or 2: Generic Create
      
      let restaurant = await Restaurant.findOne({ where: { name: restData.name } });
      
      if (!restaurant) {
        restaurant = await Restaurant.create({
          name: restData.name,
          location: restData.location || 'Main Campus',
          imageUrl: restData.imageUrl || restData.image,
          vendorType: restData.vendorType || 'RESTAURANT',
          commissionRate: restData.commissionRate || 10,
          commissionType: restData.commissionType || 'percentage',
          operatingHours: restData.operatingHours || { start: '09:00', end: '22:00' },
          isActive: restData.isActive !== undefined ? restData.isActive : true,
          tags: restData.categories || restData.tags || [],
          brandTheme: restData.brandTheme || null,
          subscriptionTier: restData.subscriptionTier || 'free',
          rating: Number(restData.rating) > 0 ? Number(restData.rating) : 0 // no invented ratings: 0 shows as "New"
        });
      } else {
        // Update existing to refresh images/tags
        await restaurant.update({
          imageUrl: restData.imageUrl || restData.image,
          vendorType: restData.vendorType || 'RESTAURANT',
          tags: restData.categories || restData.tags || [],
          brandTheme: restData.brandTheme || null
        });
      }

      if (restData.menu && Array.isArray(restData.menu)) {
        // Clear items only for THIS restaurant to preserve DB integrity
        await MenuItem.destroy({ where: { restaurantId: restaurant.id } });

        const vendorTagMap = {
          'PHARMACY': ['pharmacy', 'medicine'],
          'STATIONARY': ['stationary', 'books'],
          'LAUNDRY': ['laundry', 'dry-wash'],
          'GYM': ['gym', 'high-protein', 'healthy'],
          'DRINKS': ['drinks'],
          'SEASONAL': ['seasonal'],
          'RENTAL': ['rental'],
          'GROCERY': ['fruits', 'healthy'],
          'SWEETS': ['sweets'],
          'RESTAURANT': [],
          'GLOBAL_MARKET': []
        };
        const vendorTags = vendorTagMap[restData.vendorType] || [];

        for (const item of restData.menu) {
          const itemTags = [...new Set([
            ...vendorTags,
            ...(item.tags || []),
            ...(item.category ? [item.category.toLowerCase()] : [])
          ])];
          await MenuItem.create({
            restaurantId: restaurant.id,
            name: item.name,
            price: item.price,
            description: item.description,
            imageUrl: item.image || item.imageUrl,
            category: item.category,
            tags: itemTags,
            isAvailable: true,
            isEliteOnly: false
          });
        }
      }
    }

    broadcastSystemUpdate(req, 'DATABASE_SEEDED', { count: restaurants.length });
    realtime.publish('store', 'updated', null); // id null = refetch the whole catalogue
    realtime.publish('product', 'updated', null);
    res.json({ message: `Successfully synchronized ${restaurants.length} restaurants.` });
  } catch (error) {
    console.error('[SEED_ERROR]', error);
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── Zenvy Vault Control (Stubs for PostgreSQL) ─────────────────
exports.getVaultItems = async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    const items = await VaultItem.findAll({ order: [['createdAt', 'DESC']] });
    res.json(items.map(i => ({ ...i.toJSON(), _id: i.id })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

const pickVaultFields = (body = {}, existing = null) => {
  const out = {};
  for (const key of ['name', 'price', 'originalPrice', 'remainingCount', 'imageUrl', 'isActive', 'streakRequirement']) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (!existing || out.name !== undefined) {
    out.name = String(out.name || '').trim();
    if (!out.name) throw new AdminInputError('Deal name is required.');
  }
  for (const key of ['price', 'originalPrice']) {
    if (existing && out[key] === undefined) continue;
    const n = Number(out[key]);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new AdminInputError('Prices must be between ₹0 and ₹1,00,000.');
    out[key] = Math.round(n * 100) / 100;
  }
  const price = out.price !== undefined ? out.price : Number(existing && existing.price);
  const mrp = out.originalPrice !== undefined ? out.originalPrice : Number(existing && existing.originalPrice);
  if (Number.isFinite(price) && Number.isFinite(mrp) && mrp < price) throw new AdminInputError('The original price cannot be lower than the deal price.');
  for (const key of ['remainingCount', 'streakRequirement']) {
    if (out[key] === undefined) continue;
    const n = Number(out[key]);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new AdminInputError(key === 'remainingCount' ? 'Stock must be a whole number (0 or more).' : 'Streak requirement must be a whole number (0 or more).');
    out[key] = n;
  }
  if (out.imageUrl !== undefined) out.imageUrl = String(out.imageUrl || '').trim() || null;
  if (out.isActive !== undefined) out.isActive = toBool(out.isActive);
  // C1-4 (optional): the store / product the deal is for and its own minimum order ('' / null clears).
  for (const key of ['restaurantId', 'menuItemId']) {
    if (body[key] === undefined) continue;
    const v = body[key] === null ? '' : String(body[key]).trim();
    if (v && !UUID_RE.test(v)) throw new AdminInputError(key === 'restaurantId' ? 'Pick a valid store for this deal.' : 'Pick a valid product for this deal.');
    out[key] = v || null;
  }
  if (body.minOrderValue !== undefined) {
    if (body.minOrderValue === null || body.minOrderValue === '') out.minOrderValue = null;
    else {
      const n = Number(body.minOrderValue);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new AdminInputError('Minimum order must be between ₹0 and ₹1,00,000.');
      out.minOrderValue = n > 0 ? Math.round(n * 100) / 100 : null;
    }
  }
  return out;
};

// Store / product of a deal must exist, and the product must belong to the store (C1-4).
const assertVaultTargets = async (fields, existing = null) => {
  const restaurantId = fields.restaurantId !== undefined ? fields.restaurantId : (existing ? existing.restaurantId : null);
  const menuItemId = fields.menuItemId !== undefined ? fields.menuItemId : (existing ? existing.menuItemId : null);
  if (fields.restaurantId && !(await getRestaurantModel().findByPk(fields.restaurantId, { attributes: ['id'] }))) {
    throw new AdminInputError('That store does not exist.');
  }
  if (menuItemId && (fields.menuItemId !== undefined || fields.restaurantId !== undefined)) {
    const item = await getMenuItemModel().findByPk(menuItemId, { attributes: ['id', 'restaurantId'] });
    if (!item) throw new AdminInputError('That product does not exist.');
    if (!restaurantId) fields.restaurantId = item.restaurantId; // a product deal is always tied to its store
    else if (String(item.restaurantId) !== String(restaurantId)) throw new AdminInputError('That product belongs to another store.');
  }
  return fields;
};

exports.upsertVaultItem = async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    const { id } = req.params;
    let item;
    if (id && id !== 'new') {
      if (!UUID_RE.test(String(id))) return res.status(404).json({ message: 'Deal not found.' });
      item = await VaultItem.findByPk(id);
      if (!item) return res.status(404).json({ message: 'Deal not found.' });
      await item.update(await mediaizeImageFields(await assertVaultTargets(pickVaultFields(req.body, item), item), req, ['imageUrl'], 'vault'));
    } else {
      item = await VaultItem.create(await mediaizeImageFields(await assertVaultTargets(pickVaultFields(req.body)), req, ['imageUrl'], 'vault'));
    }
    broadcastSystemUpdate(req, 'VAULT_UPDATED', item);
    realtime.publish('coupon', id && id !== 'new' ? 'updated' : 'created', item.id, { scope: 'vault' });
    await logAuditAction(req, item.id, 'UPSERT_VAULT_ITEM', { name: item.name, price: item.price, remainingCount: item.remainingCount });
    res.json({ ...item.toJSON(), _id: item.id });
  } catch (error) {
    sendAdminError(res, error, 'Could not save the deal.');
  }
};

exports.deleteVaultItem = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Deal not found.' });
    const VaultItem = getVaultItemModel();
    const removed = await VaultItem.destroy({ where: { id: req.params.id } });
    if (!removed) return res.status(404).json({ message: 'Deal not found.' });
    broadcastSystemUpdate(req, 'VAULT_DELETED', { id: req.params.id });
    realtime.publish('coupon', 'deleted', req.params.id, { scope: 'vault' });
    await logAuditAction(req, req.params.id, 'DELETE_VAULT_ITEM', { id: req.params.id });
    res.json({ message: 'Deal deleted.' });
  } catch (error) {
    sendAdminError(res, error, 'Could not delete the deal.');
  }
};

// ─── Gamification & Rewards Analytics ──────────────────────────

exports.getRewardsAnalytics = async (req, res) => {
  try {
    const User = getUserModel();
    const users = await User.findAll({ 
      where: { role: 'student' },
      attributes: ['completedOrders', 'spinsUsed', 'badges', 'name', 'zenPoints']
    });

    let totalSpinsEarned = 0;
    let totalSpinsUsed = 0;
    let totalZenPoints = 0;
    const badgeCounts = {};
    const tiers = { Elite: 0, Diamond: 0, Platinum: 0, Gold: 0, Silver: 0, Bronze: 0, None: 0 };
    
    const topPerformers = users
      .map(u => {
        const uJson = u.toJSON();
        const earned = Math.floor((uJson.completedOrders || 0) / 2);
        totalSpinsEarned += earned;
        totalSpinsUsed += (uJson.spinsUsed || 0);
        totalZenPoints += (uJson.zenPoints || 0);
        
        let badges = [];
        if (Array.isArray(uJson.badges)) {
          badges = uJson.badges;
        } else if (typeof uJson.badges === 'string') {
          try {
            badges = JSON.parse(uJson.badges);
          } catch {
            badges = [];
          }
        }
        badges.forEach(b => {
          badgeCounts[b] = (badgeCounts[b] || 0) + 1;
        });

        // Tier classification based on highest badge held
        let userTier = 'None';
        if (badges.some(b => b.includes('Elite'))) userTier = 'Elite';
        else if (badges.some(b => b.includes('Diamond'))) userTier = 'Diamond';
        else if (badges.some(b => b.includes('Platinum'))) userTier = 'Platinum';
        else if (badges.some(b => b.includes('Gold'))) userTier = 'Gold';
        else if (badges.some(b => b.includes('Silver'))) userTier = 'Silver';
        else if (badges.some(b => b.includes('Bronze'))) userTier = 'Bronze';
        
        tiers[userTier]++;

        return {
          name: uJson.name,
          completedOrders: uJson.completedOrders,
          badgesCount: badges.length,
          zenPoints: uJson.zenPoints || 0,
          tier: userTier
        };
      })
      .sort((a, b) => b.completedOrders - a.completedOrders)
      .slice(0, 5);

    res.json({
      totalSpinsEarned,
      totalSpinsUsed,
      totalZenPoints,
      activeRewardUsers: users.filter(u => u.completedOrders > 0).length,
      badgeDistribution: badgeCounts,
      tierDistribution: tiers,
      topPerformers,
      redemptionRate: totalSpinsEarned > 0 ? (totalSpinsUsed / totalSpinsEarned * 100).toFixed(1) : 0
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.deleteRestaurant = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const id = req.params.id;
    if (!UUID_RE.test(String(id))) return res.status(404).json({ message: 'Store not found.' });

    const restaurant = await Restaurant.findByPk(id);
    if (!restaurant) return res.status(404).json({ message: 'Store not found.' });
    
    // Check for non-terminal active orders before deletion
    const { getOrderModel } = require('../models/Order');
    const Order = getOrderModel();
    if (Order) {
      const activeOrdersCount = await Order.count({
        where: {
          restaurantId: id,
          status: { [Op.notIn]: ['Delivered', 'Cancelled'] }
        }
      });
      if (activeOrdersCount > 0) {
        return res.status(400).json({ 
          message: `This store has ${activeOrdersCount} active order(s). Finish or cancel them before deleting it.` 
        });
      }
      // Deleting sets restaurantId to NULL on its orders, so money still owed to the store would
      // drop out of Payouts. Settle first (or switch the store off instead of deleting it).
      const unsettledCount = await Order.count({ where: { restaurantId: id, status: 'Delivered', payoutSettled: false } });
      if (unsettledCount > 0) {
        return res.status(400).json({
          message: `This store has ${unsettledCount} delivered order(s) that are not settled yet. Settle its payout first, or switch the store off instead of deleting it.`
        });
      }
    }

    // Cleanup items
    await MenuItem.destroy({ where: { restaurantId: id } });
    await restaurant.destroy();
    clearRestaurantsCache();
    
    broadcastSystemUpdate(req, 'RESTAURANT_DELETED', { id });
    realtime.publish('store', 'deleted', id, { storeId: id });
    logAuditAction(req, id, 'RESTAURANT_DELETE', `Deleted restaurant "${restaurant.name}"`);
    
    res.json({ message: 'Store deleted.' });
  } catch (error) {
    sendAdminError(res, error, 'Could not delete the store.');
  }
};

exports.getOrderVolumeStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    const dialect = sequelize.getDialect();
    
    let stats;
    if (dialect === 'postgres') {
      stats = await Order.findAll({
        attributes: [
          [sequelize.fn('date_trunc', 'hour', sequelize.col('createdAt')), 'hour'],
          [sequelize.fn('count', sequelize.col('id')), 'count']
        ],
        where: {
          createdAt: { [Op.gte]: new Date(Date.now() - 12 * 60 * 60 * 1000) }
        },
        group: [sequelize.fn('date_trunc', 'hour', sequelize.col('createdAt'))],
        order: [[sequelize.fn('date_trunc', 'hour', sequelize.col('createdAt')), 'ASC']]
      });
    } else {
      stats = await Order.findAll({
        attributes: [
          [sequelize.fn('strftime', '%Y-%m-%d %H:00:00', sequelize.col('createdAt')), 'hour'],
          [sequelize.fn('count', sequelize.col('id')), 'count']
        ],
        where: {
          createdAt: { [Op.gte]: new Date(Date.now() - 12 * 60 * 60 * 1000) }
        },
        group: [sequelize.fn('strftime', '%Y-%m-%d %H:00:00', sequelize.col('createdAt'))],
        order: [[sequelize.fn('strftime', '%Y-%m-%d %H:00:00', sequelize.col('createdAt')), 'ASC']]
      });
    }
 
    // Buckets are UTC hours. `timestamp` is ISO so clients can format in their own zone;
    // `hour` is kept for older clients and is formatted in IST (the campus time zone).
    const toDate = (value) => {
      if (value instanceof Date) return value;
      const text = String(value);
      return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    };
    res.json(stats.map(s => {
      const date = toDate(s.dataValues.hour);
      const valid = !Number.isNaN(date.getTime());
      return {
        timestamp: valid ? date.toISOString() : null,
        hour: valid ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '',
        count: parseInt(s.dataValues.count, 10) || 0
      };
    }));
  } catch (error) {
    console.error('[VOLUME_STATS_ERROR]', error);
    res.status(500).json({ message: 'Failed to aggregate volume telemetry' });
  }
};

exports.batchUpdateOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { targetStatus, newStatus } = req.body;
    
    if (!targetStatus || !newStatus) return res.status(400).json({ message: 'Missing parameters' });

    // Only transitions that go through the real per-order side effects are allowed in bulk:
    //  • Pending → Accepted: conditional flip (never resurrects a cancelled order), acceptedAt,
    //    customer/store status events, live rider pool and rider push.
    //  • pre-pickup → Cancelled: cancelAndRefund (Wallet refund + coupon restore, exactly once).
    // A raw bulk UPDATE skipped all of that (Wallet money kept, riders never told, no deliveredAt).
    const CANCELLABLE_FROM = ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup'];
    const isAccept = targetStatus === 'Pending' && newStatus === 'Accepted';
    const isCancel = newStatus === 'Cancelled' && CANCELLABLE_FROM.includes(targetStatus);
    if (!isAccept && !isCancel) {
      return res.status(400).json({ message: 'Bulk update supports only Pending → Accepted, or cancelling orders that have not been picked up. Update other orders one by one.' });
    }

    const io = req.app.get('io');
    const emitStatus = (order, payload) => {
      if (!io) return;
      io.to(String(order.id)).emit('statusUpdated', payload);
      io.to('admin-room').emit('statusUpdated', payload);
      if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', payload);
    };
    const matched = await Order.findAll({ where: { status: targetStatus }, order: [['createdAt', 'ASC']], limit: 200 });
    let updatedCount = 0;
    const skipped = { stall: 0, unpaidUpi: 0 };
    // Bulk accept never touches stall orders (the stall confirms and delivers them itself) or
    // legacy UPI orders whose payment nobody has verified (same rule as the dashboard).
    const unverifiedUpi = (o) => o.paymentMethod === 'UPI' && o.upiStatus !== 'Verified' && o.paymentStatus !== 'Completed';
    for (const order of matched) {
      try {
        if (isAccept) {
          if (order.fulfilment === 'VENDOR') { skipped.stall++; continue; }
          if (unverifiedUpi(order)) { skipped.unpaidUpi++; continue; }
          const now = new Date();
          const [n] = await Order.update({ status: 'Accepted', acceptedAt: now }, {
            where: {
              id: order.id,
              status: 'Pending',
              [Op.and]: [{ [Op.or]: [{ fulfilment: null }, { fulfilment: { [Op.ne]: 'VENDOR' } }] }],
            },
          });
          if (n === 0) continue;
          updatedCount++;
          emitStatus(order, { id: order.id, status: 'Accepted' });
          realtime.notifyAdmin('order', 'updated', order.id);
          // Stall orders (fulfilment VENDOR) are delivered by the stall: no rider pool / pushes.
          if (!order.deliveryPartnerId && order.fulfilment !== 'VENDOR') {
            realtime.deliveryRequest(order.id);
            const restaurant = await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name', 'location'] });
            await require('../utils/riderDispatch').pushNearestRiders({
              restaurant,
              orderId: order.id,
              limit: 5,
              title: '🛵 New Order Ready!',
              body: `${restaurant?.name || 'A store'} has an order waiting for a rider.`,
            });
          }
        } else {
          const { cancelAndRefund } = require('./orderController');
          const { cancelled, refunded } = await cancelAndRefund(order, { reason: 'Cancelled by Zenvy support', onlyFromStatuses: [targetStatus], by: 'support' });
          if (!cancelled) continue;
          updatedCount++;
          emitStatus(order, { id: order.id, status: 'Cancelled', reason: 'ADMIN_CANCELLED', refundedToWallet: refunded });
          if (io) {
            const gone = { orderId: order.id, reason: 'ADMIN_CANCELLED' };
            io.to(String(order.id)).emit('orderCancelled', gone);
            io.to('admin-room').emit('orderCancelled', gone);
            if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('orderCancelled', gone);
            // The assigned rider must stop (they may not be in the order room). cancelAndRefund already
            // re-pointed their currentOrderId at an order they still carry.
            if (order.deliveryPartnerId) io.to(`rider_${order.deliveryPartnerId}`).emit('orderCancelled', { orderId: order.id });
          }
          realtime.notifyAdmin('order', 'updated', order.id);
          const oc = require('./orderController');
          if (order.restaurantId) oc.pushStoreCancelled(order.restaurantId, order, 'An order was cancelled by Zenvy support.');
          oc.pushCustomer(order, 'Order cancelled', refunded > 0
            ? `Zenvy support cancelled your order. ₹${refunded} is back in your Wallet.`
            : 'Zenvy support cancelled your order. You have not been charged.');
        }
      } catch (e) {
        console.error('[BATCH_ORDER_UPDATE_ERROR]', order.id, e.message);
      }
    }

    broadcastSystemUpdate(req, 'BATCH_ORDER_UPDATE', { targetStatus, newStatus, count: updatedCount });
    await logAuditAction(req, 'global', 'BATCH_ORDER_UPDATE', `Updated ${updatedCount} orders from ${targetStatus} to ${newStatus}`);

    res.json({ message: `Successfully updated ${updatedCount} orders.`, count: updatedCount, ...(isAccept ? { skipped } : {}) });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.getAllCoupons = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const User = getUserModel();
    const coupons = await Coupon.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(coupons.map(c => ({ ...c.toJSON(), _id: c.id })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.createCoupon = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const { type, value, userId, expiryDate } = req.body || {};
    // Checkout looks coupons up by the trimmed code, so a stored ' SAVE50' could never be redeemed.
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!code || !userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return res.status(400).json({ message: 'Code and User ID are required' });
    }
    if (code.length > 40 || !/^[A-Za-z0-9_-]+$/.test(code)) {
      return res.status(400).json({ message: 'Coupon code: up to 40 letters, digits, - or _.' });
    }
    // Only the types checkout understands (orderPricing.couponDiscountFor); anything else was
    // stored, "applied" at checkout and silently gave no discount.
    const couponType = type === undefined || type === null || type === '' ? 'FREEDEL' : String(type).toUpperCase();
    if (!['FREEDEL', 'DISCOUNT'].includes(couponType)) {
      return res.status(400).json({ message: 'Coupon type must be FREEDEL or DISCOUNT.' });
    }
    const couponValue = value === undefined || value === null || value === '' ? 0 : Number(value);
    if (!Number.isFinite(couponValue) || couponValue < 0 || couponValue > 5000) {
      return res.status(400).json({ message: 'Coupon value must be a number from 0 to 5000.' });
    }
    const expiry = expiryDate ? new Date(expiryDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(expiry.getTime())) {
      return res.status(400).json({ message: 'Expiry date is not a valid date.' });
    }

    const User = getUserModel();
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if code is unique
    const existing = await Coupon.findOne({ where: { code } });
    if (existing) {
      return res.status(400).json({ message: 'Coupon code already exists' });
    }

    const coupon = await Coupon.create({
      code,
      type: couponType,
      value: couponValue,
      userId,
      isUsed: false,
      expiryDate: expiry
    });

    await logAuditAction(req, coupon.id, 'CREATE_COUPON', { code: coupon.code, userId });
    broadcastSystemUpdate(req, 'COUPON_CREATED', coupon);
    realtime.publish('coupon', 'created', coupon.id, { scope: 'coupon' });

    res.status(201).json({ ...coupon.toJSON(), _id: coupon.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    
    await coupon.destroy();
    await logAuditAction(req, req.params.id, 'DELETE_COUPON', { code: coupon.code });
    broadcastSystemUpdate(req, 'COUPON_DELETED', { id: req.params.id });
    realtime.publish('coupon', 'deleted', req.params.id, { scope: 'coupon' });
    
    res.json({ message: 'Coupon successfully removed/revoked' });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── Finance & Operations (Payouts & Refunds) ────────────────
// Delivered at or before `upTo` (older rows without deliveredAt fall back to updatedAt).
const deliveredUpTo = (upTo) => ({
  [Op.and]: [{ [Op.or]: [{ deliveredAt: { [Op.lte]: upTo } }, { deliveredAt: null, updatedAt: { [Op.lte]: upTo } }] }],
});

exports.getRestaurantPayouts = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    
    // Group only Delivered, unsettled orders to calculate real earnings. `asOf` is sent back as
    // `upTo` when settling, so a delivery finished after this list was built stays unpaid.
    const asOf = new Date();
    const deliveredOrders = await Order.findAll({
      where: { status: 'Delivered', payoutSettled: false, ...deliveredUpTo(asOf) },
      attributes: ['id', 'restaurantId', 'totalPrice'],
    });
    const restaurants = await Restaurant.findAll();
    const restMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r }), {});

    const payouts = {};
    deliveredOrders.forEach(o => {
      const rest = restMap[o.restaurantId];
      if (!rest) return;
      // Store GMV is the item subtotal: finalPrice also contains the rider's delivery fee (and
      // platform coupon discounts), which is not the store's money.
      const price = Number(o.totalPrice) || 0;
      // Same rule as getFinanceReport: the store's own rate (0% stays 0%) and 'flat' = ₹ per order.
      const commissionRate = Number(rest.commissionRate) || 0;
      const commission = rest.commissionType === 'flat' ? Math.min(commissionRate, price) : price * (commissionRate / 100);
      
      if (!payouts[rest.id]) {
        payouts[rest.id] = {
          restaurantId: rest.id,
          restaurantName: rest.name,
          vendorType: rest.vendorType,
          totalOrders: 0,
          totalGMV: 0,
          totalCommission: 0,
          netPayout: 0
        };
      }
      payouts[rest.id].totalOrders += 1;
      payouts[rest.id].totalGMV += price;
      payouts[rest.id].totalCommission += commission;
      payouts[rest.id].netPayout += (price - commission);
    });

    res.json(Object.values(payouts).map(p => ({
      ...p,
      asOf: asOf.toISOString(),
      totalGMV: Math.round(p.totalGMV),
      totalCommission: Math.round(p.totalCommission),
      netPayout: Math.round(p.netPayout)
    })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.settleRestaurantPayout = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { restaurantId } = req.body || {};
    if (!restaurantId || !UUID_RE.test(String(restaurantId))) return res.status(400).json({ message: 'restaurantId is required' });

    // Settle only what the admin saw: deliveries up to `upTo` (the list's `asOf`). Without it
    // (older dashboards) everything delivered so far is settled, as before.
    const upToRaw = req.body.upTo || req.body.asOf;
    const upTo = upToRaw ? new Date(String(upToRaw)) : null;
    if (upToRaw && Number.isNaN(upTo.getTime())) return res.status(400).json({ message: 'upTo must be a date.', code: 'INVALID_INPUT' });
    const where = { restaurantId, status: 'Delivered', payoutSettled: false, ...(upTo ? deliveredUpTo(upTo) : {}) };

    const { getSequelize } = require('../config/db');
    const result = await getSequelize().transaction(async (t) => {
      // The screen showed `expectedOrders`: if that changed (another admin settled some, or a
      // late-arriving row), refuse and let the admin reload instead of paying a different amount.
      const expected = req.body.expectedOrders;
      if (expected !== undefined && expected !== null) {
        const n = await Order.count({ where, transaction: t });
        if (Number(expected) !== n) return { mismatch: n };
      }
      const [updatedCount] = await Order.update({ payoutSettled: true }, { where, transaction: t });
      return { updatedCount };
    });
    if (result.mismatch !== undefined) {
      return res.status(409).json({ code: 'PAYOUT_CHANGED', currentOrders: result.mismatch, message: `This payout now covers ${result.mismatch} order${result.mismatch === 1 ? '' : 's'}, not ${req.body.expectedOrders}. Refresh and check it before settling.` });
    }
    const updatedCount = result.updatedCount;

    await logAuditAction(req, restaurantId, 'RESTAURANT_PAYOUT_SETTLED', { restaurantId, updatedOrdersCount: updatedCount, upTo: upTo ? upTo.toISOString() : null });

    res.json({ message: 'Restaurant payout marked as settled successfully', updatedOrdersCount: updatedCount });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.getDisputedOrders = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = require('../models/User').getUserModel();
    
    // Bounded and without the photo columns (proof / bill / item photos can be inline base64).
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const disputes = await Order.findAll({
      where: { status: 'Cancelled' },
      attributes: { exclude: HEAVY_ORDER_COLUMNS },
      order: [['createdAt', 'DESC']],
      limit,
      include: [{ model: User, as: 'user', attributes: ['name', 'phone'] }]
    });
    res.json(disputes.map(d => ({ ...d.toJSON(), _id: d.id, userId: d.user || { name: 'Student', phone: '' } })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.processManualRefund = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'Cancelled') return res.status(400).json({ message: 'Can only refund Cancelled orders.' });
    // Case-insensitive: older SQLite rows store 'cod' / 'wallet' (a cancelled 'wallet' order was already
    // refunded automatically and must never be refunded twice).
    const method = String(order.paymentMethod || '').toUpperCase();
    if (method === 'COD') return res.status(400).json({ message: 'COD orders do not require refunds.' });
    if (method === 'WALLET') return res.status(400).json({ message: 'Wallet orders are refunded to the Wallet automatically when they are cancelled.' });
    const VerificationLog = getVerificationLogModel();
    const already = VerificationLog ? await VerificationLog.findOne({ where: { targetId: String(order.id), action: 'MANUAL_REFUND_PROCESSED' } }) : null;
    if (already) return res.status(400).json({ message: 'This order has already been refunded.' });

    // Only money that was actually received can be refunded (a rejected / never-paid UPI order
    // was cancelled without any payment).
    const paid = order.paymentStatus === 'Completed' || order.upiStatus === 'Verified';
    if (!paid) return res.status(400).json({ code: 'NOT_PAID', message: 'This order was never paid, so there is nothing to refund.' });

    const user = await User.findByPk(order.userId, { attributes: ['id'] });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const refundAmount = Math.max(0, Math.round((Number(order.finalPrice || order.totalPrice) || 0) * 100) / 100);
    if (!refundAmount) return res.status(400).json({ message: 'Nothing to refund on this order.' });

    // One transaction: flip refundedAt NULL -> now (only one concurrent click can win), credit the
    // wallet and write the audit row together.
    const { getSequelize } = require('../config/db');
    const won = await getSequelize().transaction(async (t) => {
      const [flipped] = await Order.update(
        { refundedAt: new Date() },
        { where: { id: order.id, refundedAt: null, status: 'Cancelled', paymentMethod: { [Op.notIn]: ['COD', 'Wallet'] } }, transaction: t }
      );
      if (!flipped) return false;
      await User.increment('walletBalance', { by: refundAmount, where: { id: user.id }, transaction: t });
      if (VerificationLog) {
        await VerificationLog.create({
          adminId: req.user?.id ? String(req.user.id) : 'admin_default',
          targetId: String(order.id),
          action: 'MANUAL_REFUND_PROCESSED',
          details: JSON.stringify({ amount: refundAmount, userId: user.id }),
        }, { transaction: t });
      }
      return true;
    });
    if (!won) return res.status(409).json({ message: 'This order has already been refunded.' });

    const fresh = await User.findByPk(user.id, { attributes: ['walletBalance'] });
    res.json({ message: 'Refund successful', refundAmount, walletBalance: fresh ? fresh.walletBalance : undefined });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── God-Tier Administrative Endpoints ───────────────────────

exports.toggleUserBan = async (req, res) => {
  try {
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    const wanted = req.body ? req.body.isActive : undefined;
    if (wanted !== undefined && typeof wanted !== 'boolean') return res.status(400).json({ message: 'isActive must be true or false.', code: 'INVALID_INPUT' });
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const next = wanted !== undefined ? wanted : !user.isActive;
    // Suspending yourself or another admin would lock admins out of the dashboard.
    if (!next && String(user.id) === String(req.user && req.user.id)) {
      return res.status(403).json({ message: 'You cannot suspend your own account.', code: 'SELF_ACTION' });
    }
    if (!next && String(user.role || '').toLowerCase() === 'admin') {
      return res.status(403).json({ message: 'Admin accounts cannot be suspended here.', code: 'ADMIN_PROTECTED' });
    }

    user.isActive = next;
    await user.save();
    
    const action = user.isActive ? 'USER_UNBANNED' : 'USER_BANNED';
    await logAuditAction(req, user.id, action, { userId: user.id });
    realtime.notifyAdmin('user', 'updated', user.id);
    // Apply the ban at once: drop the 60 s auth cache entry and close the user's live sockets.
    clearCachedUser(user.id);
    if (!user.isActive) {
      try { req.app.get('io')?.in(`user_${user.id}`).disconnectSockets(true); } catch { /* best effort */ }
      // Campus chat sockets too (separate namespace): a banned student kept chatting.
      realtime.disconnectRevokedSockets(user.id, null);
    }

    res.json({ message: `User account ${user.isActive ? 'reactivated' : 'suspended'}`, user: withoutPassword(user) });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.broadcastPushNotification = async (req, res) => {
  try {
    const { title, body, targetBlock, category } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'Title and body required' });
    
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    let whereClause = { isActive: true };
    const isTargeted = !!(targetBlock && targetBlock !== 'All Campus Blocks');
    if (isTargeted) {
      whereClause.hostelBlock = targetBlock;
    }
    const activeUsers = await User.findAll({ where: whereClause, attributes: ['id', 'fcmTokens'] });
    if (isTargeted && !activeUsers.length) {
      return res.status(404).json({ code: 'NO_RECIPIENTS', message: `No active students have "${String(targetBlock).slice(0, 60)}" as their hostel block, so nothing was sent. Check the spelling (it must match the profile exactly).` });
    }

    let allTokens = [];
    activeUsers.forEach(user => {
      if (user.fcmTokens) {
        let tokenList = user.fcmTokens;
        if (typeof tokenList === 'string') {
          try {
            tokenList = JSON.parse(tokenList);
          } catch {
            tokenList = [tokenList];
          }
        }
        if (Array.isArray(tokenList)) {
          tokenList.forEach(t => {
            const tokenStr = typeof t === 'string' ? t : t?.token;
            if (tokenStr) allTokens.push(tokenStr);
          });
        }
      }
    });

    // Remove duplicates
    allTokens = [...new Set(allTokens.filter(Boolean))];

    if (activeUsers.length > 0) {
      const { sendPushToTokens } = require('../utils/push');
      // Saved in every targeted user's notification list, then pushed to their devices.
      await sendPushToTokens(allTokens, title, body, { type: 'global_broadcast', targetBlock: targetBlock || 'all', category: category || 'announcement' },
        { recipients: activeUsers.map((u) => u.id) });
    }
    
    // Campus-wide only: also reach devices subscribed to the 'all' topic. A block-targeted
    // broadcast must not go to the whole campus.
    if (!isTargeted) {
      const { sendPushToTopic } = require('../utils/push');
      await sendPushToTopic('all', title, body, { type: 'global_broadcast', targetBlock: 'all', category: category || 'announcement' });
    }

    // Broadcast via Socket.io so active users get live toast & save to notification history
    try {
      const io = req.app.get('io');
      if (io) {
        const announcement = {
          title,
          body,
          message: `${title}: ${body}`,
          targetBlock: targetBlock || 'All Campus Blocks',
          category: category || 'announcement',
          type: 'info'
        };
        if (isTargeted) {
          // Only the targeted block's students (each signed-in user socket is in user_<id>).
          const rooms = activeUsers.map((u) => `user_${u.id}`);
          if (rooms.length > 0) io.to(rooms).emit('global_announcement', announcement);
        } else {
          io.emit('global_announcement', announcement);
        }
      }
    } catch (sockErr) {
      console.error('Failed to emit admin broadcast socket announcement:', sockErr);
    }

    await logAuditAction(req, null, 'GLOBAL_PUSH_SENT', { title, body, userCount: activeUsers.length });
    realtime.publish('announcement', 'created', null, { scope: 'broadcast' });
    
    // Students and devices are reported separately (the old text called the student count "devices").
    const who = `${activeUsers.length} student${activeUsers.length === 1 ? '' : 's'}`;
    const devices = `${allTokens.length} registered device${allTokens.length === 1 ? '' : 's'}`;
    res.json({
      message: `Sent to ${who} (${devices}${isTargeted ? '' : ', plus phones subscribed to campus-wide alerts'}). It is also in their in-app notification list.`,
      students: activeUsers.length,
      devices: allTokens.length,
    });
  } catch (error) {
    console.error('Broadcast push failed:', error);
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.getRecentReviews = async (req, res) => {
  try {
    const Order = getOrderModel();
    const User = require('../models/User').getUserModel();
    const Restaurant = getRestaurantModel();
    const { Op } = require('sequelize');

    const reviews = await Order.findAll({
      where: {
        review: { [Op.not]: null }
      },
      attributes: { exclude: ['deliveryPin'] },
      order: [['createdAt', 'DESC']],
      limit: 50,
      include: [
        { model: User, as: 'user', attributes: ['name', 'phone'] },
      ]
    });
    
    // Quick and dirty manual join for restaurant name since associations might be missing
    const restaurants = await Restaurant.findAll();
    const restMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r.name }), {});

    const mapped = reviews.map(r => {
      const data = r.toJSON();
      data.restaurantName = restMap[r.restaurantId] || 'Unknown store';
      return data;
    });

    res.json(mapped);
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const Order = getOrderModel();
    const order = await Order.findByPk(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Review not found' });
    
    order.review = null;
    order.rating = null;
    await order.save();
    
    await logAuditAction(req, order.id, 'REVIEW_DELETED', { orderId: order.id });
    if (order.restaurantId) realtime.publish('store', 'updated', order.restaurantId, { storeId: order.restaurantId, scope: 'reviews' });
    res.json({ message: 'Review successfully removed from the ecosystem.' });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.getRiderPayouts = async (req, res) => {
  try {
    const Order = getOrderModel();
    const DeliveryPartner = getDeliveryPartnerModel();
    const { fn, col } = require('sequelize');
    // The admin settles exactly what this screen shows: everything delivered up to `asOf`.
    const asOf = new Date();

    // Aggregated in SQL (no full order rows / photos in memory). NULL riderPayoutSettled (rows
    // from before the default existed) counts as unsettled.
    const grouped = await Order.findAll({
      where: { status: 'Delivered', riderPayoutSettled: { [Op.not]: true }, deliveryPartnerId: { [Op.ne]: null } },
      attributes: [
        'deliveryPartnerId',
        [fn('COUNT', col('id')), 'totalDeliveries'],
        [fn('SUM', col('deliveryFee')), 'totalDeliveryFees'],
      ],
      group: ['deliveryPartnerId'],
      raw: true,
    });

    const riderIds = new Set(grouped.map((g) => String(g.deliveryPartnerId)));
    const riders = await DeliveryPartner.findAll({
      where: { [Op.or]: [{ id: { [Op.in]: [...riderIds] } }, { walletBalance: { [Op.gt]: 0 } }] },
      attributes: ['id', 'name', 'phone', 'walletBalance'],
    });
    const riderMap = new Map(riders.map((r) => [String(r.id), r]));

    const payouts = {};
    for (const g of grouped) {
      const rid = String(g.deliveryPartnerId);
      const rider = riderMap.get(rid);
      payouts[rid] = {
        riderId: g.deliveryPartnerId,
        riderName: rider ? rider.name : 'Unknown Rider',
        riderPhone: rider ? rider.phone : '',
        totalDeliveries: Number(g.totalDeliveries) || 0,
        totalDeliveryFees: Number(g.totalDeliveryFees) || 0,
      };
    }

    // Customer tips are credited to DeliveryPartner.walletBalance (rateOrder) and were invisible
    // here. Show the unpaid tip balance too, including riders with tips but no unsettled orders.
    riders.forEach((r) => {
      const tips = Number(r.walletBalance) || 0;
      if (tips <= 0) return;
      if (!payouts[r.id]) {
        payouts[r.id] = { riderId: r.id, riderName: r.name, riderPhone: r.phone || '', totalDeliveries: 0, totalDeliveryFees: 0 };
      }
      payouts[r.id].unsettledTips = tips;
    });

    res.json(Object.values(payouts).map(p => ({
      ...p,
      asOf: asOf.toISOString(), // send back as `upTo` when settling
      totalDeliveryFees: Math.round(p.totalDeliveryFees),
      unsettledTips: Math.round(p.unsettledTips || 0),
      totalPayout: Math.round(p.totalDeliveryFees + (p.unsettledTips || 0))
    })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.settleRiderPayout = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { riderId } = req.body || {};
    if (!riderId) return res.status(400).json({ message: 'riderId is required' });

    // Settle only what the admin saw: explicit orderIds, or every delivery up to `upTo` (the
    // `asOf` the payout list returned). A delivery completed after the screen loaded stays unpaid.
    const where = { deliveryPartnerId: riderId, status: 'Delivered', riderPayoutSettled: { [Op.not]: true } };
    const ids = Array.isArray(req.body.orderIds) ? req.body.orderIds.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5000) : null;
    const upToRaw = req.body.upTo || req.body.asOf;
    const upTo = upToRaw ? new Date(String(upToRaw)) : null;
    if (ids && ids.length) {
      where.id = { [Op.in]: ids };
    } else if (upTo && !Number.isNaN(upTo.getTime())) {
      where[Op.or] = [{ deliveredAt: { [Op.lte]: upTo } }, { deliveredAt: null, updatedAt: { [Op.lte]: upTo } }];
    } else {
      // Older dashboards send neither: settle up to now (previous behaviour) and say so in the audit log.
      where[Op.or] = [{ deliveredAt: { [Op.lte]: new Date() } }, { deliveredAt: null }];
    }
    const [updatedCount] = await Order.update({ riderPayoutSettled: true }, { where });
    // Tips are cleared only when the admin says they were paid too (body.includeTips === true),
    // and only by the amount they saw, atomically, so a tip arriving now is not wiped.
    let tipsSettled = 0;
    const tipsSeen = Number(req.body.tipsAmount);
    if (req.body.includeTips === true && Number.isFinite(tipsSeen) && tipsSeen > 0) {
      const DeliveryPartner = getDeliveryPartnerModel();
      const [n] = await DeliveryPartner.update(
        { walletBalance: DeliveryPartner.sequelize.literal(`"walletBalance" - ${tipsSeen}`) },
        { where: { id: riderId, walletBalance: { [Op.gte]: tipsSeen } } }
      );
      if (n > 0) tipsSettled = tipsSeen;
    }

    await logAuditAction(req, riderId, 'RIDER_PAYOUT_SETTLED', { riderId, updatedOrdersCount: updatedCount, tipsSettled, upTo: upTo && !Number.isNaN(upTo.getTime()) ? upTo.toISOString() : null, orderIds: ids ? ids.length : 0 });

    res.json({ message: 'Rider payout marked as settled successfully', updatedOrdersCount: updatedCount, tipsSettled });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── 2026-10-12 Admin store wizard backend (RB-3, RB-5, RB-11) ────────────────

// IST day bounds [from, to) for "today" defaults.
const istDayRange = (now = new Date()) => {
  const IST = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST);
  const startUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST;
  return { from: new Date(startUtc), to: new Date(startUtc + 24 * 60 * 60 * 1000) };
};
const parseDateParam = (v) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

// @route GET /api/admin/restaurants/stats?from=<ISO>&to=<ISO>   (default: today, IST)
// → [{ restaurantId, orders, cancelled, gmv, lastOrderAt }]  (gmv = item total of non-cancelled orders)
exports.getRestaurantStats = async (req, res) => {
  try {
    const Order = getOrderModel();
    const { fn, col, literal } = require('sequelize');
    const day = istDayRange();
    const from = parseDateParam(req.query.from) || day.from;
    const to = parseDateParam(req.query.to) || day.to;
    if (from >= to) return res.status(400).json({ message: "'from' must be before 'to'." });
    const where = { createdAt: { [Op.gte]: from, [Op.lt]: to } };
    if (req.query.restaurantId) {
      if (!UUID_RE.test(String(req.query.restaurantId))) return res.json([]);
      where.restaurantId = String(req.query.restaurantId);
    }
    const rows = await Order.findAll({
      where,
      attributes: [
        'restaurantId',
        [fn('COUNT', col('id')), 'total'],
        [fn('SUM', literal(`CASE WHEN "status" = 'Cancelled' THEN 1 ELSE 0 END`)), 'cancelled'],
        [fn('SUM', literal(`CASE WHEN "status" <> 'Cancelled' THEN "totalPrice" ELSE 0 END`)), 'gmv'],
        [fn('MAX', col('createdAt')), 'lastOrderAt'],
      ],
      group: ['restaurantId'],
      raw: true,
    });
    res.set('Cache-Control', 'no-store');
    res.json(rows.filter((r) => r.restaurantId).map((r) => {
      const total = Number(r.total) || 0;
      const cancelled = Number(r.cancelled) || 0;
      return {
        restaurantId: r.restaurantId,
        orders: total - cancelled,
        cancelled,
        gmv: Math.round((Number(r.gmv) || 0) * 100) / 100,
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null,
      };
    }));
  } catch (error) {
    sendAdminError(res, error, 'Could not load store stats.');
  }
};

const BULK_MAX = 300;
const BULK_STORE_PATCH = ['isActive', 'isOpenNow', 'isFeatured'];
const BULK_ITEM_PATCH = ['isAvailable', 'outOfStockUntil', 'category', 'price', 'isVegetarian', 'dietType', 'isEliteOnly', 'specs'];
const readIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.map(String))] : []).filter((id) => UUID_RE.test(id)).slice(0, BULK_MAX);

// @route POST /api/admin/menu-items/bulk { restaurantId, items: [...] }
// Validates every row first; inserts all in one transaction only when every row is valid.
exports.bulkCreateMenuItems = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const Restaurant = getRestaurantModel();
    const restaurantId = String((req.body || {}).restaurantId || '');
    const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
    if (!UUID_RE.test(restaurantId) || !(await Restaurant.findByPk(restaurantId, { attributes: ['id'] }))) {
      return res.status(400).json({ message: 'Pick the store these products belong to.' });
    }
    if (!items.length) return res.status(400).json({ message: 'Add at least one product.' });
    if (items.length > BULK_MAX) return res.status(400).json({ message: `You can add up to ${BULK_MAX} products at a time.` });
    const rows = [];
    const errors = [];
    items.forEach((raw, index) => {
      try {
        rows.push({ ...pickMenuItemFields(raw || {}), restaurantId });
      } catch (err) {
        errors.push({ index, name: raw && raw.name ? String(raw.name).slice(0, 80) : null, message: err instanceof AdminInputError ? err.message : 'Invalid product.' });
      }
    });
    for (let i = 0; i < rows.length; i++) {
      try {
        await mediaizeImageFields(rows[i], req, ['imageUrl'], 'menu');
      } catch (err) {
        errors.push({ index: i, name: rows[i].name || null, message: err instanceof AdminInputError ? err.message : 'Invalid photo.' });
      }
    }
    if (errors.length) return res.status(400).json({ message: `${errors.length} row(s) need fixing. Nothing was saved.`, errors });
    const { getSequelize } = require('../config/db');
    const created = await getSequelize().transaction((t) => MenuItem.bulkCreate(rows, { transaction: t }));
    clearRestaurantsCache();
    realtime.publish('product', 'updated', null, { storeId: restaurantId, scope: 'bulk' });
    broadcastSystemUpdate(req, 'MENU_UPDATED', { id: null, restaurantId });
    await logAuditAction(req, restaurantId, 'BULK_CREATE_MENU_ITEMS', { restaurantId, count: created.length });
    res.status(201).json({ message: `${created.length} products added.`, count: created.length, items: created.map((i) => ({ ...i.toJSON(), _id: i.id })) });
  } catch (error) {
    sendAdminError(res, error, 'Could not add the products.');
  }
};

// @route POST /api/admin/menu-items/bulk-update { ids, patch }
exports.bulkUpdateMenuItems = async (req, res) => {
  try {
    const MenuItem = getMenuItemModel();
    const ids = readIds((req.body || {}).ids);
    const rawPatch = (req.body || {}).patch || {};
    if (!ids.length) return res.status(400).json({ message: 'Pick at least one product.' });
    const patchIn = {};
    for (const k of BULK_ITEM_PATCH) if (rawPatch[k] !== undefined) patchIn[k] = rawPatch[k];
    if (!Object.keys(patchIn).length) return res.status(400).json({ message: `Nothing to change. Allowed: ${BULK_ITEM_PATCH.join(', ')}.` });
    const items = await MenuItem.findAll({ where: { id: { [Op.in]: ids } } });
    const { getSequelize } = require('../config/db');
    const storeIds = new Set();
    await getSequelize().transaction(async (t) => {
      for (const item of items) {
        // Same validation as a single edit (name/price only when sent; specs merged per item).
        const patch = pickMenuItemFields(patchIn, item);
        if (patchIn.name === undefined) delete patch.name;
        if (patchIn.price === undefined) delete patch.price;
        await item.update(patch, { transaction: t });
        storeIds.add(item.restaurantId);
      }
    });
    clearRestaurantsCache();
    for (const sid of storeIds) realtime.publish('product', 'updated', null, { storeId: sid, scope: 'bulk' });
    await logAuditAction(req, [...storeIds][0] || 'global', 'BULK_UPDATE_MENU_ITEMS', { count: items.length, fields: Object.keys(patchIn), restaurantId: storeIds.size === 1 ? [...storeIds][0] : null });
    res.json({ message: `${items.length} products updated.`, count: items.length, notFound: ids.length - items.length });
  } catch (error) {
    sendAdminError(res, error, 'Could not update the products.');
  }
};

// @route POST /api/admin/restaurants/bulk-update { ids, patch: { isActive?, isOpenNow?, isFeatured? } }
exports.bulkUpdateRestaurants = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const ids = readIds((req.body || {}).ids);
    const rawPatch = (req.body || {}).patch || {};
    if (!ids.length) return res.status(400).json({ message: 'Pick at least one store.' });
    const patch = {};
    for (const k of BULK_STORE_PATCH) if (rawPatch[k] !== undefined) patch[k] = toBool(rawPatch[k]);
    if (!Object.keys(patch).length) return res.status(400).json({ message: `Nothing to change. Allowed: ${BULK_STORE_PATCH.join(', ')}.` });
    const stores = await Restaurant.findAll({ where: { id: { [Op.in]: ids } } });
    for (const store of stores) {
      const tvBefore = Number(store.tokenVersion) || 0;
      await store.update(patch); // instance hooks (publishedAt, C1-7 suspension) run
      if ((Number(store.tokenVersion) || 0) !== tvBefore) {
        // Suspended (live store switched off): its partner sessions end now.
        clearCachedUser(store.id);
        realtime.disconnectRevokedSockets(store.id, store.tokenVersion);
      }
    }
    clearRestaurantsCache();
    const io = req.app.get('io');
    for (const store of stores) {
      realtime.publish('store', 'updated', store.id, { storeId: store.id });
      if (io && patch.isOpenNow !== undefined) io.emit('store_status_changed', { restaurantId: store.id, isOpen: getStoreOpenState(store).isOpen });
    }
    await logAuditAction(req, 'global', 'BULK_UPDATE_RESTAURANTS', { count: stores.length, patch });
    res.json({ message: `${stores.length} stores updated.`, count: stores.length, notFound: ids.length - stores.length });
  } catch (error) {
    sendAdminError(res, error, 'Could not update the stores.');
  }
};

// @route POST /api/admin/restaurants/:id/duplicate { name, copyMenu }
// The copy starts as a draft (isActive false) with no partner password / login phone / push devices.
exports.duplicateRestaurant = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Store not found.' });
    const source = await Restaurant.findByPk(req.params.id);
    if (!source) return res.status(404).json({ message: 'Store not found.' });
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ message: 'Give the copy a name.' });
    if (name.length > 120) return res.status(400).json({ message: 'Store name must be 120 characters or fewer.' });
    await assertUniqueStore({ name });
    const copyMenu = (req.body || {}).copyMenu !== false && (req.body || {}).copyMenu !== 'false';
    const src = source.toJSON();
    for (const k of ['id', 'createdAt', 'updatedAt', 'password', 'phone', 'fcmTokens', 'tokenVersion', 'publishedAt', 'clickCount', 'rating', 'isFeatured', 'featuredUntil']) delete src[k];
    const { getSequelize } = require('../config/db');
    const { copy, count } = await getSequelize().transaction(async (t) => {
      const created = await Restaurant.create({ ...src, name, isActive: false }, { transaction: t });
      let n = 0;
      if (copyMenu) {
        const items = await MenuItem.findAll({ where: { restaurantId: source.id }, transaction: t });
        const rows = items.map((i) => {
          const j = i.toJSON();
          delete j.id; delete j.createdAt; delete j.updatedAt;
          const specs = readItemSpecs(j.specs);
          delete specs.rating; delete specs.ratingCount; // reviews belong to the original items
          return { ...j, specs, restaurantId: created.id };
        });
        if (rows.length) await MenuItem.bulkCreate(rows, { transaction: t });
        n = rows.length;
      }
      return { copy: created, count: n };
    });
    clearRestaurantsCache();
    realtime.notifyAdmin('store', 'created', copy.id, { storeId: copy.id });
    await logAuditAction(req, copy.id, 'DUPLICATE_RESTAURANT', { from: source.id, name, items: count, restaurantId: copy.id });
    res.status(201).json({ ...publicRestaurant(copy), itemCount: count });
  } catch (error) {
    sendAdminError(res, error, 'Could not duplicate the store.');
  }
};

// RB-5: promotions whose featuredUntil passed are switched off (row + Home banner) and pushed live.
// Runs every 10 minutes (jobs/index.js, one process per tick). Returns the number of stores changed. Never throws.
exports.expireFeaturedStores = async () => {
  try {
    const Restaurant = getRestaurantModel();
    if (!Restaurant) return 0;
    const expired = await Restaurant.findAll({ where: { isFeatured: true, featuredUntil: { [Op.lt]: new Date() } } });
    if (!expired.length) return 0;
    for (const store of expired) {
      await store.update({ isFeatured: false, featuredBadge: null, promoOffer: null });
    }
    try {
      const AppConfig = require('../models/AppConfig');
      const config = await AppConfig.findOne();
      if (config) {
        const banners = Array.isArray(config.banners) ? config.banners : [];
        const paths = new Set(expired.map((s) => `/restaurant/${s.id}`));
        const kept = banners.filter((b) => !(b && paths.has(String(b.redirectUrl || b.link || '').trim())));
        if (kept.length !== banners.length) {
          config.banners = kept;
          await config.save();
          realtime.publish('config', 'updated', 'app', { scope: 'banners' });
        }
      }
    } catch (bannerErr) {
      console.warn('[FEATURED_EXPIRY_BANNER_WARN]', bannerErr.message);
    }
    clearRestaurantsCache();
    for (const store of expired) realtime.publish('store', 'updated', store.id, { storeId: store.id });
    console.log(`[FEATURED_EXPIRY] Ended ${expired.length} expired promotion(s).`);
    return expired.length;
  } catch (err) {
    console.warn('[FEATURED_EXPIRY_ERROR]', err.message);
    return 0;
  }
};

// ─── Rider creation (dashboard Fleet page) ───────────────────────
// POST /api/admin/riders. Admin-only replacement for the public, rate-limited /api/delivery/register:
// created approved, no phone OTP, and no rider session token is returned to the admin's browser.
const RIDER_VEHICLE_TYPES = ['Bike', 'Scooter', 'Cycle', 'EV', 'Car', 'Walk'];
exports.createRider = async (req, res) => {
  try {
    const { normalizePhone } = require('../utils/phoneUtils');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 80) return res.status(400).json({ message: 'Enter the rider\'s full name (2 to 80 characters).', code: 'INVALID_INPUT' });
    const phone = typeof body.phone === 'string' || typeof body.phone === 'number' ? normalizePhone(String(body.phone)) : '';
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.', code: 'INVALID_INPUT' });
    const password = body.password;
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ message: 'Password must be 6 to 128 characters.', code: 'INVALID_INPUT' });
    }
    // Never trimmed silently (the rider types exactly what the admin shares): reject instead.
    if (password !== password.trim()) return res.status(400).json({ message: 'The password cannot start or end with a space.', code: 'INVALID_INPUT' });
    const rawVehicle = typeof body.vehicleType === 'string' ? body.vehicleType.trim() : '';
    const vehicleType = rawVehicle ? (RIDER_VEHICLE_TYPES.find(v => v.toLowerCase() === rawVehicle.toLowerCase()) || rawVehicle.slice(0, 30)) : 'Bike';

    const DeliveryPartner = getDeliveryPartnerModel();
    const exists = await DeliveryPartner.findOne({ where: { phone }, attributes: ['id'] });
    if (exists) return res.status(409).json({ message: 'A rider with this mobile number already exists.', code: 'CONFLICT' });

    const rider = await DeliveryPartner.create({ name, phone, password, vehicleType, isApproved: true });
    await logAuditAction(req, rider.id, 'FLEET_RIDER_CREATED', { name, vehicleType });
    realtime.notifyAdmin('rider', 'created', rider.id);
    const json = rider.toJSON();
    for (const k of ['password', 'tokenVersion', 'fcmTokens']) delete json[k];
    res.status(201).json({ ...json, _id: rider.id });
  } catch (error) {
    if (error && error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ message: 'A rider with this mobile number already exists.', code: 'CONFLICT' });
    if (error && error.name === 'SequelizeValidationError') return res.status(400).json({ message: error.errors?.[0]?.message || 'Invalid rider details.', code: 'INVALID_INPUT' });
    sendServerError(res, error, '[ADMIN_CREATE_RIDER_ERROR]');
  }
};

// ─── "Needs attention" counters for the dashboard overview ───────
// GET /api/admin/attention-counts. One SQL COUNT per queue instead of downloading every ticket / wall
// submission / booking to count it in the browser. A queue whose table is missing or fails is null.
exports.getAttentionCounts = async (req, res) => {
  const safeCount = async (load, where) => {
    try {
      const Model = load();
      if (!Model) return null;
      return await Model.count({ where });
    } catch (err) {
      console.warn('[ATTENTION_COUNT_WARN]', err.message);
      return null;
    }
  };
  const stallStuck = require('../utils/stallStuckJob');
  const [tickets, verifications, pgBookings, wallPending, serviceRequests, stuckStallOrders] = await Promise.all([
    safeCount(() => require('../models/Ticket').getTicketModel(), { status: { [Op.in]: ['Open', 'In Progress'] } }),
    safeCount(() => require('../modules/campus/models/Verification').getVerificationModel(), { status: 'pending', type: 'id_card' }),
    safeCount(() => require('../models/PGBooking').getPGBookingModel(), { status: 'Pending' }),
    safeCount(() => require('../models/WallSubmission').getWallSubmissionModel(), { isApproved: false }),
    safeCount(() => require('../models/ServiceBooking').getServiceBookingModel(), { status: 'REQUESTED' }),
    safeCount(() => require('../models/Order').getOrderModel(), stallStuck.stuckStallWhere(stallStuck.STUCK_HOURS)),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ tickets, verifications, pgBookings, wallPending, serviceRequests, stuckStallOrders, stuckStallHours: stallStuck.STUCK_HOURS });
};

// ─── Assign / unassign a rider (support intervention) ───────────────────────────────
// PUT /api/admin/orders/:id/rider { riderId: '<uuid>' | null }
// Before pickup only (Accepted / Preparing / ReadyForPickup / Picking): the food is still at the store.
// A rider-set 'Picking' step is undone (back to ReadyForPickup if the kitchen marked it ready, else
// Preparing), exactly like a rider release. Stall (VENDOR) orders never have a rider. The write is
// conditional on the rider + status read here, so a claim / pickup / cancel that lands meanwhile wins (409).
const ADMIN_ASSIGNABLE = ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking'];
const ADMIN_MAX_ACTIVE_ORDERS = Math.max(1, parseInt(process.env.RIDER_MAX_ACTIVE_ORDERS, 10) || 3);

/**
 * Take the rider off an order that is still at the store and put it back in the rider pool: the same
 * write, sockets and pushes as an admin "Remove rider" (PUT /api/admin/orders/:id/rider { riderId: null }).
 * Also used by the rider pickup-timeout job (orderController.releaseStalledRiderClaims).
 * Conditional on the rider + status read in `order` (+ opts.extraWhere): resolves false when a pickup /
 * cancel / other change landed first (nothing done), true when the rider was removed.
 * opts: { io, reason, extraWhere }
 */
const releaseOrderRider = async (order, { io = null, reason = 'Removed by Zenvy support', extraWhere = null } = {}) => {
  const Order = getOrderModel();
  const oldRiderId = order.deliveryPartnerId || null;
  if (!oldRiderId) return false;
  const nextStatus = order.status === 'Picking' ? (order.readyAt ? 'ReadyForPickup' : 'Preparing') : order.status;
  const [n] = await Order.update(
    { deliveryPartnerId: null, status: nextStatus },
    { where: { id: order.id, deliveryPartnerId: oldRiderId, status: order.status, ...(extraWhere || {}) } }
  );
  if (!n) return false;
  order.deliveryPartnerId = null;
  order.status = nextStatus;

  const { refreshRiderCurrentOrder, pushNearestRiders } = require('../utils/riderDispatch');
  realtime.leaveOrderRoom(oldRiderId, order.id);
  await refreshRiderCurrentOrder(oldRiderId);
  // The old rider's app drops the order on its refetch (it vanished from their active list).
  if (io) io.to(`rider_${oldRiderId}`).emit('statusUpdated', { id: order.id, status: order.status, reassigned: true });
  realtime.deliveryRequest(order.id); // back in the pool for every online rider
  if (io) {
    const payload = { id: order.id, status: order.status, riderAssigned: false };
    io.to(String(order.id)).emit('statusUpdated', payload);
    io.to('admin-room').emit('statusUpdated', payload);
    if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', payload);
    io.to('admin-room').emit('order_unassigned', { orderId: order.id, reason });
  }
  realtime.notifyAdmin('order', 'updated', order.id);
  try {
    const restaurant = order.restaurantId ? await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name', 'location'] }) : null;
    await pushNearestRiders({ restaurant, orderId: order.id, limit: 5, excludeRiderId: oldRiderId, title: '🛵 Order needs a rider', body: `${restaurant?.name || 'A store'} has an order waiting for a rider.` });
  } catch (pushErr) {
    console.warn('[ADMIN_ASSIGN_PUSH_WARN]', pushErr.message);
  }
  return true;
};
exports.releaseOrderRider = releaseOrderRider;

exports.assignOrderRider = async (req, res) => {
  try {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID.test(String(req.params.id || ''))) return res.status(404).json({ message: 'Order not found' });
    const raw = req.body ? req.body.riderId : undefined;
    if (raw !== null && (typeof raw !== 'string' || !UUID.test(raw))) {
      return res.status(400).json({ message: 'riderId must be a rider id, or null to unassign.', code: 'INVALID_INPUT' });
    }
    const newRiderId = raw;
    const Order = getOrderModel();
    const DeliveryPartner = getDeliveryPartnerModel();
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.fulfilment === 'VENDOR') return res.status(400).json({ message: 'The stall delivers this order itself: there is no rider to assign.', code: 'STALL_ORDER' });
    if (!ADMIN_ASSIGNABLE.includes(order.status)) {
      return res.status(400).json({ message: 'A rider can only be assigned or removed before pickup.', code: 'NOT_ASSIGNABLE', status: order.status });
    }
    const oldRiderId = order.deliveryPartnerId || null;
    if (oldRiderId === newRiderId) return res.json({ message: newRiderId ? 'This rider already has the order.' : 'No rider was assigned.', orderId: order.id, status: order.status, riderId: newRiderId, alreadyApplied: true });

    let rider = null;
    if (newRiderId) {
      rider = await DeliveryPartner.findByPk(newRiderId);
      if (!rider) return res.status(404).json({ message: 'Rider not found' });
      if (!rider.isApproved) return res.status(400).json({ message: `${rider.name || 'This rider'} is not approved.`, code: 'RIDER_NOT_APPROVED' });
      const held = await Order.count({ where: { deliveryPartnerId: rider.id, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } });
      if (held >= ADMIN_MAX_ACTIVE_ORDERS) {
        return res.status(409).json({ message: `${rider.name || 'This rider'} already carries ${held} orders (the most allowed).`, code: 'MAX_ACTIVE' });
      }
    }
    if (!newRiderId) {
      // Remove the rider: shared with the pickup-timeout job (same write, sockets and pushes).
      const released = await releaseOrderRider(order, { io: req.app.get('io'), reason: 'Removed by Zenvy support' });
      if (!released) return res.status(409).json({ message: 'This order was just updated (claimed, picked up or cancelled). Refresh and try again.', code: 'ORDER_CHANGED' });
      await logAuditAction(req, order.id, 'ORDER_RIDER_UNASSIGNED', { from: oldRiderId, to: null });
      return res.json({ message: 'Rider removed. The order is back with the riders.', orderId: order.id, status: order.status, riderId: null });
    }
    const nextStatus = order.status === 'Picking' ? (order.readyAt ? 'ReadyForPickup' : 'Preparing') : order.status;
    const [n] = await Order.update(
      { deliveryPartnerId: newRiderId, status: nextStatus },
      { where: { id: order.id, deliveryPartnerId: oldRiderId, status: order.status } }
    );
    if (!n) return res.status(409).json({ message: 'This order was just updated (claimed, picked up or cancelled). Refresh and try again.', code: 'ORDER_CHANGED' });
    order.deliveryPartnerId = newRiderId;
    order.status = nextStatus;

    const { refreshRiderCurrentOrder, pushNearestRiders } = require('../utils/riderDispatch');
    const io = req.app.get('io');
    if (oldRiderId) {
      realtime.leaveOrderRoom(oldRiderId, order.id);
      await refreshRiderCurrentOrder(oldRiderId);
      // The old rider's app drops the order on its refetch (it vanished from their active list).
      if (io) io.to(`rider_${oldRiderId}`).emit('statusUpdated', { id: order.id, status: order.status, reassigned: true });
    }
    if (newRiderId) {
      await DeliveryPartner.update({ currentOrderId: order.id }, { where: { id: newRiderId, currentOrderId: null } });
      await refreshRiderCurrentOrder(newRiderId);
      if (!oldRiderId) realtime.deliveryRequestGone(order.id);
    } else {
      realtime.deliveryRequest(order.id); // back in the pool for every online rider
    }
    if (io) {
      const payload = { id: order.id, status: order.status, riderAssigned: !!newRiderId };
      io.to(String(order.id)).emit('statusUpdated', payload);
      io.to('admin-room').emit('statusUpdated', payload);
      if (order.restaurantId) io.to(`restaurant_${order.restaurantId}`).emit('statusUpdated', payload);
      if (!newRiderId) io.to('admin-room').emit('order_unassigned', { orderId: order.id, reason: 'Removed by Zenvy support' });
    }
    realtime.notifyAdmin('order', 'updated', order.id);
    const restaurant = order.restaurantId ? await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name', 'location'] }) : null;
    try {
      if (newRiderId) {
        const tokens = (Array.isArray(rider.fcmTokens) ? rider.fcmTokens : []).map((t) => (typeof t === 'string' ? t : t && t.token)).filter(Boolean);
        if (tokens.length) {
          await require('../utils/push').sendPushToTokens(tokens, '🛵 Order assigned to you', `Zenvy support gave you an order from ${restaurant?.name || 'a store'}.`, { orderId: String(order.id), type: 'ORDER_ASSIGNED' }, {
            persist: false,
            android: { priority: 'high', notification: { sound: 'alert', channelId: require('../utils/riderDispatch').RIDER_NEW_ORDER_CHANNEL } },
          });
        }
      } else {
        await pushNearestRiders({ restaurant, orderId: order.id, limit: 5, excludeRiderId: oldRiderId, title: '🛵 Order needs a rider', body: `${restaurant?.name || 'A store'} has an order waiting for a rider.` });
      }
    } catch (pushErr) {
      console.warn('[ADMIN_ASSIGN_PUSH_WARN]', pushErr.message);
    }
    await logAuditAction(req, order.id, newRiderId ? 'ORDER_RIDER_ASSIGNED' : 'ORDER_RIDER_UNASSIGNED', { from: oldRiderId, to: newRiderId });
    res.json({
      message: newRiderId ? `Assigned to ${rider.name || 'the rider'}.` : 'Rider removed. The order is back with the riders.',
      orderId: order.id, status: order.status, riderId: newRiderId,
    });
  } catch (error) {
    sendServerError(res, error, '[ADMIN_ASSIGN_RIDER_ERROR]');
  }
};
