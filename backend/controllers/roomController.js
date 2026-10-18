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
    const body = req.body || {};
    const adminId = req.user.id;
    // Bounded input (a non-string name, or a ttlHours of 1e9 / "abc", used to 500 or make a
    // room that never expires): 1-60 chars, 1-72 h (default 24).
    const name = typeof body.name === 'string' ? body.name.replace(/[<>]/g, '').trim().slice(0, 60) : '';
    if (!name) return res.status(400).json({ message: 'Room name is required.' });
    const ttlRaw = body.ttlHours === undefined || body.ttlHours === null || body.ttlHours === '' ? 24 : Number(body.ttlHours);
    if (!Number.isFinite(ttlRaw) || ttlRaw < 1 || ttlRaw > 72) {
      return res.status(400).json({ message: 'A room can last from 1 to 72 hours.' });
    }
    const ttlHours = ttlRaw;
    const isPublic = typeof body.isPublic === 'boolean' ? body.isPublic : true;

    const Room = getRoomModel();
    const RoomParticipant = getRoomParticipantModel();

    const joinCode = generateRoomCode();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const room = await Room.create({
      name,
      adminId,
      joinCode,
      isPublic,
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
    const joinCode = typeof (req.body || {}).joinCode === 'string' ? req.body.joinCode.trim().toUpperCase() : '';
    const userId = req.user.id;

    if (!/^[0-9A-F]{8}$/.test(joinCode)) return res.status(400).json({ message: 'Join code is required.' });

    const Room = getRoomModel();
    const RoomParticipant = getRoomParticipantModel();

    const room = await Room.findOne({ where: { joinCode, isActive: true } });
    
    // An expired room (isActive is only flipped later by the purge job) cannot be joined.
    if (!room || (room.expiresAt && new Date(room.expiresAt).getTime() < Date.now())) {
      return res.status(404).json({ message: 'Room not found or has expired.' });
    }

    // Check if already in room
    const existing = await RoomParticipant.findOne({
      where: { roomId: room.id, userId }
    });

    if (existing && existing.kickedAt) {
      return res.status(403).json({ code: 'REMOVED_FROM_ROOM', message: 'The room admin removed you from this room, so you cannot rejoin it with the code.' });
    }
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
      where: { userId, kickedAt: null },
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
    const { roomId, targetUserId } = req.body || {};
    const adminId = req.user.id;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID.test(String(roomId || '')) || !UUID.test(String(targetUserId || ''))) {
      return res.status(400).json({ message: 'roomId and targetUserId are required.' });
    }
    if (String(targetUserId) === String(adminId)) {
      return res.status(400).json({ message: 'You cannot remove yourself as the room admin.' });
    }

    const RoomParticipant = getRoomParticipantModel();

    // Verify admin
    const adminParticipant = await RoomParticipant.findOne({
      where: { roomId, userId: adminId, role: 'admin', kickedAt: null }
    });

    if (!adminParticipant) {
      return res.status(403).json({ message: 'You must be a room admin to kick users.' });
    }

    // Remove target: the row stays with kickedAt set, so the join code no longer lets them back in
    // (deleting it made a kick a no-op for anyone who still had the code).
    const [kicked] = await RoomParticipant.update(
      { kickedAt: new Date(), role: 'member' },
      { where: { roomId, userId: targetUserId, kickedAt: null } }
    );
    if (!kicked) return res.status(404).json({ message: 'That person is not in this room.' });

    // S0 (P1-2): take the removed person's live sockets out of the room's chat and call rooms on every
    // instance (socketsLeave goes through the Redis adapter when it is on).
    try {
      const io = req.app.get('io');
      if (io) {
        const chatRoom = `afterdark_${roomId}`;
        const callRoom = `afterdark_call_${roomId}`;
        io.in(`user_${targetUserId}`).socketsLeave([chatRoom, callRoom]);
        io.to(`user_${targetUserId}`).emit('after_dark_removed', { groupId: roomId });
        io.to(callRoom).emit('user_left_call', { userId: targetUserId, userName: 'Friend', removed: true });
      }
    } catch (err) {
      console.warn('[KICK_SOCKET_LEAVE_WARN]', err.message);
    }

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
