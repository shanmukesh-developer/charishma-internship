// ZCS Campus Stall: logged-in stall + token (the stall's ZCS Vendor account). Restores the saved session on launch; any 401 logs out with a message.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform, Vibration } from 'react-native';
import { configureHttp } from '../lib/http';
import { isLocalVendorAccount, refreshSession } from '../lib/api';
import { clearSession, loadSession, pickProfile, saveProfile, saveSession } from '../lib/storage';
import { notifyLoggedOut, unregisterStorePush } from '../lib/push';
import type { StoreProfile } from '../types';

interface SessionCtx {
  ready: boolean;
  token: string | null;
  restaurant: StoreProfile | null;
  /** Message shown on the login screen after a forced logout. */
  notice: string | null;
  signIn: (token: string, rawRestaurant: any) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  updateProfile: (patch: Partial<StoreProfile>) => void;
  clearNotice: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export const SESSION_EXPIRED = 'Your session expired. Please log in again.';

/** Swap the session for a fresh one (if the server supports it) at most this often. */
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [restaurant, setRestaurant] = useState<StoreProfile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const signingOut = useRef(false);
  const signOut = useCallback(async (msg?: string) => {
    // Double tap on Log out, or a burst of 401s while the push token is being removed: run once.
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await doSignOut(msg);
    } finally {
      signingOut.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSignOut = async (msg?: string) => {
    // Own logout (token still valid): stop booking pushes to this phone. A forced logout skips it
    // (the token is already rejected; the server moves the push token on the next login anyway).
    if (!msg && tokenRef.current) {
      await Promise.race([unregisterStorePush(), new Promise((r) => setTimeout(r, 4000))]);
    }
    const wasLoggedIn = !!tokenRef.current;
    tokenRef.current = null;
    setToken(null);
    setRestaurant(null);
    setNotice(msg || null);
    await clearSession();
    // Forced logout (expired / revoked session) during service: say so clearly, bookings stop reaching this phone.
    if (msg && wasLoggedIn) {
      if (Platform.OS !== 'web') Vibration.vibrate([0, 600, 250, 600, 250, 600]);
      notifyLoggedOut(msg);
      if (AppState.currentState === 'active') {
        Alert.alert('Logged out', `${msg} New bookings will not reach this phone until you log in again.`, [{ text: 'OK' }]);
      }
    }
  };

  useEffect(() => {
    configureHttp({
      getToken: () => tokenRef.current,
      onUnauthorized: () => { if (tokenRef.current) signOut(SESSION_EXPIRED); },
    });
  }, [signOut]);

  // Optional server feature: renew the session token now and then (launch + resume, at most every 12 h).
  // A server without the route answers 404 and this quietly does nothing.
  const lastRefresh = useRef(0);
  const tryRefresh = useCallback(async () => {
    const before = tokenRef.current;
    if (!before || Date.now() - lastRefresh.current < REFRESH_EVERY_MS) return;
    lastRefresh.current = Date.now();
    const res = await refreshSession();
    if (!res || tokenRef.current !== before) return; // unsupported / failed, or logged out meanwhile
    tokenRef.current = res.token;
    setToken(res.token);
    setRestaurant((prev) => {
      if (!prev) return prev;
      const fresh = res.restaurant ? pickProfile(res.restaurant) : null;
      const next = fresh && fresh.id === prev.id ? { ...prev, ...fresh } : prev;
      saveSession(res.token, next);
      return next;
    });
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') tryRefresh(); });
    return () => sub.remove();
  }, [tryRefresh]);

  useEffect(() => {
    let alive = true;
    loadSession()
      .then(({ token: t, restaurant: r }) => {
        if (!alive) return;
        if (t && isLocalVendorAccount(r) === false) {
          // A restaurant (rider-delivered) session: its orders cannot be handled with this app's flow.
          clearSession();
          setNotice('This is a restaurant account. Please use the ZenWe Restaurant app.');
          return;
        }
        tokenRef.current = t;
        setToken(t);
        setRestaurant(r);
        if (t) tryRefresh();
      })
      .catch(() => { /* start logged out */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (t: string, raw: any) => {
    const profile = pickProfile(raw);
    if (!profile) throw new Error('Login response was missing the store details. Please try again.');
    await saveSession(t, profile);
    lastRefresh.current = Date.now(); // brand-new token
    tokenRef.current = t;
    setNotice(null);
    setRestaurant(profile);
    setToken(t);
  }, []);

  const updateProfile = useCallback((patch: Partial<StoreProfile>) => {
    setRestaurant((prev) => {
      if (!prev) return prev;
      const clean: Partial<StoreProfile> = {};
      (Object.keys(patch) as (keyof StoreProfile)[]).forEach((k) => {
        if (patch[k] !== undefined) (clean as any)[k] = patch[k];
      });
      const next = { ...prev, ...clean, id: prev.id };
      if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
      saveProfile(next);
      return next;
    });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SessionCtx>(() => ({
    ready, token, restaurant, notice, signIn, signOut, updateProfile, clearNotice,
  }), [ready, token, restaurant, notice, signIn, signOut, updateProfile, clearNotice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
