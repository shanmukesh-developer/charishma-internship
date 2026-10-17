// Rider socket: live location for the customer map / admin, plus rider-room and order-room events.
// The server auto-joins `rider_<id>`; order rooms need joinOrder (membership-checked server-side).
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';

export interface RiderSocketHandlers {
  onOrderCancelled?: (p: { orderId: string; reason?: string }) => void;
  onOrderReady?: (p: { orderId: string }) => void;
  /** Any status change on an order room we joined (kitchen ready, admin changes, cancellations). */
  onStatusUpdated?: (p: { orderId: string; status: string | null }) => void;
  onTip?: (p: { amount: number; from?: string; orderId?: string }) => void;
  onTicketUpdated?: (p: { id: string; status: string; adminResponse?: string | null }) => void;
  /** A new order entered the pool (server room 'riders_online': approved + on duty). Ids only. */
  onDeliveryRequest?: (p: { orderId: string }) => void;
  /** An order left the pool (claimed by another rider, cancelled, picked up). */
  onDeliveryRequestGone?: (p: { orderId: string }) => void;
  /** connected=true also fires after every reconnect: events sent while offline are not replayed, so refetch. */
  onConnectionChange?: (connected: boolean) => void;
  /**
   * The server refused the token for good (not a 'Please retry' hiccup). Gets the token that handshake used.
   * Return false to ignore it (e.g. that token was just replaced by a password change): the socket then
   * retries with the latest token instead of staying down.
   */
  onAuthError?: (usedToken: string | null) => boolean | void;
}

let socket: Socket | null = null;
let joined = new Set<string>();
let handlers: RiderSocketHandlers = {};
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
/** Read by every (re)connect handshake, so a token replaced mid-session (password change) is always used. */
let currentToken: string | null = null;
let handshakeToken: string | null = null;

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/**
 * A refused handshake (server still starting, account lookup hiccup) makes socket.io-client destroy the
 * socket, so it never reconnects by itself (socket.active === false). Schedule our own connect() with
 * backoff + jitter, honouring the server's retryAfter hint when it sends one.
 */
function scheduleManualReconnect(s: Socket, err?: any): void {
  if (retryTimer || s.active || s.connected) return;
  const hintSec = Number(err?.data?.retryAfter);
  const base = Number.isFinite(hintSec) && hintSec > 0
    ? Math.min(hintSec * 1000, 60000)
    : Math.min(2000 * 2 ** retryAttempt, 15000);
  const delay = base + Math.floor(Math.random() * 1000);
  retryAttempt = Math.min(retryAttempt + 1, 6);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (socket === s && !s.connected && !s.active) s.connect();
  }, delay);
}

export function setSocketHandlers(h: RiderSocketHandlers): void {
  handlers = h;
}

export function connectSocket(token: string): void {
  if (socket) return;
  joined = new Set();
  currentToken = token;
  // SOCKET_URL = the API host without /api (src/config.ts), or a separate socket address the backend advertised.
  const s = io(SOCKET_URL, {
    // Callback form: evaluated on every handshake, never a stale token captured at connect time.
    auth: (cb) => {
      handshakeToken = currentToken;
      cb({ token: currentToken });
    },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    timeout: 15000,
  });
  socket = s;
  retryAttempt = 0;
  s.on('connect', () => {
    retryAttempt = 0;
    clearRetry();
    // Rooms are per connection: re-join after every reconnect.
    joined.forEach((id) => s.emit('joinOrder', id));
    handlers.onConnectionChange?.(true);
  });
  s.on('disconnect', (reason) => {
    handlers.onConnectionChange?.(false);
    // The server closed us on purpose (deploy, presence reset): socket.io will not retry by itself.
    if (reason === 'io server disconnect' && socket === s) s.connect();
  });
  s.on('connect_error', (err: any) => {
    const msg = String(err?.message || '');
    if (/authentication error/i.test(msg) && !/please retry/i.test(msg)) {
      clearRetry();
      const usedToken = handshakeToken;
      if (usedToken !== currentToken || handlers.onAuthError?.(usedToken) === false) {
        // Refused an outdated token (or the app chose to ignore it): retry with the current one.
        if (!s.active) scheduleManualReconnect(s, err);
      }
      return;
    }
    // Transport errors keep socket.active true (built-in reconnection runs); refused handshakes do not.
    if (!s.active) scheduleManualReconnect(s, err);
  });
  s.on('orderCancelled', (p: any) => {
    if (p?.orderId) handlers.onOrderCancelled?.({ orderId: String(p.orderId), reason: p.reason ? String(p.reason) : undefined });
  });
  s.on('orderReady', (p: any) => {
    if (p?.orderId) handlers.onOrderReady?.({ orderId: String(p.orderId) });
  });
  s.on('statusUpdated', (p: any) => {
    const id = p?.id ?? p?._id ?? p?.orderId;
    if (id) handlers.onStatusUpdated?.({ orderId: String(id), status: p?.status ? String(p.status) : null });
  });
  s.on('delivery_request', (p: any) => {
    if (p?.orderId) handlers.onDeliveryRequest?.({ orderId: String(p.orderId) });
  });
  s.on('delivery_request_gone', (p: any) => {
    if (p?.orderId) handlers.onDeliveryRequestGone?.({ orderId: String(p.orderId) });
  });
  s.on('rider_tip_received', (p: any) => {
    const amount = Number(p?.amount);
    if (Number.isFinite(amount) && amount > 0) {
      handlers.onTip?.({ amount, from: p?.from ? String(p.from) : undefined, orderId: p?.orderId ? String(p.orderId) : undefined });
    }
  });
  s.on('ticket_updated', (p: any) => {
    if (p?.id) handlers.onTicketUpdated?.({ id: String(p.id), status: String(p.status ?? ''), adminResponse: p.adminResponse ?? null });
  });
}

export function disconnectSocket(): void {
  clearRetry();
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  joined = new Set();
  currentToken = null;
  handshakeToken = null;
}

/** Keep order-room membership equal to the rider's active orders. */
export function syncOrderRooms(orderIds: string[]): void {
  const next = new Set(orderIds);
  next.forEach((id) => {
    if (!joined.has(id) && socket?.connected) socket.emit('joinOrder', id);
  });
  joined = next;
}

export function emitLocation(p: {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  orderId?: string;
  riderName?: string;
  isOnline?: boolean;
  activeOrderCount?: number;
}): void {
  if (!socket?.connected) return;
  socket.emit('rider_location_update', {
    lat: p.lat,
    lng: p.lng,
    heading: p.heading ?? null,
    speed: p.speed ?? null,
    ...(p.orderId ? { orderId: p.orderId } : {}),
    // Shown on the admin fleet radar (server relays these to admin-room as admin_rider_location).
    ...(p.riderName ? { riderName: p.riderName } : {}),
    ...(typeof p.isOnline === 'boolean' ? { isOnline: p.isOnline } : {}),
    ...(typeof p.activeOrderCount === 'number' ? { activeOrderCount: p.activeOrderCount } : {}),
  });
}

/**
 * Tell the admin dashboard the rider went on/off duty (server: rider_status_change -> admin_rider_status).
 * The server only relays it when riderId is the signed-in rider's own id.
 */
export function emitDutyStatus(riderId: string, name: string, isOnline: boolean): void {
  if (!socket?.connected || !riderId) return;
  socket.emit('rider_status_change', { riderId, name, isOnline });
}

/**
 * New session token (password change): the next (re)connect handshake must use it, or the server refuses
 * the revoked one and the app logs the rider out. The live connection is already authenticated.
 */
export function updateSocketToken(token: string): void {
  currentToken = token;
}

/** Foreground resume: reconnect at once if the socket gave up while the app was in the background. */
export function ensureSocketConnected(): void {
  if (socket && !socket.connected && !socket.active) {
    clearRetry();
    socket.connect();
  }
}

export function isSocketConnected(): boolean {
  return !!socket?.connected;
}
