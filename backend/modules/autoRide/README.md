# Zenvy Auto-Ride

Shared-auto seat booking and full-auto hire inside the customer app's Co-Ride section, plus the separate **Zenvy Auto Driver** app (`auto-driver-app/`, package `com.srm.zenvyautodriver`) and the admin page `/auto-ride`.

Everything is **off** until an admin switches it on.

## Pieces

| Part | Where |
|---|---|
| Backend module | `backend/modules/autoRide/` (models, migrations, routes, jobs, services, tests) |
| Customer API | `/api/auto-ride/*` (normal customer login) |
| Driver API | `/api/auto-ride/driver/*` (own login, JWT role `auto_driver`) |
| Admin API | `/api/admin/auto-ride/*` (admin only, every write audited) |
| Lifecycle job | `autoRide.lifecycle`, every 30 s (`backend/jobs/index.js`) |
| Customer screens | `customer-mobile/modules/autoRide/`, `customer-mobile/app/auto-ride/`, one "🛺 AUTO" sub-tab in Co-Ride |
| Driver app | `auto-driver-app/` (see its README for Firebase, keystore and build steps) |
| Admin page | `admin-dashboard/src/app/auto-ride/` |

## Database

There are no manual migrations. On boot the backend creates the `Auto*` tables (`sync()`) and `runAutoRideMigrations` adds the named and partial unique indexes. The boot log shows `[AUTORIDE_MIGRATION] N index checks ok`.

The tables are `AutoDrivers`, `AutoVehicles`, `AutoRoutes`, `AutoPickupPoints`, `AutoTrips`, `AutoBookings`, `AutoSeats`, `AutoPrivateRequests`, `AutoQueueCounters`, `AutoIncidents` and `AutoTripEvents`.

## Switches and settings

These are GlobalConfig rows, edited in admin → Auto-Ride → Settings:

| Key | Default | Meaning |
|---|---|---|
| `AUTO_RIDE_ENABLED` | off | Customers can browse and book; drivers can publish |
| `AUTO_RIDE_WALLET_ENABLED` | off | Wallet payment. Cash to the driver at boarding is always on. |
| `AUTO_RIDE_SETTINGS` | see below | Limits |

The `AUTO_RIDE_SETTINGS` limits:
- `platformMaxCapacity`: 8
- `holdMinutes`: 5
- `privateRespondMinutes`: 10
- `maxSeatsPerBooking`: 4, and never more than the platform max
- `maxAdvanceDays`: 7
- `reminderMinutes`: 15
- `noShowGraceMinutes`: 30
- `autoCompleteHours`: 6
- Refund: 100% before the driver confirms departure, 0% after

Optional environment variables:
- `AUTO_RIDE_DEV_ENABLE=1`: local only; it is ignored when `NODE_ENV=production` or `RENDER` is set.
- `AUTO_DRIVER_SESSION_TTL` (default 30d) and `AUTO_DRIVER_AUTH_MAX` (default 30 per 15 min).
- `AUTO_RIDE_HOLDS_PER_10MIN` (default 20) and `AUTO_RIDE_PRIVATE_PER_HOUR` (default 6).

Driver sign-up needs SMS OTP, so `FAST2SMS_API_KEY` must be set on Render.

## Before switching on (pilot)

1. **Legal:** confirm the permit type for per-seat shared trips, the passenger insurance cover, and driver documents (licence with transport badge, police verification). Capacity is set per vehicle from its RC; the owner confirmed 8 is permitted locally.
2. **Admin → Routes & Pickup Points:** add routes (seat and full-auto fare bounds, operating periods, minimum seats to depart) and pickup points (name, landmark, lat/lon to 6 decimals for "Open in Maps").
3. **Drivers install Zenvy Auto Driver, sign up, and upload documents and vehicles.**
4. **Admin → Drivers:** verify each driver. **Admin → Vehicles:** approve each vehicle. Approved capacity must not exceed the RC, and the seat layout is checked in the editor.
5. **Admin → Settings:** turn on `AUTO_RIDE_ENABLED`. Students on the latest customer app then see "🛺 AUTO" in Co-Ride.

## How it stays correct under load

- **Seat writes:** every seat-changing write goes through `withTripLock`. That is an in-process queue, then an IMMEDIATE transaction on SQLite or `SELECT … FOR UPDATE` on the trip row in Postgres. Seat counters are recomputed from the seat rows, not incremented.
- **Unique indexes:**
  - one live row per seat
  - unique queue numbers per pickup point, route, day and period
  - one active trip per vehicle and per driver
  - one live booking per user per trip
  - idempotency keys
- **Holds:** they expire after `holdMinutes`. They are released lazily inside the lock and also by the job.
- **Full-auto bookings:** they can only be accepted while no live seats exist, and they can never override existing seats.
- **Payments and PINs:** the boarding PIN is never sent to drivers. Wallet refunds happen exactly once.

## ZCS Auto union queue ("on charge")

How the autos outside SRM AP really work: autos line up at a stand one by one, and the front auto is "on charge".

- **Put on charge** (`POST /api/auto-ride/driver/charge { pickupPointId, vehicleId, seatFare? }`): no departure time.
  - The fare defaults to the route's `seatFareDefault`, else `seatFareMin`, else `seatFareMax` (409 `FARE_NOT_SET` when none).
  - The driver may pick another fare inside the route's min/max (400 `FARE_OUT_OF_RANGE`).
  - Capacity is the approved capacity.
- **Changing the fare** (`POST /trips/:id/fare { seatFare }`): allowed while the auto is in the line and no student has booked or is booking it. After that it answers 409 `FARE_LOCKED`.
- **One line per pickup point + route**, in check-in order (`lineSeq`). Every auto in the line takes bookings.
  - The front one has `queueState` `ON_CHARGE` (it leaves next); the others are `WAITING`.
  - An auto that left the charge (`DONE`) takes no more bookings: 409 `AUTO_JUST_FILLED` / `AUTO_OFF_CHARGE { nextTripId }`.
- **Moving up:** when the front auto fills, departs (`actions/depart`), is cancelled, or becomes unavailable or no-show, it becomes `DONE`.
  - The next waiting auto goes on charge in the same transaction (`services/chargeLine.js`, called from `transitionTrip`), and its driver gets "You are on charge now".
  - A waiting auto that is already full is passed over.
  - A waiting auto may depart only when it is full.
- **Moving bookings** (`allocation.moveLineBookings`): when an auto in the line is cancelled or made unavailable by its driver or an admin, its confirmed (and checked-in) bookings move, in the same lock and transaction.
  - Each booking moves whole to the first other auto in the line (on charge first) with enough free seats. Bookings are never split.
  - The student keeps the original fare, booking code and PIN. A checked-in student checks in again on the new auto.
  - The student is told "Your auto changed. You are now on auto AP 39 •• 7801 (Ravi), same fare."
  - A booking that fits nowhere is cancelled as before, with the usual refund, and the student is told.
  - Bookings never move when an auto departs, and never on the automatic time-limit close.
- **Race guards:** the line row (`AutoQueueCounters`, `LINE` / `CHARGE`) is locked during line changes. The partial unique index `auto_trips_line_on_charge` allows only one `ON_CHARGE` auto per line.
- **Walk-ins** (`POST /trips/:id/walk-ins { action: add|remove, seatNo? }`): these are real seat rows on one `WALK_IN` booking per trip (status `BOARDED`, amount 0, userId = the driver).
  - They count towards FULL.
  - The driver can never free a seat booked in the app; app seats close on their own.
- **Time limit:** an auto on charge longer than `chargeMaxHours` (default 6) is closed by the lifecycle job. Waiting autos never expire while they wait.
- **Board and admin:**
  - Customers: `GET /api/auto-ride/on-charge` (the auto on charge, then each waiting auto, all bookable).
  - Admin: `GET /api/admin/auto-ride/lines`.

## Tests

```
cd backend
npm run test:autoride
```

This runs 97 `node:test` cases on a temporary SQLite database. They cover the owner's 25 acceptance scenarios plus race and invariant tests (20 parallel holds for the last seat, 20 parallel publishes, private vs shared races, every transition × action), role isolation, the kill switch, privacy and rate limits, and the union queue (`chargeLine.test.js`: line order, booking waiting autos, driver fare, promotion, walk-ins, depart, moving bookings with full / partial / no room, lifecycle, and races with the in-process queue on and off).

## Known limits (v1)

- No live GPS or device location. "Nearby" lists the admin's pickup points.
- Ratings are not collected yet, so none are shown.
- Rate-limit buckets live in memory per process.
- The wallet has no ledger table, and there is no Postgres test lane.
