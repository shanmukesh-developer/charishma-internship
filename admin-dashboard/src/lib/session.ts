"use client";
/**
 * Admin session store.
 *
 * The JWT lives in memory and in sessionStorage (cleared when the tab closes);
 * it is never kept in localStorage. Nothing here trusts the client: every admin
 * API call is checked by the backend, the role is re-confirmed with
 * GET /api/admin/me on each load, and the session is dropped on 401 / failed
 * re-checks. On a reload of a tab that was already signed in, the shell renders
 * at once from the admin last confirmed for this token (sessionStorage) while
 * that check runs alongside the pages' own reads, instead of a blank
 * "Checking your session" screen for a full server round trip first.
 */
import { API_URL } from './config';
import { clearRequestCache, setPeekTokenSource } from './requestCache';

export type AuthStatus = 'checking' | 'authed' | 'denied' | 'error';

export interface AdminUser {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  /** S1: ADMIN_2FA_REQUIRED and 2-step sign-in not set up yet: only the Account security page works. */
  mfaSetupRequired?: boolean;
  twoFactorEnabled?: boolean;
  /** This account's password is still one the old seed scripts published (server: /api/admin/me). */
  weakPassword?: boolean;
}

export interface AuthState {
  status: AuthStatus;
  user: AdminUser | null;
  /** Human readable reason for 'denied' / 'error'. */
  message: string | null;
}

const TOKEN_KEY = 'zenvy_admin_token';
const LEGACY_KEY = 'user'; // old builds stored { token, role } in localStorage
const USER_KEY = 'zenvy_admin_user'; // { t: last 16 chars of the token it belongs to, user }

const rememberUser = (token: string, user: AdminUser) => {
  try { window.sessionStorage.setItem(USER_KEY, JSON.stringify({ t: token.slice(-16), user })); } catch { /* ignore */ }
};
const rememberedUser = (token: string): AdminUser | null => {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(USER_KEY) || 'null');
    return v && v.t === token.slice(-16) && v.user && String(v.user.role || '').toLowerCase() === 'admin' ? (v.user as AdminUser) : null;
  } catch { return null; }
};

let memoryToken: string | null = null;
let tokenLoaded = false;
let state: AuthState = { status: 'checking', user: null, message: null };
let inflight: Promise<AuthState> | null = null;
const listeners = new Set<() => void>();
const SERVER_STATE: AuthState = { status: 'checking', user: null, message: null };

const emit = () => listeners.forEach((l) => l());

const setState = (next: AuthState) => {
  state = next;
  emit();
};

const loadToken = () => {
  if (tokenLoaded || typeof window === 'undefined') return;
  tokenLoaded = true;
  try {
    memoryToken = window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  // Remove the JWT that older builds left in localStorage.
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable */
  }
};

export function getToken(): string | null {
  loadToken();
  return memoryToken;
}
setPeekTokenSource(getToken);

export function getAuthState(): AuthState {
  return state;
}

export function getServerAuthState(): AuthState {
  return SERVER_STATE;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called after a successful admin login. */
export function startSession(token: string, user: AdminUser) {
  loadToken();
  clearRequestCache();
  memoryToken = token;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* in-memory only */
  }
  rememberUser(token, user);
  setState({ status: 'authed', user, message: null });
}

/** Drops the local session. `message` is shown on the login page. */
export function clearSession(message: string | null = null) {
  loadToken();
  clearRequestCache(); // cached admin data never outlives the session that loaded it
  memoryToken = null;
  inflight = null;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  setState({ status: 'denied', user: null, message });
}

/** Ends the session locally and asks the backend to clear any legacy cookie. */
export async function logout() {
  const token = getToken();
  clearSession(null);
  try {
    await fetch(`${API_URL}/api/users/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    /* best effort */
  }
}

const TIMEOUT_MS = 15000; // Render free instances can take a while to wake up

async function getJson(path: string, token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

const toUser = (b: any): AdminUser => ({
  id: String(b?.id ?? b?._id ?? ''),
  name: b?.name || 'Admin',
  phone: b?.phone ?? null,
  email: b?.email || null,
  role: String(b?.role || ''),
  mfaSetupRequired: !!b?.mfaSetupRequired,
  twoFactorEnabled: !!b?.twoFactorEnabled,
  weakPassword: !!b?.weakPassword,
});

async function runVerify(): Promise<AuthState> {
  const token = getToken();
  if (!token) {
    clearSession(null);
    return state;
  }
  if (state.status !== 'authed') {
    const known = rememberedUser(token);
    setState(known ? { status: 'authed', user: known, message: null } : { status: 'checking', user: state.user, message: null });
  }

  // The admin signed out (or signed in again) while this check was running: its answer is about a
  // token that is no longer the session's, so it must not change the state.
  const superseded = () => getToken() !== token;

  try {
    let r = await getJson('/api/admin/me', token);
    if (superseded()) return state;
    // Backends deployed before /api/admin/me existed: fall back to the profile route.
    if (r.status === 404) r = await getJson('/api/users/profile', token);
    if (superseded()) return state;

    if (r.status === 401) {
      clearSession(r.body?.code === 'MFA_REQUIRED'
        ? 'Sign in again with your 2-step code.'
        : 'Your session has expired. Please sign in again.');
      return state;
    }
    if (r.status === 403) {
      clearSession(r.body?.message?.includes('suspended')
        ? 'This account is suspended.'
        : 'This account does not have admin access.');
      return state;
    }
    if (!r.ok) {
      if (state.status === 'authed') return state; // a server hiccup does not sign out a known admin; pages show their own errors
      setState({ status: 'error', user: null, message: `The server returned an error (${r.status}). Please retry.` });
      return state;
    }
    const user = toUser(r.body);
    if (user.role.toLowerCase() !== 'admin') {
      clearSession('This account does not have admin access.');
      return state;
    }
    rememberUser(token, user);
    setState({ status: 'authed', user, message: null });
    return state;
  } catch {
    if (superseded()) return state;
    if (state.status === 'authed') return state;
    setState({
      status: 'error',
      user: null,
      message: 'Could not reach the ZenWe server. Check your connection and retry.',
    });
    return state;
  }
}

/** Confirms the session with the backend. Concurrent callers share one request. */
export function verifySession(): Promise<AuthState> {
  if (!inflight) {
    const run: Promise<AuthState> = runVerify().finally(() => {
      // clearSession() may already have dropped this check and a newer one may be running.
      if (inflight === run) inflight = null;
    });
    inflight = run;
  }
  return inflight;
}
