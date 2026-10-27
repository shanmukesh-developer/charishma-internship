// Delivery slots (server: backend/utils/deliverySlots.js). Every delivery order (food, store, stall, shopping
// list) arrives in one of three daily slots (IST): 12:30–1:00 PM, 4:30–5:30 PM, 8:30–9:30 PM. Booking closes
// 1 hour before the slot start (cakes 2 hours, specialized cakes 2½ hours). Today's open slots and all of
// tomorrow's can be picked. The server owns the rules; this file only types and formats what it sends.

export interface DeliverySlot {
  /** 'YYYY-MM-DD|S1': what the order sends back as deliverySlot. */
  id: string;
  date: string;
  slot: string;
  day: 'today' | 'tomorrow';
  startISO: string;
  endISO: string;
  /** 'Today 12:30–1:00 PM' */
  label: string;
  /** '12:30–1:00 PM' */
  timeLabel: string;
  /** 'Tue 27 Oct, 12:30–1:00 PM' */
  deliveryLabel: string;
  closesAtISO: string;
  /** '11:30 AM' */
  closesAtLabel: string;
  open: boolean;
  closedReason?: 'cutoff' | 'store_closed';
  /** 'Closed at 11:30 AM' / '<Store> is closed then' */
  closedText?: string;
}

export interface DeliverySlotsInfo {
  enabled?: boolean;
  leadMinutes: number;
  leadKind?: 'standard' | 'cake' | 'specializedCake';
  /** 'Cakes need 2 hours' / 'This cake needs 2½ hours' (null for the standard hour). */
  leadReason: string | null;
  slots: DeliverySlot[];
  nextSlot: DeliverySlot | null;
  defaultSlotId: string | null;
}

/** The pick to keep: the current one while it is still open, else the earliest open slot. */
export const pickSlot = (info: DeliverySlotsInfo | null | undefined, current: string | null): string | null => {
  if (!info || !Array.isArray(info.slots)) return null;
  if (current && info.slots.some((s) => s.id === current && s.open)) return current;
  return info.defaultSlotId || info.slots.find((s) => s.open)?.id || null;
};

const IST_MS = 330 * 60 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (d: Date) => {
  const s = new Date(d.getTime() + IST_MS);
  return { h: s.getUTCHours(), m: s.getUTCMinutes(), dow: s.getUTCDay(), day: s.getUTCDate(), mon: s.getUTCMonth() };
};
const hm = (h: number, m: number) => `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
const ap = (h: number) => (h >= 12 ? 'PM' : 'AM');

/** "Tue 27 Oct, 12:30–1:00 PM" (IST) from a slot window; null when the dates are missing or invalid. */
export const slotWindowLabel = (start?: string | null, end?: string | null): string | null => {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null;
  const p = parts(a);
  const q = parts(b);
  const range = ap(p.h) === ap(q.h) ? `${hm(p.h, p.m)}–${hm(q.h, q.m)} ${ap(q.h)}` : `${hm(p.h, p.m)} ${ap(p.h)}–${hm(q.h, q.m)} ${ap(q.h)}`;
  return `${DOW[p.dow]} ${p.day} ${MON[p.mon]}, ${range}`;
};

/** "Tue 27 Oct, 12:30–1:00 PM" for an order with a slot; null for older 'ASAP' orders. */
export const orderSlotLabel = (o: { deliverySlot?: string | null; slotStart?: string | null; slotEnd?: string | null } | null | undefined): string | null => {
  if (!o) return null;
  const fromWindow = slotWindowLabel(o.slotStart, o.slotEnd);
  if (fromWindow) return fromWindow;
  const s = String(o.deliverySlot || '').trim();
  // A bare slot id ("2026-10-27|S1") is never shown raw.
  const id = /^(\d{4})-(\d{2})-(\d{2})\|S([123])$/.exec(s);
  if (id) {
    const day = new Date(Date.UTC(+id[1], +id[2] - 1, +id[3], 6));
    const date = day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    return `${date}, ${['12:30–1:00 PM', '4:30–5:30 PM', '8:30–9:30 PM'][+id[4] - 1]}`;
  }
  return s && !/^asap$/i.test(s) ? s : null;
};

/** "11:37 AM" (IST), with " tomorrow" / " on Wed 28 Oct" when it is not today (IST). */
export const istClockLabel = (ms: number, nowMs: number = Date.now()): string => {
  const d = new Date(ms);
  const p = parts(d);
  const dayKey = (x: number) => new Date(x + IST_MS).toISOString().slice(0, 10);
  const today = dayKey(nowMs);
  const tomorrow = dayKey(nowMs + 24 * 60 * 60 * 1000);
  const clock = `${hm(p.h, p.m)} ${ap(p.h)}`;
  const k = dayKey(ms);
  if (k === today) return clock;
  if (k === tomorrow) return `${clock} tomorrow`;
  return `${clock} on ${DOW[p.dow]} ${p.day} ${MON[p.mon]}`;
};
