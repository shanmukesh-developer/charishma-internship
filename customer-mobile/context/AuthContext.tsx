import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUser, setUser as saveUser, removeToken, removeUser, getToken, onSessionInvalid, refreshSessionIfNeeded } from '../utils/auth';

// Per-user data kept on the device. Cleared on logout so the next account on a shared phone
// never sees the previous user's addresses, favourites or alerts.
// (zenvy_cart / zenvy_collab_session are owned by CartContext, which keeps them in memory.)
const USER_SCOPED_KEYS = [
  'zenvy_favorites',
  'zenvy_wishlist',
  'zenvy_saved_addresses',
  'zenvy_delivery_instruction',
  'zenvy_notifications',
  'zenvy_auto_answer_call',
  'zenvy_diet_prefs',
  'zenvy_notif_prefs',
  'zenvy_push_prefs_v1',
  'zenvy_recently_viewed',
  'zenvy_fav_dishes',
];
const USER_SCOPED_PREFIXES = ['zenvy_reviews_'];

const normalizeUserId = <T extends Record<string, any> | null>(u: T): T => {
  if (!u) return u;
  const anyId = (u as any).id ?? (u as any)._id;
  if (anyId === undefined || anyId === null) return u;
  return { ...u, id: String(anyId), _id: String(anyId) } as T;
};

const reconnectSocket = () => {
  try { require('../utils/socket').reconnectSocketWithFreshAuth(); } catch (e) { console.warn('[AUTH] socket reset failed:', e); }
};

interface User {
  _id?: string;
  id?: string;
  name: string;
  email: string;
  phone?: string;
  mobile?: string;
  about?: string;
  isElite?: boolean;
  zenPoints?: number;
  walletBalance?: number;
  defaultAddress?: string;
  avatar?: string;
  profileImage?: string | null;
  streakCount?: number;
  totalOrders?: number;
  completedOrders?: number;
  address?: string;
  hostelBlock?: string;
  roomNumber?: string;
  roomNo?: string;
  karmaPoints?: number;
  city?: string;
  badges?: string[];
  referralCode?: string;
  friendCode?: string;
  createdAt?: string;
  role?: string;
  // C4: Terms / Privacy acceptance (server-computed; termsUpdateRequired drives the "updated Terms" sheet).
  termsAcceptedVersion?: string | null;
  termsAcceptedAt?: string | null;
  termsCurrentVersion?: string;
  termsUpdateRequired?: boolean;
  isVeg?: boolean;
  statusText?: string | null;
  statusEmoji?: string | null;
  statusSeenBy?: string[] | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  setUser: (user: Partial<User> | null) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  setUser: () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const stored = await getUser();
      const token = await getToken();
      if (stored && token) {
        setUserState(normalizeUserId(stored));
      } else {
        await removeToken();
        await removeUser();
      }
    } catch (err) {
      console.warn('[AUTH_CONTEXT] Failed to restore session:', err);
    }
    setIsLoading(false);
  };

  const setUser = (u: Partial<User> | null) => {
    if (u) {
      // Auth responses are flat and carry `token` / flow flags: never persist those in the user object.
      const { token: _token, isNewUser: _isNew, registrationToken: _reg, needsPhone: _np, message: _msg, success: _ok, ...clean } = u as any;
      setUserState(prev => {
        const merged: User = {
          name: prev?.name || '',
          email: prev?.email || '',
          ...prev,
          ...clean,
          profileImage: u.profileImage !== undefined ? u.profileImage : (prev?.profileImage ?? null),
          statusText: u.statusText !== undefined ? u.statusText : (prev?.statusText ?? null),
          statusEmoji: u.statusEmoji !== undefined ? u.statusEmoji : (prev?.statusEmoji ?? null),
          statusSeenBy: u.statusSeenBy !== undefined ? u.statusSeenBy : (prev?.statusSeenBy ?? null),
        };
        // The backend returns `_id` from login/profile and `id` elsewhere: always expose both.
        const anyId = (clean as any).id ?? (clean as any)._id ?? prev?.id ?? prev?._id;
        if (anyId !== undefined && anyId !== null) {
          merged.id = String(anyId);
          merged._id = String(anyId);
        }
        saveUser(merged).catch(() => {});
        return merged;
      });
    } else {
      setUserState(null);
      removeUser().catch(() => {});
    }
  };

  const logout = async () => {
    // 1. Detach this phone's push token and end the server session BEFORE the JWT is cleared
    //    (fire-and-forget: logout must work offline too).
    try {
      const pushToken = await AsyncStorage.getItem('zenvy_push_token');
      const jwt = await getToken();
      if (jwt) {
        // Pass the JWT explicitly: it is removed from storage right after this.
        const { apiFetch } = require('../utils/auth');
        const headers = { Authorization: `Bearer ${jwt}` };
        if (pushToken) {
          apiFetch('/api/users/fcm-token/remove', { method: 'POST', headers, body: JSON.stringify({ fcmToken: pushToken }) }).catch(() => {});
        }
        apiFetch('/api/users/logout', { method: 'POST', headers, body: JSON.stringify(pushToken ? { fcmToken: pushToken } : {}) }).catch(() => {});
      }
    } catch (e) {
      console.warn('[LOGOUT] server logout failed:', e);
    }

    setUserState(null);
    await removeToken();
    await removeUser();

    // 2. Clear per-user local data so the next account on this device doesn't see it
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const prefixed = allKeys.filter(k => USER_SCOPED_PREFIXES.some(p => k.startsWith(p)));
      await AsyncStorage.multiRemove([...USER_SCOPED_KEYS, 'zenvy_push_token', ...prefixed]);
    } catch (e) {
      console.warn('[LOGOUT] local data cleanup failed:', e);
    }

    // 3. Re-handshake the realtime socket as a guest, and close the signed-in-only campus socket
    //    (required lazily: campusSocketClient imports this module's helpers).
    reconnectSocket();
    try { require('../modules/campus/campusSocketClient').disconnectCampusSocket(); } catch {}

    // 4. Clear Google & Firebase sessions so the next sign-in shows the account picker
    try {
      const auth = require('@react-native-firebase/auth').default;
      if (auth().currentUser) {
        await auth().signOut();
      }
    } catch (e) {
      console.warn('[LOGOUT] Firebase signOut failed:', e);
    }
    try {
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');
      if (GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signOut();
      }
    } catch (e) {
      console.warn('[LOGOUT] GoogleSignin signOut failed:', e);
    }
  };

  const refreshUser = async () => {
    try {
      const tokenAtStart = await getToken();
      if (!tokenAtStart) {
        // Guest, or the session expired (getToken already cleared it): drop any stale in-memory profile
        setUserState(null);
        return;
      }
      const { API_URL } = require('../constants/api');
      const { apiFetch } = require('../utils/auth');
      const response = await apiFetch(`${API_URL}/api/users/profile`);
      // The user logged out (or switched accounts) while this was in flight: don't resurrect the old profile
      if ((await getToken()) !== tokenAtStart) return;
      if (response.ok) {
        const data = await response.json();
        setUser(data);
      } else if (response.status === 401) {
        // Token has expired or is invalid -> force logout immediately to prevent redirect loop
        await logout();
      } else {
        // Fallback to local storage if API call fails due to other reasons (e.g. network offline)
        const stored = await getUser();
        if (stored) setUserState(normalizeUserId(stored));
      }
    } catch (e) {
      const stored = await getUser();
      if (stored) setUserState(normalizeUserId(stored));
    }
  };

  // Session expired / revoked while the app is open: drop the stale profile (expired) or re-check
  // it against /profile, which logs out on a real 401 (throttled so a burst of 401s checks once).
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  const lastSessionCheckRef = useRef(0);
  useEffect(() => onSessionInvalid((reason) => {
    if (reason === 'expired') {
      setUserState(null);
      return;
    }
    const now = Date.now();
    if (now - lastSessionCheckRef.current < 15000) return;
    lastSessionCheckRef.current = now;
    refreshUserRef.current().catch(() => {});
  }), []);

  // Silent sliding session refresh: on start (once signed in) and whenever the app comes back to the
  // foreground. refreshSessionIfNeeded is a no-op unless the token is within 7 days of expiry.
  const signedIn = !!user;
  useEffect(() => {
    if (isLoading || !signedIn) return;
    refreshSessionIfNeeded();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshSessionIfNeeded();
    });
    return () => sub.remove();
  }, [isLoading, signedIn]);

  // Login / registration changes the identity: re-handshake the shared socket with the new token
  // (setToken always runs before setUser). Logout is handled explicitly in logout().
  const currentUserId = (user?._id || user?.id || null) as string | null;
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (isLoading) return;
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = currentUserId;
      return;
    }
    if (currentUserId !== prevUserIdRef.current) {
      prevUserIdRef.current = currentUserId;
      if (currentUserId) reconnectSocket();
    }
  }, [currentUserId, isLoading]);

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
