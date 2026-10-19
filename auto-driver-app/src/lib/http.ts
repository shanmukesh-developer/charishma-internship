// The one HTTP client: timeout, Bearer token read at call time, JSON in/out, every failure turned into
// ApiError (the server answered: status + code + data from backend/modules/autoRide/services/util.js
// sendError, i.e. { code, message, ...extra }) or NetworkError (it didn't). Messages are shown as-is.
// No React Native imports: the verification script runs this file under Node against the real routers.
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
  constructor(message = 'No internet. Check mobile data and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

let getToken: () => string | null = () => null;
let onUnauthorized: ((code?: string) => void) | null = null;
let onSuspended: ((message: string) => void) | null = null;
let onNetwork: ((ok: boolean) => void) | null = null;
let baseUrl = API_URL;

/** Server clock minus phone clock (ms), from the HTTP Date header (countdowns use serverNow()). */
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;
function noteServerDate(res: Response, sentAt: number) {
  try {
    const d = Date.parse(res.headers.get('date') || '');
    if (!Number.isFinite(d)) return;
    const off = d - (sentAt + Date.now()) / 2;
    clockOffsetMs = Math.abs(off) < 1500 ? 0 : off;
  } catch { /* keep the last offset */ }
}

export function configureHttp(opts: {
  getToken: () => string | null;
  onUnauthorized?: (code?: string) => void;
  onSuspended?: (message: string) => void;
  onNetwork?: (ok: boolean) => void;
  baseUrl?: string;
}) {
  getToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized || null;
  onSuspended = opts.onSuspended || null;
  onNetwork = opts.onNetwork || null;
  if (opts.baseUrl) baseUrl = opts.baseUrl.replace(/\/+$/, '');
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return fallback;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** multipart body (photo upload). Sent as-is; fetch sets the boundary header. */
  form?: FormData;
  timeoutMs?: number;
  /** false for login / register / send-otp: a 401 there means wrong details, not an expired session. */
  auth?: boolean;
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, timeoutMs = 20000, auth = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json', ...versionHeaders(), ...(opts.headers || {}) };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  const sentAt = Date.now();
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (onNetwork) onNetwork(false);
    throw new NetworkError(
      e?.name === 'AbortError'
        ? 'Zenvy is slow to answer. Please try again.'
        : 'No internet. Check mobile data and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
  if (onNetwork) onNetwork(true);

  noteServerDate(res, sentAt);
  let data: any = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  // This app version was retired by the owner: show the Update screen (src/lib/UpdateGate.tsx).
  if (res.status === 426) reportUpgradeRequired(data);
  if (!res.ok) {
    const code = data && typeof data.code === 'string' ? data.code : undefined;
    if (res.status === 401 && auth && token && onUnauthorized) onUnauthorized(code);
    if (res.status === 403 && code === 'DRIVER_SUSPENDED' && onSuspended) onSuspended(String(data.message || 'Your driver account is suspended.'));
    const msg = (data && typeof data.message === 'string' && data.message) ||
      (res.status === 429 ? 'Too many attempts. Please wait a minute and try again.'
        : res.status >= 500 ? 'Zenvy is having trouble right now. Please try again in a moment.'
          : 'Request failed. Please try again.');
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/**
 * Multipart upload through React Native's XMLHttpRequest. Expo's global fetch does not send
 * React Native { uri, name, type } file parts (the request fails before it leaves the phone and looks
 * like "no internet"), so photo uploads use XHR, the same way the customer app does.
 */
export function apiUploadXhr<T = any>(path: string, form: FormData, timeoutMs = 60000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}${path}`);
    const headers: Record<string, string> = { Accept: 'application/json', ...versionHeaders() };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    // No Content-Type: the networking layer adds multipart/form-data with its boundary.
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (onNetwork) onNetwork(true);
      let data: any = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      const status = xhr.status;
      if (status === 426) reportUpgradeRequired(data);
      if (status >= 200 && status < 300) { resolve(data as T); return; }
      const code = data && typeof data.code === 'string' ? data.code : undefined;
      if (status === 401 && token && onUnauthorized) onUnauthorized(code);
      const msg = (data && typeof data.message === 'string' && data.message) ||
        (status === 413 ? 'That photo is too large. Please pick a smaller one.'
          : status === 429 ? 'Too many attempts. Please wait a minute and try again.'
            : status >= 500 ? 'Zenvy is having trouble right now. Please try again in a moment.'
              : 'Upload failed. Please try again.');
      reject(new ApiError(status, msg, data));
    };
    xhr.onerror = () => reject(new NetworkError('Upload did not go through. Check mobile data and try again.'));
    xhr.ontimeout = () => reject(new NetworkError('Zenvy is slow to answer. Please try again.'));
    xhr.send(form as any);
  });
}
