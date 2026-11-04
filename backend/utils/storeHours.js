// Real open/closed state for a store, from the vendor's own switches and operating hours (IST).

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Resolved once (P1): a require() inside getStoreOpenState ran module resolution (fs stats) for every
// store / item of every listing build.
let vendorTypesMod = null;
const vendorTypes = () => vendorTypesMod || (vendorTypesMod = require('./vendorTypes'));

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return (h * 60 + min) % (24 * 60);
};

const formatTime = (hhmm) => {
  const mins = toMinutes(hhmm);
  if (mins === null) return hhmm;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

const istMinutesNow = (now = new Date()) => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

const readHours = (restaurant) => {
  let hours = restaurant && (typeof restaurant.get === 'function' ? restaurant.get('operatingHours') : restaurant.operatingHours);
  if (typeof hours === 'string') {
    try { hours = JSON.parse(hours); } catch { hours = null; }
  }
  return hours && typeof hours === 'object' ? hours : null;
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
// IST weekday index, mon = 0 … sun = 6.
const istDayIndex = (now = new Date()) => (new Date(now.getTime() + IST_OFFSET_MS).getUTCDay() + 6) % 7;

// Per-day hours: operatingHours.weekly = { mon: { open, start, end }, … }. Null when absent / unusable.
const readWeekly = (hours) => {
  const w = hours && hours.weekly;
  if (!w || typeof w !== 'object') return null;
  const out = {};
  let any = false;
  for (const k of DAY_KEYS) {
    const d = w[k];
    if (!d || typeof d !== 'object') { out[k] = { open: false }; continue; }
    const start = toMinutes(d.start);
    const end = toMinutes(d.end);
    const open = d.open !== false && start !== null && end !== null;
    out[k] = open ? { open: true, start, end, startText: d.start, endText: d.end } : { open: false };
    if (open) any = true;
  }
  return any ? out : null;
};

// Is `nowMin` inside a day's window? start===end means all day. Overnight windows spill past midnight.
const inWindow = (day, nowMin) => {
  if (!day || !day.open) return false;
  if (day.start === day.end) return true;
  return day.start < day.end ? (nowMin >= day.start && nowMin < day.end) : nowMin >= day.start;
};
const spillsInto = (prevDay, nowMin) => !!prevDay && prevDay.open && prevDay.start !== prevDay.end
  && prevDay.end < prevDay.start && nowMin < prevDay.end;

const weeklyOpenState = (weekly, name, now) => {
  const today = istDayIndex(now);
  const nowMin = istMinutesNow(now);
  const day = weekly[DAY_KEYS[today]];
  const prev = weekly[DAY_KEYS[(today + 6) % 7]];
  if (spillsInto(prev, nowMin)) return { isOpen: true, closesAt: prev.endText };
  if (inWindow(day, nowMin)) return { isOpen: true, ...(day.start !== day.end ? { closesAt: day.endText } : {}) };
  // Next opening: later today, else the next open day.
  if (day && day.open && nowMin < day.start) {
    return { isOpen: false, reason: 'outside_hours', opensAt: day.startText, message: `${name} is closed right now — it opens at ${formatTime(day.startText)}.` };
  }
  for (let i = 1; i <= 7; i++) {
    const key = DAY_KEYS[(today + i) % 7];
    const d = weekly[key];
    if (d && d.open) {
      const when = i === 1 ? 'tomorrow' : `on ${DAY_NAMES[key]}`;
      return { isOpen: false, reason: 'outside_hours', opensAt: d.startText, opensOn: key, message: `${name} is closed right now — it opens ${when} at ${formatTime(d.startText)}.` };
    }
  }
  return { isOpen: false, reason: 'outside_hours', message: `${name} is closed right now.` };
};

// → { isOpen, reason?, opensAt?, closesAt?, message? }
const getStoreOpenState = (restaurant, now = new Date()) => {
  if (!restaurant) return { isOpen: false, reason: 'not_found', message: 'This store is no longer on ZENV.' };
  const name = restaurant.name || 'This store';
  if (restaurant.isActive === false) {
    return { isOpen: false, reason: 'inactive', message: `${name} is not taking orders right now.` };
  }
  // A CampusBites stall marked offline by Zenvy takes no orders (the quote refuses it): every screen that
  // shows its open state (stall page, vendor app, store detail) must say so too, not "open".
  // (For a restaurant isOffline means "rider buys at the counter" and changes nothing here.)
  if (restaurant.isOffline === true && vendorTypes().isLocalVendorStore(restaurant)) {
    return { isOpen: false, reason: 'offline', message: `${name} is not taking orders on ZENV right now.` };
  }
  const hours = readHours(restaurant);
  const start = hours ? toMinutes(hours.start) : null;
  const end = hours ? toMinutes(hours.end) : null;
  if (restaurant.isOpenNow === false) {
    return {
      isOpen: false,
      reason: 'closed_by_store',
      ...(hours && hours.start ? { opensAt: hours.start } : {}),
      message: `${name} is closed right now. Please check back a little later.`
    };
  }
  const weekly = readWeekly(hours);
  if (weekly) return weeklyOpenState(weekly, name, now);
  if (start === null || end === null || start === end) return { isOpen: true }; // no hours / open 24h

  const nowMin = istMinutesNow(now);
  const open = start < end ? (nowMin >= start && nowMin < end) : (nowMin >= start || nowMin < end); // overnight
  if (open) return { isOpen: true, closesAt: hours.end };
  return {
    isOpen: false,
    reason: 'outside_hours',
    opensAt: hours.start,
    message: `${name} is closed right now — it opens at ${formatTime(hours.start)}.`
  };
};

// Campus-wide ordering window (production only): no orders 9 PM – 6 AM IST.
// With delivery slots (utils/deliverySlots, the default) ordering stays open at night: an order placed now is
// delivered in the next open slot, so the window only reports night: true and the next slot (older app builds
// read open: true and place their 'ASAP' order, which the server puts in that slot). DELIVERY_SLOTS=off brings
// the old closure back.
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;
const getCampusServiceability = (now = new Date()) => {
  const isProduction = require('./env').isProduction();
  const hour = Math.floor(istMinutesNow(now) / 60);
  const night = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
  const slots = require('./deliverySlots');
  if (slots.slotsEnabled()) {
    const n = slots.slotsForOrder({ at: now }).nextSlot;
    return {
      open: true,
      night,
      slotsEnabled: true,
      ...(n ? { nextSlot: { id: n.id, label: n.label, timeLabel: n.timeLabel, startISO: n.startISO, closesAtLabel: n.closesAtLabel, day: n.day } } : {}),
    };
  }
  const closed = isProduction && night;
  if (!closed) return { open: true };
  return {
    open: false,
    reopensAt: `${String(NIGHT_END_HOUR).padStart(2, '0')}:00`,
    message: 'Campus ordering is closed for the night. Ordering opens at 6:00 am.'
  };
};

// Public store listing / detail: a store is shown closed during the campus night window too (Home and
// store pages used to say "Open" at 10 PM). Only the public catalogue responses use this; the partner
// apps keep the store's own state. Adds campusClosed (new key; older apps ignore it).
// With delivery slots there is no campus night closure (orders are for the next slot): the store's own state.
const withCampusWindow = (openState, now = new Date()) => {
  const campus = getCampusServiceability(now);
  if (campus.slotsEnabled) return { ...openState, campusClosed: false };
  if (campus.open) return { ...openState, campusClosed: false };
  return {
    ...openState,
    isOpen: false,
    reason: openState.isOpen ? 'campus_night' : openState.reason,
    opensAt: campus.reopensAt,
    message: campus.message,
    campusClosed: true,
  };
};

// Validate + normalise operatingHours from admin / partner input:
// { start: 'HH:MM', end: 'HH:MM', weekly?: { mon: { open, start, end }, … sun } }.
// start === end means open all day. Throws Error(message) with a customer-friendly message.
const HHMM_STRICT = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const normHHMM = (v) => {
  const m = HHMM_STRICT.exec(String(v || '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};
const normalizeOperatingHours = (input) => {
  const h = input && typeof input === 'object' ? input : {};
  let start = normHHMM(h.start);
  let end = normHHMM(h.end);
  let weekly = null;
  if (h.weekly !== undefined && h.weekly !== null) {
    if (typeof h.weekly !== 'object' || Array.isArray(h.weekly)) throw new Error('Weekly hours must list mon to sun.');
    weekly = {};
    let openDays = 0;
    for (const key of DAY_KEYS) {
      const d = h.weekly[key];
      if (!d || typeof d !== 'object' || d.open === false || d.open === 'false') { weekly[key] = { open: false }; continue; }
      const ds = normHHMM(d.start);
      const de = normHHMM(d.end);
      if (!ds || !de) throw new Error(`Operating hours for ${DAY_NAMES[key]} must be 24-hour times.`);
      weekly[key] = { open: true, start: ds, end: de };
      openDays++;
    }
    if (!openDays) throw new Error('Pick at least one day when the store is open.');
    // start/end = the most common open window (older apps read only these).
    if (!start || !end) {
      const counts = new Map();
      for (const key of DAY_KEYS) if (weekly[key].open) {
        const k = `${weekly[key].start}-${weekly[key].end}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      [start, end] = best.split('-');
    }
  }
  if (!start || !end) throw new Error('Operating hours must be 24-hour times like 09:00 and 22:00.');
  return weekly ? { start, end, weekly } : { start, end };
};

// Today's hours as shown on a store card (IST): "9:00 AM – 10:00 PM", "Open 24 hours", "Closed today",
// or null when the store has no hours set.
const todayHoursText = (restaurant, now = new Date()) => {
  const hours = readHours(restaurant);
  if (!hours) return null;
  const weekly = readWeekly(hours);
  if (weekly) {
    const day = weekly[DAY_KEYS[istDayIndex(now)]];
    if (!day || !day.open) return 'Closed today';
    if (day.start === day.end) return 'Open 24 hours';
    return `${formatTime(day.startText)} – ${formatTime(day.endText)}`;
  }
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (start === null || end === null) return null;
  if (start === end) return 'Open 24 hours';
  return `${formatTime(hours.start)} – ${formatTime(hours.end)}`;
};

module.exports = { getStoreOpenState, getCampusServiceability, withCampusWindow, formatTime, todayHoursText, DAY_KEYS, normalizeOperatingHours };
