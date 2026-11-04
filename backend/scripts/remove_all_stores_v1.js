// Remove every store (runs on startup from server.js, once per database).
//
// Owner, 28 Oct 2026: "REMOVE ALL MOCK DATA BUDDY FROM DB, IM ENTERING REAL DATA NOW" / "147 REMOVE ALL
// RESTURENTS". Every Restaurant row (restaurants, shops, demo stalls, test partner stores) leaves the app, so the
// owner starts from an empty store list and enters real stores from the admin dashboard.
//  1. Backup first: full copies of Restaurants, MenuItems and SplashAds in "_zcs_backup_*_20261028" tables (same
//     database), so any store / item can be restored by hand.
//  2. Open orders of those stores are cancelled the normal way (orderController.cancelAndRefund: Wallet refunds).
//  3. Splash ads on those stores are deleted (an ad needs its store).
//  4. A store with no orders is deleted with its menu items (what admin > Delete does). A store WITH past orders is
//     switched off and hidden instead (isActive false, menu items unavailable): orders must keep their store (the
//     column is NOT NULL), so deleting it would fail or take the order history with it.
//  5. The GlobalConfig marker REMOVE_ALL_STORES_V1_DONE (with the counts) also tells the catalogue / demo imports
//     never to create stores again (server.js checks realDataOnly() before running them).
// DISABLE_REMOVE_ALL_STORES=true turns it off. Delete the marker to run it again.
const { Op } = require('sequelize');

const MARKER = 'REMOVE_ALL_STORES_V1_DONE';
const BACKUP_SUFFIX = '20261028';

const realDataOnly = async () => {
  try {
    const { getGlobalConfigModel } = require('../models/GlobalConfig');
    const GlobalConfig = getGlobalConfigModel();
    return !!(GlobalConfig && await GlobalConfig.findOne({ where: { key: MARKER } }));
  } catch {
    return false;
  }
};

const runRemoveAllStores = async ({ io = null } = {}) => {
  if (String(process.env.DISABLE_REMOVE_ALL_STORES || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const { getRestaurantModel } = require('../models/Restaurant');
  const { getMenuItemModel } = require('../models/MenuItem');
  const { getOrderModel } = require('../models/Order');
  const { getSplashAdModel } = require('../models/SplashAd');
  const sequelize = getSequelize();
  const GlobalConfig = getGlobalConfigModel();
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const Order = getOrderModel();
  const SplashAd = getSplashAdModel();
  if (!sequelize || !GlobalConfig || !Restaurant || !MenuItem || !Order) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };

  // 1. Backups (whole tables, before anything changes). No backup = nothing is removed.
  const backups = [];
  for (const [table, model] of [['Restaurants', Restaurant], ['MenuItems', MenuItem], ['SplashAds', SplashAd]]) {
    if (!model) continue;
    const name = `_zcs_backup_${table.toLowerCase()}_${BACKUP_SUFFIX}`;
    try {
      await sequelize.query(`DROP TABLE IF EXISTS "${name}"`);
      await sequelize.query(`CREATE TABLE "${name}" AS SELECT * FROM "${model.getTableName()}"`);
      const [[{ n }]] = await sequelize.query(`SELECT COUNT(*) AS n FROM "${name}"`);
      backups.push({ table: name, rows: Number(n) });
    } catch (err) {
      console.error(`[REMOVE_ALL_STORES] backup of ${table} failed, nothing removed:`, err.message);
      return { skipped: `backup of ${table} failed: ${err.message}` };
    }
  }

  const stores = await Restaurant.findAll({ attributes: ['id', 'name'] });
  const ids = stores.map((s) => s.id);
  const result = { stores: ids.length, backups, ordersCancelled: 0, adsDeleted: 0, deleted: 0, hidden: 0, failed: [] };

  // 2. Open orders: cancelled + refunded like any cancel (the customer is told by the normal cancel paths).
  const { cancelAndRefund } = require('../controllers/orderController');
  const open = ids.length ? await Order.findAll({ where: { restaurantId: { [Op.in]: ids }, status: { [Op.notIn]: ['Delivered', 'Cancelled'] } } }) : [];
  for (const order of open) {
    try {
      const { cancelled } = await cancelAndRefund(order, { reason: 'This store was removed from ZenWe', by: 'system' });
      if (cancelled) result.ordersCancelled++;
    } catch (err) {
      console.warn('[REMOVE_ALL_STORES] cancel failed', order.id, err.message);
    }
  }

  // 3. Splash ads on these stores.
  if (SplashAd && ids.length) result.adsDeleted = await SplashAd.destroy({ where: { restaurantId: { [Op.in]: ids } } });

  // 4. Delete stores without orders; hide stores with order history.
  const withOrders = new Set();
  if (ids.length) {
    const rows = await Order.findAll({ attributes: ['restaurantId'], where: { restaurantId: { [Op.in]: ids } }, group: ['restaurantId'], raw: true });
    rows.forEach((r) => withOrders.add(String(r.restaurantId)));
  }
  for (const store of stores) {
    try {
      if (withOrders.has(String(store.id))) {
        await MenuItem.update({ isAvailable: false }, { where: { restaurantId: store.id } });
        await Restaurant.update({ isActive: false }, { where: { id: store.id } });
        result.hidden++;
      } else {
        await sequelize.transaction(async (t) => {
          await MenuItem.destroy({ where: { restaurantId: store.id }, transaction: t });
          await Restaurant.destroy({ where: { id: store.id }, transaction: t });
        });
        result.deleted++;
      }
    } catch (err) {
      // Something else still points at it: switch it off instead, never leave it live.
      try {
        await Restaurant.update({ isActive: false }, { where: { id: store.id } });
        await MenuItem.update({ isAvailable: false }, { where: { restaurantId: store.id } });
        result.hidden++;
      } catch { /* reported below */ }
      result.failed.push({ id: store.id, name: store.name, error: String(err.message).slice(0, 120) });
    }
  }

  // 5. Marker (also stops the catalogue / demo imports from creating stores again).
  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), ...result, failed: result.failed.length }) });
  try { require('../controllers/adminController').clearRestaurantsCache(); } catch { /* ignore */ }
  try { require('../utils/realtime').publish('store', 'deleted', 'all', {}); } catch { /* ignore */ }
  return result;
};

module.exports = { runRemoveAllStores, realDataOnly, MARKER };
