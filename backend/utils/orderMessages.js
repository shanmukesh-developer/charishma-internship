// C9: order chat persistence + order issue reports (socket 'sendMessage' / 'report_issue', server.js).
//
//  - Order chat messages are stored as OrderMessages rows { orderId, senderType, senderId, text <= 500 }.
//    Who may read / write an order's chat: the order's customer, its CURRENTLY assigned rider, admins.
//    (A rider taken off the order, a store, an Auto-Ride driver or a guest gets nothing.) The same rule
//    serves the socket events and GET /api/orders/:id/messages.
//  - Retention: ORDER_CHAT_RETENTION_DAYS (default 90, 1..3650). purgeOldOrderMessages() runs inside the
//    hourly 'retention.chatPulse' job (jobs/index.js) in small batches.
//  - report_issue creates a support Ticket (customer / admin -> userId, rider -> riderId, linked to the
//    order) and alerts the admins (socket 'admin_issue_reported' + admin push). At most
//    ISSUE_TICKETS_PER_HOUR tickets per reporter per order per hour (more reports are still relayed live).
const { Op } = require('sequelize');

const MAX_TEXT = 500;
const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH = 500;
const PURGE_MAX_BATCHES = 200;
const ISSUE_TICKETS_PER_HOUR = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Model getters (work in the app and in test harnesses that init the models on their own connection).
const GETTERS = {
  Order: () => require('../models/Order').getOrderModel(),
  MegaBasket: () => require('../models/MegaBasket').getMegaBasketModel(),
  OrderMessage: () => require('../models/OrderMessage').getOrderMessageModel(),
  Ticket: () => require('../models/Ticket').getTicketModel(),
  User: () => require('../models/User').getUserModel(),
  DeliveryPartner: () => require('../models/DeliveryPartner').getDeliveryPartnerModel(),
};
const model = (name) => {
  try {
    return GETTERS[name]() || null;
  } catch {
    return null;
  }
};

const retentionDays = () => {
  const n = Number(process.env.ORDER_CHAT_RETENTION_DAYS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.min(3650, Math.max(1, Math.floor(n)));
};

const roleOf = (actor) => String((actor && actor.role) || '').toLowerCase();

/** 'customer' | 'rider' | 'admin' for a socket / request user. */
const senderTypeFor = (actor) => {
  const r = roleOf(actor);
  if (r === 'rider') return 'rider';
  if (r === 'admin') return 'admin';
  return 'customer';
};

/** { kind, id, userId, deliveryPartnerId } of an Order or a Mega Basket, or null. */
const loadOrderParties = async (orderId) => {
  const id = String(orderId || '').trim();
  if (!UUID_RE.test(id)) return null;
  const Order = model('Order');
  const order = Order ? await Order.findByPk(id, { attributes: ['id', 'userId', 'deliveryPartnerId'] }) : null;
  if (order) return { kind: 'order', id: order.id, userId: order.userId, deliveryPartnerId: order.deliveryPartnerId || null };
  const MegaBasket = model('MegaBasket');
  const basket = MegaBasket ? await MegaBasket.findByPk(id, { attributes: ['id', 'userId', 'deliveryPartnerId'] }) : null;
  if (basket) return { kind: 'basket', id: basket.id, userId: basket.userId, deliveryPartnerId: basket.deliveryPartnerId || null };
  return null;
};

/** Customer of the order, its currently assigned rider, or an admin. */
const isOrderChatParty = (actor, parties) => {
  if (!actor || !actor.id || !parties) return false;
  const r = roleOf(actor);
  if (r === 'admin') return true;
  if (r === 'rider') return !!parties.deliveryPartnerId && String(parties.deliveryPartnerId) === String(actor.id);
  if (r === 'restaurant' || r === 'auto_driver' || r === 'guest' || actor.id === 'anonymous') return false;
  return !!parties.userId && String(parties.userId) === String(actor.id);
};

const canAccessOrderChat = async (actor, orderId) => {
  if (roleOf(actor) === 'admin' && actor.id) return true;
  try {
    return isOrderChatParty(actor, await loadOrderParties(orderId));
  } catch {
    return false;
  }
};

const cleanText = (raw) => (typeof raw === 'string' ? raw.trim().slice(0, MAX_TEXT) : '');

/** Stores one chat message. Never throws: resolves the row, or null when it could not be stored. */
const saveOrderMessage = async ({ orderId, actor, text }) => {
  const OrderMessage = model('OrderMessage');
  const body = cleanText(text);
  if (!OrderMessage || !body || !UUID_RE.test(String(orderId || '')) || !actor || !UUID_RE.test(String(actor.id || ''))) return null;
  try {
    return await OrderMessage.create({ orderId: String(orderId), senderType: senderTypeFor(actor), senderId: String(actor.id), text: body });
  } catch (err) {
    console.warn('[ORDER_CHAT_SAVE_WARN]', err && (err.parent?.code || err.name || err.message));
    return null;
  }
};

const nameCache = async (rows) => {
  const userIds = [...new Set(rows.filter((r) => r.senderType === 'customer').map((r) => r.senderId))];
  const riderIds = [...new Set(rows.filter((r) => r.senderType === 'rider').map((r) => r.senderId))];
  const names = new Map();
  const User = model('User');
  const Rider = model('DeliveryPartner');
  if (User && userIds.length) {
    for (const u of await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name'] })) names.set(`customer:${u.id}`, u.name);
  }
  if (Rider && riderIds.length) {
    for (const d of await Rider.findAll({ where: { id: { [Op.in]: riderIds } }, attributes: ['id', 'name'] })) names.set(`rider:${d.id}`, d.name);
  }
  return names;
};

const DEFAULT_NAMES = { customer: 'Customer', rider: 'Your rider', admin: 'Zenvy Support' };

/** Oldest first, in the same shape as the live 'receiveMessage' event (+ id, senderType). */
const listOrderMessages = async (orderId, { limit = 100, before = null } = {}) => {
  const OrderMessage = model('OrderMessage');
  if (!OrderMessage) return [];
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const where = { orderId: String(orderId) };
  const b = before ? new Date(before) : null;
  if (b && !Number.isNaN(b.getTime())) where.createdAt = { [Op.lt]: b };
  const rows = await OrderMessage.findAll({ where, order: [['createdAt', 'DESC']], limit: lim });
  const names = await nameCache(rows);
  return rows.reverse().map((r) => ({
    id: r.id,
    orderId: r.orderId,
    senderType: r.senderType,
    senderRole: r.senderType,
    senderId: r.senderId,
    sender: r.senderType === 'admin' ? DEFAULT_NAMES.admin : names.get(`${r.senderType}:${r.senderId}`) || DEFAULT_NAMES[r.senderType] || 'Zenvy',
    message: r.text,
    timestamp: r.createdAt,
  }));
};

/** Deletes order chat older than the retention window. Resolves the number of rows deleted. */
const purgeOldOrderMessages = async ({ now = Date.now(), days = retentionDays() } = {}) => {
  const OrderMessage = model('OrderMessage');
  if (!OrderMessage) return 0;
  const cutoff = new Date(now - days * DAY_MS);
  let total = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const ids = (await OrderMessage.findAll({ where: { createdAt: { [Op.lt]: cutoff } }, attributes: ['id'], limit: PURGE_BATCH, raw: true })).map((r) => r.id);
    if (!ids.length) break;
    total += await OrderMessage.destroy({ where: { id: { [Op.in]: ids } } });
    if (ids.length < PURGE_BATCH) break;
  }
  if (total) console.log(`[ORDER_CHAT_RETENTION] deleted ${total} order chat message(s) older than ${days} days`);
  return total;
};

// Ticket budget per reporter + order (in this process; a ticket per report is the normal case).
const issueBudget = new Map();
const takeIssueBudget = (key, now = Date.now()) => {
  const list = (issueBudget.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= ISSUE_TICKETS_PER_HOUR) { issueBudget.set(key, list); return false; }
  list.push(now);
  issueBudget.set(key, list);
  if (issueBudget.size > 5000) issueBudget.delete(issueBudget.keys().next().value);
  return true;
};

/**
 * Creates the support ticket for an order issue report. Resolves the Ticket row, or null (over budget,
 * not a UUID order, no Ticket model, DB error). Never throws.
 */
const createIssueTicket = async ({ orderId, actor, issueType, details }) => {
  try {
    const Ticket = model('Ticket');
    if (!Ticket || !actor || !UUID_RE.test(String(orderId || '')) || !UUID_RE.test(String(actor.id || ''))) return null;
    if (!takeIssueBudget(`${actor.id}:${orderId}`)) return null;
    const type = senderTypeFor(actor);
    const kind = String(issueType || 'Other').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Other';
    const text = String(details || '').trim().slice(0, 1000);
    const who = type === 'rider' ? 'Rider' : type === 'admin' ? 'Admin' : 'Customer';
    return await Ticket.create({
      userId: type === 'rider' ? null : actor.id,
      riderId: type === 'rider' ? actor.id : null,
      orderId: String(orderId),
      subject: `Order issue: ${kind}`.slice(0, 120),
      description: `${who} reported "${kind}" on order ${String(orderId).slice(0, 8)} from the order chat.${text ? `\n\n${text}` : ''}`,
      priority: 'High',
      status: 'Open',
      slaBreachAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    });
  } catch (err) {
    console.warn('[ORDER_ISSUE_TICKET_WARN]', err && (err.parent?.code || err.name || err.message));
    return null;
  }
};

/** GET /api/orders/:id/messages?limit=&before=  (protect): order parties + admins only. */
const getOrderMessagesRoute = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!UUID_RE.test(id)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found.' });
    const parties = await loadOrderParties(id);
    if (!parties) return res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found.' });
    if (!isOrderChatParty(req.user, parties)) return res.status(403).json({ code: 'FORBIDDEN', message: 'You cannot see this chat.' });
    res.set('Cache-Control', 'no-store');
    res.json({ orderId: id, retentionDays: retentionDays(), messages: await listOrderMessages(id, { limit: req.query.limit, before: req.query.before }) });
  } catch (err) {
    console.error('[ORDER_CHAT_LIST_ERROR]', err.message);
    res.status(500).json({ message: "We couldn't load the chat right now. Please try again." });
  }
};

module.exports = {
  getOrderMessagesRoute,
  MAX_TEXT,
  DEFAULT_RETENTION_DAYS,
  ISSUE_TICKETS_PER_HOUR,
  retentionDays,
  senderTypeFor,
  loadOrderParties,
  isOrderChatParty,
  canAccessOrderChat,
  saveOrderMessage,
  listOrderMessages,
  purgeOldOrderMessages,
  createIssueTicket,
  _resetIssueBudget: () => issueBudget.clear(),
};
