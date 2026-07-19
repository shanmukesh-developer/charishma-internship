import { io, Socket } from 'socket.io-client';
import { API_URL } from '../constants/api';
import { getToken } from './auth';

const socketUrl = API_URL.replace(/\/$/, "");

// ── Lazy Socket ─────────────────────────────────────────────────────────────
// Do NOT auto-connect on import — this caused the 12000ms timeout crash
// because the Render backend cold-starts slowly. Instead, connect only
// when a screen explicitly needs realtime (e.g. order tracking).
let _socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!_socket) {
    _socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: false,          // <── KEY: don't connect on creation
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 45000,
      auth: (cb) => {
        getToken().then(token => cb({ token }));
      }
    });
  }
  return _socket;
};

export const connectSocket = (): Socket => {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
};

export const refreshSocketAuth = () => {
  const s = getSocket();
  s.disconnect().connect();
};

// Legacy default export — returns a lazy socket (not auto-connected)
export default { get socket() { return getSocket(); } };
