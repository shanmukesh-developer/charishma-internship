// ZCS Campus Stall: app-wide constants. ONE backend: /c/hostel-bite/backend on Render (stall routes
// /api/campus-booking/vendor, backend/modules/campusBooking; login = the stall's ZCS Vendor account).
// For local testing of writes set EXPO_PUBLIC_API_URL=http://<lan-ip>:5000 (never test writes on production).
import {
  readExtraTrustedHosts,
  refreshEndpointOverride,
  resolveEndpoint,
  trustedHostsFrom,
} from './lib/endpointOverride';
import { configureForceUpdate, type AppKey } from './lib/forceUpdate';

/** Built-in address of the one ZCS backend. */
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

// Force update (src/lib/forceUpdate.ts, identical in every ZCS app): version headers on every API call + 426
// UPGRADE_REQUIRED handling. The backend knows this app as 'campusstall' (utils/appVersionPolicy.js); the shared
// file's AppKey list predates this app, hence the cast.
configureForceUpdate({ app: 'campusstall' as unknown as AppKey, apiBase: API_URL });

let endpointCheckStarted = false;
/** Once per launch, a few seconds after start: learn / verify / self-heal the API address for the next launch. */
export function scheduleApiEndpointCheck(delayMs = 4000): void {
  if (endpointCheckStarted) return;
  endpointCheckStarted = true;
  setTimeout(() => {
    refreshEndpointOverride({ builtIn: BUILT_IN_API_URL, active: ACTIVE_ENDPOINT, trusted: TRUSTED_API_HOSTS }).catch(() => {});
  }, delayMs);
}

/** ZCS partner support. Digits only, with country code. */
export const SUPPORT_PHONE = '919391955674';
export const SUPPORT_PHONE_DISPLAY = '+91 93919 55674';
/** C9: account closure requests (same address as the legal pages). */
export const SUPPORT_EMAIL = 'projectshanmukh@gmail.com';

export const STORAGE = {
  token: '@zcs_campusstall_token',
  vendor: '@zcs_campusstall_profile',
  savedPhone: '@zcs_campusstall_saved_phone',
  pushRegistered: '@zcs_campusstall_push_registered',
} as const;

/** Bookings: refetch this often while open (the socket nudges on top; this covers a closed-app gap / no FCM). */
export const POLL_MS = 30000;
/** Socket down this long = "offline" banner. */
export const OFFLINE_AFTER_MS = 15000;
