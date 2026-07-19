const { Op } = require('sequelize');
const { getUserModel } = require('../models/User');
const { getFriendshipModel } = require('../models/Friendship');

const sendFriendRequest = async (req, res) => {
  try {
    const { friendCode } = req.body;
    const requesterId = req.user.id;

    if (!friendCode) {
      return res.status(400).json({ message: 'Friend code is required.' });
    }

    const User = getUserModel();
    const Friendship = getFriendshipModel();

    // Find user by friend code
    const recipient = await User.findOne({ where: { friendCode } });
    if (!recipient) {
      return res.status(404).json({ message: 'Invalid friend code.' });
    }

    if (recipient.id === requesterId) {
      return res.status(400).json({ message: 'You cannot send a friend request to yourself.' });
    }

    // Check if friendship already exists
    const existing = await Friendship.findOne({
      where: {
        [Op.or]: [
          { requesterId, recipientId: recipient.id },
          { requesterId: recipient.id, recipientId: requesterId }
        ]
      }
    });

    if (existing) {
      return res.status(400).json({ message: `Friendship status is already: ${existing.status}` });
    }

    // Create pending request
    await Friendship.create({
      requesterId,
      recipientId: recipient.id,
      status: 'pending'
    });

    res.status(200).json({ message: 'Friend request sent successfully!' });
  } catch (error) {
    console.error('[FRIEND_REQUEST_ERROR]', error);
    res.status(500).json({ message: 'Server error while sending friend request.' });
  }
};

const handleFriendRequest = async (req, res) => {
  try {
    const { requestId, action } = req.body; // action: 'accept' | 'reject' | 'block'
    const userId = req.user.id;

    const Friendship = getFriendshipModel();
    const friendship = await Friendship.findByPk(requestId);

    if (!friendship) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    // Only recipient can accept/reject
    if (friendship.recipientId !== userId) {
      return res.status(403).json({ message: 'Unauthorized action.' });
    }

    if (action === 'accept') {
      friendship.status = 'accepted';
      await friendship.save();
      return res.status(200).json({ message: 'Friend request accepted.' });
    } else if (action === 'reject') {
      await friendship.destroy(); // Hard delete rejected requests to keep DB clean
      return res.status(200).json({ message: 'Friend request rejected.' });
    } else if (action === 'block') {
      friendship.status = 'blocked';
      await friendship.save();
      return res.status(200).json({ message: 'User blocked.' });
    }

    res.status(400).json({ message: 'Invalid action.' });
  } catch (error) {
    console.error('[HANDLE_REQUEST_ERROR]', error);
    res.status(500).json({ message: 'Server error while handling request.' });
  }
};

const getFriendsList = async (req, res) => {
  try {
    const userId = req.user.id;
    const Friendship = getFriendshipModel();
    const User = getUserModel();

    // Find all accepted friendships where user is either requester or recipient
    const friendships = await Friendship.findAll({
      where: {
        status: 'accepted',
        [Op.or]: [
          { requesterId: userId },
          { recipientId: userId }
        ]
      },
      include: [
        { model: User, as: 'requester', attributes: ['id', 'name', 'profileImage', 'friendCode'] },
        { model: User, as: 'recipient', attributes: ['id', 'name', 'profileImage', 'friendCode'] }
      ]
    });

    // Format response to just return the "other" user
    const friends = friendships.map(f => {
      const isRequester = f.requesterId === userId;
      const friend = isRequester ? f.recipient : f.requester;
      return {
        friendshipId: f.id,
        id: friend.id,
        name: friend.name,
        profileImage: friend.profileImage,
        friendCode: friend.friendCode
      };
    });

    res.status(200).json({ friends });
  } catch (error) {
    console.error('[GET_FRIENDS_ERROR]', error);
    res.status(500).json({ message: 'Server error fetching friends.' });
  }
};

const getPendingRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const Friendship = getFriendshipModel();
    const User = getUserModel();

    const pending = await Friendship.findAll({
      where: {
        recipientId: userId,
        status: 'pending'
      },
      include: [
        { model: User, as: 'requester', attributes: ['id', 'name', 'profileImage', 'friendCode'] }
      ]
    });

    const requests = pending.map(p => ({
      friendshipId: p.id,
      id: p.requester.id,
      name: p.requester.name,
      profileImage: p.requester.profileImage,
      friendCode: p.requester.friendCode
    }));

    res.status(200).json({ requests });
  } catch (error) {
    console.error('[GET_PENDING_ERROR]', error);
    res.status(500).json({ message: 'Server error fetching pending requests.' });
  }
};

module.exports = {
  sendFriendRequest,
  handleFriendRequest,
  getFriendsList,
  getPendingRequests
};
