// Server-side order pricing. Every orderable line is priced from the database; nothing the
// client sends about prices is trusted. Used by POST /api/orders/quote and POST /api/orders.
const { Op } = require('sequelize');
const { getMenuItemModel } = require('../models/MenuItem');
const { getRestaurantModel } = require('../models/Restaurant');
const { isLocalVendorStore, isServiceVendorType } = require('./vendorTypes');
const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');
const { calculateBadgePerks } = require('../middleware/rewardEngine');
const { calculateCustomizationCost } = require('./pricingSchema');
const { effectiveOptions, priceWithOptions } = require('./productOptions');
const { getStoreOpenState } = require('./storeHours');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QTY = 20;
const MAX_LINES = 50;
// Owner, 5 Nov 2026: every restaurant order is its own order with ₹19 delivery + ₹4 platform fee. No global
// overrides: the old GlobalConfig 'delivery_fee' / 'platform_fee' keys are ignored on purpose. The only override is a
// store's own special delivery price (Restaurant.deliveryFeeOverride, admin-set; null = ₹19). Stalls pay neither.
const DEFAULT_DELIVERY_FEE = 19;
const DEFAULT_PLATFORM_FEE = 4;
const ADDON_VENDOR_TYPE = 'EXTRAS';

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Customizations are stored on the order and shown to the kitchen: bounded plain data only (B12).
// At most 10 options; each a short string or a list of at most 10 short strings. Anything else
// (nested objects, numbers, huge text) is dropped.
const CUSTOM_MAX_KEYS = 10;
const CUSTOM_MAX_LEN = 100; // a typed cake message may be up to 100 (utils/productOptions text groups)
const cleanCustomText = (v) => String(v).replace(/[<>]/g, '').trim().slice(0, CUSTOM_MAX_LEN);
const sanitizeCustomizations = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let n = 0;
  for (const key of Object.keys(raw)) {
    if (n >= CUSTOM_MAX_KEYS) break;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const k = cleanCustomText(key);
    if (!k) continue;
    const v = raw[key];
    if (typeof v === 'string') {
      const t = cleanCustomText(v);
      if (!t) continue;
      out[k] = t;
    } else if (Array.isArray(v)) {
      const list = v.filter((x) => typeof x === 'string').slice(0, CUSTOM_MAX_KEYS).map(cleanCustomText).filter(Boolean);
      if (!list.length) continue;
      out[k] = list;
    } else {
      continue;
    }
    n += 1;
  }
  return n ? out : null;
};

class PricingError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
  toBody() {
    return { message: this.message, code: this.code, ...this.extra };
  }
}

// A store's admin-set special delivery price in whole rupees (0..200). null / empty / invalid = the standard ₹19.
const DELIVERY_FEE_OVERRIDE_MAX = 200;
const storeDeliveryFee = (store) => {
  const raw = store ? store.deliveryFeeOverride : null;
  if (raw === null || raw === undefined || raw === '') return DEFAULT_DELIVERY_FEE;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= DELIVERY_FEE_OVERRIDE_MAX ? n : DEFAULT_DELIVERY_FEE;
};

// Coupons usable right now: not used, and not expired (null expiry = no expiry).
const activeCouponWhere = (code, userId) => ({
  code,
  userId,
  isUsed: false,
  [Op.or]: [{ expiryDate: null }, { expiryDate: { [Op.gt]: new Date() } }]
});

const couponDiscountFor = (coupon, { subtotal, deliveryFee }) => {
  if (!coupon) return { delivery: 0, items: 0 };
  if (coupon.type === 'FREEDEL') return { delivery: deliveryFee, items: 0 };
  if (coupon.type === 'DISCOUNT') {
    const value = Number(coupon.value) || 0;
    // Older DISCOUNT coupons were created without a value: they were worth 20% up to ₹50.
    const amount = value > 0 ? value : Math.min(50, Math.round(subtotal * 0.2));
    return { delivery: 0, items: Math.min(amount, subtotal) };
  }
  return { delivery: 0, items: 0 };
};

// Vault coupons (C1-4) are tied to the deal's store / product and a minimum order. Coupons claimed
// before those columns existed carry none: their deal is found from the code (VAULT-<deal id 8>-...).
const couponRestrictions = async (coupon) => {
  const r = {
    restaurantId: coupon.restaurantId || null,
    menuItemId: coupon.menuItemId || null,
    minOrderValue: Number(coupon.minOrderValue) > 0 ? Number(coupon.minOrderValue) : 0,
  };
  const legacy = /^VAULT-([0-9A-F]{8})-/i.exec(String(coupon.code || ''));
  if (legacy && !coupon.vaultItemId && !r.minOrderValue) {
    try {
      const { getVaultItemModel } = require('../models/VaultItem');
      const VaultItem = getVaultItemModel();
      const deals = VaultItem ? await VaultItem.findAll({ attributes: ['id', 'originalPrice', 'minOrderValue', 'restaurantId', 'menuItemId'] }) : [];
      const deal = deals.find((d) => String(d.id).slice(0, 8).toUpperCase() === legacy[1].toUpperCase());
      if (deal) {
        const own = Number(deal.minOrderValue);
        r.minOrderValue = own > 0 ? own : (Number(deal.originalPrice) > 0 ? Number(deal.originalPrice) : 0);
        r.restaurantId = r.restaurantId || deal.restaurantId || null;
        r.menuItemId = r.menuItemId || deal.menuItemId || null;
      }
    } catch { /* restrictions lookup is best effort for legacy coupons */ }
  }
  return r;
};

const assertCouponFitsOrder = async (coupon, { store, subtotal, pricedLines }) => {
  const r = await couponRestrictions(coupon);
  if (r.restaurantId && String(r.restaurantId) !== String(store.id)) {
    let name = 'another store';
    try {
      const other = await getRestaurantModel().findByPk(r.restaurantId, { attributes: ['id', 'name'] });
      if (other && other.name) name = other.name;
    } catch { /* name is cosmetic */ }
    throw new PricingError(400, 'COUPON_WRONG_STORE', `Coupon ${coupon.code} only works on orders from ${name}. Remove it to continue.`, { couponStoreId: r.restaurantId });
  }
  if (r.menuItemId && !pricedLines.some((l) => String(l.menuItemId) === String(r.menuItemId))) {
    let name = 'the deal item';
    try {
      const it = await getMenuItemModel().findByPk(r.menuItemId, { attributes: ['id', 'name'] });
      if (it && it.name) name = it.name;
    } catch { /* cosmetic */ }
    throw new PricingError(400, 'COUPON_ITEM_REQUIRED', `Coupon ${coupon.code} needs ${name} in your basket. Add it or remove the coupon to continue.`, { couponMenuItemId: r.menuItemId });
  }
  if (r.minOrderValue > 0 && subtotal < r.minOrderValue) {
    throw new PricingError(400, 'COUPON_MIN_ORDER', `Coupon ${coupon.code} needs an item total of at least ₹${money(r.minOrderValue)}. Add ₹${money(r.minOrderValue - subtotal)} more or remove the coupon.`, { couponMinOrderValue: money(r.minOrderValue), subtotal });
  }
};

const isItemAvailable = (dbItem, now = new Date()) => {
  if (dbItem.isAvailable) return true;
  // "Out of stock until X" items come back on their own once X has passed.
  return !!(dbItem.outOfStockUntil && new Date(dbItem.outOfStockUntil) <= now);
};

/**
 * @param {object} args
 * @param {object} args.user      Sequelize User row (the customer)
 * @param {Array}  args.items     [{ menuItemId|id, quantity, customizations?, name? }]
 * @param {string} [args.couponCode]
 * @returns quote (throws PricingError for anything the customer must fix)
 */
const computeOrderQuote = async ({ user, items, couponCode }) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PricingError(400, 'EMPTY_BASKET', 'Your basket is empty. Add something tasty first!');
  }
  if (items.length > MAX_LINES) {
    throw new PricingError(400, 'TOO_MANY_LINES', `That's a big basket! Please keep it to ${MAX_LINES} different items per order.`);
  }

  const MenuItem = getMenuItemModel();
  const Restaurant = getRestaurantModel();
  const { resolveLegacyItemId } = require('../scripts/catalogue_import');

  // 1. Resolve ids + validate quantities
  const lines = [];
  const problems = [];
  for (const raw of items) {
    const rawId = raw && (raw.menuItemId || raw.id || raw._id);
    const label = (raw && raw.name) ? String(raw.name).slice(0, 80) : 'An item';
    const qty = Number(raw && raw.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new PricingError(400, 'INVALID_QUANTITY', `You can order 1 to ${MAX_QTY} of each item. Please check the quantity of "${label}".`);
    }
    let id = typeof rawId === 'string' ? rawId.trim() : (rawId != null ? String(rawId) : '');
    if (!UUID_RE.test(id)) {
      id = (await resolveLegacyItemId(id, raw && raw.name)) || null;
    }
    if (!id) {
      problems.push({ id: rawId != null ? String(rawId) : null, name: label, reason: 'not_found' });
      continue;
    }
    lines.push({ id, qty, customizations: sanitizeCustomizations(raw.customizations), label });
  }

  const ids = [...new Set(lines.map(l => l.id))];
  const dbItems = ids.length ? await MenuItem.findAll({ where: { id: ids } }) : [];
  const itemMap = new Map(dbItems.map(i => [i.id, i]));
  const restIds = [...new Set(dbItems.map(i => i.restaurantId))];
  const rests = restIds.length ? await Restaurant.findAll({ where: { id: restIds } }) : [];
  const restMap = new Map(rests.map(r => [r.id, r]));

  const isElite = !!(user && (user.isElite || (Array.isArray(user.badges) && user.badges.some(b => typeof b === 'string' && b.includes('Elite')))));
  const bookingOnly = [];
  // C8 (admin Config → Receipts, default off): stores without an FSSAI licence number take no new orders.
  const fssaiRequired = await require('./receiptSettings').hideStoresWithoutFssai();
  for (const line of lines) {
    const dbItem = itemMap.get(line.id);
    const store = dbItem && restMap.get(dbItem.restaurantId);
    if (!dbItem || !store) { problems.push({ id: line.id, name: line.label, reason: 'not_found' }); continue; }
    // Service stores (laundry, print, repairs, tailoring) are booked via /api/services/book, never ordered,
    // even when an older product row has no specs.bookingOnly flag. specs may be a JSON string on SQLite.
    let specs = dbItem.specs;
    if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
    specs = specs && typeof specs === 'object' ? specs : {};
    if (specs.bookingOnly || isServiceVendorType(store.vendorType)) { bookingOnly.push(dbItem.name); continue; }
    if (!isItemAvailable(dbItem) || !(Number(dbItem.price) > 0)) { problems.push({ id: dbItem.id, name: dbItem.name, reason: 'out_of_stock' }); continue; }
    if (store.isActive === false || (fssaiRequired && !store.fssaiLicenseNumber)) { problems.push({ id: dbItem.id, name: dbItem.name, reason: 'store_unavailable' }); continue; }
    if (dbItem.isEliteOnly && !isElite) { problems.push({ id: dbItem.id, name: dbItem.name, reason: 'elite_only' }); continue; }
    line.dbItem = dbItem;
    line.store = store;
  }

  if (bookingOnly.length) {
    throw new PricingError(400, 'BOOKING_ONLY_ITEMS', `${bookingOnly.join(', ')} ${bookingOnly.length > 1 ? 'are services' : 'is a service'} — please book ${bookingOnly.length > 1 ? 'them' : 'it'} from the service page instead of the basket.`, { bookingOnlyItems: bookingOnly });
  }
  if (problems.length) {
    const names = [...new Set(problems.map(p => p.name))];
    throw new PricingError(400, 'ITEMS_UNAVAILABLE',
      `Some items in your basket are no longer available: ${names.join(', ')}. Please remove ${names.length > 1 ? 'them' : 'it'} and try again.`,
      { unavailableItems: problems });
  }

  // 2. One store per order. Add-ons (EXTRAS) ride along with the main store's order.
  const mainStores = new Map();
  for (const l of lines) {
    if ((l.store.vendorType || '').toUpperCase() !== ADDON_VENDOR_TYPE) mainStores.set(l.store.id, l.store);
  }
  if (mainStores.size === 0) {
    throw new PricingError(400, 'ADDONS_ONLY', 'Add-ons can only be ordered together with a main item. Add something from a restaurant or store first.');
  }
  if (mainStores.size > 1) {
    const names = [...mainStores.values()].map(s => s.name);
    throw new PricingError(400, 'MULTIPLE_STORES',
      `Your basket has items from ${names.join(' and ')}. Each order comes from one store — please place a separate order for each.`,
      { stores: [...mainStores.values()].map(s => ({ id: s.id, name: s.name })) });
  }
  const store = [...mainStores.values()][0];
  // CampusBites stall: ordered inside Zenvy, cash to the vendor, the vendor delivers (no rider).
  const isStall = isLocalVendorStore(store);
  if (isStall && lines.some(l => (l.store.vendorType || '').toUpperCase() === ADDON_VENDOR_TYPE)) {
    throw new PricingError(400, 'ADDONS_NOT_FOR_STALL', `Add-ons can't be added to a ${store.name} order. Please remove them and try again.`);
  }
  if (isStall && couponCode) {
    throw new PricingError(400, 'COUPON_NOT_FOR_STALL', `Coupons can't be used on ${store.name} orders — you pay the stall in cash. Remove the coupon to continue.`);
  }
  // In-Campus Booking stall (owner, 30 Oct 2026: "in-campus means no delivery"): students pre-book it under In-Campus
  // Booking, pay the stall by UPI and collect it there. It never takes a delivery order.
  if (isStall && store.campusBookingEnabled === true) {
    throw new PricingError(400, 'BOOKING_ONLY_STALL', `${store.name} takes In-Campus pre-bookings only. Book it from In-Campus Booking and collect it at the stall.`, { storeId: store.id });
  }
  const slotsLib = require('./deliverySlots');
  await slotsLib.loadConfig();
  const slotNow = slotsLib.now();
  const openState = isStall && store.isOffline
    ? { isOpen: false, message: `${store.name} is not taking orders on ZenWe right now.` }
    : getStoreOpenState(store, slotNow);
  // Delivery slots: the store must be open at the START of a bookable slot, not necessarily right now (an
  // order at 10 PM for tomorrow's 12:30 slot is fine). The lead time comes from the items (cakes take longer).
  // A store that is off (inactive, an offline stall, its own "closed" switch) has no open slot at all.
  // Local vendors / stalls deliver themselves, so delivery slots never apply to them (owner, 27 Oct): they are
  // ordered while open, as before slots.
  let deliverySlots = null;
  if (slotsLib.slotsEnabled() && !isStall) {
    // Slots already holding SLOT_MAX_ORDERS orders show "Full" (utils/deliverySlots applyCapacity).
    deliverySlots = await slotsLib.applyCapacity(slotsLib.slotsForOrder({ items: lines.map((l) => l.dbItem), store, at: slotNow }));
    if (!deliverySlots.nextSlot) {
      const allFull = deliverySlots.slots.some((s) => s.closedReason === 'full');
      const message = !openState.isOpen
        ? openState.message
        : allFull
          ? "Today's and tomorrow's delivery slots are full. Please check again later."
          : `${store.name} is not taking orders for today's or tomorrow's delivery slots.`;
      throw new PricingError(400, 'STORE_CLOSED', message, { storeId: store.id, opensAt: openState.opensAt || null });
    }
  } else if (!openState.isOpen) {
    throw new PricingError(400, 'STORE_CLOSED', openState.message, { storeId: store.id, opensAt: openState.opensAt || null });
  }

  // 3. Price every line from the DB
  let subtotal = 0;
  const pricedLines = lines.map((l) => {
    const isAddOn = (l.store.vendorType || '').toUpperCase() === ADDON_VENDOR_TYPE;
    // A product with admin-set choices (weights, flavours, types: utils/productOptions, docs/PRODUCT_OPTIONS.md)
    // is priced ONLY from them; everything else keeps the older keyword-based customization pricing.
    const groups = isAddOn ? [] : effectiveOptions(l.dbItem, l.store && l.store.vendorType);
    let basePrice;
    let addOnPrice;
    if (groups.length) {
      let priced;
      try {
        priced = priceWithOptions(l.dbItem, groups, l.customizations);
      } catch (err) {
        if (err && err.code === 'OPTION_INVALID') throw new PricingError(400, 'OPTION_INVALID', err.message, { menuItemId: l.dbItem.id });
        throw err;
      }
      basePrice = money(priced.basePrice);
      addOnPrice = money(priced.addOnPrice);
      l.customizations = priced.customizations;
    } else {
      basePrice = money(l.dbItem.price);
      addOnPrice = isAddOn ? 0 : money(calculateCustomizationCost(basePrice, l.dbItem, l.customizations));
    }
    const unitPrice = money(basePrice + addOnPrice);
    const lineTotal = money(unitPrice * l.qty);
    subtotal = money(subtotal + lineTotal);
    return {
      menuItemId: l.dbItem.id,
      id: l.dbItem.id,
      name: l.dbItem.name,
      quantity: l.qty,
      basePrice,
      addOnPrice,
      unitPrice,
      price: unitPrice,
      priceAtOrder: unitPrice,
      lineTotal,
      customizations: isAddOn ? null : l.customizations,
      image: l.dbItem.imageUrl || '',
      restaurantId: l.dbItem.restaurantId,
      isAddOn
    };
  });

  // 4. Fees
  // Stalls deliver themselves: no Zenvy delivery fee.
  // Restaurants: the store's special delivery price if an admin set one, else the standard ₹19.
  const deliveryFee = isStall ? 0 : money(storeDeliveryFee(store));
  // ZenWe platform fee per order, fixed ₹4 (never discounted: delivery coupons / perks only touch deliveryFee, item
  // discounts only the item total).
  const platformFee = isStall ? 0 : DEFAULT_PLATFORM_FEE;
  // Per-store packaging fee and minimum order (admin-set, 0 = none).
  const packagingFee = money(Math.min(500, Math.max(0, Number(store.packagingFee) || 0)));
  const minOrderValue = money(Math.max(0, Number(store.minOrderValue) || 0));
  if (minOrderValue > 0 && subtotal < minOrderValue) {
    throw new PricingError(400, 'MIN_ORDER_NOT_MET',
      `${store.name} needs a minimum order of ₹${minOrderValue}. Add ₹${money(minOrderValue - subtotal)} more to continue.`,
      { minOrderValue, storeName: store.name, storeId: store.id, subtotal });
  }
  const taxes = 0;        // prices are inclusive of taxes

  // 5. Discounts (all real, all server-side)
  const discounts = [];
  let deliveryDiscountLeft = deliveryFee;
  const addDeliveryDiscount = (type, label, amount) => {
    const a = money(Math.min(amount, deliveryDiscountLeft));
    if (a > 0) { discounts.push({ type, label, amount: a }); deliveryDiscountLeft = money(deliveryDiscountLeft - a); }
  };

  // Batching: another live order from the same store to the same hostel block shares the ride.
  if (!isStall && user && user.hostelBlock) {
    try {
      const Order = getOrderModel();
      const User = getUserModel();
      const batchable = await Order.findOne({
        where: { restaurantId: store.id, status: ['Pending', 'Accepted', 'Preparing'], userId: { [Op.ne]: user.id } },
        include: [{ model: User, as: 'user', attributes: [], where: { hostelBlock: user.hostelBlock } }]
      });
      if (batchable) addDeliveryDiscount('batch', 'Shared ride with your block', Math.round(deliveryFee * 0.2));
    } catch { /* batching is a bonus, never block an order on it */ }
  }

  // Zenvy-funded perks never apply to stall orders (the stall collects the cash).
  const perks = isStall ? { deliveryDiscount: 0, orderDiscount: 0 } : calculateBadgePerks(user);
  // Plain bill labels ("Gold member: delivery discount"), never the badge nicknames.
  const tierWord = perks.tier ? `${perks.tier} member` : 'Member';
  const perkDeliveryLabel = perks.pointsFreeDelivery ? '200+ ZenWe Points: free delivery' : `${tierWord}: delivery discount`;
  if (perks.deliveryDiscount > 0) addDeliveryDiscount('perk_delivery', perkDeliveryLabel, Math.round(deliveryFee * perks.deliveryDiscount));

  let coupon = null;
  if (couponCode) {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    coupon = await Coupon.findOne({ where: activeCouponWhere(String(couponCode).trim(), user.id) });
    if (!coupon) {
      throw new PricingError(400, 'COUPON_INVALID', 'That coupon is not valid any more (it may be used or expired). Remove it to continue.');
    }
    await assertCouponFitsOrder(coupon, { store, subtotal, pricedLines });
  }
  let itemsDiscountLeft = subtotal;
  const addItemsDiscount = (type, label, amount) => {
    const a = money(Math.min(amount, itemsDiscountLeft));
    if (a > 0) { discounts.push({ type, label, amount: a }); itemsDiscountLeft = money(itemsDiscountLeft - a); }
  };
  if (perks.orderDiscount > 0) {
    // A flat perk can take at most half of the item total, so no order becomes free.
    addItemsDiscount('perk_order', `${tierWord}: order discount`, Math.min(perks.orderDiscount, Math.floor(subtotal * 0.5)));
  }
  if (coupon) {
    const c = couponDiscountFor(coupon, { subtotal, deliveryFee });
    if (c.delivery > 0) addDeliveryDiscount('coupon', `Coupon ${coupon.code}`, c.delivery);
    if (c.items > 0) addItemsDiscount('coupon', `Coupon ${coupon.code}`, c.items);
    // A coupon that saves nothing on this order (free delivery already from points / tier, or other discounts
    // used the whole amount) is refused instead of being used up for ₹0: it stays in the customer's coupons.
    const saved = discounts.filter((d) => d.type === 'coupon').reduce((sum, d) => sum + d.amount, 0);
    if (saved <= 0) {
      throw new PricingError(400, 'COUPON_NO_SAVING', coupon.type === 'FREEDEL'
        ? `You already get free delivery on this order, so coupon ${coupon.code} would save nothing. Remove it to keep it for later.`
        : `Coupon ${coupon.code} would save nothing on this order. Remove it to keep it for later.`);
    }
  }

  const totalDiscount = money(discounts.reduce((s, d) => s + d.amount, 0));
  const finalPrice = money(Math.max(0, subtotal + deliveryFee + platformFee + packagingFee + taxes - totalDiscount));
  const sumOf = (types) => money(discounts.filter(d => types.includes(d.type)).reduce((s, d) => s + d.amount, 0));

  return {
    currency: 'INR',
    store: { id: store.id, name: store.name, vendorType: store.vendorType, isOffline: !!store.isOffline, zone: store.zone, location: store.location, ...(isStall ? { whatsappNumber: store.whatsappNumber || null } : {}), minOrderValue, fssaiLicenseNumber: store.fssaiLicenseNumber || null, isTestData: !!store.isTestData },
    fulfilment: isStall ? 'VENDOR' : 'ZENVY',
    // Stalls and rider-purchase stores (offline / no partner login) are cash on delivery only.
    paymentMethods: isStall || require('./riderPurchase').isRiderPurchaseStore(store, 'computeOrderQuote') ? ['COD'] : ['COD', 'Wallet'],
    lines: pricedLines,
    subtotal,
    deliveryFee,
    platformFee,
    packagingFee,
    taxes,
    discounts,
    totalDiscount,
    finalPrice,
    coupon: coupon ? { code: coupon.code, type: coupon.type, discount: sumOf(['coupon']) } : null,
    // Delivery slots for this basket (utils/deliverySlots.slotsForOrder): lead, today + tomorrow, default.
    // Null when slots are switched off.
    deliverySlots,
    // Split used for the Order columns
    batchDiscount: sumOf(['batch']),
    perkDiscount: sumOf(['perk_delivery', 'perk_order']),
    couponDiscount: sumOf(['coupon'])
  };
};

const PAYMENT_ALIASES = {
  cod: 'COD', cash: 'COD', 'cash on delivery': 'COD', 'cash_on_delivery': 'COD',
  wallet: 'Wallet', 'zenvy wallet': 'Wallet', zenvywallet: 'Wallet', 'zcs wallet': 'Wallet', zcswallet: 'Wallet', 'zenv wallet': 'Wallet', zenvwallet: 'Wallet', 'zenwe wallet': 'Wallet', zenwewallet: 'Wallet'
};
const normalizePaymentMethod = (pm) => {
  if (pm === undefined || pm === null || pm === '') return null;
  return PAYMENT_ALIASES[String(pm).trim().toLowerCase()] || null;
};
const PAYMENT_UNAVAILABLE_MESSAGE = 'Online payments are coming soon — please choose Cash on Delivery or Wallet.';

module.exports = {
  sanitizeCustomizations,
  computeOrderQuote,
  PricingError,
  activeCouponWhere,
  normalizePaymentMethod,
  PAYMENT_UNAVAILABLE_MESSAGE,
  money,
  UUID_RE,
  DEFAULT_DELIVERY_FEE,
  DEFAULT_PLATFORM_FEE,
  DELIVERY_FEE_OVERRIDE_MAX,
  storeDeliveryFee
};
