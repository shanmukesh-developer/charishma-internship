// The one HTTP client for the rider app. Reads the token at call time (no stale closures),
// times out after 15 s and turns every failure into ApiError (server answered) or NetworkError (it didn't).
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
  constructor(message = "Can't reach Zenvy. Check your internet and try again.") {
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

export function configureApiClient(opts: {
  getToken: TokenGetter;
  /** Gets the token the refused request carried (a newer token may already be in use). */
  onUnauthorized?: (usedToken: string) => void;
  onUnapproved?: () => void;
  onReachability?: (reachable: boolean) => void;
}) {
  getToken = opts.getToken;
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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  /** false for login: a 401 there means wrong password, not an expired session. */
  auth?: boolean;
  /** Send this token instead of the current one (logout clean-up runs after the session is already cleared). */
  token?: string;
}

export async function apiFetch<T = unknown>(endpoint: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 15000, auth = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json', ...versionHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? opts.token ?? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

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
