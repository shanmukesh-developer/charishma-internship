/**
 * Zenvy Auto-Ride: idempotent, additive-only migrations (run on every boot, every dialect, after sync()).
 * Tables come from sync(); missing columns from config/db.js addMissingColumns(). This file adds the
 * named UNIQUE / partial UNIQUE indexes the booking engine relies on as race guards (a second process,
 * a retry or a bug can never double-sell a seat, duplicate a queue number or put one auto on two trips).
 * Partial indexes (CREATE UNIQUE INDEX ... WHERE ...) work on both SQLite and Postgres.
 * Every statement is wrapped: a failure logs and never blocks startup (the code also guards in a lock).
 *
 * Rollback: nothing here alters or drops data. The feature stays off unless GlobalConfig
 * AUTO_RIDE_ENABLED is true; the Auto* tables can be dropped after an export.
 */
const E = require('./enums');

const inList = (arr) => arr.map((s) => `'${s}'`).join(', ');

const INDEXES = [
  // One live (held / sold / boarded) row per seat number per trip.
  ['auto_seats_live_unique', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_seats_live_unique" ON "AutoSeats" ("tripId", "seatNo") WHERE "status" IN (${inList(E.LIVE_SEAT_STATUSES)});`],
  // Queue numbers are unique per pickup point + route + IST day + operating period.
  ['auto_trips_queue_unique', 'CREATE UNIQUE INDEX IF NOT EXISTS "auto_trips_queue_unique" ON "AutoTrips" ("pickupPointId", "routeId", "operatingDate", "periodKey", "queueNumber") WHERE "queueNumber" IS NOT NULL;'],
  ['auto_queue_counters_key', 'CREATE UNIQUE INDEX IF NOT EXISTS "auto_queue_counters_key" ON "AutoQueueCounters" ("pickupPointId", "routeId", "operatingDate", "periodKey");'],
  // One active trip per vehicle and per driver.
  ['auto_trips_vehicle_one_active', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_trips_vehicle_one_active" ON "AutoTrips" ("vehicleId") WHERE "status" IN (${inList(E.ACTIVE_TRIP_STATUSES)});`],
  ['auto_trips_driver_one_active', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_trips_driver_one_active" ON "AutoTrips" ("driverId") WHERE "status" IN (${inList(E.ACTIVE_TRIP_STATUSES)});`],
  // One live booking per customer per trip; one booking per retry key; one booking per private request.
  ['auto_bookings_user_trip_live', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_bookings_user_trip_live" ON "AutoBookings" ("userId", "tripId") WHERE "status" IN (${inList(E.LIVE_BOOKING_STATUSES)});`],
  ['auto_bookings_user_idem', 'CREATE UNIQUE INDEX IF NOT EXISTS "auto_bookings_user_idem" ON "AutoBookings" ("userId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;'],
  ['auto_bookings_private_request', 'CREATE UNIQUE INDEX IF NOT EXISTS "auto_bookings_private_request" ON "AutoBookings" ("privateRequestId") WHERE "privateRequestId" IS NOT NULL;'],
  ['auto_bookings_code', 'CREATE UNIQUE INDEX IF NOT EXISTS "auto_bookings_code" ON "AutoBookings" ("bookingCode");'],
  // Accounts / vehicles.
  ['auto_drivers_phone', 'CREATE UNIQUE INDEX IF NOT EXISTS "auto_drivers_phone" ON "AutoDrivers" ("phone");'],
  ['auto_vehicles_reg', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_vehicles_reg" ON "AutoVehicles" ("registrationNumber") WHERE "status" IN (${inList(E.VEHICLE_LIVE_STATUSES)});`],
  // One open full-auto request per customer per trip.
  ['auto_private_req_open', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_private_req_open" ON "AutoPrivateRequests" ("userId", "tripId") WHERE "status" = '${E.PRIVATE_STATUS.REQUESTED}';`],
  // Union queue: at most one auto ON_CHARGE per pickup point + route (two autos can never both take bookings
  // for one line, whatever process promotes them), and the line lookup in check-in order.
  ['auto_trips_line_on_charge', `CREATE UNIQUE INDEX IF NOT EXISTS "auto_trips_line_on_charge" ON "AutoTrips" ("pickupPointId", "routeId") WHERE "queueState" = '${E.QUEUE_STATE.ON_CHARGE}';`],
  ['auto_trips_line_seq', 'CREATE INDEX IF NOT EXISTS "auto_trips_line_seq" ON "AutoTrips" ("pickupPointId", "routeId", "queueState", "lineSeq");'],
  // Lifecycle scans.
  ['auto_seats_trip_seat', 'CREATE INDEX IF NOT EXISTS "auto_seats_trip_seat" ON "AutoSeats" ("tripId", "seatNo");'],
];

const runAutoRideMigrations = async (sequelize) => {
  if (!sequelize) return { ok: 0, warn: 0 };
  let ok = 0;
  let warn = 0;
  for (const [label, sql] of INDEXES) {
    try {
      await sequelize.query(sql);
      ok++;
    } catch (err) {
      warn++;
      console.warn(`⚠️ [AUTORIDE_MIGRATION_WARN] ${label}: ${err.message}`);
    }
  }
  if (warn === 0) console.log(`✅ [AUTORIDE_MIGRATION] ${ok} index checks ok.`);
  return { ok, warn };
};

module.exports = { runAutoRideMigrations, INDEXES };
