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
  profileImage?: string;
  streakCount?: number;
  totalOrders?: number;
  address?: string;
  hostelBlock?: string;
  karmaPoints?: number;
  city?: string;
  badges?: string[];
  referralCode?: string;
  friendCode?: string;
  createdAt?: string;
  role?: string;
  statusText?: string;
  statusEmoji?: string;
  statusSeenBy?: string[];
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
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

  const setUser = async (u: User | null) => {
    setUserState(u);
    if (u) await saveUser(u);
    else await removeUser();
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
        setUserState(data);
        await saveUser(data);
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
