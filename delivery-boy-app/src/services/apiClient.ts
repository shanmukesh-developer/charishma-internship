// The one HTTP client for the rider app. Reads the token at call time (no stale closures),
// times out after 15 s and turns every failure into ApiError (server answered) or NetworkError (it didn't).
import { API_URL } from '../config';
import { reportUpgradeRequired, versionHeaders } from './forceUpdate';
import { withWakeRetry, coldStartWait, WakeVerdict } from './serverWake';

export class ApiError extends Error {
  status: number;
  code?: string;
  data: any;
  constructor(status: number, message: string, data: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = data && typeof data.code === 'string' ? data.code : undefined;
    this.data = data;
  }
}

export class NetworkError extends Error {
  constructor(message = "Can't reach ZCS. Check your internet and try again.") {
    super(message);
    this.name = 'NetworkError';
  }
}

type TokenGetter = () => string | null;

const apiBase = API_URL;
let getToken: TokenGetter = () => null;
let onUnauthorized: ((usedToken: string) => void) | null = null;
let onForbiddenUnapproved: (() => void) | null = null;
let onReachability: ((reachable: boolean) => void) | null = null;
let onTokenRefreshed: ((oldToken: string, newToken: string) => void) | null = null;

export function configureApiClient(opts: {
  getToken: TokenGetter;
  /** Gets the token the refused request carried (a newer token may already be in use). */
  onUnauthorized?: (usedToken: string) => void;
  onUnapproved?: () => void;
  onReachability?: (reachable: boolean) => void;
  /** Silent session refresh succeeded: store `newToken` if `oldToken` is still the one in use. */
  onTokenRefreshed?: (oldToken: string, newToken: string) => void;
}) {
  getToken = opts.getToken;
  onTokenRefreshed = opts.onTokenRefreshed ?? null;
  onUnauthorized = opts.onUnauthorized ?? null;
  onForbiddenUnapproved = opts.onUnapproved ?? null;
  onReachability = opts.onReachability ?? null;
}

export function getApiBase(): string {
  return apiBase;
}

export function getApiHostLabel(): string {
  return apiBase.replace(/^https?:\/\//, '').replace(/\/api\/?$/, '');
}

export function isUnapprovedError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.code === 'RIDER_NOT_APPROVED' || /pending verification/i.test(err.message))
  );
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** 401 codes that are about the request, never about the session (backend partnerAccountRoutes / appCheck). */
const NOT_SESSION_401 = new Set(['WRONG_PASSWORD', 'PHONE_MISMATCH', 'VERIFICATION_EXPIRED', 'APP_CHECK_REQUIRED']);

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  /** false for login: a 401 there means wrong password, not an expired session. */
  auth?: boolean;
  /** Send this token instead of the current one (logout clean-up runs after the session is already cleared). */
  token?: string;
}

// ── Silent session refresh (sliding 30 days) ─────────────────────────────────────
// The rider session is a 30-day token. When the token in use is within REFRESH_WINDOW of expiry, the next
// signed-in request (the app polls while open, so this runs at start and on every return to the app)
// fires one POST /delivery/refresh in the background. Failure never signs the rider out here and never
// loops: the same token is retried at most every RETRY_AFTER. An expired or revoked token still ends the
// session through the normal 401 path.
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
let refreshInFlight = false;
let lastRefreshAttempt: { token: string; at: number } | null = null;

function base64UrlDecode(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const str = input.replace(/-/g, '+').replace(/_/g, '/');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const v = chars.indexOf(str[i]);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** Expiry of a JWT in ms since epoch, or null when it cannot be read. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(base64UrlDecode(part));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Refreshes the session in the background when it is close to expiry. Safe to call often. */
export function maybeRefreshSession(): void {
  const token = getToken();
  if (!token || refreshInFlight || !onTokenRefreshed) return;
  const exp = tokenExpiresAt(token);
  const now = Date.now();
  if (exp === null || exp <= now || exp - now > REFRESH_WINDOW_MS) return;
  if (lastRefreshAttempt && lastRefreshAttempt.token === token && now - lastRefreshAttempt.at < RETRY_AFTER_MS) return;
  lastRefreshAttempt = { token, at: now };
  refreshInFlight = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  fetch(`${apiBase}/delivery/refresh`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...versionHeaders() },
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) return;
      const data: any = await res.json().catch(() => null);
      const next = data && typeof data.token === 'string' ? data.token : null;
      if (next && next !== token) onTokenRefreshed?.(token, next);
    })
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timer);
      refreshInFlight = false;
    });
}

async function apiFetchOnce<T = unknown>(endpoint: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 15000, auth = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json', ...versionHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? opts.token ?? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (auth && !opts.token) maybeRefreshSession();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${apiBase}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    onReachability?.(false);
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  onReachability?.(true);

  const text = await res.text().catch(() => '');
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  // This app version was retired by the owner: show the Update screen (src/services/UpdateGate.tsx).
  if (res.status === 426) reportUpgradeRequired(data);
  if (!res.ok) {
    const serverMessage = data && typeof data.message === 'string' ? data.message : null;
    // A 401 that answers the request itself (wrong password while deleting the account, an SMS code
    // that expired, App Check) is not an expired session: keep the rider signed in and show the reason.
    const code = data && typeof data.code === 'string' ? data.code : '';
    if (res.status === 401 && NOT_SESSION_401.has(code)) {
      throw new ApiError(401, serverMessage || 'That did not work. Please try again.', data);
    }
    if (res.status === 401 && auth && token) {
      onUnauthorized?.(token);
      throw new ApiError(401, 'Your session expired. Please log in again.', data);
    }
    const err = new ApiError(
      res.status,
      serverMessage ||
        (res.status >= 500
          ? 'Something went wrong on our side. Please try again in a moment.'
          : `Request failed (${res.status})`),
      data,
    );
    if (isUnapprovedError(err)) onForbiddenUnapproved?.();
    throw err;
  }
  return data as T;
}

// ── GET cold-start retry (serverWake.ts) ─────────────────────────────────────────
// A GET rides out a backend restart (502/503/504, 503 SERVER_STARTING, or no answer): retried with backoff
// for up to ~3 minutes while WakeBanner shows. Identical GETs share one retry loop (polling screens do not
// pile up requests on a starting server). Writes and uploads are never retried here.
const wakeVerdict = (err: unknown): WakeVerdict => {
  if (err instanceof NetworkError) return { wait: 0, network: true };
  if (err instanceof ApiError) {
    const wait = coldStartWait(err.status, err.data);
    return wait === null ? null : { wait };
  }
  return null;
};
const inflightGets = new Map<string, { promise: Promise<any>; startedAt: number }>();
// When the last write (claim, picked up, delivered...) finished. A GET that started before it may carry the state from
// before that write, so a GET asked for afterwards never joins it: the active list refreshed right after a claim used
// to come back without the order (a false "Order cancelled") and the offers with it still in.
let lastWriteAt = 0;

export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  if ((opts.method || 'GET') !== 'GET') {
    try { return await apiFetchOnce<T>(path, opts); } finally { lastWriteAt = Date.now(); }
  }
  const key = `${(opts.token ?? getToken()) || ''}|${path}|${opts.auth === false ? 0 : 1}`;
  const entry = inflightGets.get(key);
  if (entry && entry.startedAt > lastWriteAt) return entry.promise as Promise<T>;
  const own = { promise: withWakeRetry(() => apiFetchOnce<T>(path, opts), wakeVerdict), startedAt: Date.now() };
  inflightGets.set(key, own);
  const clear = () => { if (inflightGets.get(key) === own) inflightGets.delete(key); };
  own.promise.then(clear, clear);
  return own.promise;
}
