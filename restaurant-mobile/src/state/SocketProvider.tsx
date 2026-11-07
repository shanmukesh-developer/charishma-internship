// One authenticated Socket.io connection per logged-in store. Joins restaurant_<id> on EVERY connect
// (room membership is lost on reconnect), never gives up reconnecting, and reconnects right away when
// the app comes back to the foreground.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { reportSocketError, socketVersionAuth } from '../lib/forceUpdate';
import { SOCKET_URL, OFFLINE_AFTER_MS } from '../config';
import type { ConnStatus } from '../types';

interface SocketCtx {
  socket: Socket | null;
  status: ConnStatus;
  /** Increments on every (re)connect + room join: consumers refetch when it changes. */
  connectCount: number;
  retry: () => void;
}

const FIRST_CONNECT_GRACE_MS = 60000;
/** Max wait for the server's joinRestaurant ack; no answer counts as not joined (retried). */
const JOIN_ACK_TIMEOUT_MS = 2500;
/** Room join retries after a refusal / no answer: 2 s, 4 s, ... up to 30 s, for as long as the socket is up. */
const JOIN_RETRY_MAX_MS = 30000;

const Ctx = createContext<SocketCtx>({ socket: null, status: 'connecting', connectCount: 0, retry: () => {} });

export function SocketProvider({ token, restaurantId, onAuthError, children }: {
  token: string; restaurantId: string; onAuthError: () => void; children: React.ReactNode;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [connectCount, setConnectCount] = useState(0);
  const authErrRef = useRef(onAuthError);
  authErrRef.current = onAuthError;

  useEffect(() => {
    const s = io(SOCKET_URL, {
      // appName / appVersion / appBuild: the server refuses a retired app version (force update).
      auth: { token, ...socketVersionAuth() },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let everConnected = false;
    let joinTimer: ReturnType<typeof setTimeout> | null = null;
    let joinAttempt = 0;
    let caughtUp = false; // this connection already ran its catch-up refetch
    const clearJoin = () => {
      if (joinTimer) clearTimeout(joinTimer);
      joinTimer = null;
    };
    const clearRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
    // A refused handshake ('Server is starting, please retry' while the DB warms up after a deploy, or a
    // failed account lookup) makes socket.io-client destroy the socket: s.active turns false and it never
    // reconnects by itself. Reconnect ourselves with backoff + jitter, honouring the server's retryAfter.
    const scheduleManualReconnect = (err: any) => {
      if (retryTimer || s.active || s.connected) return;
      const hintSec = Number(err?.data?.retryAfter);
      const base = Number.isFinite(hintSec) && hintSec > 0
        ? Math.min(hintSec * 1000, 60000)
        : Math.min(2000 * 2 ** retryAttempt, 15000);
      retryAttempt = Math.min(retryAttempt + 1, 6);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!s.connected && !s.active) s.connect();
      }, base + Math.floor(Math.random() * 1000));
    };
    const armOffline = () => {
      if (offlineTimer) return;
      // The first connect gets longer: the Render server can take ~30-50 s to wake up.
      offlineTimer = setTimeout(() => setStatus('offline'), everConnected ? OFFLINE_AFTER_MS : FIRST_CONNECT_GRACE_MS);
    };
    const clearOffline = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = null;
    };
    armOffline(); // first connect taking too long (server asleep / no internet) also shows offline

    // Live orders only flow once the server has put this socket in restaurant_<id>. The server answers the join
    // with { ok: true } or { ok: false, message }; a refusal or no answer used to count as joined, and live
    // events stopped without a sign (only the slow poll kept the list current). Now: we are 'online' only
    // after { ok: true }; otherwise the connection shows as reconnecting / offline and the join is retried.
    const joinRoom = () => {
      clearJoin();
      if (!s.connected) return;
      s.timeout(JOIN_ACK_TIMEOUT_MS).emit('joinRestaurant', restaurantId, (err: Error | null, ack?: { ok?: boolean; message?: string }) => {
        if (!s.connected) return;
        if (!err && ack && ack.ok === true) {
          joinAttempt = 0;
          caughtUp = true;
          clearOffline();
          setStatus('online');
          // The catch-up refetch (driven by connectCount) runs only now that we are in the room, so an order
          // created in between is in the refetch or in the socket stream.
          setConnectCount((n) => n + 1);
          return;
        }
        console.warn(`[socket] joinRestaurant ${err ? 'got no answer' : `refused: ${ack?.message || 'no reason'}`}; retrying`);
        // Still refresh once from the server, so the list is current while live events are not flowing.
        if (!caughtUp) {
          caughtUp = true;
          setConnectCount((n) => n + 1);
        }
        setStatus((prev) => (prev === 'offline' ? 'offline' : 'reconnecting'));
        armOffline();
        const wait = Math.min(2000 * 2 ** joinAttempt, JOIN_RETRY_MAX_MS);
        joinAttempt = Math.min(joinAttempt + 1, 6);
        joinTimer = setTimeout(joinRoom, wait + Math.floor(Math.random() * 500));
      });
    };

    s.on('connect', () => {
      clearRetry();
      retryAttempt = 0;
      everConnected = true;
      joinAttempt = 0;
      caughtUp = false;
      joinRoom();
    });
    s.on('disconnect', (reason) => {
      clearJoin();
      setStatus((prev) => (prev === 'offline' ? 'offline' : 'reconnecting'));
      armOffline();
      // The server closed us on purpose: socket.io will not retry by itself.
      if (reason === 'io server disconnect') s.connect();
    });
    s.on('connect_error', (err: any) => {
      // This app version was retired: the Update screen takes over (it unmounts this provider), never retry.
      if (reportSocketError(err)) { clearRetry(); return; }
      // 'Please retry' = a passing server hiccup (DB busy), not a bad token: keep retrying, never log out.
      const msg = String(err?.message || '');
      if (/authentication error/i.test(msg) && !/please retry/i.test(msg)) {
        clearOffline();
        clearRetry();
        authErrRef.current();
        return;
      }
      setStatus((prev) => (prev === 'offline' ? 'offline' : prev === 'connecting' ? 'connecting' : 'reconnecting'));
      armOffline();
      // Transport errors keep s.active true (built-in reconnection runs); refused handshakes do not.
      if (!s.active) scheduleManualReconnect(err);
    });

    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && !s.connected) {
        clearRetry();
        s.connect();
      }
    });

    setSocket(s);
    return () => {
      clearOffline();
      clearRetry();
      clearJoin();
      appSub.remove();
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [token, restaurantId]);

  const retry = useCallback(() => {
    if (socket && !socket.connected) {
      setStatus((prev) => (prev === 'offline' ? 'offline' : 'reconnecting'));
      socket.connect();
    }
  }, [socket]);

  const value = useMemo(() => ({ socket, status, connectCount, retry }), [socket, status, connectCount, retry]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSocket = () => useContext(Ctx);
