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
  try {
    const n = await backfillSeatLayouts(sequelize);
    if (n) console.log(`✅ [AUTORIDE_MIGRATION] ${n} seat layouts set to the real auto layout (boys-only front seats).`);
  } catch (err) {
    warn++;
    console.warn(`⚠️ [AUTORIDE_MIGRATION_WARN] seat layouts: ${err.message}`);
  }
  if (warn === 0) console.log(`✅ [AUTORIDE_MIGRATION] ${ok} index checks ok.`);
  return { ok, warn };
};

/**
 * Front-seat rule backfill (idempotent): approved vehicles and active trips with no seat layout, or one stored
 * before the rule (no maleOnlySeats), get the real layout (services/layout.normalizeLayout: 8 seats ->
 * [1, D, 2] | 3 4 5 | 6 7 8 with seats 1 and 2 boys only). Rows that already carry maleOnlySeats are left alone.
 * Ended trips are not rewritten (readers normalise them anyway). Returns the number of rows written.
 */
const backfillSeatLayouts = async (sequelize) => {
  const { normalizeLayout } = require('./services/layout');
  const { Op } = require('sequelize');
  const Vehicle = sequelize.models.AutoVehicle;
  const Trip = sequelize.models.AutoTrip;
  const stale = (l) => !l || typeof l !== 'object' || !Array.isArray(l.rows) || !Array.isArray(l.maleOnlySeats);
  let n = 0;
  if (Vehicle) {
    const rows = await Vehicle.findAll({ where: { approvedCapacity: { [Op.gt]: 0 } }, attributes: ['id', 'seatLayout', 'approvedCapacity'] });
    for (const v of rows) {
      if (!stale(v.seatLayout)) continue;
      await Vehicle.update({ seatLayout: normalizeLayout(v.seatLayout, v.approvedCapacity) }, { where: { id: v.id } });
      n++;
    }
  }
  if (Trip) {
    const rows = await Trip.findAll({ where: { status: { [Op.in]: E.ACTIVE_TRIP_STATUSES } }, attributes: ['id', 'seatLayout', 'capacity'] });
    for (const t of rows) {
      if (!stale(t.seatLayout)) continue;
      await Trip.update({ seatLayout: normalizeLayout(t.seatLayout, t.capacity) }, { where: { id: t.id } });
      n++;
    }
  }
  return n;
};

module.exports = { runAutoRideMigrations, backfillSeatLayouts, INDEXES };
