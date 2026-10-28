// Signed-in PG owner + token. Restores the saved session on launch, refreshes the profile (GET /me), renews
// the token on launch / resume (at most every 12 h, POST /auth/refresh), registers push, and signs out on a
// 401 (expired / revoked session) with a message for the login screen. 403 PG_OWNER_SUSPENDED shows the
// suspended screen. A wrong password typed INSIDE the app (change password, delete account) is a 401 too,
// but never signs out: those codes are ignored here.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { configureHttp } from '../lib/http';
import { ownerApi } from '../api/ownerApi';
import { clearSession, loadSession, pickOwner, saveOwner, saveSession, type SavedOwner } from '../lib/storage';
import { onPushTokenChange, registerOwnerPush, unregisterOwnerPush, type PushState } from '../lib/push';
import { clearQueue } from '../lib/offlineQueue';

export const SESSION_EXPIRED = 'Your session expired. Please sign in again.';
const SESSION_REVOKED = 'Your password was changed or reset. Please sign in again.';
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;
/** 401s that mean "the password you just typed is wrong", not "your session is over". */
const NOT_A_SESSION_ERROR = new Set(['INVALID_CREDENTIALS', 'WRONG_PASSWORD']);

interface SessionCtx {
  ready: boolean;
  token: string | null;
  owner: SavedOwner | null;
  /** Message on the login screen after a forced logout. */
  notice: string | null;
  /** Set when the server says the account is suspended. */
  suspended: string | null;
  /** false after the last request failed for lack of internet. */
  netOk: boolean;
  pushState: PushState | null;
  signIn: (token: string, rawOwner: any) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  /** New token + profile after a password change (other phones were signed out). */
  replaceSession: (token: string, rawOwner: any) => Promise<void>;
  refreshMe: () => Promise<void>;
  clearNotice: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [owner, setOwner] = useState<SavedOwner | null>(null);
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
      if (!msg && tokenRef.current) await Promise.race([unregisterOwnerPush(), new Promise((r) => setTimeout(r, 5000))]);
      tokenRef.current = null;
      setToken(null);
      setOwner(null);
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
      onUnauthorized: (code) => {
        if (!tokenRef.current || (code && NOT_A_SESSION_ERROR.has(code))) return;
        signOut(code === 'SESSION_REVOKED' ? SESSION_REVOKED : SESSION_EXPIRED);
      },
      onSuspended: (m) => { if (tokenRef.current) setSuspended(m); },
      onNetwork: (ok) => setNetOk(ok),
    });
  }, [signOut]);

  const applyOwner = useCallback((raw: any) => {
    const o = pickOwner(raw);
    if (o) { setOwner(o); saveOwner(o); }
    return o;
  }, []);

  const refreshMe = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const r = await ownerApi.me();
      applyOwner(r.owner);
    } catch { /* offline: keep the saved profile; 401 / 403 handled by the HTTP client */ }
  }, [applyOwner]);

  // Renew the session token on launch / resume, at most every 12 h.
  const lastRefresh = useRef(0);
  const tryRefresh = useCallback(async () => {
    const before = tokenRef.current;
    if (!before || Date.now() - lastRefresh.current < REFRESH_EVERY_MS) return;
    lastRefresh.current = Date.now();
    try {
      const r = await ownerApi.refresh();
      if (tokenRef.current !== before || !r?.token) return;
      const o = pickOwner(r.owner);
      tokenRef.current = r.token;
      setToken(r.token);
      if (o) { setOwner(o); await saveSession(r.token, o); }
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
      .then(({ token: t, owner: o }) => {
        if (!alive) return;
        tokenRef.current = t;
        setToken(t);
        setOwner(o);
        if (t) { refreshMe(); tryRefresh(); }
      })
      .catch(() => { /* start signed out */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push: register once the own password is set (the owner routes need it), re-send on token rotation.
  const ownerId = owner?.id || null;
  const canUseApp = !!owner && !owner.mustChangePassword;
  useEffect(() => {
    if (!token || !ownerId || !canUseApp) return;
    let alive = true;
    registerOwnerPush(ownerId).then((s) => { if (alive) setPushState(s); });
    // Back in the app: a registration that failed (server waking up at launch) is retried here, not only at
    // the next cold start; a successful one is a no-op until its daily re-send is due.
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') registerOwnerPush(ownerId).then((s) => { if (alive) setPushState(s); });
    });
    const off = onPushTokenChange(ownerId);
    return () => { alive = false; appSub.remove(); off(); };
  }, [token, ownerId, canUseApp]);

  const signIn = useCallback(async (t: string, raw: any) => {
    const o = pickOwner(raw);
    if (!o) throw new Error('The sign-in reply was missing your account details. Please try again.');
    await saveSession(t, o);
    lastRefresh.current = Date.now();
    tokenRef.current = t;
    setNotice(null);
    setSuspended(null);
    setOwner(o);
    setToken(t);
  }, []);

  const replaceSession = useCallback(async (t: string, raw: any) => {
    const o = pickOwner(raw);
    tokenRef.current = t;
    lastRefresh.current = Date.now();
    setToken(t);
    if (o) { setOwner(o); await saveSession(t, o); }
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SessionCtx>(() => ({
    ready, token, owner, notice, suspended, netOk, pushState, signIn, signOut, replaceSession, refreshMe, clearNotice,
  }), [ready, token, owner, notice, suspended, netOk, pushState, signIn, signOut, replaceSession, refreshMe, clearNotice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
