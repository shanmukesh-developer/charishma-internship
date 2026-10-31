const express = require('express');
const { protect, studentOnly } = require('../middleware/authMiddleware');
const {
  searchContacts,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getFriends,
  getPendingRequests,
  updateFriendshipTheme,
  sendFriendMessage,
  getFriendMessages,
  updateFriendshipNickname,
  sendFriendNudge,
  removeFriend,
  blockUser,
  unblockUser,
  getBlockedUsers,
  updateUserStatus,
  markStatusAsSeen,
  getFriendRequests,
  acceptFriendRequestById,
  declineFriendRequestById,
  cancelFriendRequest
} = require('../controllers/friendController');

const router = express.Router();

router.use(protect); // Ensure all friends endpoints are authenticated
router.use(studentOnly); // S0: rider / store / driver tokens never reach the student social graph

router.post('/contacts', searchContacts);
// Request inbox (preferred shape). The older /pending, /accept and /decline stay for old app builds.
router.get('/requests', getFriendRequests);
router.post('/requests/:id/accept', acceptFriendRequestById);
router.post('/requests/:id/decline', declineFriendRequestById);
router.delete('/requests/:id', cancelFriendRequest);
router.post('/request', sendFriendRequest);
router.post('/accept', acceptFriendRequest);
router.post('/decline', declineFriendRequest);
// At most 20 account blocks a day (31 Oct 2026): blocks hide people across the app (Connect discover included),
// so unlimited block / unblock let someone probe which pseudonymous profile belongs to which account.
const friendsLimiter = require('../modules/friends/services/limiter');
friendsLimiter.define('block', 20, 24 * 60 * 60 * 1000);
router.post('/block', friendsLimiter.limit('block'), blockUser);
router.post('/unblock', unblockUser);
router.get('/blocked', getBlockedUsers);
router.get('/', getFriends);
router.get('/pending', getPendingRequests);
router.put('/status', updateUserStatus);
router.post('/status/seen', markStatusAsSeen);
router.put('/:id/theme', updateFriendshipTheme);
router.put('/:id/nickname', updateFriendshipNickname);
router.post('/nudge', sendFriendNudge);
router.delete('/:id', removeFriend);
router.post('/message', sendFriendMessage);
router.get('/messages/:conversationId', getFriendMessages);

module.exports = router;

