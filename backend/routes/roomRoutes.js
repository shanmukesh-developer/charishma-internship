const express = require('express');
const router = express.Router();
const { protect: authProtect, studentOnly } = require('../middleware/authMiddleware');
// S0: student accounts only.
const protect = [authProtect, studentOnly];
const {
  createRoom,
  joinRoom,
  myRooms,
  kickUser
} = require('../controllers/roomController');

// C2: After Dark lounge rooms follow the After Dark kill switch (GlobalConfig AFTER_DARK_ENABLED).
const { requireOn } = require('../utils/featureSwitches');
router.post('/create', protect, requireOn('afterDark'), createRoom);
router.post('/join', protect, requireOn('afterDark'), joinRoom);
router.get('/my-rooms', protect, myRooms);
router.post('/kick', protect, kickUser);

module.exports = router;
