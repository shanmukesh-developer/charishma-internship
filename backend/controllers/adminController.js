const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getUserModel } = require('../models/User');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { getOrderModel } = require('../models/Order');
const { getVaultItemModel } = require('../models/VaultItem');
const { getGlobalConfigModel } = require('../models/GlobalConfig');
const { getVerificationLogModel } = require('../models/VerificationLog');
const { Op, Transaction } = require('sequelize');
const walletLedger = require('../utils/walletLedger');

const { getStoreOpenState, normalizeOperatingHours, withCampusWindow } = require('../utils/storeHours');
const { STORE_VENDOR_TYPES, isLocalVendorStore, isServiceVendorType } = require('../utils/vendorTypes');
const { sortMenuItems } = require('../utils/menuSort');

// Public restaurant listing cache: short TTL + cleared on every admin/vendor menu or status change.
let cachedRestaurantsResponse = null;
let cachedRestaurantsAt = 0;
const RESTAURANTS_CACHE_TTL_MS = 60 * 1000;
const extraCacheClears = [];
const responseCache = require('../utils/responseCache');
const clearRestaurantsCacheNow = () => {
  cachedRestaurantsResponse = null;
  cachedRestaurantsAt = 0;
  try { responseCache.invalidate('catalog'); } catch { /* never break a write */ }
  for (const fn of extraCacheClears) { try { fn(); } catch { /* never break a write */ } }
};
// A clear runs at once; more clears within CATALOG_CLEAR_GAP_MS are folded into one more clear at the end of
// that gap. At lunch every store toggling stock cleared the catalogue many times a second, and each clear meant
// a full rebuild (every menu item loaded and serialised on the one CPU) for the next customer.
const CATALOG_CLEAR_GAP_MS = Math.max(0, Number(process.env.CATALOG_CLEAR_GAP_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 3000)));
let lastCatalogClearAt = 0;
let catalogClearTimer = null;
const clearRestaurantsCacheLocal = () => {
  const since = Date.now() - lastCatalogClearAt;
  if (!CATALOG_CLEAR_GAP_MS || since >= CATALOG_CLEAR_GAP_MS) {
    lastCatalogClearAt = Date.now();
    clearRestaurantsCacheNow();
    return;
  }
  if (catalogClearTimer) return;
  catalogClearTimer = setTimeout(() => {
    catalogClearTimer = null;
    lastCatalogClearAt = Date.now();
    clearRestaurantsCacheNow();
  }, CATALOG_CLEAR_GAP_MS - since);
  if (catalogClearTimer.unref) catalogClearTimer.unref();
};
// B1: with REDIS_URL set every other instance clears its listing caches too (utils/cacheBus).
const clearRestaurantsCache = require('../utils/cacheBus').wrap('restaurants.list', clearRestaurantsCacheLocal, { resync: clearRestaurantsCacheNow });
exports.clearRestaurantsCache = clearRestaurantsCache;
// Other listing caches (GET /api/restaurants) register here so every store/product change clears them.
exports.onRestaurantsCacheClear = (fn) => { if (typeof fn === 'function') extraCacheClears.push(fn); };

// Columns public store / menu reads never return (stripStoreSecrets / stripItemSecrets drop them
// after the fact): leaving them out of the SELECT saves the DB round-trip payload and parsing.
const STORE_LISTING_EXCLUDE = ['password', 'fcmTokens', 'tokenVersion', 'commissionRate', 'commissionType', 'phone', ...require('../utils/publicFields').STORE_PRIVATE_FIELDS];
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
// ?fields=summary (Home, app 1.0.8+): the same stores with a light menu, only the available dishes and
// only the fields the Home list uses (name, price, photo, category, tags, veg). The full menu is fetched
// on the store page (GET /api/users/restaurants/:id). Without the parameter the response is unchanged.
const SUMMARY_ITEM_FIELDS = ['id', '_id', 'restaurantId', 'name', 'price', 'imageUrl', 'category', 'tags', 'isVegetarian', 'dietType', 'isAvailable'];
// A dish with choices to make keeps just those in specs (the admin's options, the customisable flag): Home's quick add
// reads them (productOptions / isCustomizable) and opens the dish page instead of a bare add that checkout refused
// ("please choose a Portion"). Any other specs stay out of the summary.
const summarySpecs = (specs) => {
  let s = specs;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
  if (!s || typeof s !== 'object') return null;
  const out = {};
  const options = require('../utils/productOptions').readOptions(s);
  if (options.length) out.options = options;
  if (s.customizable === true) out.customizable = true;
  return Object.keys(out).length ? out : null;
};
const summaryItem = (m) => {
  const out = {};
  for (const k of SUMMARY_ITEM_FIELDS) if (m[k] !== undefined && m[k] !== null) out[k] = m[k];
  const specs = summarySpecs(m.specs);
  if (specs) out.specs = specs;
  return out;
};
const summaryStore = (r) => {
  const { menu, description, ...rest } = r;
  const all = Array.isArray(menu) ? menu : [];
  const available = all.filter((m) => m && m.isAvailable !== false);
  return { ...rest, menu: available.map(summaryItem), menuCount: all.length, menuMode: 'summary' };
};
let summaryCache = { source: null, body: null };
const summaryOf = (full) => {
  if (summaryCache.source !== full) summaryCache = { source: full, body: full.map(summaryStore) };
  return summaryCache.body;
};

exports.getRestaurants = async (req, res) => {
  try {
    // Stores (grocery, pharmacy, add-ons, …) are browsed via /api/catalogue; ?includeStores=true lists them too.
    const includeStores = String(req.query.includeStores || '').toLowerCase() === 'true';
    const summary = String(req.query.fields || '').toLowerCase() === 'summary';
    // ?college=srmap: only the stores that serve the student's college (utils/campuses; none set = every college).
    const campuses = require('../utils/campuses');
    const college = campuses.normalizeKey(req.query.college);
    const send = (full) => {
      const list = summary ? summaryOf(full) : full;
      const scoped = college ? list.filter((r) => campuses.storeServes(r, college)) : list;
      return res.json(includeStores ? scoped : scoped.filter(r => !STORE_VENDOR_TYPES.includes(String(r.vendorType || '').toUpperCase())));
    };
    // A tester's / admin's request may hold owner-only test stores (utils/testView): it skips the shared copy.
    const shared = require('../utils/testView').sharesCache();
    const fresh = shared && cachedRestaurantsResponse && (Date.now() - cachedRestaurantsAt) < RESTAURANTS_CACHE_TTL_MS;
    if (fresh) return send(cachedRestaurantsResponse);

    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const { Op } = require('sequelize');

    // Batch-fetch all restaurants and their menu items in 2 queries (eliminates N+1)
    // Secrets are stripped from the response anyway: never read them (or push tokens) per listing.
    // In-Campus Booking stalls are pickup-only (owner, 30 Oct 2026): listed under In-Campus Booking, never with the
    // delivery stores here.
    const restaurants = await Restaurant.findAll({
      where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), [Op.and]: [{ [Op.or]: [{ campusBookingEnabled: false }, { campusBookingEnabled: null }] }] },
      attributes: { exclude: STORE_LISTING_EXCLUDE },
    });
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
      const openState = withCampusWindow(getStoreOpenState(r));
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
        campusClosed: !!openState.campusClosed,
        // Delivery slots: closed now but orderable for the next slot (new keys).
        ...require('../utils/deliverySlots').slotListingFields(r),
        menu: menuByRestaurant[r.id] || []
      };
    });

    if (shared) {
      cachedRestaurantsResponse = result;
      cachedRestaurantsAt = Date.now();
    }
    send(result);
  } catch (error) {
    console.error('[RESTAURANTS_ERROR]', error);
    res.status(500).json({ message: 'Could not load restaurants right now. Pull down to refresh.' });
  }
};

// S0: the store itself (restaurant / vendor app token for this id) or a live admin. Used to show an
// inactive (suspended / unlisted) store only to them; everyone else gets 404.
const storeViewerPrivileged = async (req, storeId) => {
  try {
    const h = String((req.headers && req.headers.authorization) || '');
    const raw = h.startsWith('Bearer ') ? h.slice(7) : (req.cookies && req.cookies.token) || '';
    if (!raw || !process.env.JWT_SECRET) return false;
    const decoded = require('jsonwebtoken').verify(String(raw).replace(/['"]+/g, '').trim(), process.env.JWT_SECRET);
    if (decoded && String(decoded.role || '').toLowerCase() === 'restaurant' && String(decoded.id) === String(storeId)) {
      const row = await getRestaurantModel().findByPk(storeId, { attributes: ['id', 'tokenVersion'] });
      return !!row && (Number(decoded.tv) || 0) === (Number(row.tokenVersion) || 0);
    }
    return await require('../middleware/authMiddleware').isLiveAdminRequest(req);
  } catch {
    return false;
  }
};
exports.storeViewerPrivileged = storeViewerPrivileged;
exports.logAuditAction = logAuditAction;
exports.publicRestaurant = (r) => publicRestaurant(r);

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
    // S0: an inactive store is not public (the store's own app and admins still read it).
    if (restaurant.isActive === false && !(await storeViewerPrivileged(req, restaurant.id))) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }
    const resObj = restaurant.toJSON();
    stripStoreSecrets(resObj);
    applyFeaturedExpiry(resObj);
    let tags = resObj.tags || [];
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }

    const openState = withCampusWindow(getStoreOpenState(restaurant));
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
      campusClosed: !!openState.campusClosed,
      // Delivery slots: closed now but orderable for the next slot (new keys).
      ...require('../utils/deliverySlots').slotListingFields(restaurant),
      ...stallExtra,
      menu: sortMenuItems(menu).map(m => {
        const mObj = stripItemSecrets(m.toJSON());
        let mTags = mObj.tags || [];
        if (typeof mTags === 'string') {
          try { mTags = JSON.parse(mTags); } catch { mTags = []; }
        }
        // Customer choices: the admin's, else automatic weights (utils/productOptions, docs/PRODUCT_OPTIONS.md).
        const po = require('../utils/productOptions');
        const opts = po.effectiveOptions(m, restaurant.vendorType);
        // Sold in weights: the row's price / MRP / size are the default weight's own (never the lowest weight's
        // price next to the 1 kg pack's MRP, which read as a false "74% off").
        const listed = po.listingFromOptions(opts);
        const mSpecs = mObj.specs && typeof mObj.specs === 'object' ? mObj.specs : {};
        return {
          ...mObj, tags: mTags, _id: m.id, id: m.id, image: mObj.imageUrl || mObj.image,
          ...(listed ? { price: listed.price, originalPrice: listed.originalPrice, weight: listed.weight } : (mSpecs.weight ? { weight: po.packLabel(mSpecs.weight) } : {})),
          ...(opts.length ? { options: opts } : {}),
        };
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
        restaurantName: 'ZenWe Daily Deals',
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
    // Delivery slots: a store closed right now still takes orders for its next open slot.
    const slotInfo = require('../utils/deliverySlots').slotListingFields(restaurant, { skip: !restaurant || bookingOnly });
    res.json({
      ...itemObj,
      _id: item.id,
      id: item.id,
      tags,
      image: itemObj.imageUrl || itemObj.image,
      originalPrice: itemObj.originalPrice || specs.originalPrice || null,
      dietType: itemObj.dietType || (itemObj.isVegetarian === false ? 'nonveg' : 'veg'),
      weight: require('../utils/productOptions').packLabel(specs.weight) || null, // "1000" -> "1 kg"
      rating: specs.rating || null,
      ratingCount: specs.ratingCount || 0,
      isAvailable: inStock,
      bookingOnly,
      // Customer choices: the admin's, else automatic weights (utils/productOptions, docs/PRODUCT_OPTIONS.md).
      ...(() => { const o = require('../utils/productOptions').effectiveOptions(item, restaurant && restaurant.vendorType); return o.length ? { options: o } : {}; })(),
      // CampusBites stalls are ordered in Zenvy: cash to the stall, the stall delivers it.
      orderable: inStock && !bookingOnly && !!restaurant && restaurant.isActive !== false && !(stall && restaurant.isOffline) && (openState.isOpen || slotInfo.takesSlotOrders),
      directOrderOnly: false,
      ...(stall ? { fulfilment: 'VENDOR', paymentMethods: ['COD'], whatsappNumber: restaurant.whatsappNumber || null } : {}),
      restaurantName: restaurant ? restaurant.name : null,
      restaurantId: restaurant ? restaurant.id : null,
      vendorType: restaurant ? restaurant.vendorType : null,
      storeIsOpen: openState.isOpen,
      storeClosedReason: openState.isOpen ? null : (openState.message || null),
      ...slotInfo,
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
        isActive: true, ...(await require('../utils/receiptSettings').listingWhere())
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
// (data:text/html, SVG, huge strings) is rejected. `existing` = the row being edited: its current
// photo links pass unchanged (an old temporary link never blocks a price edit; the list flags it).
const mediaizeImageFields = async (out, req, keys, purpose, existing = null) => {
  const { storeImageRef } = require('../utils/imageStore');
  for (const key of keys) {
    if (out[key] === undefined) continue;
    const keep = existing ? (typeof existing.get === 'function' ? existing.get(key) : existing[key]) : null;
    const r = await storeImageRef(out[key], { req, ownerId: req.user && req.user.id, purpose, keep });
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
  'phone', 'packagingFee', 'minOrderValue', 'logoUrl',
  // 31 Oct 2026: the colleges the store serves (utils/campuses; empty = every college)
  'visibleCampuses'
];
const MENU_ITEM_FIELDS = [
  'name', 'price', 'description', 'imageUrl', 'category', 'tags', 'isVegetarian', 'isAvailable',
  'outOfStockUntil', 'isEliteOnly', 'customCommission', 'specs', 'ownerName', 'ownerPhone',
  'dietType', 'originalPrice',
  // Delivery slots: a specialized cake books 2½ hours before the slot (utils/deliverySlots).
  'isSpecializedCake'
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
  // C8: PAN never leaves the server unmasked; the compliance block carries the FSSAI status for badges.
  const compliance = require('../utils/storeCompliance').privateView(json);
  delete json.pan;
  return {
    ...json,
    _id: json.id,
    panMasked: compliance.panMasked,
    compliance,
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
  // Delivery zone (rider dispatch): an emptied field means the default zone, never NULL.
  if (out.zone !== undefined) out.zone = String(out.zone || '').trim().slice(0, 60) || 'Amaravathi_Central';
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
  if (out.visibleCampuses !== undefined) {
    const c = require('../utils/campuses').cleanVisibleCampuses(out.visibleCampuses);
    if (c.error) throw new AdminInputError(c.error);
    out.visibleCampuses = c.list.length ? c.list : null;
  }
  return out;
};

const readItemSpecs = (specs) => {
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
};

// specs are merged into the stored ones (bookingOnly, weight, brand, extraFor... are kept); a key sent as null is removed.
// opts.allowFree: a service store's product (booking-only: ₹0 means "priced after a quote"); everything else needs a price.
const pickMenuItemFields = (body = {}, existing = null, opts = {}) => {
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
    // A ₹0 product would be given away free (a typo, or a CSV cell left at 0). Booking-only services are exempt.
    const bookingOnly = !!(readItemSpecs(body.specs).bookingOnly || readItemSpecs(existing && existing.specs).bookingOnly);
    const ownWeights = out.specs !== undefined && Array.isArray(readItemSpecs(out.specs).options) && readItemSpecs(out.specs).options.length;
    if (out.price === 0 && !opts.allowFree && !bookingOnly && !ownWeights) {
      throw new AdminInputError(`${out.name || (existing && existing.name) || 'This product'}: enter a price above ₹0.`);
    }
    // A product sold in the admin's own weights / sizes takes its price from them: a bare price change (the
    // catalogue's quick price edit, a bulk price update) would leave lists out of step with the weights.
    if (existing && out.specs === undefined) {
      const fromWeights = require('../utils/productOptions').variantFromPrice(require('../utils/productOptions').readOptions(existing.specs));
      if (fromWeights !== null && out.price !== fromWeights) {
        throw new AdminInputError(`${existing.name || 'This product'} is sold in weights / sizes, so its price comes from them. Open the product and change the weight prices.`);
      }
    }
  }
  if (out.imageUrl !== undefined) out.imageUrl = String(out.imageUrl || '').trim() || null;
  if (out.category !== undefined) out.category = String(out.category || '').trim() || null;
  if (out.tags !== undefined) out.tags = cleanTags(out.tags);
  for (const key of ['isVegetarian', 'isAvailable', 'isEliteOnly', 'isSpecializedCake']) if (out[key] !== undefined) out[key] = toBool(out[key]);
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
    // Customer choices (weights, flavours, types) and ordered product details: docs/PRODUCT_OPTIONS.md.
    const po = require('../utils/productOptions');
    // autoWeights: only false is stored (the admin removed the automatic 250 g / 500 g / 1 kg weights).
    if (incoming.autoWeights !== undefined) incoming.autoWeights = incoming.autoWeights === false || incoming.autoWeights === 'false' ? false : null;
    try {
      if (incoming.options !== undefined) incoming.options = po.normalizeOptions(incoming.options);
      if (incoming.details !== undefined) incoming.details = po.normalizeDetails(incoming.details);
    } catch (optErr) {
      if (optErr instanceof po.OptionsInputError) throw new AdminInputError(optErr.message);
      throw optErr;
    }
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
    // With a weight / size group the product's own price is its lowest weight (lists show "from ₹...").
    const fromPrice = require('../utils/productOptions').variantFromPrice(Array.isArray(merged.options) ? merged.options : []);
    if (fromPrice !== null) out.price = fromPrice;
  }
  return out;
};

// Partner sign-in uses the exact store name and the login phone, so both must be unique.
// Throws a 409-style AdminConflictError. `selfId` is excluded (edits).
class AdminConflictError extends Error {}
// Last 10 digits of an Indian mobile ("91XXXXXXXXXX" as stored, +91…, 0…), or null.
const tenDigitsOf = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  const t = d.length === 12 && d.startsWith('91') ? d.slice(2) : (d.length === 11 && d.startsWith('0') ? d.slice(1) : d);
  return /^\d{10}$/.test(t) ? t : null;
};
// signInWhatsapp: a stall without a login phone signs in with its WhatsApp number (restaurantController login looks
// the phone up first, then such stalls), so that number must not answer for another store either.
const assertUniqueStore = async ({ name, phone, signInWhatsapp }, selfId = null) => {
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
  const loginPhone = tenDigitsOf(phone);
  const wa = tenDigitsOf(signInWhatsapp);
  const nums = [...new Set([loginPhone, wa].filter(Boolean))];
  if (nums.length) {
    const { LOCAL_VENDOR_TYPES } = require('../utils/vendorTypes');
    const stalls = await Restaurant.findAll({ where: { vendorType: { [Op.in]: LOCAL_VENDOR_TYPES }, whatsappNumber: { [Op.ne]: null }, ...notSelf }, attributes: ['id', 'name', 'phone', 'whatsappNumber'] });
    for (const n of nums) {
      const hit = stalls.find((st) => !st.phone && tenDigitsOf(st.whatsappNumber) === n);
      if (hit) throw new AdminConflictError(`${n === wa && n !== loginPhone ? 'This WhatsApp number' : 'This phone number'} already signs in to ${hit.name} (its WhatsApp number). Use a different number, or give one of them its own login phone.`);
    }
  }
  if (wa && wa !== loginPhone) {
    const clash = await Restaurant.findOne({ where: { phone: wa, ...notSelf }, attributes: ['id', 'name'] });
    if (clash) throw new AdminConflictError(`This WhatsApp number already signs in to ${clash.name}. Give this stall its own login phone.`);
  }
};

const sendAdminError = (res, error, fallback) => {
  if (error instanceof AdminInputError) return res.status(400).json({ message: error.message });
  if (error instanceof require('../utils/storeCompliance').ComplianceInputError) return res.status(400).json({ code: error.code, field: error.field, message: error.message });
  if (error instanceof AdminConflictError) return res.status(409).json({ message: error.message, code: 'CONFLICT' });
  if (error && error.name === 'SequelizeValidationError') return res.status(400).json({ message: error.errors?.[0]?.message || fallback });
  // A duplicate (coupon code, phone, unique key): say so instead of a raw database error.
  if (error && error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ message: 'That already exists. Use a different value.', code: 'CONFLICT' });
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
    await assertUniqueStore({ name: data.name, phone: data.phone, signInWhatsapp: isLocalVendorStore(data) && !data.phone ? data.whatsappNumber : null });
    // C8: seller compliance fields (legal name, FSSAI, GSTIN, PAN, payout) are validated and audited.
    const comp = require('../utils/storeCompliance');
    const { patch: compPatch, changes: compChanges } = comp.hasComplianceInput(req.body) ? comp.validateCompliance(req.body, {}, { actor: 'admin' }) : { patch: {}, changes: {} };
    Object.assign(data, compPatch);
    const restaurant = await Restaurant.create(data);
    if (Object.keys(compChanges).length) await logAuditAction(req, restaurant.id, 'STORE_COMPLIANCE_UPDATED', { name: restaurant.name, changes: compChanges });
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

    const updateData = await mediaizeBrandTheme(await mediaizeImageFields(pickRestaurantFields(req.body), req, ['imageUrl', 'logoUrl'], 'store', restaurant), req);
    if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim().length >= 6) {
      updateData.password = req.body.password.trim(); // hashed by the model hook
    }
    // C8: seller compliance fields from the store edit form (validated, audited below).
    const comp = require('../utils/storeCompliance');
    const { patch: compPatch, changes: compChanges } = comp.hasComplianceInput(req.body) ? comp.validateCompliance(req.body, restaurant, { actor: 'admin' }) : { patch: {}, changes: {} };
    Object.assign(updateData, compPatch);
    // The sign-in numbers are checked only when they change (an older clash never blocks an unrelated edit).
    const after = {
      vendorType: updateData.vendorType !== undefined ? updateData.vendorType : restaurant.vendorType,
      isLocalVendor: restaurant.isLocalVendor,
      phone: updateData.phone !== undefined ? updateData.phone : restaurant.phone,
      whatsappNumber: updateData.whatsappNumber !== undefined ? updateData.whatsappNumber : restaurant.whatsappNumber,
    };
    const signInChanged = ['vendorType', 'phone', 'whatsappNumber'].some((k) => updateData[k] !== undefined && String(updateData[k] ?? '') !== String(restaurant[k] ?? ''));
    await assertUniqueStore({
      name: updateData.name !== undefined && updateData.name.toLowerCase() !== String(restaurant.name || '').toLowerCase() ? updateData.name : null,
      phone: updateData.phone && updateData.phone !== restaurant.phone ? updateData.phone : null,
      signInWhatsapp: signInChanged && isLocalVendorStore(after) && !after.phone ? after.whatsappNumber : null,
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
    await logAuditAction(req, restaurant.id, 'UPDATE_RESTAURANT', { name: restaurant.name, fields: Object.keys(updateData).filter(k => k !== 'password' && !(k in compPatch)) });
    if (Object.keys(compChanges).length) await logAuditAction(req, restaurant.id, 'STORE_COMPLIANCE_UPDATED', { name: restaurant.name, changes: compChanges });
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
      const store = await Restaurant.findByPk(menuItem.restaurantId, { attributes: ['id', 'vendorType'] });
      const allowFree = !!store && isServiceVendorType(store.vendorType);
      await menuItem.update(await mediaizeImageFields(pickMenuItemFields(req.body, menuItem, { allowFree }), req, ['imageUrl'], 'menu', menuItem));
    } else {
      const restaurantId = String(req.body.restaurantId || '');
      const store = UUID_RE.test(restaurantId) ? await Restaurant.findByPk(restaurantId, { attributes: ['id', 'vendorType'] }) : null;
      if (!store) {
        return res.status(400).json({ message: 'Pick the store this product belongs to.' });
      }
      const allowFree = isServiceVendorType(store.vendorType);
      menuItem = await MenuItem.create({ ...(await mediaizeImageFields(pickMenuItemFields(req.body, null, { allowFree }), req, ['imageUrl'], 'menu')), restaurantId });
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
    // A filtered list (approved riders for the fleet map, SOS riders) may come in one page of up to 500,
    // so the dashboard no longer chains page after page of 100 before the map can draw.
    const filtered = ['1', 'true'].includes(req.query.approved) || ['1', 'true'].includes(req.query.sosActive);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), filtered ? 500 : 100);
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
    sendAdminError(res, error, 'Could not update the rider. Please try again.');
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
    sendAdminError(res, error, 'Could not update Elite status. Please try again.');
  }
};

// C5: admin wallet adjustment. A reason is required (min 5 characters); the balance change, its
// WalletTransactions row (ADMIN_CREDIT / ADMIN_DEBIT, actor = this admin) and the WALLET_UPDATE audit
// row are written in ONE transaction, so a failed audit write leaves no balance change behind.
// Optional Idempotency-Key header (or body.idempotencyKey): a repeated submit returns the first result.
exports.updateUserWallet = async (req, res) => {
  try {
    const User = getUserModel();
    const body = req.body || {};
    const delta = Number(body.amount);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ message: 'Invalid amount value', code: 'INVALID_AMOUNT' });
    }
    const amountPaise = walletLedger.toPaise(Math.abs(delta)) * Math.sign(delta);
    if (!amountPaise || Math.abs(delta) > 100000) {
      return res.status(400).json({ message: 'Amount must be between ₹0.01 and ₹1,00,000.', code: 'INVALID_AMOUNT' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5) {
      return res.status(400).json({ code: 'REASON_REQUIRED', field: 'reason', message: 'Please enter a reason for this wallet change (at least 5 characters). It is saved in the wallet history and the audit log. If you do not see a reason box, refresh the admin dashboard.' });
    }
    if (reason.length > 300) return res.status(400).json({ code: 'REASON_TOO_LONG', field: 'reason', message: 'Keep the reason under 300 characters.' });
    const user = await User.findByPk(req.params.userId, { attributes: ['id', 'email', 'phone', 'name'] });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const rawKey = String(req.get('Idempotency-Key') || body.idempotencyKey || '').trim().slice(0, 100);
    const VerificationLog = getVerificationLogModel();
    const adminId = req.user?.id ? String(req.user.id) : 'admin_default';

    const { getSequelize } = require('../config/db');
    let result;
    try {
      result = await getSequelize().transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
        const r = await walletLedger.applyWalletChange({
          t, ownerType: 'user', ownerId: user.id, amountPaise,
          type: amountPaise > 0 ? walletLedger.TYPES.ADMIN_CREDIT : walletLedger.TYPES.ADMIN_DEBIT,
          actor: { type: 'admin', id: adminId }, reason, idempotencyKey: rawKey ? `admin:${rawKey}` : null,
        });
        if (r.applied) {
          await VerificationLog.create({
            adminId,
            targetId: String(user.id),
            action: 'WALLET_UPDATE',
            details: JSON.stringify({ email: user.email, added: delta, amountPaise, reason, newBalance: r.balance, transactionId: r.row.id }).slice(0, 8000),
          }, { transaction: t });
        }
        return r;
      });
    } catch (err) {
      if (walletLedger.isInsufficient(err)) return res.status(400).json({ code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance cannot be negative' });
      throw err;
    }
    const newBalance = result.balance;
    clearCachedUser(user.id);
    broadcastSystemUpdate(req, 'USER_UPDATED', { userId: user.id, walletBalance: newBalance });
    realtime.notifyAdmin('user', 'updated', user.id);

    res.json({ message: 'Wallet updated', walletBalance: newBalance, transactionId: result.row.id, ...(result.duplicate ? { duplicate: true } : {}) });
  } catch (error) {
    sendServerError(res, error, '[ADMIN_WALLET_ERROR]');
  }
};

// C5: GET /api/admin/wallet/:ownerType/:ownerId/transactions?page=&limit=   (ownerType: user | rider)
exports.getWalletTransactions = async (req, res) => {
  try {
    const ownerType = String(req.params.ownerType || '').toLowerCase();
    if (!walletLedger.OWNER_TYPES.includes(ownerType)) return res.status(400).json({ code: 'INVALID_OWNER_TYPE', message: 'ownerType must be user or rider.' });
    const ownerId = String(req.params.ownerId || '');
    if (!UUID_RE.test(ownerId)) return res.status(400).json({ code: 'INVALID_ID', message: 'Invalid owner id.' });
    const Owner = ownerType === 'user' ? getUserModel() : getDeliveryPartnerModel();
    const owner = await Owner.findByPk(ownerId, { attributes: ['id', 'name', 'phone', 'walletBalance'] });
    if (!owner) return res.status(404).json({ message: ownerType === 'user' ? 'User not found' : 'Rider not found' });
    const { rows, page, limit, hasMore } = await walletLedger.listFor({ ownerType, ownerId, page: req.query.page, limit: req.query.limit });
    const { getSequelize } = require('../config/db');
    const WT = getSequelize().models.WalletTransaction;
    const ledgerPaise = Number(await WT.sum('amountPaise', { where: { ownerType, ownerId } })) || 0;
    const count = await WT.count({ where: { ownerType, ownerId } });
    const balancePaise = walletLedger.toPaise(owner.walletBalance);
    res.set('Cache-Control', 'no-store');
    res.json({
      owner: { id: owner.id, ownerType, name: owner.name, phone: owner.phone, walletBalance: walletLedger.toRupees(balancePaise), balancePaise },
      ledgerPaise,
      // No rows yet + a balance: it predates the ledger (recorded on its next change / next startup).
      inSync: count === 0 ? balancePaise === 0 : ledgerPaise === balancePaise,
      transactions: rows.map(walletLedger.toAdmin),
      page, limit, hasMore, total: count,
    });
  } catch (error) {
    sendServerError(res, error, '[ADMIN_WALLET_ERROR]');
  }
};

// C5: GET /api/admin/wallet/reconcile?limit=   Read-only check: ledger sum vs balance for every owner.
exports.getWalletReconcile = async (req, res) => {
  try {
    const r = await walletLedger.reconcile({ limit: req.query.limit });
    res.set('Cache-Control', 'no-store');
    res.json({ ...r, ok: r.mismatchCount === 0 && r.withoutHistoryCount === 0, status: walletLedger.reconcileStatus() });
  } catch (error) {
    sendServerError(res, error, '[ADMIN_WALLET_ERROR]');
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
    // Colleges only through PUT /api/admin/campuses/:key (validated + audited).
    if (key === require('../utils/campuses').KEY) {
      return res.status(400).json({ message: 'Colleges are edited on Config → Colleges (PUT /api/admin/campuses/:key).' });
    }
    // C8: receipt / tax display settings only through PUT /api/admin/receipt-settings (validated + audited).
    if (key === require('../utils/receiptSettings').KEY) {
      return res.status(400).json({ message: 'Receipt settings are edited on Config → Receipts (PUT /api/admin/receipt-settings).' });
    }
    // Owner-only test data (utils/testView): the phone numbers whose accounts see it. Saved as 10-digit numbers and
    // applied at once on every instance; the answer says how many customer / rider accounts those numbers matched.
    const testView = require('../utils/testView');
    if (key === testView.KEY) {
      const phones = testView.parsePhones(value);
      if (phones.length > 20) return res.status(400).json({ message: `${key} takes up to 20 phone numbers.` });
      const [, createdT] = await GlobalConfig.upsert({ key, value: phones, description: description || 'Phone numbers that see the owner-only test data (comma separated)' });
      testView.reloadTesters();
      const t = await testView.loadTesters({ fresh: true });
      // Data that needs a tester's account (rides, vehicle listings) is added once the first one exists.
      require('../scripts/test_data_v2_seed').runTestDataV2Seed({ reason: 'testers saved' }).catch((err) => console.warn('[TEST_DATA_V2]', err.message));
      return res.json({ key, value: phones, created: createdT, matched: { customers: t.userIds.size, riders: t.riderIds.size } });
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
    // Orders per delivery slot (whole orders, 0 = no limit): utils/deliverySlots applyCapacity.
    const slotsLib = require('../utils/deliverySlots');
    if (key === slotsLib.CAP_KEY) {
      const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > slotsLib.MAX_CAP) {
        return res.status(400).json({ message: `${key} must be a whole number of orders from 0 to ${slotsLib.MAX_CAP} (0 = no limit).` });
      }
      const [, createdS] = await GlobalConfig.upsert({ key, value: n, description: description || 'Orders each delivery slot takes before it shows Full (0 = no limit)' });
      await slotsLib.loadConfig({ fresh: true });
      await logAuditAction(req, key, 'SLOT_MAX_ORDERS_SET', { value: n });
      broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value: n });
      realtime.publish('config', 'updated', key, { scope: 'global' });
      return res.json({ key, value: n, created: createdS });
    }
    // C6: rider cash limit (whole rupees, 0 = off) and the ledger start marker (never edited).
    const riderCash = require('../utils/riderCash');
    if (key === riderCash.START_KEY || key === 'C6_COMMISSION_BACKFILL') {
      return res.status(400).json({ message: `${key} is set by the server and cannot be edited.` });
    }
    if (key === riderCash.LIMIT_KEY) {
      const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > riderCash.MAX_LIMIT_RUPEES) {
        return res.status(400).json({ message: `${key} must be a whole number of rupees from 0 to ${riderCash.MAX_LIMIT_RUPEES} (0 turns the limit off).` });
      }
      const [, createdL] = await GlobalConfig.upsert({ key, value: n, description: description || 'Cash (₹) a rider may hold before they cannot take new COD orders (0 = no limit)' });
      await logAuditAction(req, key, 'RIDER_CASH_LIMIT_SET', { value: n });
      broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value: n });
      realtime.publish('config', 'updated', key, { scope: 'global' });
      return res.json({ key, value: n, created: createdL });
    }
    // Intro sound (owner, 31 Oct 2026): on / off only. The app reads it from GET /api/config/sections (introSound)
    // and applies it from its next start (the intro plays before the network answers).
    if (key === 'INTRO_SOUND_ENABLED') {
      const on = value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
      if (on === null) return res.status(400).json({ message: 'INTRO_SOUND_ENABLED must be true or false.' });
      const [, createdI] = await GlobalConfig.upsert({ key, value: on, description: description || 'Intro sound on app start (on / off)' });
      try { require('../utils/responseCache').invalidate('sections'); } catch { /* not loaded */ }
      await logAuditAction(req, key, 'INTRO_SOUND_SET', { value: on });
      broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value: on });
      realtime.publish('config', 'updated', key, { scope: 'global' });
      return res.json({ key, value: on, created: createdI });
    }
    const [_config, created] = await GlobalConfig.upsert({ key, value, description });
    broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key, value });
    realtime.publish('config', 'updated', key, { scope: 'global' });
    res.json({ key, value, description, created });
  } catch (error) {
    sendAdminError(res, error, 'Could not save the setting. Please try again.');
  }
};

// ─── Colleges (utils/campuses) ─────────────────────────────────
// GET /api/admin/campuses: each college with its status and how many active stores serve it (a store with no
// colleges set serves every college).
exports.getCampuses = async (req, res) => {
  try {
    const campuses = require('../utils/campuses');
    const list = await campuses.listCampuses();
    const stores = await getRestaurantModel().findAll({ where: { isActive: true }, attributes: ['id', 'visibleCampuses'] });
    const out = list.map((c) => ({ ...c, stores: stores.filter((st) => campuses.storeServes(st, c.key)).length }));
    res.json({ campuses: out, statuses: campuses.STATUSES });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// PUT /api/admin/campuses/:key { status: 'open' | 'paused' | 'soon' } (audited).
exports.setCampusStatus = async (req, res) => {
  try {
    const campuses = require('../utils/campuses');
    const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
    const r = await campuses.setStatus(req.params.key, status);
    if (r.error) return res.status(400).json({ message: r.error });
    const key = campuses.normalizeKey(req.params.key);
    await logAuditAction(req, key, 'CAMPUS_STATUS_SET', { status });
    broadcastSystemUpdate(req, 'GLOBAL_CONFIG_UPDATED', { key: campuses.KEY, value: r.statuses });
    realtime.publish('config', 'updated', campuses.KEY, { scope: 'global' });
    res.json({ campuses: await campuses.listCampuses() });
  } catch (error) {
    sendAdminError(res, error, 'Could not save the college setting. Please try again.');
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

// S0: GET /api/users/config is public (no auth). It used to return EVERY GlobalConfig row (Auto-Ride /
// Campus Events / rider-cash settings, legal settings, internal flags). Anonymous and non-admin callers
// now get only these public keys; a live admin (same route, cache bypassed) still gets every row.
// No shipped app reads this route today; the keys below are the feature switches the apps show / hide.
const PUBLIC_CONFIG_KEYS = new Set([
  'AFTER_DARK_ENABLED', 'CAMPUS_WHISPERS_ENABLED', 'AUTO_RIDE_ENABLED', 'CAMPUS_EVENTS_ENABLED', 'VEHICLE_RENTALS_ENABLED',
]);
exports.PUBLIC_CONFIG_KEYS = PUBLIC_CONFIG_KEYS;
exports.getPublicConfig = async (req, res) => {
  try {
    if (await require('../middleware/authMiddleware').isLiveAdminRequest(req)) return exports.getGlobalConfig(req, res);
    const GlobalConfig = getGlobalConfigModel();
    const configs = await GlobalConfig.findAll({ where: { key: { [Op.in]: [...PUBLIC_CONFIG_KEYS] } } });
    res.json(configs.map((c) => ({ id: c.id, _id: c.id, key: c.key, value: c.value })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// ─── Dashboard Stats ──────────────────────────────────────────
// The same platform-wide numbers for every admin: one computed copy is reused for 10 s (the dashboard asks
// on load, on its 60 s poll and after order / rider events, and each ask counted and summed the whole
// Orders table).
const STATS_TTL_MS = 10 * 1000;
let statsCache = null; // { at, body }
exports.getDashboardStats = async (req, res) => {
  if (statsCache && statsCache.body && Date.now() - statsCache.at < STATS_TTL_MS) return res.json(statsCache.body);
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
      // Same money as Finance: what the customer paid (finalPrice, else the item total) and each order's own
      // commission snapshot (the Overview used to show the item total and a flat 10 %).
      Order.findOne({
        where: { status: 'Delivered' },
        attributes: [[fn('SUM', fn('COALESCE', col('finalPrice'), col('totalPrice'))), 'revenue'], [fn('SUM', col('commissionAmountPaise')), 'commissionPaise']],
        raw: true
      }),
      Order.findOne({
        where: { status: { [Op.notIn]: ['Delivered', 'Cancelled'] } },
        attributes: [[fn('SUM', fn('COALESCE', col('finalPrice'), col('totalPrice'))), 'revenue'], [fn('COUNT', col('id')), 'count']],
        raw: true
      })
    ]);

    const totalRevenue = Number(deliveredStats?.revenue || 0);
    const activeRevenue = Number(activeStats?.revenue || 0);
    const activeOrdersCount = Number(activeStats?.count || 0);

    const inr = (n) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN')}`;
    const body = {
      revenue: inr(totalRevenue),
      activeRevenue: inr(activeRevenue),
      orderActivity: totalOrders.toString(),
      activeFleet: activeFleet.toString(),
      commission: inr(Number(deliveredStats?.commissionPaise || 0) / 100),
      activeOrders: activeOrdersCount.toString(),
      localVendorCount: localVendorCount.toString()
    };
    statsCache = { at: Date.now(), body };
    res.json(body);
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// C6: commission = the per-order snapshot taken when the order was placed (Order.commissionAmountPaise,
// item-subtotal base, the same number store payouts use). Orders settled before C6 have no snapshot: they
// fall back to the store's current rate on the item subtotal (marked commissionEstimated) — that is what
// their payout used at the time unless the rate changed since.
exports.getFinanceReport = async (req, res) => {
  try {
    const Order = getOrderModel();
    const Restaurant = getRestaurantModel();
    const { computeCommission } = require('../utils/commission');
    const { earningPaise } = require('../utils/riderEarnings');
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const pg = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (pg - 1) * lim;

    const allDelivered = await Order.findAll({
      where: { status: 'Delivered' },
      attributes: ['totalPrice', 'finalPrice', 'restaurantId', 'deliveryFee', 'fulfilment', 'deliveryPartnerId', 'commissionAmountPaise'],
      raw: true,
    });
    const restaurants = await Restaurant.findAll({ attributes: ['id', 'name', 'commissionRate', 'commissionType'], raw: true });
    const restaurantMap = restaurants.reduce((acc, r) => ({ ...acc, [r.id]: r }), {});

    const orderAmount = (o) => Number(o.finalPrice ?? o.totalPrice) || 0;
    const commissionPaiseFor = (o) => {
      if (o.commissionAmountPaise !== null && o.commissionAmountPaise !== undefined) return { paise: Number(o.commissionAmountPaise) || 0, estimated: false };
      const rest = restaurantMap[o.restaurantId];
      if (!rest) return { paise: 0, estimated: true };
      return { paise: computeCommission({ subtotal: o.totalPrice, rate: rest.commissionRate, type: rest.commissionType }).commissionAmountPaise, estimated: true };
    };

    let commissionPaise = 0;
    let estimatedCount = 0;
    let riderEarningsPaise = 0;
    for (const o of allDelivered) {
      const c = commissionPaiseFor(o);
      commissionPaise += c.paise;
      if (c.estimated) estimatedCount++;
      if (o.deliveryPartnerId) riderEarningsPaise += earningPaise(o);
    }
    const totalRevenue = allDelivered.reduce((s, o) => s + orderAmount(o), 0);
    const totalDeliveryFees = allDelivered.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);

    const { count, rows: orders } = await Order.findAndCountAll({
      where: { status: 'Delivered' },
      attributes: ['id', 'restaurantId', 'totalPrice', 'finalPrice', 'deliveryFee', 'createdAt', 'commissionAmountPaise', 'commissionRate', 'commissionType'],
      order: [['createdAt', 'DESC']],
      limit: lim,
      offset,
    });

    const transactions = orders.map(order => {
      const restaurant = restaurantMap[order.restaurantId];
      const c = commissionPaiseFor(order);
      return {
        _id: order.id,
        orderId: order.id.slice(-6),
        restaurantName: restaurant ? restaurant.name : 'Unknown store',
        totalAmount: orderAmount(order),
        commissionEarned: Math.round(c.paise / 100),
        commissionPaise: c.paise,
        commissionRate: order.commissionRate ?? null,
        commissionType: order.commissionType ?? null,
        commissionEstimated: c.estimated,
        deliveryFee: Number(order.deliveryFee) || 0,
        timestamp: order.createdAt
      };
    });

    res.json({
      transactions,
      totalRevenue: Math.round(totalRevenue),
      totalCommission: Math.round(commissionPaise / 100),
      totalCommissionPaise: commissionPaise,
      commissionEstimatedOrders: estimatedCount,
      totalDeliveryFees: Math.round(totalDeliveryFees),
      totalRiderEarnings: Math.round(riderEarningsPaise / 100),
      total: count,
      pages: Math.ceil(count / lim)
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
      await item.update(await mediaizeImageFields(await assertVaultTargets(pickVaultFields(req.body, item), item), req, ['imageUrl'], 'vault', item));
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
          const { cancelled, refunded } = await cancelAndRefund(order, { reason: 'Cancelled by ZenWe support', onlyFromStatuses: [targetStatus], by: 'support' });
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
            if (order.deliveryPartnerId) {
              const rd = require('../utils/riderDispatch');
              rd.pushAssignedRider(order.deliveryPartnerId, 'Order cancelled', `Order #${rd.shortRef(order.id)} was cancelled by ZenWe support. Do not pick it up.`, { orderId: order.id, type: 'ORDER_CANCELLED' });
            }
          }
          realtime.notifyAdmin('order', 'updated', order.id);
          const oc = require('./orderController');
          if (order.restaurantId) oc.pushStoreCancelled(order.restaurantId, order, 'An order was cancelled by ZenWe support.');
          oc.pushCustomer(order, 'Order cancelled', refunded > 0
            ? `ZenWe support cancelled your order. ₹${refunded} is back in your Wallet.`
            : 'ZenWe support cancelled your order. You have not been charged.');
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
    sendAdminError(res, error, 'Could not create the coupon. Please try again.');
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
// (C6: the period filters live in utils/payouts.)

// C6: the unsettled store list comes from the per-order commission snapshot (never the store's current
// rate) and leaves out orders already on a payout statement. Same row shape as before, plus partnerType,
// adjustments (cash a stall collected itself) and paise fields.
exports.getRestaurantPayouts = async (req, res) => {
  try {
    const payouts = require('../utils/payouts');
    const asOf = new Date();
    const rows = await payouts.pendingPartners({ sequelize: getOrderModel().sequelize, partnerType: 'store', to: asOf });
    res.set('Cache-Control', 'no-store');
    res.json(rows.map((p) => ({
      restaurantId: p.partnerId,
      restaurantName: p.partnerName,
      vendorType: p.vendorType,
      partnerType: p.partnerType,
      totalOrders: p.orders,
      totalGMV: Math.round(p.grossPaise / 100),
      totalCommission: Math.round(p.commissionPaise / 100),
      adjustments: Math.round(p.adjustmentsPaise / 100),
      netPayout: Math.round(p.netPaise / 100),
      grossPaise: p.grossPaise,
      commissionPaise: p.commissionPaise,
      adjustmentsPaise: p.adjustmentsPaise,
      netPaise: p.netPaise,
      oldestDeliveredAt: p.oldestDeliveredAt,
      asOf: asOf.toISOString(),
    })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

const payoutErrorReply = (res, error) => {
  const payouts = require('../utils/payouts');
  if (payouts.isPayoutError(error)) {
    const { status, code, message, name, stack, ...extra } = error; // eslint-disable-line no-unused-vars
    return res.status(status).json({ code, message: error.message, ...extra });
  }
  return null;
};
exports.payoutErrorReply = payoutErrorReply;

// C6: "settle" is no longer a bare flag flip. It saves a Payout record (amounts from the commission
// snapshot, the UTR, who / when) and sets payoutSettled on exactly those orders, in one transaction.
// UTR is required (400 UTR_REQUIRED). The Finance page uses the statement flow (/api/admin/payouts).
exports.settleRestaurantPayout = async (req, res) => {
  try {
    const payouts = require('../utils/payouts');
    const { restaurantId } = req.body || {};
    if (!restaurantId || !UUID_RE.test(String(restaurantId))) return res.status(400).json({ message: 'restaurantId is required' });
    const upToRaw = req.body.upTo || req.body.asOf;
    const upTo = upToRaw ? new Date(String(upToRaw)) : new Date();
    if (upToRaw && Number.isNaN(upTo.getTime())) return res.status(400).json({ message: 'upTo must be a date.', code: 'INVALID_INPUT' });
    const utr = String(req.body.utr || req.body.reference || '').trim();
    if (utr.length < 3) return res.status(400).json({ code: 'UTR_REQUIRED', message: 'Enter the UTR / payment reference of the transfer to record this payout.' });
    const sequelize = getOrderModel().sequelize;
    const store = await getRestaurantModel().findByPk(restaurantId, { attributes: ['id', 'name', 'vendorType'], raw: true });
    if (!store) return res.status(404).json({ message: 'Store not found.' });
    const adminId = req.user?.id ? String(req.user.id) : null;
    const result = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
      const payout = await payouts.createStatement({
        sequelize, partnerType: payouts.storeKind(store), partnerId: restaurantId, to: upTo,
        expectedOrders: req.body.expectedOrders, adminId, notes: req.body.notes, transaction: t,
      });
      const paid = await payouts.markPaid({ sequelize, payoutId: payout.id, utr, method: req.body.method || 'bank', adminId, transaction: t });
      return { payout: paid.payout, settled: paid.settledOrders };
    });
    await logAuditAction(req, restaurantId, 'RESTAURANT_PAYOUT_SETTLED', { restaurantId, payoutId: result.payout.id, updatedOrdersCount: result.settled, netPaise: result.payout.netPaise, utr, upTo: upTo.toISOString() });
    res.json({ message: 'Restaurant payout recorded and marked paid', updatedOrdersCount: result.settled, payoutId: result.payout.id, payout: payouts.payoutJson(result.payout) });
  } catch (error) {
    if (payoutErrorReply(res, error)) return;
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
      // C5: credit + ORDER_REFUND ledger row (actor = this admin) in the same transaction.
      await walletLedger.applyWalletChange({
        t, ownerType: 'user', ownerId: user.id, amountPaise: walletLedger.toPaise(refundAmount), type: walletLedger.TYPES.ORDER_REFUND,
        ref: { type: 'ORDER', id: order.id }, actor: { type: 'admin', id: req.user?.id ? String(req.user.id) : 'admin_default' },
        reason: 'Manual refund of a cancelled order', idempotencyKey: `manual-refund:${order.id}`,
      });
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

// Who a broadcast reaches: active users (optionally one hostel block) and their unique device tokens.
// Shared by the send and the admin "recipients" preview so the two numbers always agree.
const broadcastAudience = async (targetBlock) => {
  const { getUserModel } = require('../models/User');
  const User = getUserModel();
  const whereClause = { isActive: true };
  const isTargeted = !!(targetBlock && targetBlock !== 'All Campus Blocks');
  if (isTargeted) whereClause.hostelBlock = targetBlock;
  const activeUsers = await User.findAll({ where: whereClause, attributes: ['id', 'fcmTokens'] });
  let allTokens = [];
  activeUsers.forEach(user => {
    let tokenList = user.fcmTokens;
    if (!tokenList) return;
    if (typeof tokenList === 'string') {
      try { tokenList = JSON.parse(tokenList); } catch { tokenList = [tokenList]; }
    }
    if (Array.isArray(tokenList)) {
      tokenList.forEach(t => {
        const tokenStr = typeof t === 'string' ? t : t?.token;
        if (tokenStr) allTokens.push(tokenStr);
      });
    }
  });
  allTokens = [...new Set(allTokens.filter(Boolean))];
  return { isTargeted, activeUsers, allTokens };
};

// @route GET /api/admin/broadcast-push/preview?targetBlock= -> { students, devices, campusWide } (nothing is sent)
exports.previewBroadcastAudience = async (req, res) => {
  try {
    const targetBlock = typeof req.query.targetBlock === 'string' ? req.query.targetBlock.trim().slice(0, 100) : '';
    const { isTargeted, activeUsers, allTokens } = await broadcastAudience(targetBlock);
    res.json({ students: activeUsers.length, devices: allTokens.length, campusWide: !isTargeted, targetBlock: isTargeted ? targetBlock : null });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// @route GET /api/admin/broadcast-push/history?limit= -> recent broadcasts (from the audit log, newest first)
exports.getBroadcastHistory = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = await getVerificationLogModel().findAll({ where: { action: 'GLOBAL_PUSH_SENT' }, order: [['timestamp', 'DESC']], limit });
    const { getUserModel } = require('../models/User');
    const adminIds = [...new Set(rows.map((r) => r.adminId).filter((id) => UUID_RE.test(String(id))))];
    const admins = adminIds.length ? await getUserModel().findAll({ where: { id: adminIds }, attributes: ['id', 'name'] }) : [];
    const nameOf = Object.fromEntries(admins.map((a) => [a.id, a.name]));
    res.json({
      broadcasts: rows.map((r) => {
        let d = {};
        try { d = JSON.parse(r.details || '{}') || {}; } catch { d = {}; }
        return {
          id: r.id,
          sentAt: r.timestamp,
          sentBy: nameOf[r.adminId] || null,
          title: typeof d.title === 'string' ? d.title : '',
          body: typeof d.body === 'string' ? d.body : '',
          targetBlock: typeof d.targetBlock === 'string' && d.targetBlock ? d.targetBlock : null,
          category: typeof d.category === 'string' ? d.category : null,
          students: typeof d.userCount === 'number' ? d.userCount : null,
          devices: typeof d.devices === 'number' ? d.devices : null,
        };
      }),
    });
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

exports.broadcastPushNotification = async (req, res) => {
  try {
    const { title, body, targetBlock, category } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'Title and body required' });
    
    const { isTargeted, activeUsers, allTokens } = await broadcastAudience(targetBlock);
    if (isTargeted && !activeUsers.length) {
      return res.status(404).json({ code: 'NO_RECIPIENTS', message: `No active students have "${String(targetBlock).slice(0, 60)}" as their hostel block, so nothing was sent. Check the spelling (it must match the profile exactly).` });
    }

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

    await logAuditAction(req, null, 'GLOBAL_PUSH_SENT', { title, body, userCount: activeUsers.length, devices: allTokens.length, targetBlock: isTargeted ? targetBlock : null, category: category || 'announcement' });
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

// C6: rider earnings use the one rule (utils/riderEarnings: delivery fee, ₹30 when it is 0) instead of the
// raw SUM(deliveryFee), leave out orders already on a statement, and show the cash each rider holds next to
// what Zenvy owes them (never netted: cash is settled by deposits). Same row shape as before.
exports.getRiderPayouts = async (req, res) => {
  try {
    const payouts = require('../utils/payouts');
    const asOf = new Date();
    const rows = await payouts.pendingPartners({ sequelize: getOrderModel().sequelize, partnerType: 'rider', to: asOf });
    res.set('Cache-Control', 'no-store');
    res.json(rows.filter((p) => p.orders > 0 || p.tipsPaise > 0).map((p) => ({
      riderId: p.partnerId,
      riderName: p.partnerName || 'Unknown Rider',
      riderPhone: p.phone || '',
      totalDeliveries: p.orders,
      totalDeliveryFees: Math.round(p.grossPaise / 100), // rider earnings (C6 rule)
      earningsPaise: p.grossPaise,
      unsettledTips: Math.round(p.tipsPaise / 100),
      tipsPaise: p.tipsPaise,
      totalPayout: Math.round(p.netPaise / 100),
      netPaise: p.netPaise,
      cashHeldPaise: p.cashHeldPaise,
      cashHeld: p.cashHeldPaise / 100,
      netPositionPaise: p.netPositionPaise,
      asOf: asOf.toISOString(), // send back as `upTo` when settling
    })));
  } catch (error) {
    sendServerError(res, error, '[ADMINCONTROLLER_ERROR]');
  }
};

// C6: records a rider Payout (earnings of exactly these orders + the tips the admin saw, UTR required) and
// sets riderPayoutSettled / takes the tips out of the wallet (TIP_PAYOUT) in ONE transaction.
exports.settleRiderPayout = async (req, res) => {
  try {
    const payouts = require('../utils/payouts');
    const { riderId } = req.body || {};
    if (!riderId || !UUID_RE.test(String(riderId))) return res.status(400).json({ message: 'riderId is required' });
    const utr = String(req.body.utr || req.body.reference || '').trim();
    if (utr.length < 3) return res.status(400).json({ code: 'UTR_REQUIRED', message: 'Enter the UTR / payment reference of the transfer to record this payout.' });
    const ids = Array.isArray(req.body.orderIds) ? req.body.orderIds.map(String).filter((x) => UUID_RE.test(x)).slice(0, 5000) : null;
    const upToRaw = req.body.upTo || req.body.asOf;
    const upTo = upToRaw ? new Date(String(upToRaw)) : new Date();
    if (Number.isNaN(upTo.getTime())) return res.status(400).json({ message: 'upTo must be a date.', code: 'INVALID_INPUT' });
    // Tips only when the admin says they were paid too, and at most the amount they saw.
    const tipsSeen = Number(req.body.tipsAmount);
    const includeTips = req.body.includeTips === true && Number.isFinite(tipsSeen) && tipsSeen > 0;
    const sequelize = getOrderModel().sequelize;
    const adminId = req.user?.id ? String(req.user.id) : null;
    const result = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
      const payout = await payouts.createStatement({
        sequelize, partnerType: 'rider', partnerId: riderId, to: upTo, orderIds: ids && ids.length ? ids : null,
        includeTips, tipsPaise: includeTips ? walletLedger.toPaise(tipsSeen) : 0, adminId, notes: req.body.notes, transaction: t,
      });
      const paid = await payouts.markPaid({ sequelize, payoutId: payout.id, utr, method: req.body.method || 'bank', adminId, transaction: t });
      return { payout: paid.payout, settled: paid.settledOrders };
    });
    const tipsSettled = result.payout.tipsPaise / 100;
    await logAuditAction(req, riderId, 'RIDER_PAYOUT_SETTLED', { riderId, payoutId: result.payout.id, updatedOrdersCount: result.settled, tipsSettled, netPaise: result.payout.netPaise, utr, upTo: upTo.toISOString(), orderIds: ids ? ids.length : 0 });
    res.json({ message: 'Rider payout recorded and marked paid', updatedOrdersCount: result.settled, tipsSettled, payoutId: result.payout.id, payout: payouts.payoutJson(result.payout) });
  } catch (error) {
    if (payoutErrorReply(res, error)) return;
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
    const store = UUID_RE.test(restaurantId) ? await Restaurant.findByPk(restaurantId, { attributes: ['id', 'vendorType'] }) : null;
    if (!store) {
      return res.status(400).json({ message: 'Pick the store these products belong to.' });
    }
    const allowFree = isServiceVendorType(store.vendorType);
    if (!items.length) return res.status(400).json({ message: 'Add at least one product.' });
    if (items.length > BULK_MAX) return res.status(400).json({ message: `You can add up to ${BULK_MAX} products at a time.` });
    const rows = [];
    const errors = [];
    items.forEach((raw, index) => {
      try {
        rows.push({ ...pickMenuItemFields(raw || {}, null, { allowFree }), restaurantId });
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
    // Service stores' products may be ₹0 (priced after a quote); see pickMenuItemFields.
    const serviceStoreIds = new Set();
    if (patchIn.price !== undefined && items.length) {
      const stores = await getRestaurantModel().findAll({ where: { id: { [Op.in]: [...new Set(items.map((i) => i.restaurantId))] } }, attributes: ['id', 'vendorType'] });
      for (const st of stores) if (isServiceVendorType(st.vendorType)) serviceStoreIds.add(st.id);
    }
    await getSequelize().transaction(async (t) => {
      for (const item of items) {
        // Same validation as a single edit (name/price only when sent; specs merged per item).
        const patch = pickMenuItemFields(patchIn, item, { allowFree: serviceStoreIds.has(item.restaurantId) });
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
    // C8: a copy is not the same legal seller: licence, tax ids and payout details are never copied.
    for (const k of [...require('../utils/storeCompliance').STORED_FIELDS, 'fssaiSubmittedAt', 'fssaiVerifiedAt', 'fssaiVerifiedBy']) delete src[k];
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
  // More review queues for the admin overview's "Needs attention" list (added keys only; older admin
  // builds ignore them). Module models are looked up on the shared Sequelize instance; a module that is
  // not loaded (or a table that is missing) gives null, which the admin shows as "–".
  const model = (name) => () => {
    const { getSequelize } = require('../config/db');
    const s = getSequelize();
    return (s && s.models && s.models[name]) || null;
  };
  const stallStuck = require('../utils/stallStuckJob');
  // Both groups of counts run together (they used to be two batches one after the other: one extra
  // database round trip, ~180 ms, on every dashboard refresh).
  const firstGroup = Promise.all([
    safeCount(() => require('../models/Ticket').getTicketModel(), { status: { [Op.in]: ['Open', 'In Progress'] } }),
    safeCount(() => require('../modules/campus/models/Verification').getVerificationModel(), { status: 'pending', type: 'id_card' }),
    safeCount(() => require('../models/PGBooking').getPGBookingModel(), { status: 'Pending' }),
    safeCount(() => require('../models/WallSubmission').getWallSubmissionModel(), { isApproved: false }),
    safeCount(() => require('../models/ServiceBooking').getServiceBookingModel(), { status: 'REQUESTED' }),
    safeCount(() => require('../models/Order').getOrderModel(), stallStuck.stuckStallWhere(stallStuck.STUCK_HOURS)),
  ]);
  const secondGroup = Promise.all([
    // New rider sign-ups waiting for approval (deactivated riders have suspendedAt set and are not counted).
    safeCount(() => require('../models/DeliveryPartner').getDeliveryPartnerModel(), { isApproved: false, suspendedAt: null }),
    safeCount(() => require('../models/Payout').getPayoutModel(), { status: 'PENDING' }),
    safeCount(model('AutoDriver'), { status: 'PENDING_REVIEW' }),
    safeCount(model('AutoVehicle'), { status: 'PENDING_REVIEW' }),
    safeCount(model('CeEvent'), { status: 'SUBMITTED' }),
    safeCount(model('RentalListing'), { status: 'PENDING_REVIEW' }),
    safeCount(model('RentalLicence'), { status: 'PENDING' }),
    safeCount(model('RentalReport'), { status: 'OPEN' }),
    safeCount(model('RentalBooking'), { chargesStatus: 'DISPUTED' }),
    safeCount(model('FriendsReport'), { status: 'open' }),
    safeCount(model('FriendsAppeal'), { status: 'open' }),
  ]);
  const [
    [tickets, verifications, pgBookings, wallPending, serviceRequests, stuckStallOrders],
    [riderApprovals, payoutsPending, autoDrivers, autoVehicles, eventsToReview, rentalListings, rentalLicences, rentalReports, rentalDisputes, friendsReports, friendsAppeals],
  ] = await Promise.all([firstGroup, secondGroup]);
  res.set('Cache-Control', 'no-store');
  res.json({
    tickets, verifications, pgBookings, wallPending, serviceRequests, stuckStallOrders, stuckStallHours: stallStuck.STUCK_HOURS,
    riderApprovals, payoutsPending, autoDrivers, autoVehicles, eventsToReview, rentalListings, rentalLicences, rentalReports, rentalDisputes, friendsReports, friendsAppeals,
  });
};

// ─── Assign / unassign a rider (support intervention) ───────────────────────────────
// PUT /api/admin/orders/:id/rider { riderId: '<uuid>' | null }
// Before pickup only (Accepted / Preparing / ReadyForPickup / Picking): the food is still at the store.
// A rider-set 'Picking' step is undone (back to ReadyForPickup if the kitchen marked it ready, else
// Preparing), exactly like a rider release. Stall (VENDOR) orders never have a rider. The write is
// conditional on the rider + status read here, so a claim / pickup / cancel that lands meanwhile wins (409).
const ADMIN_ASSIGNABLE = ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking'];

/**
 * Take the rider off an order that is still at the store and put it back in the rider pool: the same
 * write, sockets and pushes as an admin "Remove rider" (PUT /api/admin/orders/:id/rider { riderId: null }).
 * Also used by the rider pickup-timeout job (orderController.releaseStalledRiderClaims).
 * Conditional on the rider + status read in `order` (+ opts.extraWhere): resolves false when a pickup /
 * cancel / other change landed first (nothing done), true when the rider was removed.
 * opts: { io, reason, extraWhere }
 */
const releaseOrderRider = async (order, { io = null, reason = 'Removed by ZenWe support', extraWhere = null } = {}) => {
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
  if (oldRiderId) {
    const rd = require('../utils/riderDispatch');
    rd.pushAssignedRider(oldRiderId, 'Order given to another rider', `ZenWe support gave order #${rd.shortRef(order.id)} to another rider. You do not need to pick it up.`, { orderId: order.id, type: 'ORDER_REASSIGNED' });
  }
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
      // Same limits as a rider's own claim (utils/riderLoad, utils/riderCash): orders, shopping lists and service
      // pickups together, and the COD cash limit. Counting orders alone let support give a rider 4 jobs.
      const { activeJobs, MAX_ACTIVE_JOBS } = require('../utils/riderLoad');
      const load = await activeJobs(rider.id);
      if (load.total >= MAX_ACTIVE_JOBS) {
        const parts = [load.orders && `${load.orders} order${load.orders === 1 ? '' : 's'}`, load.baskets && `${load.baskets} shopping list${load.baskets === 1 ? '' : 's'}`, load.services && `${load.services} pickup${load.services === 1 ? '' : 's'}`].filter(Boolean).join(', ');
        return res.status(409).json({ message: `${rider.name || 'This rider'} already has ${parts || `${load.total} jobs`} (${MAX_ACTIVE_JOBS} at a time).`, code: 'MAX_ACTIVE' });
      }
      const cash = await require('../utils/riderCash').claimBlockedByCash({ sequelize: Order.sequelize, riderId: rider.id, orderId: order.id });
      if (cash) {
        return res.status(409).json({ message: `${rider.name || 'This rider'} holds ₹${cash.cash.cashHeld} in cash (limit ₹${cash.cash.limit}), so COD orders are paused until they deposit.`, code: 'CASH_LIMIT' });
      }
      // Off duty: they get no new-order alerts and may not be on the road. Support confirms first (allowOffline).
      if (rider.isOnline === false && !(req.body && req.body.allowOffline === true)) {
        return res.status(409).json({ message: `${rider.name || 'This rider'} is off duty right now. Assign anyway?`, code: 'RIDER_OFFLINE' });
      }
    }
    if (!newRiderId) {
      // Remove the rider: shared with the pickup-timeout job (same write, sockets and pushes).
      const released = await releaseOrderRider(order, { io: req.app.get('io'), reason: 'Removed by ZenWe support' });
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
      if (oldRiderId) {
        const rd = require('../utils/riderDispatch');
        rd.pushAssignedRider(oldRiderId, 'Order given to another rider', `ZenWe support took order #${rd.shortRef(order.id)} off you. You do not need to pick it up.`, { orderId: order.id, type: 'ORDER_REASSIGNED' });
      }
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
      // The new rider is not in the order room yet: tell their own room, so the app refetches its active
      // orders now instead of on the next poll (or never, with no working push token).
      if (newRiderId) io.to(`rider_${newRiderId}`).emit('statusUpdated', payload);
      if (!newRiderId) io.to('admin-room').emit('order_unassigned', { orderId: order.id, reason: 'Removed by ZenWe support' });
    }
    realtime.notifyAdmin('order', 'updated', order.id);
    const restaurant = order.restaurantId ? await getRestaurantModel().findByPk(order.restaurantId, { attributes: ['id', 'name', 'location'] }) : null;
    try {
      if (newRiderId) {
        const tokens = (Array.isArray(rider.fcmTokens) ? rider.fcmTokens : []).map((t) => (typeof t === 'string' ? t : t && t.token)).filter(Boolean);
        if (tokens.length) {
          await require('../utils/push').sendPushToTokens(tokens, '🛵 Order assigned to you', `ZenWe support gave you an order from ${restaurant?.name || 'a store'}.`, { orderId: String(order.id), type: 'ORDER_ASSIGNED' }, {
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
