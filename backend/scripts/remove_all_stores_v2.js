// Full clean of the test stores (runs on startup from server.js, once per database, after remove_all_stores_v1).
//
// Owner, 28 Oct 2026: "I DON'T NEEDED ANY BACKUP OF RESTURENTS BUDDY, JUST CLEAN IT AND MAKE IT CLEAN CAUSE IM
// ADDING FRESH AND REAL DATA MANUALLY" and, asked whether the old test orders may go too: "Yes, delete all".
// v1 deleted every store without orders and switched off the ones with test orders. This removes the rest:
//  - every remaining store, its menu items, coupons, vault items and store payouts;
//  - every order of those stores (all test orders) and what hangs off them: order chat messages, product reviews,
//    rider cash entries, order notifications; support tickets keep existing but lose the order link; riders whose
//    currentOrderId pointed at one get null;
//  - the v1 backup tables (_zcs_backup_*_20261028).
// GlobalConfig marker REMOVE_ALL_STORES_V2_DONE (with the counts). DISABLE_REMOVE_ALL_STORES=true turns it off.
const { Op } = require('sequelize');

const MARKER = 'REMOVE_ALL_STORES_V2_DONE';
const BACKUP_TABLES = ['_zcs_backup_restaurants_20261028', '_zcs_backup_menuitems_20261028', '_zcs_backup_splashads_20261028'];

const runRemoveAllStoresV2 = async () => {
  if (String(process.env.DISABLE_REMOVE_ALL_STORES || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const Restaurant = M('Restaurant');
  const Order = M('Order');
  if (!sequelize || !GlobalConfig || !Restaurant || !Order) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };
  // Only after v1 (which cancelled open orders and refunded Wallets).
  if (!(await GlobalConfig.findOne({ where: { key: 'REMOVE_ALL_STORES_V1_DONE' } }))) return { skipped: 'v1 not done yet' };

  const storeIds = (await Restaurant.findAll({ attributes: ['id'], raw: true })).map((r) => r.id);
  const orderIds = storeIds.length
    ? (await Order.findAll({ attributes: ['id'], where: { restaurantId: { [Op.in]: storeIds } }, raw: true })).map((o) => o.id)
    : [];
  const out = { stores: storeIds.length, orders: orderIds.length, removed: {}, errors: [] };
  const step = async (label, fn) => {
    try { out.removed[label] = await fn(); } catch (err) { out.errors.push(`${label}: ${String(err.message).slice(0, 120)}`); }
  };
  const inChunks = async (ids, fn) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 500) n += Number(await fn(ids.slice(i, i + 500))) || 0;
    return n;
  };

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
  if (storeIds.length) {
    if (M('MenuItem')) await step('menuItems', () => inChunks(storeIds, (c) => M('MenuItem').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('Coupon')) await step('coupons', () => inChunks(storeIds, (c) => M('Coupon').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('VaultItem')) await step('vaultItems', () => inChunks(storeIds, (c) => M('VaultItem').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    if (M('SplashAd')) await step('splashAds', () => inChunks(storeIds, (c) => M('SplashAd').destroy({ where: { restaurantId: { [Op.in]: c } } })));
    // Store payout statements of the test stores (rider statements stay: riders are kept).
    if (M('Payout')) await step('payouts', () => inChunks(storeIds.map(String), (c) => M('Payout').destroy({ where: { partnerType: { [Op.in]: ['restaurant', 'vendor'] }, partnerId: { [Op.in]: c } } })));
    await step('stores', () => inChunks(storeIds, (c) => Restaurant.destroy({ where: { id: { [Op.in]: c } } })));
  }
  for (const t of BACKUP_TABLES) await step(`drop ${t}`, () => sequelize.query(`DROP TABLE IF EXISTS "${t}"`).then(() => 1));

  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), stores: out.stores, orders: out.orders, errors: out.errors.length }) });
  try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* ignore */ }
  return out;
};

module.exports = { runRemoveAllStoresV2, MARKER };
