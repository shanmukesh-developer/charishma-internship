/**
 * Shared display formatters for the customer app.
 *
 * - Money: Indian digit grouping (₹1,23,456), no float noise (₹59.7, never ₹59.699999),
 *   paise only when there are paise.
 * - Dates and times: always India time (Asia/Kolkata, UTC+5:30, no DST).
 *
 * Everything is computed by hand instead of through Intl so the output is the same on
 * Hermes (Android / iOS) and on web, whatever the phone's own locale or time zone is.
 * None of these ever return "undefined", "NaN" or "null".
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Group the integer part the Indian way: 1234567 -> "12,34,567". */
const groupIN = (digits: string) => {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
};

const toNumber = (n: unknown): number | null => {
  if (n === null || n === undefined || n === '') return null;
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : null;
};

/** True when the value is a real, finite amount (use it to hide a line instead of showing ₹0). */
export const isAmount = (n: unknown) => toNumber(n) !== null;

/**
 * ₹ with en-IN grouping. 1299 -> "₹1,299", 12.5 -> "₹12.50", 59.699999 -> "₹59.70".
 * Negative amounts get a real minus sign: "−₹40". Missing / invalid values -> "₹0".
 * `paise: 'never'` rounds to whole rupees.
 */
export function formatINR(n: unknown, opts: { paise?: 'auto' | 'never' } = {}): string {
  const v = toNumber(n) ?? 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  let rupees: number;
  let paise: number;
  if (opts.paise === 'never') {
    rupees = Math.round(abs);
    paise = 0;
  } else {
    const totalPaise = Math.round(abs * 100);
    rupees = Math.floor(totalPaise / 100);
    paise = totalPaise % 100;
  }
  const body = groupIN(String(rupees)) + (paise ? `.${String(paise).padStart(2, '0')}` : '');
  return `${neg && (rupees || paise) ? '−' : ''}₹${body}`;
}

/** Plain number with en-IN grouping (ZenPoints, counts). Invalid -> "0". */
export function formatCount(n: unknown): string {
  const v = Math.round(toNumber(n) ?? 0);
  return `${v < 0 ? '−' : ''}${groupIN(String(Math.abs(v)))}`;
}

/** "1 item" / "3 items". Pass the plural when it is not just word + "s". */
export function plural(n: unknown, one: string, many?: string): string {
  const v = toNumber(n) ?? 0;
  return `${formatCount(v)} ${v === 1 ? one : (many ?? `${one}s`)}`;
}

/**
 * Breaks a date into its India-time parts. Accepts an ISO instant, a Date, a timestamp,
 * or a calendar date "YYYY-MM-DD" (treated as that day, not as UTC midnight).
 */
function istParts(input: unknown) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(dt.getTime())) return null;
    return { y, mo: m - 1, d, wd: dt.getUTCDay(), h: 0, mi: 0 };
  }
  const t = input instanceof Date ? input.getTime() : new Date(input as any).getTime();
  if (!Number.isFinite(t)) return null;
  const s = new Date(t + IST_OFFSET_MS);
  return { y: s.getUTCFullYear(), mo: s.getUTCMonth(), d: s.getUTCDate(), wd: s.getUTCDay(), h: s.getUTCHours(), mi: s.getUTCMinutes() };
}

/** Current hour (0-23) in India. */
export const istHour = (at: Date = new Date()) => istParts(at)?.h ?? at.getHours();

/** "6:00 AM" from hours / minutes. */
const clock = (h: number, mi: number) => `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;

/** "06:00" / "18:30" (server clock strings) -> "6:00 AM" / "6:30 PM". Returns the input unchanged if it is not HH:MM. */
export function formatClock(hhmm: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return String(hhmm ?? '');
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return String(hhmm);
  return clock(h, mi);
}

/** "21 Oct", or "21 Oct 2026" with `year`, or "Tue 21 Oct" with `weekday`. Invalid -> "". */
export function formatISTDate(input: unknown, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const p = istParts(input);
  if (!p) return '';
  return `${opts.weekday ? `${DAYS[p.wd]} ` : ''}${p.d} ${MONTHS[p.mo]}${opts.year ? ` ${p.y}` : ''}`;
}

/** "4:30 PM" in India time. Invalid -> "". */
export function formatISTTime(input: unknown): string {
  const p = istParts(input);
  return p ? clock(p.h, p.mi) : '';
}

/** "21 Oct, 4:30 PM" in India time (adds the year when it is not this year). Invalid -> "". */
export function formatISTDateTime(input: unknown, opts: { year?: boolean } = {}): string {
  const p = istParts(input);
  if (!p) return '';
  const now = istParts(new Date());
  const showYear = opts.year ?? (now ? now.y !== p.y : false);
  return `${p.d} ${MONTHS[p.mo]}${showYear ? ` ${p.y}` : ''}, ${clock(p.h, p.mi)}`;
}
