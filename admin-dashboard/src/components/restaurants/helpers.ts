import type { OperatingHours } from '@/app/restaurants/catalogue';
import { formatTime } from '@/app/restaurants/catalogue';
import { uploadImage } from '@/lib/api';

// ─── Weekly hours ────────────────────────────────────────────────────────────
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = typeof DAYS[number];
export const DAY_LABEL: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const DAY_SHORT: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export interface DayHours { open: boolean; start: string; end: string }
export type Weekly = Record<DayKey, DayHours>;

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

export const uniformWeekly = (start = '09:00', end = '22:00'): Weekly =>
  DAYS.reduce((acc, d) => ({ ...acc, [d]: { open: true, start, end } }), {} as Weekly);

export function weeklyFromStore(oh?: OperatingHours | null): Weekly {
  const start = pad(oh?.start || '') || '09:00';
  const end = pad(oh?.end || '') || '22:00';
  const base = uniformWeekly(start, end);
  const weekly = oh?.weekly;
  if (!weekly || typeof weekly !== 'object') return base;
  for (const d of DAYS) {
    const w = weekly[d];
    if (!w) continue;
    base[d] = { open: w.open !== false, start: pad(w.start || '') || start, end: pad(w.end || '') || end };
  }
  return base;
}

/** True when every day is open with the same window (then only { start, end } is sent). */
export const isUniform = (w: Weekly) => {
  const first = w.mon;
  return DAYS.every(d => w[d].open && w[d].start === first.start && w[d].end === first.end);
};

/** Most common open window: the value sent as the store's daily operatingHours. */
export function primaryWindow(w: Weekly): { start: string; end: string } {
  const counts = new Map<string, number>();
  for (const d of DAYS) if (w[d].open) counts.set(`${w[d].start}-${w[d].end}`, (counts.get(`${w[d].start}-${w[d].end}`) || 0) + 1);
  const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!best) return { start: w.mon.start, end: w.mon.end };
  const [start, end] = best[0].split('-');
  return { start, end };
}

export function operatingHoursPayload(w: Weekly): OperatingHours {
  const { start, end } = primaryWindow(w);
  if (isUniform(w)) return { start, end };
  return { start, end, weekly: DAYS.reduce((acc, d) => ({ ...acc, [d]: { ...w[d] } }), {}) };
}

export function validateWeekly(w: Weekly): string | null {
  if (!DAYS.some(d => w[d].open)) return 'Open the store on at least one day.';
  for (const d of DAYS) {
    if (!w[d].open) continue;
    if (!HHMM.test(w[d].start) || !HHMM.test(w[d].end)) return `${DAY_LABEL[d]}: enter both opening and closing times.`;
  }
  return null;
}

const windowText = (h: DayHours) => h.start === h.end ? 'Open 24 hours' : `${formatTime(h.start)} – ${formatTime(h.end)}${toMin(h.end) < toMin(h.start) ? ' (next day)' : ''}`;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** "Every day 9:00 AM – 10:00 PM" or "Mon–Fri 9:00 AM – 10:00 PM · Sat 10:00 AM – 2:00 PM · Sun closed". */
export function summarizeWeekly(w: Weekly): string {
  if (isUniform(w)) return w.mon.start === w.mon.end ? 'Open 24 hours, every day' : `Every day, ${windowText(w.mon)}`;
  const groups: { from: DayKey; to: DayKey; text: string }[] = [];
  for (const d of DAYS) {
    const text = w[d].open ? windowText(w[d]) : 'closed';
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  return groups.map(g => `${g.from === g.to ? DAY_SHORT[g.from] : `${DAY_SHORT[g.from]}–${DAY_SHORT[g.to]}`} ${g.text}`).join(' · ');
}

/** Open right now (IST) by these hours. Mirrors backend utils/storeHours.js (+ per-day). */
export function isOpenByHours(w: Weekly, now = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const todayIdx = (ist.getUTCDay() + 6) % 7; // 0 = Monday
  const today = w[DAYS[todayIdx]];
  const yesterday = w[DAYS[(todayIdx + 6) % 7]];
  if (today.open) {
    const s = toMin(today.start); const e = toMin(today.end);
    if (s === e) return true;
    if (s < e ? minutes >= s && minutes < e : minutes >= s) return true;
  }
  if (yesterday.open) {
    const s = toMin(yesterday.start); const e = toMin(yesterday.end);
    if (e < s && minutes < e) return true; // overnight spill-over
  }
  return false;
}

// ─── Map links ───────────────────────────────────────────────────────────────
export type GeoResult = { lat: number; lon: number } | { error: string };

/** Reads coordinates from a Google / Apple / OSM maps link or a "lat, lng" pair. */
export function parseMapLink(raw: string): GeoResult {
  const text = decodeURIComponentSafe(String(raw || '').trim());
  if (!text) return { error: 'Paste a maps link or coordinates first.' };
  if (/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(text)) {
    return { error: 'Short share links cannot be read here. Open the link in your browser, then copy the full address-bar URL (it contains @lat,lng) and paste that.' };
  }
  const patterns = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, // place pin (most precise)
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // map centre
    /[?&](?:q|query|ll|sll|destination|daddr|center|mlat)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /[?&]mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/, // openstreetmap
    /#map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/, // openstreetmap
    /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/, // plain pair
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat: round6(lat), lon: round6(lon) };
  }
  return { error: 'No coordinates found. Use a full Google Maps link (with @lat,lng) or type them like 16.4632, 80.5064.' };
}

const decodeURIComponentSafe = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export const mapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

// ─── Images: resize in the browser, then upload ──────────────────────────────
// resizeImage now lives in lib/imageResize.ts (shared with uploadImage); re-exported for existing imports.
export { resizeImage } from '@/lib/imageResize';
import { resizeImage } from '@/lib/imageResize';

export const IMAGE_PRESETS = {
  cover: { maxW: 1280, maxH: 720, crop: true },
  logo: { maxW: 400, maxH: 400, crop: true, keepAlpha: true },
  item: { maxW: 800, maxH: 800, crop: true },
} as const;

export async function resizeAndUpload(file: File, preset: keyof typeof IMAGE_PRESETS): Promise<string> {
  const resized = await resizeImage(file, IMAGE_PRESETS[preset]);
  return uploadImage(resized);
}

// ─── Passwords ───────────────────────────────────────────────────────────────
/** 12-char password from an unambiguous alphabet with upper, lower, digit and symbol. */
export function generatePassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*+=?';
  const all = upper + lower + digits + symbols;
  const rand = (n: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const chars = [upper[rand(upper.length)], lower[rand(lower.length)], digits[rand(digits.length)], symbols[rand(symbols.length)]];
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: 'Not set' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 6) return { score: 0, label: 'Too short (min 6)' };
  if (s <= 1) return { score: 1, label: 'Weak' };
  if (s <= 3) return { score: 2, label: 'OK' };
  return { score: 3, label: 'Strong' };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────
/** RFC-4180-ish parser: quotes, escaped quotes, commas / tabs (pasted from Sheets) and newlines. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(v => v.trim())).filter(r => r.some(v => v !== ''));
}

export const timeAgo = (iso?: string | null) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** YYYY-MM-DD of a date in IST. */
export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
