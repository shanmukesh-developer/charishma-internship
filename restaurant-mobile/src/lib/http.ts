// The one HTTP client: timeout, Bearer token read at call time, JSON in/out, and every failure turned
// into ApiError (the server answered) or NetworkError (it didn't). Messages are friendly, shown as-is.
import { API_URL } from '../config';
import { reportUpgradeRequired, versionHeaders } from './forceUpdate';

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
  constructor(message = 'No internet. Check Wi-Fi or mobile data and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

let getToken: () => string | null = () => null;

/**
 * Server clock minus phone clock (ms), from the HTTP Date header of the latest answer. Order times
 * (createdAt) are server times, so age checks (e.g. the ring cap) use serverNow(), not a phone clock that
 * may be minutes off. 0 until the first answer.
 */
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;
function noteServerDate(res: Response, sentAt: number) {
  try {
    const d = Date.parse(res.headers.get('date') || '');
    if (!Number.isFinite(d)) return;
    const local = (sentAt + Date.now()) / 2; // the header was stamped somewhere between send and receive
    const off = d - local;
    // The header has 1 s resolution: ignore sub-second noise.
    clockOffsetMs = Math.abs(off) < 1500 ? 0 : off;
  } catch { /* keep the last offset */ }
}
let onUnauthorized: (() => void) | null = null;

export function configureHttp(opts: { getToken: () => string | null; onUnauthorized: () => void }) {
  getToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return fallback;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** multipart body (photo upload). Sent as-is; fetch sets the boundary header. */
  form?: FormData;
  timeoutMs?: number;
  /** false for login: a 401 there means a wrong password, not an expired session. */
  auth?: boolean;
  /** Treat a 401 as an ordinary error instead of logging out. */
  no401Logout?: boolean;
  /** Extra request headers (e.g. Idempotency-Key). */
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, timeoutMs = 15000, auth = true, no401Logout = false } = opts;
  const headers: Record<string, string> = { Accept: 'application/json', ...versionHeaders(), ...(opts.headers || {}) };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  const sentAt = Date.now();
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new NetworkError(
      e?.name === 'AbortError'
        ? 'Zenvy is slow to answer. Please try again.'
        : 'No internet. Check Wi-Fi or mobile data and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  noteServerDate(res, sentAt);
  let data: any = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  // This app version was retired by the owner: show the Update screen (src/lib/UpdateGate.tsx).
  if (res.status === 426) reportUpgradeRequired(data);
  if (!res.ok) {
    if (res.status === 401 && auth && !no401Logout && onUnauthorized) onUnauthorized();
    const msg = (data && typeof data.message === 'string' && data.message) ||
      (res.status === 429 ? 'Too many attempts. Please wait a minute and try again.'
        : res.status >= 500 ? 'Zenvy is having trouble right now. Please try again in a moment.'
          : 'Request failed. Please try again.');
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}
