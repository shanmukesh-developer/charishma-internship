const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createRoom,
  joinRoom,
  myRooms,
  kickUser
} = require('../controllers/roomController');

router.post('/create', protect, createRoom);
router.post('/join', protect, joinRoom);
router.get('/my-rooms', protect, myRooms);
router.post('/kick', protect, kickUser);

module.exports = router;
