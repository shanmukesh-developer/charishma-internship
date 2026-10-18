// App-wide constants. ONE backend: /c/hostel-bite/backend on Render (driver routes /api/auto-ride/driver).
// For local testing set EXPO_PUBLIC_API_URL=http://<lan-ip>:5000 (never test writes on production).
// No React Native imports here: the API client is also run under Node by the verification script.
import {
  readExtraTrustedHosts,
  refreshEndpointOverride,
  resolveEndpoint,
  trustedHostsFrom,
} from './lib/endpointOverride';
import { configureForceUpdate } from './lib/forceUpdate';

/** Built-in address of the one Zenvy backend. */
export const BUILT_IN_API_URL = 'https://hostelbites-backend-jwmt.onrender.com';

/**
 * Hosts the app may move to when the backend advertises a new address (GET /api/config/endpoints):
 * built-in host + app.json extra.trustedApiHosts + EXPO_PUBLIC_TRUSTED_API_HOSTS ("api.zenvy.in" or
 * "*.zenvy.in"). Put the future domain here BEFORE building the store release.
 */
export const TRUSTED_API_HOSTS = trustedHostsFrom(BUILT_IN_API_URL, process.env.EXPO_PUBLIC_TRUSTED_API_HOSTS, readExtraTrustedHosts());

// EXPO_PUBLIC_API_URL (dev) wins; else the built-in address, or a verified trusted address the backend
// advertised on an earlier launch (src/lib/endpointOverride.ts). Never changes mid-session.
const ACTIVE_ENDPOINT = resolveEndpoint({ builtIn: BUILT_IN_API_URL, devOverride: process.env.EXPO_PUBLIC_API_URL, trusted: TRUSTED_API_HOSTS });
export const API_URL = ACTIVE_ENDPOINT.api;
/** socket.io address (same as API_URL unless the backend advertises a separate one). */
export const SOCKET_URL = ACTIVE_ENDPOINT.socket;

// Force update (src/lib/forceUpdate.ts): version headers on every API call + 426 UPGRADE_REQUIRED handling.
configureForceUpdate({ app: 'autodriver', apiBase: API_URL });

let endpointCheckStarted = false;
/** Once per launch, a few seconds after start: learn / verify / self-heal the API address for the next launch. */
export function scheduleApiEndpointCheck(delayMs = 4000): void {
  if (endpointCheckStarted) return;
  endpointCheckStarted = true;
  setTimeout(() => {
    refreshEndpointOverride({ builtIn: BUILT_IN_API_URL, active: ACTIVE_ENDPOINT, trusted: TRUSTED_API_HOSTS }).catch(() => {});
  }, delayMs);
}

/** Driver API prefix (backend/modules/autoRide/routes.js driverRouter). */
export const DRIVER_API = '/api/auto-ride/driver';

/** Zenvy partner support. Digits only, with country code. */
export const SUPPORT_PHONE = '919391955674';
export const SUPPORT_PHONE_DISPLAY = '+91 93919 55674';
export const EMERGENCY_NUMBER = '112';

export const STORAGE = {
  token: '@zenvy_autodriver_token',
  driver: '@zenvy_autodriver_profile',
  savedPhone: '@zenvy_autodriver_saved_phone',
  queue: '@zenvy_autodriver_offline_queue_v1',
  pushRegistered: '@zenvy_autodriver_push_registered',
} as const;

/** Trip Detail: refetch this often (the socket nudges on top of it). */
export const TRIP_POLL_MS = 10000;
/** Home: refetch this often while open. */
export const HOME_POLL_MS = 30000;
/** Socket down this long = offline banner. */
export const OFFLINE_AFTER_MS = 15000;

/** Mirrors backend/modules/autoRide/enums.js LIMITS (the server checks again; these only guide the form). */
export const LIMITS = {
  MAX_FARE: 5000,
  MAX_FULL_FARE: 20000,
  /** Full-auto extra charges: at most this and never above the full-auto fare (server: enums.js MAX_EXTRA_CHARGES). */
  MAX_EXTRA_CHARGES: 2000,
  MAX_DELAY_MINUTES: 120,
  MIN_DELAY_MINUTES: 5,
  MIN_LEAD_MINUTES: 2,
  /** DEFAULT_SETTINGS.maxAdvanceDays (admin can change it; the server has the final word). */
  MAX_ADVANCE_DAYS: 7,
  MAX_VEHICLE_PHOTOS: 4,
  PIN_MAX_ATTEMPTS: 5,
  MAX_VEHICLES: 3,
  ABSOLUTE_MAX_CAPACITY: 12,
} as const;
