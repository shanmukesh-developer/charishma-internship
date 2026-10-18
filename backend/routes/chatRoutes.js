const express = require('express');
const router = express.Router();
const { protect, studentOnly } = require('../middleware/authMiddleware');
const {
  checkAfterDarkHours,
  getAfterDarkStatus,
  getConversations,
  getMessages,
  createGroup
} = require('../controllers/chatController');

// Public: is Zenvy After Dark open right now? { open, opensAt, closesAt, timezone }
router.get('/status', getAfterDarkStatus);

// All other chat routes are protected and gated by After Dark hours
router.use(protect);
router.use(studentOnly); // S0
router.use(checkAfterDarkHours);

router.get('/conversations', getConversations);
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/groups', createGroup);

module.exports = router;
