const { getTicketModel } = require('../models/Ticket');
const { getOrderModel } = require('../models/Order');
const { getUserModel } = require('../models/User');

// @desc    Create a new support ticket
// @route   POST /api/tickets
const createTicket = async (req, res) => {
  const { subject, description, orderId, priority } = req.body;

  if (!subject || !description) {
    return res.status(400).json({ message: 'Subject and description are required.' });
  }

  try {
    const Ticket = getTicketModel();
    const Order = getOrderModel();

    if (orderId) {
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

    const ticket = await Ticket.create({
      userId: req.user.id,
      orderId: orderId || null,
      subject,
      description,
      priority: prio,
      status: 'Open',
      slaBreachAt: breachTime
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('[CREATE_TICKET_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
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

    res.json(tickets);
  } catch (error) {
    console.error('[GET_TICKETS_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
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

    res.json(tickets);
  } catch (error) {
    console.error('[GET_ALL_TICKETS_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// @desc    Update ticket status/response (Admin)
// @route   PUT /api/tickets/:id
const updateTicket = async (req, res) => {
  const { status, adminResponse } = req.body;

  try {
    const Ticket = getTicketModel();
    const ticket = await Ticket.findByPk(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (status) ticket.status = status;
    if (adminResponse) ticket.adminResponse = adminResponse;

    await ticket.save();
    res.json(ticket);
  } catch (error) {
    console.error('[UPDATE_TICKET_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

module.exports = { createTicket, getMyTickets, getAllTickets, updateTicket };
