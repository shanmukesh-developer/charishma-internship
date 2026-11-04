/**
 * S1: Firebase App Check (Play Integrity on Android) for the Zenvy API.
 *
 * The backend (backend/utils/appCheck.js) reads the `X-Firebase-AppCheck` header on its abuse-prone
 * POSTs (OTP, sign-in, orders, wallet, event registration, Auto-Ride holds). Its mode is APP_CHECK_MODE
 * (off by default, then monitor, then enforce), so this module can ship before anything is enforced.
 *
 * Here: a global fetch hook (installed once from constants/api.ts) that adds the header ONLY to those
 * protected calls to the Zenvy API. The token comes from @react-native-firebase/app-check (Play Integrity in
 * release builds, the debug provider in __DEV__). It never blocks or breaks a request: no native module (old
 * binary / web), App Check not set up in the Firebase console, Play Integrity unavailable, or a slow answer
 * (> TOKEN_TIMEOUT_MS) all mean "send the request without the header". After a failure, token requests pause
 * for RETRY_AFTER_MS. Kill switch: app.json expo.extra.appCheckEnabled = false.
 */
import { Platform } from 'react-native';

export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';
const TOKEN_TIMEOUT_MS = 1500;
const RETRY_AFTER_MS = 5 * 60 * 1000;

// Same list as backend/utils/appCheck.js PROTECTED (customer app calls only). Paths without query / trailing slash.
const SEG = '[^/]+';
const PROTECTED: RegExp[] = [
  // send-email-otp too: the email backup when an SMS code does not arrive (the server protects both in 'otp').
  /^\/api\/users\/(send-otp|send-email-otp|login|register|verify-otp|google-login|google-complete|reset-password)$/,
  /^\/api\/orders$/,
  /^\/api\/mega-basket$/,
  new RegExp(`^/api/mega-basket/${SEG}/pay$`),
  /^\/api\/services\/book$/,
  new RegExp(`^/api/pg/${SEG}/book$`),
  /^\/api\/rentals\/bookings$/,
  /^\/api\/features\/gift$/,
  new RegExp(`^/api/vault/claim/${SEG}$`),
  /^\/api\/rewards\/use-spin$/,
  new RegExp(`^/api/campus-events/(?!organizer/|check-in/)${SEG}/(register|teams)$`),
  new RegExp(`^/api/campus-events/(?!organizer/|check-in/)${SEG}/slots/${SEG}/(hold|book)$`),
  new RegExp(`^/api/campus-events/registrations/${SEG}/(confirm|accept-offer|pay/razorpay-order)$`),
  new RegExp(`^/api/auto-ride/trips/${SEG}/(holds|private-requests)$`),
  new RegExp(`^/api/auto-ride/bookings/${SEG}/confirm$`),
];

/** Is this (method, path) one of the calls the backend checks? */
export function isProtectedCall(method: string, path: string): boolean {
  if (String(method || 'GET').toUpperCase() !== 'POST') return false;
  const p = String(path || '').split('?')[0].replace(/\/+$/, '');
  return PROTECTED.some((re) => re.test(p));
}

const enabledByConfig = (): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-constants');
    const C = (mod && (mod.default || mod)) || {};
    const extra = (C.expoConfig && C.expoConfig.extra) || {};
    return extra.appCheckEnabled !== false;
  } catch {
    return true;
  }
};

let instance: Promise<any | null> | null = null;
let pausedUntil = 0;

/** Initialises App Check once (null when it cannot run here). */
const appCheckInstance = (): Promise<any | null> => {
  if (instance) return instance;
  instance = (async () => {
    if (Platform.OS === 'web' || !enabledByConfig()) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getApp } = require('@react-native-firebase/app');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AC = require('@react-native-firebase/app-check');
      const provider = new AC.ReactNativeFirebaseAppCheckProvider();
      provider.configure({
        android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
        apple: { provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback' },
        web: { provider: 'reCaptchaV3', siteKey: 'unused' },
      });
      return await AC.initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
    } catch (err) {
      if (__DEV__) console.log('[APP_CHECK] not available:', (err as Error)?.message);
      return null;
    }
  })();
  return instance;
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
});

/** The current App Check token, or null (never throws, never waits more than TOKEN_TIMEOUT_MS). */
export async function getAppCheckToken(): Promise<string | null> {
  if (Date.now() < pausedUntil) return null;
  try {
    const run = (async () => {
      const ac = await appCheckInstance();
      if (!ac) return null;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getToken } = require('@react-native-firebase/app-check');
      const res = await getToken(ac, false);
      return res && typeof res.token === 'string' && res.token ? res.token : null;
    })();
    const token = await withTimeout(run, TOKEN_TIMEOUT_MS);
    if (!token) pausedUntil = Date.now() + RETRY_AFTER_MS;
    return token;
  } catch {
    pausedUntil = Date.now() + RETRY_AFTER_MS;
    return null;
  }
}

const hasHeader = (headers: any, name: string): boolean => {
  if (!headers) return false;
  const n = name.toLowerCase();
  if (typeof headers.has === 'function') return headers.has(name);
  if (Array.isArray(headers)) return headers.some((p: any) => String(p[0]).toLowerCase() === n);
  return Object.keys(headers).some((k) => k.toLowerCase() === n);
};
const withHeader = (init: any, name: string, value: string): any => {
  const given = init && init.headers;
  if (given && typeof given.set === 'function') { given.set(name, value); return init; }
  if (Array.isArray(given)) return { ...init, headers: [...given, [name, value]] };
  return { ...(init || {}), headers: { ...(given || {}), [name]: value } };
};

/**
 * Wraps global fetch: protected POSTs to `apiOrigin` get the App Check header when a token is available.
 * Installed once; every other request passes through untouched (no await, no delay).
 */
export function installAppCheckFetchHook(apiOrigin: string | null, target: any = globalThis): boolean {
  if (!apiOrigin || Platform.OS === 'web' || !target || typeof target.fetch !== 'function' || target.fetch.__zenvyAppCheck) return false;
  const origin = apiOrigin.toLowerCase().replace(/\/+$/, '');
  const inner = target.fetch.bind(target);
  const wrapped: any = async (input: any, init?: any) => {
    try {
      const url = typeof input === 'string' ? input : input && typeof input.href === 'string' ? input.href : input && typeof input.url === 'string' ? input.url : null;
      const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
      if (url && url.toLowerCase().startsWith(`${origin}/`) && isProtectedCall(method, url.slice(origin.length)) && !hasHeader(init && init.headers, APP_CHECK_HEADER)) {
        const token = await getAppCheckToken();
        if (token) init = withHeader(init, APP_CHECK_HEADER, token);
      }
    } catch { /* never block a request */ }
    return inner(input, init);
  };
  wrapped.__zenvyAppCheck = true;
  wrapped.__zenvyForceUpdate = target.fetch.__zenvyForceUpdate;
  target.fetch = wrapped;
  return true;
}
