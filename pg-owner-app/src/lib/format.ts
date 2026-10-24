// Display helpers (IST, Indian rupees). Pure functions, no React Native imports.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const IST_MS = 330 * 60 * 1000;

/** ₹7,500 (whole rupees, Indian grouping). */
export function rupees(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${v < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}

/** 'YYYY-MM-DD' -> '24 Oct 2026' (calendar date, no time zone shift). */
export function dateLabel(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** ISO time -> '24 Oct, 3:05 pm' in IST. */
export function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + IST_MS);
  let h = d.getUTCHours();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${ap}`;
}

/** '3 min ago' / '5 h ago' / '24 Oct'. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(t + IST_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'YYYY-MM' -> 'October 2026'. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : month;
}

/** 'YYYY-MM' + n months. */
export function shiftMonth(month: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const istToday = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);
export const istMonth = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 7);

/** 'YYYY-MM-DD' + n days. */
export function shiftDay(ymd: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}

/** '6 months' / '1 month'. */
export const monthsLabel = (n: number | null | undefined) => (n ? `${n} month${n === 1 ? '' : 's'}` : '');

/** "HH:MM" 24 h -> "7:30 am". */
export function timeLabel(hhmm: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

/** Loose "7:30", "0730", "19:30" -> "07:30"; null when it is not a time. */
export function normaliseTime(input: string): string | null {
  const s = String(input || '').trim().replace('.', ':');
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
