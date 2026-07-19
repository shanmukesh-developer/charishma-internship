const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { 
  checkAfterDarkHours, 
  getConversations, 
  getMessages, 
  createGroup 
} = require('../controllers/chatController');

// All chat routes are protected and gated by After Dark hours
router.use(protect);
router.use(checkAfterDarkHours);

router.get('/conversations', getConversations);
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/groups', createGroup);

module.exports = router;
