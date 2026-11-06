// Rider app domain types. Unknown values are null, never invented.

export type OrderStatus =
  | 'Pending'
  | 'Accepted'
  | 'Preparing'
  | 'ReadyForPickup'
  | 'Picking'
  | 'PickedUp'
  | 'ArrivedAtGate'
  | 'Delivered'
  | 'Cancelled'
  /** A status this app version does not know. The raw value is in RiderOrder.rawStatus. */
  | 'Unknown';

export type PaymentMethod = 'COD' | 'Wallet' | 'UPI' | 'Card';

export interface RiderOrderItem {
  name: string;
  quantity: number;
  price: number | null;
  /** The customer's picks, e.g. "Weight: 500 g · Flavour: Chocolate" (what to buy / check), or null. */
  options: string | null;
}

export interface RiderOrder {
  id: string;
  shortId: string;
  /** Human order ID shown everywhere: "ZEN-123" (or "#AB12CD" for an order without a number yet). */
  orderCode: string;
  status: OrderStatus;
  /** Status string exactly as the server sent it (kept so an unknown status is never shown as something else). */
  rawStatus: string | null;
  /**
   * Has the kitchen packed the food? true / false from the server's readyAt (or status ReadyForPickup);
   * null when the server did not say.
   */
  kitchenReady: boolean | null;
  restaurantName: string | null;
  restaurantAddress: string | null;
  restaurantPhone: string | null;
  pickupCoords: { lat: number; lng: number } | null;
  customerName: string | null;
  customerPhone: string | null;
  dropAddress: string | null;
  /** Pool-safe area (campus / hostel block / locality, no room number). Sent before and after accept. */
  dropArea: string | null;
  /** Customer pin; only on active / accepted orders (never in the pool). */
  dropCoords: { lat: number; lng: number } | null;
  instructions: string[];
  items: RiderOrderItem[];
  finalPrice: number | null;
  paymentMethod: PaymentMethod | null;
  paymentStatus: string | null;
  amountToCollect: number | null;
  earning: number | null;
  distanceKm: number | null;
  createdAt: string | null;
  deliveredAt: string | null;
  /** Delivery slot the customer booked ("Wed 28 Oct, 12:30–1:00 PM"); null on older ASAP orders. */
  deliverySlot: string | null;
  hasDeliveryPin: boolean;
  pinLocked: boolean;
  /** Store has no partner app: the rider buys the items at the counter. */
  buyAtStore: boolean;
}

export interface RiderProfile {
  id: string;
  name: string;
  phone: string;
  vehicleType: string | null;
  vehicleNumber: string | null;
  emergencyContact: string | null;
  photoUrl: string | null;
  isApproved: boolean;
  isOnline: boolean;
  averageRating: number | null;
  totalRatings: number;
  totalEarnings: number | null;
  completedCount: number | null;
  walletBalance: number | null;
}

/** C6: COD cash the rider holds for Zenvy (rider cash ledger). The limit is off unless an admin sets one. */
export interface CashStatus {
  cashHeld: number;
  limit: number;
  limitEnabled: boolean;
  overLimit: boolean;
  depositNeeded: number;
  /** "Deposit ₹X to keep taking COD orders." only when a limit is on and reached; else null. */
  message: string | null;
}

export interface CashEntry {
  id: string;
  type: string;
  label: string;
  amount: number;
  balanceAfter: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

/** GET /delivery/cash: cash held + what Zenvy owes (earnings + tips), never netted automatically. */
export interface RiderCash {
  status: CashStatus;
  position: { cashHeld: number; zenvyOwes: number; earnings: number; tips: number; net: number };
  recentDeposits: CashEntry[];
}

export interface TodayStats {
  earnings: number;
  orders: number;
  zenPoints?: number;
  streak?: number;
  codCollected?: number;
  cash?: CashStatus;
}

export interface WeekDay {
  date: string; // YYYY-MM-DD (IST)
  earnings: number;
  orders: number;
  codCollected?: number;
}

export interface WeekStats {
  days: WeekDay[];
  totalEarnings: number;
  totalOrders: number;
  /** 'server' = GET /delivery/stats/week, 'history' = computed from recent deliveries */
  source: 'server' | 'history';
}

export interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  adminResponse: string | null;
  createdAt: string;
}

export interface Loadable<T> {
  data: T;
  loaded: boolean;
  error: string | null;
  updatedAt: number | null;
}

/** GET /delivery/stats/range: earnings by IST day and Monday-start week. */
export interface RangeBucket {
  earnings: number;
  orders: number;
  codCollected: number;
}
export interface RangeDay extends RangeBucket {
  date: string; // YYYY-MM-DD (IST)
}
export interface RangeWeek extends RangeBucket {
  weekStart: string;
  from: string;
  to: string;
}
export interface EarningsRange {
  from: string;
  to: string;
  days: RangeDay[];
  weeks: RangeWeek[];
  totalEarnings: number;
  totalOrders: number;
  codCollected: number;
}

/** One payout statement (GET /delivery/payouts). Amounts in rupees. */
export interface PayoutStatement {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  orderCount: number;
  gross: number;
  tips: number;
  adjustments: number;
  net: number;
  status: 'PENDING' | 'PAID' | string;
  method: string | null;
  utr: string | null;
  paidAt: string | null;
  createdAt: string | null;
}
