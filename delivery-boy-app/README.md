# Zenvy Rider (delivery partner app)

Expo (SDK 57) app for Zenvy delivery riders. Talks only to the one Zenvy backend
(`https://hostelbites-backend-jwmt.onrender.com/api`, rider routes under `/api/delivery/*`).

## What a rider sees
- **Home**: big ONLINE / OFFLINE duty switch, today's earnings / orders / cash in hand, active deliveries,
  incoming order card with a 30 s countdown (Accept / Skip), more available orders.
- **Delivery**: one screen per order with step progress Pickup → Picked → Drop → PIN → Done,
  Navigate (Google Maps two-wheeler) and Call buttons, item checklist at the store, huge COD amount,
  big PIN pad, "Can't do this order" and help in the ⋮ menu.
- **Earnings**: today / last 7 days, day-by-day bars, per-order list.
- **History**, **Profile** (vehicle, emergency contact, documents status, password, 112), **Help** (tickets, call, WhatsApp),
  **Voice** settings.

## Voice announcements (PhonePe soundbox style)
`src/voice/` — chime (vibration + system notification sound) then a spoken phrase via `expo-speech`.
Telugu by default, falling back to Hindi then English when the phone has no Telugu voice.
Announcements are queued (never overlap), de-duplicated per order/event, and stale ones are dropped.
Customer phone numbers / addresses are never spoken.

## Code map
```
App.tsx                 root switch: Splash → Login → Pending approval → Shell
src/config.ts           API URL, storage keys, intervals
src/theme.ts            colours, type scale, spacing, insets
src/types.ts            domain types
src/services/           apiClient, deliveryApi, orderModel, offlineQueue, session, socket, location, notifications, links, format
src/state/RiderStore.tsx  all rider state + actions (duty, orders, earnings, queue, socket, GPS, push, voice cues)
src/state/hooks.ts      app-active, network, interval, dismissed offers
src/voice/              phrases (te/hi/en), announcer (queue + dedupe + fallback), useVoice
src/ui/                 kit (Btn, Card, Row, Badge, Banner, …), Sheet, PinPad, Toast
src/screens/            Auth, Shell, Home, Delivery, Earnings, History, Profile, Support, VoiceSettings, parts
```

## Checks
```bash
npx tsc --noEmit
npx expo export --platform android
```

## Release build (Play)

Version: `1.0.4` / versionCode `5` (app.json; continues the native 1.0.3 / 4 builds). Package `com.srm.hostelbitesdelivery`.

### Upload key (release signing) — never commit it

`android/` is generated (`expo prebuild`) and git-ignored, so signing is added on every prebuild by
`plugins/withReleaseSigning.js` (same plugin in all partner apps; this app uses the prefix **`ZENVY_RIDER_UPLOAD`**,
so its key never collides with the customer / restaurant / vendor / driver keys). The release build is **never**
signed with the debug keystore: without an upload key a local `assembleRelease` / `bundleRelease` stops with an error
(`ZENVY_ALLOW_UNSIGNED_RELEASE=1` makes an unsigned test build instead), a key file named `debug.keystore` is refused,
and the build also stops when `google-services.json` is missing (`ALLOW_BUILD_WITHOUT_FCM=1` overrides).

Put the four values in `%USERPROFILE%\.gradle\gradle.properties` (survives `expo prebuild --clean`), or in
`delivery-boy-app/android/keystore.properties` (git-ignored, but deleted by `prebuild --clean`):

```properties
ZENVY_RIDER_UPLOAD_STORE_FILE=C:/Users/Shanmukh/zenvy-keys/zenvy-rider-upload.jks
ZENVY_RIDER_UPLOAD_STORE_PASSWORD=********
ZENVY_RIDER_UPLOAD_KEY_ALIAS=zenvy-rider-upload
ZENVY_RIDER_UPLOAD_KEY_PASSWORD=********
```

Create the key once (back up the file and passwords outside the repo):

```bash
keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 \
  -keystore C:/Users/Shanmukh/zenvy-keys/zenvy-rider-upload.jks -alias zenvy-rider-upload
```

Riders who installed an older debug-signed APK must uninstall it once before installing the upload-key build
(Android refuses an update signed with a different key).

### Hardening (app.json, re-applied on every prebuild)

- `expo-build-properties`: R8 minify + resource shrinking in release (`enableMinifyInReleaseBuilds`,
  `enableShrinkResourcesInReleaseBuilds`), `usesCleartextTraffic: false` (HTTPS only; debug builds keep cleartext
  for a local backend), compile / target SDK 36. Hermes is the JS engine (`hermesEnabled=true`).
- `android.allowBackup: false`: the session token never goes into Google / adb backups. The token lives only in
  `expo-secure-store`; if SecureStore fails it is kept in memory for that run, never in AsyncStorage.
- Release is never `debuggable`. Keep `android/app/build/outputs/mapping/release/mapping.txt` of every Play build
  (needed to read crash stack traces).

```bash
cd delivery-boy-app
npx expo prebuild --clean --platform android
cd android
$env:NODE_ENV="production"; .\gradlew.bat bundleRelease     # PowerShell; AAB -> app/build/outputs/bundle/release/
```

## Play Store notes

- **Account deletion**: Profile → **Delete account** (password or SMS code + type DELETE) calls
  `POST /api/delivery/account/delete`. Blockers: delivery in progress, cash to deposit, money still owed / payout
  pending. Web link for the Play form: `https://<api host>/legal/delete-account#riders`.
- **Background location** (`ACCESS_BACKGROUND_LOCATION`): used only while on duty / delivering, with a foreground
  service notification. Every request (first start of tracking and the Home "Allow" banner) first shows the in-app
  prominent disclosure (`src/services/location.ts` `confirmBackgroundDisclosure`, Accept / Not now) before the
  system prompt or the settings page. Declaration video: go online → disclosure → Accept → "Allow all the time".
- Permissions removed from the manifest (`blockedPermissions`): CAMERA, RECORD_AUDIO, storage / media, READ_CONTACTS,
  SYSTEM_ALERT_WINDOW (the app uses none of them).
- Privacy policy: Profile → Privacy Policy (`/legal/privacy`).
- Crashes: a root `ErrorBoundary` (`src/ui/ErrorBoundary.tsx`) shows "Something went wrong — Restart" instead of a
  blank screen and logs the error (Sentry can be added there later).
