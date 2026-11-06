/**
 * In-Campus Booking cart: one small cart PER STALL. Since 6 Nov 2026 these carts are the main basket's "Campus store"
 * tab (context/CartContext reads them through cbCart.all / subscribeCbCart, app/(tabs)/basket shows one section per
 * stall, each booked as its own order through CbCartScreen and the campus booking API). The delivery baskets never
 * write here, so a pickup booking can never mix with a delivery order or change a delivery checkout.
 * Saved on the phone (AsyncStorage) so a cart survives leaving the screen. Prices / names are only for showing;
 * the server prices every booking again from the stall menu.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'zcs.campusBooking.carts.v1';
const MAX_QTY = 10;
/** Stationery / print stalls sell per page: up to 200 on one line (same cap as the server). */
export const MAX_QTY_STATIONERY = 200;
const MAX_LINES = 20;
/** Carts untouched for a day are dropped (menus and prices move on). */
const STALE_MS = 24 * 3600 * 1000;

export interface CbCartLine { menuItemId: string; name: string; price: number; isVeg: boolean; quantity: number; category?: string | null }
interface CbCartData { lines: CbCartLine[]; at: number; /** The stall's name (for the main basket's Campus store tab). */ name?: string }
type Store = Record<string, CbCartData>;

let store: Store = {};
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

const loading = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return;
    const now = Date.now();
    for (const [k, c] of Object.entries(v as Store)) {
      if (c && Array.isArray(c.lines) && now - Number(c.at || 0) < STALE_MS) store[k] = { lines: c.lines.filter((l) => l && l.menuItemId && l.quantity > 0), at: c.at, ...(typeof c.name === 'string' && c.name ? { name: c.name } : {}) };
    }
  })
  .catch(() => { /* unreadable: start empty */ })
  .finally(() => { loaded = true; emit(); });

const save = () => { AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {}); };

const write = (stallId: string, lines: CbCartLine[], stallName?: string) => {
  const next = { ...store };
  const name = String(stallName || '').trim() || store[stallId]?.name;
  if (lines.length) next[stallId] = { lines, at: Date.now(), ...(name ? { name } : {}) };
  else delete next[stallId];
  store = next;
  save();
  emit();
};

export const cbCart = {
  lines: (stallId: string): CbCartLine[] => (store[stallId] ? store[stallId].lines : []),
  qty: (stallId: string, menuItemId: string) => (store[stallId]?.lines.find((l) => l.menuItemId === menuItemId)?.quantity || 0),
  /** +1 / -1 (or any delta) for one item. Returns false when a limit stopped it. `stallName` labels the stall's
   *  section in the main basket's Campus store tab. */
  change: (stallId: string, item: Omit<CbCartLine, 'quantity'>, delta: number, max: number = MAX_QTY, stallName?: string): boolean => {
    const lines = [...cbCart.lines(stallId)];
    const i = lines.findIndex((l) => l.menuItemId === item.menuItemId);
    const cur = i >= 0 ? lines[i].quantity : 0;
    const q = Math.max(0, Math.min(max, cur + delta));
    if (q === cur) return false;
    if (i < 0 && lines.length >= MAX_LINES) return false;
    if (q === 0) lines.splice(i, 1);
    else if (i >= 0) lines[i] = { ...lines[i], ...item, quantity: q };
    else lines.push({ ...item, quantity: q });
    write(stallId, lines, stallName);
    return true;
  },
  /** A typed count (stationery pages): sets the line to `qty` (1..max). */
  setQty: (stallId: string, item: Omit<CbCartLine, 'quantity'>, qty: number, max: number = MAX_QTY): boolean => {
    const cur = cbCart.qty(stallId, item.menuItemId);
    const q = Math.max(1, Math.min(max, Math.round(qty)));
    return q === cur ? false : cbCart.change(stallId, item, q - cur, max);
  },
  /** Fresh names / prices from the menu; items no longer on it are removed. Returns the removed names. */
  refresh: (stallId: string, menu: { id: string; name: string; price: number; isVeg: boolean; isAvailable: boolean; category?: string | null }[]): string[] => {
    const byId = new Map(menu.map((m) => [m.id, m]));
    const removed: string[] = [];
    const lines: CbCartLine[] = [];
    for (const l of cbCart.lines(stallId)) {
      const m = byId.get(l.menuItemId);
      if (!m) { removed.push(l.name); continue; }
      lines.push({ ...l, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category ?? null });
    }
    const before = JSON.stringify(cbCart.lines(stallId));
    if (JSON.stringify(lines) !== before) write(stallId, lines);
    return removed;
  },
  /** Remembers the stall's name for its cart (no change event when the name is the same or there is no cart). */
  nameStall: (stallId: string, name: string | null | undefined) => {
    const n = String(name || '').trim();
    const c = store[stallId];
    if (!n || !c || c.name === n) return;
    store = { ...store, [stallId]: { ...c, name: n } };
    save();
    emit();
  },
  /** Every stall cart with items, oldest first (the main basket's Campus store tab). */
  all: (): { stallId: string; name: string; lines: CbCartLine[]; at: number }[] =>
    Object.entries(store)
      .filter(([, c]) => c && c.lines.length)
      .map(([stallId, c]) => ({ stallId, name: c.name || '', lines: c.lines, at: Number(c.at) || 0 }))
      .sort((a, b) => a.at - b.at),
  isLoaded: () => loaded,
  remove: (stallId: string, menuItemId: string) => write(stallId, cbCart.lines(stallId).filter((l) => l.menuItemId !== menuItemId)),
  /** Every stall cart (logout: the next account on a shared phone starts empty). */
  clearAll: () => { store = {}; AsyncStorage.removeItem(KEY).catch(() => {}); emit(); },
  clear: (stallId: string) => write(stallId, []),
  /** The stall cart changed most recently (for the "View cart" bar on the stall list), or null. */
  latest: (): { stallId: string; lines: CbCartLine[] } | null => {
    let best: { stallId: string; lines: CbCartLine[]; at: number } | null = null;
    for (const [stallId, c] of Object.entries(store)) if (c.lines.length && (!best || c.at > best.at)) best = { stallId, lines: c.lines, at: c.at };
    return best ? { stallId: best.stallId, lines: best.lines } : null;
  },
  MAX_QTY,
};

/** Change listener for screens outside React hooks' reach (CartContext). Returns the unsubscribe. */
export function subscribeCbCart(fn: () => void): () => void {
  listeners.add(fn);
  if (!loaded) void loading.then(fn);
  return () => { listeners.delete(fn); };
}

export const cartTotals = (lines: CbCartLine[]) => ({
  count: lines.reduce((s, l) => s + l.quantity, 0),
  total: Math.round(lines.reduce((s, l) => s + l.price * 100 * l.quantity, 0)) / 100,
});

/** Non-food products (stationery, toiletries...) carry no veg mark (same rule as the Home stall section). */
export const NON_FOOD_CATEGORY = /stationery|xerox|print|toiletr|laundry|household|electronic/i;
export const isNonFood = (category?: string | null) => NON_FOOD_CATEGORY.test(String(category || ''));

/** Re-renders on every cart change (any stall). */
export function useCbCartTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    if (!loaded) void loading.then(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return loaded;
}

/** Live cart lines of one stall (re-renders on every change, from any screen). */
export function useCbCart(stallId: string | null | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    if (!loaded) void loading.then(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const lines = stallId ? cbCart.lines(stallId) : [];
  return { lines, ...cartTotals(lines), loaded };
}
