const express = require('express');
const { createTicket, getMyTickets, getAllTickets, updateTicket } = require('../controllers/ticketController');
const { protect, admin } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/', protect, createTicket);
router.get('/', protect, getMyTickets);
router.get('/admin', protect, admin, getAllTickets);
router.put('/:id', protect, admin, updateTicket);

module.exports = router;
