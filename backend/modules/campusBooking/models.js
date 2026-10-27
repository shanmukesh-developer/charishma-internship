// In-Campus Booking table (CampusBookings). Registered on the shared sequelize instance by config/db.js.
// Schema rules (prod is Postgres, created by sync() + addMissingColumns): no column-level unique, named
// indexes only (migrations.js), every column nullable or defaulted.
//
// Why a separate table and not Order with a type: Order carries delivery-only invariants that every job and
// report relies on (paymentMethod ENUM COD/UPI/Card/Wallet, a status whitelist built for riders, a required
// deliveryFee, rider dispatch, slot dispatch, auto-cancel, stall-stuck flags, store payouts and the C6
// commission backfill all scan Orders). A pickup booking paid straight to the stall shares none of them, so
// keeping it apart means none of those paths can pick one up by mistake, and the delivery baskets and
// checkouts stay exactly as they are.
const { DataTypes } = require('sequelize');

const initCampusBookingModels = (sequelize) => {
  if (!sequelize) return {};

  const CampusBooking = sequelize.define('CampusBooking', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Short reference shown to both sides, e.g. "CB7K3F" (unique: campus_bookings_ref_unique).
    ref: { type: DataTypes.STRING(12), allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    restaurantId: { type: DataTypes.UUID, allowNull: false },
    // Server-priced lines: [{ menuItemId, name, unitPrice, quantity, lineTotal, isVeg }]
    items: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    itemCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Money in paise (integers). amount = what the student pays the stall (the item total, nothing added).
    amountPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    commissionPct: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1.5 },
    commissionPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    vendorNetPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PAYMENT_PENDING' },
    // 4 characters from an unambiguous alphabet. Shown to the student only (never in vendor payloads).
    pickupCode: { type: DataTypes.STRING(4), allowNull: false },
    pickupCodeFails: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    pickupCodeLockedUntil: { type: DataTypes.DATE, allowNull: true },
    // The stall's UPI ID / QR the student was shown when booking (the stall may change them later).
    payeeUpiId: { type: DataTypes.STRING(120), allowNull: true },
    payeeName: { type: DataTypes.STRING(120), allowNull: true },
    payeeQrUrl: { type: DataTypes.TEXT, allowNull: true },
    // Payment proof: a private screenshot (/api/campus/media/<id>, purpose campus_payment) and / or the UPI ref.
    proofImageUrl: { type: DataTypes.TEXT, allowNull: true },
    proofRef: { type: DataTypes.STRING(40), allowNull: true },
    proofSubmittedAt: { type: DataTypes.DATE, allowNull: true },
    proofAttempts: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    rejectCode: { type: DataTypes.STRING(20), allowNull: true },
    rejectReason: { type: DataTypes.STRING(250), allowNull: true },
    rejectedAt: { type: DataTypes.DATE, allowNull: true },
    // Prep estimate (minutes) from the stall's own setting at booking time.
    prepMinutes: { type: DataTypes.INTEGER, allowNull: true },
    paymentVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    acceptedAt: { type: DataTypes.DATE, allowNull: true },
    estimatedReadyAt: { type: DataTypes.DATE, allowNull: true },
    preparingAt: { type: DataTypes.DATE, allowNull: true },
    readyAt: { type: DataTypes.DATE, allowNull: true },
    collectedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledBy: { type: DataTypes.STRING(12), allowNull: true }, // student | vendor | system
    cancelCode: { type: DataTypes.STRING(20), allowNull: true },
    cancelReason: { type: DataTypes.STRING(250), allowNull: true },
    note: { type: DataTypes.STRING(200), allowNull: true }, // student's note to the stall
    idempotencyKey: { type: DataTypes.STRING(120), allowNull: true },
    // Optimistic concurrency: every status write is "UPDATE ... WHERE id = ? AND version = ?".
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'CampusBookings',
    timestamps: true,
    indexes: [
      { name: 'campus_bookings_user', fields: ['userId', 'createdAt'] },
      { name: 'campus_bookings_store', fields: ['restaurantId', 'status'] },
      { name: 'campus_bookings_status', fields: ['status', 'updatedAt'] },
    ],
  });

  return { CampusBooking };
};

module.exports = { initCampusBookingModels };
