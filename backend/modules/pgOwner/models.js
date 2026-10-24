// ZCS PG Partner tables. Created by sequelize.sync() on boot (new tables) and kept current by
// config/db.js addMissingColumns (new columns). Plain types only, so the same definitions work on
// Postgres (Render) and SQLite (local / tests).
//   PgOwner         the PG owner's account (admin-created, phone + password, must change the temporary password)
//   PgOwnerListing  owner <-> PG listing link (one owner per listing; an owner may run several PGs)
//   PgRentRecord    "rent received" ledger rows (a record only: rent is paid at the PG, no money moves in ZCS)
//   PgComplaint     complaints a tenant raises about the PG; the owner replies / resolves
const { DataTypes } = require('sequelize');

/** JSON-in-TEXT column; `fallback` when empty or unreadable. */
const jsonCol = (name, fallback) => ({
  type: DataTypes.TEXT,
  allowNull: true,
  get() {
    const v = this.getDataValue(name);
    if (v === null || v === undefined || v === '') return fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  },
  set(v) { this.setDataValue(name, v === null || v === undefined ? null : JSON.stringify(v)); },
});

const OWNER_STATUS = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' };
const COMPLAINT_STATUS = { OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', RESOLVED: 'RESOLVED' };
const COMPLAINT_CATEGORIES = ['room', 'bathroom', 'food', 'water', 'electricity', 'wifi', 'cleaning', 'safety', 'staff', 'other'];
const RENT_METHODS = ['cash', 'upi', 'bank', 'other'];
const RENT_STATUS = { RECEIVED: 'RECEIVED', VOIDED: 'VOIDED' };

const initPgOwnerModels = (sequelize) => {
  if (!sequelize) return {};

  const PgOwner = sequelize.define('PgOwner', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    phone: { type: DataTypes.STRING(10), allowNull: false },
    email: { type: DataTypes.STRING(120), allowNull: true },
    password: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: OWNER_STATUS.ACTIVE },
    suspendedReason: { type: DataTypes.STRING(300), allowNull: true },
    // true after an admin creates the account or resets the password: every owner endpoint except the
    // password change answers 403 PASSWORD_CHANGE_REQUIRED until the owner picks a new password.
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    fcmTokens: jsonCol('fcmTokens', []),
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    passwordChangedAt: { type: DataTypes.DATE, allowNull: true },
    // In-app "Delete my account" request (Play requirement); the ZCS team closes the account.
    deletionRequestedAt: { type: DataTypes.DATE, allowNull: true },
    deletionReason: { type: DataTypes.STRING(300), allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
  }, {
    tableName: 'pg_owners',
    timestamps: true,
    indexes: [{ name: 'pg_owners_phone_unique', unique: true, fields: ['phone'] }],
  });

  const PgOwnerListing = sequelize.define('PgOwnerListing', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    ownerId: { type: DataTypes.UUID, allowNull: false },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    linkedBy: { type: DataTypes.STRING(64), allowNull: true },
  }, {
    tableName: 'pg_owner_listings',
    timestamps: true,
    indexes: [
      { name: 'pg_owner_listings_hostel_unique', unique: true, fields: ['hostelId'] },
      { name: 'pg_owner_listings_owner', fields: ['ownerId'] },
    ],
  });

  const PgRentRecord = sequelize.define('PgRentRecord', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    bookingId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    ownerId: { type: DataTypes.UUID, allowNull: false },
    // Rent month, IST calendar: 'YYYY-MM'.
    month: { type: DataTypes.STRING(7), allowNull: false },
    amount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    method: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'cash' },
    note: { type: DataTypes.STRING(200), allowNull: true },
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: RENT_STATUS.RECEIVED },
    receivedAt: { type: DataTypes.DATE, allowNull: true },
    voidedAt: { type: DataTypes.DATE, allowNull: true },
    voidReason: { type: DataTypes.STRING(200), allowNull: true },
  }, {
    tableName: 'pg_rent_records',
    timestamps: true,
    indexes: [
      { name: 'pg_rent_booking_month_unique', unique: true, fields: ['bookingId', 'month'] },
      { name: 'pg_rent_hostel_month', fields: ['hostelId', 'month'] },
    ],
  });

  const PgComplaint = sequelize.define('PgComplaint', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    hostelId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    bookingId: { type: DataTypes.UUID, allowNull: true },
    // Snapshot so the owner list needs no user join and never shows more than a first name.
    firstName: { type: DataTypes.STRING(24), allowNull: true },
    category: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'other' },
    text: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: COMPLAINT_STATUS.OPEN },
    ownerReply: { type: DataTypes.TEXT, allowNull: true },
    repliedAt: { type: DataTypes.DATE, allowNull: true },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'pg_complaints',
    timestamps: true,
    indexes: [
      { name: 'pg_complaints_hostel_status', fields: ['hostelId', 'status'] },
      { name: 'pg_complaints_user', fields: ['userId'] },
    ],
  });

  return { PgOwner, PgOwnerListing, PgRentRecord, PgComplaint };
};

module.exports = { initPgOwnerModels, OWNER_STATUS, COMPLAINT_STATUS, COMPLAINT_CATEGORIES, RENT_METHODS, RENT_STATUS };
