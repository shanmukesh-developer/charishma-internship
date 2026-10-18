// One authenticated Socket.io connection per signed-in driver. The server (backend/server.js
// loadSocketAccount) accepts role 'auto_driver' tokens and joins room autodriver_<id> on connect; the
// Auto-Ride module emits 'autoride:changed' { kind: 'trip' | 'booking' | 'driver', id, status?, at } there
// (modules/autoRide/services/notify.js nudgeDriver). Payloads are ids only: screens refetch on a nudge.
// Never gives up reconnecting; reconnects when the app returns to the foreground.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { reportSocketError, socketVersionAuth } from '../lib/forceUpdate';
import { SOCKET_URL, OFFLINE_AFTER_MS } from '../config';

export type ConnStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';
export interface DriverEvent { kind: string; id: string; status?: string; at?: string }

interface SocketCtx {
  status: ConnStatus;
  /** Increments on every (re)connect: screens refetch when it changes (catch up on missed nudges). */
  connectCount: number;
  subscribe: (cb: (e: DriverEvent) => void) => () => void;
  retry: () => void;
}

const FIRST_CONNECT_GRACE_MS = 60000;
const Ctx = createContext<SocketCtx>({ status: 'connecting', connectCount: 0, subscribe: () => () => {}, retry: () => {} });

export function SocketProvider({ token, onAuthError, children }: { token: string; onAuthError: (message: string) => void; children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [connectCount, setConnectCount] = useState(0);
  const sockRef = useRef<Socket | null>(null);
  const listeners = useRef(new Set<(e: DriverEvent) => void>());
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
    sockRef.current = s;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let everConnected = false;
    const armOffline = () => {
      if (offlineTimer) return;
      offlineTimer = setTimeout(() => setStatus('offline'), everConnected ? OFFLINE_AFTER_MS : FIRST_CONNECT_GRACE_MS);
    };
    const clearOffline = () => { if (offlineTimer) clearTimeout(offlineTimer); offlineTimer = null; };
    const manualReconnect = (err: any) => {
      if (retryTimer || s.active || s.connected) return;
      const hint = Number(err?.data?.retryAfter);
      const base = Number.isFinite(hint) && hint > 0 ? Math.min(hint * 1000, 60000) : Math.min(2000 * 2 ** attempt, 15000);
      attempt = Math.min(attempt + 1, 6);
      retryTimer = setTimeout(() => { retryTimer = null; if (!s.connected && !s.active) s.connect(); }, base + Math.floor(Math.random() * 1000));
    };
    armOffline();

    s.on('connect', () => {
      clearOffline();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      attempt = 0;
      everConnected = true;
      setStatus('online');
      setConnectCount((n) => n + 1);
    });
    s.on('disconnect', (reason) => {
      setStatus((p) => (p === 'offline' ? 'offline' : 'reconnecting'));
      armOffline();
      if (reason === 'io server disconnect') s.connect();
    });
    s.on('connect_error', (err: any) => {
      // This app version was retired: the Update screen takes over (it unmounts this provider), never retry.
      if (reportSocketError(err)) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } return; }
      const msg = String(err?.message || '');
      // 'Account suspended' / 'Account not found' / 'Invalid token' = this session is over.
      if (/authentication error/i.test(msg) && !/please retry/i.test(msg)) {
        clearOffline();
        authErrRef.current(msg);
        return;
      }
      setStatus((p) => (p === 'offline' ? 'offline' : p === 'connecting' ? 'connecting' : 'reconnecting'));
      armOffline();
      if (!s.active) manualReconnect(err);
    });
    s.on('autoride:changed', (p: any) => {
      if (!p || typeof p !== 'object') return;
      const e: DriverEvent = { kind: String(p.kind || ''), id: String(p.id || ''), status: p.status ? String(p.status) : undefined, at: p.at };
      listeners.current.forEach((l) => { try { l(e); } catch { /* ignore */ } });
    });
    const appSub = AppState.addEventListener('change', (st) => { if (st === 'active' && !s.connected) s.connect(); });

    return () => {
      clearOffline();
      if (retryTimer) clearTimeout(retryTimer);
      appSub.remove();
      s.removeAllListeners();
      s.disconnect();
      sockRef.current = null;
    };
  }, [token]);

  const subscribe = useCallback((cb: (e: DriverEvent) => void) => {
    listeners.current.add(cb);
    return () => { listeners.current.delete(cb); };
  }, []);
  const retry = useCallback(() => {
    const s = sockRef.current;
    if (s && !s.connected) { setStatus((p) => (p === 'offline' ? 'offline' : 'reconnecting')); s.connect(); }
  }, []);

  const value = useMemo(() => ({ status, connectCount, subscribe, retry }), [status, connectCount, subscribe, retry]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSocket = () => useContext(Ctx);

/** Calls `cb` on every driver nudge (optionally only for one trip) and after every reconnect. */
export function useDriverEvents(cb: (e: DriverEvent | null) => void, filter?: (e: DriverEvent) => boolean) {
  const { subscribe, connectCount } = useSocket();
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const fRef = useRef(filter);
  fRef.current = filter;
  useEffect(() => subscribe((e) => { if (!fRef.current || fRef.current(e)) cbRef.current(e); }), [subscribe]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    cbRef.current(null);
  }, [connectCount]);
}
