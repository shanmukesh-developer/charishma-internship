# Zenvy Auto Driver (Android)

The separate driver app for **Zenvy Auto-Ride** (shared autos, seat booking). Expo SDK 57 / React Native 0.86,
same stack as `vendor-app`. Package / bundle id `com.srm.zenvyautodriver`, Expo slug `zenvy-auto-driver`.

It talks only to the one Zenvy backend (`backend/` on Render):

- driver API `/api/auto-ride/driver/*` (`backend/modules/autoRide/routes.js` driverRouter)
- sign-up SMS code `POST /api/users/send-otp { phone, purpose: 'auth' }`
- live updates: Socket.io with the driver token (role `auto_driver`, room `autodriver_<id>`, event `autoride:changed`)
- pushes: FCM on channel `delivery-alerts-v2` (+ every push is also saved in the in-app Notifications list)

Every number on screen (fares, seats, queue numbers, earnings, statuses) comes from the server. Nothing is made up.

## What a driver sees

| Screen | What it does | API |
| --- | --- | --- |
| Login | mobile + password | `POST /auth/login` |
| Register | mobile → SMS code → name + password | `POST /api/users/send-otp`, `POST /auth/register { otp }` |
| Your account (verification) | PENDING_DOCS / PENDING_REVIEW / VERIFIED / REJECTED (+ reason), what is still missing, Send for review | `GET /me`, `POST /me/submit` |
| Suspended | reason from the server, call support, sign out | any `403 DRIVER_SUSPENDED` |
| Documents | photo, licence front / back, PSV badge, police verification (no Aadhaar). Private upload, 1-hour signed previews | `POST /media` (multipart `image`), `PUT /me/documents` |
| Your autos / Add auto | registration, make / model / colour / year / fuel, RC seating capacity, requested capacity, permit / insurance / fitness / PUC dates, RC / permit / insurance / fitness / PUC photos, up to 4 auto photos. Shows Zenvy's status, approved capacity and seat layout | `GET/POST/PATCH /vehicles` |
| Home | Online / Offline, current trip (route, pickup, queue no., status, passengers x/cap, seats left, departure), today's trips + earnings, bookings on the current trip, alerts, menu | `GET /home`, `POST /online`, `GET /trips/:id/bookings`, `GET /notifications` |
| New auto trip | auto → route → pickup point → date / time → seat fare (route bounds shown) → full-auto on/off + fare → seats (≤ approved) → seat selection on/off → leave-early minimum → stops. Saved as a draft, then published | `GET /routes`, `POST/PATCH/DELETE /trips`, `POST /trips/:id/publish` |
| Trip detail | Status / Seats / Bookings tabs. Same seat layout as the customer app (read-only), queue no., bookings (first name + booking code + seats + boarding status + cash to collect), holds, full-auto status, the next action (confirm departure → start boarding → check in → start → arrive → complete), delay, resume, cancel / driver or vehicle unavailable with reason, no-show. Confirmation dialog on every action | `GET /trips/:id`, `/seats`, `/bookings`, `POST /trips/:id/actions/:action`, `POST /bookings/:id/no-show` |
| Check in | booking code + PIN pad, attempts left, 15-minute lock after 5 wrong PINs, "cash collected" tick | `POST /trips/:id/check-in` |
| Full auto requests | accept / decline with a countdown to `respondBy` | `GET /private-requests`, `POST /private-requests/:id/accept|decline` |
| Notifications, Trip history, Earnings (today / 7 days / month), Your queue | | `GET /notifications`, `POST /notifications/read`, `GET /trips?scope=past`, `GET /earnings`, `GET /home` |
| Profile and vehicle | name, licence number + expiry, PSV badge no., emergency contact, preferred routes, change password | `PATCH /me/profile`, `POST /auth/password` |
| Help and support / SOS | call 112, call Zenvy, report a problem (SOS = SAFETY incident linked to the trip) | `POST /incidents` |
| Settings | push status, server, policies, **Delete account**, sign out (removes this phone's FCM token first) | `POST /fcm-token/remove` |
| Delete account (Settings) | what is deleted / kept, blockers (published trip, open full-auto request), password or SMS code + DELETE | `GET /account/deletion-check`, `POST /account/delete-otp`, `POST /account/delete` |

Design rules: large controls, one main action per screen (pinned at the bottom), simple English with Telugu on
the key labels, and a **"Only use while the auto is stopped"** reminder on every screen with trip actions.
The app has no maps and no GPS.

### States, offline and sessions

- Every screen has loading, empty and error + Retry states, and a red **No internet** banner (socket down or the
  last request failed).
- Trip Detail refetches every 10 s on top of socket nudges; Home every 30 s.
- Offline queue (`src/lib/offlineQueue.ts`) holds only actions that are safe to replay: **go offline** and
  **mark notifications read**. Trip changes, check-ins, publish and full-auto answers are never queued. After a
  network failure the trip is read again from the server before the driver can tap again, so nothing is sent twice.
- A `401` signs the driver out with a message (session expired / password changed on another phone).
  `403 DRIVER_SUSPENDED` shows the Suspended screen. The token is in `expo-secure-store`; `allowBackup=false`.

## Setup

```bash
cd auto-driver-app
npm install
npx expo start            # dev server (needs a dev build: this app uses native modules)
npx expo run:android      # debug build on a phone / emulator
```

### API base URL

Defaults to production (`https://hostelbites-backend-jwmt.onrender.com`). For a local backend:

```bash
# bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000 npx expo start
# PowerShell
$env:EXPO_PUBLIC_API_URL="http://192.168.1.20:5000"; npx expo start
```

Never test writes against production. The feature switch `AUTO_RIDE_ENABLED` is off by default: drivers can
sign up, upload documents and add autos while it is off; publishing and accepting full-auto requests answer
`403 FEATURE_OFF` until an admin turns Auto-Ride on.

## Owner steps

### 1. Firebase (push notifications) — required for a production build

1. Firebase console → the Zenvy project (the same one the backend's `FIREBASE_*` service account belongs to) →
   **Add app → Android**.
2. Package name: `com.srm.zenvyautodriver`. App nickname: Zenvy Auto Driver. (SHA-1 is not needed for FCM.)
3. Download `google-services.json` and put it in `auto-driver-app/` next to `app.json`.
   It is git-ignored: **never commit it**.
4. Run `npx expo prebuild --platform android` again so it is copied into `android/app/`.

Without it the app still runs (alerts only while it is open, plus the in-app Notifications list, and a banner
says so), but production builds refuse to build:
EAS `production` profile fails in `app.config.js`, and a local `assembleRelease` / `bundleRelease` fails in Gradle.
Override on purpose only with `ALLOW_BUILD_WITHOUT_FCM=1`.

### 2. Upload keystore (release signing) — never commit it

`android/` is generated (`expo prebuild`) and git-ignored, so signing is added on every prebuild by
`plugins/withReleaseSigning.js` (the same plugin in every partner app). This app uses its own prefix
**`ZENVY_DRIVER_UPLOAD`**, so one `~/.gradle/gradle.properties` can hold every Zenvy key without an app ever being
signed with another app's key. The release build is **never** signed with the debug keystore: without an upload key
a local release build stops with an error (`ZENVY_ALLOW_UNSIGNED_RELEASE=1` makes an unsigned test build instead),
and a key file named `debug.keystore` is refused.

Create the key once (keep it and its passwords safe and backed up outside the repo; losing it means you can
no longer update the app unless Play App Signing resets the upload key):

```bash
keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000   -keystore C:/Users/Shanmukh/zenvy-keys/zenvy-auto-driver-upload.jks -alias zenvy-auto-driver-upload
```

Then give Gradle the four values in `%USERPROFILE%\.gradle\gradle.properties` (survives `prebuild --clean`):

```properties
ZENVY_DRIVER_UPLOAD_STORE_FILE=C:/Users/Shanmukh/zenvy-keys/zenvy-auto-driver-upload.jks
ZENVY_DRIVER_UPLOAD_STORE_PASSWORD=********
ZENVY_DRIVER_UPLOAD_KEY_ALIAS=zenvy-auto-driver-upload
ZENVY_DRIVER_UPLOAD_KEY_PASSWORD=********
```

or in `auto-driver-app/android/keystore.properties` (git-ignored, deleted by `expo prebuild --clean`). Backward
compatible: the old `ZENVY_UPLOAD_*` names are still read, but **only** from this app's own
`android/keystore.properties`, never from `~/.gradle/gradle.properties` (there `ZENVY_UPLOAD_*` would be the
customer app's key).

EAS builds (`EAS_BUILD=true`) use EAS-managed credentials instead (`npx eas-cli@latest credentials`).

### 3. Hardening (app.json, re-applied on every prebuild)

Version `1.0.1` / versionCode `2`. `expo-build-properties`: R8 minify + resource shrinking in release, keep rules
for react-native-reanimated, `usesCleartextTraffic: false` (debug builds keep cleartext for a local backend),
compile / target SDK 36, Hermes. `allowBackup: false`. The token is only in `expo-secure-store` (memory-only if
that fails, never AsyncStorage). Release is never `debuggable`. Keep `android/app/build/outputs/mapping/release/mapping.txt`
of every Play build.

## Build

```bash
cd auto-driver-app
npx expo prebuild --platform android        # first time, or after app.json / plugin / google-services.json changes
cd android

# bash
NODE_ENV=production ./gradlew assembleRelease   # APK  -> app/build/outputs/apk/release/app-release.apk
NODE_ENV=production ./gradlew bundleRelease     # AAB  -> app/build/outputs/bundle/release/app-release.aab
# PowerShell
$env:NODE_ENV="production"; .\gradlew.bat assembleRelease
$env:NODE_ENV="production"; .\gradlew.bat bundleRelease
```

The generated `android/gradle.properties` builds all 4 ABIs (~107 MB APK). For a smaller phone APK add
`-PreactNativeArchitectures=arm64-v8a`; emulator test build: `-PreactNativeArchitectures=x86_64`.
(The Play bundle splits per ABI by itself.)

EAS (cloud): `npx eas-cli@latest init` once, then `npx eas-cli@latest build -p android --profile preview`
(internal APK) or `--profile production` (Play bundle). The production profile sets `NODE_ENV=production`.

Checks:

```bash
npx tsc --noEmit
npx expo export --platform android
```

## Play Store notes

- **Background location is NOT used.** The app has no location permission at all: `ACCESS_FINE_LOCATION`,
  `ACCESS_COARSE_LOCATION` and `ACCESS_BACKGROUND_LOCATION` are blocked in `app.json` (also `RECORD_AUDIO`,
  `READ_CONTACTS`, `SYSTEM_ALERT_WINDOW`). No foreground service.
- Permissions in the build (check with `aapt dump permissions app-release.apk`):
  - `INTERNET`
  - `CAMERA` — photographing the licence, vehicle papers and the auto (asked when the driver taps Camera)
  - `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` (Android 12 and older only, `maxSdkVersion=32`, from the
    image picker; Android 13+ uses the system photo picker)
  - `POST_NOTIFICATIONS`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE`,
    launcher badge permissions (Samsung / HTC) (expo-notifications / FCM)
  - `ACCESS_NETWORK_STATE` (networking libraries), `USE_BIOMETRIC` / `USE_FINGERPRINT` (declared by
    expo-secure-store; the app never asks for a fingerprint), install-referrer binding (Play)
  - (list taken from `aapt dump permissions` on a local unsigned release build, 17 Oct 2026)
- **Account deletion** (drivers sign up in the app): Settings → **Delete account**. Web link for the Play form:
  `https://<api host>/legal/delete-account#riders`. Driver name, phone, password, documents, licence / badge,
  emergency contact, photos and push tokens are deleted; trips, bookings, incidents and the auto's registration are
  kept without personal details.
- Crashes: a root `ErrorBoundary` shows "Something went wrong — Restart" instead of a blank screen.
- Data safety form: name, mobile number, driving licence / PSV badge / police verification photos, vehicle
  papers and photos, emergency contact. Documents are uploaded as private files only Zenvy's verification team
  can open; drivers see 1-hour signed previews. No Aadhaar is collected. Passenger phone numbers are never shown
  to drivers (first name + booking code only). Data is encrypted in transit (HTTPS).
- App access for review: give Google a test driver account (verified, with an approved auto) on a test backend.
- Before launch (from the Auto-Ride spec): the operator must confirm permits for shared per-seat fares,
  permitted passenger capacity, commercial insurance and driver documents. Cash only at launch.

## Code map

```
App.tsx                    root: Login/Register → Suspended → Verification hub or Home; push taps; offline queue flush
app.config.js              FCM guard (EAS production), allowBackup=false
plugins/withReleaseSigning.js   release signing + release-build guards, re-applied on every prebuild
src/config.ts              API URL, limits mirrored from the backend
src/api/driverApi.ts       every backend call (real paths + error codes)
src/lib/http.ts            fetch wrapper → ApiError { status, code, data } / NetworkError
src/lib/tripRules.ts       state-machine mirror (which buttons) + publish form checks
src/lib/{storage,push,photo,offlineQueue,format}.ts
src/state/                 SessionProvider (token, /me, push), SocketProvider (autoride:changed), useLoad
src/ui/                    kit, Screen, SeatMap (from customer-mobile), PinPad + Sos (from delivery-boy-app), DocSlot, Stepper, Toast
src/screens/               Auth, Onboarding, Vehicles, Home, Publish, TripDetail, CheckIn, Requests, More
```
