const { getTicketModel } = require('../models/Ticket');
const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');
const realtime = require('../utils/realtime');

// @desc    Create a new support ticket
// @route   POST /api/tickets
const TICKETS_PER_DAY = 10;
const createTicket = async (req, res) => {
  const { subject: rawSubject, description: rawDescription, orderId } = req.body || {};

  if (!rawSubject || !rawDescription) {
    return res.status(400).json({ message: 'Subject and description are required.' });
  }
  if (typeof rawSubject !== 'string' || typeof rawDescription !== 'string') {
    return res.status(400).json({ message: 'Subject and description must be text.' });
  }
  // B25: the subject column is VARCHAR(255) (longer subjects failed with a 500).
  const subject = rawSubject.replace(/[<>]/g, '').trim().slice(0, 200);
  const description = rawDescription.replace(/[<>]/g, '').trim().slice(0, 5000);
  if (!subject || !description) return res.status(400).json({ message: 'Subject and description are required.' });
  // B25: customers cannot set their own priority (everyone picked "Critical" for a 2-hour SLA).
  // Support staff triage it; a ticket about a live order starts at High.
  const isStaff = req.user && String(req.user.role || '').toLowerCase() === 'admin';
  const requested = ['Low', 'Medium', 'High', 'Critical'].includes((req.body || {}).priority) ? req.body.priority : null;
  const priority = isStaff && requested ? requested : (orderId ? 'High' : 'Medium');

  try {
    const Ticket = getTicketModel();
    const Order = getOrderModel();

    // At most TICKETS_PER_DAY new tickets per account a day (29 Oct 2026 security pass: one account could flood the
    // support queue). Staff are not limited.
    if (!isStaff) {
      const { Op } = require('sequelize');
      const today = await Ticket.count({ where: { userId: req.user.id, createdAt: { [Op.gt]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
      if (today >= TICKETS_PER_DAY) {
        return res.status(429).json({ code: 'TICKET_LIMIT', message: `You have opened ${today} support tickets today. Please reply on an open ticket, or try again tomorrow.` });
      }
    }

    if (orderId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orderId))) {
        return res.status(400).json({ message: 'That order could not be found. Please pick it from your orders list.' });
      }
      const order = await Order.findByPk(orderId);
      if (!order || order.userId !== req.user.id) {
        return res.status(404).json({ message: 'Order not found or access denied.' });
      }
    }

    let slaHours = 12; // Default Medium
    const prio = priority || 'Medium';
    if (prio === 'Critical') slaHours = 2;
    else if (prio === 'High') slaHours = 4;
    else if (prio === 'Low') slaHours = 24;
    
    const breachTime = new Date();
    breachTime.setHours(breachTime.getHours() + slaHours);

    // Optional photos (max 3): the customer's own private 'support' uploads (utils/ticketAttachments).
    const ta = require('../utils/ticketAttachments');
    const attach = await ta.validateAttachments(req.user.id, (req.body || {}).attachments);
    if (attach.error) return res.status(400).json({ message: attach.error });

    const ticket = await Ticket.create({
      userId: req.user.id,
      orderId: orderId || null,
      subject,
      description,
      priority: prio,
      status: 'Open',
      slaBreachAt: breachTime,
      attachments: attach.paths,
    });

    realtime.notifyAdmin('ticket', 'created', ticket.id);
    res.status(201).json((await ta.signTicketAttachments(req, [ticket.toJSON()]))[0]);
  } catch (error) {
    console.error('[CREATE_TICKET_ERROR]', error);
    res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

// @desc    Get user's tickets
// @route   GET /api/tickets
const getMyTickets = async (req, res) => {
  try {
    const Ticket = getTicketModel();
    const Order = getOrderModel();

    const tickets = await Ticket.findAll({
      where: { userId: req.user.id },
      include: [{ model: Order, as: 'order', attributes: ['id', 'status', 'createdAt', 'totalPrice'] }],
      order: [['createdAt', 'DESC']]
    });

    res.json(await require('../utils/ticketAttachments').signTicketAttachments(req, tickets.map((t) => t.toJSON())));
  } catch (error) {
    console.error('[GET_TICKETS_ERROR]', error);
    res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

// @desc    Get all tickets (Admin)
// @route   GET /api/tickets/admin
const getAllTickets = async (req, res) => {
  try {
    const Ticket = getTicketModel();
    const User = getUserModel();

    const tickets = await Ticket.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['createdAt', 'DESC']]
    });

    // Rider tickets (riderId, no userId): show the rider as the requester.
    const riderIds = [...new Set(tickets.filter(t => !t.userId && t.riderId).map(t => t.riderId))];
    let riderMap = {};
    if (riderIds.length) {
      const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
      const riders = await getDeliveryPartnerModel().findAll({ where: { id: riderIds }, attributes: ['id', 'name', 'phone'] });
      riderMap = Object.fromEntries(riders.map(r => [r.id, r]));
    }
    res.json(await require('../utils/ticketAttachments').signTicketAttachments(req, tickets.map(t => {
      const json = t.toJSON();
      const rider = json.riderId ? riderMap[json.riderId] : null;
      if (!json.user && rider) json.user = { id: rider.id, name: `Rider: ${rider.name}`, phone: rider.phone };
      return { ...json, requesterRole: json.riderId && !json.userId ? 'rider' : 'customer' };
    })));
  } catch (error) {
    console.error('[GET_ALL_TICKETS_ERROR]', error);
    res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

// @desc    Update ticket status/response (Admin)
// @route   PUT /api/tickets/:id
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const audit = (req, targetId, action, details) => require('./adminController').logAuditAction(req, targetId, action, details);

const updateTicket = async (req, res) => {
  const { status, adminResponse } = req.body;

  try {
    const Ticket = getTicketModel();
    const ticket = await Ticket.findByPk(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Optional assignee change: { assigneeId: '<admin user id>' | null }. Only admin accounts can own tickets.
    const assigneeChange = req.body && Object.prototype.hasOwnProperty.call(req.body, 'assigneeId');
    if (assigneeChange) {
      const raw = req.body.assigneeId;
      if (raw === null || raw === '') {
        ticket.assigneeId = null;
        ticket.assigneeName = null;
      } else {
        if (typeof raw !== 'string' || !UUID_RE.test(raw)) return res.status(400).json({ message: 'Pick an admin to assign the ticket to.', code: 'INVALID_ASSIGNEE' });
        const assignee = await getUserModel().findByPk(raw, { attributes: ['id', 'name', 'role', 'isActive'] });
        if (!assignee || String(assignee.role || '').toLowerCase() !== 'admin' || assignee.isActive === false) {
          return res.status(400).json({ message: 'Tickets can only be assigned to an active admin account.', code: 'INVALID_ASSIGNEE' });
        }
        ticket.assigneeId = assignee.id;
        ticket.assigneeName = String(assignee.name || 'Admin').slice(0, 120);
      }
    }

    const previousStatus = ticket.status;
    const previousResponse = ticket.adminResponse;
    if (status) ticket.status = status;
    if (adminResponse && typeof adminResponse === 'string' && adminResponse.trim()) {
      // Append, never overwrite: a second reply used to wipe the first one the customer had read.
      const thread = Array.isArray(ticket.responses) ? [...ticket.responses] : [];
      if (thread.length === 0 && previousResponse) {
        thread.push({ text: String(previousResponse), at: new Date(ticket.updatedAt || Date.now()).toISOString(), by: 'support' });
      }
      thread.push({ text: adminResponse.trim().slice(0, 2000), at: new Date().toISOString(), by: 'support' });
      ticket.responses = thread.slice(-50);
      // Same transcript as customer replies (ticketReplyController): customer lines start with "You:".
      ticket.adminResponse = require('./ticketReplyController').transcriptOf(ticket.responses);
    }

    await ticket.save();
    if (assigneeChange) await audit(req, ticket.id, 'TICKET_ASSIGNED', { assigneeId: ticket.assigneeId, assigneeName: ticket.assigneeName });
    realtime.notifyAdmin('ticket', 'updated', ticket.id);
    res.json(ticket);

    // Tell the customer (push + live) when support replies or changes the status.
    if (ticket.status !== previousStatus || (adminResponse && adminResponse !== previousResponse)) {
      try {
        const io = req.app.get('io');
        if (io && ticket.userId) io.to('user_' + ticket.userId).emit('ticket_updated', { id: ticket.id, status: ticket.status, adminResponse: ticket.adminResponse });
        const customer = ticket.userId ? await getUserModel().findByPk(ticket.userId, { attributes: ['id', 'fcmTokens'] }) : null;
        if (customer) {
          const { sendPushToTokens } = require('../utils/push');
          const title = adminResponse && adminResponse !== previousResponse ? '💬 ZCS Support replied' : '🎫 Support ticket updated';
          const body = adminResponse && adminResponse !== previousResponse
            ? String(adminResponse).slice(0, 140)
            : 'Your ticket "' + String(ticket.subject || 'Support request').slice(0, 60) + '" is now ' + ticket.status + '.';
          await sendPushToTokens(customer.fcmTokens, title, body, { type: 'SUPPORT_TICKET', ticketId: String(ticket.id), status: String(ticket.status) }, { recipients: [ticket.userId] });
        }
        if (!ticket.userId && ticket.riderId) {
          // Rider ticket: live update + push to the rider app (rider tokens are { token, appVersion } objects).
          if (io) io.to('rider_' + ticket.riderId).emit('ticket_updated', { id: ticket.id, status: ticket.status, adminResponse: ticket.adminResponse });
          const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
          const rider = await getDeliveryPartnerModel().findByPk(ticket.riderId, { attributes: ['id', 'fcmTokens'] });
          const riderTokens = (Array.isArray(rider?.fcmTokens) ? rider.fcmTokens : []).map(t => (typeof t === 'string' ? t : t?.token)).filter(Boolean);
          if (riderTokens.length) {
            const { sendPushToTokens } = require('../utils/push');
            const replied = adminResponse && adminResponse !== previousResponse;
            await sendPushToTokens(
              riderTokens,
              replied ? 'ZCS Support replied' : 'Support ticket updated',
              replied ? String(adminResponse).slice(0, 140) : 'Your ticket "' + String(ticket.subject || 'Support request').slice(0, 60) + '" is now ' + ticket.status + '.',
              { type: 'SUPPORT_TICKET', ticketId: String(ticket.id), status: String(ticket.status) },
              // Rider app channel (the default 'delivery-alerts-v2' was deleted by the rider app).
              { persist: false, android: { ...require('../utils/riderDispatch').RIDER_PUSH_ANDROID, ttl: 24 * 60 * 60 * 1000 } } // a support reply stays deliverable for a day
            );
          }
        }
      } catch (notifyErr) {
        console.warn('[TICKET_NOTIFY_WARN]', notifyErr.message);
      }
    }
  } catch (error) {
    console.error('[UPDATE_TICKET_ERROR]', error);
    res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

// @desc    Admins a ticket can be assigned to
// @route   GET /api/tickets/admin/assignees
const getAssignees = async (req, res) => {
  try {
    const admins = await getUserModel().findAll({ where: { role: 'admin' }, attributes: ['id', 'name', 'isActive'], order: [['name', 'ASC']], limit: 200 });
    res.json(admins.filter((a) => a.isActive !== false).map((a) => ({ id: a.id, name: a.name || 'Admin' })));
  } catch (error) {
    console.error('[TICKET_ASSIGNEES_ERROR]', error);
    res.status(500).json({ message: 'Could not load the admin list.' });
  }
};

// Canned replies support can insert into a reply. Stored in GlobalConfig; the defaults match how
// Zenvy works today (COD + Wallet only, delivery PIN in the customer app).
const CANNED_KEY = 'SUPPORT_CANNED_REPLIES';
const DEFAULT_CANNED = [
  { title: 'Expedited', text: 'Sorry for the delay. We have flagged your order as urgent with our campus delivery team.' },
  { title: 'Wallet refund', text: 'We have reviewed your order and refunded the amount to your ZCS Wallet. You can see it in the Wallet section of the app.' },
  { title: 'Rider at gate', text: 'Your delivery partner is waiting at the hostel gate. Please share the delivery PIN shown on your order tracking screen to receive the order.' },
  { title: 'Need details', text: 'Thanks for reaching out. Could you share a few more details (order time, item names, a photo if relevant) so we can sort this out?' },
];
const MAX_CANNED = 30;

const readCanned = async () => {
  const row = await require('../models/GlobalConfig').getGlobalConfigModel().findOne({ where: { key: CANNED_KEY } }).catch(() => null);
  let v = row ? row.value : null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return Array.isArray(v) ? v : DEFAULT_CANNED;
};

// @route GET /api/tickets/admin/canned-replies
const getCannedReplies = async (req, res) => {
  try {
    res.json({ replies: await readCanned() });
  } catch (error) {
    console.error('[CANNED_REPLIES_ERROR]', error);
    res.status(500).json({ message: 'Could not load the canned replies.' });
  }
};

// @route PUT /api/tickets/admin/canned-replies { replies: [{ title, text }] }
const putCannedReplies = async (req, res) => {
  try {
    const list = req.body && req.body.replies;
    if (!Array.isArray(list) || list.length > MAX_CANNED) return res.status(400).json({ message: `Send a list of up to ${MAX_CANNED} replies.`, code: 'INVALID_INPUT' });
    const clean = [];
    for (const [i, r] of list.entries()) {
      const title = String((r && r.title) || '').replace(/\s+/g, ' ').trim();
      const text = String((r && r.text) || '').trim();
      if (!title || title.length > 60) return res.status(400).json({ message: `Reply ${i + 1}: the title must be 1 to 60 characters.`, code: 'INVALID_INPUT', field: `replies.${i}.title` });
      if (!text || text.length > 1000) return res.status(400).json({ message: `Reply ${i + 1}: the text must be 1 to 1000 characters.`, code: 'INVALID_INPUT', field: `replies.${i}.text` });
      clean.push({ title, text });
    }
    const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
    await GlobalConfig.upsert({ key: CANNED_KEY, value: clean, description: 'Canned replies for support tickets (admin dashboard)' });
    await audit(req, 'global', 'SUPPORT_CANNED_REPLIES_UPDATED', { count: clean.length });
    res.json({ replies: clean });
  } catch (error) {
    console.error('[CANNED_REPLIES_SAVE_ERROR]', error);
    res.status(500).json({ message: 'Could not save the canned replies.' });
  }
};

module.exports = { createTicket, getMyTickets, getAllTickets, updateTicket, getAssignees, getCannedReplies, putCannedReplies, CANNED_KEY, DEFAULT_CANNED };
