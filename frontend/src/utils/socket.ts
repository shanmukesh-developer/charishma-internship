import { io } from 'socket.io-client';
import { API_URL } from './api';

const DEFAULT_SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

// Ensure we don't have trailing slashes for the socket connection if using standard path
const socketUrl = DEFAULT_SOCKET_URL.replace(/\/$/, "");

const getAuthToken = () => {
  if (typeof window === 'undefined') return null;
  try {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      return JSON.parse(storedUser).token || null;
    }
  } catch {}
  return null;
};

export const socket = io(socketUrl, {
  transports: ['websocket', 'polling'], // WebSocket first, polling fallback only
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  timeout: 45000,
  auth: (cb) => {
    cb({ token: getAuthToken() });
  }
});

// Helper to manually refresh/reconnect socket with fresh auth (e.g. after login/logout)
export const refreshSocketAuth = () => {
  if (socket) {
    socket.disconnect().connect();
  }
};

export default socket;
