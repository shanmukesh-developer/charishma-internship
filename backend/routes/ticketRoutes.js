const express = require('express');
const { createTicket, getMyTickets, getAllTickets, updateTicket, getAssignees, getCannedReplies, putCannedReplies } = require('../controllers/ticketController');
const { protect, admin } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/', protect, createTicket);
router.get('/', protect, getMyTickets);
router.get('/admin', protect, admin, getAllTickets);
// Static admin paths before /:id.
router.get('/admin/assignees', protect, admin, getAssignees);
router.get('/admin/canned-replies', protect, admin, getCannedReplies);
router.put('/admin/canned-replies', protect, admin, putCannedReplies);
// Customer reply on their own ticket (ownership checked in the controller).
router.post('/:id/reply', protect, require('../controllers/ticketReplyController').replyToMyTicket);
router.put('/:id', protect, admin, updateTicket);

module.exports = router;
