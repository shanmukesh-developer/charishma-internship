// Read API for stores (non-food vendors) and their products. Everything comes from the DB,
// so the ids returned here are the ids to send in POST /api/orders (and /api/orders/quote).
const { Op } = require('sequelize');
const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getStoreOpenState, withCampusWindow } = require('../utils/storeHours');
const { STORE_VENDOR_TYPES, resolveVendorTypes, isLocalVendorStore, isServiceVendorType } = require('../utils/vendorTypes');
const { sortMenuItems } = require('../utils/menuSort');

const MAX_LIMIT = 200;
// Columns never part of a public store / product (secrets and push tokens): not selected at all.
const STORE_EXCLUDE = ['password', 'fcmTokens', 'tokenVersion', 'commissionRate', 'commissionType', 'phone', ...require('../utils/publicFields').STORE_PRIVATE_FIELDS];
const ITEM_EXCLUDE = ['customCommission', 'ownerName', 'ownerPhone'];

const likeOp = (model) => (model.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like);
// Wildcards are dropped (LIKE escape syntax differs between Postgres and SQLite).
const escapeLike = (s) => String(s).replace(/[\\%_]/g, ' ');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readSpecs = (item) => {
  let specs = item.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  return specs && typeof specs === 'object' ? specs : {};
};

const shapeStore = (store, itemCount) => {
  const s = store.toJSON ? store.toJSON() : store;
  // Shops show closed during the campus night window too (services are booked, not ordered: unchanged).
  const open = isServiceVendorType(s.vendorType) ? getStoreOpenState(store) : withCampusWindow(getStoreOpenState(store));
  return {
    id: s.id,
    _id: s.id,
    name: s.name,
    vendorType: s.vendorType,
    description: s.stallDescription || null,
    imageUrl: s.imageUrl || null,
    location: s.location,
    campus: s.campus || null,
    tags: Array.isArray(s.tags) ? s.tags : [],
    rating: s.rating > 0 ? s.rating : null,
    deliveryTime: s.deliveryTime || null,
    operatingHours: s.operatingHours || null,
    isOpen: open.isOpen,
    opensAt: open.opensAt || null,
    closedReason: open.isOpen ? null : (open.message || null),
    campusClosed: !!open.campusClosed,
    // Delivery slots: closed now but orderable for the next slot (new keys; services are booked, not slotted).
    ...require('../utils/deliverySlots').slotListingFields(store, { skip: isServiceVendorType(s.vendorType) }),
    logoUrl: s.logoUrl || null,
    packagingFee: Number(s.packagingFee) || 0,
    minOrderValue: Number(s.minOrderValue) || 0,
    // C8: FSSAI licence number shown on the store page (null = "FSSAI licence not provided").
    fssaiLicenseNumber: s.fssaiLicenseNumber || null,
    ...(itemCount !== undefined ? { itemCount } : {})
  };
};

const shapeItem = (item, store) => {
  const i = item.toJSON ? item.toJSON() : item;
  const specs = readSpecs(i);
  const now = new Date();
  const inStock = !!i.isAvailable || !!(i.outOfStockUntil && new Date(i.outOfStockUntil) <= now);
  const po = require('../utils/productOptions');
  const groups = po.effectiveOptions(i, store && store.vendorType);
  const fromWeights = po.listingFromOptions(groups);
  const price = fromWeights ? fromWeights.price : Number(i.price);
  const mrp = fromWeights ? fromWeights.originalPrice : (Number(i.originalPrice) || Number(specs.originalPrice));
  const originalPrice = mrp > price ? mrp : null;
  // Service stores (laundry, print, repairs, tailoring) are booked, never ordered, flag or not.
  const bookingOnly = !!specs.bookingOnly || (!!store && isServiceVendorType(store.vendorType));
  const stall = isLocalVendorStore(store);
  let tags = i.tags || [];
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
  const open = store ? getStoreOpenState(store) : { isOpen: false };
  return {
    id: i.id,
    _id: i.id,
    menuItemId: i.id,
    name: i.name,
    description: i.description || null,
    price,
    originalPrice,
    discountPercent: originalPrice ? Math.round((1 - price / originalPrice) * 100) : null,
    weight: fromWeights ? fromWeights.weight : po.packLabel(specs.weight),
    brand: specs.brand || null,
    // Admin-set choices (weights with their own prices, flavours, types) and ordered product details:
    // docs/PRODUCT_OPTIONS.md (admin-set, else automatic 250 g / 500 g / 1 kg for weight-sold grocery / bakery
    // products). Present only when set.
    ...(groups.length ? { options: groups } : {}),
    ...(Array.isArray(specs.details) && specs.details.length ? { details: specs.details } : {}),
    emoji: specs.emoji || null,
    category: i.category || null,
    tags,
    imageUrl: i.imageUrl || null,
    image: i.imageUrl || null,
    isVegetarian: i.isVegetarian !== false,
    dietType: i.dietType || (i.isVegetarian === false ? 'nonveg' : 'veg'),
    isAvailable: inStock,
    outOfStockUntil: inStock ? null : (i.outOfStockUntil || null),
    rating: specs.rating || null,
    ratingCount: specs.ratingCount || 0,
    bookingOnly,
    extraFor: Array.isArray(specs.extraFor) ? specs.extraFor : undefined,
    restaurantId: i.restaurantId,
    storeId: i.restaurantId,
    storeName: store ? store.name : null,
    vendorType: store ? store.vendorType : null,
    // CampusBites stalls are ordered in Zenvy (cash to the stall, the stall delivers).
    orderable: inStock && !bookingOnly && !!store && store.isActive !== false && !(stall && store.isOffline)
      // Delivery slots: a store closed right now still takes orders for its next open slot.
      && (open.isOpen || require('../utils/deliverySlots').slotListingFields(store).takesSlotOrders),
    directOrderOnly: false,
    ...(stall ? { fulfilment: 'VENDOR', paymentMethods: ['COD'] } : {})
  };
};

// ?college=srmap: only the stores that serve the student's college (utils/campuses; none set = every college).
const forCollege = (req, stores) => {
  const campuses = require('../utils/campuses');
  const college = campuses.normalizeKey(req.query && req.query.college);
  return college ? stores.filter((s) => campuses.storeServes(s, college)) : stores;
};

const storeWhere = async (types) => {
  const where = { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()) };
  where.vendorType = types ? { [Op.in]: types } : { [Op.in]: STORE_VENDOR_TYPES };
  return where;
};

// @desc    Store types that currently have at least one active store
// @route   GET /api/catalogue/types
const getTypes = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const stores = forCollege(req, await Restaurant.findAll({ where: await storeWhere(null), attributes: ['vendorType', 'visibleCampuses'] }));
    const counts = {};
    for (const s of stores) counts[s.vendorType] = (counts[s.vendorType] || 0) + 1;
    res.json(Object.entries(counts).map(([vendorType, storeCount]) => ({ vendorType, storeCount })));
  } catch (error) {
    console.error('[CATALOGUE_TYPES_ERROR]', error);
    res.status(500).json({ message: 'Could not load stores right now. Please try again.' });
  }
};

// @desc    Active stores, optionally of one type
// @route   GET /api/catalogue/stores?type=grocery
const getStores = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const types = resolveVendorTypes(req.query.type);
    const where = types ? { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), vendorType: { [Op.in]: types } } : await storeWhere(null);
    if (req.query.campus) where.campus = String(req.query.campus);
    const stores = forCollege(req, await Restaurant.findAll({ where, order: [['name', 'ASC']], attributes: { exclude: STORE_EXCLUDE } }));
    const ids = stores.map(s => s.id);
    const counts = {};
    if (ids.length) {
      const rows = await MenuItem.findAll({
        where: { restaurantId: { [Op.in]: ids } },
        attributes: ['restaurantId', [MenuItem.sequelize.fn('COUNT', MenuItem.sequelize.col('id')), 'n']],
        group: ['restaurantId'],
        raw: true
      });
      for (const r of rows) counts[r.restaurantId] = Number(r.n) || 0;
    }
    res.set('Cache-Control', 'no-cache');
    res.json(stores.map(s => shapeStore(s, counts[s.id] || 0)));
  } catch (error) {
    console.error('[CATALOGUE_STORES_ERROR]', error);
    res.status(500).json({ message: 'Could not load stores right now. Please try again.' });
  }
};

// @desc    Products of active stores
// @route   GET /api/catalogue/items?type=grocery&storeId=&category=&q=&for=cake&includeUnavailable=true&limit=&offset=
const getItems = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const types = resolveVendorTypes(req.query.type);

    const storeFilter = { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()) };
    if (types) storeFilter.vendorType = { [Op.in]: types };
    else if (!req.query.storeId) storeFilter.vendorType = { [Op.in]: STORE_VENDOR_TYPES };
    if (req.query.storeId) {
      if (!UUID_RE.test(String(req.query.storeId))) return res.json({ items: [], total: 0, stores: [] });
      storeFilter.id = String(req.query.storeId);
    }
    const stores = forCollege(req, await Restaurant.findAll({ where: storeFilter, attributes: { exclude: STORE_EXCLUDE } }));
    if (!stores.length) return res.json({ items: [], total: 0, stores: [] });
    const storeMap = new Map(stores.map(s => [s.id, s]));

    const where = { restaurantId: { [Op.in]: [...storeMap.keys()] } };
    if (String(req.query.includeUnavailable || '').toLowerCase() !== 'true') {
      where[Op.or] = [{ isAvailable: true }, { outOfStockUntil: { [Op.lte]: new Date() } }];
    }
    if (req.query.category) where.category = String(req.query.category);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (q) {
      const op = likeOp(MenuItem);
      const pattern = `%${escapeLike(q)}%`;
      where[Op.and] = [{ [Op.or]: [{ name: { [op]: pattern } }, { description: { [op]: pattern } }, { category: { [op]: pattern } }] }];
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || MAX_LIMIT));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { count, rows } = await MenuItem.findAndCountAll({ where, attributes: { exclude: ITEM_EXCLUDE }, order: [['category', 'ASC'], ['name', 'ASC']], limit, offset });

    // One store's shelf follows the admin's menu order (specs.sortOrder).
    let items = (req.query.storeId ? sortMenuItems(rows) : rows).map(r => shapeItem(r, storeMap.get(r.restaurantId)));
    // Add-ons for a dish type, e.g. ?type=extras&for=cake
    const forType = typeof req.query.for === 'string' ? req.query.for.trim().toLowerCase() : '';
    if (forType) items = items.filter(i => Array.isArray(i.extraFor) && i.extraFor.includes(forType));

    res.set('Cache-Control', 'no-cache');
    res.json({
      items,
      total: forType ? items.length : count,
      limit,
      offset,
      categories: [...new Set(items.map(i => i.category).filter(Boolean))],
      stores: stores.map(s => shapeStore(s))
    });
  } catch (error) {
    console.error('[CATALOGUE_ITEMS_ERROR]', error);
    res.status(500).json({ message: 'Could not load products right now. Please try again.' });
  }
};

// @desc    Lowest in-stock price per store type ("From ₹X" on the app's service cards), one small call
//          instead of a full item list per type.
// @route   GET /api/catalogue/min-prices?types=repairs,tailoring,print,laundry,home
// Public, read-only: the same prices /items already shows. Response: { repairs: 49, print: 2, ... }
// (a type with no active store or no priced, in-stock item is left out).
const MAX_MIN_PRICE_TYPES = 12;
const getMinPrices = async (req, res) => {
  try {
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const requested = [...new Set(String(req.query.types || '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => /^[a-z_]{1,30}$/.test(t)))]
      .slice(0, MAX_MIN_PRICE_TYPES);
    // P1: two queries in all (was two per type, one after the other): every active store of the
    // requested types, then the lowest in-stock price per store; the per-type minimum is taken here.
    const out = {};
    const typeMap = requested.map((type) => [type, resolveVendorTypes(type)]).filter(([, vts]) => vts && vts.length);
    const allVendorTypes = [...new Set(typeMap.flatMap(([, vts]) => vts))];
    if (allVendorTypes.length) {
      const stores = forCollege(req, await Restaurant.findAll({ where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()), vendorType: { [Op.in]: allVendorTypes } }, attributes: ['id', 'vendorType', 'visibleCampuses'], raw: true }));
      if (stores.length) {
        // Same "in stock" rule as /items (unavailable items whose restock time has passed count again).
        const rows = await MenuItem.findAll({
          where: {
            restaurantId: { [Op.in]: stores.map(s => s.id) },
            price: { [Op.gt]: 0 },
            [Op.or]: [{ isAvailable: true }, { outOfStockUntil: { [Op.lte]: new Date() } }]
          },
          attributes: ['restaurantId', [MenuItem.sequelize.fn('MIN', MenuItem.sequelize.col('price')), 'minPrice']],
          group: ['restaurantId'],
          raw: true
        });
        const minByStore = new Map(rows.map(r => [String(r.restaurantId), Number(r.minPrice)]));
        for (const [type, vendorTypes] of typeMap) {
          let best = null;
          for (const s of stores) {
            if (!vendorTypes.includes(s.vendorType)) continue;
            const n = minByStore.get(String(s.id));
            if (Number.isFinite(n) && n > 0 && (best === null || n < best)) best = n;
          }
          if (best !== null) out[type] = best;
        }
      }
    }
    res.set('Cache-Control', 'no-cache');
    res.json(out);
  } catch (error) {
    console.error('[CATALOGUE_MIN_PRICES_ERROR]', error);
    res.status(500).json({ message: 'Could not load prices right now. Please try again.' });
  }
};

module.exports = { getTypes, getStores, getItems, getMinPrices, shapeItem, shapeStore };
