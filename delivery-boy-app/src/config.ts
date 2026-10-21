// App-wide constants. ONE backend only (Render).
import {
  readExtraTrustedHosts,
  refreshEndpointOverride,
  resolveEndpoint,
  trustedHostsFrom,
} from './services/endpointOverride';
import { configureForceUpdate } from './services/forceUpdate';

/** Built-in address of the one Zenvy backend. */
export const BUILT_IN_API_BASE = 'https://hostelbites-backend-jwmt.onrender.com';

/**
 * Hosts the app may move to when the backend advertises a new address (GET /api/config/endpoints):
 * built-in host + app.json extra.trustedApiHosts + EXPO_PUBLIC_TRUSTED_API_HOSTS ("api.zenvy.in" or
 * "*.zenvy.in"). Put the future domain here BEFORE building the store release.
 */
export const TRUSTED_API_HOSTS = trustedHostsFrom(BUILT_IN_API_BASE, process.env.EXPO_PUBLIC_TRUSTED_API_HOSTS, readExtraTrustedHosts());

// Built-in address, or a verified trusted address the backend advertised on an earlier launch
// (src/services/endpointOverride.ts). Never changes mid-session.
const ACTIVE_ENDPOINT = resolveEndpoint({ builtIn: BUILT_IN_API_BASE, trusted: TRUSTED_API_HOSTS });

/** The one Zenvy backend (REST base, ends in /api). */
export const API_URL = `${ACTIVE_ENDPOINT.api}/api`;
/** socket.io address (same host as API_URL unless the backend advertises a separate one). */
export const SOCKET_URL = ACTIVE_ENDPOINT.socket;

// Force update (src/services/forceUpdate.ts): version headers on every API call + 426 UPGRADE_REQUIRED handling.
configureForceUpdate({ app: 'rider', apiBase: ACTIVE_ENDPOINT.api });

let endpointCheckStarted = false;
/** Once per launch, a few seconds after start: learn / verify / self-heal the API address for the next launch. */
export function scheduleApiEndpointCheck(delayMs = 4000): void {
  if (endpointCheckStarted) return;
  endpointCheckStarted = true;
  setTimeout(() => {
    refreshEndpointOverride({ builtIn: BUILT_IN_API_BASE, active: ACTIVE_ENDPOINT, trusted: TRUSTED_API_HOSTS }).catch(() => {});
  }, delayMs);
}

/** Strip trailing /api for the Socket.io base URL. */
export function socketBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
}

/** Sent with the push token so the server can tell app generations apart. */
export const APP_PUSH_VERSION = 'rider-3.0.0';

/** Storage keys (token/profile keys kept from older builds so riders stay logged in after the update). */
export const KEYS = {
  token: '@zenvy_native_rider_token',
  profile: '@zenvy_native_rider_profile',
  voice: '@zenvy_rider_voice_v1',
  spoken: '@zenvy_rider_spoken_v1',
  dismissed: '@zenvy_rider_dismissed_orders',
  pushRegistered: '@zenvy_rider_push_registered',
  queue: '@zenvy_rider_offline_queue_v2',
  legacyQueue: '@zenvy_native_offline_queue',
  cachePrefix: '@zenvy_rider_cache:',
  /** The one-time "Stay reachable" battery / autostart guide was finished or dismissed. */
  reachableGuide: '@zenvy_rider_reachable_guide_v1',
};

/** Foreground refresh cadence. Pool polling is the fallback for push / socket. */
export const POLL_ORDERS_MS = 12000;
export const POLL_STATS_MS = 60000;

/** Seconds a rider has to accept a new order before it is skipped (it stays in the pool for others). */
export const OFFER_SECONDS = 30;

/** Orders a rider may carry at once (server RIDER_MAX_ACTIVE_ORDERS, default 3): no new-order call beyond it. */
export const RIDER_MAX_ACTIVE_ORDERS = 3;

/** Rejected / timed-out offers stay hidden this long. */
export const DISMISS_TTL_MS = 30 * 60 * 1000;

/** Zenvy support line (call / WhatsApp). */
export const SUPPORT_PHONE = '919391955674';
