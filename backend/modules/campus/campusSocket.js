const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getMessageModel } = require('../../models/Message');
const { getConversationModel } = require('../../models/Conversation');
const { getUserModel } = require('../../models/User');
const { getProximityRoomModel, getProximityMessageModel } = require('./models/ProximityRoom');
const { cleanImageRef, isBlockedBetween, pushToUsers } = require('./campusHelpers');
// Zenvy Friends: linked-chat rules (task / Connect / closed chats) and the Friends socket events.
const { conversationGuard } = require('../friends/guards');
const { identityFor, maskFor } = require('../friends/services/connectChatIdentity');
const { registerFriendsSocket } = require('../friends/socket');
// B1 (multi-instance, REDIS_URL set): cross-instance fetchSockets + shared presence. Off otherwise.
const socketCluster = require('../../utils/socketCluster');
const sharedState = require('../../utils/redis').isConfigured() ? require('../../utils/sharedState') : null;

const MESSAGE_TYPES = new Set(['text', 'image', 'voice', 'audio', 'video', 'file', 'poll', 'location', 'sticker', 'gif']);
const MAX_TEXT = 4000;
// Socket packets are capped at 1 MB; a legacy inline data: image must stay well under that.
const MAX_INLINE_DATA_URL = 900 * 1024;

// Push for people who are not in the Campus screen right now, at most one per chat every 20 s.
const PUSH_GAP_MS = 20 * 1000;
const CALL_INVITES_PER_MIN = 10;
const callInviteLog = new Map(); // userId -> [ms]
const takeCallInvite = (userId) => {
  const now = Date.now();
  const recent = (callInviteLog.get(userId) || []).filter((t) => now - t < 60 * 1000);
  if (recent.length >= CALL_INVITES_PER_MIN) { callInviteLog.set(userId, recent); return false; }
  recent.push(now);
  callInviteLog.set(userId, recent);
  if (callInviteLog.size > 20000) {
    for (const [k, list] of callInviteLog) if (!list.length || now - list[list.length - 1] > 60 * 1000) callInviteLog.delete(k);
  }
  return true;
};
// Per-user send limits on this socket (chat messages / edits and proximity messages).
const sockLimiter = require('../friends/services/limiter');
// C2: bad-word filter, moderation / block helpers (lazy: the Friends models load after this module).
const contentFilter = require('../../utils/contentFilter');
const ugcService = () => require('../friends/services/ugc');
const ugcBlockedIds = async (uid) => {
  try { return await ugcService().blockedIds(uid); } catch { return new Set(); }
};
sockLimiter.define('chat_send', 60, 60 * 1000);
sockLimiter.define('chat_edit', 30, 60 * 1000);
sockLimiter.define('proximity_send', 20, 60 * 1000);
const MAX_RECEIPT_IDS = 200;
const lastPushAt = new Map(); // `${userId}:${chatId}` -> ms
const shouldPush = (uid, chatId) => {
  const key = `${uid}:${chatId}`;
  const now = Date.now();
  if (now - (lastPushAt.get(key) || 0) < PUSH_GAP_MS) return false;
  lastPushAt.set(key, now);
  if (lastPushAt.size > 20000) {
    for (const [k, t] of lastPushAt) if (now - t > PUSH_GAP_MS) lastPushAt.delete(k);
  }
  return true;
};
const previewOf = (type, text) => {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t) return t.length > 80 ? `${t.slice(0, 80)}...` : t;
  if (type === 'image') return 'Sent a photo';
  if (type === 'voice' || type === 'audio') return 'Sent a voice note';
  return 'Sent an attachment';
};

const parseJsonField = (val, fallback) => {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
};

// Shown to the client instead of raw database errors.
const SOCKET_ERROR = 'Something went wrong. Please try again.';

// Online presence tracking: userId -> Set of socketIds.
// Module-scoped so REST controllers can read the live count.
const onlineUsers = new Map();

// 1:1 WebRTC call sessions (friends / campus DMs + first-accepter for groups)
const activeCalls = new Map(); // callId -> session
const userCallIndex = new Map(); // userId -> callId
const CALL_RING_MS = 45000;
const DELETE_FOR_EVERYONE_MS = 2 * 24 * 60 * 60 * 1000;

const notifyUsers = (campusNsp, userIds, event, payload) => {
  const seen = new Set();
  for (const uid of userIds) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    campusNsp.to(`user:${uid}`).emit(event, payload);
  }
};

const endCallSession = (campusNsp, call, reason) => {
  if (!call || call.ended) return;
  call.ended = true;
  if (call.timeout) clearTimeout(call.timeout);
  const userIds = [call.callerId, ...(call.calleeIds || []), call.acceptedUserId].filter(Boolean);
  notifyUsers(campusNsp, userIds, 'call:ended', { callId: call.callId, reason: reason || 'ended' });
  for (const uid of userIds) {
    if (userCallIndex.get(uid) === call.callId) userCallIndex.delete(uid);
  }
  activeCalls.delete(call.callId);
};

const getCampusOnlineCount = () => onlineUsers.size;

// Live number of sockets in a proximity room (used by the REST room list).
let campusNspRef = null;
const getProximityLiveCount = (slug) => campusNspRef?.adapter?.rooms?.get('proximity:' + slug)?.size || 0;

const initCampusSocket = (io) => {
  const campusNsp = io.of('/campus');
  // B1: campus presence shared across instances when REDIS_URL is set (push only to users who are
  // not connected to ANY instance). Heartbeat of this instance's online users every 60 s.
  if (sharedState) sharedState.presenceStart(() => onlineUsers.keys());

  // Connect chats (refType 'connect'): every event is masked per receiving socket so the other person
  // only ever appears as their Connect profile id + Connect name (never account id / real name).
  // refType never changes, so whether a chat is a Connect chat is cached per conversation id.
  const connectChatIds = new Map(); // chatId -> conversation (Connect) | null
  const connectIdentForChat = async (chatId, conversation) => {
    if (!chatId) return null;
    let conv = conversation;
    if (!conv) {
      if (connectChatIds.has(String(chatId))) conv = connectChatIds.get(String(chatId));
      else {
        try { conv = await getConversationModel().findByPk(chatId, { attributes: ['id', 'refType', 'participants'] }); } catch { conv = null; }
        if (!conv) return null;
      }
    }
    if (!conv) return null;
    const isConnect = conv.refType === 'connect';
    if (connectChatIds.size > 20000) connectChatIds.clear();
    connectChatIds.set(String(chatId), isConnect ? { id: conv.id, refType: conv.refType, participants: conv.participants } : null);
    return isConnect ? identityFor(conv) : null;
  };
  // skip (C2): user ids that must not get this event (people blocked with the sender in a group chat).
  const emitToChat = async (chatId, event, payload, { conversation, except, skip } = {}) => {
    const room = `chat:${chatId}`;
    const ident = await connectIdentForChat(chatId, conversation);
    const skipping = skip && skip.size > 0;
    if (!ident && !skipping) {
      (except ? except.to(room) : campusNsp.to(room)).emit(event, payload);
      return;
    }
    // B1: every instance's sockets in the chat (Redis adapter); this instance's only if Redis is down.
    const sockets = await socketCluster.fetchSockets(campusNsp.in(room));
    for (const s of sockets) {
      if (except && s.id === except.id) continue;
      const viewer = (s.user && s.user.id) || (s.data && s.data.userId) || null;
      if (skipping && viewer && skip.has(String(viewer))) continue;
      s.emit(event, ident ? maskFor(payload, viewer, ident) : payload);
    }
  };
  campusNspRef = campusNsp;

  // Authentication Middleware for /campus
  campusNsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        return next(new Error('Authentication token required for campus socket'));
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return next(new Error('Server auth configuration error'));
      }

      const decoded = jwt.verify(token, secret);
      const User = getUserModel();
      const user = await User.findByPk(decoded.id);

      if (!user) {
        return next(new Error('User not found'));
      }
      if (user.isActive === false) {
        return next(new Error('Account suspended'));
      }
      if ((Number(decoded.tv) || 0) !== (Number(user.tokenVersion) || 0)) {
        return next(new Error('Session expired. Please sign in again.'));
      }

      socket.user = {
        id: user.id,
        name: user.name,
        role: user.role,
        hostelBlock: user.hostelBlock,
        // Token version, so a password reset / admin sign-out can drop exactly the old sessions
        // (utils/realtime.disconnectRevokedSockets).
        tv: Number(decoded.tv) || 0,
      };
      // B1: visible to fetchSockets() on other instances (socket.user is not).
      socket.data.user = { id: user.id, role: user.role, tv: Number(decoded.tv) || 0 };

      next();
    } catch (err) {
      console.warn('[CAMPUS_SOCKET_AUTH_WARN]', err.message);
      next(new Error('Invalid token'));
    }
  });

  campusNsp.on('connection', (socket) => {
    // Crash shield (same as the main namespace in server.js): handlers destructure their payload,
    // so emit('chat:leave') with no data threw inside process.nextTick → uncaughtException → the
    // production process exited. A missing payload becomes {}, and sync throws / async rejections
    // are logged instead.
    const rawOn = socket.on.bind(socket);
    socket.on = (event, handler) => rawOn(event, (...args) => {
      if (args.length === 0 || args[0] === undefined || args[0] === null) args[0] = {};
      try {
        const result = handler(...args);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => console.error(`[CAMPUS_SOCKET_HANDLER_ERROR] ${event}:`, err && err.message ? err.message : err));
        }
      } catch (err) {
        console.error(`[CAMPUS_SOCKET_HANDLER_ERROR] ${event}:`, err && err.message ? err.message : err);
      }
    });

    const userId = socket.user.id;
    console.log(`💬 [CAMPUS_SOCKET] Connected: ${socket.user.name} (${userId})`);

    // Add to presence
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      if (sharedState) sharedState.presenceMark(userId, true);
    }
    onlineUsers.get(userId).add(socket.id);

    socket.data.userId = userId;

    // Join personal room
    socket.join(`user:${userId}`);

    // Still ringing for this user (they opened the app from the call push)? Ring again.
    const ringingId = userCallIndex.get(userId);
    const ringing = ringingId && activeCalls.get(ringingId);
    if (ringing && !ringing.ended && !ringing.acceptedUserId && ringing.incoming
        && (ringing.calleeIds || []).includes(userId) && !ringing.rejected.has(userId)) {
      socket.emit('call:incoming', ringing.incoming);
    }

    // Presence is not broadcast to every campus user (privacy); nothing in the app consumes it.

    // Membership: only participants of a conversation may join it or act on its messages.
    const isMember = async (chatId) => {
      if (!chatId) return false;
      try {
        const conversation = await getConversationModel().findByPk(chatId);
        return !!conversation && (conversation.participants || []).includes(userId);
      } catch {
        return false;
      }
    };
    const inChatRoom = (chatId) => !!chatId && socket.rooms.has(`chat:${chatId}`);

    // 1. Join Chat Room (members only). Optional ack: { status: 'joined' } | { error }
    socket.on('chat:join', async (data, ack) => {
      const chatId = data?.chatId;
      if (!chatId) return;
      let conversation = null;
      try { conversation = await getConversationModel().findByPk(chatId); } catch { conversation = null; }
      if (!conversation || !(conversation.participants || []).includes(userId)) {
        if (typeof ack === 'function') ack({ error: 'Not a member of this chat' });
        return;
      }
      const guard = await conversationGuard(conversation, userId, 'join');
      if (!guard.ok) {
        if (typeof ack === 'function') ack({ error: guard.error, code: guard.code });
        return;
      }
      socket.join(`chat:${chatId}`);
      if (typeof ack === 'function') ack({ status: 'joined' });
    });

    // 2. Leave Chat Room
    socket.on('chat:leave', ({ chatId }) => {
      if (!chatId) return;
      socket.leave(`chat:${chatId}`);
    });

    // 3. Message Send (WhatsApp-level message dispatch)
    socket.on('message:send', async (data, ack) => {
      try {
        const {
          chatId,
          text,
          clientMsgId,
          type = 'text',
          mediaUrl,
          mediaMetadata,
          replyTo,
        } = data;

        if (!chatId || (!text && !mediaUrl)) {
          if (ack) ack({ error: 'Message content or attachment is required' });
          return;
        }
        if (text != null && typeof text !== 'string') {
          if (ack) ack({ error: 'Message text must be text' });
          return;
        }
        if (typeof text === 'string' && text.length > MAX_TEXT) {
          if (ack) ack({ error: `Messages can be at most ${MAX_TEXT} characters` });
          return;
        }
        const msgType = MESSAGE_TYPES.has(type) ? type : 'text';
        if (!sockLimiter.take(String(userId), 'chat_send').ok) {
          if (ack) ack({ error: 'You are sending messages too fast. Please slow down.', code: 'RATE_LIMITED' });
          return;
        }

        const Conversation = getConversationModel();
        const Message = getMessageModel();

        // Ensure user is participant
        const conversation = await Conversation.findByPk(chatId);
        if (!conversation) {
          if (ack) ack({ error: 'Conversation not found' });
          return;
        }

        const participants = conversation.participants || [];
        if (!participants.includes(userId)) {
          if (ack) ack({ error: 'Not a member of this chat' });
          return;
        }

        // Friends linked chats (task / Connect) and closed chats have their own rules.
        const guard = await conversationGuard(conversation, userId, 'send', { text: typeof text === 'string' ? text : '' });
        if (!guard.ok) {
          if (ack) ack({ error: guard.error, code: guard.code });
          return;
        }

        // Only admins can send check
        if (conversation.onlyAdminsCanSend) {
          const admins = conversation.adminIds || [];
          if (!admins.includes(userId)) {
            if (ack) ack({ error: 'Only admins can send messages in this group' });
            return;
          }
        }

        // 1:1 chats: blocked people cannot message each other.
        if (!conversation.isGroup) {
          const peerId = participants.find((p) => p !== userId);
          if (peerId && await isBlockedBetween(userId, peerId)) {
            if (ack) ack({ error: 'You cannot message this person', code: 'BLOCKED' });
            return;
          }
        }

        // C2: slurs / threats are refused, milder profanity is masked (utils/contentFilter.js).
        let safeText = typeof text === 'string' ? text : '';
        if (safeText) {
          const filtered = contentFilter.analyse(safeText);
          if (filtered.action === 'block') {
            if (ack) ack({ error: contentFilter.BLOCK_MESSAGE, code: 'CONTENT_BLOCKED' });
            return;
          }
          safeText = filtered.text;
        }
        // Group chats: people blocked with the sender (either way) do not get the message live.
        const skipIds = conversation.isGroup ? await ugcBlockedIds(userId) : null;

        // Media is stored only after every membership / guard check (a non-member could otherwise
        // fill the media table). Inline base64 photos move to the media table; the message keeps the URL.
        let cleanMedia = null;
        if (mediaUrl) {
          const { storeImageRef } = require('../../utils/imageStore');
          // S0: our own media (or inline bytes) only: no external links (tracking pixels / IP grabbers), and
          // someone else's private upload is refused by storeImageRef.
          const img = await storeImageRef(mediaUrl, { ownerId: userId, purpose: 'chat', maxBytes: MAX_INLINE_DATA_URL, allowExternal: false });
          cleanMedia = img.ok ? img.value : null;
          if (!cleanMedia) {
            if (ack) ack({ error: 'That photo could not be sent. Please try again.', code: 'BAD_MEDIA' });
            return;
          }
        }

        // Connect chats: the stored and broadcast sender name is the Connect name, and a quoted reply is
        // rebuilt on the server from the quoted message (never the client's copy of a name).
        const connectIdent = await connectIdentForChat(chatId, conversation);
        const senderName = connectIdent ? ((connectIdent.get(String(userId)) || {}).name || 'Connect user') : socket.user.name;
        // A quoted reply is always rebuilt from the quoted message of THIS chat: the client's copy could
        // put words in someone else's mouth (fake senderName / text) or carry an arbitrary blob.
        let cleanReplyTo = null;
        if (replyTo) {
          const quotedId = replyTo && typeof replyTo === 'object' ? replyTo.id : null;
          if (typeof quotedId === 'string' && /^[0-9a-f-]{36}$/i.test(quotedId)) {
            const quoted = await Message.findOne({ where: { id: quotedId, conversationId: chatId } });
            if (quoted) {
              cleanReplyTo = {
                id: quoted.id,
                senderName: connectIdent ? ((connectIdent.get(String(quoted.senderId)) || {}).name || 'Connect user') : (quoted.senderName || 'Student'),
                text: quoted.isDeletedForEveryone ? 'This message was deleted' : String(quoted.text || (quoted.type === 'image' ? 'Photo' : '')).slice(0, 200),
              };
            }
          }
        }

        // Create message in DB
        const newMsg = await Message.create({
          conversationId: chatId,
          senderId: userId,
          senderName,
          text: safeText || '',
          clientMsgId: clientMsgId || null,
          type: msgType,
          mediaUrl: cleanMedia,
          mediaMetadata: mediaMetadata && typeof mediaMetadata === 'object' && JSON.stringify(mediaMetadata).length <= 4096 ? JSON.stringify(mediaMetadata) : '{}',
          replyTo: cleanReplyTo ? JSON.stringify(cleanReplyTo) : null,
          readBy: [{ userId, readAt: new Date() }],
          deliveredTo: [{ userId, deliveredAt: new Date() }],
        });

        // Update conversation lastMessageAt
        conversation.lastMessageAt = new Date();
        await conversation.save();

        const messagePayload = {
          id: newMsg.id,
          chatId,
          senderId: userId,
          senderName,
          text: newMsg.text,
          clientMsgId,
          type: newMsg.type,
          mediaUrl: newMsg.mediaUrl,
          mediaMetadata: parseJsonField(newMsg.mediaMetadata, {}),
          replyTo: parseJsonField(newMsg.replyTo, null),
          createdAt: newMsg.createdAt,
          deliveryStatus: 'sent',
          readBy: newMsg.readBy,
          deliveredTo: newMsg.deliveredTo,
        };

        // S0: chat photos are private media: the room (participants only) gets a signed link.
        if (messagePayload.mediaUrl) {
          const { signMediaFields, CHAT_PURPOSES } = require('../../utils/mediaAccess');
          await signMediaFields(null, messagePayload, ['mediaUrl'], { purposes: CHAT_PURPOSES });
        }

        // Broadcast to chat room
        await emitToChat(chatId, 'message:new', messagePayload, { conversation, skip: skipIds });

        // Notify individual participant personal rooms (for unread badges in chat list)
        const lastMessage = previewOf(newMsg.type, newMsg.text);
        const offline = [];
        for (const pId of participants) {
          if (pId !== userId && !(skipIds && skipIds.has(String(pId)))) {
            campusNsp.to(`user:${pId}`).emit('chat:updated', {
              chatId,
              lastMessage,
              lastSender: senderName,
              time: new Date(),
            });
            if (!onlineUsers.has(pId) && (sharedState || shouldPush(pId, chatId))) offline.push(pId);
          }
        }
        // B1: drop people connected to another instance, then apply the push throttle (as above).
        if (sharedState && offline.length) {
          const reallyOffline = await sharedState.presenceFilterOffline(offline.splice(0));
          for (const pId of reallyOffline) if (shouldPush(pId, chatId)) offline.push(pId);
        }
        if (offline.length) {
          const title = conversation.isGroup ? `${senderName} in ${conversation.name || 'your group'}` : senderName;
          pushToUsers(offline.slice(0, 300), title, lastMessage, {
            type: 'chat_message',
            kind: 'CAMPUS_MESSAGE',
            screen: 'campus_chat',
            chatId,
          }, { persist: false }).catch(() => {});
        }
        // The sender's own chat list (their other devices too): separate event so existing
        // 'chat:updated' listeners never count the user's own message as unread.
        campusNsp.to(`user:${userId}`).emit('chat:self_updated', {
          chatId,
          lastMessage: newMsg.text || 'Attachment',
          lastSender: 'You',
          own: true,
          time: new Date(),
        });

        // Acknowledge back to sender
        if (ack) {
          ack({
            status: 'sent',
            id: newMsg.id,
            createdAt: newMsg.createdAt,
          });
        }
      } catch (err) {
        console.error('[CAMPUS_MESSAGE_SEND_ERR]', err);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    // 4. Typing indicators
    socket.on('typing:start', ({ chatId } = {}) => {
      if (!inChatRoom(chatId)) return;
      emitToChat(chatId, 'typing', {
        chatId,
        userId,
        userName: socket.user.name,
        isTyping: true,
      }, { except: socket }).catch(() => {});
    });

    socket.on('typing:stop', ({ chatId } = {}) => {
      if (!inChatRoom(chatId)) return;
      emitToChat(chatId, 'typing', {
        chatId,
        userId,
        userName: socket.user.name,
        isTyping: false,
      }, { except: socket }).catch(() => {});
    });

    // 5. Message Reactions
    socket.on('message:react', async ({ messageId, emoji }, ack) => {
      try {
        const Message = getMessageModel();
        const msg = await Message.findByPk(messageId);
        if (!msg || !(inChatRoom(msg.conversationId) || await isMember(msg.conversationId))) {
          if (ack) ack({ error: 'Message not found' });
          return;
        }
        if (typeof emoji !== 'string' || !emoji || emoji.length > 16) {
          if (ack) ack({ error: 'Pick a reaction' });
          return;
        }

        let reactions = {};
        try {
          reactions = msg.reactions ? JSON.parse(msg.reactions) : {};
        } catch {
          reactions = {};
        }

        // One reaction per user: if already exists, replace or toggle off
        if (reactions[userId] === emoji) {
          delete reactions[userId];
        } else {
          reactions[userId] = emoji;
        }

        msg.reactions = JSON.stringify(reactions);
        await msg.save();

        await emitToChat(msg.conversationId, 'message:updated', {
          id: msg.id,
          chatId: msg.conversationId,
          reactions,
        });

        if (ack) {
          const ident = await connectIdentForChat(msg.conversationId);
          ack({ status: 'ok', reactions: maskFor(reactions, userId, ident) });
        }
      } catch (err) {
        console.warn('[CAMPUS_REACT_ERR]', err.message);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    // 6. Read Receipts (Batched)
    socket.on('receipt:read', async ({ chatId, messageIds: rawIds }) => {
      let messageIds = rawIds;
      try {
        if (!chatId || !Array.isArray(messageIds) || !messageIds.length) return;
        if (!(inChatRoom(chatId) || await isMember(chatId))) return;
        messageIds = [...new Set(messageIds.filter((id) => typeof id === 'string' && id.length <= 64))].slice(0, MAX_RECEIPT_IDS);
        if (!messageIds.length) return;
        const Message = getMessageModel();
        const { Op } = require('sequelize');

        const messages = await Message.findAll({
          where: {
            id: { [Op.in]: messageIds },
            conversationId: chatId,
          }
        });

        for (const m of messages) {
          const reads = m.readBy || [];
          if (!reads.some(r => r.userId === userId)) {
            reads.push({ userId, readAt: new Date() });
            m.readBy = reads;
            await m.save();
          }
        }

        // Broadcast to chat room that messages have been read
        await emitToChat(chatId, 'receipt:update', {
          chatId,
          userId,
          messageIds,
          readAt: new Date(),
        }, { except: socket });
      } catch (err) {
        console.warn('[RECEIPT_READ_ERR]', err.message);
      }
    });

    // 7. Edit message (Within 15 minutes)
    socket.on('message:edit', async ({ messageId, newText }, ack) => {
      try {
        const Message = getMessageModel();
        const msg = await Message.findByPk(messageId);
        if (!msg || msg.senderId !== userId) {
          if (ack) ack({ error: 'Cannot edit this message' });
          return;
        }

        const ageMs = Date.now() - new Date(msg.createdAt).getTime();
        if (ageMs > 15 * 60 * 1000) {
          if (ack) ack({ error: 'Message can only be edited within 15 minutes' });
          return;
        }

        const cleanText = typeof newText === 'string' ? newText.trim() : '';
        if (!cleanText || msg.isDeletedForEveryone) {
          if (ack) ack({ error: 'Cannot edit this message' });
          return;
        }
        if (cleanText.length > MAX_TEXT) {
          if (ack) ack({ error: `Messages can be at most ${MAX_TEXT} characters` });
          return;
        }
        if (!sockLimiter.take(String(userId), 'chat_edit').ok) {
          if (ack) ack({ error: 'You are editing too fast. Please slow down.', code: 'RATE_LIMITED' });
          return;
        }
        // An edit is a new send: the same membership, closed-chat, block and Connect / task rules
        // (content filter included) apply, or "hi" could be edited into anything after the fact.
        const editConv = await getConversationModel().findByPk(msg.conversationId);
        if (!editConv || !(editConv.participants || []).includes(userId)) {
          if (ack) ack({ error: 'Cannot edit this message' });
          return;
        }
        const editGuard = await conversationGuard(editConv, userId, 'send', { text: cleanText });
        if (!editGuard.ok) {
          if (ack) ack({ error: editGuard.error, code: editGuard.code });
          return;
        }
        if (!editConv.isGroup) {
          const peerId = (editConv.participants || []).find((p) => p !== userId);
          if (peerId && await isBlockedBetween(userId, peerId)) {
            if (ack) ack({ error: 'You cannot message this person', code: 'BLOCKED' });
            return;
          }
        }

        const editFiltered = contentFilter.analyse(cleanText);
        if (editFiltered.action === 'block') {
          if (ack) ack({ error: contentFilter.BLOCK_MESSAGE, code: 'CONTENT_BLOCKED' });
          return;
        }
        msg.text = editFiltered.text;
        msg.isEdited = true;
        msg.editedAt = new Date();
        await msg.save();

        campusNsp.to(`chat:${msg.conversationId}`).emit('message:updated', {
          id: msg.id,
          chatId: msg.conversationId,
          text: msg.text,
          isEdited: true,
          editedAt: msg.editedAt,
        });

        if (ack) ack({ status: 'ok' });
      } catch (err) {
        console.warn('[CAMPUS_EDIT_ERR]', err.message);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    // 8. Delete message (For Everyone within 2 days, or For Me)
    socket.on('message:delete', async ({ messageId, forEveryone }, ack) => {
      try {
        const Message = getMessageModel();
        const msg = await Message.findByPk(messageId);
        if (!msg || !(inChatRoom(msg.conversationId) || await isMember(msg.conversationId))) {
          if (ack) ack({ error: 'Message not found' });
          return;
        }

        if (forEveryone) {
          if (msg.senderId !== userId) {
            if (ack) ack({ error: 'Only the sender can delete for everyone' });
            return;
          }
          if (Date.now() - new Date(msg.createdAt).getTime() > DELETE_FOR_EVERYONE_MS) {
            if (ack) ack({ error: 'Messages can be deleted for everyone only within 2 days' });
            return;
          }

          msg.text = 'This message was deleted';
          msg.isDeletedForEveryone = true;
          msg.mediaUrl = null;
          await msg.save();

          campusNsp.to(`chat:${msg.conversationId}`).emit('message:updated', {
            id: msg.id,
            chatId: msg.conversationId,
            text: 'This message was deleted',
            isDeletedForEveryone: true,
          });
        } else {
          // Delete for me: remembered per user and hidden from this user's history.
          const hiddenFor = parseJsonField(msg.deletedFor, []);
          if (!hiddenFor.includes(userId)) {
            hiddenFor.push(userId);
            msg.deletedFor = JSON.stringify(hiddenFor);
            await msg.save();
          }
        }

        if (ack) ack({ status: 'ok' });
      } catch (err) {
        console.warn('[CAMPUS_DELETE_ERR]', err.message);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    // ── Phase 5: Proximity Rooms (Location-bound Live Chat) ──────────────
    // Track which proximity rooms this socket is in
    const joinedProximityRooms = new Set();

    // Live count = sockets currently in the room (never a stored counter that drifts on restarts).
    const liveProximityCount = (roomSlug) => campusNsp.adapter.rooms.get(`proximity:${roomSlug}`)?.size || 0;
    const announceProximity = (roomSlug, event) => {
      campusNsp.to(`proximity:${roomSlug}`).emit('proximity:presence', {
        roomSlug,
        activeUserCount: liveProximityCount(roomSlug),
        event,
        userName: socket.user.name,
      });
    };

    socket.on('proximity:join', async ({ roomSlug } = {}, ack) => {
      try {
        if (!roomSlug) return;
        if (typeof roomSlug !== 'string' || roomSlug.length > 80) return;
        const room = await getProximityRoomModel().findOne({ where: { slug: roomSlug } });
        // Campus spots belong to one campus (or to every campus when campusId is empty).
        // S0: campus-only spots need a VERIFIED membership of that campus.
        const { spotVisibleTo, verifiedCampusOf } = require('./controllers/proximityController');
        if (!spotVisibleTo(room, room && room.campusId ? await verifiedCampusOf(userId) : null)) {
          if (ack) ack({ error: 'Room not found' });
          return;
        }
        socket.join(`proximity:${roomSlug}`);
        joinedProximityRooms.add(roomSlug);
        announceProximity(roomSlug, 'joined');
        if (ack) ack({ status: 'joined', roomSlug, activeUserCount: liveProximityCount(roomSlug) });
      } catch (err) {
        console.warn('[PROXIMITY_JOIN_ERR]', err.message);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    socket.on('proximity:leave', ({ roomSlug } = {}) => {
      if (!roomSlug) return;
      socket.leave(`proximity:${roomSlug}`);
      joinedProximityRooms.delete(roomSlug);
      announceProximity(roomSlug, 'left');
    });

    socket.on('proximity:message', async ({ roomSlug, text, clientMsgId } = {}, ack) => {
      try {
        if (!roomSlug || typeof text !== 'string' || !text.trim()) {
          if (ack) ack({ error: 'Room slug and text required' });
          return;
        }
        if (!socket.rooms.has(`proximity:${roomSlug}`)) {
          if (ack) ack({ error: 'Join the room first' });
          return;
        }
        if (!sockLimiter.take(String(userId), 'proximity_send').ok) {
          if (ack) ack({ error: 'You are sending messages too fast. Please slow down.', code: 'RATE_LIMITED' });
          return;
        }

        const ProximityRoom = getProximityRoomModel();
        const ProximityMessage = getProximityMessageModel();

        const room = await ProximityRoom.findOne({ where: { slug: roomSlug } });
        // S0: re-check the campus rule on every post (verification can be revoked after joining).
        const { spotVisibleTo, verifiedCampusOf } = require('./controllers/proximityController');
        if (!room || !spotVisibleTo(room, room.campusId ? await verifiedCampusOf(userId) : null)) {
          if (ack) ack({ error: 'Room not found' });
          return;
        }

        // C2: sanctions, slurs / threats (refused) and profanity (masked), like POST .../messages.
        const proxGuard = await ugcService().postGuard(userId);
        if (proxGuard) {
          if (ack) ack({ error: proxGuard.body.message, code: proxGuard.body.code });
          return;
        }
        const proxFiltered = contentFilter.analyse(text.trim().slice(0, 1000));
        if (proxFiltered.action === 'block') {
          if (ack) ack({ error: contentFilter.BLOCK_MESSAGE, code: 'CONTENT_BLOCKED' });
          return;
        }

        const msg = await ProximityMessage.create({
          roomId: room.id,
          senderId: userId,
          senderName: socket.user.name,
          text: proxFiltered.text,
          type: 'text',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        const payload = {
          id: msg.id,
          roomSlug,
          senderId: msg.senderId,
          senderName: msg.senderName,
          text: msg.text,
          type: msg.type,
          createdAt: msg.createdAt,
          clientMsgId: clientMsgId || null,
        };

        // People blocked with the sender (either way) do not get it live (history filters them too).
        const proxSkip = await ugcBlockedIds(userId);
        if (!proxSkip.size) campusNsp.to(`proximity:${roomSlug}`).emit('proximity:newMessage', payload);
        else {
          const sockets = await campusNsp.in(`proximity:${roomSlug}`).fetchSockets();
          for (const sk of sockets) {
            const viewer = (sk.user && sk.user.id) || (sk.data && sk.data.userId) || null;
            if (!viewer || !proxSkip.has(String(viewer))) sk.emit('proximity:newMessage', payload);
          }
        }

        if (ack) ack({ status: 'sent', id: msg.id, createdAt: msg.createdAt });
      } catch (err) {
        console.error('[PROXIMITY_MSG_ERR]', err);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    socket.on('proximity:typing', ({ roomSlug, isTyping } = {}) => {
      if (!roomSlug || !socket.rooms.has(`proximity:${roomSlug}`)) return;
      socket.to(`proximity:${roomSlug}`).emit('proximity:typing', {
        roomSlug,
        userId,
        userName: socket.user.name,
        isTyping: !!isTyping,
      });
    });

    // ── WebRTC 1:1 calls (Friends / Campus chat) ─────────────────────────
    socket.on('call:invite', async ({ chatId, callType }, ack) => {
      try {
        if (!chatId) {
          if (ack) ack({ error: 'chatId required' });
          return;
        }
        if (userCallIndex.has(userId)) {
          if (ack) ack({ error: 'You are already in a call' });
          return;
        }

        const Conversation = getConversationModel();
        const conversation = await Conversation.findByPk(chatId);
        if (!conversation) {
          if (ack) ack({ error: 'Conversation not found' });
          return;
        }
        const participants = conversation.participants || [];
        if (!participants.includes(userId)) {
          if (ack) ack({ error: 'Not a member of this chat' });
          return;
        }

        const callGuard = await conversationGuard(conversation, userId, 'call');
        if (!callGuard.ok) {
          if (ack) ack({ error: callGuard.error, code: callGuard.code });
          return;
        }

        const calleeIds = participants.filter((p) => p !== userId);
        if (!calleeIds.length) {
          if (ack) ack({ error: 'No one to call' });
          return;
        }

        // 1:1 calls follow the same block rule as messages: a blocked person cannot ring.
        if (!conversation.isGroup && await isBlockedBetween(userId, calleeIds[0])) {
          if (ack) ack({ error: 'You cannot call this person', code: 'BLOCKED' });
          return;
        }
        // Ring spam guard: at most CALL_INVITES_PER_MIN invites per caller per minute.
        if (!takeCallInvite(userId)) {
          if (ack) ack({ error: 'Too many calls. Please wait a minute.', code: 'RATE_LIMITED' });
          return;
        }

        for (const cid of calleeIds) {
          if (userCallIndex.has(cid)) {
            if (ack) ack({ error: 'User is busy on another call' });
            return;
          }
        }

        const callId = crypto.randomUUID();
        const session = {
          callId,
          chatId,
          chatName: conversation.isGroup ? (conversation.name || 'Group call') : socket.user.name,
          callerId: userId,
          callerName: socket.user.name,
          calleeIds,
          callType: callType === 'video' ? 'video' : 'voice',
          acceptedUserId: null,
          rejected: new Set(),
          createdAt: Date.now(),
          ended: false,
        };
        session.timeout = setTimeout(() => {
          endCallSession(campusNsp, activeCalls.get(callId), 'missed');
        }, CALL_RING_MS);

        activeCalls.set(callId, session);
        userCallIndex.set(userId, callId);
        calleeIds.forEach((cid) => userCallIndex.set(cid, callId));
        socket.activeCallId = callId;

        const incoming = {
          callId,
          chatId,
          chatName: conversation.isGroup ? (conversation.name || 'Group') : socket.user.name,
          callType: session.callType,
          callerId: userId,
          callerName: socket.user.name,
        };
        session.incoming = incoming;
        notifyUsers(campusNsp, calleeIds, 'call:incoming', incoming);

        // Callees outside the Campus screen get a push; when they open Campus the ring is re-sent.
        let offlineCallees = calleeIds.filter((cid) => !onlineUsers.has(cid));
        if (sharedState) offlineCallees = await sharedState.presenceFilterOffline(offlineCallees); // B1
        if (offlineCallees.length) {
          pushToUsers(offlineCallees.slice(0, 300),
            `Incoming ${session.callType} call`,
            conversation.isGroup ? `${socket.user.name} is calling ${conversation.name || 'your group'}` : `${socket.user.name} is calling you`,
            { type: 'incoming_call', kind: 'CAMPUS_CALL', screen: 'campus_chat', chatId, callId, callType: session.callType },
            { persist: false }).catch(() => {});
        }

        if (ack) ack({ callId, status: 'ringing' });
      } catch (err) {
        console.error('[CAMPUS_CALL_INVITE_ERR]', err);
        if (ack) ack({ error: SOCKET_ERROR });
      }
    });

    socket.on('call:accept', ({ callId }, ack) => {
      const call = activeCalls.get(callId);
      if (!call || call.ended) {
        if (ack) ack({ error: 'Call is no longer available' });
        return;
      }
      if (!call.calleeIds.includes(userId)) {
        if (ack) ack({ error: 'Not invited to this call' });
        return;
      }
      if (call.acceptedUserId) {
        if (ack) ack({ error: 'Call already answered' });
        return;
      }
      if (userCallIndex.has(userId) && userCallIndex.get(userId) !== callId) {
        if (ack) ack({ error: 'Already in another call' });
        return;
      }

      call.acceptedUserId = userId;
      userCallIndex.set(userId, callId);
      socket.activeCallId = callId;
      if (call.timeout) {
        clearTimeout(call.timeout);
        call.timeout = null;
      }

      campusNsp.to(`user:${call.callerId}`).emit('call:accepted', {
        callId,
        userId,
        userName: socket.user.name,
      });

      const others = call.calleeIds.filter((id) => id !== userId);
      notifyUsers(campusNsp, others, 'call:ended', { callId, reason: 'answered_elsewhere' });
      others.forEach((id) => {
        if (userCallIndex.get(id) === callId) userCallIndex.delete(id);
      });

      if (ack) ack({ status: 'ok', callId, peerId: call.callerId, peerName: call.callerName });
    });

    socket.on('call:reject', ({ callId, reason }) => {
      const call = activeCalls.get(callId);
      if (!call || call.ended) return;
      if (!call.calleeIds.includes(userId)) return;

      call.rejected.add(userId);
      if (userCallIndex.get(userId) === callId) userCallIndex.delete(userId);
      campusNsp.to(`user:${call.callerId}`).emit('call:rejected', {
        callId,
        userId,
        userName: socket.user.name,
        reason: reason || 'declined',
      });

      const remaining = call.calleeIds.filter((id) => !call.rejected.has(id));
      if (!call.acceptedUserId && remaining.length === 0) {
        endCallSession(campusNsp, call, reason === 'busy' ? 'busy' : 'declined');
      }
    });

    socket.on('call:end', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const involved = call.callerId === userId || call.acceptedUserId === userId || call.calleeIds.includes(userId);
      if (!involved) return;
      endCallSession(campusNsp, call, 'ended');
    });

    socket.on('call:signal', ({ callId, payload }) => {
      const call = activeCalls.get(callId);
      if (!call || call.ended || !payload) return;

      const involved = userId === call.callerId || userId === call.acceptedUserId;
      if (!involved) return;

      const targetId = userId === call.callerId ? call.acceptedUserId : call.callerId;
      if (!targetId) return;

      campusNsp.to(`user:${targetId}`).emit('call:signal', {
        callId,
        fromUserId: userId,
        payload,
      });
    });

    // Disconnect
    // Friends (Spaces etc.) events share this authenticated socket and the crash shield above.
    registerFriendsSocket(campusNsp, socket);

    socket.on('disconnect', async () => {
      // Socket.IO already removed this socket from its rooms: tell the others the new live count.
      for (const roomSlug of joinedProximityRooms) announceProximity(roomSlug, 'left');
      console.log(`💬 [CAMPUS_SOCKET] Disconnected: ${socket.user.name}`);
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          if (sharedState) sharedState.presenceMark(userId, false);
          const liveCallId = userCallIndex.get(userId);
          if (liveCallId) {
            endCallSession(campusNsp, activeCalls.get(liveCallId), 'disconnect');
          }
        }
      }
    });
  });

  console.log('⚡ [CAMPUS_SOCKET] /campus namespace initialized with full messaging core.');
};

module.exports = { initCampusSocket, getCampusOnlineCount, getProximityLiveCount };
