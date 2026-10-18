// Who may read / join an After Dark chat?
// A lounge chat id is either an accepted Friendship id (1:1 friend chat) or a Room id
// (POST /api/rooms/create|join). Only the two friends, or the room's current participants
// (while the room has not expired), have access.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @returns {Promise<null | { type: 'friend', friendship } | { type: 'room', room }>}
 */
const getAfterDarkAccess = async (userId, groupId) => {
  const id = String(groupId || '').trim();
  if (!userId || userId === 'anonymous' || !UUID_PATTERN.test(id)) return null;

  const { getFriendshipModel } = require('../models/Friendship');
  const Friendship = getFriendshipModel && getFriendshipModel();
  if (Friendship) {
    const friendship = await Friendship.findByPk(id);
    if (friendship) {
      const isMember = [friendship.requesterId, friendship.recipientId].includes(userId);
      return isMember && friendship.status === 'accepted' ? { type: 'friend', friendship } : null;
    }
  }

  const { getRoomModel } = require('../models/Room');
  const { getRoomParticipantModel } = require('../models/RoomParticipant');
  const Room = getRoomModel && getRoomModel();
  const RoomParticipant = getRoomParticipantModel && getRoomParticipantModel();
  if (Room && RoomParticipant) {
    const room = await Room.findByPk(id);
    if (!room || room.isActive === false) return null;
    if (room.expiresAt && new Date(room.expiresAt).getTime() < Date.now()) return null;
    // S0 (P1-2): a member the room admin removed (kickedAt set) has no access any more.
    const membership = await RoomParticipant.findOne({ where: { roomId: id, userId, kickedAt: null } });
    return membership ? { type: 'room', room } : null;
  }
  return null;
};

module.exports = { getAfterDarkAccess };
