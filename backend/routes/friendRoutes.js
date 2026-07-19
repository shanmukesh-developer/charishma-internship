const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  sendFriendRequest,
  handleFriendRequest,
  getFriendsList
} = require('../controllers/friendController');

// All friend routes require authentication
router.post('/request', protect, sendFriendRequest);
router.post('/handle', protect, handleFriendRequest);
router.get('/list', protect, getFriendsList);

module.exports = router;
