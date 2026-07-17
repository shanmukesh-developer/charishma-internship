import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getUser, setUser as saveUser, removeToken, removeUser } from '../utils/auth';

interface User {
  _id?: string;
  id?: string;
  name: string;
  email: string;
  phone?: string;
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
      if (stored) setUserState(stored);
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
  };

  const refreshUser = async () => {
    const stored = await getUser();
    if (stored) setUserState(stored);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
