const { Op } = require('sequelize');
const { getConversationModel } = require('../models/Conversation');
const { getMessageModel } = require('../models/Message');
const { decryptText } = require('../utils/crypto');
const { isAfterDarkNow, afterDarkStatus } = require('../utils/afterDark');
const { getAfterDarkAccess } = require('../utils/afterDarkAccess');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Zenvy After Dark is open during the configured IST window (utils/afterDark.js:
// AFTER_DARK_START_HOUR / AFTER_DARK_END_HOUR, default 22:00-04:00, or AFTER_DARK_ALWAYS_OPEN=true).
const checkAfterDarkHours = async (req, res, next) => {
  // C2: admin kill switch (GlobalConfig AFTER_DARK_ENABLED, utils/featureSwitches.js) wins over the hours.
  const switches = require('../utils/featureSwitches');
  if (!(await switches.isOn('afterDark'))) return res.status(403).json(switches.offBody('afterDark'));
  if (isAfterDarkNow()) return next();
  const status = afterDarkStatus();
  return res.status(403).json({
    code: 'AFTER_DARK_CLOSED',
    message: `ZCS After Dark opens at ${status.opensAt} IST. See you tonight!`,
    ...status,
  });
};

// GET /api/chat/status — public opening hours (no gate)
const getAfterDarkStatus = async (req, res) => {
  const enabled = await require('../utils/featureSwitches').isOn('afterDark');
  const status = afterDarkStatus();
  // Additive: older apps read { open, opensAt, closesAt }; switched off reads as closed.
  res.json({ ...status, open: enabled && status.open, enabled });
};

const serializeMessage = (m) => {
  const json = typeof m.toJSON === 'function' ? m.toJSON() : m;
  let replyTo = json.replyTo;
  if (typeof replyTo === 'string') {
    try { replyTo = JSON.parse(replyTo); } catch { replyTo = null; }
  }
  return { ...json, text: decryptText(json.text), replyTo: replyTo || null };
};

// S0 (P1-1): this legacy list used to return every Conversation row the caller is in, raw: Connect / task
// chats (participants = the real account ids behind a Connect alias), group join codes and admin lists.
// Now: linked chats (refType task / Connect) are left out (they live in Friends > Connect / Tasks, which
// mask identities), and group internals are only for that group's admins.
const legacyConversationJson = (c, userId) => {
  const j = typeof c.toJSON === 'function' ? c.toJSON() : { ...c };
  const admins = Array.isArray(j.adminIds) ? j.adminIds.map(String) : [];
  if (j.isGroup && !admins.includes(String(userId))) {
    const count = Array.isArray(j.participants) ? j.participants.length : 0;
    delete j.participants;
    delete j.joinCode;
    delete j.adminIds;
    j.participantCount = count;
  }
  j.groupAvatar = typeof j.groupAvatar === 'string' && j.groupAvatar.startsWith('data:') ? null : (j.groupAvatar || null);
  return { ...j, _id: j.id };
};

const getConversations = async (req, res) => {
  try {
    const Conversation = getConversationModel();

    // participants is serialized JSON text: narrow with LIKE, then confirm exact membership
    const convos = await Conversation.findAll({
      where: { participants: { [Op.like]: `%${req.user.id}%` }, refType: null },
      order: [['lastMessageAt', 'DESC']]
    });

    res.json(convos
      .filter(c => (c.participants || []).includes(req.user.id) && !c.refType)
      .map(c => legacyConversationJson(c, req.user.id)));
  } catch (error) {
    console.error('[CHAT_GET_CONVOS_ERROR]', error);
    res.status(500).json({ message: 'Could not load your chats right now.' });
  }
};

// GET /api/chat/conversations/:conversationId/messages?limit=50&before=<ISO date>
// The id is an After Dark chat (accepted Friendship id or lounge Room id) or a Conversation
// the caller participates in. Returns decrypted messages, oldest first.
// S0 (P1-1): same rules as GET /api/campus/chats/:id/messages: linked chats go through conversationGuard
// and Connect identity masking, expired / deleted-for-me messages are left out, deleted / moderated
// messages never show their content, group messages from blocked people are left out, and chat photos
// come back as signed links.
const getMessages = async (req, res) => {
  try {
    const conversationId = String(req.params.conversationId || '').trim();
    if (!UUID_PATTERN.test(conversationId)) {
      return res.status(404).json({ code: 'CHAT_NOT_FOUND', message: 'This chat does not exist.' });
    }

    let allowed = !!(await getAfterDarkAccess(req.user.id, conversationId));
    let convo = null;
    if (!allowed) {
      convo = await getConversationModel().findByPk(conversationId);
      allowed = !!convo && (convo.participants || []).includes(req.user.id);
    }
    if (!allowed) {
      return res.status(403).json({ code: 'NOT_A_PARTICIPANT', message: 'You are not part of this chat.' });
    }
    let ident = null;
    if (convo) {
      const { conversationGuard } = require('../modules/friends/guards');
      const guard = await conversationGuard(convo, req.user.id, 'join');
      if (!guard.ok) return res.status(403).json({ code: guard.code, message: guard.error });
      ident = await require('../modules/friends/services/connectChatIdentity').identityFor(convo);
    }

    const uid = String(req.user.id);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const where = {
      conversationId,
      [Op.and]: [
        { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] },
        { [Op.or]: [{ deletedFor: null }, { deletedFor: { [Op.notLike]: `%${uid}%` } }] },
      ],
    };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) where.createdAt = { [Op.lt]: before };
    }

    const messages = await getMessageModel().findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit
    });

    let rows = messages.reverse().map(serializeMessage).map((m) => {
      delete m.deletedFor;
      if (m.isDeletedForEveryone) {
        return { ...m, text: 'This message was deleted', mediaUrl: null, attachmentUrl: null, mediaMetadata: null, replyTo: null };
      }
      return m;
    });
    if (convo && convo.isGroup) {
      const blocked = await require('../modules/friends/services/ugc').blockedIds(req.user.id);
      if (blocked.size) rows = rows.filter((m) => !blocked.has(String(m.senderId)));
    }
    const { signMediaFields, CHAT_PURPOSES } = require('../utils/mediaAccess');
    await signMediaFields(req, rows, ['mediaUrl', 'attachmentUrl'], { purposes: CHAT_PURPOSES });
    if (ident) {
      const { maskFor } = require('../modules/friends/services/connectChatIdentity');
      rows = maskFor(rows, req.user.id, ident);
    }
    res.json(rows);
  } catch (error) {
    console.error('[CHAT_GET_MESSAGES_ERROR]', error);
    res.status(500).json({ message: 'Could not load messages right now.' });
  }
};

// POST /api/chat/groups { name, participants: [userId] } — only accepted friends can be added.
const createGroup = async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    const requested = Array.isArray(req.body?.participants) ? req.body.participants : [];
    if (!name) return res.status(400).json({ message: 'Give your group a name.' });

    const others = [...new Set(requested.map(String).filter(id => UUID_PATTERN.test(id) && id !== req.user.id))].slice(0, 49);
    if (others.length === 0) return res.status(400).json({ message: 'Add at least one friend to the group.' });

    const { getFriendshipModel } = require('../models/Friendship');
    const friendships = await getFriendshipModel().findAll({
      where: {
        status: 'accepted',
        [Op.or]: [
          { requesterId: req.user.id, recipientId: { [Op.in]: others } },
          { recipientId: req.user.id, requesterId: { [Op.in]: others } }
        ]
      }
    });
    const friendIds = new Set(friendships.map(f => (f.requesterId === req.user.id ? f.recipientId : f.requesterId)));
    const notFriends = others.filter(id => !friendIds.has(id));
    if (notFriends.length > 0) {
      return res.status(403).json({ code: 'NOT_FRIENDS', message: 'You can only add your friends to a group.' });
    }

    const group = await getConversationModel().create({
      isGroup: true,
      name,
      participants: [req.user.id, ...others]
    });

    res.status(201).json(group);
  } catch (error) {
    console.error('[CHAT_CREATE_GROUP_ERROR]', error);
    res.status(500).json({ message: 'Could not create the group right now.' });
  }
};

module.exports = {
  checkAfterDarkHours,
  getAfterDarkStatus,
  getConversations,
  getMessages,
  createGroup
};
