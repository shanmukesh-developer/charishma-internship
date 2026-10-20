/**
 * Display formatting used across the admin: Indian rupees with en-IN grouping, and every date/time in
 * IST (Asia/Kolkata) whatever the admin's computer is set to. Each helper accepts loose input (API
 * strings, numbers, null) and returns '–' for missing or invalid values so tables never show NaN.
 */

export const IST = 'Asia/Kolkata';
export const EMPTY = '–';

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
};

const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/**
 * ₹1,23,456 (whole rupees) or ₹1,23,456.50 when the amount has paise (or `paise: true`).
 * Already formatted server strings such as "₹1,200" are passed through unchanged.
 */
export function formatINR(value: unknown, opts: { paise?: boolean } = {}): string {
  if (typeof value === 'string' && value.trim().startsWith('₹')) return value.trim();
  const n = toNum(value);
  if (n === null) return EMPTY;
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return (opts.paise || hasPaise ? inrPaise : inrWhole).format(n);
}

/** 1,23,456 with en-IN grouping. */
export function formatNumber(value: unknown): string {
  const n = toNum(value);
  return n === null ? EMPTY : num.format(n);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true });
const yearFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, year: 'numeric' });

const lowerAmPm = (s: string) => s.replace(/\s?(AM|PM|am|pm)/, (_m, p: string) => ` ${p.toLowerCase()}`);

/** 19 Oct 2026 (IST). */
export function formatDate(value: unknown): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : EMPTY;
}

/** 3:45 pm (IST). */
export function formatTime(value: unknown): string {
  const d = toDate(value);
  return d ? lowerAmPm(timeFmt.format(d)) : EMPTY;
}

/** 19 Oct 2026, 3:45 pm (IST). The year is dropped for dates in the current year when `short` is set. */
export function formatDateTime(value: unknown, opts: { short?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  const sameYear = yearFmt.format(d) === yearFmt.format(new Date());
  const day = opts.short && sameYear ? dateShortFmt.format(d) : dateFmt.format(d);
  return `${day}, ${lowerAmPm(timeFmt.format(d))}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the IST date. */
export function formatRelative(value: unknown): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  const diff = Date.now() - d.getTime();
  if (diff < 0) return formatDateTime(d, { short: true });
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'yesterday';
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} days ago`;
  return formatDate(d);
}

/** Short order/booking reference: last 6 characters, upper case, e.g. #A1B2C3. */
export function shortId(id: unknown): string {
  if (id === null || id === undefined || id === '') return '';
  return `#${String(id).slice(-6).toUpperCase()}`;
}

/** Phone shown as 98765 43210 (last 10 digits); '–' when empty. */
export function formatPhone(value: unknown): string {
  if (!value) return EMPTY;
  const digits = String(value).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return String(value);
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * Sentence case for server enums and labels: 'OUT_FOR_DELIVERY' -> 'Out for delivery',
 * 'pending' -> 'Pending', 'Picked Up' -> 'Picked up'. Acronyms such as COD, UPI, PG, OTP, ID stay upper case.
 */
const KEEP_UPPER = new Set(['COD', 'UPI', 'PG', 'OTP', 'ID', 'GST', 'GSTIN', 'FSSAI', 'PAN', 'IFSC', 'SOS', 'QR', 'KYC', 'UTR', 'SMS', 'API', 'URL', 'CSV', 'AC', 'EV', 'SRM', 'AP']);
export function humanize(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const words = String(value).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/);
  return words
    .map((w, i) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up)) return up;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/** "1 order" / "3 orders". */
export function plural(n: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${formatNumber(n)} ${n === 1 ? noun : pluralNoun}`;
}
