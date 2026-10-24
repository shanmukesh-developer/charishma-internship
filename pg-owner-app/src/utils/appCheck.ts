/**
 * S1: Firebase App Check (Play Integrity) — client side, NOT ACTIVE in this app yet.
 *
 * This app (ZCS PG Partner) ships no @react-native-firebase module, so there is no App Check native module: getAppCheckToken() returns null and requests go out without the `X-Firebase-AppCheck` header.
 * The backend (backend/utils/appCheck.js, env APP_CHECK_MODE) is off by default and fails open, so nothing
 * is blocked. Do NOT set APP_CHECK_MODE=enforce (or include this app's group, "partner", in
 * APP_CHECK_ENFORCE_GROUPS) until this app sends tokens.
 *
 * To enable later (needs a new native build, like the customer app's customer-mobile/utils/appCheck.ts):
 *   1. npm i @react-native-firebase/app@25.1.0 @react-native-firebase/app-check@25.1.0 (same version for both)
 *      and make sure google-services.json for this package id is present (app.config googleServicesFile).
 *   2. Firebase console -> App Check -> register this Android app with Play Integrity (link the Play
 *      Console app; add the upload + Play app-signing SHA-256); debug builds: add the debug token.
 *   3. Copy the body of customer-mobile/utils/appCheck.ts here (initializeAppCheck with
 *      ReactNativeFirebaseAppCheckProvider, android provider 'playIntegrity' / 'debug' in __DEV__) and call
 *      installAppCheckFetchHook(<API origin>) once where the API base URL is configured (src/config.ts).
 *   4. expo prebuild / EAS build, install, check GET /api/admin/metrics/perf -> appCheck.byGroup.partner.valid.
 */
export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

/** No App Check in this build: always null (never throws, never waits). */
export async function getAppCheckToken(): Promise<string | null> {
  return null;
}

/** Headers to merge into a protected request: empty until App Check is enabled here. */
export async function appCheckHeaders(): Promise<Record<string, string>> {
  const token = await getAppCheckToken();
  return token ? { [APP_CHECK_HEADER]: token } : {};
}
