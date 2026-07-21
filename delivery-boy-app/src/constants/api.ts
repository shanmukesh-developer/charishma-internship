export const STORAGE_SERVER_KEY = '@zenvy_native_backend_url';
export const STORAGE_TOKEN_KEY = '@zenvy_native_rider_token';
export const STORAGE_PROFILE_KEY = '@zenvy_native_rider_profile';
export const STORAGE_ONLINE_KEY = '@zenvy_native_rider_online';

export const DEFAULT_API_URL = 'http://10.0.2.2:5005/api'; // Android emulator → host localhost
export const FALLBACK_API_URL = 'http://localhost:5005/api';

export const EARNINGS_PER_DELIVERY = 30;
export const POLL_INTERVAL_MS = 30000;

/** Strip trailing /api for Socket.io base URL */
export function socketBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
}
