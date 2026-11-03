/**
 * Owner-only test data, version 2 (owner, 3 Nov 2026: "add valid mock data in every section, I will test it on the
 * live server", "with valid images and descriptions", "like a real one"; then "only my accounts"). Every row added
 * here has isTestData = true, so only the tester phones in TEST_VIEWER_PHONES see it (utils/testView); everyone else,
 * the Play reviewer included, never does.
 *
 * Data: data/test_data_v2_2026-11-03.json: restaurants, campus stalls, grocery and service stores with their items
 * (generic names, Unsplash photos, each photo once per store), daily deals on some of those items, two PG stays
 * (Wikimedia Commons photos, credits in the file) and Co-Ride rides hosted by the tester accounts.
 * Create-only and idempotent: ids are fixed from each row's key and inserts skip rows that exist, so two instances
 * starting together add each row once; each part runs once (marker TEST_DATA_V2_<PART>_DONE), so a row an admin
 * deleted is not added back and admin edits always stay.
 * Removal: Admin > Config > Test data (POST /api/admin/test-data/remove) or REMOVE_TEST_DATA_V2=true cancels and
 * refunds open test orders through the normal path, deletes every test row and keeps it from coming back
 * (TEST_DATA_V2_REMOVED). DISABLE_TEST_DATA_V2=true skips the seed.
 */
const crypto = require('crypto');
const { Op } = require('sequelize');

const DATA = '../data/test_data_v2_2026-11-03.json';
const REMOVED = 'TEST_DATA_V2_REMOVED';
const marker = (part) => `TEST_DATA_V2_${part.toUpperCase()}_DONE`;

/** A fixed UUID (v5 layout) for a row key: every run and every instance gives the same id. */
const idFor = (key) => {
  const h = crypto.createHash('sha1').update(`zcs-test-data-v2:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};

const modelsOf = () => {
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  return (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
};
/** Only the fields the model has (older databases / models may lack some), undefined values left out. */
const fieldsOf = (Model, row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== undefined && Model.rawAttributes[k]));
const isTrue = (v) => String(v || '').toLowerCase() === 'true';

const storeRow = (Restaurant, s, now) => fieldsOf(Restaurant, {
  id: idFor(s.key),
  isTestData: true,
  name: s.name,
  vendorType: s.vendorType,
  location: s.location,
  lat: s.lat,
  lon: s.lon,
  zone: 'Amaravathi_Central',
  ...(s.vendorType === 'LOCAL_VENDOR' ? { campus: 'SRMAP', isLocalVendor: true } : {}),
  imageUrl: s.imageUrl,
  tags: s.tags || [],
  operatingHours: s.operatingHours,
  deliveryTime: s.deliveryTime,
  description: s.description || undefined,
  stallDescription: s.stallDescription || undefined,
  foodCategory: s.foodCategory || undefined,
  rating: 0,
  isActive: true,
  isOpenNow: true,
  isOffline: false,
  publishedAt: now,
});

const itemRow = (MenuItem, s, it, i) => fieldsOf(MenuItem, {
  id: idFor(`${s.key}/${it.key}`),
  isTestData: true,
  restaurantId: idFor(s.key),
  name: it.name,
  price: it.price,
  originalPrice: it.originalPrice,
  description: it.description || undefined,
  imageUrl: it.imageUrl,
  category: it.category || undefined,
  dietType: it.dietType,
  isVegetarian: it.dietType !== 'nonveg' && it.dietType !== 'egg',
  isAvailable: true,
  specs: { sortOrder: (i + 1) * 10 },
});

let running = null;
/** Adds the parts not added yet (boot, and after Admin > Config saves the tester phones). */
const runTestDataV2Seed = ({ reason = 'boot' } = {}) => {
  if (!running) running = seed(reason).finally(() => { running = null; });
  return running;
};

const seed = async (reason) => {
  if (isTrue(process.env.DISABLE_TEST_DATA_V2)) return { skipped: 'disabled' };
  const M = modelsOf();
  const GlobalConfig = M('GlobalConfig');
  const Restaurant = M('Restaurant');
  const MenuItem = M('MenuItem');
  const VaultItem = M('VaultItem');
  if (!GlobalConfig || !Restaurant || !MenuItem || !Restaurant.rawAttributes.isTestData) return { skipped: 'models not ready' };
  if (isTrue(process.env.REMOVE_TEST_DATA_V2)) return removeTestDataV2({ by: 'REMOVE_TEST_DATA_V2' });
  if (await GlobalConfig.findOne({ where: { key: REMOVED } })) return { skipped: 'removed' };

  const data = require(DATA);
  const out = { reason, stores: 0, items: 0, deals: 0 };
  const done = async (part, value) => GlobalConfig.upsert({ key: marker(part), value: { at: new Date().toISOString(), ...value }, description: 'Owner-only test data added (scripts/test_data_v2_seed.js)' });

  if (!(await GlobalConfig.findOne({ where: { key: marker('stores') } }))) {
    const now = new Date();
    await Restaurant.bulkCreate(data.stores.map((s) => storeRow(Restaurant, s, now)), { ignoreDuplicates: true });
    const items = data.stores.flatMap((s) => s.items.map((it, i) => itemRow(MenuItem, s, it, i)));
    for (let i = 0; i < items.length; i += 200) await MenuItem.bulkCreate(items.slice(i, i + 200), { ignoreDuplicates: true });
    out.stores = data.stores.length;
    out.items = items.length;
    await done('stores', { stores: out.stores, items: out.items });
  }

  if (VaultItem && VaultItem.rawAttributes.isTestData && !(await GlobalConfig.findOne({ where: { key: marker('deals') } }))) {
    const rows = [];
    for (const d of data.deals || []) {
      const store = data.stores.find((s) => s.key === d.storeKey);
      const item = store && store.items.find((x) => x.key === d.itemKey);
      if (!item) continue;
      rows.push(fieldsOf(VaultItem, {
        id: idFor(d.key), isTestData: true, name: d.name, price: d.price, originalPrice: d.originalPrice,
        remainingCount: d.remainingCount, imageUrl: item.imageUrl, restaurantId: idFor(store.key),
        menuItemId: idFor(`${store.key}/${item.key}`), isActive: true,
      }));
    }
    if (rows.length) await VaultItem.bulkCreate(rows, { ignoreDuplicates: true });
    out.deals = rows.length;
    await done('deals', { deals: out.deals });
  }
  // PG stays: owned like an admin-made PG (pgRoutes: the admin who adds it) by the first admin, else by a tester.
  const PGHostel = M('PGHostel');
  const PGRoom = M('PGRoom');
  const User = M('User');
  if (PGHostel && PGRoom && User && PGHostel.rawAttributes.isTestData && (data.pgs || []).length && !(await GlobalConfig.findOne({ where: { key: marker('pgs') } }))) {
    const admin = await User.findOne({ where: { role: 'admin' }, order: [['createdAt', 'ASC']], attributes: ['id'] });
    let ownerId = admin && admin.id;
    if (!ownerId) {
      const tv = require('../utils/testView');
      await tv.loadTesters({ fresh: true });
      [ownerId] = tv.testerUserIds();
    }
    if (ownerId) {
      const pg = require('../utils/pgContent');
      const hostels = [];
      const rooms = [];
      for (const p of data.pgs) {
        const photos = await pg.validatePhotos(p.photos.map(({ credit, ...photo }) => photo));
        hostels.push(fieldsOf(PGHostel, {
          id: idFor(p.key), isTestData: true, ownerId, name: p.name, address: p.address, area: p.area,
          distanceFromCollege: p.distanceFromCollege, genderType: p.genderType, baseRent: p.baseRent,
          securityDeposit: p.securityDeposit, totalRooms: p.totalRooms, amenities: p.amenities, description: p.description,
          photos, images: pg.imagesFromPhotos(photos), messTimetable: pg.validateMessTimetable(p.mess),
          highlights: pg.validateHighlights(p.highlights), houseRules: pg.validateHouseRules(p.houseRules),
          isActive: true, isVerified: false,
        }));
        for (const room of p.rooms) {
          rooms.push(fieldsOf(PGRoom, { id: idFor(`${p.key}/${room.roomNumber}`), isTestData: true, hostelId: idFor(p.key), ...room, securityDeposit: p.securityDeposit, isActive: true }));
        }
      }
      await PGHostel.bulkCreate(hostels, { ignoreDuplicates: true });
      await PGRoom.bulkCreate(rooms, { ignoreDuplicates: true });
      out.pgs = hostels.length;
      await done('pgs', { pgs: hostels.length, rooms: rooms.length });
    }
  }

  // Co-Ride: rides for the next five days, hosted by the tester accounts themselves (no other account is made); a
  // tester sees the rides of the other testers. Topped up on every run (rides drop out once they leave).
  const BikePool = M('BikePool');
  if (BikePool && BikePool.rawAttributes.isTestData && (data.rides || []).length) {
    const tv = require('../utils/testView');
    await tv.loadTesters({ fresh: true });
    const hosts = tv.testerUserIds();
    if (hosts.length) {
      const rows = [];
      for (let day = 1; day <= 5; day += 1) {
        const date = new Date(Date.now() + 330 * 60 * 1000 + day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        data.rides.forEach((ride, i) => rows.push(fieldsOf(BikePool, {
          id: idFor(`ride:${date}:${ride.slot}`), isTestData: true, creatorId: hosts[(day + i) % hosts.length], creatorRole: 'rider',
          origin: ride.origin, destination: ride.destination, departureTime: new Date(`${date}T${ride.time}:00+05:30`),
          vehicleType: ride.vehicleType, availableSeats: ride.availableSeats, splitAmount: ride.splitAmount,
          vehicleInfo: ride.vehicleInfo, notes: ride.notes, status: 'Available', womenOnly: false,
        })));
      }
      const before = await BikePool.count({ where: { isTestData: true }, hooks: false });
      await BikePool.bulkCreate(rows, { ignoreDuplicates: true });
      out.rides = (await BikePool.count({ where: { isTestData: true }, hooks: false })) - before;
    }
  }
  if (out.stores || out.deals || out.pgs || out.rides) console.log(`🧪 [TEST_DATA_V2] Added ${out.stores} stores, ${out.items} items, ${out.deals} deals, ${out.pgs || 0} PGs, ${out.rides || 0} rides (owner-only, ${reason}).`);
  return out;
};

/** Counts of the test rows (unfiltered) for Admin > Config > Test data. */
const testDataStatus = async () => {
  const M = modelsOf();
  const GlobalConfig = M('GlobalConfig');
  const count = async (name) => {
    const Model = M(name);
    if (!Model || !Model.rawAttributes.isTestData) return 0;
    return Model.count({ where: { isTestData: true }, hooks: false });
  };
  const testView = require('../utils/testView');
  const t = await testView.loadTesters();
  const removed = GlobalConfig ? await GlobalConfig.findOne({ where: { key: REMOVED } }) : null;
  return {
    phones: [...t.phones],
    matched: { customers: t.userIds.size, riders: t.riderIds.size },
    removed: removed ? removed.value : null,
    counts: {
      stores: await count('Restaurant'), items: await count('MenuItem'), deals: await count('VaultItem'), orders: await count('Order'),
      pgs: await count('PGHostel'), rides: await count('BikePool'), vehicles: await count('RentalListing'), events: await count('CeEvent'),
    },
  };
};

/**
 * Removes every test row: open test orders are cancelled and refunded through the normal path first, then the test
 * orders and their rows, deals, coupons, items, stores and the other sections' test rows are deleted, and the seed
 * is kept from adding them again.
 */
const removeTestDataV2 = async ({ by = 'admin' } = {}) => {
  const M = modelsOf();
  const GlobalConfig = M('GlobalConfig');
  const Restaurant = M('Restaurant');
  const Order = M('Order');
  if (!GlobalConfig || !Restaurant || !Order || !Restaurant.rawAttributes.isTestData) return { skipped: 'models not ready' };
  const out = { ordersCancelled: 0, removed: {}, errors: [] };
  const step = async (label, run) => {
    try { out.removed[label] = await run(); } catch (err) { out.errors.push(`${label}: ${String(err.message).slice(0, 120)}`); }
  };
  const inChunks = async (ids, run) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 500) n += Number(await run(ids.slice(i, i + 500))) || 0;
    return n;
  };
  const idsOf = async (Model, where) => (Model ? (await Model.findAll({ where, attributes: ['id'], hooks: false, raw: true })).map((r) => r.id) : []);

  const storeIds = await idsOf(Restaurant, { isTestData: true });
  const orderWhere = { [Op.or]: [{ isTestData: true }, ...(storeIds.length ? [{ restaurantId: { [Op.in]: storeIds } }] : [])] };
  const { cancelAndRefund } = require('../controllers/orderController');
  const open = await Order.findAll({ where: { ...orderWhere, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } }, hooks: false });
  for (const order of open) {
    try {
      const { cancelled } = await cancelAndRefund(order, { reason: 'ZCS test data was removed', by: 'system' });
      if (cancelled) out.ordersCancelled += 1;
    } catch (err) {
      out.errors.push(`cancel ${order.id}: ${String(err.message).slice(0, 80)}`);
    }
  }
  const orderIds = await idsOf(Order, orderWhere);
  if (orderIds.length) {
    const ids = orderIds.map(String);
    if (M('OrderMessage')) await step('orderMessages', () => inChunks(orderIds, (c) => M('OrderMessage').destroy({ where: { orderId: { [Op.in]: c } } })));
    if (M('ProductReview')) await step('productReviews', () => inChunks(ids, (c) => M('ProductReview').destroy({ where: { orderId: { [Op.in]: c } } })));
    if (M('RiderCashEntry')) await step('riderCashEntries', () => inChunks(ids, (c) => M('RiderCashEntry').destroy({ where: { orderId: { [Op.in]: c } } })));
    if (M('Notification')) await step('notifications', () => inChunks(ids, (c) => M('Notification').destroy({ where: { orderId: { [Op.in]: c } } })));
    if (M('Ticket')) await step('ticketsUnlinked', () => inChunks(orderIds, (c) => M('Ticket').update({ orderId: null }, { where: { orderId: { [Op.in]: c } } }).then(([n]) => n)));
    if (M('DeliveryPartner')) await step('ridersFreed', () => inChunks(orderIds, (c) => M('DeliveryPartner').update({ currentOrderId: null }, { where: { currentOrderId: { [Op.in]: c } } }).then(([n]) => n)));
    await step('orders', () => inChunks(orderIds, (c) => Order.destroy({ where: { id: { [Op.in]: c } } })));
  }
  const byStore = (Model, extra = {}) => ({ [Op.or]: [...(Model && Model.rawAttributes.isTestData ? [{ isTestData: true }] : []), ...(storeIds.length ? [{ restaurantId: { [Op.in]: storeIds } }] : [])], ...extra });
  if (M('VaultItem')) await step('deals', () => M('VaultItem').destroy({ where: byStore(M('VaultItem')) }));
  if (M('Coupon') && storeIds.length) await step('coupons', () => inChunks(storeIds, (c) => M('Coupon').destroy({ where: { restaurantId: { [Op.in]: c } } })));
  if (M('SplashAd') && storeIds.length) await step('splashAds', () => inChunks(storeIds, (c) => M('SplashAd').destroy({ where: { restaurantId: { [Op.in]: c } } })));
  if (M('MenuItem')) await step('items', () => M('MenuItem').destroy({ where: byStore(M('MenuItem')) }));
  if (M('Payout') && storeIds.length) await step('storePayouts', () => inChunks(storeIds.map(String), (c) => M('Payout').destroy({ where: { partnerType: { [Op.in]: ['restaurant', 'vendor'] }, partnerId: { [Op.in]: c } } })));
  if (storeIds.length) await step('stores', () => inChunks(storeIds, (c) => Restaurant.destroy({ where: { id: { [Op.in]: c } } })));

  // Other sections' test rows, children first.
  const pgIds = await idsOf(M('PGHostel'), { isTestData: true });
  if (pgIds.length) {
    for (const name of ['PGReview', 'PGBooking']) if (M(name)) await step(name, () => M(name).destroy({ where: { hostelId: { [Op.in]: pgIds } } }));
    if (M('PgOwnerListing')) await step('pgOwnerLinks', () => M('PgOwnerListing').destroy({ where: { hostelId: { [Op.in]: pgIds } } }));
    if (M('PGRoom')) await step('pgRooms', () => M('PGRoom').destroy({ where: { hostelId: { [Op.in]: pgIds } } }));
    await step('pgs', () => M('PGHostel').destroy({ where: { id: { [Op.in]: pgIds } } }));
  }
  const rideIds = await idsOf(M('BikePool'), { isTestData: true });
  if (rideIds.length) {
    if (M('PoolRequest')) await step('rideRequests', () => M('PoolRequest').destroy({ where: { poolId: { [Op.in]: rideIds } } }));
    await step('rides', () => M('BikePool').destroy({ where: { id: { [Op.in]: rideIds } } }));
  }
  const vehicleIds = await idsOf(M('RentalListing'), { isTestData: true });
  if (vehicleIds.length) {
    for (const name of ['RentalReview', 'RentalReport', 'RentalBooking']) if (M(name) && M(name).rawAttributes.listingId) await step(name, () => M(name).destroy({ where: { listingId: { [Op.in]: vehicleIds } } }));
    await step('vehicles', () => M('RentalListing').destroy({ where: { id: { [Op.in]: vehicleIds } } }));
  }
  const eventIds = await idsOf(M('CeEvent'), { isTestData: true });
  if (eventIds.length) {
    for (const name of ['CeTicket', 'CeRegistration', 'CeTeamMember', 'CeTeam', 'CeSlot']) if (M(name) && M(name).rawAttributes.eventId) await step(name, () => M(name).destroy({ where: { eventId: { [Op.in]: eventIds } } }));
    await step('events', () => M('CeEvent').destroy({ where: { id: { [Op.in]: eventIds } } }));
  }

  await GlobalConfig.upsert({ key: REMOVED, value: { at: new Date().toISOString(), by, ...out }, description: 'Owner-only test data removed; the seed will not add it again' });
  try { require('../utils/responseCache').invalidateAll(); } catch { /* caches expire on their own */ }
  console.log(`🧹 [TEST_DATA_V2] Removed the owner-only test data (${by}):`, JSON.stringify(out.removed), out.errors.length ? out.errors : '');
  return out;
};

/** Lets the seed add the test data again after a removal (Admin > Config > Test data > Add again). */
const allowTestDataV2Again = async () => {
  const M = modelsOf();
  const GlobalConfig = M('GlobalConfig');
  if (!GlobalConfig) return { skipped: 'models not ready' };
  await GlobalConfig.destroy({ where: { key: { [Op.in]: [REMOVED, marker('stores'), marker('deals'), marker('pgs')] } } });
  return runTestDataV2Seed({ reason: 'added again' });
};

module.exports = { runTestDataV2Seed, removeTestDataV2, allowTestDataV2Again, testDataStatus, idFor, REMOVED };
