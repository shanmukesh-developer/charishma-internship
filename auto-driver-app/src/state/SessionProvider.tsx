// Logged-in driver + token. Restores the saved session on launch, loads GET /me (status, documents,
// vehicles, what's missing), registers push, and signs out on any 401 (expired / revoked session) with a
// message for the login screen. A 403 DRIVER_SUSPENDED anywhere shows the suspended screen.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { configureHttp, errorMessage } from '../lib/http';
import { driverApi } from '../api/driverApi';
import { clearSession, loadSession, pickDriver, saveDriver, saveSession, type SavedDriver } from '../lib/storage';
import { onPushTokenChange, registerDriverPush, unregisterDriverPush, type PushState } from '../lib/push';
import { clearQueue } from '../lib/offlineQueue';
import type { MeResponse } from '../types';

export const SESSION_EXPIRED = 'Your session expired. Please sign in again.';
const SESSION_REVOKED = 'Your password was changed on another phone. Please sign in again.';
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;

interface SessionCtx {
  ready: boolean;
  token: string | null;
  driver: SavedDriver | null;
  me: MeResponse | null;
  meLoading: boolean;
  meError: string | null;
  /** Message on the login screen after a forced logout. */
  notice: string | null;
  /** Set when the server says the account is suspended. */
  suspended: string | null;
  /** false after the last request failed for lack of internet. */
  netOk: boolean;
  pushState: PushState | null;
  signIn: (token: string, rawDriver: any) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  refreshMe: () => Promise<MeResponse | null>;
  replaceToken: (token: string) => Promise<void>;
  clearNotice: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriver] = useState<SavedDriver | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suspended, setSuspended] = useState<string | null>(null);
  const [netOk, setNetOk] = useState(true);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const tokenRef = useRef<string | null>(null);
  const signingOut = useRef(false);

  const signOut = useCallback(async (msg?: string) => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      // Own logout (token still valid): stop pushes to this phone first (POST /fcm-token/remove).
      if (!msg && tokenRef.current) await Promise.race([unregisterDriverPush(), new Promise((r) => setTimeout(r, 5000))]);
      tokenRef.current = null;
      setToken(null);
      setDriver(null);
      setMe(null);
      setSuspended(null);
      setPushState(null);
      setNotice(msg || null);
      await clearQueue();
      await clearSession();
    } finally {
      signingOut.current = false;
    }
  }, []);

  useEffect(() => {
    configureHttp({
      getToken: () => tokenRef.current,
      onUnauthorized: (code) => { if (tokenRef.current) signOut(code === 'SESSION_REVOKED' ? SESSION_REVOKED : SESSION_EXPIRED); },
      onSuspended: (m) => { if (tokenRef.current) setSuspended(m); },
      onNetwork: (ok) => setNetOk(ok),
    });
  }, [signOut]);

  const refreshMe = useCallback(async () => {
    if (!tokenRef.current) return null;
    setMeLoading(true);
    try {
      const r = await driverApi.me();
      setMe(r);
      setMeError(null);
      const d = pickDriver(r.driver);
      if (d) { setDriver(d); saveDriver(d); }
      return r;
    } catch (e) {
      setMeError(errorMessage(e));
      return null;
    } finally {
      setMeLoading(false);
    }
  }, []);

  // Renew the session token on launch / resume, at most every 12 h (POST /auth/refresh).
  const lastRefresh = useRef(0);
  const tryRefresh = useCallback(async () => {
    const before = tokenRef.current;
    if (!before || Date.now() - lastRefresh.current < REFRESH_EVERY_MS) return;
    lastRefresh.current = Date.now();
    try {
      const r = await driverApi.refresh();
      if (tokenRef.current !== before || !r?.token) return;
      tokenRef.current = r.token;
      setToken(r.token);
      const d = pickDriver(r.driver);
      if (d) { setDriver(d); await saveSession(r.token, d); }
    } catch { /* keep the current token; a 401 already signs out */ }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && tokenRef.current) { tryRefresh(); refreshMe(); }
    });
    return () => sub.remove();
  }, [tryRefresh, refreshMe]);

  useEffect(() => {
    let alive = true;
    loadSession()
      .then(({ token: t, driver: d }) => {
        if (!alive) return;
        tokenRef.current = t;
        setToken(t);
        setDriver(d);
        if (t) { refreshMe(); tryRefresh(); }
      })
      .catch(() => { /* start signed out */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push: register after sign-in, re-send on token rotation.
  const driverId = driver?.id || null;
  useEffect(() => {
    if (!token || !driverId) return;
    let alive = true;
    registerDriverPush(driverId).then((s) => { if (alive) setPushState(s); });
    // Back in the app: a registration that failed (server waking up at launch) is retried here, not only at
    // the next cold start; a successful one is a no-op until its daily re-send is due.
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') registerDriverPush(driverId).then((s) => { if (alive) setPushState(s); });
    });
    const off = onPushTokenChange(driverId);
    return () => { alive = false; appSub.remove(); off(); };
  }, [token, driverId]);

  const signIn = useCallback(async (t: string, raw: any) => {
    const d = pickDriver(raw);
    if (!d) throw new Error('The sign-in reply was missing your driver details. Please try again.');
    await saveSession(t, d);
    lastRefresh.current = Date.now();
    tokenRef.current = t;
    setNotice(null);
    setSuspended(null);
    setDriver(d);
    setToken(t);
    refreshMe();
  }, [refreshMe]);

  const replaceToken = useCallback(async (t: string) => {
    tokenRef.current = t;
    setToken(t);
    if (driver) await saveSession(t, driver);
  }, [driver]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SessionCtx>(() => ({
    ready, token, driver, me, meLoading, meError, notice, suspended, netOk, pushState,
    signIn, signOut, refreshMe, replaceToken, clearNotice,
  }), [ready, token, driver, me, meLoading, meError, notice, suspended, netOk, pushState, signIn, signOut, refreshMe, replaceToken, clearNotice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
