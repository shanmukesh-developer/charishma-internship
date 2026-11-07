// Turns server order / menu / shop rows into the shapes the UI renders, plus IST time helpers.
// Every field is defensive: null / missing / malformed data never crashes a screen.
import type { Diet, MenuItem, Order, OrderItem, OrderStage, StoreState } from '../types';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Vendor flow: Pending → Accepted → OutForDelivery → Delivered / Cancelled.
 * Kitchen statuses an older server may send are folded in (Preparing = accepted, PickedUp = on the way).
 */
export function stageOf(status: string): OrderStage {
  switch (status) {
    case 'Pending': return 'new';
    case 'Accepted':
    case 'Preparing':
    case 'ReadyForPickup': return 'accepted';
    case 'OutForDelivery':
    case 'Picking':
    case 'PickedUp':
    case 'ArrivedAtGate': return 'outForDelivery';
    default: return 'done'; // Delivered, Cancelled (and anything unknown)
  }
}

/** Same short id as the customer app: last 6 of the UUID, upper-case. */
export function shortId(id: string): string {
  const clean = String(id || '').replace(/-/g, '');
  return clean ? clean.slice(-6).toUpperCase() : '';
}

/**
 * Human order ID (owner, 6 Nov 2026): "ZEN-123", one running count across the whole server (backend
 * utils/orderNumbers sends orderNumber + orderCode). An order without a number yet shows the old "#AB12CD".
 */
export function orderCodeOf(raw: any, id: string): string {
  const code = raw && typeof raw.orderCode === 'string' ? raw.orderCode.trim() : '';
  if (code) return code;
  const n = Number(raw && raw.orderNumber);
  if (Number.isInteger(n) && n > 0) return `ZEN-${n}`;
  const s = String(id || '').replace(/-/g, '').slice(-6).toUpperCase();
  return s ? `#${s}` : '';
}

export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const titleCase = (key: string) =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const valueText = (v: any): string => {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return 'Yes';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(', ');
  if (typeof v === 'object') return valueText(v.name ?? v.label ?? v.value ?? '');
  return '';
};

/** `{ size: 'Large', note: 'less sugar' }` → "Size: Large · Note: less sugar" */
export function formatCustomizations(c: unknown): string | null {
  let obj: any = c;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return obj.trim() || null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) return valueText(obj) || null;
  const parts = Object.keys(obj)
    .map((k) => {
      const v = valueText(obj[k]);
      return v ? `${titleCase(k)}: ${v}` : '';
    })
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function parseItems(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

function normalizeItem(it: any, i: number): OrderItem {
  const quantity = Math.max(1, Math.round(num(it?.quantity) ?? num(it?.qty) ?? 1));
  const unitPrice = num(it?.unitPrice) ?? num(it?.price) ?? num(it?.priceAtOrder);
  const lineTotal = num(it?.lineTotal) ?? (unitPrice !== null ? Math.round(unitPrice * quantity * 100) / 100 : null);
  const custom = formatCustomizations(it?.customizations);
  const note = str(it?.note) || str(it?.notes) || str(it?.instructions);
  return {
    key: `${it?.menuItemId || it?.id || 'item'}-${i}`,
    name: str(it?.name) || 'Item',
    quantity,
    unitPrice,
    lineTotal,
    customizations: [custom, note].filter(Boolean).join(' · ') || null,
  };
}

/** Pulls "Note: …" parts out of the address string (the customer app puts instructions there too). */
export function splitAddress(addr: unknown): { address: string; notes: string[] } {
  const s = typeof addr === 'string' ? addr : '';
  const notes: string[] = [];
  const keep: string[] = [];
  for (const p of s.split(/\s*[·|]\s*/).filter(Boolean)) {
    const m = /^note\s*:\s*(.+)$/i.exec(p);
    if (m) notes.push(m[1].trim());
    else keep.push(p);
  }
  return { address: keep.join(' · '), notes };
}

/** "Block A, Room 204" style hints from the address when the server has no structured fields. */
function blockFromAddress(address: string): string | null {
  const m = /\b(?:block|blk|hostel)\s*[-:]?\s*([A-Za-z0-9-]{1,12})\b/i.exec(address);
  return m ? m[1].toUpperCase() : null;
}
function roomFromAddress(address: string): string | null {
  const m = /\b(?:room|rm|flat)\s*(?:no\.?)?\s*[-:#]?\s*([A-Za-z0-9-]{1,8})\b/i.exec(address);
  return m ? m[1].toUpperCase() : null;
}

/** A profile hostel / room for the chips: only when the delivery address is empty or mentions it. */
function profilePlace(v: string | null, address: string): string | null {
  if (!v) return null;
  if (!address.trim()) return v.toUpperCase();
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${esc}($|[^A-Za-z0-9])`, 'i').test(address) ? v.toUpperCase() : null;
}

/** Minutes before a delivery slot when the store's accept clock starts (backend STORE_ACCEPT_BEFORE_SLOT_MIN). */
const ACCEPT_BEFORE_SLOT_MS = 60 * 60 * 1000;
/**
 * When the store's accept clock starts (backend utils/deliverySlots.acceptAnchorMs): when the order was placed, or
 * 60 minutes before its delivery slot, whichever is later. NaN when unknown.
 */
export function acceptAnchorMs(o: { createdAt?: string | null; slotStart?: string | null }): number {
  const created = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
  const fromSlot = o.slotStart ? new Date(o.slotStart).getTime() - ACCEPT_BEFORE_SLOT_MS : NaN;
  const known = [created, fromSlot].filter(Number.isFinite);
  return known.length ? Math.max(...known) : NaN;
}

/** Backend STORE_ACCEPT_TIMEOUT_MIN default: used only when the server did not send storeAcceptBy (older server). */
const DEFAULT_ACCEPT_TIMEOUT_MS = 60 * 60 * 1000;
/**
 * Server-clock ms until which a Pending order must be accepted (the server auto-cancels it then): the server's
 * storeAcceptBy, else acceptAnchorMs + 60 min. NaN when unknown.
 */
export function acceptDeadlineMs(o: { createdAt?: string | null; slotStart?: string | null; storeAcceptBy?: string | null }): number {
  const by = o.storeAcceptBy ? new Date(o.storeAcceptBy).getTime() : NaN;
  if (Number.isFinite(by)) return by;
  const anchor = acceptAnchorMs(o);
  return Number.isFinite(anchor) ? anchor + DEFAULT_ACCEPT_TIMEOUT_MS : NaN;
}

/** Delivery slot of an order payload: the server label, or nothing for older 'ASAP' orders. */
export function slotOf(raw: any): { slotLabel: string | null; slotStart: string | null } {
  const label = typeof raw?.slotLabel === 'string' && raw.slotLabel.trim() ? raw.slotLabel.trim()
    : typeof raw?.deliverySlot === 'string' && raw.deliverySlot.trim() && !/^asap$/i.test(raw.deliverySlot.trim()) ? raw.deliverySlot.trim() : null;
  return { slotLabel: label, slotStart: raw?.slotStart ? String(raw.slotStart) : null };
}

export function normalizeOrder(raw: any): Order | null {
  const id = raw?.id || raw?._id;
  if (!id || typeof id !== 'string') return null;
  const status = typeof raw.status === 'string' ? raw.status : 'Pending';
  const items = parseItems(raw.items).map(normalizeItem);
  const rawAddress = raw.deliveryAddress ?? raw.address;
  const { address, notes } = splitAddress(rawAddress);
  const instr = Array.isArray(raw.deliveryInstructions)
    ? raw.deliveryInstructions.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : [];
  const instructions: string[] = [...instr];
  for (const n of notes) {
    for (const part of n.split(/\s*,\s*/)) {
      if (part && !instructions.some((x) => x.toLowerCase() === part.toLowerCase())) instructions.push(part);
    }
  }
  const pm = String(raw.paymentMethod || 'COD').toUpperCase();
  const isCOD = pm === 'COD' || pm === 'CASH';
  const totalPrice = num(raw.totalPrice) ?? 0;
  const finalPrice = num(raw.finalPrice) ?? totalPrice;
  // Contract: `customer` (owning vendor only). Fallbacks: today's `user` include, socket flat fields.
  const c = raw.customer && typeof raw.customer === 'object' ? raw.customer : null;
  const u = raw.user && typeof raw.user === 'object' ? raw.user : null;
  const customerName = str(c?.name) || str(raw.customerName) || str(u?.name);
  const customerPhone = str(c?.phone) || str(raw.customerPhone) || str(u?.phone);
  return {
    id,
    shortId: shortId(id),
    orderCode: orderCodeOf(raw, id),
    status,
    stage: stageOf(status),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    acceptedAt: raw.acceptedAt || null,
    outForDeliveryAt: raw.outForDeliveryAt || raw.pickedUpAt || null,
    deliveredAt: raw.deliveredAt || null,
    items,
    itemCount: items.reduce((s, it) => s + it.quantity, 0),
    totalPrice,
    finalPrice,
    paymentMethod: isCOD ? 'COD' : pm === 'WALLET' ? 'Wallet' : String(raw.paymentMethod || ''),
    isCOD,
    collectAmount: isCOD ? finalPrice : 0,
    deliveryAddress: address,
    // The address typed at checkout wins: the profile's hostel / room may be somewhere else (ordering from a
    // friend's room, the library). A profile value is used only when the address names it too, or is empty.
    hostelBlock: blockFromAddress(address) || profilePlace(str(c?.hostelBlock) || str(raw.hostelBlock) || str(u?.hostelBlock), address),
    roomNumber: roomFromAddress(address) || profilePlace(str(c?.roomNumber) || str(raw.roomNumber) || str(u?.roomNumber), address),
    instructions,
    cancellationReason: typeof raw.cancellationReason === 'string' ? raw.cancellationReason : null,
    cancelledBy: cancelledByOf(raw.cancelledBy),
    customerName,
    customerPhone,
    ...slotOf(raw),
    storeAcceptBy: typeof raw.storeAcceptBy === 'string' && raw.storeAcceptBy ? raw.storeAcceptBy : null,
    partial: !!raw.__partial,
  };
}

export function normalizeMenuItem(raw: any): MenuItem | null {
  const id = raw?.id || raw?._id;
  if (!id) return null;
  return {
    id: String(id),
    name: str(raw.name) || 'Item',
    price: num(raw.price) ?? 0,
    description: typeof raw.description === 'string' ? raw.description : null,
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : null,
    category: str(raw.category) || 'Other',
    isVegetarian: typeof raw.isVegetarian === 'boolean' ? raw.isVegetarian : null,
    isAvailable: raw.isAvailable !== false,
    dietType: raw.dietType === 'veg' || raw.dietType === 'nonveg' || raw.dietType === 'egg' ? raw.dietType : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
  };
}

export const isEggTag = (t: string) => t.trim().toLowerCase() === 'egg';

/** Veg / non-veg / egg for the form and the row mark. */
export function dietOf(item: Pick<MenuItem, 'isVegetarian' | 'tags' | 'dietType'>): Diet | null {
  if (item.dietType) return item.dietType;
  if (item.tags.some(isEggTag)) return 'egg';
  if (item.isVegetarian === true) return 'veg';
  if (item.isVegetarian === false) return 'nonveg';
  return null;
}

export function normalizeStore(raw: any): StoreState {
  let hours = raw?.operatingHours ?? null;
  if (typeof hours === 'string') {
    try { hours = JSON.parse(hours); } catch { hours = null; }
  }
  const isOpenNow = raw?.isOpenNow !== false;
  return {
    name: typeof raw?.name === 'string' ? raw.name : undefined,
    location: typeof raw?.location === 'string' ? raw.location : undefined,
    isOpenNow,
    isOpen: typeof raw?.isOpen === 'boolean' ? raw.isOpen : isOpenNow,
    opensAt: raw?.opensAt || null,
    closedReason: raw?.closedReason || null,
    isActive: raw?.isActive !== false,
    operatingHours: hours && typeof hours === 'object' ? hours : null,
  };
}

// ── Phone links ─────────────────────────────────────────────────────────────
/** Digits for tel: (keeps a leading +). */
export const telDigits = (phone: string) => phone.replace(/[^\d+]/g, '');
/** wa.me needs the country code: a bare 10-digit Indian number gets 91 in front. */
export function waDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
}

// ── Time (IST) ──────────────────────────────────────────────────────────────
const toIST = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

export function istDayKey(d: Date | string | number): string {
  const dt = toIST(new Date(d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
export const todayIST = () => istDayKey(Date.now());
export function isTodayIST(d: string | null | undefined): boolean {
  if (!d) return false;
  const t = new Date(d).getTime();
  return Number.isFinite(t) && istDayKey(t) === todayIST();
}

/** "9:05 PM" (IST). */
export function clockIST(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return '';
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return '';
  const dt = toIST(new Date(t));
  const h = dt.getUTCHours();
  const m = dt.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "21:00" → "9:00 PM". */
export function formatHHMM(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return hhmm ? String(hhmm) : '';
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function minutesSince(d: string | null | undefined, now: number): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
}

export function agoText(d: string | null | undefined, now: number): string {
  const m = minutesSince(d, now);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** 123456 → "1,23,456" (Indian grouping, no Intl dependency). */
function groupIN(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export const rupees = (n: number | null | undefined) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const neg = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const [i, d] = (Number.isInteger(abs) ? String(abs) : abs.toFixed(2)).split('.');
  return `${neg}₹${groupIN(i)}${d ? `.${d}` : ''}`;
};

const CANCELLED_BY = ['customer', 'store', 'support', 'system'] as const;
export function cancelledByOf(v: unknown): Order['cancelledBy'] {
  return typeof v === 'string' && (CANCELLED_BY as readonly string[]).includes(v) ? (v as Order['cancelledBy']) : null;
}
/** Socket cancel codes (statusUpdated / orderCancelled `reason`) → who cancelled. */
export function cancelledByFromCode(code: unknown): Order['cancelledBy'] {
  switch (code) {
    case 'CUSTOMER_CANCELLED': return 'customer';
    case 'ADMIN_CANCELLED': case 'ADMIN': return 'support';
    case 'STORE_TIMEOUT': case 'NO_RIDER_TIMEOUT': return 'system';
    case 'STORE_DECLINED': return 'store';
    default: return null;
  }
}
export const TIMED_OUT_REASON = /did not accept the order in time/i;
export const TIMEOUT_REASON_TEXT = 'The stall did not accept the order in time';

/** When a delivered order's cash was collected (older rows may lack deliveredAt). */
export const deliveredDay = (o: Order) => o.deliveredAt || o.updatedAt || o.createdAt;

/** Today's real numbers (IST) from the orders list. Shared by the Shop screen and the closing announcement. */
export function todayNumbers(orders: Order[]) {
  const today = orders.filter((o) => isTodayIST(o.createdAt));
  const live = today.filter((o) => o.status !== 'Cancelled');
  // Cash is counted on the day it was collected (delivered), not the day the order was placed: an order
  // placed at 11:55 PM and delivered after midnight is today's cash in hand.
  const delivered = orders.filter((o) => o.status === 'Delivered' && isTodayIST(deliveredDay(o)));
  const cancelled = today.filter((o) => o.status === 'Cancelled');
  const onTheWay = today.filter((o) => o.stage === 'outForDelivery');
  const sum = (arr: Order[], f: (o: Order) => number) => Math.round(arr.reduce((a, o) => a + (f(o) || 0), 0));
  return {
    orders: live.length,
    delivered: delivered.length,
    /** Cash actually collected: delivered cash orders. */
    cashCollected: sum(delivered.filter((o) => o.isCOD), (o) => o.finalPrice),
    /** Delivered sales of every payment kind. */
    sales: sum(delivered, (o) => o.finalPrice),
    /** Cash still to collect for orders on the way. */
    cashOnTheWay: sum(onTheWay.filter((o) => o.isCOD), (o) => o.finalPrice),
    inProgress: live.filter((o) => o.stage === 'new' || o.stage === 'accepted' || o.stage === 'outForDelivery').length,
    cancelled: cancelled.length,
    missed: cancelled.filter((o) => TIMED_OUT_REASON.test(o.cancellationReason || '')).length,
  };
}
