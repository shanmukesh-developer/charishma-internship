// Turns server order payloads into RiderOrder. Rule: never invent a value. Unknown → null.
import type { OrderStatus, PaymentMethod, RiderOrder, RiderOrderItem } from '../types';

// Placeholder strings older servers sent in place of real data.
const PLACEHOLDERS = new Set(
  [
    'hidden',
    'identity protected',
    'verified customer',
    'amaravathi hub',
    'station alpha',
    'location',
    'restaurant',
    'customer',
    'n/a',
    'null',
    'undefined',
  ].map((s) => s.toLowerCase()),
);

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || PLACEHOLDERS.has(s.toLowerCase())) return null;
  return s;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "₹30" → 30, "₹1,250" → 1250. null when there is no number. */
export function parseRupees(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function digitsOnly(p: string | null | undefined): string {
  return String(p || '').replace(/\D/g, '');
}

/**
 * Typed / pasted Indian mobile → its 10 digits ("+91 98765 43210", "098765 43210" → "9876543210").
 * Anything else comes back as all its digits, so a caller can tell a wrong number from a right one
 * (never "the last 10 digits" of a longer number).
 */
export function indianMobileDigits(v: string | null | undefined): string {
  let d = digitsOnly(v);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** A real phone number we can dial (rejects 'Hidden', '', etc). */
export function isDialable(p: string | null | undefined): boolean {
  return /\d{10}/.test(digitsOnly(p));
}

const STATUSES: OrderStatus[] = [
  'Pending',
  'Accepted',
  'Preparing',
  'ReadyForPickup',
  'Picking',
  'PickedUp',
  'ArrivedAtGate',
  'Delivered',
  'Cancelled',
];

function toStatus(v: unknown): OrderStatus {
  const s = String(v || '');
  // Never default an unknown status to a real step: it would show a working "Reached store" button.
  return (STATUSES as string[]).includes(s) ? (s as OrderStatus) : 'Unknown';
}

/** true / false only when the server told us; null otherwise. */
function toKitchenReady(raw: any, status: OrderStatus): boolean | null {
  if (status === 'ReadyForPickup') return true;
  // readyAt (newer servers) is the kitchen's own "packed" time: it stays set after the rider reaches the store.
  const hasReadyAt = !!raw && Object.prototype.hasOwnProperty.call(raw, 'readyAt');
  if (hasReadyAt && cleanText(raw.readyAt)) return true;
  if (status === 'Accepted' || status === 'Preparing') return false;
  if (hasReadyAt) return false;
  return null;
}

function toPaymentMethod(v: unknown): PaymentMethod | null {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'cod' || s === 'cash' || s === 'cash on delivery') return 'COD';
  if (s === 'wallet' || s === 'zenvy wallet') return 'Wallet';
  if (s === 'upi') return 'UPI';
  if (s === 'card') return 'Card';
  return null;
}

function toItems(raw: unknown): RiderOrderItem[] {
  let list: any = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((it: any) => ({
      name: cleanText(it?.name) || cleanText(it?.itemName) || 'Item',
      quantity: Math.max(1, Math.round(toNumber(it?.quantity) ?? 1)),
      price: toNumber(it?.priceAtOrder ?? it?.price),
    }))
    .filter((it) => !!it.name);
}

// Customer checkout builds "<address> · Landmark: … · Note: a, b".
const NOTE_SPLIT = /\s*[·|]?\s*Note:\s*/i;

function toInstructions(raw: any): { instructions: string[]; address: string | null } {
  const address = cleanText(raw?.drop ?? raw?.deliveryAddress);
  let list: unknown = raw?.deliveryInstructions;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [list];
    }
  }
  if (Array.isArray(list) && list.length) {
    // Newer customer apps also append "Note: …" to the address for older rider apps; strip it here.
    const strippedAddress = address ? address.split(NOTE_SPLIT)[0].trim() || address : null;
    return { instructions: list.map((s) => String(s || '').trim()).filter(Boolean), address: strippedAddress };
  }
  if (address && /Note:/i.test(address)) {
    const [head, ...rest] = address.split(NOTE_SPLIT);
    const notes = rest
      .join(' ')
      .split(/[;•\n]|,\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { instructions: notes, address: head.trim() || null };
  }
  return { instructions: [], address };
}

function toCoords(c: any): { lat: number; lng: number } | null {
  if (!c) return null;
  const lat = toNumber(c.lat);
  const lng = toNumber(c.lng ?? c.lon);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

export function normalizeOrder(raw: any): RiderOrder {
  const id = String(raw?._id ?? raw?.id ?? '');
  const finalPrice = toNumber(raw?.finalPrice ?? raw?.totalPrice);
  const paymentMethod = toPaymentMethod(raw?.paymentMethod);
  const paymentStatus = cleanText(raw?.paymentStatus);
  const serverCollect = toNumber(raw?.amountToCollect);
  let amountToCollect: number | null = null;
  if (serverCollect !== null) amountToCollect = serverCollect;
  else if (paymentMethod === 'COD') amountToCollect = paymentStatus === 'Completed' ? 0 : finalPrice;
  else if (paymentMethod) amountToCollect = 0;

  const { instructions, address } = toInstructions(raw);
  const distance = toNumber(raw?.distance);
  const status = toStatus(raw?.status);

  return {
    id,
    shortId: id.replace(/-/g, '').slice(-6).toUpperCase(),
    status,
    rawStatus: cleanText(raw?.status),
    kitchenReady: toKitchenReady(raw, status),
    restaurantName: cleanText(raw?.restaurant ?? raw?.restaurantName),
    restaurantAddress: cleanText(raw?.restaurantAddress),
    restaurantPhone: isDialable(raw?.restaurantPhone) ? String(raw.restaurantPhone) : null,
    pickupCoords: toCoords(raw?.pickupCoords),
    customerName: cleanText(raw?.customerName),
    customerPhone: isDialable(raw?.customerPhone) ? String(raw.customerPhone) : null,
    dropAddress: address,
    dropArea: cleanText(raw?.dropArea),
    dropCoords: toCoords(raw?.dropCoords),
    instructions,
    items: toItems(raw?.items),
    finalPrice,
    paymentMethod,
    paymentStatus,
    amountToCollect,
    earning: toNumber(raw?.riderEarning) ?? parseRupees(raw?.earnings),
    distanceKm: distance !== null && distance > 0 ? distance : null,
    createdAt: cleanText(raw?.createdAt),
    deliveredAt: cleanText(raw?.deliveredAt),
    // Server label of the booked delivery slot; older orders say 'ASAP' (no slot to show).
    deliverySlot: (() => {
      const s = cleanText(raw?.slotLabel) || cleanText(raw?.deliverySlot);
      return s && !/^asap$/i.test(s) ? s : null;
    })(),
    hasDeliveryPin: raw?.hasDeliveryPin !== false,
    pinLocked: raw?.pinLocked === true,
    buyAtStore: raw?.buyAtStore === true,
  };
}

export function normalizeOrders(list: unknown): RiderOrder[] {
  return Array.isArray(list) ? list.map(normalizeOrder).filter((o) => !!o.id) : [];
}

// ── Delivery steps ─────────────────────────────────────────────────────────

/** UNKNOWN: a status this app does not understand. Read-only; the rider is sent to support. */
export type StepKey = 'TO_STORE' | 'AT_STORE' | 'TO_DROP' | 'AT_DROP' | 'DONE' | 'UNKNOWN';

export const STEPS: { key: StepKey; title: string }[] = [
  { key: 'TO_STORE', title: 'Go to store' },
  { key: 'AT_STORE', title: 'Pick up order' },
  { key: 'TO_DROP', title: 'Go to customer' },
  { key: 'AT_DROP', title: 'Hand over' },
  { key: 'DONE', title: 'Delivered' },
];

export function stepFor(status: OrderStatus): StepKey {
  switch (status) {
    case 'Picking':
      return 'AT_STORE';
    case 'PickedUp':
      return 'TO_DROP';
    case 'ArrivedAtGate':
      return 'AT_DROP';
    case 'Delivered':
      return 'DONE';
    case 'Unknown':
      return 'UNKNOWN';
    default:
      return 'TO_STORE';
  }
}

export function stepIndex(status: OrderStatus): number {
  return STEPS.findIndex((s) => s.key === stepFor(status));
}

/** How far along an order is, for "optimistic" overlays from the offline queue. */
export function statusRank(status: OrderStatus): number {
  switch (status) {
    case 'Picking':
      return 1;
    case 'PickedUp':
      return 2;
    case 'ArrivedAtGate':
      return 3;
    case 'Delivered':
      return 4;
    default:
      return 0;
  }
}

/** Rider can hand the order back before pickup (server rule). */
export function canUnassign(status: OrderStatus): boolean {
  return ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking'].includes(status);
}

export function storeStatusLabel(status: OrderStatus): string | null {
  if (status === 'ReadyForPickup') return 'Ready for pickup';
  if (status === 'Preparing') return 'Kitchen preparing';
  if (status === 'Accepted') return 'Store accepted';
  return null;
}

/**
 * Kitchen chip for an order the rider has not picked up yet: before reaching the store ("Ready for pickup",
 * "Kitchen preparing") and while waiting at the counter ("Food packed"). null for buy-at-store orders (the
 * store has no app, so any kitchen state would be invented) and when the server did not say.
 */
export function kitchenChip(o: RiderOrder): { text: string; ready: boolean } | null {
  if (o.buyAtStore) return null;
  if (o.status === 'Picking') {
    const t = atStoreKitchenLabel(o);
    return t ? { text: t, ready: o.kitchenReady === true } : null;
  }
  if (o.status === 'Accepted' || o.status === 'Preparing' || o.status === 'ReadyForPickup' || o.status === 'Pending') {
    if (o.kitchenReady === true) return { text: 'Ready for pickup', ready: true };
    const t = storeStatusLabel(o.status);
    return t ? { text: t, ready: false } : null;
  }
  return null;
}

/** Kitchen state while the rider waits at the store ('Picking'). null when the server did not say. */
export function atStoreKitchenLabel(o: RiderOrder): string | null {
  if (o.kitchenReady === true) return 'Food packed';
  if (o.kitchenReady === false) return 'Kitchen preparing';
  return null;
}

export function itemCount(o: RiderOrder): number {
  return o.items.reduce((s, it) => s + it.quantity, 0);
}

export function firstName(name: string | null | undefined): string | null {
  const s = cleanText(name);
  return s ? s.split(/\s+/)[0] : null;
}
