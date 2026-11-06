/**
 * Revenue section (owner, 6 Nov 2026): types of GET /api/admin/revenue and the settle endpoints
 * (backend routes/revenueRoutes.js, rules in backend/utils/revenueReport.js), plus money formatting.
 * Every amount arrives as integer paise and is formatted here with integer maths only (no float rupees).
 */

export type Period = 'day' | 'week' | 'month';
export type Cycle = 'daily' | 'weekly' | 'monthly';
export type Channel = 'cod' | 'wallet' | 'stall' | 'other';

export const CYCLES: { value: Cycle; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
export const cycleLabel = (c: string | null | undefined) => CYCLES.find(x => x.value === c)?.label || 'Weekly';

export interface RevenueSums {
  orders: number;
  collectedPaise: number;
  byChannel: Record<Channel, number>;
  ordersByChannel: Record<Channel, number>;
  refundsPaise: number;
  itemsPaise: number;
  commissionPaise: number;
  deliveryFeesPaise: number;
  platformFeesPaise: number;
  packagingFeesPaise: number;
  taxesPaise: number;
  discounts: { coupon: number; perks: number; sharedRide: number; other: number };
  discountsPaise: number;
  riderPayPaise: number;
  keepsPaise: number;
  storeSharePaise: number;
  counterPaidPaise: number;
  stallCashPaise: number;
  owedPaise: number;
  settledPaise: number;
  onStatementPaise: number;
  pendingPaise: number;
  commissionEstimatedOrders: number;
  differencePaise: number;
}

export interface StoreRow extends RevenueSums {
  storeId: string;
  name: string;
  kind: 'restaurant' | 'vendor';
  vendorType: string | null;
  isActive: boolean;
  settlementCycle: Cycle;
  payoutUpiId: string | null;
  currentCommission: { rate: number; type: 'percentage' | 'flat' } | null;
  ratesAtOrderTime: { type: 'percentage' | 'flat'; rate: number }[];
  effectiveCommissionPct: number;
}

export interface KeepsLine { key: string; label: string; paise: number; sign: 1 | -1 }

export interface Mismatch {
  orderId: string;
  orderCode: string;
  storeId: string;
  storeName: string | null;
  differencePaise: number;
  collectedPaise: number;
  reason: string;
}

export interface RevenueReport {
  period: {
    period: Period; label: string; startDate: string; endDate: string; start: string; end: string;
    prevDate: string; nextDate: string; isCurrent: boolean; isFuture: boolean; days: number;
  };
  storeId: string | null;
  totals: RevenueSums & { zenweReceivedPaise: number };
  keepsLines: KeepsLine[];
  reconciliation: {
    ok: boolean; collectedLessRefundsPaise: number; storeSharePlusKeepsPlusRiderPaise: number; differencePaise: number;
    mismatchedOrders: number; mismatches: Mismatch[]; rule: string;
  };
  stores: StoreRow[];
  series: { date: string; label: string; orders: number; collectedPaise: number; keepsPaise: number; owedPaise: number; commissionPaise: number }[];
  excluded: { testOrders: number };
  commissionEstimated: { orders: number; sample: { orderId: string; orderCode: string }[] };
  context: { riderCashHeldNowPaise: number | null };
  generatedAt: string;
}

export interface SettlePreviewRow {
  storeId: string;
  name: string;
  kind: 'restaurant' | 'vendor';
  payoutUpiId: string | null;
  orderCount: number;
  grossPaise: number;
  commissionPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
  direction: 'zenwe_pays_store' | 'store_pays_zenwe' | 'nothing';
  firstDeliveredAt: string | null;
}

export interface Statement {
  id: string;
  partnerType: 'restaurant' | 'vendor' | 'rider';
  partnerId: string;
  partnerName: string | null;
  periodStart: string | null;
  periodEnd: string;
  orderCount: number;
  grossPaise: number;
  commissionPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  method: string | null;
  utr: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface SettlePreview {
  cycle: Cycle;
  cutoff: string;
  coversThrough: string;
  cutoffLabel: string;
  storesInCycle: number;
  testStoresSkipped: number;
  stores: SettlePreviewRow[];
  totals: { stores: number; orders: number; grossPaise: number; commissionPaise: number; adjustmentsPaise: number; netPaise: number; zenwePaysPaise: number; storesPayZenwePaise: number };
  planHash: string;
  pendingStatements: Statement[];
}

export interface SettleResult {
  message: string;
  cycle: Cycle;
  cutoff: string;
  created: Statement[];
  alreadySettled: { storeId: string; name?: string }[];
  changed: { storeId: string; name?: string; message: string }[];
  skipped: { storeId: string; name?: string; reason: string }[];
  failed: { storeId: string; name?: string; message: string }[];
}

export interface MarkPaidResult {
  message: string;
  paid: Statement[];
  alreadyPaid: Statement[];
  failed: { payoutId: string; code: string; message: string }[];
}

const grouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Paise -> "₹1,23,456.78" (Indian grouping, always 2 decimals); negative as "−₹13.00". Integer maths only. */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '–';
  const p = Math.round(paise);
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${p < 0 ? '−' : ''}₹${grouping.format(whole)}.${frac}`;
}

/** Same for CSV: plain "1234.56" (no symbol, no grouping), so spreadsheets read it as a number. */
export function csvRupees(paise: number): string {
  const p = Math.round(paise);
  const abs = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const commissionText = (c: { rate: number; type: 'percentage' | 'flat' } | null | undefined) =>
  !c ? '–' : c.type === 'flat' ? `₹${c.rate} per order` : `${c.rate}%`;

/** Today's date in IST as YYYY-MM-DD (the backend's periods are IST). */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export const orderLabel = (o: { orderCode?: string | null; orderId?: string; id?: string }) =>
  o.orderCode || `#${String(o.orderId || o.id || '').slice(-6)}`;
