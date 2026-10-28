// One limit for everything a rider is carrying (owner, 28 Oct 2026: "there is no limit of taking or accepting
// order"). Food orders were capped at RIDER_MAX_ACTIVE_ORDERS (3), but shopping lists had no cap and service
// pickups only their own (5), and neither counted the other kinds, so one rider could hold 3 orders + every list
// + 5 pickups. Now every claim (order, shopping list, service pickup) counts all three together against
// RIDER_MAX_ACTIVE_JOBS (default: RIDER_MAX_ACTIVE_ORDERS, else 3).
const { Op } = require('sequelize');

const MAX_ACTIVE_JOBS = Math.max(1, parseInt(process.env.RIDER_MAX_ACTIVE_JOBS, 10) || parseInt(process.env.RIDER_MAX_ACTIVE_ORDERS, 10) || 3);

/**
 * Jobs this rider holds now: { orders, baskets, services, total }. `except` leaves one job out (a retried claim of
 * the same job must not count against itself). `transaction` keeps the count inside a caller's lock.
 */
const activeJobs = async (riderId, { except = null, transaction = null } = {}) => {
  const tx = transaction ? { transaction } : {};
  const notThis = (kind) => (except && except.kind === kind && except.id ? { id: { [Op.ne]: except.id } } : {});
  const { getOrderModel } = require('../models/Order');
  const { getMegaBasketModel } = require('../models/MegaBasket');
  const { getServiceBookingModel } = require('../models/ServiceBooking');
  const Order = getOrderModel();
  const MegaBasket = getMegaBasketModel();
  const ServiceBooking = getServiceBookingModel();
  const [orders, baskets, services] = await Promise.all([
    Order ? Order.count({ where: { deliveryPartnerId: riderId, status: { [Op.notIn]: ['Delivered', 'Cancelled'] }, ...notThis('order') }, ...tx }) : 0,
    MegaBasket ? MegaBasket.count({ where: { deliveryPartnerId: riderId, status: { [Op.notIn]: ['Delivered', 'Cancelled'] }, ...notThis('basket') }, ...tx }) : 0,
    ServiceBooking ? ServiceBooking.count({ where: { assignedPartnerId: riderId, status: { [Op.notIn]: ['COMPLETED', 'CANCELLED'] }, ...notThis('service') }, ...tx }) : 0,
  ]);
  return { orders, baskets, services, total: orders + baskets + services };
};

/** The 409 body every claim answers when the rider is full (code MAX_ACTIVE, which rider apps already show). */
const fullBody = (load) => {
  const parts = [];
  if (load.orders) parts.push(`${load.orders} order${load.orders === 1 ? '' : 's'}`);
  if (load.baskets) parts.push(`${load.baskets} shopping list${load.baskets === 1 ? '' : 's'}`);
  if (load.services) parts.push(`${load.services} pickup${load.services === 1 ? '' : 's'}`);
  return {
    success: false,
    code: 'MAX_ACTIVE',
    maxActiveJobs: MAX_ACTIVE_JOBS,
    message: `You already have ${parts.join(', ') || `${load.total} jobs`} (${MAX_ACTIVE_JOBS} at a time). Finish one before taking another.`,
  };
};

module.exports = { MAX_ACTIVE_JOBS, activeJobs, fullBody };
