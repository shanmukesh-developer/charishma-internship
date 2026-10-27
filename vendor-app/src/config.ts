// App-wide constants. ONE backend: /c/hostel-bite/backend on Render.
// For local testing of writes set EXPO_PUBLIC_API_URL=http://<lan-ip>:5000 (never test writes on production).
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
configureForceUpdate({ app: 'vendor', apiBase: API_URL });

let endpointCheckStarted = false;
/** Once per launch, a few seconds after start: learn / verify / self-heal the API address for the next launch. */
export function scheduleApiEndpointCheck(delayMs = 4000): void {
  if (endpointCheckStarted) return;
  endpointCheckStarted = true;
  setTimeout(() => {
    refreshEndpointOverride({ builtIn: BUILT_IN_API_URL, active: ACTIVE_ENDPOINT, trusted: TRUSTED_API_HOSTS }).catch(() => {});
  }, delayMs);
}

/** Zenvy partner support. Digits only, with country code. */
export const SUPPORT_PHONE = '919391955674';
export const SUPPORT_PHONE_DISPLAY = '+91 93919 55674';
/** C9: account closure requests (same address as the legal pages). */
export const SUPPORT_EMAIL = 'projectshanmukh@gmail.com';

export const STORAGE = {
  token: '@zenvy_vendor_token',
  vendor: '@zenvy_vendor_profile',
  savedPhone: '@zenvy_vendor_saved_phone',
  voice: '@zenvy_vendor_voice_v1',
  /** Orders put off with "Later" (per shop, id → time). */
  silenced: '@zenvy_vendor_silenced',
  // voice.ts reads this once to migrate an old switch; the vendor app never had one.
  soundOnV1: '@zenvy_vendor_sound_on',
} as const;

/** While the socket is down, refetch orders this often. */
export const FALLBACK_POLL_MS = 20000;
/** Even with a healthy socket, refetch this often (catches anything a flaky network dropped). */
export const SAFETY_POLL_MS = 90000;
/** New-order ringing: repeat the announcement this often until accepted / rejected. */
export const RING_REPEAT_MS = 20000;
/** Socket down this long = "offline" (red banner + voice warning). */
export const OFFLINE_AFTER_MS = 15000;

/** Reject a NEW order (before accepting). */
export const REJECT_REASONS = [
  'Item finished',
  'Too busy right now',
  'Shop closing',
  "Can't deliver to this place",
] as const;

/** Cancel an order you already accepted. */
export const CANCEL_REASONS = [
  'Customer not answering',
  'Customer asked to cancel',
  "Couldn't find the address",
  'Item finished',
] as const;

/** New orders older than this turn amber / red. The server cancels an order not accepted in STORE_ACCEPT_TIMEOUT_MIN
 * (backend utils/orderTimeouts, default 7), so both warnings must come before that. */
export const NEW_ORDER_WARN_MIN = 3;
export const NEW_ORDER_LATE_MIN = 5;
