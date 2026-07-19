const { Op } = require('sequelize');
const { getRoomModel } = require('../models/Room');
const { getRoomParticipantModel } = require('../models/RoomParticipant');
const crypto = require('crypto');

// Helper to generate an 8-char alphanumeric room code
const generateRoomCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

const createRoom = async (req, res) => {
  try {
    const { name, isPublic, ttlHours = 24 } = req.body;
    const adminId = req.user.id;

    if (!name) return res.status(400).json({ message: 'Room name is required.' });

    const Room = getRoomModel();
    const RoomParticipant = getRoomParticipantModel();

    const joinCode = generateRoomCode();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const room = await Room.create({
      name,
      adminId,
      joinCode,
      isPublic: isPublic !== undefined ? isPublic : true,
      expiresAt
    });

    // Add creator as admin
    await RoomParticipant.create({
      roomId: room.id,
      userId: adminId,
      role: 'admin'
    });

    res.status(201).json({ room, message: 'Room created successfully!' });
  } catch (error) {
    console.error('[CREATE_ROOM_ERROR]', error);
    res.status(500).json({ message: 'Server error while creating room.' });
  }
};

const joinRoom = async (req, res) => {
  try {
    const { joinCode } = req.body;
    const userId = req.user.id;

    if (!joinCode) return res.status(400).json({ message: 'Join code is required.' });

    const Room = getRoomModel();
    const RoomParticipant = getRoomParticipantModel();

    const room = await Room.findOne({ where: { joinCode, isActive: true } });
    
    if (!room) {
      return res.status(404).json({ message: 'Room not found or has expired.' });
    }

    // Check if already in room
    const existing = await RoomParticipant.findOne({
      where: { roomId: room.id, userId }
    });

    if (existing) {
      return res.status(200).json({ room, message: 'You are already in this room.' });
    }

    // Add to room
    await RoomParticipant.create({
      roomId: room.id,
      userId,
      role: 'member'
    });

    res.status(200).json({ room, message: 'Joined room successfully!' });
  } catch (error) {
    console.error('[JOIN_ROOM_ERROR]', error);
    res.status(500).json({ message: 'Server error while joining room.' });
  }
};

const myRooms = async (req, res) => {
  try {
    const userId = req.user.id;
    const Room = getRoomModel();
    const RoomParticipant = getRoomParticipantModel();

    const memberships = await RoomParticipant.findAll({
      where: { userId },
      include: [{ model: Room, as: 'room', where: { isActive: true } }]
    });

    const rooms = memberships.map(m => m.room);
    res.status(200).json({ rooms });
  } catch (error) {
    console.error('[MY_ROOMS_ERROR]', error);
    res.status(500).json({ message: 'Server error fetching your rooms.' });
  }
};

const kickUser = async (req, res) => {
  try {
    const { roomId, targetUserId } = req.body;
    const adminId = req.user.id;

    const RoomParticipant = getRoomParticipantModel();

    // Verify admin
    const adminParticipant = await RoomParticipant.findOne({
      where: { roomId, userId: adminId, role: 'admin' }
    });

    if (!adminParticipant) {
      return res.status(403).json({ message: 'You must be a room admin to kick users.' });
    }

    // Remove target
    await RoomParticipant.destroy({
      where: { roomId, userId: targetUserId }
    });

    res.status(200).json({ message: 'User kicked from room.' });
  } catch (error) {
    console.error('[KICK_USER_ERROR]', error);
    res.status(500).json({ message: 'Server error kicking user.' });
  }
};

module.exports = {
  createRoom,
  joinRoom,
  myRooms,
  kickUser
};
