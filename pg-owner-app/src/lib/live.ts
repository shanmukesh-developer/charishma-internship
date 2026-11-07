// Live updates for the signed-in PG owner (PF-07, 6 Nov 2026). The server accepts a pg_owner token on Socket.IO,
// puts the socket in its own room pgowner_<id> (and nothing else) and sends `pg:changed` { type, bookingId?,
// complaintId?, hostelId?, status? } whenever a student requests / cancels, support confirms / cancels, another of the
// owner's phones decides, or a tenant raises a complaint. The app refetches what changed at once; the 30 s timer stays
// as the fallback. Ids only: the lists are always read from the API.
import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { reportSocketError, socketVersionAuth } from './forceUpdate';

export type LiveEvent = { type?: string; bookingId?: string; complaintId?: string; hostelId?: string; status?: string };
export type LiveKind = 'bookings' | 'complaints' | 'all';

/** Which list a server event is about. */
export function kindOf(e: LiveEvent): LiveKind {
  if (e.complaintId || (e.type && e.type.includes('COMPLAINT'))) return 'complaints';
  if (e.bookingId || (e.type && e.type.includes('BOOKING'))) return 'bookings';
  return 'all';
}

// Handshake refusals that a retry with the same token can never fix (the HTTP client signs out on its next 401).
const AUTH_REFUSED = /Authentication error: (Account not found|Invalid token|Account suspended)/i;

/**
 * One connection while signed in. onChange(kind) on every server event and, with 'all', after every (re)connect
 * (anything sent while the phone was offline is fetched then). Returns a stop function.
 */
export function startLive(token: string, onChange: (kind: LiveKind, e?: LiveEvent) => void): () => void {
  let s: Socket | null = null;
  try {
    s = io(SOCKET_URL, {
      auth: { token, ...socketVersionAuth() },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      timeout: 20000,
    });
  } catch {
    return () => {};
  }
  let connectedOnce = false;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryMs = 2000;
  s.on('connect', () => {
    retryMs = 2000;
    // A reconnect: catch up on what happened while the socket was down.
    if (connectedOnce) onChange('all');
    connectedOnce = true;
  });
  s.on('pg:changed', (raw: unknown) => {
    const e: LiveEvent = raw && typeof raw === 'object' ? (raw as LiveEvent) : {};
    onChange(kindOf(e), e);
  });
  s.on('connect_error', (err: any) => {
    if (reportSocketError(err)) { s?.disconnect(); return; } // retired app version: the Update screen shows
    if (AUTH_REFUSED.test(String(err && err.message))) { s?.disconnect(); return; } // session gone: no retry loop
    // A handshake the server refused for now ("Please retry", server starting) stops the built-in reconnection
    // (socket.active false); a transport error keeps it going. Retry the first kind ourselves, 2 s doubling to 30 s.
    if (s && !s.active && !stopped && !retryTimer) {
      retryTimer = setTimeout(() => { retryTimer = null; if (!stopped) s?.connect(); }, retryMs);
      retryMs = Math.min(30000, retryMs * 2);
    }
  });
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    s?.removeAllListeners();
    s?.disconnect();
    s = null;
  };
}
