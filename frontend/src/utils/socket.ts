import { io } from 'socket.io-client';
import { API_URL } from './api';

const DEFAULT_SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

// Ensure we don't have trailing slashes for the socket connection if using standard path
const socketUrl = DEFAULT_SOCKET_URL.replace(/\/$/, "");

export const socket = io(socketUrl, {
  transports: ['websocket', 'polling'], // WebSocket first, polling fallback only
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  timeout: 45000,
});

export default socket;
