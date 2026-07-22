const { getFriendshipModel } = require('../models/Friendship');
const { getUserModel } = require('../models/User');
const { getConversationModel } = require('../models/Conversation');
const { getMessageModel } = require('../models/Message');
const { normalizePhone } = require('../utils/phoneUtils');
const { encryptText, decryptText } = require('../utils/crypto');
const { sendPushToTokens } = require('../utils/push');
const { Op } = require('sequelize');

// Helper to calculate / update streaks
const updateFriendshipStreak = async (friendship) => {
  const now = new Date();
  const lastInteraction = friendship.lastInteractionAt;

  if (!lastInteraction) {
    // First interaction ever -> starts streak at 1
    friendship.streakCount = 1;
  } else {
    const diffMs = now.getTime() - new Date(lastInteraction).getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours >= 24 && diffHours <= 48) {
      // Clean 24-48 hours window -> increment streak
      friendship.streakCount = (friendship.streakCount || 0) + 1;
    } else if (diffHours > 48) {
      // Missed the 48-hour window -> reset streak to 1
      friendship.streakCount = 1;
    }
    // If diffHours < 24 -> keep streak count identical (same day chat), but update interaction timestamp below
  }

  friendship.lastInteractionAt = now;
  await friendship.save();
};

// Helper to push notifications to specific user ID
const sendPushToUser = async (userId, title, body, data = {}) => {
  try {
    const User = getUserModel();
    if (!User) return;
    const user = await User.findByPk(userId);
    if (!user || !user.fcmTokens) return;

    let tokenList = user.fcmTokens;
    if (typeof tokenList === 'string') {
      try { tokenList = JSON.parse(tokenList); } catch { tokenList = [tokenList]; }
    }
    if (Array.isArray(tokenList)) {
      const tokens = tokenList.map(t => typeof t === 'string' ? t : t?.token).filter(Boolean);
      if (tokens.length > 0) {
        await sendPushToTokens(tokens, title, body, data);
      }
    }
  } catch (err) {
    console.error(`[PUSH_ERROR] Failed sending user push to ${userId}:`, err.message);
  }
};

// 1. Scan/Search contacts
exports.searchContacts = async (req, res) => {
  try {
    const { contacts, query } = req.body;

    const User = getUserModel();
    const Friendship = getFriendshipModel();
    if (!User || !Friendship) return res.status(500).json({ message: 'Models not loaded' });

    let matchedUsers = [];

    if (query && query.trim().length > 0) {
      const searchStr = query.trim();
      const isPostgres = User.sequelize.options.dialect === 'postgres';
      const matchOp = isPostgres ? Op.iLike : Op.like;

      matchedUsers = await User.findAll({
        where: {
          id: { [Op.ne]: req.user.id }, // Exclude self
          [Op.or]: [
            { name: { [matchOp]: `%${searchStr}%` } },
            { phone: { [Op.like]: `%${searchStr}%` } }
          ]
        },
        attributes: ['id', 'name', 'phone', 'profileImage'],
        limit: 15
      });
    } else if (Array.isArray(contacts)) {
      // Normalize phone numbers
      const cleanNumbers = contacts.map(num => normalizePhone(num)).filter(Boolean);
      if (cleanNumbers.length === 0) {
        return res.json([]);
      }

      // Query matching users
      matchedUsers = await User.findAll({
        where: {
          phone: { [Op.in]: cleanNumbers },
          id: { [Op.ne]: req.user.id } // Exclude self
        },
        attributes: ['id', 'name', 'phone', 'profileImage']
      });
    } else {
      return res.status(400).json({ message: 'Either contacts array or query string is required.' });
    }

    // Check friendship status for each matched user
    const results = [];
    for (const matchedUser of matchedUsers) {
      const friendship = await Friendship.findOne({
        where: {
          [Op.or]: [
            { requesterId: req.user.id, recipientId: matchedUser.id },
            { requesterId: matchedUser.id, recipientId: req.user.id }
          ]
        }
      });

      results.push({
        id: matchedUser.id,
        name: matchedUser.name,
        phone: matchedUser.phone,
        profileImage: matchedUser.profileImage,
        friendshipStatus: friendship ? friendship.status : 'none',
        friendshipId: friendship ? friendship.id : null
      });
    }

    res.json(results);
  } catch (error) {
    console.error('[FRIEND_CONTACT_SEARCH_ERROR]', error);
    res.status(500).json({ message: 'Server error searching contacts.' });
  }
};

// 2. Send Friend Request
exports.sendFriendRequest = async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (!recipientId) return res.status(400).json({ message: 'recipientId is required.' });

    const Friendship = getFriendshipModel();
    if (!Friendship) return res.status(500).json({ message: 'Model not loaded' });

    // Check existing
    const existing = await Friendship.findOne({
      where: {
        [Op.or]: [
          { requesterId: req.user.id, recipientId },
          { requesterId: recipientId, recipientId: req.user.id }
        ]
      }
    });

    if (existing) {
      return res.status(400).json({ message: `Friendship already exists with status: ${existing.status}` });
    }

    const friendship = await Friendship.create({
      requesterId: req.user.id,
      recipientId,
      status: 'pending'
    });

    // Socket emission & push notification to recipient
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${recipientId}`).emit('incoming_friend_request', {
        friendshipId: friendship.id,
        requester: {
          id: req.user.id,
          name: req.user.name,
          profileImage: req.user.profileImage
        }
      });
    }

    await sendPushToUser(
      recipientId,
      '🎉 Friend Request',
      `${req.user.name} wants to connect on Zenvy Secure!`,
      { type: 'FRIEND_REQUEST', requesterId: req.user.id }
    );

    res.status(201).json({ message: 'Friend request sent.', friendship });
  } catch (error) {
    console.error('[SEND_FRIEND_REQUEST_ERROR]', error);
    res.status(500).json({ message: 'Server error sending request.' });
  }
};

// 3. Accept Friend Request
exports.acceptFriendRequest = async (req, res) => {
  try {
    const { friendshipId } = req.body;
    if (!friendshipId) return res.status(400).json({ message: 'friendshipId is required.' });

    const Friendship = getFriendshipModel();
    const Conversation = getConversationModel();
    if (!Friendship || !Conversation) return res.status(500).json({ message: 'Models not loaded' });

    const friendship = await Friendship.findByPk(friendshipId);
    if (!friendship) return res.status(404).json({ message: 'Friend request not found.' });

    if (friendship.recipientId !== req.user.id) {
      return res.status(403).json({ message: 'Only recipient can accept friend requests.' });
    }

    friendship.status = 'accepted';
    await friendship.save();

    // Create 1-on-1 Conversation
    const participants = [friendship.requesterId, friendship.recipientId];
    let conversation = await Conversation.findOne({
      where: {
        isGroup: false,
        participants: JSON.stringify(participants) // Keep order check simple
      }
    });

    if (!conversation) {
      // Try reversed participants sequence search
      conversation = await Conversation.findOne({
        where: {
          isGroup: false,
          participants: JSON.stringify([friendship.recipientId, friendship.requesterId])
        }
      });
    }

    if (!conversation) {
      conversation = await Conversation.create({
        isGroup: false,
        participants
      });
    }

    // Trigger alerts to requester
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${friendship.requesterId}`).emit('friend_request_accepted', {
        friendshipId: friendship.id,
        friendName: req.user.name,
        conversationId: conversation.id
      });
    }

    await sendPushToUser(
      friendship.requesterId,
      '🤝 Friend Request Accepted',
      `${req.user.name} accepted your friend request!`,
      { type: 'FRIEND_ACCEPTED', friendId: req.user.id }
    );

    res.json({ message: 'Friend request accepted.', friendship, conversationId: conversation.id });
  } catch (error) {
    console.error('[ACCEPT_FRIEND_REQUEST_ERROR]', error);
    res.status(500).json({ message: 'Server error accepting request.' });
  }
};

// 4. Get Friends List
exports.getFriends = async (req, res) => {
  try {
    const Friendship = getFriendshipModel();
    const User = getUserModel();
    const Conversation = getConversationModel();
    if (!Friendship || !User || !Conversation) return res.status(500).json({ message: 'Models not loaded' });

    const friendships = await Friendship.findAll({
      where: {
        status: 'accepted',
        [Op.or]: [
          { requesterId: req.user.id },
          { recipientId: req.user.id }
        ]
      }
    });

    const list = [];
    for (const fs of friendships) {
      const friendId = fs.requesterId === req.user.id ? fs.recipientId : fs.requesterId;
      const friend = await User.findByPk(friendId, {
        attributes: ['id', 'name', 'phone', 'profileImage', 'statusText', 'statusEmoji']
      });

      if (!friend) continue;

      // Find conversation ID
      let conversation = await Conversation.findOne({
        where: {
          isGroup: false,
          participants: JSON.stringify([req.user.id, friendId])
        }
      });
      if (!conversation) {
        conversation = await Conversation.findOne({
          where: {
            isGroup: false,
            participants: JSON.stringify([friendId, req.user.id])
          }
        });
      }

      list.push({
        friendshipId: fs.id,
        friendId: friend.id,
        name: fs.nickname || friend.name,
        originalName: friend.name,
        nickname: fs.nickname || null,
        phone: friend.phone,
        profileImage: friend.profileImage,
        streakCount: fs.streakCount || 0,
        lastInteractionAt: fs.lastInteractionAt,
        theme: fs.theme || 'friendship',
        conversationId: conversation ? conversation.id : null,
        statusText: friend.statusText || null,
        statusEmoji: friend.statusEmoji || null
      });
    }

    res.json(list);
  } catch (error) {
    console.error('[GET_FRIENDS_ERROR]', error);
    res.status(500).json({ message: 'Server error fetching friends.' });
  }
};

// 5. Get Incoming Pending Requests
exports.getPendingRequests = async (req, res) => {
  try {
    const Friendship = getFriendshipModel();
    const User = getUserModel();
    if (!Friendship || !User) return res.status(500).json({ message: 'Models not loaded' });

    const pending = await Friendship.findAll({
      where: {
        recipientId: req.user.id,
        status: 'pending'
      }
    });

    const list = [];
    for (const p of pending) {
      const requester = await User.findByPk(p.requesterId, {
        attributes: ['id', 'name', 'phone', 'profileImage']
      });
      if (requester) {
        list.push({
          friendshipId: p.id,
          requester
        });
      }
    }

    res.json(list);
  } catch (error) {
    console.error('[GET_PENDING_ERROR]', error);
    res.status(500).json({ message: 'Server error fetching requests.' });
  }
};

// 6. Update theme
exports.updateFriendshipTheme = async (req, res) => {
  try {
    const { id } = req.params;
    const { theme } = req.body;

    const VALID_THEMES = ['friendship', 'crazy', 'love'];
    if (!VALID_THEMES.includes(theme)) {
      return res.status(400).json({ message: 'Invalid theme selected.' });
    }

    const Friendship = getFriendshipModel();
    if (!Friendship) return res.status(500).json({ message: 'Model not loaded' });

    const friendship = await Friendship.findByPk(id);
    if (!friendship) return res.status(404).json({ message: 'Friendship not found.' });

    if (friendship.requesterId !== req.user.id && friendship.recipientId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized.' });
    }

    friendship.theme = theme;
    await friendship.save();

    // Broadcast theme update via socket
    const io = req.app.get('io');
    if (io) {
      const otherUserId = friendship.requesterId === req.user.id ? friendship.recipientId : friendship.requesterId;
      io.to(`user-${otherUserId}`).emit('friendship_theme_updated', { friendshipId: friendship.id, theme });
    }

    res.json({ message: 'Theme updated.', theme });
  } catch (error) {
    console.error('[UPDATE_THEME_ERROR]', error);
    res.status(500).json({ message: 'Server error updating theme.' });
  }
};

// 7. Send Encrypted Message
exports.sendFriendMessage = async (req, res) => {
  try {
    let { conversationId, text, friendshipId } = req.body;
    if (!text) {
      return res.status(400).json({ message: 'text is required.' });
    }

    const Conversation = getConversationModel();
    const Message = getMessageModel();
    const Friendship = getFriendshipModel();
    if (!Conversation || !Message || !Friendship) return res.status(500).json({ message: 'Models not loaded' });

    let conversation;
    if (conversationId) {
      conversation = await Conversation.findByPk(conversationId);
    }

    // Fallback: If conversationId is missing or null, resolve/create conversation via friendshipId
    if (!conversation && friendshipId) {
      const friendship = await Friendship.findByPk(friendshipId);
      if (friendship && friendship.status === 'accepted') {
        const participants = [friendship.requesterId, friendship.recipientId];
        // Find or create conversation
        conversation = await Conversation.findOne({
          where: { isGroup: false, participants: JSON.stringify(participants) }
        });
        if (!conversation) {
          conversation = await Conversation.findOne({
            where: { isGroup: false, participants: JSON.stringify([friendship.recipientId, friendship.requesterId]) }
          });
        }
        if (!conversation) {
          conversation = await Conversation.create({
            isGroup: false,
            participants
          });
        }
        conversationId = conversation.id;
      }
    }

    if (!conversation) {
      return res.status(400).json({ message: 'Valid conversationId or friendshipId is required.' });
    }

    // Encrypt cleartext
    const encryptedText = encryptText(text);

    // Save message with 30-day TTL (vanish)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const message = await Message.create({
      conversationId,
      senderId: req.user.id,
      senderName: req.user.name,
      text: encryptedText,
      expiresAt
    });

    // Update conversation lastMessageAt
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Update daily streak
    const parts = conversation.participants;
    const otherUserId = parts.find(p => p !== req.user.id);
    const friendship = await Friendship.findOne({
      where: {
        status: 'accepted',
        [Op.or]: [
          { requesterId: req.user.id, recipientId: otherUserId },
          { requesterId: otherUserId, recipientId: req.user.id }
        ]
      }
    });

    if (friendship) {
      await updateFriendshipStreak(friendship);
    }

    // Broadcast message via socket to room
    const decryptedMessage = {
      ...message.toJSON(),
      text // Decrypted on sender's response
    };

    const io = req.app.get('io');
    if (io) {
      io.to(`conversation-${conversationId}`).emit('new_friend_message', decryptedMessage);
      // Push notification to recipient with actual message content preview
      if (otherUserId) {
        const previewText = text ? (text.length > 50 ? text.substring(0, 50) + '...' : text) : '💬 Sent a sticker';
        await sendPushToUser(
          otherUserId,
          `${req.user.name}`,
          previewText,
          { type: 'NEW_CHAT_MESSAGE', conversationId }
        );
      }
    }

    res.status(201).json(decryptedMessage);
  } catch (error) {
    console.error('[SEND_CHAT_MESSAGE_ERROR]', error);
    res.status(500).json({ message: 'Server error sending message.' });
  }
};

// 8. Get chat history (Decrypted)
exports.getFriendMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const Conversation = getConversationModel();
    const Message = getMessageModel();
    if (!Conversation || !Message) return res.status(500).json({ message: 'Models not loaded' });

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

    if (!conversation.participants.includes(req.user.id)) {
      return res.status(403).json({ message: 'Not a participant of this conversation.' });
    }

    const messages = await Message.findAll({
      where: { conversationId },
      order: [['createdAt', 'ASC']]
    });

    const decrypted = messages.map(m => ({
      ...m.toJSON(),
      text: decryptText(m.text)
    }));

    res.json(decrypted);
  } catch (error) {
    console.error('[GET_CHAT_MESSAGES_ERROR]', error);
    res.status(500).json({ message: 'Server error fetching messages.' });
  }
};

exports.updateFriendshipNickname = async (req, res) => {
  try {
    const Friendship = getFriendshipModel();
    if (!Friendship) return res.status(500).json({ message: 'Models not loaded' });

    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ message: 'Friendship not found' });

    const nickname = (req.body.nickname || '').trim();
    friendship.nickname = nickname || null;
    await friendship.save();

    res.json({ message: 'Nickname updated successfully', nickname: friendship.nickname });
  } catch (error) {
    console.error('[UPDATE_NICKNAME_ERROR]', error);
    res.status(500).json({ message: 'Server error updating nickname.' });
  }
};

// 9. Remove friend from circle
exports.removeFriend = async (req, res) => {
  try {
    const Friendship = getFriendshipModel();
    if (!Friendship) return res.status(500).json({ message: 'Models not loaded' });

    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ message: 'Friendship not found' });

    if (friendship.requesterId !== req.user.id && friendship.recipientId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to remove this friend' });
    }

    await friendship.destroy();
    res.json({ message: 'Friend removed from circle successfully' });
  } catch (error) {
    console.error('[REMOVE_FRIEND_ERROR]', error);
    res.status(500).json({ message: 'Server error removing friend.' });
  }
};

// 10. Send Orbit Nudge
exports.sendFriendNudge = async (req, res) => {
  try {
    const { friendshipId } = req.body;
    if (!friendshipId) return res.status(400).json({ message: 'friendshipId is required.' });

    const Friendship = getFriendshipModel();
    if (!Friendship) return res.status(500).json({ message: 'Models not loaded' });

    const friendship = await Friendship.findByPk(friendshipId);
    if (!friendship) return res.status(404).json({ message: 'Friendship not found.' });

    const otherUserId = friendship.requesterId === req.user.id ? friendship.recipientId : friendship.requesterId;
    await updateFriendshipStreak(friendship);

    const io = req.app.get('io');
    if (io) {
      io.to(`user-${otherUserId}`).emit('friend_nudge', {
        friendshipId,
        senderId: req.user.id,
        senderName: req.user.name,
        streakCount: friendship.streakCount
      });
    }

    await sendPushToUser(
      otherUserId,
      `⚡ ${req.user.name} (Nudge!)`,
      `🔥 Sent a flame nudge! Your streak is ${friendship.streakCount} days.`,
      { type: 'FRIEND_NUDGE', friendshipId }
    );

    res.json({ message: 'Nudge transmitted!', streakCount: friendship.streakCount });
  } catch (error) {
    console.error('[SEND_NUDGE_ERROR]', error);
    res.status(500).json({ message: 'Server error sending nudge.' });
  }
};

// 11. Update User Status (Story/Status feature)
exports.updateUserStatus = async (req, res) => {
  try {
    const { statusText, statusEmoji } = req.body;
    const User = getUserModel();
    if (!User) return res.status(500).json({ message: 'Model not loaded' });

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.statusText = statusText || null;
    user.statusEmoji = statusEmoji || null;
    await user.save();

    // Broadcast status change to all friends list via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('friend_status_updated', {
        userId: req.user.id,
        statusText: user.statusText,
        statusEmoji: user.statusEmoji
      });
    }

    res.json({ message: 'Status updated successfully.', statusText: user.statusText, statusEmoji: user.statusEmoji });
  } catch (error) {
    console.error('[UPDATE_STATUS_ERROR]', error);
    res.status(500).json({ message: 'Server error updating status.' });
  }
};
