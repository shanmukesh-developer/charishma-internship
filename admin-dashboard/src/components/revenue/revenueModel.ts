/**
 * Revenue section (owner, 6 Nov 2026): types of GET /api/admin/revenue and the settle endpoints
 * (backend routes/revenueRoutes.js, rules in backend/utils/revenueReport.js), money formatting and the guard that
 * checks every field the server sends before the page shows it.
 *
 * Every amount arrives as integer paise and is formatted here with integer maths only (no float rupees).
 * A money field that is missing or not a number becomes NaN and is listed in `flags`: rupees(NaN) prints "—"
 * (never "NaN", "undefined" or "₹-0.00") and the page shows a red "some figures are missing" banner, so a
 * broken answer can never look like a real ₹0.00.
 */

export type Period = 'day' | 'week' | 'month';
export type Cycle = 'daily' | '3days' | 'weekly';
export type Channel = 'cod' | 'wallet' | 'stall' | 'other';

export const MISSING = '—';

export const CYCLES: { value: Cycle; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: '3days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
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
  keepsPaise: number;
  storeSharePaise: number;
  counterPaidPaise: number;
  stallCashPaise: number;
  owedPaise: number;
  settledPaise: number;
  onStatementPaise: number;
  pendingPaise: number;
  commissionEstimatedOrders: number;
  /** Rider orders marked Delivered with no rider on them (null: the server is older and does not say). */
  noRiderOrders: number | null;
  differencePaise: number;
}

/** Where ZenWe can send a store's money (masked: the full account number only comes from the audited reveal). */
export interface PaymentInfo {
  payoutUpiId: string | null;
  bankAccountHolder: string | null;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  bankBranch: string | null;
  hasUpi: boolean;
  hasBank: boolean;
  /** A UPI ID, or a bank account to transfer to. Without it a statement cannot be marked paid. */
  canPay: boolean;
}

/** Reads the server's payment block; an older server sends only payoutUpiId. */
export function paymentOf(raw: unknown, fallbackUpi?: string | null): PaymentInfo {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null);
  const upi = str('payoutUpiId') || (fallbackUpi && fallbackUpi.trim() ? fallbackUpi.trim() : null);
  const hasBank = o.hasBank === true;
  return {
    payoutUpiId: upi, bankAccountHolder: str('bankAccountHolder'), bankAccountMasked: str('bankAccountMasked'), bankIfsc: str('bankIfsc'),
    bankName: str('bankName'), bankBranch: str('bankBranch'), hasUpi: !!upi, hasBank, canPay: !!upi || hasBank,
  };
}

export interface StoreRow extends RevenueSums {
  storeId: string;
  name: string;
  kind: 'restaurant' | 'vendor';
  vendorType: string | null;
  isActive: boolean;
  settlementCycle: Cycle;
  payoutUpiId: string | null;
  payment: PaymentInfo;
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

export interface NoRiderOrder { orderId: string; orderCode: string; storeName: string | null; channel: Channel; deliveryFeePaise: number }

export interface SeriesDay { date: string; label: string; orders: number; collectedPaise: number; keepsPaise: number; owedPaise: number; commissionPaise: number }

export interface RevenueReport {
  period: {
    period: Period; label: string; startDate: string; endDate: string; start: string; end: string;
    prevDate: string; nextDate: string; isCurrent: boolean; isFuture: boolean; days: number;
  };
  storeId: string | null;
  totals: RevenueSums & { zenweReceivedPaise: number };
  keepsLines: KeepsLine[];
  reconciliation: {
    ok: boolean; collectedLessRefundsPaise: number; storeSharePlusKeepsPaise: number; differencePaise: number;
    mismatchedOrders: number; mismatches: Mismatch[]; rule: string;
  };
  stores: StoreRow[];
  series: SeriesDay[];
  excluded: { testOrders: number };
  commissionEstimated: { orders: number; sample: { orderId: string; orderCode: string }[] };
  noRider: { orders: number; sample: NoRiderOrder[] } | null;
  context: { riderCashHeldNowPaise: number | null };
  generatedAt: string;
}

export interface SettlePreviewRow {
  storeId: string;
  name: string;
  kind: 'restaurant' | 'vendor';
  payoutUpiId: string | null;
  payment?: PaymentInfo;
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
  /** The store's payout UPI ID today (newer servers only; null = not set). */
  payoutUpiId?: string | null;
  /** The store's payment details today (masked). */
  payment?: PaymentInfo;
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
  duplicate?: boolean;
}

export interface MarkPaidResult {
  message: string;
  paid: Statement[];
  alreadyPaid: Statement[];
  failed: { payoutId: string; code: string; message: string }[];
  duplicate?: boolean;
}

// ── formatting ─────────────────────────────────────────────────────────────────────────────────────
const grouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** True for a usable whole-paise amount. */
export const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Paise -> "₹1,23,456.78" (Indian grouping, always 2 decimals); negative as "−₹13.00"; missing as "—". */
export function rupees(paise: number | null | undefined): string {
  if (!ok(paise)) return MISSING;
  const p = Math.round(paise);
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${p < 0 ? '−' : ''}₹${grouping.format(whole)}.${frac}`;
}

/** Same without the sign (for "Store owes ZenWe ₹8.00"). */
export const rupeesAbs = (paise: number | null | undefined) => (ok(paise) ? rupees(Math.abs(paise)) : MISSING);

/** A count with Indian grouping, "—" when missing. */
export const count = (n: number | null | undefined) => (ok(n) ? grouping.format(Math.round(n)) : MISSING);

export const plural = (n: number | null | undefined, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** CSV: plain "1234.56" (no symbol, no grouping), so spreadsheets read it as a number. Missing -> empty cell. */
export function csvRupees(paise: number | null | undefined): string {
  if (!ok(paise)) return '';
  const p = Math.round(paise);
  const abs = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Sum of paise; NaN when any part is missing (so a gap is shown as "—", never as a smaller real number). */
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const commissionText = (c: { rate: number; type: 'percentage' | 'flat' } | null | undefined) =>
  !c || !ok(c.rate) ? MISSING : c.type === 'flat' ? `₹${c.rate} per order` : `${c.rate}%`;

/** Today's date in IST as YYYY-MM-DD (the backend's periods are IST). */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const civil = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const dayText = (d: Date, withYear: boolean) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;

/** "Mon 3 Nov – Sun 9 Nov 2026" (or one day: "Thu 6 Nov 2026"), from the IST calendar dates of the period. */
export function rangeText(p: { startDate: string; endDate: string } | null | undefined): string {
  const a = p ? civil(p.startDate) : null;
  const b = p ? civil(p.endDate) : null;
  if (!a || !b) return MISSING;
  if (p!.startDate === p!.endDate) return dayText(a, true);
  return `${dayText(a, a.getUTCFullYear() !== b.getUTCFullYear())} – ${dayText(b, true)}`;
}

/** "Sun 2 Nov 2026" from an IST calendar date. */
export const dateText = (ymd: string | null | undefined) => { const d = ymd ? civil(ymd) : null; return d ? dayText(d, true) : MISSING; };

export const orderLabel = (o: { orderCode?: string | null; orderId?: string; id?: string }) =>
  o.orderCode || `#${String(o.orderId || o.id || '').slice(-6)}`;

/** Where the store's payout UPI ID is edited (Stores > store > Licences, tax and payout). */
export const storeDetailsHref = (storeId: string) => `/restaurants?store=${encodeURIComponent(storeId)}&tab=compliance`;

/** A fresh retry key for one money action (kept and re-sent on retry, so the server never runs it twice). */
export function newIdempotencyKey(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${rnd}`;
}

export const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
export const errCode = (e: unknown) => (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string' ? (e as { code: string }).code : null);

// ── guard: check every field of the report before showing it ───────────────────────────────────────
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

class Guard {
  flags = new Set<string>();
  num(o: Obj | null | undefined, key: string, where: string): number {
    const v = o ? o[key] : undefined;
    if (ok(v)) return v;
    this.flags.add(`${where}.${key}`);
    return NaN;
  }
  /** A count shown as a number (missing -> NaN, flagged). */
  int(o: Obj | null | undefined, key: string, where: string): number { return this.num(o, key, where); }
  str(o: Obj | null | undefined, key: string, fallback = ''): string {
    const v = o ? o[key] : undefined;
    return typeof v === 'string' ? v : fallback;
  }
  rec<K extends string>(o: Obj | null | undefined, key: string, keys: readonly K[], where: string): Record<K, number> {
    const src = o && isObj(o[key]) ? (o[key] as Obj) : null;
    if (!src) this.flags.add(`${where}.${key}`);
    const out = {} as Record<K, number>;
    for (const k of keys) out[k] = src ? this.num(src, k, `${where}.${key}`) : NaN;
    return out;
  }
}

const CHANNELS = ['cod', 'wallet', 'stall', 'other'] as const;
const SUM_KEYS = [
  'orders', 'collectedPaise', 'refundsPaise', 'itemsPaise', 'commissionPaise', 'deliveryFeesPaise', 'platformFeesPaise', 'packagingFeesPaise',
  'taxesPaise', 'discountsPaise', 'keepsPaise', 'storeSharePaise', 'counterPaidPaise', 'stallCashPaise', 'owedPaise',
  'settledPaise', 'onStatementPaise', 'pendingPaise', 'commissionEstimatedOrders', 'differencePaise',
] as const;

function sums(g: Guard, o: Obj | null, where: string): RevenueSums {
  const out: Partial<RevenueSums> = {};
  for (const k of SUM_KEYS) (out as Record<string, number>)[k] = g.num(o, k, where);
  out.byChannel = g.rec(o, 'byChannel', CHANNELS, where);
  out.ordersByChannel = g.rec(o, 'ordersByChannel', CHANNELS, where);
  out.discounts = g.rec(o, 'discounts', ['coupon', 'perks', 'sharedRide', 'other'] as const, where);
  const nr = o ? o.noRiderOrders : undefined;
  out.noRiderOrders = ok(nr) ? nr : null; // optional: older servers do not send it
  return out as RevenueSums;
}

/**
 * Checks the raw answer of GET /api/admin/revenue. Returns the report with every money field either a real
 * number or NaN, and `flags` naming each field that was missing (shown on the page; settling stays possible
 * because statements are computed again by the server, but the owner is told not to trust the figure).
 * Throws when the answer is not a report at all.
 */
export function normalizeReport(raw: unknown): { report: RevenueReport; flags: string[] } {
  if (!isObj(raw) || !isObj(raw.period) || !isObj(raw.totals)) throw new Error('The server sent an answer the page cannot read. Try again in a minute.');
  const g = new Guard();
  const p = raw.period;
  const period: RevenueReport['period'] = {
    period: (['day', 'week', 'month'].includes(String(p.period)) ? p.period : 'day') as Period,
    label: g.str(p, 'label', MISSING),
    startDate: g.str(p, 'startDate'),
    endDate: g.str(p, 'endDate'),
    start: g.str(p, 'start'),
    end: g.str(p, 'end'),
    prevDate: g.str(p, 'prevDate'),
    nextDate: g.str(p, 'nextDate'),
    isCurrent: p.isCurrent === true,
    isFuture: p.isFuture === true,
    days: ok(p.days) ? p.days : 0,
  };
  const t = raw.totals;
  const totals = { ...sums(g, t, 'totals'), zenweReceivedPaise: g.num(t, 'zenweReceivedPaise', 'totals') };

  const keepsLines: KeepsLine[] = (Array.isArray(raw.keepsLines) ? raw.keepsLines : []).filter(isObj).map((l, i) => ({
    key: g.str(l, 'key', `line${i}`),
    label: g.str(l, 'label', MISSING),
    paise: g.num(l, 'paise', `keepsLines.${i}`),
    sign: l.sign === -1 ? -1 : 1,
  }));
  if (!Array.isArray(raw.keepsLines)) g.flags.add('keepsLines');

  const rc = isObj(raw.reconciliation) ? raw.reconciliation : null;
  if (!rc) g.flags.add('reconciliation');
  const mismatches: Mismatch[] = (rc && Array.isArray(rc.mismatches) ? rc.mismatches : []).filter(isObj).map((m, i) => ({
    orderId: g.str(m, 'orderId'),
    orderCode: g.str(m, 'orderCode') || orderLabel({ orderId: g.str(m, 'orderId') }),
    storeId: g.str(m, 'storeId'),
    storeName: typeof m.storeName === 'string' ? m.storeName : null,
    differencePaise: g.num(m, 'differencePaise', `mismatch.${i}`),
    collectedPaise: g.num(m, 'collectedPaise', `mismatch.${i}`),
    reason: g.str(m, 'reason', ''),
  }));
  const reconciliation: RevenueReport['reconciliation'] = {
    // Only a server that positively said "balanced" counts as balanced.
    ok: !!rc && rc.ok === true,
    collectedLessRefundsPaise: g.num(rc, 'collectedLessRefundsPaise', 'reconciliation'),
    storeSharePlusKeepsPaise: g.num(rc, 'storeSharePlusKeepsPaise', 'reconciliation'),
    differencePaise: g.num(rc, 'differencePaise', 'reconciliation'),
    mismatchedOrders: rc && ok(rc.mismatchedOrders) ? rc.mismatchedOrders : mismatches.length,
    mismatches,
    rule: g.str(rc, 'rule', ''),
  };

  const stores: StoreRow[] = (Array.isArray(raw.stores) ? raw.stores : []).filter(isObj).map((s, i) => {
    const cc = isObj(s.currentCommission) ? s.currentCommission : null;
    const cycle = String(s.settlementCycle || '');
    return {
      ...sums(g, s, `stores.${i}`),
      storeId: g.str(s, 'storeId'),
      name: g.str(s, 'name', 'Unnamed store'),
      kind: s.kind === 'vendor' ? 'vendor' : 'restaurant',
      vendorType: typeof s.vendorType === 'string' ? s.vendorType : null,
      isActive: s.isActive !== false,
      settlementCycle: (CYCLES.some(c => c.value === cycle) ? cycle : 'weekly') as Cycle,
      payoutUpiId: typeof s.payoutUpiId === 'string' && s.payoutUpiId.trim() ? s.payoutUpiId.trim() : null,
      payment: paymentOf(s.payment, typeof s.payoutUpiId === 'string' ? s.payoutUpiId : null),
      currentCommission: cc ? { rate: ok(cc.rate) ? cc.rate : NaN, type: cc.type === 'flat' ? 'flat' : 'percentage' } : null,
      ratesAtOrderTime: Array.isArray(s.ratesAtOrderTime) ? (s.ratesAtOrderTime as unknown[]).filter(isObj).map(r => ({ type: r.type === 'flat' ? 'flat' as const : 'percentage' as const, rate: ok(r.rate) ? r.rate : NaN })) : [],
      effectiveCommissionPct: g.num(s, 'effectiveCommissionPct', `stores.${i}`),
    };
  });
  if (!Array.isArray(raw.stores)) g.flags.add('stores');

  // The chart is secondary: a missing day value is drawn as 0 but still flagged.
  const series: SeriesDay[] = (Array.isArray(raw.series) ? raw.series : []).filter(isObj).map((d, i) => {
    const n = (k: string) => { const v = g.num(d, k, `series.${i}`); return ok(v) ? v : 0; };
    return { date: g.str(d, 'date'), label: g.str(d, 'label', ''), orders: n('orders'), collectedPaise: n('collectedPaise'), keepsPaise: n('keepsPaise'), owedPaise: n('owedPaise'), commissionPaise: n('commissionPaise') };
  });

  const ce = isObj(raw.commissionEstimated) ? raw.commissionEstimated : null;
  const nr = isObj(raw.noRider) ? raw.noRider : null;
  const ctx = isObj(raw.context) ? raw.context : null;
  const report: RevenueReport = {
    period,
    storeId: typeof raw.storeId === 'string' ? raw.storeId : null,
    totals,
    keepsLines,
    reconciliation,
    stores,
    series,
    excluded: { testOrders: isObj(raw.excluded) && ok(raw.excluded.testOrders) ? raw.excluded.testOrders : 0 },
    commissionEstimated: {
      orders: ce && ok(ce.orders) ? ce.orders : 0,
      sample: (ce && Array.isArray(ce.sample) ? ce.sample : []).filter(isObj).map(x => ({ orderId: g.str(x, 'orderId'), orderCode: g.str(x, 'orderCode') })),
    },
    noRider: nr ? {
      orders: ok(nr.orders) ? nr.orders : 0,
      sample: (Array.isArray(nr.sample) ? nr.sample : []).filter(isObj).map(x => ({
        orderId: g.str(x, 'orderId'), orderCode: g.str(x, 'orderCode') || orderLabel({ orderId: g.str(x, 'orderId') }),
        storeName: typeof x.storeName === 'string' ? x.storeName : null,
        channel: (CHANNELS as readonly string[]).includes(String(x.channel)) ? x.channel as Channel : 'other',
        deliveryFeePaise: ok(x.deliveryFeePaise) ? x.deliveryFeePaise : NaN,
      })),
    } : null,
    context: { riderCashHeldNowPaise: ctx && ok(ctx.riderCashHeldNowPaise) ? ctx.riderCashHeldNowPaise : null },
    generatedAt: g.str(raw, 'generatedAt'),
  };
  return { report, flags: [...g.flags] };
}

/** Checks a settle preview; throws when it is not usable (settling from a half-read preview is never allowed). */
export function checkPreview(raw: unknown): SettlePreview {
  if (!isObj(raw) || !Array.isArray(raw.stores) || !isObj(raw.totals) || typeof raw.cutoff !== 'string') {
    throw new Error('The server sent a settle preview the page cannot read. Refresh and try again.');
  }
  const bad = (raw.stores as unknown[]).some(s => !isObj(s) || typeof s.storeId !== 'string' || !Number.isSafeInteger(s.orderCount) || !Number.isSafeInteger(s.netPaise));
  const t = raw.totals as Obj;
  if (bad || !['stores', 'orders', 'netPaise', 'zenwePaysPaise', 'storesPayZenwePaise'].every(k => Number.isSafeInteger(t[k]))) {
    throw new Error('Some amounts in the settle preview are missing. Nothing can be settled until it loads correctly. Refresh and try again.');
  }
  const p = raw as unknown as SettlePreview;
  return {
    ...p,
    stores: p.stores.map(s => ({ ...s, payment: paymentOf(s.payment, s.payoutUpiId) })),
    pendingStatements: (Array.isArray(p.pendingStatements) ? p.pendingStatements.filter(s => isObj(s) && typeof s.id === 'string') : [])
      .map(s => ({ ...s, payment: paymentOf(s.payment, s.payoutUpiId) })),
  };
}
