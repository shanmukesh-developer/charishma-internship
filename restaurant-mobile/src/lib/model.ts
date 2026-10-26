// Turns server order / menu / store rows into the shapes the UI renders, plus IST time helpers.
// Every field is defensive: null / missing / malformed data never crashes a screen.
import type { Diet, MenuItem, Order, OrderItem, OrderStage, StoreState } from '../types';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function stageOf(status: string): OrderStage {
  switch (status) {
    case 'Pending': return 'new';
    case 'Accepted':
    case 'Preparing': return 'preparing';
    case 'ReadyForPickup':
    case 'Picking': return 'ready';
    case 'PickedUp':
    case 'ArrivedAtGate': return 'pickedUp';
    default: return 'past'; // Delivered, Cancelled (and anything unknown)
  }
}

/**
 * Stage shown in the tabs. A rider can reach the counter ('Picking') while the food is still cooking:
 * until the kitchen marks it ready (readyAt) it stays in Preparing, where the MARK READY button is.
 */
export function stageFor(status: string, readyAt: string | null | undefined): OrderStage {
  if (status === 'Picking' && !readyAt) return 'preparing';
  return stageOf(status);
}

/** Same short id as the customer app: last 6 of the UUID, upper-case. */
export function shortId(id: string): string {
  const clean = String(id || '').replace(/-/g, '');
  return clean ? clean.slice(-6).toUpperCase() : '';
}

export function firstName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const f = name.trim().split(/\s+/)[0];
  return f || null;
}

export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

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

/** `{ size: 'Large', crustType: 'Cheese Burst' }` → "Size: Large · Crust Type: Cheese Burst" */
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
  return {
    key: `${it?.menuItemId || it?.id || 'item'}-${i}`,
    name: typeof it?.name === 'string' && it.name.trim() ? it.name.trim() : 'Item',
    quantity,
    unitPrice,
    lineTotal,
    customizations: formatCustomizations(it?.customizations),
    isAddOn: it?.isAddOn === true,
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

// The customer app builds addresses as "<Campus label> - <hostel / room>" (checkout CAMPUSES).
const CAMPUS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bSRM\b/i, label: 'SRM' },
  { re: /\bVIT\b/i, label: 'VIT' },
  { re: /\bAMRITA\b/i, label: 'Amrita' },
  { re: /\bKLU?\b|\bKL University\b/i, label: 'KL' },
];

/** Campus name safe to speak and show ("SRM"), or null. Never returns room numbers or other address parts. */
export function campusOf(address: unknown): string | null {
  const s = typeof address === 'string' ? address : '';
  if (!s) return null;
  const head = s.split(/\s+-\s+/)[0] || s;
  for (const c of CAMPUS_PATTERNS) if (c.re.test(head)) return c.label;
  return null;
}

/** Delivery slot of an order payload: the server label, or nothing for older 'ASAP' orders. */
export function slotOf(raw: any): { slotLabel: string | null; slotStart: string | null } {
  const label = typeof raw?.slotLabel === 'string' && raw.slotLabel.trim() ? raw.slotLabel.trim()
    : typeof raw?.deliverySlot === 'string' && raw.deliverySlot.trim() && !/^asap$/i.test(raw.deliverySlot.trim()) ? raw.deliverySlot.trim() : null;
  const start = raw?.slotStart ? String(raw.slotStart) : null;
  return { slotLabel: label, slotStart: start };
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
  const pm = String(raw.paymentMethod || '').toUpperCase();
  const totalPrice = num(raw.totalPrice) ?? 0;
  return {
    id,
    shortId: shortId(id),
    status,
    stage: stageFor(status, raw.readyAt),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    acceptedAt: raw.acceptedAt || null,
    readyAt: raw.readyAt || null,
    deliveredAt: raw.deliveredAt || null,
    items,
    itemCount: items.reduce((s, it) => s + it.quantity, 0),
    totalPrice,
    finalPrice: num(raw.finalPrice) ?? totalPrice,
    deliveryFee: num(raw.deliveryFee) ?? 0,
    paymentMethod: pm === 'WALLET' ? 'Wallet' : pm === 'COD' ? 'COD' : String(raw.paymentMethod || ''),
    paymentStatus: typeof raw.paymentStatus === 'string' ? raw.paymentStatus : null,
    isCOD: pm === 'COD',
    deliveryAddress: address,
    campus: (typeof raw.campus === 'string' && raw.campus.trim()) ? raw.campus.trim() : campusOf(rawAddress),
    instructions,
    estDuration: num(raw.estDuration),
    cancellationReason: typeof raw.cancellationReason === 'string' ? raw.cancellationReason : null,
    deliveryPartnerId: raw.deliveryPartnerId || null,
    customerName: firstName(raw.user?.name),
    customerPhone: typeof raw.user?.phone === 'string' && raw.user.phone.trim() ? raw.user.phone : null,
    ...slotOf(raw),
    riderName: typeof raw.deliveryPartner?.name === 'string' ? raw.deliveryPartner.name : null,
    riderPhone: typeof raw.deliveryPartner?.phone === 'string' && raw.deliveryPartner.phone.trim() ? raw.deliveryPartner.phone : null,
    partial: !!raw.__partial,
  };
}

export function normalizeMenuItem(raw: any): MenuItem | null {
  const id = raw?.id || raw?._id;
  if (!id) return null;
  return {
    id: String(id),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Item',
    price: num(raw.price) ?? 0,
    description: typeof raw.description === 'string' ? raw.description : null,
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : null,
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : 'Other',
    isVegetarian: typeof raw.isVegetarian === 'boolean' ? raw.isVegetarian : null,
    isAvailable: raw.isAvailable !== false,
    outOfStockUntil: raw.outOfStockUntil || null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
    dietType: raw.dietType === 'veg' || raw.dietType === 'nonveg' || raw.dietType === 'egg' ? raw.dietType : null,
    originalPrice: mrpOf(raw),
    isSpecializedCake: raw.isSpecializedCake === true,
  };
}

function mrpOf(raw: any): number | null {
  let specs = raw?.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = null; } }
  const v = num(raw?.originalPrice) ?? num(specs?.originalPrice);
  return v !== null && v > 0 ? v : null;
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
    isOffline: raw?.isOffline === true,
    isActive: raw?.isActive !== false,
    operatingHours: hours && typeof hours === 'object' ? hours : null,
    deliveryTime: num(raw?.deliveryTime),
  };
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

/** Epoch ms of the next IST occurrence of HH:MM after `now`. */
export function nextISTTime(hhmm: string, now = Date.now()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const ist = toIST(new Date(now));
  const targetUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), Number(m[1]) % 24, Number(m[2])) - IST_OFFSET_MS;
  return targetUtc > now ? targetUtc : targetUtc + 24 * 60 * 60 * 1000;
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

export const TIMED_OUT_REASON = /did not accept the order in time/i;
export const TIMEOUT_REASON_TEXT = 'The store did not accept the order in time';

/** Today's numbers (IST) from the orders list. Shared by the Today screen and the closing announcement. */
export function todayNumbers(orders: Order[]) {
  const today = orders.filter((o) => isTodayIST(o.createdAt));
  const live = today.filter((o) => o.status !== 'Cancelled');
  const delivered = today.filter((o) => o.status === 'Delivered');
  const cancelled = today.filter((o) => o.status === 'Cancelled');
  const sum = (arr: Order[], f: 'totalPrice' | 'finalPrice') => arr.reduce((a, o) => a + (o[f] || 0), 0);
  const prepTimes = today
    .map((o) => (o.acceptedAt && o.readyAt ? (new Date(o.readyAt).getTime() - new Date(o.acceptedAt).getTime()) / 60000 : NaN))
    .filter((m) => Number.isFinite(m) && m >= 0 && m < 600);
  const cod = live.filter((o) => o.isCOD);
  const prepaid = live.filter((o) => !o.isCOD);
  return {
    orders: live.length,
    delivered: delivered.length,
    sales: Math.round(sum(delivered, 'totalPrice')),
    inProgressValue: Math.round(sum(live.filter((o) => o.status !== 'Delivered' && o.status !== 'Pending'), 'totalPrice')),
    cancelled: cancelled.length,
    missed: cancelled.filter((o) => TIMED_OUT_REASON.test(o.cancellationReason || '')).length,
    codN: cod.length, codAmt: Math.round(sum(cod, 'finalPrice')),
    preN: prepaid.length, preAmt: Math.round(sum(prepaid, 'finalPrice')),
    avgPrep: prepTimes.length ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length) : null,
    prepN: prepTimes.length,
  };
}
