// Delivery slots: the single source of truth for WHEN a delivery order arrives (owner rule, 26 Oct 2026).
//
// Every ZCS-delivered order (restaurant food, the campus store / groceries basket and
// the Mega Basket shopping list) is delivered in one of three daily slots, IST:
//   S1 12:30–1:00 PM   S2 4:30–5:30 PM   S3 8:30–9:30 PM
// Booking closes a lead time before the slot START; a basket with mixed items takes the longest lead:
//   60 min  food, store / groceries, shopping list
//   120 min normal cakes (the pricingSchema 'cake' keyword rule)
//   150 min specialized cakes (MenuItem.isSpecializedCake, switched on by the store or admin)
// A customer can pick today's slots that have not passed their cutoff, plus all three of TOMORROW's slots
// (always). Nothing beyond tomorrow. Local vendors / stalls (they deliver themselves), In-Campus Booking pickups,
// services, Auto rides, Co-Ride, PG and Rentals keep their own timing (owner, 27 Oct).
//
// Riders see a slot order only from DISPATCH_WINDOW_MIN before the slot start (the 'orders.slotDispatch' job in
// jobs/index.js releases orders that were held back). Stores get the order at once so they can plan.
//
// Optional GlobalConfig key DELIVERY_SLOTS = { enabled?: bool, slots?: [{ id: 'S1', start: '12:30', end: '13:00' }] }
// overrides the defaults (cached 30 s). Env DELIVERY_SLOTS=off is a kill switch (orders behave as before:
// ASAP, the 9 PM–6 AM campus window, riders at once). Test harnesses for older suites set it off.
const { Op } = require('sequelize');
const { IST_OFFSET_MS, istYmd, istDayStartOf } = require('./istTime');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const DEFAULT_SLOTS = Object.freeze([
  Object.freeze({ id: 'S1', start: '12:30', end: '13:00' }),
  Object.freeze({ id: 'S2', start: '16:30', end: '17:30' }),
  Object.freeze({ id: 'S3', start: '20:30', end: '21:30' }),
]);

const LEAD_MINUTES = Object.freeze({ standard: 60, cake: 120, specializedCake: 150 });
const LEAD_REASONS = Object.freeze({
  standard: null,
  cake: 'Cakes need 2 hours',
  specializedCake: 'This cake needs 2½ hours',
});

// Riders see a slot order from this many minutes before the slot start.
const DISPATCH_WINDOW_MIN = 45;
// A Pending slot order must be accepted by the store within the usual timeout counted from this many minutes
// before the slot start (or from when it was placed, whichever is later). A night order for tomorrow is not
// auto-cancelled at night while the kitchen is closed.
const STORE_ACCEPT_BEFORE_SLOT_MIN = 60;
// A slot order (or shopping list) still without a rider this long after the slot START is cancelled.
const SLOT_UNCLAIMED_GRACE_MIN = 15;

const SLOT_ID_RE = /^(\d{4}-\d{2}-\d{2})\|(S\d{1,2})$/;
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// ── Clock (tests replace it; production always uses the real time) ─────────────────────────────
let clock = () => new Date();
const now = () => clock();
const _setNow = (fnOrDate) => {
  if (fnOrDate === null || fnOrDate === undefined) { clock = () => new Date(); return; }
  clock = typeof fnOrDate === 'function' ? fnOrDate : () => new Date(fnOrDate);
};

// ── Config ──────────────────────────────────────────────────────────────────────────────────────
const CONFIG_KEY = 'DELIVERY_SLOTS';
const CONFIG_TTL_MS = 30 * 1000;
let cfgCache = { at: 0, enabled: true, slots: DEFAULT_SLOTS };

const envOff = () => ['0', 'off', 'false', 'no'].includes(String(process.env.DELIVERY_SLOTS || '').trim().toLowerCase());

const toMin = (hhmm) => {
  const m = HHMM_RE.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// A valid table: 1–6 slots, each start < end on the same day, sorted, no overlap. Anything else -> null.
const normalizeTable = (slots) => {
  if (!Array.isArray(slots) || !slots.length || slots.length > 6) return null;
  const out = [];
  for (const s of slots) {
    if (!s || typeof s !== 'object') return null;
    const id = String(s.id || '').trim().toUpperCase();
    const a = toMin(s.start);
    const b = toMin(s.end);
    if (!/^S\d{1,2}$/.test(id) || a === null || b === null || a >= b) return null;
    out.push({ id, start: s.start.trim().padStart(5, '0'), end: s.end.trim().padStart(5, '0'), a, b });
  }
  out.sort((x, y) => x.a - y.a);
  for (let i = 1; i < out.length; i++) if (out[i].a < out[i - 1].b || out[i].id === out[i - 1].id) return null;
  return out.map(({ id, start, end }) => Object.freeze({ id, start, end }));
};

/** Re-reads the GlobalConfig override at most every 30 s. Never throws. */
const loadConfig = async ({ fresh = false } = {}) => {
  if (!fresh && Date.now() - cfgCache.at < CONFIG_TTL_MS) return cfgCache;
  let enabled = true;
  let slots = DEFAULT_SLOTS;
  try {
    const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
    const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: CONFIG_KEY } }) : null;
    let v = row ? row.value : null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    if (v && typeof v === 'object') {
      if (v.enabled === false) enabled = false;
      const t = v.slots !== undefined ? normalizeTable(v.slots) : null;
      if (t) slots = t;
      else if (v.slots !== undefined) console.warn('[DELIVERY_SLOTS] GlobalConfig DELIVERY_SLOTS.slots is invalid; using the default slots.');
    }
  } catch { /* keep defaults */ }
  cfgCache = { at: Date.now(), enabled, slots };
  return cfgCache;
};
const _resetConfig = () => { cfgCache = { at: 0, enabled: true, slots: DEFAULT_SLOTS }; };

/** Are delivery slots in force? (env kill switch first, then the cached GlobalConfig flag). Sync. */
const slotsEnabled = () => !envOff() && cfgCache.enabled !== false;
const slotTable = () => cfgCache.slots || DEFAULT_SLOTS;

// ── Labels (IST) ──────────────────────────────────────────────────────────────────────────────
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const istParts = (d) => {
  const s = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return { h: s.getUTCHours(), m: s.getUTCMinutes(), dow: s.getUTCDay(), day: s.getUTCDate(), mon: s.getUTCMonth() };
};
const clock12 = (h, m) => `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
const ampm = (h) => (h >= 12 ? 'PM' : 'AM');
/** "12:30 PM" (IST) of an instant. */
const timeLabel = (d) => { const p = istParts(d); return `${clock12(p.h, p.m)} ${ampm(p.h)}`; };
/** "12:30–1:00 PM" or "11:30 AM–12:30 PM" (IST). */
const rangeLabel = (start, end) => {
  const a = istParts(start);
  const b = istParts(end);
  return ampm(a.h) === ampm(b.h)
    ? `${clock12(a.h, a.m)}–${clock12(b.h, b.m)} ${ampm(b.h)}`
    : `${clock12(a.h, a.m)} ${ampm(a.h)}–${clock12(b.h, b.m)} ${ampm(b.h)}`;
};
/** "Tue 27 Oct" (IST). */
const dateLabel = (d) => { const p = istParts(d); return `${DOW[p.dow]} ${p.day} ${MON[p.mon]}`; };
/** The stored / partner-facing label: "Tue 27 Oct, 12:30–1:00 PM". */
const deliveryLabel = (start, end) => `${dateLabel(start)}, ${rangeLabel(start, end)}`;

// ── Lead time ───────────────────────────────────────────────────────────────────────────────────
const tagsOf = (t) => {
  if (Array.isArray(t)) return t;
  if (typeof t === 'string') { try { const p = JSON.parse(t); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

/** Lead kind of one item ({ name, tags?, category?, isSpecializedCake? }): 'specializedCake' | 'cake' | 'standard'. */
const itemLeadKind = (item) => {
  if (!item) return 'standard';
  const it = typeof item.get === 'function' ? item.get({ plain: true }) : item;
  if (truthy(it.isSpecializedCake)) return 'specializedCake';
  // Same rule as pricingSchema.detectProductType 'cake' (cake is the first rule there, so it wins).
  const { detectProductType } = require('./pricingSchema');
  if (detectProductType(String(it.name || ''), tagsOf(it.tags), it.category || '') === 'cake') return 'cake';
  return 'standard';
};

/** { leadMinutes, kind, reason } for a basket: the longest lead of its items (60 when empty). */
const leadForItems = (items) => {
  let kind = 'standard';
  for (const it of Array.isArray(items) ? items : []) {
    const k = itemLeadKind(it);
    if (LEAD_MINUTES[k] > LEAD_MINUTES[kind]) kind = k;
  }
  return { leadMinutes: LEAD_MINUTES[kind], kind, reason: LEAD_REASONS[kind] };
};
const leadMinutesForItems = (items) => leadForItems(items).leadMinutes;

// Lead for GET /delivery-slots?type=
const TYPE_LEAD = { food: 'standard', store: 'standard', grocery: 'standard', vendor: 'standard', list: 'standard', cake: 'cake', specialized_cake: 'specializedCake' };
const leadForType = (type) => {
  const kind = TYPE_LEAD[String(type || '').toLowerCase()] || 'standard';
  return { leadMinutes: LEAD_MINUTES[kind], kind, reason: LEAD_REASONS[kind] };
};

// ── Slots ────────────────────────────────────────────────────────────────────────────────────────
const addDaysYmd = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const slotInstant = (ymd, hhmm) => new Date(istDayStartOf(ymd).getTime() + toMin(hhmm) * MIN);

const buildSlot = (ymd, def, dayWord, leadMinutes, at) => {
  const start = slotInstant(ymd, def.start);
  const end = slotInstant(ymd, def.end);
  const closesAt = new Date(start.getTime() - leadMinutes * MIN);
  const open = at.getTime() < closesAt.getTime();
  const range = rangeLabel(start, end);
  return {
    id: `${ymd}|${def.id}`,
    date: ymd,
    slot: def.id,
    day: dayWord, // 'today' | 'tomorrow'
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    label: `${dayWord === 'today' ? 'Today' : 'Tomorrow'} ${range}`,
    timeLabel: range,
    deliveryLabel: deliveryLabel(start, end),
    closesAtISO: closesAt.toISOString(),
    closesAtLabel: timeLabel(closesAt),
    open,
    ...(open ? {} : { closedReason: 'cutoff', closedText: `Closed at ${timeLabel(closesAt)}` }),
  };
};

/**
 * Today's and tomorrow's slots (IST) with their cutoffs for `leadMinutes` (default 60):
 * [{ id: 'YYYY-MM-DD|S1', date, slot, day, startISO, endISO, label: 'Today 12:30–1:00 PM', timeLabel,
 *    deliveryLabel, closesAtISO, closesAtLabel, open, closedReason?, closedText? }]
 */
const availableSlots = (at = now(), leadMinutes = LEAD_MINUTES.standard, { table = slotTable() } = {}) => {
  const t = at instanceof Date ? at : new Date(at);
  const lead = Math.max(0, Number(leadMinutes) || 0);
  const today = istYmd(t);
  const tomorrow = addDaysYmd(today, 1);
  return [
    ...table.map((d) => buildSlot(today, d, 'today', lead, t)),
    ...table.map((d) => buildSlot(tomorrow, d, 'tomorrow', lead, t)),
  ];
};

const parseSlotId = (value) => {
  const m = SLOT_ID_RE.exec(String(value || '').trim());
  return m ? { date: m[1], slot: m[2] } : null;
};
/** Is this a slot id (a new app's pick), as opposed to 'ASAP' / empty / anything an older build sends? */
const isSlotId = (value) => !!parseSlotId(value);

// The store must be open at the slot start (its own switches + weekly hours, utils/storeHours).
const storeOpenAt = (store, start) => {
  if (!store) return { isOpen: true };
  return require('./storeHours').getStoreOpenState(store, new Date(start));
};
/** Marks slots the store is closed for (open: false, closedReason 'store_closed'). Returns a new array. */
const applyStoreHours = (slots, store) => slots.map((s) => {
  if (!store || !s.open) return s;
  const st = storeOpenAt(store, s.startISO);
  if (st.isOpen) return s;
  return { ...s, open: false, closedReason: 'store_closed', closedText: `${store.name || 'The store'} is closed then` };
});

/** Slots for a basket: lead from items, cutoffs, store hours. → { leadMinutes, leadKind, leadReason, slots, nextSlot, defaultSlotId } */
const slotsForOrder = ({ items = [], store = null, at = now(), lead = null } = {}) => {
  const l = lead || leadForItems(items);
  const slots = applyStoreHours(availableSlots(at, l.leadMinutes), store);
  const next = slots.find((s) => s.open) || null;
  return {
    enabled: true,
    leadMinutes: l.leadMinutes,
    leadKind: l.kind,
    leadReason: l.reason,
    slots,
    nextSlot: next,
    defaultSlotId: next ? next.id : null,
    dispatchWindowMin: DISPATCH_WINDOW_MIN,
  };
};

/**
 * Validates a requested slot against a slotsForOrder() result.
 *  { ok: true, slot, legacy }                     slot to store (legacy: assigned because the app sent 'ASAP' / nothing)
 *  { ok: false, status: 409, body: { code: 'SLOT_CLOSED', message, slots, nextSlot, ... } }
 */
const resolveSlot = (requested, info) => {
  const openSlots = info.slots.filter((s) => s.open);
  const refuse = (message) => ({
    ok: false,
    status: 409,
    body: {
      code: 'SLOT_CLOSED',
      message,
      slots: openSlots,
      nextSlot: info.nextSlot,
      deliverySlots: info,
    },
  });
  if (!isSlotId(requested)) {
    // Older app builds send 'ASAP' (or nothing): the earliest open slot for these items.
    if (!info.nextSlot) return refuse('No delivery slot is open for this order today or tomorrow.');
    return { ok: true, slot: info.nextSlot, legacy: true };
  }
  const id = String(requested).trim();
  const slot = info.slots.find((s) => s.id === id);
  const nextText = info.nextSlot ? ` The next open slot is ${info.nextSlot.label}.` : '';
  if (!slot) return refuse(`That delivery slot is not available any more.${nextText}`);
  if (!slot.open) {
    const why = slot.closedReason === 'store_closed'
      ? `${slot.closedText} (${slot.label}).`
      : `Booking for ${slot.label} closed at ${slot.closesAtLabel}${info.leadReason ? ` (${info.leadReason.toLowerCase()})` : ''}.`;
    return refuse(`${why}${nextText}`);
  }
  return { ok: true, slot, legacy: false };
};

/** Order / basket columns for a resolved slot. */
const slotColumns = (slot) => ({
  deliverySlot: slot.deliveryLabel,
  slotStart: new Date(slot.startISO),
  slotEnd: new Date(slot.endISO),
});

// ── Store listing helper: closed now but taking orders for a later slot ─────────────────────
/** { takesSlotOrders, nextSlot: { id, label, startISO, closesAtLabel } | null } at the standard lead. */
const slotOrderInfo = (store, at = now()) => {
  if (!slotsEnabled()) return { takesSlotOrders: false, nextSlot: null };
  const info = slotsForOrder({ store, at, lead: leadForType('food') });
  const n = info.nextSlot;
  return { takesSlotOrders: !!n, nextSlot: n ? { id: n.id, label: n.label, startISO: n.startISO, closesAtLabel: n.closesAtLabel } : null };
};

/**
 * Public store payload keys (new keys; older apps ignore them): takesSlotOrders = the store can be ordered from
 * now for an upcoming slot (even when it is closed right now), nextSlotLabel = "Tomorrow 12:30–1:00 PM",
 * nextSlotClosesAt = "11:30 AM". Services are booked, not delivered in slots: pass skip = true.
 */
const slotListingFields = (store, { skip = false, at = now() } = {}) => {
  // Local vendors / stalls are not slot stores (they deliver themselves while open).
  if (skip || !slotsEnabled() || require('./vendorTypes').isLocalVendorStore(store)) return { takesSlotOrders: false, nextSlotLabel: null, nextSlotClosesAt: null };
  try {
    const info = slotOrderInfo(store, at);
    return {
      takesSlotOrders: info.takesSlotOrders,
      nextSlotLabel: info.nextSlot ? info.nextSlot.label : null,
      nextSlotClosesAt: info.nextSlot ? info.nextSlot.closesAtLabel : null,
    };
  } catch {
    return { takesSlotOrders: false, nextSlotLabel: null, nextSlotClosesAt: null };
  }
};

// ── Dispatch gating ─────────────────────────────────────────────────────────────────────────────
const msOf = (v) => (v ? new Date(v).getTime() : NaN);
/** When riders may first see the order (null = at once: not a slot order). */
const dispatchOpensAt = (order) => {
  const s = msOf(order && order.slotStart);
  return Number.isFinite(s) ? new Date(s - DISPATCH_WINDOW_MIN * MIN) : null;
};
/** May riders see / claim this order now? Orders without a slot (older rows, kill switch) always. */
const isDispatchDue = (order, at = now()) => {
  const opens = dispatchOpensAt(order);
  return !opens || opens.getTime() <= new Date(at).getTime();
};
/** Sequelize where fragment: no slot, or the slot starts within DISPATCH_WINDOW_MIN. */
const dispatchDueWhere = (at = now()) => ({
  [Op.or]: [{ slotStart: null }, { slotStart: { [Op.lte]: new Date(new Date(at).getTime() + DISPATCH_WINDOW_MIN * MIN) } }],
});

/** Store-accept clock start for a Pending order: max(createdAt, slotStart - STORE_ACCEPT_BEFORE_SLOT_MIN). */
const acceptAnchorMs = (order) => {
  const created = msOf(order && order.createdAt);
  const s = msOf(order && order.slotStart);
  const fromSlot = Number.isFinite(s) ? s - STORE_ACCEPT_BEFORE_SLOT_MIN * MIN : -Infinity;
  return Math.max(Number.isFinite(created) ? created : -Infinity, fromSlot);
};
/** Where fragment: the store-accept clock (see acceptAnchorMs) started before `cutoff`. */
const acceptAnchorBeforeWhere = (cutoff) => ({
  createdAt: { [Op.lt]: cutoff },
  [Op.or]: [{ slotStart: null }, { slotStart: { [Op.lt]: new Date(cutoff.getTime() + STORE_ACCEPT_BEFORE_SLOT_MIN * MIN) } }],
});
/** Where fragment: a slot order is past its slot start + grace (orders without a slot: no extra limit). */
const slotGracePassedWhere = (at = now()) => ({
  [Op.or]: [{ slotStart: null }, { slotStart: { [Op.lt]: new Date(new Date(at).getTime() - SLOT_UNCLAIMED_GRACE_MIN * MIN) } }],
});

/** Slot fields for partner / admin / customer payloads (all null for orders without a slot). */
const slotFields = (order) => {
  const s = order && order.slotStart ? new Date(order.slotStart) : null;
  const e = order && order.slotEnd ? new Date(order.slotEnd) : null;
  const ok = s && e && Number.isFinite(s.getTime()) && Number.isFinite(e.getTime());
  return {
    deliverySlot: (order && order.deliverySlot) || null,
    slotStart: ok ? s.toISOString() : null,
    slotEnd: ok ? e.toISOString() : null,
    slotLabel: ok ? deliveryLabel(s, e) : null,
    riderVisibleFrom: ok ? new Date(s.getTime() - DISPATCH_WINDOW_MIN * MIN).toISOString() : null,
  };
};

// ── Startup migration (idempotent, additive) ──────────────────────────────────────────────────
// The columns themselves are added from the models by config/db.js addMissingColumns (and the explicit
// Postgres ADD COLUMN IF NOT EXISTS list there). This only adds the indexes the dispatch job reads.
const runDeliverySlotMigrations = async (sequelize) => {
  if (!sequelize) return;
  for (const [name, sql] of [
    ['orders_slot_start', 'CREATE INDEX IF NOT EXISTS "orders_slot_start" ON "Orders" ("slotStart");'],
    ['mega_baskets_slot_start', 'CREATE INDEX IF NOT EXISTS "mega_baskets_slot_start" ON "MegaBaskets" ("slotStart");'],
  ]) {
    try {
      await sequelize.query(sql);
    } catch (err) {
      console.warn(`⚠️ [DELIVERY_SLOTS_MIGRATION_WARN] ${name}:`, err.message);
    }
  }
};

module.exports = {
  DEFAULT_SLOTS,
  LEAD_MINUTES,
  LEAD_REASONS,
  DISPATCH_WINDOW_MIN,
  STORE_ACCEPT_BEFORE_SLOT_MIN,
  SLOT_UNCLAIMED_GRACE_MIN,
  CONFIG_KEY,
  now,
  _setNow,
  loadConfig,
  _resetConfig,
  normalizeTable,
  slotsEnabled,
  slotTable,
  timeLabel,
  rangeLabel,
  dateLabel,
  deliveryLabel,
  itemLeadKind,
  leadForItems,
  leadMinutesForItems,
  leadForType,
  availableSlots,
  parseSlotId,
  isSlotId,
  storeOpenAt,
  applyStoreHours,
  slotsForOrder,
  resolveSlot,
  slotColumns,
  slotOrderInfo,
  slotListingFields,
  dispatchOpensAt,
  isDispatchDue,
  dispatchDueWhere,
  acceptAnchorMs,
  acceptAnchorBeforeWhere,
  slotGracePassedWhere,
  slotFields,
  runDeliverySlotMigrations,
};
