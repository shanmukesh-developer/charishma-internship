import { API_URL, SOCKET_URL } from './config';

// Re-exported for older imports; new code should import from '@/lib/config'.
export { API_URL, SOCKET_URL };

/**
 * Error thrown by adminRequest. `message` is safe to show; `code` / `field` come from the server's JSON
 * (e.g. { code: 'INVALID_COMPLIANCE', field: 'gstin' }) and `data` is the parsed error body (e.g. the fresh
 * settings sent with a 409 CONFIG_CONFLICT).
 */
export class ApiError extends Error {
  status: number;
  code: string | null;
  field: string | null;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    this.code = typeof d.code === 'string' ? d.code : null;
    this.field = typeof d.field === 'string' ? d.field : null;
  }
}

/**
 * JSON request to the backend. `path` is relative to API_URL (e.g. '/api/admin/orders').
 * The FetchInterceptor adds the admin token, and only for the backend origin.
 * Throws an Error whose message is safe to show to the admin.
 */
export async function adminRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init, headers });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data.message === 'string' ? data.message : '';
    if (res.status === 401) throw new ApiError('Your session has expired. Please sign in again.', 401, data);
    if (res.status === 403) throw new ApiError(message || 'You do not have permission to do this.', 403, data);
    if (res.status >= 500) throw new ApiError(`The server could not complete this request (${res.status}). Please try again.`, res.status, null);
    throw new ApiError(message || `Request failed (${res.status}).`, res.status, data);
  }
  return data as T;
}

/** Uploads an image (JPEG/PNG/WEBP, max 2 MB) and returns its URL. */
export async function uploadImage(file: File): Promise<string> {
  if (!/^image\/(jpe?g|png|webp)$/.test(file.type)) throw new Error('Use a JPEG, PNG or WEBP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('The image must be 2 MB or smaller.');
  const body = new FormData();
  body.append('image', file);
  const data = await adminRequest<{ imageUrl?: string }>('/api/upload', { method: 'POST', body });
  if (!data?.imageUrl) throw new Error('The image upload did not return a URL.');
  return data.imageUrl;
}

/** Accepts '/api/x', '/x' or 'x' and returns a path under /api. */
const apiPath = (url: string) => {
  const path = url.startsWith('/api') ? url.substring(4) : url;
  return `/api${path.startsWith('/') ? '' : '/'}${path}`;
};

const withBody = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Axios-style wrapper kept for older pages. */
const api = {
  get: async (url: string) => ({ data: await adminRequest<any>(apiPath(url)) }),
  post: async (url: string, body?: unknown) => ({ data: await adminRequest<any>(apiPath(url), withBody('POST', body)) }),
  put: async (url: string, body?: unknown) => ({ data: await adminRequest<any>(apiPath(url), withBody('PUT', body)) }),
  delete: async (url: string) => ({ data: await adminRequest<any>(apiPath(url), { method: 'DELETE' }) }),
};

export default api;
