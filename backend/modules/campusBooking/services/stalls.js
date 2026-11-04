// Which stalls take In-Campus Bookings, and how a stall / its menu is shown to students.
// Stalls are the EXISTING CampusBites local vendors (Restaurant rows with vendorType LOCAL_VENDOR / LOCAL /
// STALL, run from the ZCS Vendor app). A stall takes bookings when the admin switched In-Campus Booking on
// for it AND it has a UPI ID to be paid on. Everything shown is real: names, photos, menus and prices from
// the catalogue, open state from the stall's own switch + hours, rating only when real order ratings exist.
const { Op } = require('sequelize');
const { LOCAL_VENDOR_TYPES } = require('../../../utils/vendorTypes');
const { getStoreOpenState, todayHoursText } = require('../../../utils/storeHours');
const { LIMITS, CATEGORIES } = require('../enums');
const { fail } = require('./util');

const STORE_ATTRS = ['id', 'name', 'location', 'campus', 'vendorType', 'tags', 'operatingHours', 'isActive', 'isOffline', 'isOpenNow',
  'stallDescription', 'campusBookingEnabled', 'campusUpiId', 'campusUpiName', 'campusUpiQrUrl', 'campusPrepMinutes', 'whatsappNumber',
  'legalName', 'fssaiLicenseNumber'];

const imageColumns = () => require('../../../utils/imageStore').dataUrlSafeColumns('Restaurant', ['imageUrl', 'logoUrl']);
const itemImageColumns = () => require('../../../utils/imageStore').dataUrlSafeColumns('MenuItem', ['imageUrl']);

/** Prep estimate in minutes from the stall's own setting (2-90), else the 10 minute default. */
const prepMinutesOf = (store) => {
  const n = Number(store && store.campusPrepMinutes);
  return Number.isInteger(n) && n >= LIMITS.minPrepMin && n <= LIMITS.maxPrepMin ? n : LIMITS.defaultPrepMin;
};

// Category from the stall's main (first) tag, the one the catalogue lists it under: a chai stall that also sells
// samosas stays Food & Beverages, a bakery is Snacks & Bakery. No matching tag = Food & Beverages.
const STATIONERY = /^(stationery|stationary|xerox|print|printing|notebooks?|pens?|books?|photocopy)$/;
const MORE = /^(daily-needs|groceries|grocery|toiletries|fruits|vegetables|fresh|water|essentials|kirana)$/;
const SNACKS = /^(bakery|sweets|cakes?|pastry|pastries|puffs?|desserts?|snacks?|chaat|pani-puri|samosa|bajji|ice-cream|kulfi|falooda|cookies|street-food)$/;
const categoryOf = (store) => {
  const tags = (Array.isArray(store && store.tags) ? store.tags : []).map((t) => String(t).trim().toLowerCase());
  const t = tags[0] || '';
  if (STATIONERY.test(t)) return 'stationery';
  if (MORE.test(t)) return 'more';
  if (SNACKS.test(t)) return 'snacks';
  return 'food';
};
const categoryLabel = (key) => (CATEGORIES.find((c) => c.key === key) || CATEGORIES[0]).label;

/** true when the stall can be booked at all (switch on, UPI set, live, a stall). */
const takesBookings = (store) => !!store && store.isActive !== false && store.campusBookingEnabled === true && !!store.campusUpiId
  && LOCAL_VENDOR_TYPES.includes(String(store.vendorType || '').toUpperCase());

/** Open right now (own switch, hours, offline flag). */
const openStateOf = (store, now = new Date()) => {
  const s = getStoreOpenState(store, now);
  return { isOpen: !!s.isOpen && store.isOffline !== true, opensAt: s.opensAt || null, closesAt: s.isOpen ? (s.closesAt || null) : null, closedReason: s.isOpen ? null : (s.message || `${store.name} is closed right now.`) };
};

const listWhere = async () => ({
  vendorType: { [Op.in]: LOCAL_VENDOR_TYPES },
  isActive: true,
  campusBookingEnabled: true,
  campusUpiId: { [Op.ne]: null },
  ...(await require('../../../utils/receiptSettings').listingWhere()),
});

/** Public card / header for a stall (no UPI details: those are only on the student's own booking). */
const serializeStall = (store, { rating = null, itemCount = null, now = new Date() } = {}) => {
  const plain = typeof store.get === 'function' ? store.get({ plain: true }) : store;
  const open = openStateOf(plain, now);
  const category = categoryOf(plain);
  return {
    id: String(plain.id),
    name: plain.name,
    location: plain.location || null,
    campus: plain.campus || null,
    imageUrl: plain.imageUrl || null,
    logoUrl: plain.logoUrl || null,
    description: plain.stallDescription || null,
    category,
    categoryLabel: categoryLabel(category),
    tags: Array.isArray(plain.tags) ? plain.tags.slice(0, 8) : [],
    isOpen: open.isOpen,
    opensAt: open.opensAt,
    closesAt: open.closesAt,
    closedReason: open.closedReason,
    hoursToday: todayHoursText(plain, now),
    prepMinutes: prepMinutesOf(plain),
    // Real order ratings only (utils/storeRatings); null = no rating yet (never an invented score).
    rating: rating && rating.ratingCount > 0 ? rating.rating : null,
    ratingCount: rating && rating.ratingCount > 0 ? rating.ratingCount : 0,
    itemCount,
    legalName: plain.legalName || null,
    fssaiLicenseNumber: plain.fssaiLicenseNumber || null,
  };
};

const isVegOf = (m) => {
  const d = String(m.dietType || '').toLowerCase();
  if (d === 'veg') return true;
  if (d === 'nonveg' || d === 'egg') return false;
  return m.isVegetarian !== false;
};

const serializeItem = (m) => {
  const p = typeof m.get === 'function' ? m.get({ plain: true }) : m;
  return {
    id: String(p.id),
    name: p.name,
    price: Number(p.price) || 0,
    originalPrice: Number(p.originalPrice) > Number(p.price) ? Number(p.originalPrice) : null,
    description: p.description || null,
    imageUrl: p.imageUrl || null,
    category: p.category || null,
    isVeg: isVegOf(p),
    dietType: p.dietType || (p.isVegetarian === false ? 'nonveg' : 'veg'),
    isAvailable: p.isAvailable !== false,
  };
};

const models = () => {
  const { getRestaurantModel } = require('../../../models/Restaurant');
  const { getMenuItemModel } = require('../../../models/MenuItem');
  return { Restaurant: getRestaurantModel(), MenuItem: getMenuItemModel() };
};

const ADDON_RE = /add-?ons?|extras?/i;

/** Every stall that takes bookings: open first, then by name. Optional q (name / tag / item), category and college
 * (utils/campuses key: only stalls that serve the student's college). */
const listStalls = async ({ q = '', category = '', campus = '', college = '' } = {}) => {
  const { Restaurant, MenuItem } = models();
  const where = await listWhere();
  if (campus) where.campus = String(campus).slice(0, 40);
  const campuses = require('../../../utils/campuses');
  const collegeKey = campuses.normalizeKey(college);
  const rows = (await Restaurant.findAll({ where, attributes: { include: imageColumns(), exclude: ['imageUrl', 'logoUrl'] } }))
    .filter((r) => campuses.storeServes(r, collegeKey));
  const ids = rows.map((r) => r.id);
  const items = ids.length ? require('../../../utils/menuSort').sortMenuItems(await MenuItem.findAll({
    where: { restaurantId: { [Op.in]: ids } },
    attributes: ['id', 'restaurantId', 'name', 'isAvailable', 'category', 'price', 'dietType', 'isVegetarian', 'specs'],
    raw: true,
  })) : [];
  const byStore = new Map();
  for (const it of items) {
    const k = String(it.restaurantId);
    if (!byStore.has(k)) byStore.set(k, []);
    byStore.get(k).push(it);
  }
  const ratings = await require('../../../utils/storeRatings').realRatingsFor(ids);
  const needle = String(q || '').trim().toLowerCase().slice(0, 60);
  const now = new Date();
  let out = rows.map((r) => {
    const list = byStore.get(String(r.id)) || [];
    const card = serializeStall(r, { rating: ratings.get(String(r.id)) || null, itemCount: list.filter((m) => m.isAvailable !== false).length, now });
    // Same card as the Home stall section: up to 3 dishes (mains before add-ons) and the first 2 menu categories.
    const avail = list.filter((m) => m.isAvailable !== false);
    const mains = [...avail.filter((m) => !ADDON_RE.test(String(m.category || ''))), ...avail.filter((m) => ADDON_RE.test(String(m.category || '')))];
    card.preview = mains.slice(0, 3).map((m) => ({ id: String(m.id), name: m.name, price: Number(m.price) || 0, isVeg: isVegOf(m), category: m.category || null }));
    const cats = [];
    for (const m of mains) {
      const c = String(m.category || '').trim();
      if (c && !cats.some((x) => x.toLowerCase() === c.toLowerCase())) cats.push(c);
      if (cats.length === 2) break;
    }
    card.menuCategories = cats.join(', ') || null;
    if (needle) {
      const hay = [card.name, card.location, ...(card.tags || []), ...list.map((m) => m.name), ...list.map((m) => m.category || '')].join(' ').toLowerCase();
      card.matches = hay.includes(needle);
      const hit = list.find((m) => String(m.name || '').toLowerCase().includes(needle));
      card.matchedItem = hit ? hit.name : null;
    }
    return card;
  });
  if (needle) out = out.filter((c) => c.matches).map(({ matches, ...c }) => c);
  if (category && CATEGORIES.some((c) => c.key === category)) out = out.filter((c) => c.category === category);
  out.sort((a, b) => (Number(b.isOpen) - Number(a.isOpen)) || String(a.name).localeCompare(String(b.name)));
  return out;
};

/** One bookable stall + its menu. 404 when the stall does not take bookings. */
const getStallWithMenu = async (id) => {
  const { Restaurant, MenuItem } = models();
  if (!require('./util').isUuid(String(id || ''))) throw fail(404, 'STALL_NOT_FOUND', 'This stall is not taking bookings on ZENV.');
  const store = await Restaurant.findOne({ where: { id, ...(await listWhere()) }, attributes: { include: imageColumns(), exclude: ['imageUrl', 'logoUrl'] } });
  if (!store) throw fail(404, 'STALL_NOT_FOUND', 'This stall is not taking bookings on ZENV.');
  const rows = await MenuItem.findAll({ where: { restaurantId: store.id }, attributes: { include: itemImageColumns(), exclude: ['imageUrl', 'customCommission', 'ownerName', 'ownerPhone'] } });
  const menu = require('../../../utils/menuSort').sortMenuItems(rows).map(serializeItem);
  const ratings = await require('../../../utils/storeRatings').realRatingsFor([store.id]);
  return { store, stall: serializeStall(store, { rating: ratings.get(String(store.id)) || null, itemCount: menu.filter((m) => m.isAvailable).length }), menu };
};

module.exports = { STORE_ATTRS, prepMinutesOf, categoryOf, categoryLabel, takesBookings, openStateOf, listWhere, serializeStall, serializeItem, listStalls, getStallWithMenu, isVegOf };
