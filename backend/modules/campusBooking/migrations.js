/**
 * In-Campus Booking: idempotent, additive-only migrations (every boot, every dialect, after sync()).
 * The CampusBookings table comes from sync(); the new Restaurant columns (campusBookingEnabled, campusUpiId,
 * campusUpiName, campusUpiQrUrl, campusPrepMinutes) from config/db.js addMissingColumns(). This file only
 * adds the named indexes the code relies on as race guards. Every statement is wrapped: a failure logs and
 * never blocks startup (the code also guards these cases itself). Nothing is altered, dropped or backfilled.
 *
 * Rollback: switch In-Campus Booking off per stall (admin Stores > the stall > In-Campus Booking); the
 * CampusBookings table can be dropped after an export. The Restaurant columns are nullable and unused then.
 */
const runCampusBookingMigrations = async (sequelize) => {
  if (!sequelize) return { ok: 0, warn: 0 };
  let ok = 0;
  let warn = 0;
  const run = async (label, sql) => {
    try {
      await sequelize.query(sql);
      ok++;
    } catch (err) {
      warn++;
      console.warn(`⚠️ [CAMPUS_BOOKING_MIGRATION_WARN] ${label}: ${err.message}`);
    }
  };

  // One booking reference per row (the create path retries on a clash).
  await run('campus_bookings_ref_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "campus_bookings_ref_unique" ON "CampusBookings" ("ref");');
  // A retried "Book" tap with the same Idempotency-Key returns the same booking.
  await run('campus_bookings_user_idem_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "campus_bookings_user_idem_unique" ON "CampusBookings" ("userId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;');
  // One payment proof per booking (27 Oct 2026): the same UPI reference / screenshot sent for two bookings at the
  // same moment both passed the "already used" check (services/bookings.checkProof). The database refuses the
  // second write now (submitProof answers 409 REF_ALREADY_USED / SCREENSHOT_ALREADY_USED). A re-send on the
  // same booking keeps its own value, so it never clashes with itself.
  await run('campus_bookings_proof_ref_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "campus_bookings_proof_ref_unique" ON "CampusBookings" ("proofRef") WHERE "proofRef" IS NOT NULL;');
  await run('campus_bookings_proof_image_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "campus_bookings_proof_image_unique" ON "CampusBookings" ("proofImageUrl") WHERE "proofImageUrl" IS NOT NULL;');
  // Lifecycle job: open bookings by status and age.
  await run('campus_bookings_status_created',
    'CREATE INDEX IF NOT EXISTS "campus_bookings_status_created" ON "CampusBookings" ("status", "createdAt");');

  if (warn === 0) console.log(`✅ [CAMPUS_BOOKING_MIGRATION] ${ok} index checks ok.`);
  return { ok, warn };
};

module.exports = { runCampusBookingMigrations };
