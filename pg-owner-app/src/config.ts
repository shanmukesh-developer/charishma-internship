// App-wide constants. ONE backend: /c/hostel-bite/backend on Render (owner routes /api/pg-owner,
// backend/modules/pgOwner). For local testing set EXPO_PUBLIC_API_URL=http://<lan-ip>:5000 (never test writes
// on production). No React Native imports here: the API client also runs under Node.
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
 * built-in host + app.json extra.trustedApiHosts + EXPO_PUBLIC_TRUSTED_API_HOSTS.
 */
export const TRUSTED_API_HOSTS = trustedHostsFrom(BUILT_IN_API_URL, process.env.EXPO_PUBLIC_TRUSTED_API_HOSTS, readExtraTrustedHosts());

// EXPO_PUBLIC_API_URL (dev) wins; else the built-in address, or a verified trusted address the backend
// advertised on an earlier launch (src/lib/endpointOverride.ts). Never changes mid-session.
const ACTIVE_ENDPOINT = resolveEndpoint({ builtIn: BUILT_IN_API_URL, devOverride: process.env.EXPO_PUBLIC_API_URL, trusted: TRUSTED_API_HOSTS });
export const API_URL = ACTIVE_ENDPOINT.api;
/** Socket.IO address (live `pg:changed` nudges, src/lib/live.ts): same host as the API unless the backend advertised another. */
export const SOCKET_URL = ACTIVE_ENDPOINT.socket;

// Force update (src/lib/forceUpdate.ts, identical in every ZCS app): version headers on every API call +
// 426 UPGRADE_REQUIRED handling. The backend knows this app as 'pgowner' (utils/appVersionPolicy.js); the
// shared file's AppKey list predates this app, hence the cast.
configureForceUpdate({ app: 'pgowner' as unknown as AppKey, apiBase: API_URL });

let endpointCheckStarted = false;
/** Once per launch, a few seconds after start: learn / verify / self-heal the API address for the next launch. */
export function scheduleApiEndpointCheck(delayMs = 4000): void {
  if (endpointCheckStarted) return;
  endpointCheckStarted = true;
  setTimeout(() => {
    refreshEndpointOverride({ builtIn: BUILT_IN_API_URL, active: ACTIVE_ENDPOINT, trusted: TRUSTED_API_HOSTS }).catch(() => {});
  }, delayMs);
}

/** Owner API prefix (backend/modules/pgOwner/routes.js ownerRouter). */
export const OWNER_API = '/api/pg-owner';

/** ZCS partner support. Digits only, with country code. */
export const SUPPORT_PHONE = '919391955674';
export const SUPPORT_PHONE_DISPLAY = '+91 93919 55674';
export const SUPPORT_EMAIL = 'projectshanmukh@gmail.com';

export const STORAGE = {
  token: '@zcs_pgowner_token',
  owner: '@zcs_pgowner_profile',
  savedPhone: '@zcs_pgowner_saved_phone',
  queue: '@zcs_pgowner_offline_queue_v1',
  pushRegistered: '@zcs_pgowner_push_registered',
  listing: '@zcs_pgowner_current_listing',
} as const;

/** Home + booking requests: refetch this often while open (pushes nudge on top). */
export const HOME_POLL_MS = 30000;

/** Mirrors backend limits (the server checks again; these only guide the forms). */
export const LIMITS = {
  REASON_MIN: 3,
  REASON_MAX: 300,
  REPLY_MAX: 1000,
  DESCRIPTION_MAX: 2000,
  AMENITIES_MAX: 30,
  AMENITY_LEN: 40,
  MAX_PHOTOS: 20,
  RULES_PER_GROUP: 10,
  RULE_LEN: 160,
  MAX_MEALS: 6,
  MENU_LEN: 300,
  HOLIDAYS_MAX: 31,
  RENT_MAX: 500000,
} as const;
