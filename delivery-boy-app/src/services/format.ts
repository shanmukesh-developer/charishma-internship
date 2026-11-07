// Money, IST day keys and relative times.
import { serverNow } from './serverClock';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** ₹ with paise only when there are any ("₹124", "₹123.50"): cash to collect must match the customer's bill exactly. */
export function rupees(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const paise = Math.round(n * 100);
  const opts = paise % 100 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `₹${(paise / 100).toLocaleString('en-IN', opts)}`;
}

/** YYYY-MM-DD of the IST calendar day. */
export function istDayKey(d: Date | string | number): string {
  const t = new Date(d).getTime();
  // An unparseable server date must not throw (toISOString on an invalid Date is a RangeError).
  if (!Number.isFinite(t)) return 'unknown';
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayKey(): string {
  return istDayKey(Date.now());
}

export function lastNDayKeys(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(istDayKey(Date.now() - i * 86400000));
  return out;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function partsOfKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return { weekday: WEEKDAYS[date.getUTCDay()], day: d, month: MONTHS[m - 1] };
}

export function dayLabel(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'Earlier';
  if (key === todayKey()) return 'Today';
  if (key === istDayKey(Date.now() - 86400000)) return 'Yesterday';
  const p = partsOfKey(key);
  return `${p.weekday} ${p.day} ${p.month}`;
}

export function shortWeekday(key: string): string {
  return partsOfKey(key).weekday;
}

/** hh:mm in IST, e.g. "7:05 PM". */
export function timeIST(d: string | number | Date | null | undefined): string {
  if (d === null || d === undefined) return '—';
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return '—';
  const ist = new Date(t + IST_OFFSET_MS);
  let h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function minutesAgo(d: string | null | undefined): string | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  // Server time: the order times are server times (a phone clock minutes off made orders look late / new).
  const mins = Math.max(0, Math.round((serverNow() - t) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min ago`;
}

export function km(n: number): string {
  return n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1)} km`;
}

/** Exact money for statements: "₹1,234" or "₹1,234.50" (en-IN grouping). */
export function rupeesExact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const neg = n < 0;
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const body = Number.isInteger(abs)
    ? abs.toLocaleString('en-IN')
    : abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? '−' : ''}₹${body}`;
}

/** "21 Oct 2026" for an ISO date / time (IST calendar day). */
export function dateIST(d: string | number | Date | null | undefined): string {
  if (d === null || d === undefined) return '—';
  const key = istDayKey(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '—';
  const [y, m, day] = key.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/** "14 Oct" for a YYYY-MM-DD key. */
export function shortDate(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const p = partsOfKey(key);
  return `${p.day} ${p.month}`;
}
