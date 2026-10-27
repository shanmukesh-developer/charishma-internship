export interface OperatingHours {
  start?: string;
  end?: string;
  /** Day-by-day hours set by Zenvy (mon..sun). The app's simple hours replace them when saved. */
  weekly?: Record<string, { open?: boolean; start?: string; end?: string }> | null;
}

/** Whitelisted stall profile kept in the session (never the password hash). */
export interface StoreProfile {
  id: string;
  name: string;
  location?: string;
  imageUrl?: string;
  campus?: string | null;
  operatingHours?: OperatingHours | null;
  isOpenNow?: boolean;
  vendorType?: string;
  whatsappNumber?: string;
  phone?: string;
}

/** Live shop state from GET /api/users/restaurants/:id or PUT /api/restaurants/:id/open. */
export interface StoreState {
  name?: string;
  location?: string;
  isOpenNow: boolean;
  isOpen: boolean;
  opensAt: string | null;
  closedReason: string | null;
  isActive: boolean;
  operatingHours: OperatingHours | null;
}

export interface OrderItem {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  customizations: string | null;
}

/** Vendor flow: Pending → Accepted → OutForDelivery → Delivered (or Cancelled). */
export type OrderStage = 'new' | 'accepted' | 'outForDelivery' | 'done';

export interface Order {
  id: string;
  shortId: string;
  status: string;
  stage: OrderStage;
  createdAt: string | null;
  updatedAt: string | null;
  acceptedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  items: OrderItem[];
  itemCount: number;
  /** Item total. */
  totalPrice: number;
  /** What the customer pays (items + any fees − discounts). */
  finalPrice: number;
  paymentMethod: string;
  isCOD: boolean;
  /** Cash the vendor collects at the door (0 when already paid). */
  collectAmount: number;
  /** Delivery address without the "Note: …" parts. Shown on screen, never spoken. */
  deliveryAddress: string;
  hostelBlock: string | null;
  roomNumber: string | null;
  instructions: string[];
  cancellationReason: string | null;
  /** Who cancelled (server Orders.cancelledBy, or the socket event's reason code). Null = not known. */
  cancelledBy: CancelledBy | null;
  /** Full customer name (owning vendor only). */
  customerName: string | null;
  customerPhone: string | null;
  /** Delivery slot the customer booked ("Wed 28 Oct, 12:30–1:00 PM"); null on older ASAP orders. */
  slotLabel: string | null;
  slotStart: string | null;
  /** Card built from a socket event before the full order was fetched. */
  partial?: boolean;
}

export type CancelledBy = 'customer' | 'store' | 'support' | 'system';

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  category: string;
  isVegetarian: boolean | null;
  isAvailable: boolean;
  /** Server food type (MenuItem.dietType). null on older items: fall back to isVegetarian / the "egg" tag. */
  dietType: Diet | null;
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
