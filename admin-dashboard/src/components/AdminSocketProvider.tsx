"use client";
import React, { useEffect, useState, createContext, useContext, useRef, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/lib/config';
import { getToken, subscribe } from '@/lib/session';
import { invalidateRequestCache } from '@/lib/requestCache';

// High-frequency events that do not change anything the REST reads return.
const NON_DATA_EVENTS = new Set(['admin_rider_location', 'admin_intercept_chat']);


interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  refreshSocket: () => void;
  /** Small "live update" toast at the bottom-right (used by realtime sync). */
  notifyLive: (text: string) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  refreshSocket: () => {},
  notifyLive: () => {}
});

interface LiveToast { id: number; text: string }

export const useAdminSocket = () => useContext(SocketContext);

export default function AdminSocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // Mirrors socketRef so consumers re-subscribe when the socket is replaced (sign-in / refresh).
  const [socketState, setSocketState] = useState<Socket | null>(null);
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const notifyLive = useCallback((text: string) => {
    if (!text) return;
    const id = ++toastSeq.current;
    setToasts(prev => {
      // Same message already showing: don't stack duplicates.
      if (prev.some(t => t.text === text)) return prev;
      return [...prev.slice(-2), { id, text }];
    });
    const timer = setTimeout(() => {
      toastTimers.current.delete(timer);
      setToasts(prev => prev.filter(t => t.id !== id && t.text !== text));
    }, 3500);
    toastTimers.current.add(timer);
  }, []);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  const initSocket = useCallback(() => {
    const token = getToken();

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socket = io(SOCKET_URL.replace(/\/$/, ""), {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: { token }
    });

    const joinAdminRoom = () => {
      console.log('[ADMIN_SOCKET] Connected with socket ID:', socket.id, 'Joining admin-room...');
      socket.emit('joinAdmin');
    };

    // Any data event means some REST read may now be out of date: drop the short read cache so the
    // refetch the page does in response gets fresh data (see lib/requestCache).
    socket.onAny((event: string) => {
      if (!NON_DATA_EVENTS.has(event)) invalidateRequestCache();
    });

    // 'connect' fires on the first connection AND on every automatic reconnection (socket.io v4 emits
    // 'reconnect' on the Manager, socket.io, never on the socket), so this one handler re-joins the room.
    socket.on('connect', () => {
      invalidateRequestCache(); // events sent while offline are not replayed
      setIsConnected(true);
      joinAdminRoom();
    });

    socket.on('disconnect', (reason) => {
      console.warn('[ADMIN_SOCKET] Disconnected:', reason);
      setIsConnected(false);
    });

    // A refusal by a server middleware (e.g. SERVER_STARTING during a redeploy) is NOT retried by
    // socket.io itself (socket.active becomes false): the dashboard used to sit on "offline" until a
    // page reload. Retry after the server's retryAfter (or a growing delay, max 30 s).
    let manualRetries = 0;
    let manualRetryTimer: ReturnType<typeof setTimeout> | null = null;
    socket.on('connect', () => { manualRetries = 0; });
    socket.on('connect_error', (err: Error & { data?: { retryAfter?: number } }) => {
      console.warn('[ADMIN_SOCKET] Connection error:', err.message);
      if (socket.active || manualRetryTimer) return;
      const hinted = Number(err?.data?.retryAfter) * 1000;
      const wait = Number.isFinite(hinted) && hinted > 0 ? hinted : Math.min(30000, 2000 * 2 ** manualRetries);
      manualRetries++;
      manualRetryTimer = setTimeout(() => {
        manualRetryTimer = null;
        // Only the current socket of a signed-in admin reconnects (sign-out replaced / dropped it).
        if (socketRef.current === socket && getToken() && !socket.connected) {
          socket.auth = { token: getToken() };
          socket.connect();
        }
      }, wait);
    });

    socketRef.current = socket;
    setSocketState(socket);

    // Anti-sleep heartbeat ping to keep Render server awake. One interval per provider: a
    // refreshSocket() call replaces the previous one instead of stacking another.
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    const keepAliveInterval = setInterval(() => {
      fetch(`${SOCKET_URL}/api/health`, { cache: 'no-store' }).catch(() => {});
    }, 10 * 60 * 1000); // 10 minutes
    keepAliveRef.current = keepAliveInterval;

    return () => {
      clearInterval(keepAliveInterval);
      if (keepAliveRef.current === keepAliveInterval) keepAliveRef.current = null;
    };
  }, []);

  // Reconnect whenever the admin signs in or out so the socket uses the current token.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setSessionToken(getToken());
    sync();
    return subscribe(sync);
  }, []);

  useEffect(() => {
    if (!sessionToken) return;
    const cleanupInterval = initSocket();
    return () => {
      if (typeof cleanupInterval === 'function') cleanupInterval();
      if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketState(null);
      setIsConnected(false);
    };
  }, [initSocket, sessionToken]);

  // Memoized: a new object every render made every consumer (dashboard, every page's live sync, the
  // SOS modal) re-render whenever a toast appeared or disappeared.
  const value = useMemo(
    () => ({ socket: socketState, isConnected, refreshSocket: initSocket, notifyLive }),
    [socketState, isConnected, initSocket, notifyLive],
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-[190] flex flex-col gap-2 pointer-events-none lg:left-64" role="status" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-pop animate-zv-pop-in">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
              {t.text}
            </div>
          ))}
        </div>
      )}
    </SocketContext.Provider>
  );
}
