/**
 * Live open / closed state for a store card, from the same rules as the backend (utils/storeHours.js):
 * the store's own switches first, then its operating hours in India time (weekly hours, or one daily
 * start / end, overnight windows allowed). The server's isOpen is only right at the moment it was
 * fetched, so a list loaded at 8:55 PM must still flip to "Closed" at 9:00 PM without a refetch.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const toMinutes = (hhmm: any): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return (h * 60 + min) % (24 * 60);
};

const parseHours = (v: any) => {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v && typeof v === 'object' ? v : null;
};

type Day = { open: boolean; start: number; end: number; startText: string; endText: string };

const readDay = (d: any): Day | null => {
  if (!d || typeof d !== 'object' || d.open === false) return null;
  const start = toMinutes(d.start);
  const end = toMinutes(d.end);
  if (start === null || end === null) return null;
  return { open: true, start, end, startText: String(d.start), endText: String(d.end) };
};

const inWindow = (day: Day | null, nowMin: number) => {
  if (!day) return false;
  if (day.start === day.end) return true;
  return day.start < day.end ? nowMin >= day.start && nowMin < day.end : nowMin >= day.start;
};

export type LiveOpenState = { isOpen: boolean; opensAt: string | null; closesAt: string | null };

export function liveOpenState(store: any, now: Date = new Date()): LiveOpenState {
  const serverState: LiveOpenState = {
    isOpen: store?.isOpen !== false,
    opensAt: typeof store?.opensAt === 'string' ? store.opensAt : null,
    closesAt: typeof store?.closesAt === 'string' ? store.closesAt : null,
  };
  if (!store || store.isActive === false || store.isOffline === true) return { ...serverState, isOpen: false };
  const hours = parseHours(store.operatingHours);
  // Closed by the store's own switch: stays closed until the store opens it again.
  if (store.isOpenNow === false) return { isOpen: false, opensAt: serverState.opensAt || (hours?.start ? String(hours.start) : null), closesAt: null };
  if (!hours) return serverState;

  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const today = (ist.getUTCDay() + 6) % 7;

  const weeklyRaw = hours.weekly && typeof hours.weekly === 'object' ? hours.weekly : null;
  const weekly = weeklyRaw ? DAY_KEYS.map((k) => readDay(weeklyRaw[k])) : null;
  if (weekly && weekly.some(Boolean)) {
    const day = weekly[today];
    const prev = weekly[(today + 6) % 7];
    if (prev && prev.start !== prev.end && prev.end < prev.start && nowMin < prev.end) return { isOpen: true, opensAt: null, closesAt: prev.endText };
    if (inWindow(day, nowMin)) return { isOpen: true, opensAt: null, closesAt: day && day.start !== day.end ? day.endText : null };
    if (day && nowMin < day.start) return { isOpen: false, opensAt: day.startText, closesAt: null };
    for (let i = 1; i <= 7; i++) {
      const d = weekly[(today + i) % 7];
      if (d) return { isOpen: false, opensAt: d.startText, closesAt: null };
    }
    return { isOpen: false, opensAt: null, closesAt: null };
  }

  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (start === null || end === null || start === end) return serverState; // no hours / open 24 h
  const open = start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
  return open
    ? { isOpen: true, opensAt: null, closesAt: String(hours.end) }
    : { isOpen: false, opensAt: String(hours.start), closesAt: null };
}

/**
 * Delivery slots (server utils/deliverySlots.js slotListingFields): a store that is closed right now can still
 * take an order for its next delivery slot (takesSlotOrders, with nextSlotLabel "Today 4:30–5:30 PM").
 * The server re-checks the slot at checkout, so this only decides whether Add is offered.
 */
export const takesSlotOrders = (store: any): boolean =>
  !!store && store.isActive !== false && store.isOffline !== true && store.takesSlotOrders === true;
