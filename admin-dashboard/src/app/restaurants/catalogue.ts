// Stores (restaurants, non-food stores and CampusBites stalls) are Restaurant rows on the backend;
// their products are MenuItem rows. These types mirror GET /api/admin/restaurants and /api/admin/menu-items.

export interface BrandTheme {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontColor?: string;
  logoUrl?: string;
  [key: string]: unknown;
}

export interface OperatingHours {
  start?: string;
  end?: string;
  /** Per-day hours (IST). The server opens / closes the store by today's window. */
  weekly?: Record<string, { open?: boolean; start?: string; end?: string }>;
}

export interface Store {
  _id: string;
  id?: string;
  name: string;
  location: string;
  vendorType?: string | null;
  imageUrl?: string | null;
  isActive: boolean;
  isOffline?: boolean;
  isOpenNow?: boolean;
  isOpen?: boolean;
  opensAt?: string | null;
  closedReason?: string | null;
  operatingHours?: OperatingHours | null;
  deliveryTime?: number | null;
  whatsappNumber?: string | null;
  commissionRate?: number;
  commissionType?: 'percentage' | 'flat';
  tags?: string[];
  campus?: string | null;
  zone?: string | null;
  lat?: number | null;
  lon?: number | null;
  rating?: number | null;
  stallDescription?: string | null;
  isFeatured?: boolean;
  featuredUntil?: string | null;
  featuredBadge?: string | null;
  promoOffer?: string | null;
  subscriptionTier?: string | null;
  brandTheme?: BrandTheme | string | null;
  clickCount?: number;
  itemCount?: number;
  /** Partner / vendor login phone (10 digits). `phone` and `partnerPhone` are the same column. */
  phone?: string | null;
  partnerPhone?: string | null;
  /** A partner password is set (the hash is never sent). */
  hasPassword?: boolean;
  /** In-Campus Booking on: a pickup-only stall that students pre-book; it signs in to ZCS Campus Stall. */
  campusBookingEnabled?: boolean | null;
  /** Phones with the partner / vendor app registered for push. */
  pushDevices?: number;
  /** First time the store went live. null = never published (a draft). */
  publishedAt?: string | null;
  packagingFee?: number | null;
  minOrderValue?: number | null;
  logoUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // C8 seller compliance (PAN is never sent in full: only panMasked).
  legalName?: string | null;
  fssaiLicenseNumber?: string | null;
  fssaiLicenseType?: FssaiLicenseType | null;
  fssaiExpiry?: string | null;
  fssaiSubmittedAt?: string | null;
  fssaiVerifiedAt?: string | null;
  fssaiVerifiedBy?: string | null;
  gstin?: string | null;
  payoutUpiId?: string | null;
  bankAccountHolder?: string | null;
  bankAccountLast4?: string | null;
  bankIfsc?: string | null;
  panMasked?: string | null;
  compliance?: StoreCompliance | null;
}

export type FssaiLicenseType = 'BASIC' | 'STATE' | 'CENTRAL';
export type FssaiStatus = 'MISSING' | 'EXPIRED' | 'PENDING' | 'VERIFIED';

/** Admin view of a store's compliance fields (backend utils/storeCompliance privateView). */
export interface StoreCompliance {
  legalName: string | null;
  fssaiLicenseNumber: string | null;
  fssaiLicenseType: FssaiLicenseType | null;
  fssaiExpiry: string | null;
  fssaiSubmittedAt: string | null;
  fssaiVerifiedAt: string | null;
  fssaiVerifiedBy: string | null;
  fssaiStatus: FssaiStatus;
  fssaiExpiringSoon: boolean;
  fssaiText: string;
  gstin: string | null;
  panMasked: string | null;
  hasPan: boolean;
  payoutUpiId: string | null;
  bankAccountHolder: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
}

export const FSSAI_STATUS_META: Record<FssaiStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'sky'; help: string }> = {
  MISSING: { label: 'FSSAI missing', tone: 'amber', help: 'No FSSAI licence number on file.' },
  EXPIRED: { label: 'FSSAI expired', tone: 'red', help: 'The FSSAI licence expiry date has passed. Ask the store for the renewed licence.' },
  PENDING: { label: 'FSSAI pending check', tone: 'sky', help: 'A licence number is on file but an admin has not checked it yet.' },
  VERIFIED: { label: 'FSSAI verified', tone: 'green', help: 'An admin checked the FSSAI licence.' },
};
/** FSSAI status of a store row (from `compliance`, falling back to the flat fields). */
export const fssaiStatusOf = (s: Store): { status: FssaiStatus; expiringSoon: boolean } => {
  if (s.compliance?.fssaiStatus) return { status: s.compliance.fssaiStatus, expiringSoon: !!s.compliance.fssaiExpiringSoon };
  if (!s.fssaiLicenseNumber) return { status: 'MISSING', expiringSoon: false };
  return { status: s.fssaiVerifiedAt ? 'VERIFIED' : 'PENDING', expiringSoon: false };
};

export interface Product {
  _id: string;
  id?: string;
  restaurantId: string;
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  image?: string | null;
  isAvailable: boolean;
  outOfStockUntil?: string | null;
  isEliteOnly?: boolean;
  /** Specialized (custom / designer) cake: booking closes 2½ hours before the delivery slot (normal cakes 2 h). */
  isSpecializedCake?: boolean;
  isVegetarian?: boolean;
  /** 'veg' | 'nonveg' | 'egg'. null on older rows: fall back to isVegetarian. */
  dietType?: DietType | null;
  /** MRP (crossed-out price), kept in step with specs.originalPrice. */
  originalPrice?: number | null;
  tags?: string[];
  specs?: Record<string, unknown> | null;
  createdAt?: string;
}

export type DietType = 'veg' | 'nonveg' | 'egg';
export const dietOf = (p: Pick<Product, 'dietType' | 'isVegetarian'>): DietType =>
  p.dietType === 'veg' || p.dietType === 'nonveg' || p.dietType === 'egg' ? p.dietType : p.isVegetarian === false ? 'nonveg' : 'veg';
/** MRP from the column, else the older specs.originalPrice. */
export const mrpOf = (p: Pick<Product, 'originalPrice' | 'specs'>): number | null => {
  const n = Number(p.originalPrice ?? readSpecs(p.specs).originalPrice);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type VendorGroup = 'Food' | 'Shops' | 'Services' | 'Campus';

/** Canonical store types the backend understands (see backend/utils/vendorTypes.js). */
export const VENDOR_TYPES: { value: string; label: string; group: VendorGroup; hint: string }[] = [
  { value: 'RESTAURANT', label: 'Restaurant', group: 'Food', hint: 'Cooked food. Orders, payment and ZCS riders.' },
  { value: 'LOCAL_VENDOR', label: 'Local stall (CampusBites)', group: 'Campus', hint: 'Customers order in ZCS and pay the stall cash. The stall delivers with the ZCS Vendor app; no rider.' },
  { value: 'GROCERY', label: 'Grocery / Kirana', group: 'Shops', hint: 'Packaged goods, fruits, pickles and late-night mart.' },
  { value: 'BAKERY', label: 'Bakery & cakes', group: 'Shops', hint: 'Cakes, breads and bakes. Shows under Bakery in Groceries; set weights and flavours per product.' },
  { value: 'PHARMACY', label: 'Pharmacy', group: 'Shops', hint: 'Medicines and health essentials.' },
  { value: 'STATIONERY', label: 'Stationery', group: 'Shops', hint: 'Books, pens, study kits.' },
  { value: 'ELECTRONICS', label: 'Electronics', group: 'Shops', hint: 'Chargers, cables, gadgets.' },
  { value: 'HOME_ESSENTIALS', label: 'Home essentials', group: 'Shops', hint: 'Mattresses, bedding, room needs.' },
  { value: 'TOYS', label: 'Toys', group: 'Shops', hint: 'Toys and games.' },
  { value: 'SEEDS', label: 'Seeds & gardening', group: 'Shops', hint: 'Plants, seeds and kits.' },
  { value: 'RENTALS', label: 'Rentals', group: 'Shops', hint: 'Things students rent.' },
  { value: 'EXTRAS', label: 'Add-ons & extras', group: 'Shops', hint: 'Checkout add-ons (candles, cards…).' },
  { value: 'REPAIRS', label: 'Repairs', group: 'Services', hint: 'Booking only: customers book, never order.' },
  { value: 'PRINT', label: 'Print & xerox', group: 'Services', hint: 'Booking only: priced per page / binding.' },
  { value: 'LAUNDRY', label: 'Laundry', group: 'Services', hint: 'Booking only.' },
  { value: 'TAILORING', label: 'Tailoring', group: 'Services', hint: 'Booking only.' },
];

/** Store types whose products are services the customer BOOKS (POST /api/services/book), never orders. */
export const BOOKING_ONLY_VENDOR_TYPES = ['REPAIRS', 'PRINT', 'LAUNDRY', 'TAILORING'];
export const isBookingOnlyStore = (type?: string | null) => BOOKING_ONLY_VENDOR_TYPES.includes(String(type || '').toUpperCase());
/** CampusBites stalls: orders are placed in Zenvy, COD to the stall, the stall delivers (mirror of backend LOCAL_VENDOR_TYPES). */
export const isLocalVendorType = (type?: string | null) => ['LOCAL_VENDOR', 'LOCAL', 'STALL'].includes(String(type || '').toUpperCase());
/** A campus stall with In-Campus Booking on: pickup only (no delivery), run from the ZCS Campus Stall app. */
export const isBookingStall = (s: Pick<Store, 'vendorType' | 'campusBookingEnabled'>) => isLocalVendorType(s.vendorType) && s.campusBookingEnabled === true;
/** The app a store's partner signs in to. */
export const partnerAppName = (s: Pick<Store, 'vendorType' | 'campusBookingEnabled'>) => (isBookingStall(s) ? 'ZCS Campus Stall' : isLocalVendorType(s.vendorType) ? 'ZCS Vendor' : 'ZCS Restaurant');

const LEGACY_LABELS: Record<string, string> = {
  STATIONARY: 'Stationery (old spelling)',
  RENTAL: 'Rentals (old spelling)',
};

export const vendorLabel = (type?: string | null) => {
  const value = (type || 'RESTAURANT').toUpperCase();
  return VENDOR_TYPES.find(v => v.value === value)?.label.replace(/ \(.*\)$/, '')
    || LEGACY_LABELS[value]
    || value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
};

export const storeId = (s: { _id?: string; id?: string }) => s._id || s.id || '';

/** "919876543210" -> "98765 43210" for display. */
export const formatWhatsapp = (value?: string | null) => {
  const ten = tenDigits(value);
  return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : ten;
};

/** Any Indian mobile input ("+91 98765-43210", "919876543210") -> "9876543210" (or the raw digits). */
export const tenDigits = (value?: string | null) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
};

export const isValidIndianMobile = (value?: string | null) => /^[6-9]\d{9}$/.test(tenDigits(value));

export const formatTime = (hhmm?: string | null) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return hhmm || '';
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};

export const readSpecs = (specs: unknown): Record<string, unknown> => {
  if (typeof specs === 'string') {
    try { return readSpecs(JSON.parse(specs)); } catch { return {}; }
  }
  return specs && typeof specs === 'object' && !Array.isArray(specs) ? (specs as Record<string, unknown>) : {};
};

/** Store / item tags as a string list. Older rows can arrive JSON-encoded (once or twice) instead of as an array. */
export const readTags = (value: unknown): string[] => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter(t => typeof t === 'string' || typeof t === 'number').map(String) : [];
};

export const readBrandTheme = (value: unknown): BrandTheme | null => {
  const obj = readSpecs(value);
  return Object.keys(obj).length ? (obj as BrandTheme) : null;
};

export const formatINR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export type StoreStatus = 'live' | 'closed' | 'draft' | 'inactive';

/**
 * Live = active and open now. Closed now = active but outside hours / paused by the store.
 * Draft = never published (publishedAt is null). Inactive = was live once, now switched off.
 */
export const storeStatus = (s: Store): StoreStatus => {
  if (!s.isActive) return s.publishedAt ? 'inactive' : 'draft';
  return s.isOpen === false ? 'closed' : 'live';
};

export const STATUS_META: Record<StoreStatus, { label: string; tone: 'green' | 'amber' | 'slate' | 'red'; help: string }> = {
  live: { label: 'Live', tone: 'green', help: 'Visible in the app and open right now.' },
  closed: { label: 'Closed now', tone: 'amber', help: 'Visible in the app, but outside its hours or paused by the store.' },
  draft: { label: 'Draft', tone: 'slate', help: 'Never published: hidden from customers. Finish setup, then publish.' },
  inactive: { label: 'Inactive', tone: 'red', help: 'Switched off: hidden from customers and not taking orders.' },
};

/** Customer-app route for a store (also used as the Home banner redirect). */
export const storeAppPath = (id: string) => `/restaurant/${id}`;

// Shared request helpers live in src/lib/api.ts.
export { adminRequest, uploadImage } from '@/lib/api';
