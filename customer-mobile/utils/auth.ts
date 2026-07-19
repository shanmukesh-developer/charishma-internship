import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Token Management ──────────────────────────────────────────────────────────
export const getToken = async (): Promise<string | null> => {
  return await AsyncStorage.getItem('zenvy_token');
};

export const setToken = async (token: string): Promise<void> => {
  await AsyncStorage.setItem('zenvy_token', token);
};

export const removeToken = async (): Promise<void> => {
  await AsyncStorage.removeItem('zenvy_token');
};

// ── User Management ───────────────────────────────────────────────────────────
export const getUser = async (): Promise<any | null> => {
  const raw = await AsyncStorage.getItem('zenvy_user');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

export const setUser = async (user: any): Promise<void> => {
  await AsyncStorage.setItem('zenvy_user', JSON.stringify(user));
};

export const removeUser = async (): Promise<void> => {
  await AsyncStorage.removeItem('zenvy_user');
};

import { API_URL } from '../constants/api';

// ── Authenticated Fetch ───────────────────────────────────────────────────────
export const apiFetch = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;
  return fetch(fullUrl, { ...options, headers });
};

// ── Logout ────────────────────────────────────────────────────────────────────
export const logout = async (): Promise<void> => {
  await AsyncStorage.multiRemove(['zenvy_token', 'zenvy_user', 'zenvy_favorites']);
};
