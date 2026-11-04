// The one HTTP client: timeout, Bearer token read at call time, JSON in/out, and every failure turned
// into ApiError (the server answered) or NetworkError (it didn't). Messages are friendly, shown as-is.
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
  /** true when the request ran out of time (slow network / server waking up), false for no answer at all. */
  timeout: boolean;
  constructor(message = 'No internet. Check Wi-Fi or mobile data and try again.', timeout = false) {
    super(message);
    this.name = 'NetworkError';
    this.timeout = timeout;
  }
}

/** Photo-upload messages: the real cause, never a blanket "No internet" while the phone is online. */
export const UPLOAD_MESSAGES = {
  tooLarge: 'That photo is too large. Please pick a smaller one.',
  session: 'Your session has expired. Please log in again.',
  waking: 'ZENV is waking up, please try again in a few seconds.',
  interrupted: 'The upload was interrupted. Please try again.',
  unreachable: "Couldn't reach ZENV. Check your Wi-Fi or mobile data, then try again.",
} as const;

/** 408 (server request timeout) and 502 / 503 / 504 (free Render instance waking up) are worth one retry. */
export const isWakingStatus = (status: number) => status === 408 || (status >= 502 && status <= 504);

/**
 * After an upload got no HTTP answer: a quick GET /api/ping (8 s) tells "waking up" (slow / 5xx) from
 * "the upload itself was cut off" (ping answers) from "nothing gets through" (ping fails at once).
 */
export async function probeServer(timeoutMs = 8000): Promise<'up' | 'waking' | 'unreachable'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/api/ping`, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    return res.status >= 500 ? 'waking' : 'up';
  } catch (e: any) {
    return e?.name === 'AbortError' ? 'waking' : 'unreachable';
  } finally {
    clearTimeout(timer);
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

async function apiFetchOnce<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
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
        ? 'ZENV is slow to answer. Please try again.'
        : 'No internet. Check Wi-Fi or mobile data and try again.',
      e?.name === 'AbortError',
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
        : res.status >= 500 ? 'ZENV is having trouble right now. Please try again in a moment.'
          : 'Request failed. Please try again.');
    throw new ApiError(res.status, msg, data);
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
// When the last write (accept, ready, confirm payment...) finished. A GET that started before it may carry the state
// from before that write, so a GET asked for afterwards never joins it: the list refreshed right after an action used
// to come back with the old status and overwrite the newer one (a confirmed booking stayed under Pending).
let lastWriteAt = 0;

export async function apiFetch<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  if ((opts.method || 'GET') !== 'GET' || (opts as any).form) {
    try { return await apiFetchOnce<T>(path, opts); } finally { lastWriteAt = Date.now(); }
  }
  const key = `${getToken() || ''}|${path}|${opts.auth === false ? 0 : 1}`;
  const entry = inflightGets.get(key);
  if (entry && entry.startedAt > lastWriteAt) return entry.promise as Promise<T>;
  const own = { promise: withWakeRetry(() => apiFetchOnce<T>(path, opts), wakeVerdict), startedAt: Date.now() };
  inflightGets.set(key, own);
  const clear = () => { if (inflightGets.get(key) === own) inflightGets.delete(key); };
  own.promise.then(clear, clear);
  return own.promise;
}

/** The message for an upload the server answered with an error status. */
export function uploadStatusMessage(status: number, data: any): string {
  const code = data && typeof data.code === 'string' ? data.code : '';
  if (status === 401) return UPLOAD_MESSAGES.session;
  if (status === 413 || code === 'FILE_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE') return UPLOAD_MESSAGES.tooLarge;
  if (isWakingStatus(status)) return UPLOAD_MESSAGES.waking;
  return (data && typeof data.message === 'string' && data.message) ||
    (status >= 500 ? 'ZENV is having trouble right now. Please try again in a moment.' : 'Upload failed. Please try again.');
}

/**
 * Multipart POST through XMLHttpRequest. Expo SDK 57's global fetch (expo/fetch) cannot send React
 * Native's { uri, name, type } FormData file parts: it throws before the request leaves the phone, which
 * showed up as "No internet" on every photo. React Native's XHR streams the local file. A 401 here never
 * logs out (the caller shows the message).
 */
export function apiUploadForm<T = any>(path: string, form: FormData, timeoutMs = 90000): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    const headers: Record<string, string> = { Accept: 'application/json', ...versionHeaders() };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    // No Content-Type: the networking layer adds multipart/form-data with its boundary.
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      let data: any = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      if (xhr.status === 426) reportUpgradeRequired(data);
      if (xhr.status === 0) { reject(new NetworkError(UPLOAD_MESSAGES.interrupted)); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, uploadStatusMessage(xhr.status, data), data));
        return;
      }
      resolve(data as T);
    };
    xhr.onerror = () => reject(new NetworkError(UPLOAD_MESSAGES.interrupted));
    xhr.ontimeout = () => reject(new NetworkError(UPLOAD_MESSAGES.waking, true));
    xhr.send(form as any);
  });
}
