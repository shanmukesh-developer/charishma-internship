// Fields that public (unauthenticated) store / menu endpoints must never return.
// Admin endpoints (/api/admin/*) keep the full rows.
// phone = the partner's private login phone (customers call the stall on whatsappNumber).
// C8: PAN, payout UPI / bank details and the verifying admin's id are private to the store and admins.
// In-Campus Booking: the stall's UPI ID / payee name / QR reach a student only on their own booking.
const STORE_PRIVATE_FIELDS = ['pan', 'payoutUpiId', 'bankAccountHolder', 'bankAccountLast4', 'bankIfsc', 'fssaiVerifiedBy',
  'campusUpiId', 'campusUpiName', 'campusUpiQrUrl',
  // Admin-set special delivery price: customers see only the resulting fee in the bill preview.
  'deliveryFeeOverride'];
const STORE_SECRET_FIELDS = ['password', 'commissionRate', 'commissionType', 'phone', 'tokenVersion', 'fcmTokens', ...STORE_PRIVATE_FIELDS];
const ITEM_SECRET_FIELDS = ['password', 'customCommission', 'ownerName', 'ownerPhone'];

const strip = (obj, fields) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const f of fields) delete obj[f];
  return obj;
};

// Both mutate and return the plain object they are given (call on toJSON() output, not model rows).
const stripStoreSecrets = (json) => strip(json, STORE_SECRET_FIELDS);
const stripItemSecrets = (json) => strip(json, ITEM_SECRET_FIELDS);

// A promotion whose featuredUntil has passed is not featured any more (read-time check; the
// featured-expiry cron also clears the row). Mutates and returns the plain store object.
const applyFeaturedExpiry = (json, now = new Date()) => {
  if (json && json.isFeatured && json.featuredUntil && new Date(json.featuredUntil) < now) {
    json.isFeatured = false;
    json.featuredBadge = null;
  }
  return json;
};

// Rider-delivered (fulfilment ZENVY) orders as the kitchen sees them: the customer's first name
// and the campus only. The rider gets the exact address; stall orders keep full contact (vendor delivers).
const customerFirstName = (name) => String(name || '').trim().split(/\s+/)[0].slice(0, 40) || 'Customer';
const campusLabel = (address) => {
  const a = String(address || '').toLowerCase();
  if (/\bsrm\b/.test(a)) return 'SRM AP campus';
  if (/\bvit\b/.test(a)) return 'VIT AP campus';
  if (a.includes('amrita')) return 'Amrita campus';
  return 'Delivered by a ZenWe rider';
};

module.exports = { stripStoreSecrets, stripItemSecrets, applyFeaturedExpiry, STORE_SECRET_FIELDS, STORE_PRIVATE_FIELDS, ITEM_SECRET_FIELDS, customerFirstName, campusLabel };
