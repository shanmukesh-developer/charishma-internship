import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../../constants/api';
import { getToken } from '../../utils/auth';

const baseUrl = SOCKET_URL.replace(/\/$/, '');
const campusSocketUrl = `${baseUrl}/campus`;

let _campusSocket: Socket | null = null;

/** How long we wait for the server to acknowledge an emit before giving up. */
const ACK_TIMEOUT_MS = 15000;
const ACK_TIMEOUT_MESSAGE = "Couldn't reach Campus. Check your connection and try again.";

// Rooms this client has joined. socket.io rooms live on the server-side socket, so
// after any reconnect (network change, app resume, server deploy) they must be re-joined
// or open chats silently stop receiving live messages.
const joinedChats = new Set<string>();
const joinedProximity = new Set<string>();
// Rooms whose join was already sent on the current connection (incl. buffered emits).
const sentThisConnection = new Set<string>();

export type CampusConnectionState = 'connecting' | 'connected' | 'disconnected' | 'unauthorized';
let _connectionState: CampusConnectionState = 'disconnected';
const connectionListeners = new Set<(state: CampusConnectionState) => void>();

const setConnectionState = (state: CampusConnectionState) => {
  if (_connectionState === state) return;
  _connectionState = state;
  connectionListeners.forEach((cb) => {
    try {
      cb(state);
    } catch {}
  });
};

export const getCampusConnectionState = () => _connectionState;

/** Subscribe to socket connection state. Returns an unsubscribe function. */
export const subscribeCampusConnection = (cb: (state: CampusConnectionState) => void) => {
  connectionListeners.add(cb);
  return () => {
    connectionListeners.delete(cb);
  };
};

const trackOutgoing = (event: string, ...args: any[]) => {
  const payload = args[0] || {};
  if (event === 'chat:join' && payload.chatId) {
    joinedChats.add(String(payload.chatId));
    sentThisConnection.add(`chat:${payload.chatId}`);
  } else if (event === 'chat:leave' && payload.chatId) {
    joinedChats.delete(String(payload.chatId));
  } else if (event === 'proximity:join' && payload.roomSlug) {
    joinedProximity.add(String(payload.roomSlug));
    sentThisConnection.add(`proximity:${payload.roomSlug}`);
  } else if (event === 'proximity:leave' && payload.roomSlug) {
    joinedProximity.delete(String(payload.roomSlug));
  }
};

export const getCampusSocket = (): Socket => {
  if (!_campusSocket) {
    const s = io(campusSocketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 30000,
      auth: (cb) => {
        getToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: null }));
      },
    });

    s.onAnyOutgoing(trackOutgoing);

    s.on('connect', () => {
      setConnectionState('connected');
      // Re-join every room that this connection hasn't already (re)joined.
      joinedChats.forEach((chatId) => {
        if (!sentThisConnection.has(`chat:${chatId}`)) s.emit('chat:join', { chatId });
      });
      joinedProximity.forEach((roomSlug) => {
        if (!sentThisConnection.has(`proximity:${roomSlug}`)) s.emit('proximity:join', { roomSlug });
      });
    });

    s.on('disconnect', () => {
      sentThisConnection.clear();
      setConnectionState(s.active ? 'connecting' : 'disconnected');
    });

    s.on('connect_error', (err: any) => {
      const msg = String(err?.message || '');
      if (/token|not found|auth/i.test(msg) && !s.active) {
        // Server middleware rejected us (expired / missing token). Don't loop; the next
        // connectCampusSocket() call after sign-in will retry with the fresh token.
        setConnectionState('unauthorized');
      } else {
        setConnectionState('connecting');
      }
    });

    _campusSocket = s;
  }
  return _campusSocket;
};

export const connectCampusSocket = (): Socket => {
  const s = getCampusSocket();
  if (!s.connected && !s.active) {
    setConnectionState('connecting');
    s.connect();
  }
  return s;
};

/** Tear down the campus socket (call on logout so the next user gets a fresh identity). */
export const disconnectCampusSocket = () => {
  joinedChats.clear();
  joinedProximity.clear();
  sentThisConnection.clear();
  if (_campusSocket) {
    try {
      _campusSocket.offAnyOutgoing(trackOutgoing);
      _campusSocket.removeAllListeners();
      _campusSocket.disconnect();
    } catch {}
    _campusSocket = null;
  }
  setConnectionState('disconnected');
};

/** Emit with an ack that rejects on server error or after ACK_TIMEOUT_MS. */
const emitWithAck = <T = any>(event: string, payload: any): Promise<T> =>
  new Promise((resolve, reject) => {
    const s = connectCampusSocket();
    s.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: any, res: any) => {
      if (err) reject(new Error(ACK_TIMEOUT_MESSAGE));
      else if (res && res.error) {
        const e: any = new Error(String(res.error));
        if (res.code) e.code = res.code;
        reject(e);
      }
      else resolve(res);
    });
  });

export const joinCampusChat = (chatId: string) => {
  const s = connectCampusSocket();
  s.emit('chat:join', { chatId });
};

export const leaveCampusChat = (chatId: string) => {
  joinedChats.delete(String(chatId));
  const s = getCampusSocket();
  if (s.connected) {
    s.emit('chat:leave', { chatId });
  }
};

export const sendCampusMessage = (
  chatId: string,
  payload: {
    text?: string;
    type?: 'text' | 'image' | 'video' | 'audio' | 'doc' | 'poll';
    mediaUrl?: string;
    mediaMetadata?: any;
    replyTo?: any;
    clientMsgId?: string;
  }
): Promise<{ status: string; id: string; createdAt: string }> =>
  emitWithAck('message:send', { chatId, ...payload });

export const sendCampusTyping = (chatId: string, isTyping: boolean) => {
  const s = getCampusSocket();
  if (s.connected) {
    s.emit(isTyping ? 'typing:start' : 'typing:stop', { chatId });
  }
};

// Reactions, receipts and call rejects must not be dropped when the socket is still
// connecting: socket.io buffers emits until the connection is up.
export const sendCampusReaction = (messageId: string, emoji: string) => {
  connectCampusSocket().emit('message:react', { messageId, emoji });
};

export const markCampusMessagesRead = (chatId: string, messageIds: string[]) => {
  if (!chatId || !messageIds?.length) return;
  connectCampusSocket().emit('receipt:read', { chatId, messageIds });
};

export const editCampusMessage = (messageId: string, newText: string): Promise<void> =>
  emitWithAck('message:edit', { messageId, newText }).then(() => undefined);

export const deleteCampusMessage = (messageId: string, forEveryone: boolean): Promise<void> =>
  emitWithAck('message:delete', { messageId, forEveryone }).then(() => undefined);

export const inviteCampusCall = (
  chatId: string,
  callType: 'voice' | 'video'
): Promise<{ callId: string; status: string }> => emitWithAck('call:invite', { chatId, callType });

export const acceptCampusCall = (callId: string): Promise<any> => emitWithAck('call:accept', { callId });

export const rejectCampusCall = (callId: string, reason?: string) => {
  connectCampusSocket().emit('call:reject', { callId, reason });
};

export const endCampusCall = (callId: string) => {
  const s = getCampusSocket();
  if (s.connected || s.active) s.emit('call:end', { callId });
};
