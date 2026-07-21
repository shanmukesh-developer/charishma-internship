type LogoutHandler = () => void;

let authToken: string | null = null;
let apiHost = '';
let onUnauthorized: LogoutHandler | null = null;

export function configureApiClient(host: string, token: string | null, onLogout?: LogoutHandler) {
  apiHost = host;
  authToken = token;
  onUnauthorized = onLogout ?? null;
}

export function getApiHost(): string {
  return apiHost;
}

export async function apiFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${apiHost}${endpoint}`, { ...options, headers });

  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error('Session expired. Please sign in again.');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `Request failed (${res.status})`);
  }

  return data as T;
}
