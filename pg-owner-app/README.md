# ZCS PG Partner (Android)

Partner app for PG owners. Expo SDK 57, package `com.srm.zenvypgowner`, version `1.0.0` (versionCode `1`).
Backend: `backend/modules/pgOwner` (`/api/pg-owner/*`, admin `/api/admin/pg-owners`, tenant complaints `/api/pg-tenant/*`).
Not published on Play: shared as an APK like the other partner apps.

What the owner can do (only for the PG listings linked to their account):

- **Home**: building, Total / Occupied / Vacant beds, new-request call-out, every section with badges.
- **Booking requests**: accept (optionally into another room with a free bed) or decline with a reason; the
  student gets a push + in-app notification. Students show as first name + booking code, never a phone number.
- **Rooms & availability**: free beds per room (what students see as "Available N / Full"); **Tenants** with
  move-in dates and "Moved out" (frees the bed).
- **Mess**: meal timings, weekly menu (veg / non-veg / egg), notes, mess holidays.
- **Rent & payments**: a record only (rent is paid at the PG, ZCS moves no money): mark received, undo, ledger.
- **Complaints** from tenants: reply, mark in progress / resolved.
- **Building info**: description, amenities, house rules, photos. Name, address, rents and verification stay with ZCS.
- **Settings**: profile, change password, notification status, legal pages, delete account (request), sign out.

Checks:

```bash
npx tsc --noEmit
```

## Accounts ("Plan B", no SMS)

There is no self sign-up. In the admin dashboard: **PG and hostels → Owner accounts → Add owner** (name, 10-digit
mobile, temporary password, link the PG listing). Share the phone + temporary password with the owner (shown
once). On the first sign-in the app asks for an own password; until then the server refuses every other owner
endpoint (`403 PASSWORD_CHANGE_REQUIRED`). Reset password / suspend / link more PGs from the same tab. Every admin
write is audited (VerificationLog).

## Firebase (push)

The app works without Firebase: requests and complaints always reach the in-app Notifications list and the Home
badges; Settings says when pushes are not set up. For closed-app pushes:

1. Firebase console → the Zenvy project → Add app → Android, package `com.srm.zenvypgowner`
   (add the upload key's SHA-1 / SHA-256 later for Play Integrity).
2. Download `google-services.json` and put it next to `app.json` (git-ignored, never commit it).
3. `npx expo prebuild --clean --platform android`.

An EAS production build and a local release build refuse to build without the file (`ALLOW_BUILD_WITHOUT_FCM=1`
overrides on purpose).

## Release signing (upload key) — never commit it

`android/` is generated and git-ignored; signing is added on every prebuild by `plugins/withReleaseSigning.js`
(same plugin as the other partner apps) with the prefix **`ZENVY_PGOWNER_UPLOAD`**. Done on 24 Oct 2026: the key (RSA 4096, 30 years) and its README are in C:/Users/Shanmukh/zenvy-keys/, the values are in ~/.gradle/gradle.properties, and its SHA-1/SHA-256 are registered in Firebase. A release build is never signed
with the debug key (`ZENVY_ALLOW_UNSIGNED_RELEASE=1` makes an unsigned test build).

Create the key once and back up the file + passwords outside the repo:

```bash
keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -keystore C:/Users/Shanmukh/zenvy-keys/zenvy-pgowner-upload-2026-10-24.jks -alias zenvy-pgowner-upload
```

Then add to `%USERPROFILE%\.gradle\gradle.properties`:

```properties
ZENVY_PGOWNER_UPLOAD_STORE_FILE=C:/Users/Shanmukh/zenvy-keys/zenvy-pgowner-upload-2026-10-24.jks
ZENVY_PGOWNER_UPLOAD_STORE_PASSWORD=********
ZENVY_PGOWNER_UPLOAD_KEY_ALIAS=zenvy-pgowner-upload
ZENVY_PGOWNER_UPLOAD_KEY_PASSWORD=********
```

Build (one heavy job at a time):

```bash
cd pg-owner-app
npx expo prebuild --clean --platform android
cd android
$env:NODE_ENV="production"; .\gradlew.bat assembleRelease   # APK -> app/build/outputs/apk/release/
```

## Hardening (app.json, re-applied on every prebuild)

- `expo-build-properties`: R8 minify + resource shrinking, reanimated keep rules, HTTPS only, SDK 36.
- `android.allowBackup: false`; the session token lives only in `expo-secure-store` (memory-only if that fails).
- Blocked permissions: location, microphone, contacts, overlay. Camera / photos only for listing photos.
- Force update: the backend knows this app as `pgowner` (Admin → Config → App versions).
- Crashes: root `ErrorBoundary` shows "Something went wrong — Restart".
