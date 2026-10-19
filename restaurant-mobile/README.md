# Zenvy Restaurant (Android)

Partner app for restaurants (kitchens) that Zenvy riders deliver for. Expo SDK 57. Package `com.zenvy.restaurant`. Store accounts are created by the Zenvy team
(admin dashboard); there is no self sign-up in this app.

Checks:

```bash
npx tsc --noEmit
npx expo export --platform android
```

## Release build (Play)

Version `1.0.0` / versionCode `1` (app.json).

### Upload key (release signing) — never commit it

`android/` is generated (`expo prebuild`) and git-ignored, so signing is added on every prebuild by
`plugins/withReleaseSigning.js` (same plugin in all partner apps; this app uses the prefix **`ZENVY_RESTAURANT_UPLOAD`**, so its
key never collides with the other Zenvy apps' keys). The release build is **never** signed with the debug keystore:
without an upload key a local `assembleRelease` / `bundleRelease` stops with an error
(`ZENVY_ALLOW_UNSIGNED_RELEASE=1` makes an unsigned test build instead), a key file named `debug.keystore` is
refused, and the build stops when `google-services.json` is missing (`ALLOW_BUILD_WITHOUT_FCM=1` overrides;
without it new-order pushes never reach a closed app). `app.config.js` also refuses an EAS production build without it.

Put the four values in `%USERPROFILE%\.gradle\gradle.properties` (survives `expo prebuild --clean`), or in
`restaurant-mobile/android/keystore.properties` (git-ignored, deleted by `prebuild --clean`):

```properties
ZENVY_RESTAURANT_UPLOAD_STORE_FILE=C:/Users/Shanmukh/zenvy-keys/zenvy-restaurant-upload.jks
ZENVY_RESTAURANT_UPLOAD_STORE_PASSWORD=********
ZENVY_RESTAURANT_UPLOAD_KEY_ALIAS=zenvy-restaurant-upload
ZENVY_RESTAURANT_UPLOAD_KEY_PASSWORD=********
```

Create the key once (back up the file and passwords outside the repo):

```bash
keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -keystore C:/Users/Shanmukh/zenvy-keys/zenvy-restaurant-upload.jks -alias zenvy-restaurant-upload
```

Firebase: add `com.zenvy.restaurant` to the Zenvy Firebase project, put `google-services.json` next to `app.json` (git-ignored),
then `npx expo prebuild --clean --platform android`.

Phones with an older debug-signed build must uninstall it once before installing the upload-key build.

### Hardening (app.json, re-applied on every prebuild)

- `expo-build-properties`: R8 minify + resource shrinking in release, keep rules for react-native-reanimated,
  `usesCleartextTraffic: false` (HTTPS only; debug builds keep cleartext for a local backend), compile / target
  SDK 36. Hermes is the JS engine.
- `android.allowBackup: false`. The session token is only in `expo-secure-store` (memory-only if that fails,
  never AsyncStorage). Release is never `debuggable`.
- Removed permissions (`blockedPermissions`): SYSTEM_ALERT_WINDOW, RECORD_AUDIO, READ_CONTACTS, location.
- Keep `android/app/build/outputs/mapping/release/mapping.txt` of every Play build.

```bash
cd restaurant-mobile
npx expo prebuild --clean --platform android
cd android
$env:NODE_ENV="production"; .\gradlew.bat bundleRelease     # PowerShell; AAB -> app/build/outputs/bundle/release/
```

## Play Store notes

- **Account deletion**: Settings → **Delete account** explains that store accounts are created by Zenvy and closed by
  the Zenvy team on request (email / call buttons, link to `/legal/delete-account#stores`).
- Privacy policy and the other policies: Settings → Legal.
- Crashes: a root `ErrorBoundary` (`src/ui/ErrorBoundary.tsx`) shows "Something went wrong — Restart" instead of a
  blank screen and logs the error (Sentry can be added there later).
