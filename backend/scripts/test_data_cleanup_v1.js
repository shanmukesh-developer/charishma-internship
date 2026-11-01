// Test data clean-up, once (GlobalConfig TEST_DATA_CLEANUP_V1_DONE). Owner, 1 Nov 2026 evening: "remove all test
// data", "only keep the entered data", "amrutham, nescafe and pickles for now these are real data".
// Only rows that are sure to be test data are touched, never a store or account the owner entered:
//  1. Test stores: the stores the test data seed created (ledger 'test-store') and any store still named "ZCS Test ..."
//     (the 27 Oct partner test stores, if one survived). A renamed one is the owner's and stays. Open orders on them
//     are cancelled and refunded through the normal cancel path first; then their orders (test orders) with the rows
//     that hang off those orders, their items, coupons, saved items, splash ads, store payouts and the stores go,
//     in the same order as scripts/remove_all_stores_v2.
//  2. Partner test logins from scripts/partner_test_accounts_seed.js (marker PARTNER_TEST_ACCOUNTS_V1_DONE ids, or
//     the seed's test phone numbers), only while the name still starts with "ZCS Test": the rider, the auto driver
//     and auto, the PG owner, the "ZCS Test PG" listing and its rooms. Deleted when nothing else points at them;
//     otherwise switched off (sign-in refused, not listed). These logins had published password hashes.
// The test data seed itself no longer runs on startup (server.js). DISABLE_TEST_DATA_CLEANUP=true switches it off.
const { Op, fn, col, where: sqlWhere } = require('sequelize');

const MARKER = 'TEST_DATA_CLEANUP_V1_DONE';
const TEST_NAME = /^zcs test /i;
// scripts/partner_test_accounts_seed data file: rider, auto driver, PG owner.
const TEST_PHONES = ['6000000101', '6000000105', '6000000106'];

const parse = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { const x = JSON.parse(v); return typeof x === 'string' ? JSON.parse(x) : (x || {}); } catch { return {}; }
};

const runTestDataCleanup = async () => {
  if (String(process.env.DISABLE_TEST_DATA_CLEANUP || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const Restaurant = M('Restaurant');
  const Order = M('Order');
  if (!sequelize || !GlobalConfig || !Restaurant || !Order) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };
  if (!(await GlobalConfig.findOne({ where: { key: 'REMOVE_ALL_STORES_V2_DONE' } }))) return { skipped: 'store removal not finished' };

  const out = { stores: 0, kept: 0, ordersCancelled: 0, orders: 0, removed: {}, accounts: {}, errors: [] };
  const step = async (label, run) => {
    try { out.removed[label] = await run(); } catch (err) { out.errors.push(`${label}: ${String(err.message).slice(0, 120)}`); }
  };
  const inChunks = async (ids, run) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 500) n += Number(await run(ids.slice(i, i + 500))) || 0;
    return n;
  };

  // ── 1. Test stores ──────────────────────────────────────────────────────────────────────────────
  const Ledger = M('CatalogueImportLedger');
  const ledgerIds = Ledger ? (await Ledger.findAll({ where: { kind: 'test-store' }, attributes: ['targetId'], raw: true })).map((r) => r.targetId) : [];
  const found = await Restaurant.findAll({
    where: { [Op.or]: [...(ledgerIds.length ? [{ id: { [Op.in]: ledgerIds } }] : []), sqlWhere(fn('lower', col('name')), { [Op.like]: 'zcs test %' })] },
    attributes: ['id', 'name'],
  });
  const stores = found.filter((s) => TEST_NAME.test(String(s.name || '')));
  out.kept = found.length - stores.length;
  out.stores = stores.length;
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length) {
    const { cancelAndRefund } = require('../controllers/orderController');
    const open = await Order.findAll({ where: { restaurantId: { [Op.in]: storeIds }, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } });
    for (const order of open) {
      try {
        const { cancelled } = await cancelAndRefund(order, { reason: 'This test store was removed from ZCS', by: 'system' });
        if (cancelled) out.ordersCancelled++;
      } catch (err) {
        out.errors.push(`cancel ${order.id}: ${String(err.message).slice(0, 80)}`);
      }
    }
    const orderIds = (await Order.findAll({ attributes: ['id'], where: { restaurantId: { [Op.in]: storeIds } }, raw: true })).map((o) => o.id);
    out.orders = orderIds.length;
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
    if (M('MenuItem')) await step('menuItems', () => inChunks(storeIds, (c) => M('MenuItem').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('Coupon')) await step('coupons', () => inChunks(storeIds, (c) => M('Coupon').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('VaultItem')) await step('vaultItems', () => inChunks(storeIds, (c) => M('VaultItem').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('SplashAd')) await step('splashAds', () => inChunks(storeIds, (c) => M('SplashAd').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('Payout')) await step('storePayouts', () => inChunks(storeIds.map(String), (c) => M('Payout').destroy({ where: { partnerType: { [Op.in]: ['restaurant', 'vendor'] }, partnerId: { [Op.in]: c } } })));
    await step('stores', () => inChunks(storeIds, (c) => Restaurant.destroy({ where: { id: { [Op.in]: c } } })));
  }

  // ── 2. Partner test logins ──────────────────────────────────────────────────────────────────────
  const seeded = parse((await GlobalConfig.findOne({ where: { key: 'PARTNER_TEST_ACCOUNTS_V1_DONE' } }) || {}).value);
  const created = seeded.created || {};
  const testRows = async (Model, ids, extraWhere = {}) => {
    if (!Model) return [];
    const or = [{ phone: { [Op.in]: TEST_PHONES }, ...extraWhere }];
    const known = ids.filter(Boolean);
    if (known.length) or.push({ id: { [Op.in]: known } });
    return (await Model.findAll({ where: { [Op.or]: or } })).filter((r) => TEST_NAME.test(String(r.name || '')));
  };
  const count = async (Model, where) => (Model ? Model.count({ where }) : 0);
  const account = async (label, run) => {
    try { out.accounts[label] = await run(); } catch (err) { out.errors.push(`${label}: ${String(err.message).slice(0, 120)}`); }
  };

  // Rider: deleted when no order, cash entry or payout statement points at it; else deactivated (C1-7 hook: the
  // login is refused and older tokens stop working).
  const DeliveryPartner = M('DeliveryPartner');
  for (const rider of await testRows(DeliveryPartner, [created.rider])) {
    await account(`rider ${rider.name}`, async () => {
      const refs = (await count(Order, { deliveryPartnerId: rider.id })) + (await count(M('RiderCashEntry'), { riderId: rider.id }))
        + (await count(M('Payout'), { partnerType: 'rider', partnerId: String(rider.id) }));
      if (!refs) { await rider.destroy(); return 'deleted'; }
      await rider.update({ isApproved: false, isOnline: false, isAvailable: false, fcmTokens: [], suspendedAt: rider.suspendedAt || new Date() });
      return 'switched off';
    });
  }

  // Auto driver + autos: deleted when no trip or private request points at the driver; else suspended.
  const autoRide = require('../modules/autoRide');
  const AutoDriver = autoRide.getModel('AutoDriver');
  const AutoVehicle = autoRide.getModel('AutoVehicle');
  for (const driver of await testRows(AutoDriver, [created.autoDriver && created.autoDriver.driverId])) {
    await account(`auto driver ${driver.name}`, async () => {
      const refs = (await count(autoRide.getModel('AutoTrip'), { driverId: driver.id })) + (await count(autoRide.getModel('AutoPrivateRequest'), { driverId: driver.id }));
      if (!refs) {
        await sequelize.transaction(async (t) => {
          if (AutoVehicle) await AutoVehicle.destroy({ where: { driverId: driver.id }, transaction: t });
          await driver.destroy({ transaction: t });
        });
        return 'deleted';
      }
      if (AutoVehicle) await AutoVehicle.update({ status: 'SUSPENDED' }, { where: { driverId: driver.id } });
      await driver.update({ status: 'SUSPENDED', isOnline: false, fcmTokens: [], tokenVersion: (Number(driver.tokenVersion) || 0) + 1 });
      return 'suspended';
    });
  }

  // PG listing + rooms (deleted when no booking, review, rent record or complaint points at it; else hidden), then the
  // PG owner (deleted when no listing is left; else suspended).
  const pgOwner = require('../modules/pgOwner');
  const PgOwner = pgOwner.getModel('PgOwner');
  const PgOwnerListing = pgOwner.getModel('PgOwnerListing');
  const PGHostel = M('PGHostel');
  const hostelIds = [created.pgOwner && created.pgOwner.hostelId].filter(Boolean);
  const hostels = PGHostel ? (await PGHostel.findAll({
    where: { [Op.or]: [...(hostelIds.length ? [{ id: { [Op.in]: hostelIds } }] : []), sqlWhere(fn('lower', col('name')), 'zcs test pg')] },
  })).filter((h) => TEST_NAME.test(String(h.name || ''))) : [];
  for (const hostel of hostels) {
    await account(`pg ${hostel.name}`, async () => {
      const refs = (await count(M('PGBooking'), { hostelId: hostel.id })) + (await count(M('PGReview'), { hostelId: hostel.id }))
        + (await count(pgOwner.getModel('PgRentRecord'), { hostelId: hostel.id })) + (await count(pgOwner.getModel('PgComplaint'), { hostelId: hostel.id }));
      if (!refs) {
        await sequelize.transaction(async (t) => {
          if (M('PGRoom')) await M('PGRoom').destroy({ where: { hostelId: hostel.id }, transaction: t });
          if (PgOwnerListing) await PgOwnerListing.destroy({ where: { hostelId: hostel.id }, transaction: t });
          await hostel.destroy({ transaction: t });
        });
        return 'deleted';
      }
      await hostel.update({ isActive: false });
      return 'hidden';
    });
  }
  for (const owner of await testRows(PgOwner, [created.pgOwner && created.pgOwner.ownerId])) {
    await account(`pg owner ${owner.name}`, async () => {
      const listings = PgOwnerListing ? await PgOwnerListing.count({ where: { ownerId: owner.id } }) : 0;
      if (!listings) { await owner.destroy(); return 'deleted'; }
      await owner.update({ status: 'SUSPENDED', fcmTokens: [], tokenVersion: (Number(owner.tokenVersion) || 0) + 1 });
      return 'suspended';
    });
  }

  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), stores: out.stores, orders: out.orders, accounts: out.accounts, errors: out.errors.length }) });
  try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* cache just expires */ }
  return out;
};

module.exports = { runTestDataCleanup, MARKER };
