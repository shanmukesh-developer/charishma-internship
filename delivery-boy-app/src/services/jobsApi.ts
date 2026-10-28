// Rider jobs that are not delivery orders: service pickups (/api/services, laundry / tailoring / repairs collected
// from the student's room and brought back) and, only to finish one the rider already holds, shopping lists
// (/api/mega-basket; removed, no new ones). No invented defaults: a value the server did not send stays null.
import { apiFetch } from './apiClient';
import { toNumber } from './orderModel';

export type JobKind = 'basket' | 'service';

export type BasketStatus =
  | 'PaidEstimate'
  | 'PartnerAssigned'
  | 'Shopping'
  | 'PriceApprovalPending'
  | 'Approved'
  | 'Purchased'
  | 'Delivering'
  | 'Delivered'
  | 'Cancelled'
  | string;

export type BasketItemStatus = 'Pending' | 'Approved' | 'Purchased' | 'Unavailable' | string;

export interface BasketItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  priceEstimated: number | null;
  priceActual: number | null;
  status: BasketItemStatus;
}

export interface RiderBasket {
  id: string;
  shortId: string;
  status: BasketStatus;
  estimatedTotal: number | null;
  actualTotal: number | null;
  shoppingFee: number;
  deliveryFee: number;
  paymentMethod: string | null;
  /** Hostel block (fallback when the full address is missing). */
  area: string | null;
  deliveryAddress: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliverySlot: string | null;
  createdAt: string | null;
  items: BasketItem[];
}

export type ServiceStatus = 'REQUESTED' | 'DIAGNOSED_QUOTED' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED' | string;

export interface ServiceStore {
  name: string | null;
  location: string | null;
  coords: { lat: number; lng: number } | null;
  phone: string | null;
}

export interface RiderService {
  id: string;
  shortId: string;
  serviceType: string;
  title: string;
  serviceName: string | null;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  status: ServiceStatus;
  pickupSlot: string | null;
  area: string | null;
  quotedAmount: number;
  finalAmount: number;
  paymentMethod: string | null;
  createdAt: string | null;
  store: ServiceStore | null;
  // claimed only
  description: string | null;
  details: { label: string; value: string }[];
  roomNumber: string | null;
  deliveryAddress: string | null;
  contactPhone: string | null;
}

const str = (v: unknown): string | null => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s ? s : null;
};
const shortOf = (id: string) => id.replace(/-/g, '').slice(-6).toUpperCase();

function toBasket(raw: any): RiderBasket {
  const id = String(raw?.id ?? '');
  const user = raw?.user ?? {};
  const items: any[] = Array.isArray(raw?.items) ? raw.items : [];
  return {
    id,
    shortId: shortOf(id),
    status: String(raw?.status ?? ''),
    estimatedTotal: toNumber(raw?.estimatedTotal),
    actualTotal: toNumber(raw?.actualTotal),
    shoppingFee: toNumber(raw?.shoppingFee) ?? 0,
    deliveryFee: toNumber(raw?.deliveryFee) ?? 0,
    paymentMethod: str(raw?.paymentMethod),
    area: str(raw?.area) ?? str(user?.hostelBlock),
    deliveryAddress: str(raw?.deliveryAddress),
    customerName: str(user?.name),
    customerPhone: str(user?.phone),
    deliverySlot: str(raw?.slotLabel) ?? str(raw?.deliverySlot),
    createdAt: str(raw?.createdAt),
    items: items.map((i) => ({
      id: String(i?.id ?? ''),
      name: String(i?.name ?? 'Item'),
      quantity: toNumber(i?.quantity) ?? 1,
      unit: str(i?.unit),
      priceEstimated: toNumber(i?.priceEstimated),
      priceActual: toNumber(i?.priceActual),
      status: String(i?.status ?? 'Pending'),
    })),
  };
}

function toService(raw: any): RiderService {
  const id = String(raw?.id ?? '');
  const st = raw?.store ?? null;
  const lat = toNumber(st?.lat);
  const lng = toNumber(st?.lng);
  const details: any[] = Array.isArray(raw?.details) ? raw.details : [];
  return {
    id,
    shortId: shortOf(id),
    serviceType: String(raw?.serviceType ?? ''),
    title: String(raw?.title ?? 'Service'),
    serviceName: str(raw?.serviceName),
    category: str(raw?.category),
    quantity: toNumber(raw?.quantity),
    unit: str(raw?.unit),
    status: String(raw?.status ?? ''),
    pickupSlot: str(raw?.pickupSlot),
    area: str(raw?.area),
    quotedAmount: toNumber(raw?.quotedAmount) ?? 0,
    finalAmount: toNumber(raw?.finalAmount) ?? 0,
    paymentMethod: str(raw?.paymentMethod),
    createdAt: str(raw?.createdAt),
    store: st
      ? { name: str(st.name), location: str(st.location), coords: lat !== null && lng !== null ? { lat, lng } : null, phone: str(st.phone) }
      : null,
    description: str(raw?.description),
    details: details.map((d) => ({ label: String(d?.label ?? ''), value: String(d?.value ?? '') })).filter((d) => d.label && d.value),
    roomNumber: str(raw?.roomNumber),
    deliveryAddress: str(raw?.deliveryAddress),
    contactPhone: str(raw?.contactPhone),
  };
}

// ── Shopping lists ───────────────────────────────────────────────────────────
// Removed (28 Oct 2026): there is no pool and no claim any more. A list the rider already holds is still listed
// here and finished with the steps below.
export async function fetchMyBaskets(): Promise<RiderBasket[]> {
  const rows = await apiFetch<any[]>('/mega-basket/rider/active');
  return Array.isArray(rows) ? rows.map(toBasket) : [];
}
export async function startShopping(id: string): Promise<void> {
  await apiFetch(`/mega-basket/${id}/start-shopping`, { method: 'POST' });
}
export async function setBasketItem(id: string, itemId: string, p: { status: 'Purchased' | 'Unavailable' | 'Pending'; priceActual?: number | null }): Promise<void> {
  await apiFetch(`/mega-basket/${id}/item-status`, { method: 'PUT', body: { itemId, ...p } });
}
export async function submitBill(id: string): Promise<number | null> {
  const d = await apiFetch<any>(`/mega-basket/${id}/submit-bill`, { method: 'POST' });
  return toNumber(d?.basket?.actualTotal);
}
export async function startBasketDelivery(id: string): Promise<void> {
  await apiFetch(`/mega-basket/${id}/start-delivery`, { method: 'POST' });
}
export async function completeBasket(id: string, pin: string): Promise<void> {
  await apiFetch(`/mega-basket/${id}/complete-delivery`, { method: 'POST', body: { deliveryPin: pin } });
}

// ── Service pickups ──────────────────────────────────────────────────────────
export async function fetchServicePool(): Promise<RiderService[]> {
  const d = await apiFetch<any>('/services/rider/pending');
  return Array.isArray(d?.bookings) ? d.bookings.map(toService) : [];
}
export async function fetchMyServices(): Promise<RiderService[]> {
  const d = await apiFetch<any>('/services/rider/active');
  return Array.isArray(d?.bookings) ? d.bookings.map(toService) : [];
}
export async function claimService(id: string): Promise<void> {
  await apiFetch(`/services/${id}/claim`, { method: 'POST' });
}
export async function releaseService(id: string): Promise<void> {
  await apiFetch(`/services/${id}/release`, { method: 'POST' });
}
export async function setServiceStatus(id: string, status: 'IN_PROGRESS' | 'READY_FOR_DELIVERY' | 'COMPLETED', note?: string): Promise<void> {
  await apiFetch(`/services/${id}/status`, { method: 'PATCH', body: { status, ...(note ? { note } : {}) } });
}

/** What the rider collects in cash at the door for a shopping list (bill or estimate + fees). */
export function basketCashToCollect(b: RiderBasket): number {
  return Math.round(((b.actualTotal ?? b.estimatedTotal ?? 0) + b.shoppingFee + b.deliveryFee) * 100) / 100;
}
