import { io, Socket } from 'socket.io-client';
import { AppState } from 'react-native';
import { SOCKET_URL } from '../constants/api';
import { getToken } from './auth';
import { reportSocketError, socketVersionAuth } from './forceUpdate';

const socketUrl = SOCKET_URL.replace(/\/$/, "");

// ── Lazy Socket ─────────────────────────────────────────────────────────────
// Do NOT auto-connect on import — this caused the 12000ms timeout crash
// because the Render backend cold-starts slowly. Instead, connect only
// when a screen explicitly needs realtime (e.g. order tracking).
let _socket: Socket | null = null;

// Rooms this client joined (order tracking, mega-basket rooms). socket.io rooms live on the
// server-side socket, so after any reconnect they are re-joined here even when a screen forgot to.
// Bounded so a long session does not keep re-joining dozens of old orders.
const MAX_REMEMBERED_ROOMS = 20;
const joinedRooms = new Map<string, { event: 'joinOrder' | 'joinRoom'; room: string }>();
const sentThisConnection = new Set<string>();

const trackOutgoing = (event: string, ...args: any[]) => {
  if (event !== 'joinOrder' && event !== 'joinRoom') return;
  const room = args[0];
  if (typeof room !== 'string' && typeof room !== 'number') return;
  const key = `${event}:${room}`;
  joinedRooms.delete(key); // re-insert = most recent last
  joinedRooms.set(key, { event, room: String(room) });
  while (joinedRooms.size > MAX_REMEMBERED_ROOMS) {
    const oldest = joinedRooms.keys().next().value;
    if (oldest === undefined) break;
    joinedRooms.delete(oldest);
  }
  sentThisConnection.add(key);
};

// A refusal by a server middleware (SERVER_STARTING during a redeploy, a transient auth lookup
// failure) is NOT retried by socket.io itself (socket.active becomes false), so the app used to stay
// offline until restarted. Retry with the server's retryAfter or a growing delay (max 30 s), bounded.
const MAX_MANUAL_RETRIES = 12;
let manualRetries = 0;
let manualRetryTimer: ReturnType<typeof setTimeout> | null = null;
const clearManualRetry = () => {
  if (manualRetryTimer) clearTimeout(manualRetryTimer);
  manualRetryTimer = null;
};

export const getSocket = (): Socket => {
  if (!_socket) {
    const s = io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: false,          // <── KEY: don't connect on creation
      reconnection: true,
      // Never give up: a Render cold start / redeploy can take well over a minute, and screens
      // already mounted (useLiveSync) only get data:changed again once this socket is back.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 45000,
      // appName / appVersion / appBuild: the server refuses a retired app version (force update).
      auth: (cb) => {
        getToken().then(token => cb({ token, ...socketVersionAuth() })).catch(() => cb({ ...socketVersionAuth() }));
      }
    });
    s.onAnyOutgoing(trackOutgoing);
    s.on('connect', () => {
      manualRetries = 0;
      clearManualRetry();
      joinedRooms.forEach(({ event, room }, key) => {
        if (!sentThisConnection.has(key)) s.emit(event, room);
      });
    });
    s.on('disconnect', () => { sentThisConnection.clear(); });
    s.on('connect_error', (err: Error & { data?: { retryAfter?: number } }) => {
      // socket.io keeps retrying transport errors on its own (active stays true).
      // This app version was retired: show the Update screen, never retry.
      if (reportSocketError(err)) return;
      if (s.active || manualRetryTimer) return;
      const msg = String(err?.message || '');
      // A suspended / deleted account will never be let in: retrying only spins the radio.
      if (/suspended|not found/i.test(msg)) return;
      if (manualRetries >= MAX_MANUAL_RETRIES) return;
      const hinted = Number(err?.data?.retryAfter) * 1000;
      const wait = Number.isFinite(hinted) && hinted > 0 ? hinted : Math.min(30000, 2000 * 2 ** manualRetries);
      manualRetries++;
      manualRetryTimer = setTimeout(() => {
        manualRetryTimer = null;
        if (_socket === s && !s.connected && !s.active) s.connect();
      }, wait);
    });
    _socket = s;
  }
  return _socket;
};

export const connectSocket = (): Socket => {
  const s = getSocket();
  if (!s.connected && !s.active) {
    // An explicit connect (screen mount, app resume) earns a fresh retry budget.
    manualRetries = 0;
    clearManualRetry();
    s.connect();
  }
  return s;
};

// ── Background pause ────────────────────────────────────────────────────────
// The shared socket used to stay up (and keep its endless reconnect loop running every 2-10 s) while
// the app sat in the background, waking the JS thread and the radio for nothing: pushes cover the
// background. 30 s after the app leaves the screen it is closed; on return it reconnects, rooms are
// re-joined on 'connect' and useLiveSync refetches the visible screen (its normal reconnect path).
const BACKGROUND_DISCONNECT_MS = 30000;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let pausedForBackground = false;
try {
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      if (backgroundTimer || !_socket || !(_socket.connected || _socket.active)) return;
      backgroundTimer = setTimeout(() => {
        backgroundTimer = null;
        const s = _socket;
        if (!s || AppState.currentState !== 'background' || !(s.connected || s.active)) return;
        pausedForBackground = true;
        clearManualRetry();
        s.disconnect();
      }, BACKGROUND_DISCONNECT_MS);
      return;
    }
    if (state !== 'active') return;
    if (backgroundTimer) { clearTimeout(backgroundTimer); backgroundTimer = null; }
    if (pausedForBackground) {
      pausedForBackground = false;
      const s = _socket;
      if (s && !s.connected && !s.active) {
        manualRetries = 0;
        s.connect();
      }
    }
  });
} catch {
  // AppState unavailable (tests): the socket simply stays as it is.
}

export const refreshSocketAuth = () => {
  const s = getSocket();
  s.disconnect().connect();
};

/**
 * The server fixes a socket's identity at the handshake. After login/logout, re-handshake
 * a socket that is in use so it carries the new token (the auth callback re-reads it).
 * Screens' listeners stay attached; room joins should be re-emitted on 'connect'.
 */
export const reconnectSocketWithFreshAuth = () => {
  if (!_socket) return;
  // The previous account's order rooms must not be re-joined for the next one.
  joinedRooms.clear();
  sentThisConnection.clear();
  manualRetries = 0;
  clearManualRetry();
  if (_socket.connected || _socket.active) {
    _socket.disconnect();
    _socket.connect();
  }
};

// Legacy default export — returns a lazy socket (not auto-connected)
export default { get socket() { return getSocket(); } };
