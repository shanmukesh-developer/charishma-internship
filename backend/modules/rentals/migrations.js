/**
 * Zenvy Rentals: idempotent, additive-only migrations (run on every boot, every dialect, after sync()).
 * Tables come from sync(); missing columns from config/db.js addMissingColumns(). This file only adds
 * the named UNIQUE indexes the code relies on as race guards (and, C7, fills the new rentalMode column
 * on older bookings where it is still NULL). Every statement is wrapped: a failure
 * logs and never blocks startup (the code also guards these cases itself).
 *
 * Rollback: nothing here alters or drops existing data. Set GlobalConfig VEHICLE_RENTALS_ENABLED=false
 * (admin Rentals > Settings) to switch the feature off; the Rental* tables can be dropped after an export.
 */
const runRentalsMigrations = async (sequelize) => {
  if (!sequelize) return { ok: 0, warn: 0 };
  let ok = 0;
  let warn = 0;
  const run = async (label, sql) => {
    try {
      await sequelize.query(sql);
      ok++;
    } catch (err) {
      warn++;
      console.warn(`⚠️ [RENTALS_MIGRATION_WARN] ${label}: ${err.message}`);
    }
  };

  // One licence per student (re-uploads update the row).
  await run('rental_licences_user_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "rental_licences_user_unique" ON "RentalLicences" ("userId");');
  // One rating per side per trip (double taps cannot rate twice).
  await run('rental_reviews_booking_reviewer_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "rental_reviews_booking_reviewer_unique" ON "RentalReviews" ("bookingId", "reviewerId");');
  // Overlap scans: holding bookings of one listing ordered by time.
  await run('rental_bookings_listing_time',
    'CREATE INDEX IF NOT EXISTS "rental_bookings_listing_time" ON "RentalBookings" ("listingId", "startAt", "endAt");');

  // C7: the 48 h extra-charges window scan (jobs.js) and the admin Disputes tab.
  await run('rental_bookings_charges',
    'CREATE INDEX IF NOT EXISTS "rental_bookings_charges" ON "RentalBookings" ("chargesStatus", "chargesRespondBy");');
  // C7: one driving licence number per account (normalised upper case, no spaces). If old rows already
  // share a number this index cannot be built: it only warns, and licence.js still refuses new duplicates.
  await run('rental_licences_number_unique',
    'CREATE UNIQUE INDEX IF NOT EXISTS "rental_licences_number_unique" ON "RentalLicences" ("licenceNumber");');

  // C7: Rent / Borrow wording snapshot for bookings made before C7 (fills NULLs only, from the listing's plate type).
  await run('rental_bookings_mode_backfill',
    `UPDATE "RentalBookings" SET "rentalMode" = CASE WHEN (SELECT l."plateType" FROM "RentalListings" l WHERE l."id" = "RentalBookings"."listingId") = 'COMMERCIAL_RENTAL' THEN 'RENT' ELSE 'BORROW' END WHERE "rentalMode" IS NULL;`);

  if (warn === 0) console.log(`✅ [RENTALS_MIGRATION] ${ok} index checks ok.`);
  return { ok, warn };
};

module.exports = { runRentalsMigrations };
