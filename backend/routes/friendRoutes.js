const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
  searchContacts,
  sendFriendRequest,
  acceptFriendRequest,
  getFriends,
  getPendingRequests,
  updateFriendshipTheme,
  sendFriendMessage,
  getFriendMessages,
  updateFriendshipNickname,
  sendFriendNudge,
  removeFriend
} = require('../controllers/friendController');

const router = express.Router();

router.use(protect); // Ensure all friends endpoints are authenticated

router.post('/contacts', searchContacts);
router.post('/request', sendFriendRequest);
router.post('/accept', acceptFriendRequest);
router.get('/', getFriends);
router.get('/pending', getPendingRequests);
router.put('/:id/theme', updateFriendshipTheme);
router.put('/:id/nickname', updateFriendshipNickname);
router.post('/nudge', sendFriendNudge);
router.delete('/:id', removeFriend);
router.post('/message', sendFriendMessage);
router.get('/messages/:conversationId', getFriendMessages);

module.exports = router;
