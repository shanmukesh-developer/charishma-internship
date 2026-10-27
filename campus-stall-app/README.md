# ZCS Campus Stall

The stall side of In-Campus Booking. Students book a campus stall's items in the ZCS app, pay the stall directly by
UPI, and collect at the counter with a 4-character pickup code. This app is where the stall reviews the payment
proof, confirms or rejects it, prepares the order, checks the pickup code and hands it over.

- Login: the stall's existing ZCS Vendor phone number and password (`POST /api/restaurants/login`, `app: 'vendor'`, stalls only).
- Backend: `backend/modules/campusBooking` (stall routes `/api/campus-booking/vendor/*`). Bookings arrive live
  (`campusbooking:changed` on the stall's socket room) and by a 30 s refresh while the app is open.
- Tabs: Bookings (today, Pending / Accepted / History), Menu (availability, add / edit items), Earnings (total,
  orders, ZCS commission 1.5 %, recent orders), Settings (UPI ID, UPI QR, prep time, alerts, support, log out).
- Look: the same kitchen-first kit as ZCS Vendor (`src/theme.ts`, `src/ui/kit.tsx`).

## Identity

Name ZCS Campus Stall, slug `zcs-campus-stall`, Android package `com.srm.zcscampusstall`, scheme `zcsstall`,
version 1.0.0 (versionCode 1). The backend knows it as app `campusstall` (force update, push tokens).

## Before the first release build

1. `npm install` (same dependency versions as pg-owner-app, plus `socket.io-client` at ZCS Vendor's version).
2. Closed-app pushes: register `com.srm.zcscampusstall` in the ZCS Firebase project and put its
   `google-services.json` next to `app.json` (never commit it). Without it the app works fully while open; Settings
   says closed-app alerts are not set up. EAS production / local release builds refuse to build without it unless
   `ALLOW_BUILD_WITHOUT_FCM=1`.
3. Play upload key: `ZCS_CAMPUSSTALL_UPLOAD_STORE_FILE` / `_STORE_PASSWORD` / `_KEY_ALIAS` / `_KEY_PASSWORD` in
   `~/.gradle/gradle.properties` (`plugins/withReleaseSigning.js`). The release build is never signed with the debug key.
4. Icons in `assets/` are copied from ZCS Vendor as placeholders; replace them with the stall app's own icons.
