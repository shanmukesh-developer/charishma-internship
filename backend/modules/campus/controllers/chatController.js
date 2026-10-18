const { Op } = require('sequelize');
const { getConversationModel } = require('../../../models/Conversation');
const { getMessageModel } = require('../../../models/Message');
const { getUserModel } = require('../../../models/User');
const { readableText, avatarUrlFor, absolutize } = require('../campusHelpers');
const { conversationGuard } = require('../../friends/guards');
const { identityFor, maskFor } = require('../../friends/services/connectChatIdentity');

const PAGE_SIZE = 30;

const parseJson = (val, fallback) => {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const readByOther = (list, userId) =>
  (Array.isArray(list) ? list : []).some((entry) => {
    const id = entry && typeof entry === 'object' ? entry.userId : entry;
    return id && id !== userId;
  });

// Delivery status only matters for the current user's own messages.
const computeDeliveryStatus = (msg, userId) => {
  if (msg.senderId !== userId) return undefined;
  if (readByOther(parseJson(msg.readBy, []), userId)) return 'read';
  if (readByOther(parseJson(msg.deliveredTo, []), userId)) return 'delivered';
  return 'sent';
};

const serializeMessage = (msg, userId) => ({
  id: msg.id,
  senderId: msg.senderId,
  senderName: msg.senderName,
  // Friend DMs sent through /api/friends/message are stored encrypted; show the real text.
  text: msg.isDeletedForEveryone ? 'This message was deleted' : readableText(msg.text),
  type: msg.type || 'text',
  // A deleted / moderator-removed message never exposes its media link (B4).
  mediaUrl: msg.isDeletedForEveryone ? undefined : (msg.mediaUrl || msg.attachmentUrl || undefined),
  replyTo: parseJson(msg.replyTo, null) || undefined,
  reactions: parseJson(msg.reactions, {}) || {},
  isEdited: !!msg.isEdited,
  isDeletedForEveryone: !!msg.isDeletedForEveryone,
  deliveryStatus: computeDeliveryStatus(msg, userId),
  createdAt: msg.createdAt,
});

// @desc    List the current user's campus conversations with last-message + unread count
// @route   GET /api/campus/chats
const getChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const Conversation = getConversationModel();
    const Message = getMessageModel();
    const User = getUserModel();

    const conversations = await Conversation.findAll({
      where: { participants: { [Op.like]: `%${userId}%` } },
      order: [['lastMessageAt', 'DESC']],
      raw: true,
    });

    // Op.like on serialized JSON can false-positive on UUID substrings; verify real membership.
    // Zenvy Friends linked chats: ?scope=connect lists only open Connect chats (Friends > Connect);
    // the default Chats list hides Connect chats and closed task chats.
    const scope = req.query && req.query.scope === 'connect' ? 'connect' : 'chats';
    const mine = conversations
      .map((c) => ({ ...c, participants: parseJson(c.participants, []) }))
      .filter((c) => (c.participants || []).includes(userId))
      .filter((c) => {
        const ref = c.refType || null;
        if (scope === 'connect') return ref === 'connect' && !c.closedAt;
        if (ref === 'connect') return false;
        if (ref && c.closedAt) return false;
        return true;
      });

    // Batch-resolve DM peers (name + avatar) in one query.
    // Connect chats never resolve the peer's account (name / avatar / id): Connect name + profile id only.
    const connectIdent = {};
    await Promise.all(mine.filter((c) => c.refType === 'connect').map(async (c) => {
      connectIdent[c.id] = await identityFor(c);
    }));
    const peerIds = new Set();
    for (const c of mine) {
      if (!c.isGroup && c.refType !== 'connect') {
        const peer = (c.participants || []).find((p) => p !== userId);
        if (peer) peerIds.add(peer);
      }
    }
    const peersById = {};
    if (peerIds.size) {
      const peers = await User.findAll({
        where: { id: { [Op.in]: [...peerIds] } },
        attributes: ['id', 'name', 'profileImage'],
      });
      for (const p of peers) peersById[p.id] = p;
    }

    // Last message + unread count for every chat, fetched in parallel (not one chat at a time).
    const visible = { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] };
    const stats = await Promise.all(mine.map((c) => Promise.all([
      Message.findOne({ where: { conversationId: c.id, ...visible }, order: [['createdAt', 'DESC']] }),
      Message.count({
        where: {
          conversationId: c.id,
          senderId: { [Op.ne]: userId },
          readBy: { [Op.notLike]: '%' + userId + '%' },
          ...visible,
        },
      }),
    ])));

    const chats = [];
    mine.forEach((c, idx) => {
      const [lastMsg, unreadCount] = stats[idx];
      const isDm = !c.isGroup;
      let name = c.name;
      let avatarUrl = c.groupAvatar || null;
      if (isDm) {
        const peerId = (c.participants || []).find((p) => p !== userId);
        const peer = peerId ? peersById[peerId] : null;
        name = peer?.name || 'Direct Message';
        // Never inline a base64 avatar in the list (it made this response megabytes).
        avatarUrl = peer ? avatarUrlFor(req, peer) : null;
      } else {
        avatarUrl = absolutize(req, avatarUrl);
      }

      let preview = '';
      if (lastMsg) {
        if (lastMsg.isDeletedForEveryone) preview = 'This message was deleted';
        else preview = readableText(lastMsg.text) || (lastMsg.mediaUrl || lastMsg.attachmentUrl ? (lastMsg.type === 'image' ? 'Photo' : 'Attachment') : '');
      }

      const ident = connectIdent[c.id];
      if (ident) {
        const peerId = (c.participants || []).find((p) => p !== userId);
        const peer = (peerId && ident.get(String(peerId))) || { alias: null, name: 'Connect user' };
        const fromMe = lastMsg && lastMsg.senderId === userId;
        chats.push({
          id: c.id,
          name: peer.name,
          type: c.type || 'dm',
          isGroup: false,
          avatarUrl: null,
          peerId: peer.alias,
          lastMessage: typeof preview === 'string' ? preview.slice(0, 160) : '',
          lastSenderId: lastMsg ? (fromMe ? userId : peer.alias) : null,
          lastSender: lastMsg ? (fromMe ? 'You' : peer.name) : null,
          lastMessageAt: c.lastMessageAt,
          unreadCount,
          refType: c.refType,
          refId: c.refId || null,
          closedAt: c.closedAt || null,
        });
        return;
      }

      chats.push({
        id: c.id,
        name,
        type: c.type || (isDm ? 'dm' : 'club'),
        isGroup: !!c.isGroup,
        avatarUrl,
        peerId: isDm ? ((c.participants || []).find((p) => p !== userId) || null) : null,
        lastMessage: typeof preview === 'string' ? preview.slice(0, 160) : '',
        lastSenderId: lastMsg?.senderId || null,
        lastSender: lastMsg ? (lastMsg.senderId === userId ? 'You' : lastMsg.senderName) : null,
        lastMessageAt: c.lastMessageAt,
        unreadCount,
        refType: c.refType || null,
        refId: c.refId || null,
        closedAt: c.closedAt || null,
      });
    });

    res.json({ chats });
  } catch (err) {
    console.error('[CAMPUS_GET_CHATS_ERR]', err);
    res.status(500).json({ message: 'Failed to load chats' });
  }
};

// @desc    Cursor-paginated message history for one conversation (membership-checked)
// @route   GET /api/campus/chats/:id/messages?cursor=&limit=
const getChatMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const Conversation = getConversationModel();
    const Message = getMessageModel();

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    if (!(conversation.participants || []).includes(userId)) {
      return res.status(403).json({ message: 'Not a member of this chat' });
    }
    // Linked chats (task / Connect) have their own read rules: an ended Connect match leaves both views.
    const guard = await conversationGuard(conversation, userId, 'join');
    if (!guard.ok) {
      return res.status(403).json({ message: guard.error, code: guard.code });
    }
    const ident = await identityFor(conversation);

    const limit = Math.min(parseInt(req.query.limit, 10) || PAGE_SIZE, 100);

    const where = {
      conversationId,
      [Op.and]: [
        { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] },
        // Hide messages this user deleted for themselves
        { [Op.or]: [{ deletedFor: null }, { deletedFor: { [Op.notLike]: '%' + userId + '%' } }] },
      ],
    };
    if (req.query.cursor) {
      const cursorDate = new Date(req.query.cursor);
      if (!isNaN(cursorDate.getTime())) where.createdAt = { [Op.lt]: cursorDate };
    }

    const rows = await Message.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: limit + 1,
      raw: true,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    let ascending = page.slice().reverse();
    const nextCursor = hasMore && page.length ? page[page.length - 1].createdAt : null;
    // C2: in group chats, messages from people blocked either way are left out (the cursor still
    // advances over them). 1:1 chats with a blocked person cannot get new messages at all.
    if (conversation.isGroup) {
      const blocked = await require('../../friends/services/ugc').blockedIds(userId);
      if (blocked.size) ascending = ascending.filter((m) => !blocked.has(String(m.senderId)));
    }

    // S0: chat photos are private media: participants get short-lived signed links.
    const serialized = ascending.map((m) => serializeMessage(m, userId));
    const { signMediaFields, CHAT_PURPOSES } = require('../../../utils/mediaAccess');
    await signMediaFields(req, serialized, ['mediaUrl'], { purposes: CHAT_PURPOSES });

    res.json({
      messages: serialized.map((m) => maskFor(m, userId, ident)),
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error('[CAMPUS_GET_MESSAGES_ERR]', err);
    res.status(500).json({ message: 'Failed to load messages' });
  }
};

module.exports = {
  getChats,
  getChatMessages,
};
