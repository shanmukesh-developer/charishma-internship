import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getUser, setUser as saveUser, removeToken, removeUser, getToken } from '../utils/auth';

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
  karmaPoints?: number;
  city?: string;
  badges?: string[];
  referralCode?: string;
  friendCode?: string;
  createdAt?: string;
  role?: string;
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
        setUserState(stored);
      } else {
        await removeToken();
        await removeUser();
      }
    } catch { }
    setIsLoading(false);
  };

  const setUser = (u: Partial<User> | null) => {
    if (u) {
      setUserState(prev => {
        const merged: User = {
          name: prev?.name || '',
          email: prev?.email || '',
          ...prev,
          ...u,
          profileImage: u.profileImage !== undefined ? u.profileImage : (prev?.profileImage ?? null),
          statusText: u.statusText !== undefined ? u.statusText : (prev?.statusText ?? null),
          statusEmoji: u.statusEmoji !== undefined ? u.statusEmoji : (prev?.statusEmoji ?? null),
          statusSeenBy: u.statusSeenBy !== undefined ? u.statusSeenBy : (prev?.statusSeenBy ?? null),
        };
        saveUser(merged).catch(() => {});
        return merged;
      });
    } else {
      setUserState(null);
      removeUser().catch(() => {});
    }
  };

  const logout = async () => {
    setUserState(null);
    await removeToken();
    await removeUser();

    // Clear Google & Firebase sessions to prevent auto-logging in the old account on next attempt
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
      const isSignedIn = await GoogleSignin.isSignedIn();
      if (isSignedIn) {
        await GoogleSignin.signOut();
      }
    } catch (e) {
      console.warn('[LOGOUT] GoogleSignin signOut failed:', e);
    }
  };

  const refreshUser = async () => {
    try {
      const { API_URL } = require('../constants/api');
      const { apiFetch } = require('../utils/auth');
      const response = await apiFetch(`${API_URL}/api/users/profile`);
      if (response.ok) {
        const data = await response.json();
        setUser(data);
      } else if (response.status === 401) {
        // Token has expired or is invalid -> force logout immediately to prevent redirect loop
        await logout();
      } else {
        // Fallback to local storage if API call fails due to other reasons (e.g. network offline)
        const stored = await getUser();
        if (stored) setUserState(stored);
      }
    } catch (e) {
      const stored = await getUser();
      if (stored) setUserState(stored);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
