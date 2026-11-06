const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

let Restaurant;

/** JSON text column -> value. Strings that are themselves JSON (double-encoded rows) are decoded again, up to 3 levels. */
const decodeJsonText = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    if (!v) return null;
    try { v = JSON.parse(v); } catch { return null; }
  }
  return typeof v === 'string' ? null : v;
};

const initRestaurantModel = (sequelize) => {
  if (!sequelize) return null;

  Restaurant = sequelize.define('Restaurant', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Owner-only test row (utils/testView, scripts/test_data_v2_seed.js): hidden from every non-tester request.
    isTestData: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    name: { type: DataTypes.STRING, allowNull: false },
    location: { type: DataTypes.STRING, allowNull: false },
    lat: { type: DataTypes.FLOAT },
    lon: { type: DataTypes.FLOAT },
    zone: { type: DataTypes.STRING, defaultValue: 'Amaravathi_Central' },
    imageUrl: { type: DataTypes.TEXT },
    vendorType: { type: DataTypes.STRING, defaultValue: 'RESTAURANT' },
    rating: { type: DataTypes.FLOAT, defaultValue: 0 },
    deliveryTime: { type: DataTypes.INTEGER },
    commissionRate: { type: DataTypes.FLOAT, defaultValue: 10 },
    commissionType: { type: DataTypes.STRING, defaultValue: 'percentage' },
    tags: { 
      type: DataTypes.TEXT, 
      defaultValue: '[]',
      get() {
        // Older seed / sync scripts stored the list JSON-encoded twice ('"[\\"burgers\\"]"'): decode up to
        // three levels so every reader (admin wizard, customer app, search) always gets an array.
        const val = decodeJsonText(this.getDataValue('tags'));
        return Array.isArray(val) ? val.filter((t) => typeof t === 'string' || typeof t === 'number').map(String) : [];
      },
      set(val) { this.setDataValue('tags', JSON.stringify(val)); }
    },
    operatingHours: { 
      type: DataTypes.TEXT, 
      defaultValue: '{"start":"09:00","end":"22:00"}',
      get() {
        const val = decodeJsonText(this.getDataValue('operatingHours'));
        return val && typeof val === 'object' ? val : { start: '09:00', end: '22:00' };
      },
      set(val) { this.setDataValue('operatingHours', JSON.stringify(val)); }
    },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    isOffline: { type: DataTypes.BOOLEAN, defaultValue: false }, // For shops without a smartphone
    password: { type: DataTypes.STRING, allowNull: true }, // For restaurant portal login
    // Partner / vendor login phone (10 digits, unique when set). Same field as the admin's "partnerPhone".
    phone: { type: DataTypes.STRING, allowNull: true },
    // Bumped on every partner password change: older partner JWTs (claim `tv`) stop working.
    tokenVersion: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    // C1-7: set when the admin takes a LIVE store down (isActive true -> false); cleared when it is
    // switched on again. While set (and isActive is false) the partner / vendor login is refused.
    // Drafts (never live) keep logging in. Not the partner's own "closed" switches (isOpenNow /
    // isOffline), which never touch this. Nullable, added on boot by addMissingColumns.
    suspendedAt: { type: DataTypes.DATE, allowNull: true },
    // Partner / vendor app push tokens ([{ token, app, at }]) for new-order alerts while the app is closed.
    fcmTokens: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '[]',
      get() {
        const val = this.getDataValue('fcmTokens');
        try { const arr = val ? JSON.parse(val) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
      },
      set(val) { this.setDataValue('fcmTokens', JSON.stringify(Array.isArray(val) ? val : [])); }
    },
    // First time the store went live (isActive true). Null = draft, never published.
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    // Per-store packaging fee (₹0-500) and minimum order value (₹0-5000), used in the server bill.
    packagingFee: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    minOrderValue: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
    // Owner, 5 Nov 2026: admin-set special delivery price for this store, whole rupees 0-200. null = the standard ₹19
    // (utils/orderPricing). Admin-only: never in public store reads (utils/publicFields STORE_PRIVATE_FIELDS).
    deliveryFeeOverride: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    // Store logo without switching on the branded theme (brandTheme).
    logoUrl: { type: DataTypes.TEXT, allowNull: true },
    isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
    featuredUntil: { type: DataTypes.DATE, allowNull: true },
    featuredBadge: { type: DataTypes.STRING, allowNull: true, defaultValue: 'Sponsored' },
    // ── CampusBites: Local Vendor Fields ──────────────────────
    campus: { type: DataTypes.STRING, allowNull: true }, // e.g. 'SRM', 'VIT', 'KLU'
    // Colleges this store serves (utils/campuses: ['srmap'], ['vitap'], ...). Empty / null = every college.
    visibleCampuses: { type: DataTypes.JSON, allowNull: true },
    isOpenNow: { type: DataTypes.BOOLEAN, defaultValue: true },
    whatsappNumber: { type: DataTypes.STRING, allowNull: true },
    subscriptionTier: { type: DataTypes.STRING, defaultValue: 'free' }, // 'free' or 'premium'
    stallDescription: { type: DataTypes.TEXT, allowNull: true },
    promoOffer: { type: DataTypes.STRING, allowNull: true }, // e.g. 'Buy 2 Get 1 Free'
    clickCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    // ── C8 seller compliance (all nullable; added on boot by addMissingColumns) ──────────
    // Public on the store page / checkout / receipt: legal name, FSSAI licence number + type + expiry,
    // GSTIN (when the seller has one). Validated in utils/storeCompliance.js (owner + admin edits).
    legalName: { type: DataTypes.STRING(200), allowNull: true },
    fssaiLicenseNumber: { type: DataTypes.STRING(14), allowNull: true }, // exactly 14 digits
    fssaiLicenseType: { type: DataTypes.STRING(16), allowNull: true }, // BASIC | STATE | CENTRAL
    fssaiExpiry: { type: DataTypes.DATEONLY, allowNull: true },
    fssaiSubmittedAt: { type: DataTypes.DATE, allowNull: true }, // last change to number / type / expiry
    fssaiVerifiedAt: { type: DataTypes.DATE, allowNull: true }, // admin checked the licence (cleared on change)
    fssaiVerifiedBy: { type: DataTypes.STRING(64), allowNull: true }, // admin user id
    gstin: { type: DataTypes.STRING(15), allowNull: true },
    // PRIVATE (never in public reads: utils/publicFields STORE_PRIVATE_FIELDS). PAN is shown masked only.
    // Payout: UPI ID and bank last-4 + IFSC only. A full bank account number is never stored.
    pan: { type: DataTypes.STRING(10), allowNull: true },
    payoutUpiId: { type: DataTypes.STRING(120), allowNull: true },
    // Revenue (6 Nov 2026): how often ZenWe settles this store: 'daily' | 'weekly' | 'monthly' (utils/revenueReport
    // SETTLEMENT_CYCLES). Admin-set, audited, private. Used by Revenue > Settle all to pick the stores and the cutoff.
    settlementCycle: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'weekly' },
    bankAccountHolder: { type: DataTypes.STRING(120), allowNull: true },
    bankAccountLast4: { type: DataTypes.STRING(4), allowNull: true },
    bankIfsc: { type: DataTypes.STRING(11), allowNull: true },
    // ── In-Campus Booking (modules/campusBooking; all nullable, added on boot by addMissingColumns) ──
    // Admin switch per stall. While on (and a UPI ID is set) students can book the stall for pickup and pay
    // the stall directly by UPI. The UPI ID / QR are shown only on a student's own booking payment screen
    // (never in public store reads: utils/publicFields STORE_PRIVATE_FIELDS).
    campusBookingEnabled: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    campusUpiId: { type: DataTypes.STRING(120), allowNull: true },
    campusUpiName: { type: DataTypes.STRING(120), allowNull: true }, // payee name on the UPI account (optional)
    campusUpiQrUrl: { type: DataTypes.TEXT, allowNull: true }, // the stall's own UPI QR photo (optional)
    campusPrepMinutes: { type: DataTypes.INTEGER, allowNull: true }, // typical prep time; null = 10 min default
    brandTheme: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      get() {
        const val = this.getDataValue('brandTheme');
        try { return val ? JSON.parse(val) : null; } catch { return null; }
      },
      set(val) { this.setDataValue('brandTheme', val ? JSON.stringify(val) : null); }
    }
  }, { timestamps: true });

  const hashPassword = async (restaurant) => {
    if (restaurant.password && restaurant.changed('password')) {
      restaurant.password = await bcrypt.hash(restaurant.password, 10);
    }
  };

  Restaurant.beforeCreate(hashPassword);
  Restaurant.beforeUpdate(hashPassword);
  // Password change (not the first one) revokes every signed-in partner session.
  Restaurant.beforeUpdate((restaurant) => {
    if (restaurant.changed('password') && restaurant.previous('password')) {
      restaurant.tokenVersion = (Number(restaurant.tokenVersion) || 0) + 1;
    }
  });
  // Admin suspension (C1-7): a live store switched off ends every partner session at once.
  Restaurant.beforeUpdate((restaurant) => {
    if (!restaurant.changed('isActive')) return;
    if (restaurant.isActive === false && restaurant.previous('isActive') !== false) {
      restaurant.suspendedAt = new Date();
      restaurant.tokenVersion = (Number(restaurant.tokenVersion) || 0) + 1;
    } else if (restaurant.isActive !== false && restaurant.suspendedAt) {
      restaurant.suspendedAt = null;
    }
  });
  // Draft → published: stamp the first time the store goes live.
  const stampPublished = (restaurant) => {
    if (restaurant.isActive !== false && !restaurant.publishedAt) restaurant.publishedAt = new Date();
  };
  Restaurant.beforeCreate(stampPublished);
  Restaurant.beforeUpdate((restaurant) => { if (restaurant.changed('isActive')) stampPublished(restaurant); });
  Restaurant.beforeBulkCreate(async (restaurants) => {
    for (const rest of restaurants) {
      if (rest.password) {
        rest.password = await bcrypt.hash(rest.password, 10);
      }
    }
  });

  Restaurant.prototype.comparePassword = async function(candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
  };

  return Restaurant;
};

module.exports = { initRestaurantModel, getRestaurantModel: () => Restaurant };
