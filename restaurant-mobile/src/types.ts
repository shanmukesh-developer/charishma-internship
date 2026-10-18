export interface OperatingHours { start?: string; end?: string }

/** Whitelisted store profile kept in the session (never the password hash). */
export interface StoreProfile {
  id: string;
  name: string;
  location?: string;
  imageUrl?: string;
  campus?: string | null;
  operatingHours?: OperatingHours | null;
  isOpenNow?: boolean;
  isOffline?: boolean;
  vendorType?: string;
  deliveryTime?: number;
}

/** Live store state from GET /api/users/restaurants/:id or PUT /api/restaurants/:id/open. */
export interface StoreState {
  name?: string;
  location?: string;
  isOpenNow: boolean;
  isOpen: boolean;
  opensAt: string | null;
  closedReason: string | null;
  isOffline: boolean;
  isActive: boolean;
  operatingHours: OperatingHours | null;
  deliveryTime: number | null;
}

export interface OrderItem {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  customizations: string | null;
  isAddOn: boolean;
}

export type OrderStage = 'new' | 'preparing' | 'ready' | 'pickedUp' | 'past';

export interface Order {
  id: string;
  shortId: string;
  status: string;
  stage: OrderStage;
  createdAt: string | null;
  updatedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  items: OrderItem[];
  itemCount: number;
  totalPrice: number;
  finalPrice: number;
  deliveryFee: number;
  paymentMethod: string;
  paymentStatus: string | null;
  isCOD: boolean;
  /** Delivery address without the "Note: …" parts. Shown on screen, never spoken. */
  deliveryAddress: string;
  /** Campus label parsed from the address ("SRM AP"), safe to speak. */
  campus: string | null;
  instructions: string[];
  estDuration: number | null;
  cancellationReason: string | null;
  deliveryPartnerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  riderName: string | null;
  riderPhone: string | null;
  /** Card built from a socket event before the full order was fetched. */
  partial?: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  category: string;
  isVegetarian: boolean | null;
  isAvailable: boolean;
  outOfStockUntil: string | null;
  /** Server food type (MenuItem.dietType). null on older items: fall back to isVegetarian / the "egg" tag. */
  dietType: Diet | null;
  /** MRP (strike-through price), >= price. null = none. */
  originalPrice: number | null;
  /** Free-form server tags. Older egg dishes were marked with an "egg" tag before dietType existed. */
  tags: string[];
}

export type Diet = 'veg' | 'nonveg' | 'egg';

/** What the add / edit item form sends to the store. */
export interface ItemInput {
  name: string;
  price: number;
  category: string;
  diet: Diet;
  description: string;
  imageUrl: string | null;
  isAvailable: boolean;
  /** MRP; null = none. */
  originalPrice: number | null;
}

export type ConnStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

// ── Store compliance (FSSAI licence, tax, read-only payout) ─────────────────
export type FssaiType = 'BASIC' | 'STATE' | 'CENTRAL';
export type FssaiStatus = 'MISSING' | 'EXPIRED' | 'PENDING' | 'VERIFIED';

/** GET /api/restaurants/:id/compliance → compliance (the owner's private view). */
export interface Compliance {
  legalName: string | null;
  fssaiLicenseNumber: string | null;
  fssaiLicenseType: FssaiType | null;
  /** YYYY-MM-DD */
  fssaiExpiry: string | null;
  fssaiSubmittedAt: string | null;
  fssaiVerifiedAt: string | null;
  fssaiStatus: FssaiStatus;
  fssaiExpiringSoon: boolean;
  fssaiText: string | null;
  gstin: string | null;
  panMasked: string | null;
  hasPan: boolean;
  payoutUpiId: string | null;
  bankAccountHolder: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
}

/** The only fields the owner may change (PAN / payout are admin-only: never send them). */
export interface ComplianceEdit {
  legalName?: string | null;
  fssaiLicenseNumber?: string | null;
  fssaiLicenseType?: FssaiType | null;
  fssaiExpiry?: string | null;
  gstin?: string | null;
}
