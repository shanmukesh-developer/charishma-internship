import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ── Token Management (Encrypted via SecureStore) ──────────────────────────────
// SecureStore uses Android Keystore / iOS Keychain for hardware-backed encryption.
// Web (no SecureStore) uses AsyncStorage; a phone never does (see C9 note below).

const TOKEN_KEY = 'zenvy_token';

// ── Session-expiry signal ─────────────────────────────────────────────────────
// The JWT can expire (or be revoked) while the app is open. AuthContext subscribes so the
// in-memory profile is dropped / re-checked instead of the app acting signed in with no token.
type SessionListener = (reason: 'expired' | 'unauthorized') => void;
const sessionListeners = new Set<SessionListener>();
export const onSessionInvalid = (cb: SessionListener): (() => void) => {
  sessionListeners.add(cb);
  return () => { sessionListeners.delete(cb); };
};
const emitSessionInvalid = (reason: 'expired' | 'unauthorized') => {
  sessionListeners.forEach((cb) => { try { cb(reason); } catch {} });
};

export const isTokenExpired = (token: string): boolean => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return false; // If parsing fails, let backend handle verification
  }
};

// C9: on Android / iOS the token lives ONLY in SecureStore. If SecureStore fails (keystore error) it is kept
// in memory for this run of the app, never written to AsyncStorage (plain text, could reach backups).
// A token an older build left in AsyncStorage is moved into SecureStore on first read, then deleted there.
// Web has no SecureStore: the browser build keeps using AsyncStorage (localStorage), as before.
let memoryToken: string | null = null;

const readNativeToken = async (): Promise<string | null> => {
  let secure: string | null = null;
  try {
    secure = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return memoryToken;
  }
  if (secure) return secure;
  if (memoryToken) return memoryToken;
  let legacy: string | null = null;
  try { legacy = await AsyncStorage.getItem(TOKEN_KEY); } catch { legacy = null; }
  if (legacy) {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, legacy);
    } catch {
      memoryToken = legacy;
    }
    try { await AsyncStorage.removeItem(TOKEN_KEY); } catch {}
  }
  return legacy;
};

export const getToken = async (): Promise<string | null> => {
  let token: string | null = null;
  if (Platform.OS === 'web') {
    try { token = await AsyncStorage.getItem(TOKEN_KEY); } catch { token = null; }
  } else {
    token = await readNativeToken();
  }
  if (token && isTokenExpired(token)) {
    await removeToken();
    await removeUser();
    emitSessionInvalid('expired');
    return null;
  }
  return token;
};

export const setToken = async (token: string): Promise<void> => {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return;
  }
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    memoryToken = null;
  } catch {
    memoryToken = token; // never AsyncStorage on a phone
  }
  try { await AsyncStorage.removeItem(TOKEN_KEY); } catch {}
};

export const removeToken = async (): Promise<void> => {
  memoryToken = null;
  if (Platform.OS !== 'web') {
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
  }
  try { await AsyncStorage.removeItem(TOKEN_KEY); } catch {}
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
import { reportUpgradeRequired, versionHeaders } from './forceUpdate';

// ── Request helpers ───────────────────────────────────────────────────────────
// Android's OkHttp client has no default timeout, so a dead connection would spin forever.
// 45 s still covers a Render cold start.
export const REQUEST_TIMEOUT_MS = 45000;

const fetchWithTimeout = async (url: string, options: RequestInit = {}): Promise<Response> => {
  if (options.signal) return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// Identical GETs already on the wire share one request (several screens/components ask for the same
// list on mount). Each caller gets its own clone so every body can be read independently.
const inflightGets = new Map<string, Promise<Response>>();

// ── Authenticated Fetch ───────────────────────────────────────────────────────
export const apiFetch = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'GET' && !options.signal && !options.body) {
    const token = await getToken();
    const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;
    const key = `${token || ''}|${fullUrl}|${JSON.stringify(options.headers || {})}`;
    let shared = inflightGets.get(key);
    if (!shared) {
      shared = apiFetchRaw(url, options, token);
      inflightGets.set(key, shared);
      const clear = () => { if (inflightGets.get(key) === shared) inflightGets.delete(key); };
      shared.then(clear, clear);
    }
    const res = await shared;
    return res.clone();
  }
  return apiFetchRaw(url, options);
};

const apiFetchRaw = async (
  url: string,
  options: RequestInit = {},
  knownToken?: string | null
): Promise<Response> => {
  const token = knownToken !== undefined ? knownToken : await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...versionHeaders(),
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;
  // No silent dev -> production retry: a dev build must never write test data to production.
  const res = await fetchWithTimeout(fullUrl, { ...options, headers });
  // This app version was retired by the owner: show the Update screen (utils/UpdateGate.tsx).
  if (res.status === 426) {
    try { reportUpgradeRequired(await res.clone().json()); } catch { /* not JSON */ }
  }
  // A signed request was rejected: let AuthContext re-check the session (it logs out only if
  // /api/users/profile also answers 401, so a route-specific 401 never signs the user out).
  if (res.status === 401 && token && !/\/api\/users\/(profile|logout|fcm-token)/.test(fullUrl)) {
    emitSessionInvalid('unauthorized');
  }
  return res;
};

/** Parses a JSON body without throwing (HTML 502 pages during a cold start return null). */
export const readJson = async (res: Response): Promise<any | null> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

export const SERVER_BUSY_MESSAGE = 'Zenvy is waking up. Please try again in a few seconds.';
export const NETWORK_ERROR_MESSAGE = "Can't reach Zenvy right now. Check your internet and try again.";

/** Error thrown by postAuth when the request never reached the server (offline / timeout). */
export class NetworkError extends Error {
  isNetwork = true;
  constructor(message = NETWORK_ERROR_MESSAGE) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface AuthResponse {
  ok: boolean;
  status: number;
  data: any;
  /** Friendly message for a failed request (server message, or a generic one). */
  message: string;
  code?: string;
}

/**
 * POST JSON to a public auth endpoint (login, register, OTP...).
 * Never throws for HTTP errors; throws NetworkError when the server can't be reached.
 */
export const postAuth = async (url: string, body: any, withToken = false): Promise<AuthResponse> => {
  let res: Response;
  try {
    if (withToken) {
      res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
    } else {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...versionHeaders() },
        body: JSON.stringify(body),
      });
    }
  } catch {
    throw new NetworkError();
  }
  const data = await readJson(res);
  if (!data) {
    // Non-JSON body: Render cold start / proxy error page
    return { ok: false, status: res.status, data: {}, message: SERVER_BUSY_MESSAGE, code: 'SERVER_BUSY' };
  }
  const message = typeof data.message === 'string' && data.message
    ? data.message
    : (res.ok ? '' : 'Something went wrong. Please try again.');
  return { ok: res.ok, status: res.status, data, message, code: data.code };
};

// ── Phone helpers ─────────────────────────────────────────────────────────────
/** Last 10 digits of whatever the user typed (+91, spaces and dashes are fine). */
export const normalizePhone = (input: string): string => (input || '').replace(/\D/g, '').slice(-10);
export const isValidIndianMobile = (digits: string): boolean => /^[6-9]\d{9}$/.test(digits);

/** Turns Firebase phone-auth errors into one short, friendly sentence (codes go to the console only). */
export const mapFirebasePhoneAuthError = (code?: string, rawMsg?: string): string => {
  if (code || rawMsg) console.warn('[PHONE_AUTH_ERR]', code, rawMsg);
  const msg = rawMsg || '';
  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'That phone number looks invalid.';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return 'Incorrect code. Please check and try again.';
    case 'auth/session-expired':
    case 'auth/code-expired':
      return 'This code has expired. Tap Resend OTP.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many attempts. Please try again later or use password login.';
    case 'auth/network-request-failed':
      return 'No internet connection.';
  }
  if (msg.includes('TOO_MANY_ATTEMPTS')) return 'Too many attempts. Please try again later or use password login.';
  if (code || msg.includes('17028')) return 'We could not verify your number right now. Please use password login or try again later.';
  if (/JSON|Unexpected character|SyntaxError/i.test(msg)) return SERVER_BUSY_MESSAGE;
  // Never show raw SDK text (it is technical and sometimes not even English)
  return 'We could not verify your number right now. Please use password login or try again later.';
};

// ── Logout ────────────────────────────────────────────────────────────────────
export const logout = async (): Promise<void> => {
  await removeToken();
  await AsyncStorage.multiRemove(['zenvy_user', 'zenvy_favorites']);
};
