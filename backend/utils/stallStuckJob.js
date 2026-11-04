// Stall (CampusBites vendor-delivered) orders that stay Accepted / OutForDelivery for hours.
// They are never auto-cancelled (the stall may really have handed the food over and only forgot to tap
// Delivered, cash in hand), so instead this job FLAGS them once (Orders.stuckFlaggedAt) and tells the
// admins (socket + push) and the stall (socket + push) so a human closes them out.
//
// Single-runner safe: on Postgres the run holds a transaction-level advisory lock (two server instances
// never flag / notify the same batch); SQLite (local / tests, one process) skips the lock and relies on the
// in-process guard below. The flag itself
// is a conditional update (stuckFlaggedAt IS NULL), so even without the lock nobody is notified twice.
// Times in the messages are IST (campus time), not the server's UTC.
const { Op } = require('sequelize');

const STUCK_HOURS = Math.min(72, Math.max(1, Number(process.env.STALL_STUCK_HOURS) || 6));
const STUCK_STATUSES = ['Accepted', 'OutForDelivery'];
const LOCK_KEY = 74230611; // arbitrary, unique to this job
const BATCH = 50;

const istClock = (d) => {
  try {
    return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return new Date(d).toISOString();
  }
};

// Where clause for "stall order open longer than `hours`" (also used by the admin orders filter / counts).
// Delivery slots: a slot order is counted from the END of its slot (a next-day order is not "stuck" overnight).
const stuckStallWhere = (hours = STUCK_HOURS, now = Date.now()) => {
  const cutoff = new Date(now - hours * 3600 * 1000);
  return {
    fulfilment: 'VENDOR',
    status: { [Op.in]: STUCK_STATUSES },
    createdAt: { [Op.lt]: cutoff },
    [Op.or]: [{ slotEnd: null }, { slotEnd: { [Op.lt]: cutoff } }],
  };
};

// One run at a time in this process (SQLite has no advisory lock, and two overlapping SQLite write
// transactions fail with SQLITE_BUSY): a call while a run is in flight returns 0.
let inFlight = false;

// Returns the number of orders newly flagged.
const flagStuckStallOrders = async (io, opts = {}) => {
  if (inFlight) return 0;
  inFlight = true;
  try {
    return await flagStuckStallOrdersOnce(io, opts);
  } finally {
    inFlight = false;
  }
};

const flagStuckStallOrdersOnce = async (io, { now = Date.now() } = {}) => {
  const { getOrderModel } = require('../models/Order');
  const { getSequelize } = require('../config/db');
  const Order = getOrderModel();
  const sequelize = getSequelize();
  if (!Order || !sequelize) return 0;
  const isPg = sequelize.getDialect() === 'postgres';

  const flagged = await sequelize.transaction(async (t) => {
    if (isPg) {
      const [rows] = await sequelize.query('SELECT pg_try_advisory_xact_lock(:k) AS got', { replacements: { k: LOCK_KEY }, transaction: t });
      if (!rows || !rows[0] || !rows[0].got) return []; // another instance is running this job
    }
    const candidates = await Order.findAll({
      where: { ...stuckStallWhere(STUCK_HOURS, now), stuckFlaggedAt: null },
      attributes: ['id', 'restaurantId', 'status', 'createdAt', 'finalPrice', 'totalPrice', 'paymentMethod'],
      order: [['createdAt', 'ASC']],
      limit: BATCH,
      transaction: t,
    });
    const out = [];
    for (const o of candidates) {
      const [n] = await Order.update(
        { stuckFlaggedAt: new Date(now) },
        { where: { id: o.id, stuckFlaggedAt: null, status: { [Op.in]: STUCK_STATUSES } }, transaction: t, silent: true }
      );
      if (n) out.push(o);
    }
    return out;
  });
  if (!flagged.length) return 0;

  // Notifications after the commit (never inside the lock / transaction).
  const realtime = require('./realtime');
  const { pushToStore } = require('./storePush');
  const byStore = new Map();
  for (const o of flagged) {
    const payload = {
      orderId: o.id, restaurantId: o.restaurantId, status: o.status, hours: STUCK_HOURS,
      createdAt: o.createdAt, placedAtIST: istClock(o.createdAt),
    };
    if (io) {
      io.to('admin-room').emit('stallOrderStuck', payload);
      if (o.restaurantId) io.to(`restaurant_${o.restaurantId}`).emit('stallOrderStuck', payload);
    }
    realtime.notifyAdmin('order', 'updated', o.id);
    if (o.restaurantId) {
      if (!byStore.has(o.restaurantId)) byStore.set(o.restaurantId, []);
      byStore.get(o.restaurantId).push(o);
    }
  }
  for (const [rid, list] of byStore) {
    const first = list[0];
    const body = list.length === 1
      ? `An order from ${istClock(first.createdAt)} is still open. Mark it Delivered if you handed it over, or call ZENV support.`
      : `${list.length} orders (oldest ${istClock(first.createdAt)}) are still open. Mark them Delivered if handed over, or call ZENV support.`;
    await pushToStore(rid, 'Order still open', body, { type: 'ORDER_STUCK', orderId: String(first.id) });
  }
  try {
    const { getUserModel } = require('../models/User');
    const admins = await getUserModel().findAll({ where: { role: 'admin', isActive: { [Op.ne]: false } }, attributes: ['id', 'fcmTokens'] });
    const tokens = admins.flatMap((a) => (Array.isArray(a.fcmTokens) ? a.fcmTokens : []));
    if (tokens.length) {
      const { sendPushToTokens } = require('./push');
      await sendPushToTokens(
        tokens,
        '⏳ Stall orders stuck',
        `${flagged.length} stall order${flagged.length === 1 ? '' : 's'} open for over ${STUCK_HOURS} h (oldest from ${istClock(flagged[0].createdAt)} IST).`,
        { type: 'STALL_ORDER_STUCK', orderId: String(flagged[0].id) },
        { recipients: admins.map((a) => a.id) }
      );
    }
  } catch (err) {
    console.warn('[STALL_STUCK_ADMIN_PUSH_WARN]', err.message);
  }
  console.log(`[STALL_STUCK] Flagged ${flagged.length} stall order(s) open > ${STUCK_HOURS} h`);
  return flagged.length;
};

module.exports = { flagStuckStallOrders, stuckStallWhere, STUCK_HOURS, STUCK_STATUSES };
